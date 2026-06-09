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
import { listProComparisons } from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";
import { theme, radius } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "ProCompare">;

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function ProCompareScreen({ navigation }: Props) {
  const query = useQuery({
    queryKey: ["pro-comparisons"],
    queryFn: listProComparisons,
  });

  return (
    <View style={styles.screen}>
      <FlatList
        data={query.data ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={theme.accent}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>Pro comparisons</Text>
            <Text style={styles.metaText}>
              Saved player vs pro gap analyses from the web app.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate("Analysis", {
                analysisId: item.playerAnalysisId,
              })
            }
            style={({ pressed }) => [
              styles.listCard,
              pressed && styles.listCardPressed,
            ]}
          >
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.playerFileName}
            </Text>
            <Text style={styles.metaText}>
              vs {item.proFileName ?? "benchmark"} • {item.shotType}
            </Text>
            <View style={styles.rowBetween}>
              <Text style={styles.score}>You {item.playerScore}</Text>
              {item.proScore != null ? (
                <Text style={styles.proScore}>Pro {item.proScore}</Text>
              ) : null}
            </View>
            <Text style={styles.metaText}>{formatDate(item.createdAt)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.cardTitle}>No pro comparisons yet</Text>
              <Text style={styles.metaText}>
                Create comparisons in the web app Pro Compare flow.
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
  header: { gap: 6, marginBottom: 12 },
  sectionTitle: {
    color: theme.ink,
    fontSize: 20,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  listCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 16,
    gap: 6,
    marginBottom: 12,
  },
  listCardPressed: { opacity: 0.85 },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: { color: theme.ink, fontSize: 16, fontWeight: "600" },
  score: {
    color: theme.accent,
    fontWeight: "700",
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  proScore: {
    color: theme.sand,
    fontWeight: "700",
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  metaText: { color: theme.ink2, fontSize: 13 },
  emptyState: { paddingVertical: 36, alignItems: "center", gap: 8 },
});
