import { useCallback, useEffect, useRef, useState } from "react";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Video, ResizeMode } from "expo-av";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  createMobileAnalysisJob,
  uploadVideoAsset,
} from "../lib/api";
import type { RootStackParamList } from "../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Record">;

type Stage = "idle" | "countdown" | "recording" | "preview" | "uploading";

const MAX_RECORD_SECONDS = 30;
const COUNTDOWN_START = 3;

function formatTimer(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export default function RecordScreen({ navigation }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingActiveRef = useRef(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [stage, setStage] = useState<Stage>("idle");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { width, height } = Dimensions.get("window");
  const isPortrait = height >= width;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      if (recordingActiveRef.current) {
        cameraRef.current?.stopRecording();
      }
    };
  }, [clearTimer]);

  const ensurePermissions = async () => {
    let cam = cameraPermission;
    if (!cam?.granted) {
      cam = await requestCameraPermission();
    }
    if (!cam.granted) {
      throw new Error("Camera access denied. Enable Camera in Settings.");
    }

    let mic = micPermission;
    if (!mic?.granted) {
      mic = await requestMicPermission();
    }
    if (!mic.granted) {
      throw new Error("Microphone access denied. Enable Microphone in Settings.");
    }
  };

  const runCountdown = async () => {
    for (let n = COUNTDOWN_START; n >= 1; n--) {
      setCountdown(n);
      await sleep(1000);
    }
    setCountdown(null);
  };

  const startRecording = async () => {
    setError(null);
    try {
      await ensurePermissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Permission required.");
      return;
    }

    setStage("countdown");
    await runCountdown();

    setStage("recording");
    setElapsed(0);
    recordingActiveRef.current = true;

    clearTimer();
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      const video = await cameraRef.current?.recordAsync({
        maxDuration: MAX_RECORD_SECONDS,
      });
      if (video?.uri) {
        setClipUri(video.uri);
        setStage("preview");
      } else {
        setStage("idle");
        setError("Recording failed. Try again.");
      }
    } catch (err) {
      setStage("idle");
      setError(err instanceof Error ? err.message : "Recording failed.");
    } finally {
      recordingActiveRef.current = false;
      clearTimer();
    }
  };

  const stopRecordingEarly = () => {
    if (stage !== "recording") return;
    cameraRef.current?.stopRecording();
  };

  const retake = () => {
    setClipUri(null);
    setElapsed(0);
    setError(null);
    setStage("idle");
  };

  const useClip = async () => {
    if (!clipUri) return;
    setStage("uploading");
    setError(null);
    try {
      const uploaded = await uploadVideoAsset({
        uri: clipUri,
        name: `swing-${Date.now()}.mp4`,
        mimeType: "video/mp4",
      });
      const job = await createMobileAnalysisJob(uploaded);
      navigation.replace("JobStatus", { jobId: job.id });
    } catch (err) {
      setStage("preview");
      setError(
        err instanceof Error ? err.message : "Could not upload recording."
      );
    }
  };

  if (!cameraPermission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#a3e635" />
      </View>
    );
  }

  if (!cameraPermission.granted && stage === "idle") {
    return (
      <View style={styles.centered}>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionBody}>
          Record side-view swing clips directly in the app for analysis.
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable
          onPress={async () => {
            try {
              await ensurePermissions();
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Permission required."
              );
            }
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  if (stage === "preview" || stage === "uploading") {
    return (
      <View style={styles.screen}>
        <Video
          source={{ uri: clipUri! }}
          style={styles.previewVideo}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
          isLooping
        />
        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
        <View style={styles.previewActions}>
          <Pressable
            onPress={retake}
            disabled={stage === "uploading"}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              stage === "uploading" && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Retake</Text>
          </Pressable>
          <Pressable
            onPress={useClip}
            disabled={stage === "uploading"}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              stage === "uploading" && styles.buttonDisabled,
            ]}
          >
            {stage === "uploading" ? (
              <ActivityIndicator color="#0f172a" />
            ) : (
              <Text style={styles.primaryButtonText}>Use this clip</Text>
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.cameraWrap}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="video"
          videoQuality="1080p"
        />

        <View style={styles.overlay} pointerEvents="none">
          {isPortrait ? (
            <View style={styles.landscapeHint}>
              <Text style={styles.landscapeHintText}>
                Rotate to landscape for best side-view framing
              </Text>
            </View>
          ) : null}

          <View style={styles.hintChip}>
            <Text style={styles.hintChipText}>
              Stand to the side of the player — keep full body in frame
            </Text>
          </View>

          <View style={styles.guideLine} />

          {stage === "countdown" && countdown !== null ? (
            <View style={styles.countdownWrap}>
              <Text style={styles.countdownText}>{countdown}</Text>
            </View>
          ) : null}

          {stage === "recording" ? (
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>
                {formatTimer(elapsed)} / {formatTimer(MAX_RECORD_SECONDS)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <View style={styles.controls}>
        {stage === "recording" ? (
          <Pressable
            onPress={stopRecordingEarly}
            style={({ pressed }) => [
              styles.stopButton,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.stopButtonText}>Stop</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={startRecording}
            disabled={stage === "countdown"}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              stage === "countdown" && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {stage === "countdown" ? "Get ready..." : "Start recording"}
            </Text>
          </Pressable>
        )}
        <Text style={styles.capHint}>Max {MAX_RECORD_SECONDS}s per clip</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  centered: {
    flex: 1,
    backgroundColor: "#0f172a",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 16,
  },
  cameraWrap: {
    flex: 1,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 16,
  },
  landscapeHint: {
    alignSelf: "center",
    backgroundColor: "rgba(245, 158, 11, 0.9)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  landscapeHintText: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  hintChip: {
    alignSelf: "center",
    marginTop: 8,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(163, 230, 53, 0.4)",
  },
  hintChipText: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  guideLine: {
    position: "absolute",
    left: "50%",
    top: "12%",
    bottom: "12%",
    width: 2,
    marginLeft: -1,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "rgba(163, 230, 53, 0.55)",
  },
  countdownWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  countdownText: {
    color: "#a3e635",
    fontSize: 96,
    fontWeight: "800",
  },
  recordingBadge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(220, 38, 38, 0.85)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginBottom: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#fff",
  },
  recordingText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  controls: {
    padding: 16,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  capHint: {
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#475569",
  },
  secondaryButtonText: {
    color: "#f8fafc",
    fontWeight: "600",
    fontSize: 16,
  },
  stopButton: {
    backgroundColor: "#dc2626",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  stopButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  previewVideo: {
    flex: 1,
    backgroundColor: "#000",
  },
  previewActions: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  permissionTitle: {
    color: "#f8fafc",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  permissionBody: {
    color: "#94a3b8",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    textAlign: "center",
  },
  errorBanner: {
    color: "#fca5a5",
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
    textAlign: "center",
  },
  buttonPressed: { opacity: 0.92 },
  buttonDisabled: { opacity: 0.65 },
});
