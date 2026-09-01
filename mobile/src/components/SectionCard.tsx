import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { theme, radius } from "../lib/theme";

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
  right?: ReactNode;
}>;

export default function SectionCard({
  title,
  subtitle,
  right,
  children,
}: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: theme.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: theme.ink2,
    fontSize: 13,
  },
});
