import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { StoreProvider, useStore } from '@/lib/store';
import { useTheme } from '@/components/ui';

export { ErrorBoundary } from 'expo-router';

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
            <Stack.Screen name="session" options={{ title: 'Workout' }} />
          </Stack>
          <Toast />
        </ThemeProvider>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
