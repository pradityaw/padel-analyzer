import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import SectionCard from "../components/SectionCard";
import { getAnalysisById, listRecentAnalyses } from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";
import type { AnalysisPhase } from "../lib/types";
import { theme, radius } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Compare">;

function parsePhases(raw?: string): AnalysisPhase[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function CompareScreen({ route }: Props) {
  const initialA = route.params?.analysisIdA ?? null;
  const initialB = route.params?.analysisIdB ?? null;
  const [selectedA, setSelectedA] = useState<number | null>(initialA);
  const [selectedB, setSelectedB] = useState<number | null>(initialB);
  const [pickingSlot, setPickingSlot] = useState<"A" | "B">("A");

  const listQuery = useQuery({
    queryKey: ["mobile-analyses", "compare"],
    queryFn: listRecentAnalyses,
  });

  const analysisAQuery = useQuery({
    queryKey: ["analysis", selectedA],
    queryFn: () => getAnalysisById(selectedA!),
    enabled: selectedA != null,
  });

  const analysisBQuery = useQuery({
    queryKey: ["analysis", selectedB],
    queryFn: () => getAnalysisById(selectedB!),
    enabled: selectedB != null,
  });

  const phasesA = useMemo(
    () => parsePhases(analysisAQuery.data?.phasesJson),
    [analysisAQuery.data?.phasesJson]
  );
  const phasesB = useMemo(
    () => parsePhases(analysisBQuery.data?.phasesJson),
    [analysisBQuery.data?.phasesJson]
  );

  const phaseDiffs = useMemo(() => {
    if (!phasesA.length || !phasesB.length) return [];
    return phasesA.map((phaseA) => {
      const phaseB = phasesB.find((p) => p.type === phaseA.type);
      if (!phaseB) return null;
      return {
        type: phaseA.type,
        delta: phaseA.score - phaseB.score,
        scoreA: phaseA.score,
        scoreB: phaseB.score,
      };
    }).filter(Boolean) as {
      type: string;
      delta: number;
      scoreA: number;
      scoreB: number;
    }[];
  }, [phasesA, phasesB]);

  const handleSelect = (id: number) => {
    if (pickingSlot === "A") {
      setSelectedA(id);
      setPickingSlot("B");
    } else {
      setSelectedB(id);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionCard
        title="Compare swings"
        subtitle={`Select swing ${pickingSlot}. Tap a session below.`}
      >
        <View style={styles.slotRow}>
          <View style={styles.slot}>
            <Text style={styles.slotLabel}>Swing A</Text>
            <Text style={styles.slotValue}>
              {analysisAQuery.data?.videoFileName ?? "—"}
            </Text>
            <Text style={styles.slotScore}>
              {analysisAQuery.data?.overallScore ?? "—"}
            </Text>
          </View>
          <View style={styles.slot}>
            <Text style={styles.slotLabel}>Swing B</Text>
            <Text style={styles.slotValue}>
              {analysisBQuery.data?.videoFileName ?? "—"}
            </Text>
            <Text style={styles.slotScore}>
              {analysisBQuery.data?.overallScore ?? "—"}
            </Text>
          </View>
        </View>
        <View style={styles.toggleRow}>
          {(["A", "B"] as const).map((slot) => (
            <Pressable
              key={slot}
              onPress={() => setPickingSlot(slot)}
              style={[
                styles.toggle,
                pickingSlot === slot && styles.toggleActive,
              ]}
            >
              <Text
                style={[
                  styles.toggleText,
                  pickingSlot === slot && styles.toggleTextActive,
                ]}
              >
                Pick {slot}
              </Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      {listQuery.isLoading ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        (listQuery.data?.items ?? []).map((item) => {
          const isSelected = item.id === selectedA || item.id === selectedB;
          return (
            <Pressable
              key={item.id}
              onPress={() => handleSelect(item.id)}
              style={({ pressed }) => [
                styles.listCard,
                isSelected && styles.listCardSelected,
                pressed && styles.listCardPressed,
              ]}
            >
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.videoFileName}
              </Text>
              <Text style={styles.metaText}>Score {item.overallScore}</Text>
            </Pressable>
          );
        })
      )}

      {selectedA != null && selectedB != null ? (
        <SectionCard title="Phase deltas" subtitle="A minus B per phase">
          {phaseDiffs.length === 0 ? (
            <Text style={styles.metaText}>No comparable phases.</Text>
          ) : (
            phaseDiffs.map((row) => (
              <View key={row.type} style={styles.phaseRow}>
                <Text style={styles.phaseTitle}>{row.type}</Text>
                <Text
                  style={[
                    styles.delta,
                    row.delta >= 0 ? styles.deltaPositive : styles.deltaNegative,
                  ]}
                >
                  {row.delta > 0 ? "+" : ""}
                  {row.delta}
                </Text>
                <Text style={styles.metaText}>
                  {row.scoreA} vs {row.scoreB}
                </Text>
              </View>
            ))
          )}
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  slotRow: { flexDirection: "row", gap: 10 },
  slot: {
    flex: 1,
    backgroundColor: theme.paper,
    borderRadius: radius.input,
    padding: 12,
    gap: 4,
  },
  slotLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  slotValue: { color: theme.ink, fontSize: 13 },
  slotScore: {
    color: theme.ink,
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  toggleRow: { flexDirection: "row", gap: 8 },
  toggle: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: theme.rule,
    paddingVertical: 10,
    alignItems: "center",
  },
  toggleActive: { borderColor: theme.accent, backgroundColor: theme.white10 },
  toggleText: { color: theme.ink2, fontWeight: "600" },
  toggleTextActive: { color: theme.accent },
  listCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 14,
    gap: 4,
  },
  listCardSelected: { borderColor: theme.accent },
  listCardPressed: { opacity: 0.85 },
  cardTitle: { color: theme.ink, fontSize: 15, fontWeight: "600" },
  metaText: { color: theme.ink2, fontSize: 13 },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.rule,
  },
  phaseTitle: {
    flex: 1,
    color: theme.ink,
    fontSize: 14,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  delta: {
    fontSize: 18,
    fontWeight: "800",
    minWidth: 48,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  deltaPositive: { color: theme.accent },
  deltaNegative: { color: theme.danger },
});
