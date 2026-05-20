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
        <ActivityIndicator color="#a3e635" />
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
  screen: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  slotRow: { flexDirection: "row", gap: 10 },
  slot: {
    flex: 1,
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  slotLabel: { color: "#94a3b8", fontSize: 12, fontWeight: "600" },
  slotValue: { color: "#f8fafc", fontSize: 13 },
  slotScore: { color: "#a3e635", fontSize: 22, fontWeight: "800" },
  toggleRow: { flexDirection: "row", gap: 8 },
  toggle: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 10,
    alignItems: "center",
  },
  toggleActive: { borderColor: "#a3e635", backgroundColor: "#a3e63522" },
  toggleText: { color: "#94a3b8", fontWeight: "600" },
  toggleTextActive: { color: "#d9f99d" },
  listCard: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  listCardSelected: { borderColor: "#a3e635" },
  listCardPressed: { opacity: 0.85 },
  cardTitle: { color: "#f8fafc", fontSize: 15, fontWeight: "600" },
  metaText: { color: "#94a3b8", fontSize: 13 },
  phaseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#334155",
  },
  phaseTitle: {
    flex: 1,
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  delta: { fontSize: 18, fontWeight: "800", minWidth: 48, textAlign: "right" },
  deltaPositive: { color: "#a3e635" },
  deltaNegative: { color: "#f87171" },
});
