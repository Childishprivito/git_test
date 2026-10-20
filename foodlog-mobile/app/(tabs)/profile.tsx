// Profile: an overview of you. Weight trend, body stats, Apple Health,
// nutrition and training at a glance, plus your details. Settings lives
// behind the gear button.
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Field, H, Segmented, T, styles, useTheme } from '@/components/ui';
import { WeightChart } from '@/components/WeightChart';
import { toPoints } from '@/lib/weight';
import { HealthOverview, connectHealth, healthAvailable, healthEnabled, healthOverview, healthWeights, saveWeightToHealth } from '@/lib/health';
import { Db, LoggedSet, Profile, WeighIn, dateString, dayTotals, newId } from '@/lib/model';
import { useStore } from '@/lib/store';
import { e1rm, fmtSet, sameExercise, upNext } from '@/lib/workout';

type Range = '30' | '90' | '365' | 'all';

const r = Math.round;
const num = (s: string) => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const t = useTheme();
  return (
    <View style={{ width: '48%', backgroundColor: t.bg, borderRadius: 12, padding: 10, marginBottom: 8 }}>
      <T small muted>{label}</T>
      <T bold size={22}>{value}</T>
      {!!sub && <T small muted>{sub}</T>}
    </View>
  );
}

function Tiles({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8 }}>{children}</View>;
}

/** Calories you burn at rest (Mifflin-St Jeor). Needs weight, height and age. */
function bmr(p: Profile, lb: number | null): number | null {
  if (!lb || !p.height_in || !p.birth_year) return null;
  const age = new Date().getFullYear() - p.birth_year;
  const base = 10 * lb * 0.4536 + 6.25 * p.height_in * 2.54 - 5 * age;
  return base + (p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78);
}

/** Sets that beat everything logged before them. */
function recentPrs(sets: LoggedSet[], since: string) {
  const dated = sets.filter((s) => s.date && s.reps > 0).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const out: LoggedSet[] = [];
  dated.forEach((s, i) => {
    if (s.date < since) return;
    const before = [...sets.filter((x) => !x.date), ...dated.slice(0, i)].filter((x) => x.reps > 0 && sameExercise(x.exercise, s.exercise));
    if (before.length && e1rm(s) > Math.max(...before.map(e1rm)) + 1e-9) out.push(s);
  });
  // Keep the best one per exercise.
  const best = new Map<string, LoggedSet>();
  for (const s of out) {
    const k = s.exercise.toLowerCase();
    if (!best.has(k) || e1rm(s) > e1rm(best.get(k)!)) best.set(k, s);
  }
  return [...best.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
}

function loggingStreak(db: Db): number {
  const days = new Set(db.entries.map((e) => e.date));
  let n = 0;
  let i = days.has(dateString(0)) ? 0 : -1; // today not logged yet doesn't break it
  while (days.has(dateString(i))) {
    n++;
    i--;
  }
  return n;
}

function AboutYou({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const [name, setName] = useState(profile.name);
  const [birth, setBirth] = useState(profile.birth_year ? String(profile.birth_year) : '');
  const [ft, setFt] = useState(profile.height_in ? String(Math.floor(profile.height_in / 12)) : '');
  const [inch, setInch] = useState(profile.height_in ? String(r(profile.height_in % 12)) : '');
  const [sex, setSex] = useState<Profile['sex']>(profile.sex);
  const [goal, setGoal] = useState(profile.goal_weight_lb ? String(profile.goal_weight_lb) : '');
  const save = () => {
    const f = num(ft) ?? 0;
    const i = parseFloat(inch.replace(',', '.')) || 0;
    const year = parseInt(birth, 10);
    onSave({
      name: name.trim(),
      birth_year: year > 1900 && year <= new Date().getFullYear() ? year : null,
      height_in: f || i ? f * 12 + i : null,
      sex,
      goal_weight_lb: num(goal),
    });
  };
  return (
    <Card>
      <H>About you</H>
      <T small muted>Used for BMI and calorie estimates, and shared with Coach.</T>
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Birth year" value={birth} onChangeText={setBirth} keyboardType="number-pad" placeholder="e.g. 1996" />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label="Height (ft)" value={ft} onChangeText={setFt} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="(in)" value={inch} onChangeText={setInch} keyboardType="decimal-pad" />
        </View>
      </View>
      <T bold style={{ marginTop: 12 }}>Sex</T>
      <Segmented<Profile['sex']>
        label="Sex"
        value={sex}
        onChange={setSex}
        options={[
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: '', label: 'Rather not say' },
        ]}
      />
      <Field label="Goal weight (lb)" value={goal} onChangeText={setGoal} keyboardType="decimal-pad" />
      <Button kind="primary" title="Save" onPress={save} style={{ marginTop: 12, alignSelf: 'flex-end' }} />
    </Card>
  );
}

export default function ProfileScreen() {
  const { db, update, flash } = useStore();
  const t = useTheme();
  const [range, setRange] = useState<Range>('90');
  const [weight, setWeight] = useState('');
  const [health, setHealth] = useState<HealthOverview | null>(null);
  const [editing, setEditing] = useState(false);
  const p = db.profile;

  useEffect(() => {
    // Asking again only prompts for data types not yet answered (new ones added here).
    healthEnabled()
      .then(async (on) => (on && (await connectHealth()) ? healthOverview() : null))
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [db.weights.length]);

  const allPoints = useMemo(() => toPoints(db.weights, null), [db.weights]);
  const since = range === 'all' ? null : dateString(-Number(range));
  const points = useMemo(() => (since ? allPoints.filter((x) => x.date >= since) : allPoints), [allPoints, since]);
  const latest = allPoints.at(-1) ?? null;
  const current = latest?.lb ?? health?.weight?.lb ?? null;
  const heightIn = p.height_in ?? health?.heightIn ?? null;

  // Trend: change in the 7-day average over the last 4 weeks.
  const monthAgo = allPoints.filter((x) => x.date <= dateString(-28)).at(-1) ?? allPoints[0];
  const perWeek = latest && monthAgo && latest.date !== monthAgo.date
    ? ((latest.avg - monthAgo.avg) / ((new Date(latest.date).getTime() - new Date(monthAgo.date).getTime()) / 864e5)) * 7
    : null;
  const goal = p.goal_weight_lb;
  const toGo = goal && latest ? latest.avg - goal : null;
  const weeksLeft = toGo && perWeek && Math.sign(toGo) === -Math.sign(perWeek) && Math.abs(perWeek) > 0.05 ? Math.abs(toGo / perWeek) : null;

  const bmi = current && heightIn ? (703 * current) / (heightIn * heightIn) : null;
  const rest = bmr(p, current);
  const maintenance = rest ? (health && health.activeKcalPerDay7 > 0 ? rest * 1.1 + health.activeKcalPerDay7 : rest * 1.4) : null;

  // Nutrition, last 7 days
  const week = Array.from({ length: 7 }, (_, i) => dateString(-i));
  const logged = week.filter((d) => db.entries.some((e) => e.date === d));
  const avg = (k: 'kcal' | 'protein') => (logged.length ? logged.reduce((a, d) => a + dayTotals(db, d)[k], 0) / logged.length : 0);

  // Training
  const weekAgo = dateString(-6);
  const recentSets = db.sets.filter((s) => s.date >= weekAgo);
  const sessions = new Set(recentSets.map((s) => `${s.date}|${s.day}`)).size;
  const prs = useMemo(() => recentPrs(db.sets, dateString(-30)), [db.sets]);
  const next = db.program ? upNext(db.program, db.sets) : null;

  const logWeight = async () => {
    const lb = num(weight);
    if (!lb || lb < 50 || lb > 800) return flash('Enter your weight in lb');
    const today = dateString(0);
    update((d) => {
      const old = d.weights.filter((w) => w.date === today).map((w) => w.id);
      return { ...d, weights: [...d.weights.filter((w) => w.date !== today), { id: newId(), date: today, lb }], deleted_weights: [...d.deleted_weights, ...old] };
    });
    setWeight('');
    flash(`Logged ${lb} lb`);
    if (await healthEnabled()) saveWeightToHealth(lb, new Date()).catch(() => {});
  };

  const importFromHealth = async () => {
    const rows = await healthWeights(730);
    const have = new Set(db.weights.map((w) => w.date));
    const byDay = new Map<string, number>();
    for (const row of rows) byDay.set(localDate(row.date), row.lb);
    const add: WeighIn[] = [...byDay.entries()].filter(([d]) => !have.has(d)).map(([date, lb], i) => ({ id: newId() + i, date, lb: Math.round(lb * 10) / 10 }));
    if (!add.length) return flash('Nothing new in Apple Health');
    update((d) => ({ ...d, weights: [...d.weights, ...add] }));
    flash(`Added ${add.length} weigh-ins from Apple Health`);
  };

  const removeWeight = (w: WeighIn) => {
    update((d) => ({ ...d, weights: d.weights.filter((x) => x.id !== w.id), deleted_weights: [...d.deleted_weights, w.id] }));
    flash('Removed');
  };

  const initials = (p.name || '?').split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();
  const age = p.birth_year ? new Date().getFullYear() - p.birth_year : null;
  const facts = [
    age ? `${age} yrs` : '',
    heightIn ? `${Math.floor(heightIn / 12)}′${r(heightIn % 12)}″` : '',
    p.sex ? p.sex[0].toUpperCase() + p.sex.slice(1) : '',
  ].filter(Boolean);
  const recent = [...db.weights].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 5);
  const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} ${unit}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <View style={[styles.row, { marginBottom: 12 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit your details" onPress={() => setEditing(!editing)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
              <T bold size={22} style={{ color: t.accentText }}>{initials}</T>
            </View>
            <View style={{ flex: 1 }}>
              <H level={1}>{p.name || 'Your profile'}</H>
              <T small muted>{facts.length ? facts.join(' · ') : 'Tap to add your details'}</T>
            </View>
          </Pressable>
          <Button kind="ghost" title="⚙︎" label="Settings" onPress={() => router.push('/settings')} />
        </View>

        {(editing || (!p.height_in && !p.birth_year && !p.name)) && (
          <AboutYou
            profile={p}
            onSave={(np) => {
              update((d) => ({ ...d, profile: np, profile_updated: Date.now() }));
              setEditing(false);
              flash('Saved');
            }}
          />
        )}

        <Card>
          <View style={styles.row}>
            <H>Weight</H>
            {latest && <T muted small>{`Last: ${new Date(`${latest.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}</T>}
          </View>
          <Tiles>
            <Tile label="Current (7-day avg)" value={latest ? `${latest.avg.toFixed(1)} lb` : current ? `${current.toFixed(1)} lb` : '—'} sub={latest ? `Last weigh-in ${latest.lb.toFixed(1)}` : undefined} />
            <Tile label="Trend" value={perWeek != null ? signed(perWeek, 'lb/wk') : '—'} sub={perWeek != null ? 'over the last 4 weeks' : 'Log a few weigh-ins'} />
            <Tile label="Goal" value={goal ? `${goal} lb` : '—'} sub={toGo != null ? `${Math.abs(toGo).toFixed(1)} lb to ${toGo > 0 ? 'lose' : 'gain'}` : 'Set it in your details'} />
            <Tile label="At this pace" value={weeksLeft ? `${Math.ceil(weeksLeft)} wks` : '—'} sub={weeksLeft ? 'to reach your goal' : toGo != null && Math.abs(toGo) < 0.5 ? 'You’re there' : 'Not heading to goal yet'} />
          </Tiles>
          {allPoints.length > 0 && (
            <>
              <Segmented<Range>
                label="Chart range"
                value={range}
                onChange={setRange}
                options={[
                  { value: '30', label: '30d' },
                  { value: '90', label: '90d' },
                  { value: '365', label: '1y' },
                  { value: 'all', label: 'All' },
                ]}
              />
              <View style={{ marginTop: 12 }}>
                {points.length ? <WeightChart points={points} goal={goal} /> : <T muted>No weigh-ins in this range.</T>}
              </View>
            </>
          )}
          <View style={[styles.row, { alignItems: 'flex-end', marginTop: 4 }]}>
            <View style={{ flex: 1 }}>
              <Field label="Today’s weight (lb)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" onSubmitEditing={logWeight} placeholder={current ? current.toFixed(1) : 'e.g. 182.4'} />
            </View>
            <Button kind="primary" title="Log" onPress={logWeight} />
          </View>
          {healthAvailable() && <Button kind="ghost" title="Import weigh-ins from Apple Health" onPress={importFromHealth} style={{ alignSelf: 'flex-start' }} />}
          {recent.length > 0 && (
            <View style={{ marginTop: 8 }}>
              {recent.map((w) => (
                <View key={w.id} style={[styles.row, { borderTopWidth: 1, borderColor: t.line, paddingVertical: 8 }]}>
                  <T>{new Date(`${w.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</T>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <T bold>{`${w.lb.toFixed(1)} lb`}</T>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove weigh-in ${w.date}`} hitSlop={10} onPress={() => removeWeight(w)}>
                      <T style={{ color: t.danger, paddingHorizontal: 8 }}>✕</T>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <H>Body</H>
          <Tiles>
            <Tile label="BMI" value={bmi ? bmi.toFixed(1) : '—'} sub={bmi ? 'from weight and height' : 'Needs height'} />
            <Tile label="Body fat" value={health?.bodyFatPct ? `${health.bodyFatPct.toFixed(1)}%` : '—'} sub={health?.bodyFatPct ? 'Apple Health' : 'From a smart scale'} />
            <Tile label="Burn at rest" value={rest ? `${r(rest)} kcal` : '—'} sub={rest ? 'estimated (BMR)' : 'Needs age, height, weight'} />
            <Tile label="Maintenance" value={maintenance ? `${r(maintenance)} kcal` : '—'} sub={maintenance ? (health?.activeKcalPerDay7 ? 'with your Health activity' : 'estimate, moderately active') : 'Needs your details'} />
          </Tiles>
          {maintenance && <T small muted>{`Your calorie goal is ${r(db.goals.kcal)}: about ${r(Math.abs(maintenance - db.goals.kcal))} kcal ${db.goals.kcal < maintenance ? 'under' : 'over'} maintenance.`}</T>}
        </Card>

        <Card>
          <H>Apple Health</H>
          {health ? (
            <Tiles>
              <Tile label="Steps" value={r(health.stepsPerDay7).toLocaleString()} sub="per day, last 7 days" />
              <Tile label="Active energy" value={`${r(health.activeKcalPerDay7)} kcal`} sub="per day, last 7 days" />
              <Tile label="Exercise today" value={`${r(health.exerciseMinToday)} min`} />
              <Tile label="Sleep last night" value={health.sleepHoursLastNight ? `${Math.floor(health.sleepHoursLastNight)}h ${r((health.sleepHoursLastNight % 1) * 60)}m` : '—'} />
              <Tile label="Resting heart rate" value={health.restingHr ? `${r(health.restingHr)} bpm` : '—'} />
              <Tile label="HRV" value={health.hrvMs ? `${r(health.hrvMs)} ms` : '—'} />
              <Tile label="VO₂ max" value={health.vo2max ? health.vo2max.toFixed(1) : '—'} sub={health.vo2max ? 'mL/kg·min' : undefined} />
              <Tile label="Workouts" value={String(health.workouts7)} sub={`${r(health.workoutMinutes7)} min this week`} />
            </Tiles>
          ) : healthAvailable() ? (
            <T small muted>Turn on Apple Health in Settings (gear above) to see steps, sleep, heart rate and more here.</T>
          ) : (
            <T small muted>
              Steps, active energy, sleep, resting heart rate, HRV, VO₂ max, body fat and workouts show here in the installed app. Apple Health isn’t available in Expo Go.
            </T>
          )}
        </Card>

        <Card>
          <H>Nutrition · last 7 days</H>
          <Tiles>
            <Tile label="Calories" value={logged.length ? `${r(avg('kcal'))}` : '—'} sub={`avg · goal ${r(db.goals.kcal)}`} />
            <Tile label="Protein" value={logged.length ? `${r(avg('protein'))} g` : '—'} sub={`avg · goal ${r(db.goals.protein)} g`} />
            <Tile label="Days logged" value={`${logged.length} / 7`} />
            <Tile label="Logging streak" value={`${loggingStreak(db)} days`} />
          </Tiles>
        </Card>

        <Card>
          <H>Training</H>
          <Tiles>
            <Tile label="Workouts" value={String(sessions)} sub="last 7 days" />
            <Tile label="Sets" value={String(recentSets.length)} sub="last 7 days" />
            <Tile label="Program" value={db.program && next ? `Week ${next.week}` : '—'} sub={db.program ? `of ${db.program.weeks.length} · ${db.program.name}` : 'Import one in Workout'} />
            <Tile label="PRs" value={String(prs.length)} sub="last 30 days" />
          </Tiles>
          {prs.map((s) => (
            <View key={s.id} style={[styles.row, { borderTopWidth: 1, borderColor: t.line, paddingVertical: 8 }]}>
              <T style={{ flex: 1 }}>{`🏆 ${s.exercise}`}</T>
              <T bold>{fmtSet(s)}</T>
            </View>
          ))}
        </Card>

        {!editing && (p.name || p.height_in || p.birth_year) && <Button kind="ghost" title="Edit your details" onPress={() => setEditing(true)} />}
      </ScrollView>
    </SafeAreaView>
  );
}
