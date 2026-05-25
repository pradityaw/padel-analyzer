import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import SectionCard from "../components/SectionCard";
import { getSession, logout, requestMagicLink } from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;

export default function LoginScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: getSession,
  });

  const session = sessionQuery.data;
  const authOff = session?.authMode === "off";
  const signedIn = Boolean(session?.user);

  const handleRequestLink = async () => {
    setBanner(null);
    setSubmitting(true);
    try {
      const result = await requestMagicLink(email.trim());
      setBanner(
        result.devMagicLinkUrl
          ? `Dev link (open in browser on your Mac): ${result.devMagicLinkUrl}`
          : "If email is configured, check your inbox for a sign-in link."
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setSubmitting(true);
    try {
      await logout();
      await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
      await queryClient.invalidateQueries({ queryKey: ["mobile-analyses"] });
      setBanner("Signed out.");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "Logout failed.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sessionQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#a3e635" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionCard title="Account" subtitle="Magic-link sign-in when auth is enabled">
        {authOff ? (
          <Text style={styles.body}>
            Authentication is disabled on this server (AUTH_MODE=off). All
            sessions are available without signing in.
          </Text>
        ) : signedIn ? (
          <View style={styles.stack}>
            <Text style={styles.body}>Signed in as {session?.user?.email}</Text>
            <Pressable
              onPress={handleLogout}
              disabled={submitting}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.secondaryButtonText}>Sign out</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.stack}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com"
              placeholderTextColor="#64748b"
              style={styles.input}
            />
            <Pressable
              onPress={handleRequestLink}
              disabled={submitting || !email.trim()}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.buttonPressed,
                (submitting || !email.trim()) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {submitting ? "Sending..." : "Send magic link"}
              </Text>
            </Pressable>
          </View>
        )}

        {banner ? <Text style={styles.banner}>{banner}</Text> : null}

        <Pressable
          onPress={() => navigation.navigate("Home")}
          style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.linkText}>Back to home</Text>
        </Pressable>
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16 },
  centered: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  stack: { gap: 12 },
  body: { color: "#cbd5e1", fontSize: 14, lineHeight: 20 },
  label: { color: "#94a3b8", fontSize: 12, fontWeight: "600" },
  input: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f8fafc",
    fontSize: 16,
  },
  banner: { color: "#fbbf24", fontSize: 13, lineHeight: 18 },
  primaryButton: {
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#0f172a", fontWeight: "700", fontSize: 16 },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: { color: "#e2e8f0", fontWeight: "600" },
  linkButton: { marginTop: 8, alignItems: "center" },
  linkText: { color: "#94a3b8", fontSize: 14 },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.65 },
});
