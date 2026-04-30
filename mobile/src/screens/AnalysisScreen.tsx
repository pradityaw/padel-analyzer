import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import SectionCard from "../components/SectionCard";
import { getAnalysisById } from "../lib/api";
import { API_BASE_URL } from "../lib/config";
import type { RootStackParamList } from "../lib/navigation";
import type { AnalysisPhase } from "../lib/types";

type Props = NativeStackScreenProps<RootStackParamList, "Analysis">;

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default function AnalysisScreen({ route }: Props) {
  const { analysisId } = route.params;
  const query = useQuery({
    queryKey: ["analysis", analysisId],
    queryFn: () => getAnalysisById(analysisId),
  });

  const phases = useMemo<AnalysisPhase[]>(() => {
    const raw = query.data?.phasesJson;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [query.data?.phasesJson]);

  if (query.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#a3e635" />
      </View>
    );
  }

  if (!query.data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Analysis not found</Text>
      </View>
    );
  }

  const analysis = query.data;
  const replayUrl = analysis.videoStorageKey
    ? `${API_BASE_URL}/uploads/${analysis.videoStorageKey}`
    : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionCard
        title={analysis.videoFileName}
        subtitle={new Date(analysis.createdAt).toLocaleString()}
        right={<Text style={styles.score}>{analysis.overallScore}</Text>}
      >
        <Text style={styles.metaText}>
          {analysis.dominantSide}-handed • {analysis.frameCount} frames •{" "}
          {formatDuration(analysis.durationMs)}
        </Text>
        {analysis.shotType ? (
          <Text style={styles.badge}>Shot: {analysis.shotType}</Text>
        ) : null}
        {analysis.skillLabel ? (
          <Text style={styles.badge}>
            Skill: {analysis.skillLabel} ({analysis.qualityScore ?? 0})
          </Text>
        ) : null}
        {replayUrl ? (
          <Pressable
            onPress={() => Linking.openURL(replayUrl)}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Open uploaded video</Text>
          </Pressable>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Phase breakdown"
        subtitle="Server-side v1 focuses on score and metrics. Replay overlay stays on the web app for now."
      >
        {phases.length === 0 ? (
          <Text style={styles.metaText}>No phases available.</Text>
        ) : (
          phases.map((phase) => (
            <View key={`${phase.type}-${phase.startFrame}`} style={styles.phaseRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.phaseTitle}>{phase.type}</Text>
                <Text style={styles.metaText}>
                  Frames {phase.startFrame}–{phase.endFrame}
                </Text>
              </View>
              <Text style={styles.phaseScore}>{phase.score}</Text>
            </View>
          ))
        )}
      </SectionCard>
    </ScrollView>
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
  centered: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "700",
  },
  score: {
    color: "#a3e635",
    fontSize: 28,
    fontWeight: "800",
  },
  metaText: {
    color: "#94a3b8",
    fontSize: 13,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#a3e63522",
    color: "#d9f99d",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
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
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  phaseTitle: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  phaseScore: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "700",
  },
});
