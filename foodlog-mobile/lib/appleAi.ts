// Apple's on-device model (Apple Intelligence, iOS 26+) as a Coach provider.
// Free, offline and private: nothing leaves the phone. Needs a development or
// TestFlight build; in Expo Go (and on web/Android) it reports "not available".
import { Platform, TurboModuleRegistry } from 'react-native';

import type { ChatTurn } from './ai';
import { COACH_TOOLS, type CoachIndex } from './coachIndex';
import { error as logError, info } from './log';

type AppleMod = typeof import('@react-native-ai/apple');

let mod: AppleMod | null | undefined;
function load(): AppleMod | null {
  if (mod !== undefined) return mod;
  mod = null;
  if (Platform.OS !== 'ios') return mod;
  // The package looks its native module up as soon as it loads, and a failed
  // module load crashes the app, so check the module is there first.
  if (TurboModuleRegistry.get('NativeAppleLLM') == null) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@react-native-ai/apple') as AppleMod;
  } catch (e) {
    logError('coach', 'Could not load the Apple model', e);
    mod = null;
  }
  return mod;
}

/** True when this phone can run Apple's on-device model right now. */
export function appleAvailable(): boolean {
  const m = load();
  if (!m) return false;
  try {
    return m.apple.isAvailable();
  } catch {
    return false;
  }
}

// The on-device model has a small context window: keep everything short.
const MAX_TURNS = 6;
const MAX_TOOL_CHARS = 1800;

export async function askApple(history: ChatTurn[], index: CoachIndex, system: string): Promise<ChatTurn> {
  const m = load();
  if (!m || !m.apple.isAvailable()) {
    throw new Error('Apple Intelligence isn’t available on this phone. It needs an iPhone 15 Pro or newer with Apple Intelligence turned on, and the installed app (not Expo Go).');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generateText, jsonSchema, tool } = require('ai') as typeof import('ai');
  const looked: string[] = [];
  const tools = Object.fromEntries(
    COACH_TOOLS.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: jsonSchema<Record<string, unknown>>(t.parameters as Parameters<typeof jsonSchema>[0]),
        execute: async (input: Record<string, unknown>) => {
          looked.push(t.name);
          const out = index.run(t.name, input ?? {});
          return out.length > MAX_TOOL_CHARS ? `${out.slice(0, MAX_TOOL_CHARS)}… (cut short)` : out;
        },
      }),
    ]),
  );
  const started = Date.now();
  // Apple runs the tool calls itself, inside one request.
  const provider = m.createAppleProvider({ availableTools: tools });
  const res = await generateText({
    model: provider(),
    system,
    messages: history.slice(-MAX_TURNS).map((h) => ({ role: h.role, content: h.text })),
    tools,
  });
  info('coach', `Apple on-device model answered in ${Date.now() - started} ms`, { looked });
  return { role: 'assistant', text: res.text.trim() || '(no answer)', looked };
}
