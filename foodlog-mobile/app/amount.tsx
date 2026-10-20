// "How much?" sheet for the picked food.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button, H, Field, Segmented, T, styles, useTheme } from '@/components/ui';
import { healthEnabled, saveFoodToHealth } from '@/lib/health';
import { Entry, MEALS, Meal, dateString, foodTitle, macrosFor, newId, remember } from '@/lib/model';
import { useStore } from '@/lib/store';

export default function Amount() {
  const { picked, setPicked, meal, setMeal, update, flash } = useStore();
  const t = useTheme();
  const serving = picked?.serving_g ?? null;
  const [unit, setUnit] = useState<'serving' | 'g'>(serving ? 'serving' : 'g');
  const [amount, setAmount] = useState(serving ? '1' : '100');
  if (!picked) return null;
  const a = parseFloat(amount.replace(',', '.')) || 0;
  const grams = unit === 'serving' && serving ? a * serving : a;
  const m = macrosFor(picked, grams);

  const add = async () => {
    if (grams <= 0) return;
    const entry: Entry = { id: newId(), date: dateString(0), meal, food: picked, grams };
    update((d) => remember({ ...d, entries: [...d.entries, entry] }, picked));
    setPicked(null);
    router.dismissAll();
    router.navigate('/');
    flash(`Added to ${meal}`);
    if (await healthEnabled()) saveFoodToHealth(entry).catch(() => flash('Couldn’t save to Apple Health'));
  };

  return (
    <ScrollView style={{ backgroundColor: t.card }} contentContainerStyle={styles.screen}>
      <H>{foodTitle(picked)}</H>
      <View style={[styles.row, { marginVertical: 8 }]}>
        {[
          [m.kcal, 'kcal', 0],
          [m.protein, 'protein g', 1],
          [m.carbs, 'carbs g', 1],
          [m.fat, 'fat g', 1],
        ].map(([v, label, digits]) => (
          <View key={label as string} style={{ flex: 1, alignItems: 'center', backgroundColor: t.bg, borderRadius: 10, paddingVertical: 8 }}>
            <T bold size={20}>{(v as number).toFixed(digits as number)}</T>
            <T small muted>{label as string}</T>
          </View>
        ))}
      </View>
      <View style={[styles.row, { alignItems: 'flex-end' }]}>
        <Field label="How much?" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" selectTextOnFocus autoFocus />
      </View>
      {serving ? (
        <Segmented
          label="Unit"
          value={unit}
          onChange={(u) => {
            setUnit(u);
            setAmount(u === 'serving' ? '1' : String(Math.round(serving)));
          }}
          options={[
            { value: 'serving', label: `× ${picked.serving_label || 'serving'} (${Math.round(serving)} g)` },
            { value: 'g', label: 'grams' },
          ]}
        />
      ) : (
        <T muted>grams</T>
      )}
      <T bold style={{ marginTop: 14 }}>Meal</T>
      <Segmented<Meal> label="Meal" value={meal} onChange={setMeal} options={MEALS.map((x) => ({ value: x, label: x }))} />
      <View style={[styles.row, { marginTop: 18 }]}>
        <Button kind="ghost" title="Cancel" onPress={() => router.back()} />
        <Button kind="primary" title="Add to today" onPress={add} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}
