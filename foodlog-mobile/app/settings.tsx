// Settings: goals, server (sync + AI), Apple Health.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Field, H, T, styles, useTheme } from '@/components/ui';
import { connectHealth, healthAvailable, healthEnabled, setHealthEnabled } from '@/lib/health';
import { Goals } from '@/lib/model';
import { loadConfig, saveConfig } from '@/lib/server';
import { useStore } from '@/lib/store';

export default function Settings() {
  const { db, update, syncStatus, syncNow, flash } = useStore();
  const t = useTheme();
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [health, setHealth] = useState(false);

  useEffect(() => {
    loadConfig().then((c) => {
      if (c) {
        setUrl(c.url);
        setPassword(c.password);
      }
    });
    healthEnabled().then(setHealth);
  }, []);

  const goal = (key: keyof Goals, label: string) => (
    <Field
      key={key}
      label={label}
      keyboardType="decimal-pad"
      defaultValue={String(Math.round(db.goals[key]))}
      onEndEditing={(e) => {
        const v = parseFloat(e.nativeEvent.text.replace(',', '.'));
        if (Number.isFinite(v) && v >= 0) update((d) => ({ ...d, goals: { ...d.goals, [key]: v }, goals_updated: Date.now() }));
      }}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <Card>
          <H>Apple Health</H>
          {healthAvailable() ? (
            <View style={styles.row}>
              <T style={{ flex: 1 }}>Send meals, workouts and weigh-ins to Apple Health, and show your activity, sleep and heart data</T>
              <Switch
                accessibilityLabel="Send to Apple Health"
                value={health}
                onValueChange={async (on) => {
                  if (on && !(await connectHealth())) return flash('Apple Health access was not granted');
                  await setHealthEnabled(on);
                  setHealth(on);
                }}
              />
            </View>
          ) : (
            <T small muted>
              Apple Health works in the installed app (a development or TestFlight build). It isn’t available in Expo Go or on the web.
            </T>
          )}
        </Card>

        <Card>
          <H>Daily goals</H>
          {goal('kcal', 'Calories (kcal)')}
          {goal('protein', 'Protein (g)')}
          {goal('carbs', 'Carbs (g)')}
          {goal('fat', 'Fat (g)')}
        </Card>

        <Card>
          <H>Sync & AI</H>
          <T small muted>Your FoodLog server syncs your log with the web app and other devices, and powers photo search.</T>
          <Field label="Server address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://foodlog.yourname.workers.dev" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          <View style={[styles.row, { marginTop: 12 }]}>
            <T small muted style={{ flex: 1 }}>{syncStatus}</T>
            <Button
              kind="primary"
              title="Save & sync"
              onPress={async () => {
                await saveConfig({ url: url.trim(), password });
                syncNow();
              }}
            />
          </View>
        </Card>

        <Card>
          <H>Logs</H>
          <T small muted>See what the app did and what went wrong (searches, sync, AI, crashes). Share them to get help with a problem.</T>
          <Button title="View logs" onPress={() => router.push('/logs')} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
        </Card>

        <T small muted style={{ textAlign: 'center', marginTop: 12 }}>
          Food data from Open Food Facts (ODbL) and USDA FoodData Central.
        </T>
      </ScrollView>
    </SafeAreaView>
  );
}
