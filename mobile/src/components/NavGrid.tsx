import type { NavigationProp } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RootStackParamList } from "../lib/navigation";
import { theme, radius } from "../lib/theme";

type NavTarget = {
  label: string;
  description: string;
  onPress: (navigation: NavigationProp<RootStackParamList>) => void;
};

const NAV_ITEMS: NavTarget[] = [
  {
    label: "Upload",
    description: "New swing video",
    onPress: (navigation) => navigation.navigate("Upload"),
  },
  {
    label: "History",
    description: "All sessions",
    onPress: (navigation) => navigation.navigate("History"),
  },
  {
    label: "Compare",
    description: "Side-by-side",
    onPress: (navigation) => navigation.navigate("Compare"),
  },
  {
    label: "Pro",
    description: "Pro benchmarks",
    onPress: (navigation) => navigation.navigate("ProCompare"),
  },
  {
    label: "Privacy",
    description: "Data policy",
    onPress: (navigation) => navigation.navigate("Privacy"),
  },
  {
    label: "Account",
    description: "Sign in",
    onPress: (navigation) => navigation.navigate("Login"),
  },
];

type Props = {
  navigation: NavigationProp<RootStackParamList>;
};

export default function NavGrid({ navigation }: Props) {
  return (
    <View style={styles.grid}>
      {NAV_ITEMS.map((item) => (
        <Pressable
          key={item.label}
          onPress={() => item.onPress(navigation)}
          style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
        >
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.description}>{item.description}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    width: "48%",
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 14,
    gap: 4,
  },
  tilePressed: {
    opacity: 0.85,
  },
  label: {
    color: theme.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  description: {
    color: theme.ink2,
    fontSize: 12,
  },
});
