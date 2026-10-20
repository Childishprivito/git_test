import Constants from 'expo-constants';
import { DarkTheme, DefaultTheme, ErrorBoundary as RouterErrorBoundary, type ErrorBoundaryProps, Stack, ThemeProvider } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/ui';
import { info, installGlobalLogging, loadLog, error as logError } from '@/lib/log';
import { StoreProvider, useStore } from '@/lib/store';

// Start logging before anything else can go wrong.
installGlobalLogging();
loadLog().then(() =>
  info('app', 'App started', {
    version: Constants.expoConfig?.version,
    runtime: Constants.executionEnvironment,
    update: Updates.updateId ?? 'embedded',
    channel: Updates.channel ?? null,
    os: Constants.platform?.ios ? 'ios' : undefined,
  }),
);

/** Shown when a screen crashes; also records the crash in the log. */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  useEffect(() => {
    logError('crash', 'A screen crashed', props.error);
  }, [props.error]);
  return <RouterErrorBoundary {...props} />;
}

export const unstable_settings = { anchor: '(tabs)' };

function Toast() {
  const { toast } = useStore();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 70, alignItems: 'center' }}>
      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{ backgroundColor: t.text, color: t.bg, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 99, overflow: 'hidden', fontSize: 16 }}>
        {toast}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="add" options={{ title: 'Add food', headerBackTitle: 'Diary' }} />
            <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal', headerShown: false }} />
            <Stack.Screen name="amount" options={{ presentation: 'modal', title: 'How much?' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Profile' }} />
            <Stack.Screen name="logs" options={{ title: 'Logs' }} />
            <Stack.Screen name="session" options={{ title: 'Workout' }} />
          </Stack>
          <Toast />
        </ThemeProvider>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
