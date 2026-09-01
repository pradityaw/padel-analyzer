/* Hallmark · genre: modern-minimal (dark, data-led sports) · macrostructure: Stat-Led intake
 * design-system: design.md · designed-as-app · theme: studied-DNA "Court Flood"
 * React Native StyleSheet */
import { useCallback, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL, isUsingLocalhostBaseUrl } from "../lib/config";
import {
  createMobileAnalysisJob,
  uploadVideoAsset,
  type UploadVideoInput,
} from "../lib/api";
import {
  pickSwingVideoFromFiles,
  pickSwingVideoFromPhotos,
} from "../lib/swingVideoPickers";
import type { RootStackParamList } from "../lib/navigation";
import { loadLastRecordMode } from "../lib/recordMode";
import { theme, radius } from "../lib/theme";

type Props = NativeStackScreenProps<RootStackParamList, "Upload">;

const STEPS = [
  {
    n: "1",
    title: "Pick a side-view clip",
    body: "Film the swing from the side so the contact point is visible.",
  },
  {
    n: "2",
    title: "We analyze on the server",
    body: "Pose + swing phases are extracted — no on-device processing.",
  },
  {
    n: "3",
    title: "Review your score",
    body: "Phase breakdown and skeleton replay land in your sessions.",
  },
] as const;

export default function UploadScreen({ navigation }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runUpload = useCallback(
    async (input: UploadVideoInput) => {
      setUploading(true);
      setError(null);
      try {
        const uploaded = await uploadVideoAsset(input);
        const mode = await loadLastRecordMode();
        const job = await createMobileAnalysisJob({ ...uploaded, mode });
        navigation.replace("JobStatus", { jobId: job.id });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not start analysis."
        );
      } finally {
        setUploading(false);
      }
    },
    [navigation]
  );

  const handlePickFromPhotos = async () => {
    try {
      const input = await pickSwingVideoFromPhotos();
      if (!input) return;
      await runUpload(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Photos.");
    }
  };

  const handlePickFromFiles = async () => {
    try {
      const input = await pickSwingVideoFromFiles();
      if (!input) return;
      await runUpload(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open Files.");
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View>
        <Text style={styles.eyebrow}>ANALYZE</Text>
        <Text style={styles.screenTitle}>Upload a swing</Text>
        <Text style={styles.lede}>
          Pick a clip from Photos or browse Files. Analysis runs on the server.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>HOW IT WORKS</Text>
      <View style={styles.stepRail}>
        {STEPS.map((step) => (
          <View key={step.n} style={styles.stepRow}>
            <View style={styles.stepNumber}>
              <Text style={styles.stepNumberText}>{step.n}</Text>
            </View>
            <View style={styles.stepText}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepBody}>{step.body}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.actionCard}>
        <View style={styles.actionHeader}>
          <Text style={styles.actionTitle}>Choose your clip</Text>
          {uploading ? <ActivityIndicator color={theme.accent} /> : null}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.buttonStack}>
          <Pressable
            onPress={handlePickFromPhotos}
            disabled={uploading}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && !uploading ? styles.buttonPressed : null,
              uploading ? styles.buttonDisabled : null,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {uploading ? "Uploading…" : "Pick from Photos"}
            </Text>
          </Pressable>
          <Pressable
            onPress={handlePickFromFiles}
            disabled={uploading}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && !uploading ? styles.buttonPressed : null,
              uploading ? styles.buttonDisabled : null,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Browse Files</Text>
          </Pressable>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>API</Text>
          <Text style={styles.metaValue} numberOfLines={1}>
            {API_BASE_URL}
          </Text>
        </View>
        {isUsingLocalhostBaseUrl() ? (
          <Text style={styles.warningText}>
            Using localhost. Physical devices need your machine IP in
            EXPO_PUBLIC_API_BASE_URL.
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.paper },
  content: { padding: 16, gap: 16 },
  eyebrow: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  screenTitle: {
    color: theme.ink,
    fontSize: 26,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 4,
  },
  lede: {
    color: theme.ink2,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  sectionLabel: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 4,
  },
  stepRail: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 16,
    gap: 16,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: theme.white10,
    borderWidth: 1,
    borderColor: theme.white15,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: "800",
  },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { color: theme.ink, fontSize: 15, fontWeight: "600" },
  stepBody: { color: theme.ink2, fontSize: 13, lineHeight: 18 },
  actionCard: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.rule,
    borderRadius: radius.card,
    padding: 16,
    gap: 14,
  },
  actionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  actionTitle: { color: theme.ink, fontSize: 17, fontWeight: "700" },
  buttonStack: { gap: 10 },
  primaryButton: {
    backgroundColor: theme.cta,
    borderRadius: radius.pill,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonText: { color: theme.ctaInk, fontWeight: "700", fontSize: 16 },
  secondaryButton: {
    backgroundColor: theme.white10,
    borderRadius: radius.pill,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.white15,
  },
  secondaryButtonText: { color: theme.ink, fontWeight: "600", fontSize: 16 },
  buttonPressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.65 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.rule,
  },
  metaLabel: {
    color: theme.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  metaValue: { color: theme.ink2, fontSize: 13, flex: 1 },
  warningText: { color: theme.sand, fontSize: 13, lineHeight: 18 },
  errorText: { color: theme.danger, fontSize: 13, lineHeight: 18 },
});
