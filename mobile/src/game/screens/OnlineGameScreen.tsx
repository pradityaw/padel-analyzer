/**
 * Online battle screen: one persistent WebSocket session that walks through
 * lobby → countdown → live match → results. Reuses the shared ArenaCanvas and
 * touch controls; lobby hosting shows the room code plus a share/invite action
 * (deep link) so friends can join.
 */

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  MIN_PLAYERS,
  PLAYER_COLORS,
} from "../../../../shared/game/sim/constants";
import ArenaCanvas from "../render/ArenaCanvas";
import Joystick from "../controls/Joystick";
import AttackButton from "../controls/AttackButton";
import { useOnlineMatch } from "../net/useOnlineMatch";
import type { RootStackParamList } from "../../lib/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "OnlineGame">;

function randomGuestName(): string {
  return `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function OnlineGameScreen({ route, navigation }: Props) {
  const code = route.params.code;
  const name = useMemo(() => route.params.name || randomGuestName(), [route.params.name]);
  const match = useOnlineMatch(code, name);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const invite = async () => {
    const url = Linking.createURL(`/join/${code}`);
    await Share.share({
      message: `Join my Arena Royale battle! Room code: ${code}\n${url}`,
    });
  };

  if (match.status === "connecting") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#a3e635" />
        <Text style={styles.meta}>Connecting to room {code}…</Text>
      </View>
    );
  }

  if (match.status === "error") {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Couldn't join</Text>
        <Text style={styles.meta}>{match.error}</Text>
        <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (match.status === "lobby") {
    const canStart = match.isHost && match.lobby.length >= MIN_PLAYERS;
    return (
      <View style={styles.lobby}>
        <Text style={styles.eyebrow}>Room code</Text>
        <Text style={styles.code}>{code}</Text>
        <Pressable style={styles.primaryButton} onPress={invite}>
          <Text style={styles.primaryButtonText}>Invite friends</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Players ({match.lobby.length}/4)</Text>
        {match.lobby.map((p) => (
          <View key={p.id} style={styles.playerRow}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length] },
              ]}
            />
            <Text style={styles.playerName}>{p.name}</Text>
            {p.id === match.hostId ? <Text style={styles.hostTag}>HOST</Text> : null}
            {p.id === match.selfId ? <Text style={styles.youTag}>YOU</Text> : null}
          </View>
        ))}

        {match.isHost ? (
          <Pressable
            style={[styles.primaryButton, !canStart && styles.buttonDisabled]}
            disabled={!canStart}
            onPress={match.start}
          >
            <Text style={styles.primaryButtonText}>
              {canStart ? "Start battle" : `Waiting for ${MIN_PLAYERS}+ players`}
            </Text>
          </Pressable>
        ) : (
          <Text style={styles.meta}>Waiting for the host to start…</Text>
        )}

        <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Leave</Text>
        </Pressable>
      </View>
    );
  }

  // countdown / playing / over → arena view
  return (
    <View style={styles.screen}>
      <View style={styles.arena} onLayout={onLayout}>
        {match.render && size.width > 0 ? (
          <ArenaCanvas state={match.render} width={size.width} height={size.height} />
        ) : null}

        {match.status === "playing" ? (
          <View style={styles.controls} pointerEvents="box-none">
            <Joystick moveX={match.moveX} moveY={match.moveY} />
            <AttackButton fireRef={match.fireRef} />
          </View>
        ) : null}

        {match.status === "countdown" ? (
          <View style={styles.overlay}>
            <Text style={styles.countdown}>{match.countdownSeconds}</Text>
            <Text style={styles.meta}>Get ready…</Text>
          </View>
        ) : null}

        {match.status === "over" ? (
          <View style={styles.overlay}>
            <Text style={styles.overlayTitle}>
              {match.winnerId === match.selfId
                ? "You win! 🎉"
                : `${match.results?.find((r) => r.id === match.winnerId)?.name ?? "Nobody"} wins`}
            </Text>
            {match.results?.map((r) => (
              <Text key={r.id} style={styles.resultRow}>
                {r.placement}. {r.name} — {r.kills} KO
              </Text>
            ))}
            <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
              <Text style={styles.secondaryButtonText}>Back to menu</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0b1120" },
  arena: { flex: 1, overflow: "hidden" },
  centered: {
    flex: 1,
    backgroundColor: "#0b1120",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  lobby: { flex: 1, backgroundColor: "#0b1120", padding: 24, gap: 12 },
  eyebrow: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  code: {
    color: "#a3e635",
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: 8,
  },
  sectionTitle: { color: "#f8fafc", fontSize: 18, fontWeight: "700", marginTop: 8 },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  playerName: { color: "#f8fafc", fontSize: 16, fontWeight: "600", flex: 1 },
  hostTag: { color: "#a3e635", fontSize: 11, fontWeight: "800" },
  youTag: { color: "#38bdf8", fontSize: 11, fontWeight: "800" },
  title: { color: "#f8fafc", fontSize: 24, fontWeight: "800" },
  meta: { color: "#94a3b8", fontSize: 14, textAlign: "center" },
  controls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 28,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0b1120cc",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  overlayTitle: { color: "#f8fafc", fontSize: 30, fontWeight: "800" },
  countdown: { color: "#a3e635", fontSize: 88, fontWeight: "900" },
  resultRow: { color: "#cbd5e1", fontSize: 16 },
  primaryButton: {
    backgroundColor: "#a3e635",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: { color: "#0b1120", fontWeight: "800", fontSize: 16 },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#475569",
    marginTop: 4,
  },
  secondaryButtonText: { color: "#f8fafc", fontWeight: "600", fontSize: 15 },
  buttonDisabled: { opacity: 0.5 },
});
