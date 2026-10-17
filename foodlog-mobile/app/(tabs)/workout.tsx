// Workout: import your program, see what's next, browse weeks, PRs, quick log.
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Field, H, T, styles, useTheme } from '@/components/ui';
import { importProgram, readSheet } from '@/lib/importSheet';
import { LoggedSet, dateString, newId } from '@/lib/model';
import { useStore } from '@/lib/store';
import { dayDone, e1rm, fmtSet, fmtW, prFlags, records, sameExercise, upNext, when } from '@/lib/workout';

const UNIT = 'lb';

function ImportButton({ first }: { first: boolean }) {
  const { update, flash } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = useTheme();
  const go = async () => {
    setError('');
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/vnd.oasis.opendocument.spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    setBusy(true);
    try {
      const asset = res.assets[0];
      const bytes = asset.file ? await asset.file.arrayBuffer() : await new File(asset.uri).bytes();
      const name = asset.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const imp = importProgram(await readSheet(bytes), name, newId());
      let added = 0;
      update((d) => {
        // Don't double up sets brought in by an earlier import of the same sheet.
        const before = new Set(d.sets.filter((s) => !s.date).map((s) => `${s.week}|${s.day}|${s.exercise.toLowerCase()}`));
        const fresh = imp.sets.filter((s) => !before.has(`${s.week}|${s.day}|${s.exercise.toLowerCase()}`));
        added = fresh.length;
        return { ...d, program: imp.program, program_updated: Date.now(), sets: [...d.sets, ...fresh] };
      });
      flash(`Imported ${imp.program.weeks.length} weeks and ${added} logged sets`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button kind={first ? 'primary' : 'default'} big={first} busy={busy} title={first ? 'Choose spreadsheet' : 'Replace with a new spreadsheet'} onPress={go} style={{ marginTop: 10 }} />
      {!!error && <T style={{ color: t.danger, marginTop: 6 }}>{error}</T>}
    </>
  );
}

function ProgramCard() {
  const { db } = useStore();
  const t = useTheme();
  const p = db.program!;
  const next = upNext(p, db.sets);
  const [shown, setShown] = useState<number | null>(null);
  const idx = shown ?? Math.max(0, p.weeks.findIndex((w) => w.number === next?.week));
  const week = p.weeks[idx];
  const nextDay = next && p.weeks.find((w) => w.number === next.week)?.days[next.day];
  const open = (w: number, d: number) => router.push({ pathname: '/session', params: { week: String(w), day: String(d) } });
  return (
    <>
      {next && nextDay ? (
        <Card>
          <T small muted>{`Up next · Week ${next.week}`}</T>
          <H>{nextDay.name}</H>
          <T small muted>{nextDay.exercises.map((e) => e.name).join(' · ')}</T>
          <Button kind="primary" big title="Start workout" onPress={() => open(next.week, next.day)} style={{ marginTop: 10 }} />
        </Card>
      ) : (
        <Card>
          <H>Program complete 🎉</H>
          <T small muted>Every day has sets logged. Import a new program, or keep using Quick log.</T>
        </Card>
      )}
      <Card>
        <View style={styles.row}>
          <Button kind="ghost" title="‹" label="Previous week" disabled={idx === 0} onPress={() => setShown(Math.max(0, idx - 1))} />
          <View style={{ alignItems: 'center', flex: 1 }}>
            <H>{`Week ${week.number}`}</H>
            <T small muted>{week.block}</T>
          </View>
          <Button kind="ghost" title="›" label="Next week" disabled={idx >= p.weeks.length - 1} onPress={() => setShown(Math.min(p.weeks.length - 1, idx + 1))} />
        </View>
        {week.days.map((d, i) => {
          const done = dayDone(db.sets, week.number, d.name);
          return (
            <Pressable key={d.name + i} accessibilityRole="button" accessibilityLabel={`${d.name}${done ? ', done' : ''}`} onPress={() => open(week.number, i)}
              style={[styles.row, { borderBottomWidth: 1, borderColor: t.line, paddingVertical: 10, justifyContent: 'flex-start', gap: 12 }]}>
              <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: done ? t.accent : t.line, backgroundColor: done ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {done && <T bold style={{ color: t.accentText }}>✓</T>}
              </View>
              <View style={{ flex: 1 }}>
                <T>{d.name}</T>
                <T small muted>{`${d.exercises.length} exercises${done ? ' · done' : ''}`}</T>
              </View>
              <T muted>›</T>
            </Pressable>
          );
        })}
      </Card>
    </>
  );
}

function QuickLog() {
  const { db, update, flash } = useStore();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const log = () => {
    const w = parseFloat(weight.replace(',', '.'));
    const r = parseInt(reps, 10);
    if (!name.trim() || !Number.isFinite(w) || !Number.isFinite(r)) return flash('Enter the exercise, weight and reps');
    const set: LoggedSet = { id: newId(), date: dateString(0), exercise: name.trim(), weight: w, reps: r, week: null, day: '' };
    const pr = prFlags(set, db.sets);
    update((d) => ({ ...d, sets: [...d.sets, set] }));
    flash(pr.weight || pr.e1rm ? `🏆 New PR: ${fmtW(w)} ${UNIT} × ${r}` : 'Set logged');
    setReps('');
  };
  return (
    <Card>
      <H>Quick log a set</H>
      <Field label="Exercise" value={name} onChangeText={setName} autoCapitalize="words" />
      <View style={[styles.row, { marginTop: 10 }]}>
        <Field label={`Weight (${UNIT})`} hideLabel placeholder={UNIT} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" />
        <T>×</T>
        <Field label="Reps" hideLabel placeholder="reps" value={reps} onChangeText={setReps} keyboardType="number-pad" />
        <Button kind="primary" title="Log" onPress={log} />
      </View>
    </Card>
  );
}

function Records() {
  const { db } = useStore();
  const t = useTheme();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const all = useMemo(() => records(db.sets), [db.sets]);
  const shown = all.filter((r) => r.exercise.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Card>
      <H>🏆 PRs</H>
      {all.length === 0 ? (
        <T small muted>Log some sets and your best lifts show up here.</T>
      ) : (
        <>
          <Field label="Find an exercise" hideLabel placeholder="Find an exercise" value={filter} onChangeText={setFilter} />
          {shown.map((r) => {
            const isOpen = open === r.exercise;
            const history = isOpen
              ? db.sets
                  .filter((s) => sameExercise(s.exercise, r.exercise))
                  .sort((a, b) => b.date.localeCompare(a.date) || (b.week ?? 0) - (a.week ?? 0) || b.id - a.id)
                  .reduce<[string, string[]][]>((g, s) => {
                    const k = when(s);
                    if (g.length && g[g.length - 1][0] === k) g[g.length - 1][1].push(fmtSet(s));
                    else g.push([k, [fmtSet(s)]]);
                    return g;
                  }, [])
                  .slice(0, 8)
              : [];
            return (
              <Pressable key={r.exercise} accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => setOpen(isOpen ? null : r.exercise)}
                style={{ borderBottomWidth: 1, borderColor: t.line, paddingVertical: 10 }}>
                <T>{r.exercise}</T>
                <T small muted>{`Heaviest ${fmtW(r.heaviest.weight)} ${UNIT} × ${r.heaviest.reps} (${when(r.heaviest)}) · est. 1RM ${Math.round(e1rm(r.best))} ${UNIT}`}</T>
                {history.map(([k, v]) => (
                  <T key={k} small style={{ marginTop: 4 }}>{`${k}: ${v.join(', ')}`}</T>
                ))}
              </Pressable>
            );
          })}
        </>
      )}
    </Card>
  );
}

export default function Workout() {
  const { db, update } = useStore();
  const t = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <H level={1}>Workout</H>
        {db.program ? (
          <ProgramCard />
        ) : (
          <Card>
            <H>Import your program</H>
            <T small muted>
              Choose your program spreadsheet (.ods or .xlsx) from Files. Weeks, days, exercises, sets, reps, rest and notes come in, plus any weights you already logged in it. A program imported in the web app shows up here too once sync is on.
            </T>
            <ImportButton first />
          </Card>
        )}
        <QuickLog />
        <Records />
        {db.program && (
          <Card>
            <H>Program settings</H>
            <ImportButton first={false} />
            <Button kind="danger" title="Remove program" onPress={() => update((d) => ({ ...d, program: null, program_updated: Date.now() }))} style={{ marginTop: 8 }} />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
