import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import RecordModeBadge from "../components/RecordModeBadge";
import SectionCard from "../components/SectionCard";
import { getMobileAnalysisJob, retryMobileAnalysisJob } from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";
import { theme, radius } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "JobStatus">;

export default function JobStatusScreen({ route, navigation }: Props) {
  const { jobId: initialJobId } = route.params;
  const [jobId, setJobId] = useState(initialJobId);
  const [retrying, setRetrying] = useState(false);

  const query = useQuery({
    queryKey: ["mobile-job", jobId],
    queryFn: () => getMobileAnalysisJob(jobId),
    refetchInterval: (queryState) => {
      const job = queryState.state.data;
      return job && (job.status === "completed" || job.status === "failed")
        ? false
        : 1500;
    },
  });

  useEffect(() => {
    const job = query.data;
    if (job?.status === "completed" && job.analysisId) {
      navigation.replace("Analysis", { analysisId: job.analysisId });
    }
  }, [query.data, navigation]);

  const job = query.data;
  const progress = job?.progress ?? 0;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const newJob = await retryMobileAnalysisJob(jobId);
      setJobId(newJob.id);
    } catch (err) {
      query.refetch();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <SectionCard
          title={job?.videoFileName || "Server analysis"}
          subtitle="The backend extracts landmarks and scores your swing."
        >
          {query.isLoading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color={theme.accent} />
              <Text style={styles.metaText}>Connecting to analysis job...</Text>
            </View>
          ) : null}

          {query.isError ? (
            <Text style={styles.errorText}>
              Could not reach the server. Check API URL and Wi‑Fi.
            </Text>
          ) : null}

          {job ? (
            <>
              <RecordModeBadge mode={job.mode} />
              <Text style={styles.statusText}>
                {job.statusMessage || "Working..."}
              </Text>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.metaText}>{progress}% complete</Text>

              {job.stages?.length ? (
                <View style={styles.stageStack}>
                  {job.stages.map((stage) => (
                    <View key={stage.id} style={styles.stageCard}>
                      <View style={styles.stageHeader}>
                        <Text style={styles.stageLabel}>{stage.label}</Text>
                        <Text
                          style={[
                            styles.stageStatus,
                            stage.status === "completed"
                              ? styles.stageDone
                              : stage.status === "failed"
                                ? styles.stageFailed
                                : stage.status === "running"
                                  ? styles.stageRunning
                                  : null,
                          ]}
                        >
                          {stage.status}
                        </Text>
                      </View>
                      <View style={styles.stageTrack}>
                        <View
                          style={[
                            styles.stageFill,
                            stage.status === "failed" ? styles.stageFillFailed : null,
                            { width: `${stage.progress}%` },
                          ]}
                        />
                      </View>
                      {stage.message || stage.errorMessage ? (
                        <Text
                          style={[
                            styles.stageMessage,
                            stage.errorMessage ? styles.errorText : null,
                          ]}
                        >
                          {stage.errorMessage || stage.message}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}

              {job.errorMessage ? (
                <Text style={styles.errorText}>{job.errorMessage}</Text>
              ) : null}
            </>
          ) : !query.isLoading ? (
            <Text style={styles.errorText}>Analysis job not found.</Text>
          ) : null}

          {job?.status === "failed" ? (
            <View style={styles.buttonStack}>
              <Pressable
                onPress={() => void handleRetry()}
                disabled={retrying}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !retrying ? styles.buttonPressed : null,
                  retrying ? styles.buttonDisabled : null,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {retrying ? "Retrying..." : "Retry analysis"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.replace("Upload")}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed ? styles.buttonPressed : null,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Upload new clip</Text>
              </Pressable>
            </View>
          ) : null}
        </SectionCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.paper,
  },
  content: {
    padding: 16,
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusText: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "600",
  },
  metaText: {
    color: theme.ink2,
    fontSize: 13,
  },
  progressTrack: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: theme.paper,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: theme.accent,
    borderRadius: radius.pill,
  },
  errorText: {
    color: theme.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  stageStack: {
    gap: 8,
    marginTop: 8,
  },
  stageCard: {
    backgroundColor: theme.paper,
    borderColor: theme.rule,
    borderRadius: radius.input,
    borderWidth: 1,
    padding: 10,
  },
  stageHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  stageLabel: {
    color: theme.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  stageStatus: {
    color: theme.muted,
    fontSize: 12,
    textTransform: "capitalize",
  },
  stageDone: {
    color: theme.accent,
  },
  stageFailed: {
    color: theme.danger,
  },
  stageRunning: {
    color: theme.sand,
  },
  stageTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.surface,
    marginTop: 8,
    overflow: "hidden",
  },
  stageFill: {
    height: "100%",
    backgroundColor: theme.accent,
    borderRadius: radius.pill,
  },
  stageFillFailed: {
    backgroundColor: theme.danger,
  },
  stageMessage: {
    color: theme.ink2,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  buttonStack: {
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: theme.cta,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: theme.ctaInk,
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: theme.white10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.white15,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: theme.ink,
    fontWeight: "600",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
});
