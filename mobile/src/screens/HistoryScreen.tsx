/* Hallmark · genre: modern-minimal (dark, data-led sports) · macrostructure: Stat-Led
 * design-system: design.md · designed-as-app · theme: studied-DNA "Court Flood"
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
import { theme, radius } from "../lib/theme";

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
            tintColor={theme.accent}
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.eyebrow}>YOUR PROGRESS</Text>
            <Text style={styles.screenTitle}>Your sports schedule</Text>
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
        renderItem={({ item, index }) => {
          const featured = index === 0 && items.length > 0;
          return (
          <Pressable
            onPress={() => navigation.navigate("Analysis", { analysisId: item.id })}
            onLongPress={() => confirmDelete(item)}
            style={({ pressed }) => [
              featured ? styles.featuredCard : styles.listCard,
              pressed ? styles.listCardPressed : null,
            ]}
          >
            <View style={styles.rowBetween}>
              <Text
                style={featured ? styles.featuredTitle : styles.cardTitle}
                numberOfLines={1}
              >
                {item.videoFileName}
              </Text>
              {deletingId === item.id ? (
                <ActivityIndicator color={featured ? theme.ink : theme.accent} size="small" />
              ) : (
                <Text style={featured ? styles.featuredScore : styles.score}>
                  {item.overallScore}
                </Text>
              )}
            </View>
            <Text style={featured ? styles.featuredMeta : styles.metaText}>
              {formatDate(item.createdAt)}
            </Text>
            <Text style={featured ? styles.featuredMeta : styles.metaText}>
              {item.dominantSide}-handed • {item.frameCount} frames •{" "}
              {formatDuration(item.durationMs)}
            </Text>
            <View style={styles.badgeRow}>
              <RecordModeBadge mode={item.mode} />
              {item.shotType ? (
                <Text style={featured ? styles.featuredBadge : styles.badge}>
                  {item.shotType}
                </Text>
              ) : null}
            </View>
          </Pressable>
          );
        }}
        ListEmptyComponent={
          analysesQuery.isLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={theme.accent} />
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
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { padding: 16, gap: 12 },
  eyebrow: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  screenTitle: {
    color: theme.ink,
    fontSize: 26,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  // The one flood surface on this screen (KPI header card, per design.md)
  statRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    backgroundColor: theme.flood,
    borderRadius: radius.card,
    padding: 12,
  },
  statCard: {
    flex: 1,
    gap: 8,
  },
  statLabel: {
    color: theme.white70,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  statLabelGold: { color: theme.sand },
  statValue: {
    color: theme.ink,
    fontSize: 24,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  statValueAccent: { color: theme.ink },
  statValueGold: { color: theme.sand },
  listLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 4,
  },
  listCard: {
    backgroundColor: theme.cardPaper,
    borderRadius: radius.card,
    padding: 16,
    gap: 6,
    marginBottom: 12,
  },
  featuredCard: {
    backgroundColor: theme.flood,
    borderRadius: radius.card,
    padding: 20,
    gap: 6,
    marginBottom: 12,
  },
  featuredTitle: {
    color: theme.ink,
    fontSize: 17,
    fontWeight: "700",
    flex: 1,
  },
  featuredScore: {
    color: theme.ink,
    fontWeight: "800",
    fontSize: 32,
    fontVariant: ["tabular-nums"],
  },
  featuredMeta: { color: theme.white70, fontSize: 13 },
  featuredBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.white10,
    color: theme.ink,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
  listCardPressed: { opacity: 0.85 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { color: theme.cardPaperInk, fontSize: 16, fontWeight: "600", flex: 1 },
  score: {
    color: theme.flood,
    fontWeight: "800",
    fontSize: 22,
    fontVariant: ["tabular-nums"],
  },
  metaText: { color: theme.cardPaperMuted, fontSize: 13 },
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
  emptyState: { paddingVertical: 36, alignItems: "center", gap: 8 },
});
