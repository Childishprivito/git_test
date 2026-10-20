// Coach's AI connection. Any provider works: Coach speaks one simple chat
// format, and each provider gets a small adapter.
//  - Claude: Anthropic's official SDK.
//  - OpenRouter, OpenAI, Google Gemini and local models (Ollama, LM Studio)
//    all accept the OpenAI-style chat API, so they share one adapter.
import Anthropic from '@anthropic-ai/sdk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { COACH_TOOLS, CoachIndex } from './coachIndex';

export type ProviderId = 'openrouter' | 'anthropic' | 'openai' | 'google' | 'custom';

export interface Provider {
  id: ProviderId;
  name: string;
  kind: 'anthropic' | 'openai-compatible';
  baseUrl: string;
  defaultModel: string;
  keyHelp: string;
  keyOptional?: boolean;
}

export const PROVIDERS: Provider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter (any model)',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    keyHelp: 'Sign in below, or paste a key from openrouter.ai › Keys.',
  },
  {
    id: 'anthropic',
    name: 'Claude',
    kind: 'anthropic',
    baseUrl: '',
    defaultModel: 'claude-opus-5-5',
    keyHelp: 'An API key from platform.claude.com › API keys (billed per use, separate from a Claude subscription).',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5',
    keyHelp: 'An API key from platform.openai.com › API keys.',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-flash-latest',
    keyHelp: 'An API key from aistudio.google.com › Get API key.',
  },
  {
    id: 'custom',
    name: 'Local or custom',
    kind: 'openai-compatible',
    baseUrl: 'http://192.168.1.10:11434/v1',
    defaultModel: 'llama3.1',
    keyHelp: 'Any OpenAI-compatible server, e.g. Ollama on your Mac. Key is optional.',
    keyOptional: true,
  },
];

export interface AiConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string;
}

const CONFIG = 'foodlog.coach.ai';
const KEY = 'foodlog.coach.key';

// Keys live in the iOS keychain; the web build (testing only) falls back to storage.
const secret = {
  get: () => (Platform.OS === 'web' ? AsyncStorage.getItem(KEY) : SecureStore.getItemAsync(KEY)),
  set: (v: string) => (Platform.OS === 'web' ? AsyncStorage.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v)),
  del: () => (Platform.OS === 'web' ? AsyncStorage.removeItem(KEY) : SecureStore.deleteItemAsync(KEY)),
};

export const providerOf = (id: ProviderId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

export async function loadAi(): Promise<{ config: AiConfig; key: string } | null> {
  try {
    const config = JSON.parse((await AsyncStorage.getItem(CONFIG)) ?? 'null') as AiConfig | null;
    if (!config) return null;
    const key = (await secret.get()) ?? '';
    if (!key && !providerOf(config.provider).keyOptional) return null;
    return { config, key };
  } catch {
    return null;
  }
}

export async function saveAi(config: AiConfig, key: string) {
  await AsyncStorage.setItem(CONFIG, JSON.stringify(config));
  if (key) await secret.set(key);
  else await secret.del();
}

export async function forgetAi() {
  await AsyncStorage.removeItem(CONFIG);
  await secret.del();
}

// ---- OpenRouter sign-in (OAuth PKCE: the user approves, we get their own key)

const b64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function openRouterSignInUrl(callbackUrl: string): Promise<{ url: string; verifier: string }> {
  const verifier = b64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(32))));
  const challenge = b64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const url = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${challenge}&code_challenge_method=S256`;
  return { url, verifier };
}

export async function openRouterExchange(code: string, verifier: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!res.ok) throw new Error(`OpenRouter sign-in failed (${res.status})`);
  const { key } = (await res.json()) as { key?: string };
  if (!key) throw new Error('OpenRouter sign-in returned no key');
  return key;
}

// ---- Chat

/** What the chat screen keeps: plain text turns, the same for every provider. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Tools Coach looked at while answering (shown as a small note). */
  looked?: string[];
}

export function systemPrompt(today: string) {
  return [
    'You are Coach, a friendly, direct nutrition and strength coach inside the FoodLog app.',
    `Today is ${today}. Weights are in lb; food amounts in grams.`,
    "You can read the user's food log, goals, Apple Health activity, training program and every logged set through tools.",
    'Look up the numbers with the tools before answering; never guess or invent data. If something is not logged, say so.',
    'Answers are read on a phone: keep them short, lead with the answer, use short bullet lists when helpful.',
    'Give practical coaching. You are not a doctor: for pain, injury or medical conditions, suggest seeing a professional.',
  ].join('\n');
}

const MAX_ROUNDS = 8;

export async function askCoach(
  ai: { config: AiConfig; key: string },
  history: ChatTurn[],
  index: CoachIndex,
  today: string,
): Promise<ChatTurn> {
  const p = providerOf(ai.config.provider);
  const model = ai.config.model.trim() || p.defaultModel;
  return p.kind === 'anthropic'
    ? askClaude(ai.key, model, history, index, today)
    : askOpenAiCompatible(ai.config.baseUrl.trim() || p.baseUrl, ai.key, model, history, index, today, p.id);
}

async function askClaude(apiKey: string, model: string, history: ChatTurn[], index: CoachIndex, today: string): Promise<ChatTurn> {
  // Running in the app with the user's own key, so browser-style use is expected.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const tools: Anthropic.Beta.BetaTool[] = COACH_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
    strict: true,
  }));
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((h) => ({ role: h.role, content: h.text }));
  const looked: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: systemPrompt(today),
      tools,
      messages,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') return { role: 'assistant', text: "Sorry, I can't help with that one.", looked };
    // Keep the whole reply (thinking and tool calls included) for the next round.
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { role: 'assistant', text: text || '(no answer)', looked };
    }
    // All results go back in one message.
    messages.push({
      role: 'user',
      content: calls.map((c) => {
        looked.push(c.name);
        return { type: 'tool_result' as const, tool_use_id: c.id, content: index.run(c.name, c.input as Record<string, unknown>) };
      }),
    });
  }
  return { role: 'assistant', text: 'That took too many lookups. Try a narrower question.', looked };
}

interface OaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

async function askOpenAiCompatible(
  baseUrl: string,
  key: string,
  model: string,
  history: ChatTurn[],
  index: CoachIndex,
  today: string,
  provider: ProviderId,
): Promise<ChatTurn> {
  const tools = COACH_TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const messages: OaMessage[] = [{ role: 'system', content: systemPrompt(today) }, ...history.map((h) => ({ role: h.role, content: h.text }))];
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  if (provider === 'openrouter') headers['x-title'] = 'FoodLog Coach';
  const looked: string[] = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, tools }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${res.status} from the AI: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { choices?: { message?: OaMessage }[] };
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('The AI sent an empty reply.');
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) return { role: 'assistant', text: (msg.content ?? '').trim() || '(no answer)', looked };
    for (const c of msg.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(c.function.arguments || '{}');
      } catch {
        // fall through with empty input; the tool will say what's missing
      }
      looked.push(c.function.name);
      messages.push({ role: 'tool', tool_call_id: c.id, content: index.run(c.function.name, input) });
    }
  }
  return { role: 'assistant', text: 'That took too many lookups. Try a narrower question.', looked };
}
