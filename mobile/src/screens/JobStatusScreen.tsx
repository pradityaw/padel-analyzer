import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import SectionCard from "../components/SectionCard";
import { getMobileAnalysisJob } from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "JobStatus">;

export default function JobStatusScreen({ route, navigation }: Props) {
  const { jobId } = route.params;
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

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <SectionCard
          title={job?.videoFileName || "Server analysis"}
          subtitle="The backend is extracting landmarks and computing your swing scores."
        >
          {query.isLoading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator color="#a3e635" />
              <Text style={styles.metaText}>Connecting to analysis job...</Text>
            </View>
          ) : null}

          {job ? (
            <>
              <Text style={styles.statusText}>
                {job.statusMessage || "Working..."}
              </Text>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.metaText}>{progress}% complete</Text>

              {job.errorMessage ? (
                <Text style={styles.errorText}>{job.errorMessage}</Text>
              ) : null}
            </>
          ) : null}

          {job?.status === "failed" ? (
            <Pressable
              onPress={() => navigation.replace("Home")}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed ? styles.buttonPressed : null,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Back to sessions</Text>
            </Pressable>
          ) : null}
        </SectionCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0f172a",
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
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "600",
  },
  metaText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  progressTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: "#0f172a",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#a3e635",
    borderRadius: 999,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    lineHeight: 20,
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontWeight: "600",
  },
  buttonPressed: {
    opacity: 0.85,
  },
});
