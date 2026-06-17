import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme, radius } from "../lib/theme";

type Props = {
  message: string;
  onRetry: () => void;
};

/** Error branch for list screens — distinguishes a failed fetch from an
 * empty result so network failures never masquerade as "no data yet". */
export default function QueryErrorState({ message, onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Couldn't load</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
        style={({ pressed }) => [
          styles.retryButton,
          pressed ? styles.retryButtonPressed : null,
        ]}
      >
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 36,
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: theme.ink,
    fontSize: 16,
    fontWeight: "600",
  },
  message: {
    color: theme.danger,
    fontSize: 13,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    borderRadius: radius.pill,
    backgroundColor: theme.cta,
    paddingVertical: 10,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryText: {
    color: theme.ctaInk,
    fontWeight: "700",
    fontSize: 14,
  },
});
