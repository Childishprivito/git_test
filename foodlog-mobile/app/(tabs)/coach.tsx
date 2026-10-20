// Coach: chat with an AI coach that can look up your meals, workouts, PRs and
// Apple Health activity (lib/coachIndex.ts). Works with any AI (lib/ai.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, Field, H, T, styles, useTheme } from '@/components/ui';
import { AiConfig, ChatTurn, PROVIDERS, ProviderId, askCoach, forgetAi, loadAi, providerOf, saveAi } from '@/lib/ai';
import { appleAvailable } from '@/lib/appleAi';
import { Activity, coachSnapshot } from '@/lib/coach';
import { CoachIndex } from '@/lib/coachIndex';
import { healthAvailable, todayActivity } from '@/lib/health';
import { dateString } from '@/lib/model';
import { error as logError } from '@/lib/log';
import { useStore } from '@/lib/store';

const CHAT = 'foodlog.coach.chat';
const SUGGESTIONS = ['How was my protein this week?', "What's my next workout?", 'Am I getting stronger on bench?', 'What should I eat for dinner to hit my goals?'];

type Ai = { config: AiConfig; key: string };

function Connect({ current, onDone, onCancel }: { current: Ai | null; onDone: (ai: Ai) => void; onCancel?: () => void }) {
  const t = useTheme();
  const { db } = useStore();
  const [provider, setProvider] = useState<ProviderId>(current?.config.provider ?? 'anthropic');
  const p = providerOf(provider);
  const [model, setModel] = useState(current?.config.model ?? p.defaultModel);
  const [baseUrl, setBaseUrl] = useState(current?.config.baseUrl ?? p.baseUrl);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const choose = (id: ProviderId) => {
    const np = providerOf(id);
    setProvider(id);
    setModel(np.defaultModel);
    setBaseUrl(np.baseUrl);
    setError('');
  };

  const save = async (k: string) => {
    if (!k.trim() && !p.keyOptional) return setError('Paste your API key first.');
    if (p.kind === 'apple' && !appleAvailable()) return setError('Apple Intelligence isn’t available here. It needs the installed app on an iPhone 15 Pro or newer.');
    const ai = { config: { provider, model: model.trim() || p.defaultModel, baseUrl: baseUrl.trim() }, key: k.trim() };
    await saveAi(ai.config, ai.key);
    onDone(ai);
  };

  return (
    <>
      <Card>
        <H>Connect an AI</H>
        <T small muted style={{ marginBottom: 8 }}>
          Coach works with whichever AI you like. Your key stays on this phone.
        </T>
        {PROVIDERS.map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: x.id === provider }}
            onPress={() => choose(x.id)}
            style={[styles.row, { paddingVertical: 10, borderBottomWidth: 1, borderColor: t.line, minHeight: 46 }]}>
            <T bold={x.id === provider}>{x.name}</T>
            <T style={{ color: t.accent }}>{x.id === provider ? '●' : '○'}</T>
          </Pressable>
        ))}
        <View style={{ height: 10 }} />
        <T small muted>{p.keyHelp}</T>
        {p.kind === 'apple' ? (
          <T bold style={{ marginTop: 8, color: appleAvailable() ? t.accent : t.danger }}>
            {appleAvailable() ? '✓ Apple Intelligence is ready on this phone' : 'Not available here (Expo Go, web, or a phone without Apple Intelligence)'}
          </T>
        ) : (
          <>
            <Field label={p.keyOptional ? 'API key (optional)' : 'API key'} value={key} onChangeText={setKey} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder={current ? 'Leave empty to keep the saved key' : ''} />
            <Field label="Model" value={model} onChangeText={setModel} autoCapitalize="none" autoCorrect={false} />
          </>
        )}
        {p.kind === 'openai-compatible' && (
          <Field label="Server address" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        )}
        {!!error && <T style={{ color: t.danger, marginTop: 8 }}>{error}</T>}
        <View style={[styles.row, { marginTop: 12, justifyContent: 'flex-end' }]}>
          {onCancel && <Button kind="ghost" title="Cancel" onPress={onCancel} />}
          <Button kind="primary" title="Save" onPress={() => save(key || (current?.config.provider === provider ? current.key : ''))} />
        </View>
      </Card>
      <Card>
        <H>No AI account?</H>
        <T small muted style={{ marginBottom: 8 }}>Send a snapshot of your data to the ChatGPT or Claude app and ask there.</T>
        <Button title="Share my snapshot" onPress={() => Share.share({ message: `You are Coach, my nutrition and strength coach. Here is my data:\n\n${coachSnapshot(db, null)}\n\nGive me a short check-in.` })} />
      </Card>
    </>
  );
}

function Bubble({ turn }: { turn: ChatTurn }) {
  const t = useTheme();
  const mine = turn.role === 'user';
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '88%', marginBottom: 10 }}>
      <View style={{ backgroundColor: mine ? t.accent : t.card, borderRadius: 16, padding: 12, borderWidth: mine ? 0 : 1, borderColor: t.line }}>
        <T style={mine ? { color: t.accentText } : undefined}>{turn.text}</T>
      </View>
      {!!turn.looked?.length && <T small muted style={{ marginTop: 4 }}>{`Looked at: ${[...new Set(turn.looked)].map((n) => n.replace(/^get_|_/g, ' ').trim()).join(', ')}`}</T>}
    </View>
  );
}

export default function Coach() {
  const { db } = useStore();
  const t = useTheme();
  const [ai, setAi] = useState<Ai | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState<Activity | null>(null);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    loadAi().then(setAi);
    AsyncStorage.getItem(CHAT).then((s) => s && setChat(JSON.parse(s) as ChatTurn[])).catch(() => {});
    if (healthAvailable()) todayActivity().then(setActivity).catch(() => setActivity(null));
  }, []);

  const index = useMemo(() => new CoachIndex(db, activity), [db, activity]);

  const keep = (next: ChatTurn[]) => {
    setChat(next);
    AsyncStorage.setItem(CHAT, JSON.stringify(next.slice(-40))).catch(() => {});
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || !ai || thinking) return;
    setDraft('');
    setError('');
    const next = [...chat, { role: 'user' as const, text: q }];
    keep(next);
    setThinking(true);
    try {
      // Only recent turns go to the AI; it looks up older data with tools.
      const reply = await askCoach(ai, next.slice(-12), index, dateString(0));
      keep([...next, reply]);
    } catch (e) {
      logError('coach', 'Coach could not answer', e);
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  if (ai === undefined) return <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} />;

  const p = ai ? providerOf(ai.config.provider) : null;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={80}>
        <ScrollView ref={scroll} contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          <View style={styles.row}>
            <H level={1}>Coach</H>
            {ai && !editing && <Button kind="ghost" title="AI settings" onPress={() => setEditing(true)} />}
          </View>

          {!ai || editing ? (
            <>
              <Connect
                current={ai}
                onDone={(a) => {
                  setAi(a);
                  setEditing(false);
                }}
                onCancel={ai ? () => setEditing(false) : undefined}
              />
              {ai && (
                <Button kind="ghost" title="Disconnect this AI" onPress={async () => { await forgetAi(); setAi(null); setEditing(false); }} />
              )}
            </>
          ) : (
            <>
              <T small muted style={{ marginBottom: 12 }}>{`${p!.name} · ${ai.config.model}. Coach looks up your meals, workouts, PRs and Health data on this phone as it answers.`}</T>
              {chat.length === 0 && (
                <View style={{ marginBottom: 8 }}>
                  {SUGGESTIONS.map((s) => (
                    <Button key={s} title={s} onPress={() => send(s)} style={{ marginBottom: 8 }} />
                  ))}
                </View>
              )}
              {chat.map((turn, i) => <Bubble key={i} turn={turn} />)}
              {thinking && <T muted>Coach is looking at your data…</T>}
              {!!error && <T style={{ color: t.danger, marginTop: 8 }}>{error}</T>}
              {chat.length > 0 && !thinking && <Button kind="ghost" title="Clear chat" onPress={() => keep([])} style={{ alignSelf: 'flex-start' }} />}
            </>
          )}
        </ScrollView>
        {ai && !editing && (
          <View style={{ flexDirection: 'row', padding: 10, gap: 8, borderTopWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
            <TextInput
              accessibilityLabel="Message Coach"
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask Coach…"
              placeholderTextColor={t.muted}
              multiline
              style={{ flex: 1, fontSize: 17, color: t.text, backgroundColor: t.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 120 }}
            />
            <Button kind="primary" title="Send" disabled={!draft.trim() || thinking} onPress={() => send(draft)} />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
