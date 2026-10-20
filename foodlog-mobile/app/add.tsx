// Add food: scan a barcode, search, photo search (via your server), saved foods.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Field, H, Segmented, T, styles, useTheme } from '@/components/ui';
import { searchBuiltIn } from '@/lib/foodDb';
import { Food, MEALS, Meal, foodTitle, remember, timesLogged } from '@/lib/model';
import * as off from '@/lib/off';
import { Estimate, estimate, loadConfig, usda } from '@/lib/server';
import { error as logError, info, warn } from '@/lib/log';
import { useStore } from '@/lib/store';

function FoodRow({ food, onPress, times }: { food: Food; onPress: () => void; times?: number }) {
  const t = useTheme();
  const per = food.serving_g
    ? `${Math.round((food.kcal * food.serving_g) / 100)} kcal per ${food.serving_label || 'serving'} (${Math.round(food.serving_g)} g)`
    : `${Math.round(food.kcal)} kcal per 100 g`;
  const source = food.id.startsWith('usda-') ? ' · USDA' : '';
  const detail = `${per}${source}${times ? ` · logged ${times}×` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, { borderBottomWidth: 1, borderColor: t.line, paddingVertical: 10, minHeight: 52 }]}>
      <View style={{ flex: 1 }}>
        <T>{foodTitle(food)}</T>
        <T small muted>{detail}</T>
      </View>
      <T muted>›</T>
    </Pressable>
  );
}

function CustomFoodForm({ barcode, est, onDone }: { barcode: string; est: Estimate | null; onDone: (f: Food | null) => void }) {
  const r = (v?: number) => (v == null ? '' : String(Math.round(v * 10) / 10));
  const [name, setName] = useState(est?.name ?? '');
  const [brand, setBrand] = useState(est?.brand ?? '');
  const [serving, setServing] = useState(r(est?.serving_g));
  const [kcal, setKcal] = useState(r(est?.kcal));
  const [protein, setProtein] = useState(r(est?.protein_g));
  const [carbs, setCarbs] = useState(r(est?.carbs_g));
  const [fat, setFat] = useState(r(est?.fat_g));
  const [error, setError] = useState('');
  const t = useTheme();
  const num = (s: string) => {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const save = () => {
    const g = num(serving);
    const k = num(kcal);
    if (!g) return setError('Enter the serving size in grams (it’s on the label).');
    if (k == null) return setError('Enter the calories per serving.');
    if (!name.trim()) return setError('Give the food a name.');
    const per100 = (s: string) => ((num(s) ?? 0) * 100) / g;
    onDone({
      id: barcode || `custom-${Date.now()}`,
      name: name.trim(),
      brand: brand.trim(),
      kcal: (k * 100) / g,
      protein: per100(protein),
      carbs: per100(carbs),
      fat: per100(fat),
      serving_g: g,
      custom: true,
    });
  };
  return (
    <Card style={{ borderColor: t.accent }}>
      <H>{est ? 'Check the AI estimate' : 'New custom food'}</H>
      {!!barcode && <T small muted>{`Barcode ${barcode}`}</T>}
      {est ? (
        <View style={{ backgroundColor: t.soft, borderRadius: 10, padding: 10, marginTop: 6 }}>
          <T bold>{`${est.serving_description} · ${est.confidence} confidence`}</T>
          <T>{est.notes}</T>
        </View>
      ) : (
        <T small muted>Copy these from the nutrition label (per serving).</T>
      )}
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Brand (optional)" value={brand} onChangeText={setBrand} />
      <Field label="Serving size (g)" value={serving} onChangeText={setServing} keyboardType="decimal-pad" />
      <Field label="Calories" value={kcal} onChangeText={setKcal} keyboardType="decimal-pad" />
      <Field label="Protein (g)" value={protein} onChangeText={setProtein} keyboardType="decimal-pad" />
      <Field label="Carbs (g)" value={carbs} onChangeText={setCarbs} keyboardType="decimal-pad" />
      <Field label="Fat (g)" value={fat} onChangeText={setFat} keyboardType="decimal-pad" />
      {!!error && <T style={{ color: t.danger, marginTop: 8 }}>{error}</T>}
      <View style={[styles.row, { marginTop: 12, justifyContent: 'flex-end' }]}>
        <Button kind="ghost" title="Cancel" onPress={() => onDone(null)} />
        <Button kind="primary" title="Save food" onPress={save} />
      </View>
    </Card>
  );
}

/** Snap the package; AI reads what it is; look it up in the databases. */
function PhotoSearch({ barcode, onUseEstimate }: { barcode: string; onUseEstimate: (e: Estimate) => void }) {
  const { setPicked } = useStore();
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [est, setEst] = useState<Estimate | null>(null);
  const [matches, setMatches] = useState<Food[]>([]);
  const t = useTheme();

  const go = async () => {
    setError('');
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError('Camera access is off. Turn it on in Settings › FoodLog.');
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (shot.canceled || !shot.assets[0]) return;
    try {
      setStep('Reading the photo…');
      setEst(null);
      setMatches([]);
      // Smaller photo = faster and cheaper; still plenty to read a package.
      const ctx = ImageManipulator.manipulate(shot.assets[0].uri);
      ctx.resize({ width: 1280 });
      const img = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      const e = await estimate(img.base64 ?? '', barcode ? `Barcode ${barcode} isn't in the food databases. What product is this?` : '');
      if (e.search_query.trim()) {
        setStep(`Looking up “${e.search_query}”…`);
        const [u, o] = await Promise.all([usda(e.search_query).catch(() => []), off.search(e.search_query).catch(() => [])]);
        const found: Food[] = [];
        for (const f of [...u, ...o]) if (!found.some((x) => x.id === f.id)) found.push(f);
        const brand = e.brand.toLowerCase();
        found.sort((a, b) => Number(!brand || !foodTitle(a).toLowerCase().includes(brand)) - Number(!brand || !foodTitle(b).toLowerCase().includes(brand)));
        setMatches(found.slice(0, 6));
      }
      setEst(e);
    } catch (err) {
      logError('photo', 'Photo search failed', err);
      setError((err as Error).message);
    } finally {
      setStep('');
    }
  };

  return (
    <Card style={{ borderColor: t.accent }}>
      <H>📷 Find it from a photo</H>
      <T small muted>
        {barcode
          ? 'Take a photo of the front of the package. AI reads what it is and finds it, and the barcode is remembered.'
          : 'Take a photo of the front of the package, or of your plate.'}
      </T>
      <Button kind="primary" big title={est ? 'Retake photo' : 'Take photo'} busy={!!step} onPress={go} style={{ marginTop: 10 }} />
      {!!step && <T muted small style={{ marginTop: 6 }}>{step}</T>}
      {!!error && <T style={{ color: t.danger, marginTop: 6 }}>{error}</T>}
      {est && (
        <>
          <View style={{ backgroundColor: t.soft, borderRadius: 10, padding: 10, marginTop: 10 }}>
            <T bold>{`Looks like: ${est.brand ? `${est.name} · ${est.brand}` : est.name}`}</T>
            <T>{est.notes}</T>
          </View>
          {matches.length > 0 && <T bold style={{ marginTop: 10 }}>Is it one of these?</T>}
          {matches.map((f) => (
            <FoodRow key={f.id} food={f} onPress={() => { setPicked(barcode ? { ...f, id: barcode } : f); router.push('/amount'); }} />
          ))}
          <Button
            title={`${matches.length ? 'None of these. ' : ''}Use AI’s numbers (${Math.round(est.kcal)} kcal per ${est.serving_description})`}
            onPress={() => onUseEstimate(est)}
            style={{ marginTop: 10 }}
          />
        </>
      )}
    </Card>
  );
}

export default function AddFood() {
  const { db, update, meal, setMeal, setPicked, onScan } = useStore();
  const t = useTheme();
  const [barcode, setBarcode] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ saved: Food[]; common: Food[]; online: Food[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const logged = useMemo(() => timesLogged(db), [db]);
  const yourFoods = useMemo(
    () => [...db.foods].sort((a, b) => (logged.get(b.id) ?? 0) - (logged.get(a.id) ?? 0)),
    [db.foods, logged],
  );
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [photoFor, setPhotoFor] = useState<string | null>(null);
  const [aiEst, setAiEst] = useState<Estimate | null>(null);
  const [hasServer, setHasServer] = useState(false);

  useEffect(() => {
    loadConfig().then((c) => setHasServer(!!c));
  }, []);

  const pick = (f: Food) => {
    setPicked(f);
    router.push('/amount');
  };

  const lookUp = async (raw: string) => {
    const code = raw.replace(/\D/g, '');
    if (code.length < 8) return setStatus('Barcodes are 8 to 13 digits.');
    const saved = db.foods.find((f) => f.id === code);
    if (saved) return pick(saved);
    setBusy(true);
    setStatus(`Looking up ${code}…`);
    try {
      let food = await off.lookup(code);
      if (!food && hasServer) food = (await usda(code, true).catch(() => []))[0] ?? null;
      if (food) {
        setStatus('');
        pick({ ...food, id: code });
      } else if (hasServer) {
        setStatus(`${code} isn't in the food databases. Snap the front of the package and AI will find it.`);
        setPhotoFor(code);
      } else {
        setStatus(`${code} isn't in Open Food Facts yet. Enter it from the label once and it'll be saved.`);
        setCustomFor(code);
      }
    } catch (e) {
      logError('barcode', `Lookup of ${code} failed`, e);
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Barcodes from the scanner come straight here.
  const lookUpRef = useRef(lookUp);
  useEffect(() => {
    lookUpRef.current = lookUp;
  });
  useEffect(() => {
    onScan((code) => {
      setBarcode(code);
      lookUpRef.current(code);
    });
    return () => onScan(null);
  }, [onScan]);

  // Each search gets a number; results from an older, slower search are ignored.
  const searchSeq = useRef(0);
  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    const seq = ++searchSeq.current;
    const stale = () => seq !== searchSeq.current;
    const words = q.toLowerCase().split(/\s+/);
    // 1. Your foods, most-logged first. 2. Built-in common foods (instant, offline).
    const saved = db.foods
      .filter((f) => words.every((w) => foodTitle(f).toLowerCase().includes(w)))
      .sort((a, b) => (logged.get(b.id) ?? 0) - (logged.get(a.id) ?? 0));
    const common = searchBuiltIn(q).filter((f) => !saved.some((s) => s.id === f.id));
    let online: Food[] = [];
    setResults({ saved, common, online });
    setPhotoFor(null);
    setCustomFor(null);
    setBusy(true);
    setStatus('Searching brands…');
    info('search', `Searching "${q}": ${saved.length} of your foods, ${common.length} common foods`);
    const errors: string[] = [];
    // 3. Branded foods online.
    const add = (more: Food[]) => {
      if (stale()) return;
      for (const f of more) if (![...saved, ...common, ...online].some((x) => x.id === f.id)) online = [...online, f];
      setResults({ saved, common, online });
    };
    // Both sources at once; one failing doesn't stop the other.
    await Promise.all([
      hasServer ? usda(q).then(add).catch((e: Error) => errors.push(`USDA: ${e.message}`)) : null,
      off.search(q).then(add).catch((e: Error) => errors.push(e.message)),
    ]);
    if (stale()) return;
    if (errors.length) warn('search', `"${q}" finished with problems`, errors);
    const empty = saved.length + common.length + online.length === 0;
    if (empty && errors.length) setStatus(errors.join(' '));
    else if (empty) setStatus(hasServer ? 'No matches. Snap the package (or your plate) and AI will find it.' : 'No matches. Try fewer words, or add a custom food.');
    else setStatus(errors.length ? `Brand results unavailable: ${errors.join(' ')}` : '');
    if (empty && hasServer) setPhotoFor('');
    setBusy(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <Segmented<Meal> label="Meal" value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m, label: m }))} />

        <Button kind="primary" big title="📷  Scan barcode" onPress={() => router.push('/scan')} style={{ marginVertical: 12 }} />

        <Card>
          <View style={[styles.row, { alignItems: 'flex-end' }]}>
            <Field label="Or type the barcode number" value={barcode} onChangeText={setBarcode} keyboardType="number-pad" placeholder="e.g. 049000028911" onSubmitEditing={() => lookUp(barcode)} />
            <Button title="Look up" onPress={() => lookUp(barcode)} disabled={busy} />
          </View>
        </Card>
        <Card>
          <View style={[styles.row, { alignItems: 'flex-end' }]}>
            <Field label="Search foods" value={query} onChangeText={setQuery} placeholder="e.g. greek yogurt" returnKeyType="search" onSubmitEditing={runSearch} />
            <Button title="Search" onPress={runSearch} />
          </View>
        </Card>
        {!!status && <T muted style={{ marginBottom: 10 }} >{status}</T>}

        {photoFor !== null && (
          <PhotoSearch
            barcode={photoFor}
            onUseEstimate={(e) => {
              setAiEst(e);
              setCustomFor(photoFor);
              setPhotoFor(null);
            }}
          />
        )}
        {customFor !== null && (
          <CustomFoodForm
            key={customFor + (aiEst?.name ?? '')}
            barcode={customFor}
            est={aiEst}
            onDone={(f) => {
              setCustomFor(null);
              setAiEst(null);
              if (f) {
                update((d) => remember(d, f));
                pick(f);
              }
            }}
          />
        )}

        {results && results.saved.length > 0 && (
          <Card>
            <H>Your foods</H>
            {results.saved.map((f) => <FoodRow key={f.id} food={f} times={logged.get(f.id)} onPress={() => pick(f)} />)}
          </Card>
        )}
        {results && results.common.length > 0 && (
          <Card>
            <H>Common foods</H>
            {results.common.map((f) => <FoodRow key={f.id} food={f} onPress={() => pick(f)} />)}
          </Card>
        )}
        {results && results.online.length > 0 && (
          <Card>
            <H>Brands</H>
            {results.online.map((f) => <FoodRow key={f.id} food={f} onPress={() => pick(f)} />)}
          </Card>
        )}

        <Card>
          <View style={styles.row}>
            <H>Your foods</H>
            <View style={{ flexDirection: 'row' }}>
              {hasServer && <Button kind="ghost" title="📷 Photo" onPress={() => setPhotoFor('')} />}
              <Button kind="ghost" title="+ Custom" onPress={() => { setAiEst(null); setCustomFor(''); }} />
            </View>
          </View>
          {yourFoods.length === 0 ? (
            <T muted>Every food you log is saved here, most-used first, for one-tap re-logging.</T>
          ) : (
            <>
              {(showAll ? yourFoods : yourFoods.slice(0, 15)).map((f) => (
                <FoodRow key={f.id} food={f} times={logged.get(f.id)} onPress={() => pick(f)} />
              ))}
              {yourFoods.length > 15 && (
                <Button kind="ghost" title={showAll ? 'Show fewer' : `Show all ${yourFoods.length}`} onPress={() => setShowAll(!showAll)} style={{ alignSelf: 'flex-start' }} />
              )}
            </>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
