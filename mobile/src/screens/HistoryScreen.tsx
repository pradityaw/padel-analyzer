/* Hallmark · genre: modern-minimal (dark, data-led sports) · macrostructure: Stat-Led
 * design-system: design.md · designed-as-app · theme: Tennis Neon (LOCKED)
 * React Native StyleSheet · pre-emit critique: P5 H5 E4 S5 R4 V4 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import RecordModeBadge from "../components/RecordModeBadge";
import { deleteAnalysis, listRecentAnalyses } from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";
import type { AnalysisSummary } from "../lib/types";

type Props = NativeStackScreenProps<RootStackParamList, "History">;

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export default function HistoryScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const analysesQuery = useQuery({
    queryKey: ["mobile-analyses", "history"],
    queryFn: () => listRecentAnalyses(),
  });

  const items = analysesQuery.data?.items ?? [];

  const stats = useMemo(() => {
    if (items.length === 0) return null;
    const scores = items.map((a) => a.overallScore);
    const best = Math.max(...scores);
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    return { sessions: items.length, best, avg };
  }, [items]);

  const confirmDelete = (item: AnalysisSummary) => {
    Alert.alert(
      "Delete analysis",
      `Remove "${item.videoFileName}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(item.id);
            try {
              await deleteAnalysis(item.id);
              await queryClient.invalidateQueries({ queryKey: ["mobile-analyses"] });
            } catch (err) {
              Alert.alert(
                "Delete failed",
                err instanceof Error ? err.message : "Could not delete."
              );
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
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
          <View>
            <Text style={styles.eyebrow}>YOUR PROGRESS</Text>
            <Text style={styles.screenTitle}>Sessions</Text>
            {stats ? (
              <View style={styles.statRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>SESSIONS</Text>
                  <Text style={styles.statValue}>{stats.sessions}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={[styles.statLabel, styles.statLabelGold]}>
                    PERSONAL BEST
                  </Text>
                  <Text style={[styles.statValue, styles.statValueGold]}>
                    {stats.best}
                  </Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>AVG SCORE</Text>
                  <Text style={[styles.statValue, styles.statValueAccent]}>
                    {stats.avg}
                  </Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.listLabel}>ALL SESSIONS</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate("Analysis", { analysisId: item.id })}
            onLongPress={() => confirmDelete(item)}
            style={({ pressed }) => [
              styles.listCard,
              pressed ? styles.listCardPressed : null,
            ]}
          >
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.videoFileName}
              </Text>
              {deletingId === item.id ? (
                <ActivityIndicator color="#a3e635" size="small" />
              ) : (
                <Text style={styles.score}>{item.overallScore}</Text>
              )}
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
              <ActivityIndicator color="#a3e635" />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.cardTitle}>No analyses yet</Text>
              <Text style={styles.metaText}>
                Upload a swing from the Upload screen.
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, gap: 12 },
  eyebrow: {
    color: "#a3e635",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  screenTitle: {
    color: "#f8fafc",
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginTop: 4,
  },
  statRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  statLabel: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  statLabelGold: { color: "#f59e0b" },
  statValue: {
    color: "#f8fafc",
    fontSize: 24,
    fontWeight: "800",
  },
  statValueAccent: { color: "#a3e635" },
  statValueGold: { color: "#f59e0b" },
  listLabel: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    marginTop: 24,
    marginBottom: 4,
  },
  listCard: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 16,
    padding: 16,
    gap: 6,
    marginBottom: 12,
  },
  listCardPressed: { opacity: 0.85 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { color: "#f8fafc", fontSize: 16, fontWeight: "600", flex: 1 },
  score: { color: "#a3e635", fontWeight: "800", fontSize: 22 },
  metaText: { color: "#94a3b8", fontSize: 13 },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
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
  emptyState: { paddingVertical: 36, alignItems: "center", gap: 8 },
});
