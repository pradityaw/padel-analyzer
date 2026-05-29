import { useCallback, useEffect, useState } from "react";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import CourtAlignmentOverlay from "../components/CourtAlignmentOverlay";
import {
  createDefaultCourtCorners,
  loadSavedCourtCorners,
  saveCourtCorners,
  type CourtCornersPayload,
} from "../lib/courtCorners";
import type { RootStackParamList } from "../lib/navigation";
import {
  RECORD_MODE_HINTS,
  RECORD_MODE_LABELS,
  RECORD_MODES,
  type RecordMode,
} from "../lib/recordMode";

type Props = NativeStackScreenProps<RootStackParamList, "Setup">;

const STEPS = ["mode", "framing", "align", "reminders"] as const;
type WizardStep = (typeof STEPS)[number];

const FRAMING_TIPS = [
  {
    tier: "GOOD",
    body: "Phone at chest height, 3–4 m to the side, full body visible.",
  },
  {
    tier: "BETTER",
    body: "Landscape orientation, player centered, minimal net obstruction.",
  },
  {
    tier: "OPTIMAL",
    body: "Stable mount or tripod, even lighting, glass walls in frame for court box.",
  },
] as const;

const REMINDERS = [
  "Find shade or avoid direct sun on the lens.",
  "Tap the player to focus before recording.",
  "Enable Low Power Mode off for consistent frame rate.",
] as const;

export default function SetupWizardScreen({ navigation }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const step: WizardStep = STEPS[stepIndex] ?? "mode";
  const [mode, setMode] = useState<RecordMode>("rally");
  const [corners, setCorners] = useState<CourtCornersPayload>(() =>
    createDefaultCourtCorners()
  );
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  useEffect(() => {
    void loadSavedCourtCorners().then((saved) => {
      if (saved) setCorners(saved);
    });
  }, []);

  const ensurePermissions = useCallback(async () => {
    let cam = cameraPermission;
    if (!cam?.granted) {
      cam = await requestCameraPermission();
    }
    if (!cam?.granted) {
      throw new Error("Camera access denied.");
    }
    let mic = micPermission;
    if (!mic?.granted) {
      mic = await requestMicPermission();
    }
    if (!mic?.granted) {
      throw new Error("Microphone access denied.");
    }
  }, [cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

  const goNext = async () => {
    if (step === "align") {
      const alignedCorners = {
        ...corners,
        previewWidth: previewSize.width || corners.previewWidth,
        previewHeight: previewSize.height || corners.previewHeight,
      };
      await saveCourtCorners(alignedCorners);
      setCorners(alignedCorners);
    }
    if (stepIndex >= STEPS.length - 1) {
      navigation.replace("Record", {
        mode,
        courtCorners: corners,
        alignedInWizard: true,
      });
      return;
    }
    if (STEPS[stepIndex + 1] === "align") {
      try {
        await ensurePermissions();
      } catch {
        return;
      }
    }
    setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    if (stepIndex === 0) {
      navigation.goBack();
      return;
    }
    setStepIndex((i) => i - 1);
  };

  const skipToRecord = () => {
    navigation.replace("Record", { mode });
  };

  if (step === "align") {
    return (
      <View style={styles.screen}>
        <View
          style={styles.cameraWrap}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setPreviewSize({ width, height });
          }}
        >
          <CameraView style={StyleSheet.absoluteFill} facing="back" mode="video" />
          {previewSize.width > 0 && previewSize.height > 0 ? (
            <CourtAlignmentOverlay
              width={previewSize.width}
              height={previewSize.height}
              corners={corners.corners}
              onChange={(next) =>
                setCorners((c) => ({ ...c, corners: next }))
              }
            />
          ) : null}
          <View style={styles.alignHint} pointerEvents="none">
            <Text style={styles.alignHintText}>
              Drag pink corners to match the court edges
            </Text>
          </View>
        </View>
        <View style={styles.footer}>
          <Pressable onPress={goBack} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
          <Pressable onPress={goNext} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.eyebrow}>
          Step {stepIndex + 1} of {STEPS.length}
        </Text>

        {step === "mode" ? (
          <>
            <Text style={styles.title}>Choose session type</Text>
            <Text style={styles.body}>
              Pick how you are recording — this tunes rally trimming on the server.
            </Text>
            {RECORD_MODES.map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[
                  styles.modeCard,
                  mode === m && styles.modeCardActive,
                ]}
              >
                <Text style={styles.modeTitle}>{RECORD_MODE_LABELS[m]}</Text>
                <Text style={styles.meta}>{RECORD_MODE_HINTS[m]}</Text>
              </Pressable>
            ))}
          </>
        ) : null}

        {step === "framing" ? (
          <>
            <Text style={styles.title}>Framing guidelines</Text>
            <Text style={styles.body}>
              Side-view clips give the best pose and phase scores.
            </Text>
            {FRAMING_TIPS.map((tip) => (
              <View key={tip.tier} style={styles.tipCard}>
                <Text style={styles.tipTier}>{tip.tier}</Text>
                <Text style={styles.meta}>{tip.body}</Text>
              </View>
            ))}
          </>
        ) : null}

        {step === "reminders" ? (
          <>
            <Text style={styles.title}>Before you record</Text>
            {REMINDERS.map((line) => (
              <View key={line} style={styles.tipCard}>
                <Text style={styles.meta}>{line}</Text>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={skipToRecord}>
          <Text style={styles.skipText}>Skip setup</Text>
        </Pressable>
        <View style={styles.footerRow}>
          <Pressable onPress={goBack} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
          <Pressable onPress={() => void goNext()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>
              {stepIndex >= STEPS.length - 1 ? "Open camera" : "Next"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  scroll: {
    padding: 16,
    gap: 12,
    paddingBottom: 120,
  },
  cameraWrap: {
    flex: 1,
    backgroundColor: "#000",
    overflow: "hidden",
  },
  alignHint: {
    position: "absolute",
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    padding: 10,
    borderRadius: 8,
  },
  alignHintText: {
    color: "#f8fafc",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  eyebrow: {
    color: "#a3e635",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "800",
  },
  body: {
    color: "#94a3b8",
    fontSize: 15,
    lineHeight: 22,
  },
  modeCard: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  modeCardActive: {
    borderColor: "#a3e635",
  },
  modeTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  meta: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  tipCard: {
    backgroundColor: "#1e293b",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  tipTier: {
    color: "#a3e635",
    fontSize: 12,
    fontWeight: "800",
  },
  footer: {
    padding: 16,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#334155",
  },
  footerRow: {
    flexDirection: "row",
    gap: 12,
  },
  skipText: {
    color: "#94a3b8",
    fontSize: 13,
    textAlign: "center",
  },
  primaryButton: {
    flex: 1,
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
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
});
