import { StyleSheet, Text } from "react-native";
import { recordModeLabel } from "../lib/recordMode";

type Props = {
  mode: string | null | undefined;
};

export default function RecordModeBadge({ mode }: Props) {
  const label = recordModeLabel(mode);
  if (!label) return null;
  return <Text style={styles.badge}>{label}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    marginTop: 4,
    backgroundColor: "#334155",
    color: "#e2e8f0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
});
