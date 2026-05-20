import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function PrivacyScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacy</Text>
      <Text style={styles.body}>
        Padel Analyzer processes videos you upload to extract pose landmarks and
        swing metrics. This page summarizes what is stored and how it is used.
      </Text>

      <View style={styles.section}>
        <Text style={styles.heading}>Data we hold</Text>
        <Text style={styles.bullet}>• Video files you upload, stored on the server.</Text>
        <Text style={styles.bullet}>
          • Derived pose sequences, phase scores, and optional shot classification.
        </Text>
        <Text style={styles.bullet}>
          • When authentication is enabled, your email and session identifiers.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Retention</Text>
        <Text style={styles.body}>
          Data stays on the server you connect to until you delete an analysis from
          History or an operator removes it.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Third parties</Text>
        <Text style={styles.body}>
          Hosted deployments may use error reporting (for example Sentry) if
          configured by the operator.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Contact</Text>
        <Text style={styles.body}>
          For privacy requests tied to a specific deployment, contact the operator
          of that instance.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  title: { color: "#f8fafc", fontSize: 24, fontWeight: "800" },
  heading: { color: "#f8fafc", fontSize: 17, fontWeight: "700" },
  body: { color: "#cbd5e1", fontSize: 14, lineHeight: 22 },
  bullet: { color: "#cbd5e1", fontSize: 14, lineHeight: 22, paddingLeft: 4 },
  section: { gap: 8 },
});
