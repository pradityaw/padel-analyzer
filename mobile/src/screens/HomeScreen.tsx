import { useState } from "react";
import * as DocumentPicker from "expo-document-picker";
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
import SectionCard from "../components/SectionCard";
import {
  isUsingLocalhostBaseUrl,
  usesHttpToPrivateLanBaseUrl,
  API_BASE_URL,
} from "../lib/config";
import {
  createMobileAnalysisJob,
  listRecentAnalyses,
  uploadVideoAsset,
} from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default function HomeScreen({ navigation }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analysesQuery = useQuery({
    queryKey: ["mobile-analyses"],
    queryFn: listRecentAnalyses,
  });

  const handlePickVideo = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: "video/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploading(true);
    try {
      const uploaded = await uploadVideoAsset(result.assets[0]!);
      const job = await createMobileAnalysisJob(uploaded);
      navigation.navigate("JobStatus", { jobId: job.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start analysis.");
    } finally {
      setUploading(false);
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
            tintColor="#a3e635"
          />
        }
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <SectionCard
              title="Native Mobile V1"
              subtitle="Upload a clip, let the server analyze it, and review your results."
              right={
                uploading ? <ActivityIndicator color="#a3e635" /> : undefined
              }
            >
              <Text style={styles.bodyText}>
                API: {API_BASE_URL}
              </Text>
              {isUsingLocalhostBaseUrl() ? (
                <Text style={styles.warningText}>
                  Using localhost. This works on simulators, but physical devices
                  need `EXPO_PUBLIC_API_BASE_URL` set to your machine or hosted API.
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
              <Pressable
                onPress={handlePickVideo}
                disabled={uploading}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && !uploading ? styles.buttonPressed : null,
                  uploading ? styles.buttonDisabled : null,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {uploading ? "Uploading..." : "Choose swing video"}
                </Text>
              </Pressable>
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
            {item.shotType ? (
              <Text style={styles.badge}>{item.shotType}</Text>
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={
          analysesQuery.isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color="#a3e635" />
              <Text style={styles.metaText}>Loading sessions...</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.cardTitle}>No analyses yet</Text>
              <Text style={styles.metaText}>
                Pick a video above to create your first mobile analysis.
              </Text>
            </View>
          )
        }
      />
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
    gap: 12,
  },
  headerStack: {
    gap: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
  },
  bodyText: {
    color: "#cbd5e1",
    fontSize: 13,
  },
  warningText: {
    color: "#fbbf24",
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 16,
  },
  buttonPressed: {
    opacity: 0.92,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  listCard: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 16,
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
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "600",
    flex: 1,
  },
  score: {
    color: "#a3e635",
    fontWeight: "800",
    fontSize: 22,
  },
  metaText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 4,
    backgroundColor: "#a3e63522",
    color: "#d9f99d",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
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
