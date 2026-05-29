/**
 * Arena Royale entry menu: set a display name, then play offline vs bots,
 * create an online battle (gets a shareable room code), or join one by code.
 */

import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { createGameSession, checkGameSession } from "../../lib/api";
import type { RootStackParamList } from "../../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "GameMenu">;

export default function GameMenuScreen({ navigation }: Props) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = name.trim() || "Player";

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code: newCode } = await createGameSession();
      navigation.navigate("OnlineGame", { code: newCode, name: displayName });
    } catch {
      setError("Couldn't create a battle. Is the server reachable?");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    setBusy(true);
    setError(null);
    try {
      const check = await checkGameSession(clean);
      if (!check.exists) {
        setError("No battle found with that code.");
      } else if (!check.joinable) {
        setError(
          check.reason === "full"
            ? "That battle is full (max 4)."
            : "That battle has already started.",
        );
      } else {
        navigation.navigate("OnlineGame", { code: clean, name: displayName });
      }
    } catch {
      setError("Couldn't reach the server to check that code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Arena Royale</Text>
      <Text style={styles.subtitle}>
        Last fighter standing. Drop in, dodge the storm, blast your friends.
      </Text>

      <Text style={styles.label}>Your name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Player"
        placeholderTextColor="#64748b"
        maxLength={16}
        style={styles.input}
      />

      <Pressable
        style={styles.botButton}
        onPress={() => navigation.navigate("LocalGame")}
      >
        <Text style={styles.botButtonText}>Play vs bots (offline)</Text>
      </Pressable>

      <View style={styles.divider} />

      <Pressable
        style={[styles.primaryButton, busy && styles.buttonDisabled]}
        onPress={create}
        disabled={busy}
      >
        <Text style={styles.primaryButtonText}>Create online battle</Text>
      </Pressable>

      <Text style={styles.label}>Join with a code</Text>
      <View style={styles.joinRow}>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="ABCD"
          placeholderTextColor="#64748b"
          autoCapitalize="characters"
          maxLength={6}
          style={[styles.input, styles.codeInput]}
        />
        <Pressable
          style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          onPress={join}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>Join</Text>
        </Pressable>
      </View>

      {busy ? <ActivityIndicator color="#a3e635" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b1120", padding: 24, gap: 12 },
  title: { color: "#a3e635", fontSize: 34, fontWeight: "900" },
  subtitle: { color: "#94a3b8", fontSize: 15, lineHeight: 21 },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 8,
  },
  input: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    color: "#f8fafc",
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  codeInput: { flex: 1, letterSpacing: 4, fontWeight: "700" },
  joinRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  divider: { height: 1, backgroundColor: "#1e293b", marginVertical: 8 },
  botButton: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#a3e635",
    marginTop: 8,
  },
  botButtonText: { color: "#a3e635", fontWeight: "700", fontSize: 16 },
  primaryButton: {
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#0b1120", fontWeight: "800", fontSize: 16 },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#475569",
  },
  secondaryButtonText: { color: "#f8fafc", fontWeight: "600", fontSize: 16 },
  buttonDisabled: { opacity: 0.5 },
  error: { color: "#fca5a5", fontSize: 14 },
});
