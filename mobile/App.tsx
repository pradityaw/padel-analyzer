import "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import HomeScreen from "./src/screens/HomeScreen";
import UploadScreen from "./src/screens/UploadScreen";
import RecordScreen from "./src/screens/RecordScreen";
import SetupWizardScreen from "./src/screens/SetupWizardScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import CompareScreen from "./src/screens/CompareScreen";
import ProCompareScreen from "./src/screens/ProCompareScreen";
import PrivacyScreen from "./src/screens/PrivacyScreen";
import LoginScreen from "./src/screens/LoginScreen";
import JobStatusScreen from "./src/screens/JobStatusScreen";
import AnalysisScreen from "./src/screens/AnalysisScreen";
import type { RootStackParamList } from "./src/lib/navigation";

if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  void import("@sentry/react-native")
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
        enabled: !__DEV__,
      });
    })
    .catch(() => {
      /* optional dependency */
    });
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const queryClient = new QueryClient();

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#a3e635",
    background: "#0f172a",
    card: "#1e293b",
    text: "#f8fafc",
    border: "#334155",
    notification: "#f59e0b",
  },
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <NavigationContainer theme={theme}>
            <StatusBar style="light" />
            <Stack.Navigator
              screenOptions={{
                headerStyle: { backgroundColor: "#0f172a" },
                headerTintColor: "#f8fafc",
                contentStyle: { backgroundColor: "#0f172a" },
              }}
            >
              <Stack.Screen
                name="Home"
                component={HomeScreen}
                options={{ title: "Padel Analyzer" }}
              />
              <Stack.Screen
                name="Upload"
                component={UploadScreen}
                options={{ title: "Upload" }}
              />
              <Stack.Screen
                name="Setup"
                component={SetupWizardScreen}
                options={{ title: "Record setup" }}
              />
              <Stack.Screen
                name="Record"
                component={RecordScreen}
                options={{ title: "Record swing" }}
              />
              <Stack.Screen
                name="History"
                component={HistoryScreen}
                options={{ title: "History" }}
              />
              <Stack.Screen
                name="Compare"
                component={CompareScreen}
                options={{ title: "Compare" }}
              />
              <Stack.Screen
                name="ProCompare"
                component={ProCompareScreen}
                options={{ title: "Pro Compare" }}
              />
              <Stack.Screen
                name="Privacy"
                component={PrivacyScreen}
                options={{ title: "Privacy" }}
              />
              <Stack.Screen
                name="Login"
                component={LoginScreen}
                options={{ title: "Account" }}
              />
              <Stack.Screen
                name="JobStatus"
                component={JobStatusScreen}
                options={{ title: "Processing" }}
              />
              <Stack.Screen
                name="Analysis"
                component={AnalysisScreen}
                options={{ title: "Analysis" }}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
