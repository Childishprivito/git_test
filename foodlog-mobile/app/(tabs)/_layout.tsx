import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

import { useTheme } from '@/components/ui';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

function icon(name: SymbolName) {
  const TabIcon = ({ color }: { color: unknown }) => <SymbolView name={name} tintColor={String(color)} size={26} />;
  return TabIcon;
}

export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: t.accent, headerShown: false }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Diary', tabBarIcon: icon({ ios: 'book.fill', android: 'menu_book', web: 'menu_book' }) }}
      />
      <Tabs.Screen
        name="add"
        options={{ title: 'Add food', tabBarIcon: icon({ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }) }}
      />
      <Tabs.Screen
        name="workout"
        options={{ title: 'Workout', tabBarIcon: icon({ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }) }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: icon({ ios: 'gearshape.fill', android: 'settings', web: 'settings' }) }}
      />
    </Tabs>
  );
}
