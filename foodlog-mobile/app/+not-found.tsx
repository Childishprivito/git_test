import { Link, Stack } from 'expo-router';
import { View } from 'react-native';

import { T, useTheme } from '@/components/ui';

export default function NotFound() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <T bold size={20}>This screen doesn’t exist.</T>
      <Link href="/" style={{ marginTop: 15, paddingVertical: 15 }}>
        <T style={{ color: t.accent }}>Go to the diary</T>
      </Link>
    </View>
  );
}
