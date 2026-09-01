import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import NavGrid from "../components/NavGrid";
import QueryErrorState from "../components/QueryErrorState";
import RecordModeBadge from "../components/RecordModeBadge";
import SectionCard from "../components/SectionCard";
import SkeletonPreview from "../components/SkeletonPreview";
import {
  API_BASE_URL,
  DEV_BUILD_STAMP,
  isUsingLocalhostBaseUrl,
  usesHttpToPrivateLanBaseUrl,
} from "../lib/config";
import { BUNDLE_LOADED_AT } from "../lib/devBundleStamp";
import {
  createMobileAnalysisJob,
  listRecentAnalyses,
  uploadVideoAsset,
  type UploadVideoInput,
} from "../lib/api";
import {
  pickSwingVideoFromFiles,
  pickSwingVideoFromPhotos,
} from "../lib/swingVideoPickers";
import { DEMO_ANALYSIS_ID } from "../lib/sampleAnalysis";
import type { RootStackParamList } from "../lib/navigation";
import { loadLastRecordMode } from "../lib/recordMode";
import { theme, radius } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

const HOW_IT_WORKS = [
  {
    title: "Upload your swing",
    body: "Record from the side and pick a clip from your library.",
  },
  {
    title: "Server analyzes",
    body: "MediaPipe tracks 33 landmarks and scores each phase.",
  },
  {
    title: "Review & compare",
    body: "History, side-by-side compare, and pro benchmarks.",
  },
] as const;

export default function HomeScreen({ navigation }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analysesQuery = useQuery({
    queryKey: ["mobile-analyses"],
    queryFn: listRecentAnalyses,
  });

  const runUpload = useCallback(
    async (input: UploadVideoInput) => {
      setUploading(true);
      setError(null);
      try {
        const uploaded = await uploadVideoAsset(input);
        const mode = await loadLastRecordMode();
        const job = await createMobileAnalysisJob({ ...uploaded, mode });
        navigation.navigate("JobStatus", { jobId: job.id });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not start analysis."
        );
      } finally {
        setUploading(false);
      }
    },
    [navigation]
  );

  const handlePickFromPhotos = async () => {
    try {
      const input = await pickSwingVideoFromPhotos();
      if (!input) return;
      await runUpload(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Photos.");
    }
  };

  const handlePickFromFiles = async () => {
    try {
      const input = await pickSwingVideoFromFiles();
      if (!input) return;
      await runUpload(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Files.");
    }
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={analysesQuery.data?.items ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={analysesQuery.isRefetching}
            onRefresh={() => analysesQuery.refetch()}
            tintColor={theme.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <Text style={styles.eyebrow}>Open beta · AI swing coaching</Text>
            <Text style={styles.heroTitle}>
              See your padel swing{" "}
              <Text style={styles.heroAccent}>like a pro coach</Text>
            </Text>
            <Text style={styles.heroBody}>
              Upload a clip, get pose-based feedback in under a minute. Track 33
              body points and score every phase.
            </Text>

            <SkeletonPreview />

            <View style={styles.ctaRow}>
              <Pressable
                onPress={() => navigation.navigate("Setup")}
                style={({ pressed }) => [
                  styles.recordButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.recordButtonText}>Record a swing</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void loadLastRecordMode().then((mode) =>
                    navigation.navigate("Record", { alignedInWizard: true, mode })
                  );
                }}
                style={({ pressed }) => [
                  styles.skipWizardLink,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.skipWizardText}>Skip setup → camera</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("Upload")}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>Analyze your swing</Text>
              </Pressable>
              <Pressable
                testID="home-see-sample-analysis"
                accessibilityRole="button"
                accessibilityLabel="See sample analysis"
                onPress={() =>
                  navigation.navigate("Analysis", { analysisId: DEMO_ANALYSIS_ID })
                }
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>See sample analysis</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>How it works</Text>
            {HOW_IT_WORKS.map((step) => (
              <View key={step.title} style={styles.stepCard}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.metaText}>{step.body}</Text>
              </View>
            ))}

            <View style={styles.trustRow}>
              <Text style={styles.trustChip}>Runs on server + MediaPipe</Text>
              <Text style={styles.trustChip}>Open beta</Text>
            </View>

            <NavGrid navigation={navigation} />

            <SectionCard
              title="Quick upload"
              subtitle="Pick from Photos, browse Files, or use the Upload screen."
              right={
                uploading ? <ActivityIndicator color={theme.accent} /> : undefined
              }
            >
              <Text style={styles.bodyText}>API: {API_BASE_URL}</Text>
              {isUsingLocalhostBaseUrl() ? (
                <Text style={styles.warningText}>
                  Using localhost — works on simulators only. On a physical device
                  set EXPO_PUBLIC_API_BASE_URL to your Mac IP (e.g. http://192.168.x.x:3001).
                </Text>
              ) : null}
              {usesHttpToPrivateLanBaseUrl() && !isUsingLocalhostBaseUrl() ? (
                <Text style={styles.warningText}>
                  Plain HTTP on a LAN address. Stay on the same Wi‑Fi, allow Local
                  Network when iOS prompts, and ensure the analyzer is reachable at
                  this URL (firewall / correct port).
                </Text>
              ) : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <View style={styles.quickUploadButtons}>
                <Pressable
                  onPress={handlePickFromPhotos}
                  disabled={uploading}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && !uploading ? styles.buttonPressed : null,
                    uploading ? styles.buttonDisabled : null,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {uploading ? "Uploading..." : "Pick from Photos"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handlePickFromFiles}
                  disabled={uploading}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && !uploading ? styles.buttonPressed : null,
                    uploading ? styles.buttonDisabled : null,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Browse Files</Text>
                </Pressable>
              </View>
            </SectionCard>

            <Text style={styles.sectionTitle}>Recent analyses</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("Analysis", { analysisId: item.id })}
            style={({ pressed }) => [
              styles.listCard,
              pressed ? styles.listCardPressed : null,
            ]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.videoFileName}
              </Text>
              <Text style={styles.score}>{item.overallScore}</Text>
            </View>
            <Text style={styles.metaText}>{formatDate(item.createdAt)}</Text>
            <Text style={styles.metaText}>
              {item.dominantSide}-handed • {item.frameCount} frames •{" "}
              {formatDuration(item.durationMs)}
            </Text>
            <View style={styles.badgeRow}>
              <RecordModeBadge mode={item.mode} />
              {item.shotType ? (
                <Text style={styles.badge}>{item.shotType}</Text>
              ) : null}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          analysesQuery.isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.accent} />
              <Text style={styles.metaText}>Loading sessions...</Text>
            </View>
          ) : analysesQuery.isError ? (
            <QueryErrorState
              message="Couldn't load recent analyses. Check your connection and try again."
              onRetry={() => void analysesQuery.refetch()}
            />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.cardTitle}>No analyses yet</Text>
              <Text style={styles.metaText}>
                Tap Analyze your swing or pick a video above to get started.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          __DEV__ ? (
            <Text style={styles.devStamp} selectable>
              Dev bundle {DEV_BUILD_STAMP}
              {__DEV__ ? ` · loaded ${BUNDLE_LOADED_AT}` : ""} · API {API_BASE_URL}
            </Text>
          ) : null
        }
      />
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
    gap: 12,
  },
  headerStack: {
    gap: 12,
    marginBottom: 12,
  },
  eyebrow: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  heroTitle: {
    color: theme.ink,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 32,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  heroAccent: {
    color: theme.accent,
  },
  heroBody: {
    color: theme.ink2,
    fontSize: 15,
    lineHeight: 22,
  },
  ctaRow: {
    gap: 10,
  },
  quickUploadButtons: {
    gap: 10,
  },
  recordButton: {
    backgroundColor: theme.white10,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.white15,
  },
  recordButtonText: {
    color: theme.ink,
    fontWeight: "700",
    fontSize: 16,
  },
  skipWizardLink: {
    alignItems: "center",
    paddingVertical: 4,
  },
  skipWizardText: {
    color: theme.ink2,
    fontSize: 13,
    fontWeight: "600",
  },
  sectionTitle: {
    color: theme.ink,
    fontSize: 20,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  stepCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 14,
    gap: 4,
  },
  stepTitle: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  trustRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  trustChip: {
    color: theme.ink2,
    fontSize: 11,
    backgroundColor: theme.white10,
    borderWidth: 1,
    borderColor: theme.white15,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  bodyText: {
    color: theme.ink2,
    fontSize: 13,
  },
  warningText: {
    color: theme.sand,
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: theme.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: theme.cta,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: theme.ctaInk,
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: theme.white10,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.white15,
  },
  secondaryButtonText: {
    color: theme.ink,
    fontWeight: "600",
    fontSize: 16,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  listCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 16,
    gap: 6,
  },
  listCardPressed: {
    opacity: 0.85,
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  score: {
    color: theme.accent,
    fontWeight: "800",
    fontSize: 22,
    fontVariant: ["tabular-nums"],
  },
  metaText: {
    color: theme.ink2,
    fontSize: 13,
  },
  devStamp: {
    color: theme.muted,
    fontSize: 11,
    marginTop: 24,
    marginBottom: 8,
    textAlign: "center",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: theme.white10,
    color: theme.ink2,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
  emptyState: {
    paddingVertical: 36,
    alignItems: "center",
    gap: 8,
  },
});
