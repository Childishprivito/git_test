// One workout day: every exercise with last time, PR, and set logging.
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';

import { Button, Card, Field, H, Segmented, T, styles, useTheme } from '@/components/ui';
import { healthEnabled, saveWorkoutToHealth } from '@/lib/health';
import { Exercise, LoggedSet, dateString, newId } from '@/lib/model';
import { useStore } from '@/lib/store';
import { e1rm, fmtSet, fmtW, lastSession, prFlags, records, sameExercise, when } from '@/lib/workout';

const UNIT = 'lb';

function ExerciseCard({ ex, week, day, prIds, onPr }: { ex: Exercise; week: number; day: string; prIds: number[]; onPr: (id: number) => void }) {
  const { db, update, flash } = useStore();
  const t = useTheme();
  const options = [ex.name, ...ex.substitutions];
  const inSession = (s: LoggedSet) => s.week === week && s.day === day;
  const mine = db.sets.filter((s) => inSession(s) && options.some((o) => sameExercise(o, s.exercise)));
  const [chosen, setChosen] = useState(mine[0]?.exercise ?? ex.name);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const last = lastSession(chosen, db.sets.filter((s) => !inSession(s)));
  const record = records(db.sets.filter((s) => sameExercise(s.exercise, chosen)))[0];
  const suggestion = last[mine.length] ?? last[last.length - 1];

  const log = () => {
    const w = weight.trim() ? parseFloat(weight.replace(',', '.')) : suggestion?.weight;
    const r = reps.trim() ? parseInt(reps, 10) : suggestion?.reps;
    if (w == null || r == null || !Number.isFinite(w) || !Number.isFinite(r)) return flash('Enter the weight and reps');
    const set: LoggedSet = { id: newId(), date: dateString(0), exercise: chosen, weight: w, reps: r, week, day };
    const pr = prFlags(set, db.sets);
    if (pr.weight || pr.e1rm) {
      onPr(set.id);
      flash(`🏆 New ${pr.weight ? 'weight' : 'est. 1RM'} PR: ${fmtW(w)} ${UNIT} × ${r}`);
    }
    update((d) => ({ ...d, sets: [...d.sets, set] }));
    setWeight(fmtW(w));
    setReps('');
  };

  return (
    <Card>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><H>{chosen}</H></View>
        {!!ex.video && <Button kind="ghost" title="▶ Video" label={`Video: ${ex.name}`} onPress={() => Linking.openURL(ex.video!)} />}
      </View>
      <T small muted>{`${ex.working_sets} × ${ex.reps} reps${ex.last_rpe ? ` · RPE ${ex.last_rpe}` : ''}${ex.rest ? ` · rest ${ex.rest}` : ''}`}</T>
      {!!ex.technique && <T small style={{ marginTop: 4 }}>{`Last set: ${ex.technique}`}</T>}
      {ex.substitutions.length > 0 && (
        <Segmented label="Exercise or substitute" value={chosen} onChange={setChosen} options={options.map((o) => ({ value: o, label: o }))} />
      )}
      <View style={{ backgroundColor: t.bg, borderRadius: 10, padding: 10, marginTop: 8 }}>
        <T small>{last.length ? `Last time (${when(last[0])}): ${last.map(fmtSet).join(', ')}` : 'First time — pick a weight you can do with good form.'}</T>
        {record && <T small muted>{`PR: ${fmtW(record.heaviest.weight)} ${UNIT} × ${record.heaviest.reps} · best est. 1RM ${Math.round(e1rm(record.best))} ${UNIT}`}</T>}
      </View>
      {mine.map((s, i) => (
        <View key={s.id} style={[styles.row, { borderBottomWidth: 1, borderColor: t.line, minHeight: 44 }]}>
          <T muted small style={{ width: 48 }}>{`Set ${i + 1}`}</T>
          <T style={{ flex: 1 }}>{`${fmtW(s.weight)} ${UNIT} × ${s.reps}${prIds.includes(s.id) ? ' 🏆' : ''}`}</T>
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove set ${i + 1}`} hitSlop={10}
            onPress={() => update((d) => ({ ...d, sets: d.sets.filter((x) => x.id !== s.id), deleted_sets: [...d.deleted_sets, s.id] }))}>
            <T style={{ color: t.danger, paddingHorizontal: 8 }}>✕</T>
          </Pressable>
        </View>
      ))}
      <View style={[styles.row, { marginTop: 8 }]}>
        <T muted small style={{ width: 48 }}>{`Set ${mine.length + 1}`}</T>
        <Field label={`Weight (${UNIT})`} hideLabel value={weight} onChangeText={setWeight} keyboardType="decimal-pad"
          placeholder={suggestion ? fmtW(suggestion.weight) : UNIT} style={{ textAlign: 'center' }} />
        <T>×</T>
        <Field label="Reps" hideLabel value={reps} onChangeText={setReps} keyboardType="number-pad"
          placeholder={suggestion ? String(suggestion.reps) : 'reps'} style={{ textAlign: 'center' }} />
        <Button kind="primary" title="Log" onPress={log} />
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: notesOpen }} onPress={() => setNotesOpen(!notesOpen)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <T small bold>{notesOpen ? '▾ Notes & warm-up' : '▸ Notes & warm-up'}</T>
      </Pressable>
      {notesOpen && (
        <View style={{ gap: 4 }}>
          {!!ex.warmup_sets && <T small>{`Warm-up sets: ${ex.warmup_sets}`}</T>}
          {!!ex.early_rpe && <T small>{`Early sets RPE ${ex.early_rpe}`}</T>}
          {!!ex.notes && <T small>{ex.notes}</T>}
        </View>
      )}
    </Card>
  );
}

export default function Session() {
  const { db, flash } = useStore();
  const t = useTheme();
  const params = useLocalSearchParams<{ week: string; day: string }>();
  const weekNo = Number(params.week);
  const week = db.program?.weeks.find((w) => w.number === weekNo);
  const day = week?.days[Number(params.day)];
  const started = useRef(new Date());
  const [prIds, setPrIds] = useState<number[]>([]);
  if (!week || !day) return <T>{'That workout isn’t in your program anymore.'}</T>;
  const logged = db.sets.filter((s) => s.week === weekNo && s.day === day.name && s.date === dateString(0));

  const finish = async () => {
    router.back();
    if (logged.length) {
      flash(`Workout saved · ${logged.length} sets`);
      if (await healthEnabled()) saveWorkoutToHealth(logged, started.current, new Date(), day.name).catch(() => {});
    }
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: day.name }} />
      <T muted small>{`Week ${week.number}${week.block ? ` · ${week.block}` : ''}`}</T>
      {day.exercises.map((ex, i) => (
        <ExerciseCard key={ex.name + i} ex={ex} week={week.number} day={day.name} prIds={prIds} onPr={(id) => setPrIds((p) => [...p, id])} />
      ))}
      <Button kind="primary" big title={logged.length ? 'Finish workout' : 'Back to program'} onPress={finish} />
    </ScrollView>
  );
}
