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
import SectionCard from "../components/SectionCard";
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

type Props = NativeStackScreenProps<RootStackParamList, "Upload">;

export default function UploadScreen({ navigation }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runUpload = useCallback(
    async (input: UploadVideoInput) => {
      setUploading(true);
      setError(null);
      try {
        const uploaded = await uploadVideoAsset(input);
        const job = await createMobileAnalysisJob(uploaded);
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
      <SectionCard
        title="Upload swing"
        subtitle="Pick a clip from Photos or browse Files. Analysis runs on the server."
        right={uploading ? <ActivityIndicator color="#a3e635" /> : undefined}
      >
        <Text style={styles.bodyText}>API: {API_BASE_URL}</Text>
        {isUsingLocalhostBaseUrl() ? (
          <Text style={styles.warningText}>
            Using localhost. Physical devices need your machine IP in
            EXPO_PUBLIC_API_BASE_URL.
          </Text>
        ) : null}
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
              {uploading ? "Uploading..." : "Pick from Photos"}
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
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, gap: 12 },
  bodyText: { color: "#cbd5e1", fontSize: 13 },
  warningText: { color: "#fbbf24", fontSize: 13, lineHeight: 18 },
  errorText: { color: "#fca5a5", fontSize: 13, lineHeight: 18 },
  buttonStack: { gap: 10 },
  primaryButton: {
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#0f172a", fontWeight: "700", fontSize: 16 },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#475569",
  },
  secondaryButtonText: { color: "#f8fafc", fontWeight: "600", fontSize: 16 },
  buttonPressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.65 },
});
