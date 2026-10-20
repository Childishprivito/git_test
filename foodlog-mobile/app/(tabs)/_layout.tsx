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
        name="coach"
        options={{ title: 'Coach', tabBarIcon: icon({ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }) }}
      />
      <Tabs.Screen
        name="workout"
        options={{ title: 'Workout', tabBarIcon: icon({ ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' }) }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: icon({ ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' }) }}
      />
    </Tabs>
  );
}
