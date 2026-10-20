// Coach: an AI coach that sees your meals, workouts and Apple Health data.
// Connecting an AI account is the next step; for now you can send the
// snapshot to the ChatGPT or Claude app yourself.
import { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, H, T, styles, useTheme } from '@/components/ui';
import { Activity, coachSnapshot } from '@/lib/coach';
import { healthAvailable, todayActivity } from '@/lib/health';
import { useStore } from '@/lib/store';

export default function Coach() {
  const { db } = useStore();
  const t = useTheme();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (healthAvailable()) todayActivity().then(setActivity).catch(() => setActivity(null));
  }, []);

  const snapshot = useMemo(() => coachSnapshot(db, activity), [db, activity]);
  const preview = showAll ? snapshot : snapshot.split('\n').slice(0, 12).join('\n');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.screen}>
        <H level={1}>Coach</H>
        <T muted style={{ marginBottom: 12 }}>
          Your AI coach for food and training. It sees your meals, goals, workouts, PRs and Apple Health activity.
        </T>

        <Card>
          <H>Connect an AI account</H>
          <T small muted style={{ marginBottom: 8 }}>
            Coming soon: chat with Coach right here using your own ChatGPT or Claude account.
          </T>
          <Button title="Sign in with ChatGPT" disabled onPress={() => {}} style={{ marginBottom: 8 }} />
          <Button title="Use Claude" disabled onPress={() => {}} />
        </Card>

        <Card>
          <H>Ask now</H>
          <T small muted style={{ marginBottom: 8 }}>
            Send your snapshot to the ChatGPT or Claude app and ask anything, like “How’s my protein this week?”
          </T>
          <Button
            kind="primary"
            title="Share my snapshot"
            onPress={() =>
              Share.share({
                message: `You are Coach, my nutrition and strength coach. Here is my data:\n\n${snapshot}\n\nGive me a short check-in.`,
              })
            }
          />
        </Card>

        <Card>
          <H>What Coach can see</H>
          <T small style={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), marginTop: 6 }}>{preview}</T>
          <Button kind="ghost" title={showAll ? 'Show less' : 'Show everything'} onPress={() => setShowAll(!showAll)} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
