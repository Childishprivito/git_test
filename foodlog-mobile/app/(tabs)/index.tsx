// Diary: today's totals, goals, meals, and (in a real build) Apple Health activity.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Bar, Button, Card, H, T, styles, useTheme } from '@/components/ui';
import { healthAvailable, todayActivity } from '@/lib/health';
import { MEALS, dateString, dayTotals, foodTitle, macrosFor } from '@/lib/model';
import { useStore } from '@/lib/store';

function dayLabel(offset: number) {
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  return dateString(offset);
}

export default function Diary() {
  const { db, update, setMeal, flash } = useStore();
  const t = useTheme();
  const [offset, setOffset] = useState(0);
  const date = dateString(offset);
  const totals = dayTotals(db, date);
  const g = db.goals;
  const left = g.kcal - totals.kcal;
  const [activity, setActivity] = useState<{ steps: number; active: number } | null>(null);

  useEffect(() => {
    if (offset === 0 && healthAvailable()) todayActivity().then(setActivity).catch(() => setActivity(null));
  }, [offset, db.entries.length]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.row}>
          <Button kind="ghost" title="‹" label="Previous day" onPress={() => setOffset(offset - 1)} />
          <H level={1}>{dayLabel(offset)}</H>
          <Button kind="ghost" title="›" label="Next day" onPress={() => setOffset(offset + 1)} />
        </View>

        <Card>
          <View style={[styles.row, { alignItems: 'baseline' }]}>
            <T>
              <T bold size={32}>{Math.round(Math.abs(left))}</T>
              <T muted>{left >= 0 ? ' kcal left' : ' kcal over'}</T>
            </T>
            <T muted small>{`${Math.round(totals.kcal)} eaten of ${Math.round(g.kcal)}`}</T>
          </View>
          <Bar label="Calories" value={totals.kcal} goal={g.kcal} unit="kcal" />
          <Bar label="Protein" value={totals.protein} goal={g.protein} unit="g" />
          <Bar label="Carbs" value={totals.carbs} goal={g.carbs} unit="g" />
          <Bar label="Fat" value={totals.fat} goal={g.fat} unit="g" />
          {activity && (
            <T small muted style={{ marginTop: 10 }}>
              {`Apple Health today: ${Math.round(activity.steps).toLocaleString()} steps · ${Math.round(activity.active)} active kcal`}
            </T>
          )}
        </Card>

        {MEALS.map((meal) => {
          const entries = db.entries.filter((e) => e.date === date && e.meal === meal);
          const kcal = entries.reduce((a, e) => a + macrosFor(e.food, e.grams).kcal, 0);
          return (
            <Card key={meal}>
              <View style={styles.row}>
                <H>{meal}</H>
                <T muted>{`${Math.round(kcal)} kcal`}</T>
              </View>
              {entries.map((e) => {
                const m = macrosFor(e.food, e.grams);
                return (
                  <View key={e.id} style={[styles.row, { borderBottomWidth: 1, borderColor: t.line, paddingVertical: 8 }]}>
                    <View style={{ flex: 1 }}>
                      <T>{foodTitle(e.food)}</T>
                      <T small muted>{`${Math.round(e.grams)} g · P ${Math.round(m.protein)} · C ${Math.round(m.carbs)} · F ${Math.round(m.fat)}`}</T>
                    </View>
                    <T bold>{Math.round(m.kcal)}</T>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${foodTitle(e.food)}`}
                      hitSlop={10}
                      onPress={() => {
                        update((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== e.id), deleted: [...d.deleted, e.id] }));
                        flash('Removed');
                      }}>
                      <T style={{ color: t.danger, paddingHorizontal: 8 }}>✕</T>
                    </Pressable>
                  </View>
                );
              })}
              <Button
                kind="ghost"
                title={`+ Add to ${meal}`}
                onPress={() => {
                  setMeal(meal);
                  router.navigate('/add');
                }}
                style={{ alignSelf: 'flex-start' }}
              />
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
