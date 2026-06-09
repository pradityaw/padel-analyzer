import { StyleSheet, Text } from "react-native";
import { recordModeLabel } from "../lib/recordMode";
import { theme, radius } from "../lib/theme";

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
    backgroundColor: theme.white10,
    color: theme.ink2,
    borderWidth: 1,
    borderColor: theme.white15,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "600",
  },
});
