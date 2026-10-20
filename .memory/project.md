# FoodLog — project memory

Personal MyFitnessPal-style app (free barcode scanner) + workout tracker.
Owner is on **iPhone**, works mostly **from the phone** (no Mac). Keep replies
short and phone-friendly. Last updated: 2026-10-19.

## Where things live (repo: Childishprivito/git_test, default branch `master`)

| Folder | What | Status |
| --- | --- | --- |
| `foodlog/` | **Web app** in Rust (Leptos → WebAssembly), installable PWA | **Live**: https://childishprivito.github.io/git_test/ |
| `foodlog-core/` | Shared Rust crate: data model + sync merge, Open Food Facts/USDA parsing, AI estimate schema, workout model/PRs, `.ods/.xlsx` reader (feature `import`) | Used by web app + server |
| `foodlog-worker/` | **Server** in Rust on Cloudflare Workers: `/sync` (KV), `/estimate` (Claude, photo → product + nutrition), `/usda` | Code done, **not deployed** (secrets missing) |
| `foodlog-mobile/` | **Expo / React Native** app (**SDK 57**, Expo Router, TS) — same features + Apple Health | Linked to Expo; publishing via EAS Workflows |

Workflows: `.github/workflows/foodlog.yml` (test + build + deploy web to Pages on master),
`foodlog-worker.yml` (deploy server; skips until Cloudflare secrets exist),
`mobile.yml` (typecheck + lint; optional EXPO_TOKEN publish/build).
Expo-side workflow: `foodlog-mobile/.eas/workflows/publish-preview.yml` (EAS Update → branch `preview` on push to master).

## Features built
- **Food**: barcode scan (web: rxing in Rust/wasm; mobile: expo-camera), Open Food Facts lookup/search,
  USDA search + UPC fallback (via server), custom foods, diary by meal, goals, totals.
- **Photo search** (needs server): unknown barcode/empty search → photo of package front → Claude reads
  brand/product + estimates nutrition → search USDA/OFF with its query → pick match (saved under the
  barcode) or "Use AI's numbers" → editable form. Model `claude-opus-5-5` (MODEL var in wrangler.toml),
  structured output via `output_config.format`, `fallbacks: "default"` + beta header `server-side-fallback-2026-07-01`.
- **Sync** (needs server): whole log merged (union by id, tombstones `deleted`/`deleted_sets`, newest
  goals/program by timestamp). Web and mobile share the exact JSON format.
- **Workouts**: import program spreadsheet (.ods/.xlsx) on-device (Jeff Nippard layout: "Week N | Exercise | …",
  Set 1..N columns, video links), up next, week browser, session logging with last-time prefill,
  substitutions, PRs (heaviest + Epley e1RM), quick log, PR list with history. Units: lb.
- **Apple Health** (mobile only, `@kingstinct/react-native-healthkit` 16.2.0): saves meal macros + strength
  workouts, reads today's steps/active kcal. No-op in Expo Go/web.

## Accounts / setup state
- GitHub Pages: source = GitHub Actions (done).
- **Expo**: login `dauno`, owner/team **`daunos-team`** (app.json `owner` must match the project's owner), project **projectfitness**, ID `aac44430-ef08-4e0e-baff-2f5a2affd45f`
  (app.json slug `projectfitness`, name "FoodLog"). GitHub repo linked on expo.dev with base directory
  `/foodlog-mobile`. First EAS workflow was running at time of writing → then open Updates › preview in Expo Go.
- **Cloudflare server — TODO (user)**: add repo secrets `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers"
  template), `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `APP_PASSWORD` (optional `USDA_API_KEY`), then run
  "FoodLog server" workflow; put the workers.dev URL + password in app Settings › Sync & AI.
- **Apple Health on device — TODO**: needs Apple Developer Program ($99/yr); then EAS build → TestFlight
  (`mobile.yml` dispatch with build_ios, or eas.json production profile).
- **Coach (AI tab)**: tabs are Diary · Coach · Workout · Settings; Add food is a pushed screen (`app/add.tsx`)
  opened from the Diary's "+ Add food" button. Coach is provider-agnostic (`lib/ai.ts`): Claude via the official
  `@anthropic-ai/sdk` (claude-opus-5-5, effort low, `fallbacks: "default"`), and one OpenAI-compatible adapter for
  OpenAI, Gemini, and local/custom servers (Ollama). OpenRouter was tried and removed at the user's request. Keys in
  expo-secure-store. The "local index" is `lib/coachIndex.ts`: 8 tools over the on-phone log (overview, meals,
  nutrition trends, food search, exercises, exercise history, workouts, program day); the AI calls them as needed.
  Login research (Oct 2026): Claude subscription login in third-party apps is NOT allowed (API key only);
  OpenAI "Sign in with ChatGPT" (Sep 2026) allows plan usage for open-source/personal apps — not built yet.
  Future: a paid house agent; an MCP server on the worker so Claude/ChatGPT apps can use the data.

## Decisions & constraints
- User's PPL spreadsheet is **copyrighted (Jeff Nippard)** — never commit it or its contents; it is imported
  on the phone only. Test the importer with `IMPORT_TEST_FILE=<path> cargo test --features import imports_real_file -- --nocapture`.
- User leans toward going all-in on Expo; consider freezing new features on the Rust web app.
- Apple Health via Shortcuts for the web app was discussed and parked.
- D1 instead of KV for the server (point-in-time restore) was proposed, not done.
- Ideas not built yet: rest timer after logging a set; weekly charts/export.

## Working notes for future sessions
- **Stay on the Expo SDK that App Store Expo Go supports** (Expo Go 57.0.9 → SDK 57 as of 2026-10-20).
  SDK 58 was out but Expo Go showed "Project is incompatible with this version of Expo Go".
  Only move to a newer SDK once Expo Go › Settings › Supported SDK shows it (or once using a dev/TestFlight build).
- **Never rely on try/catch around require() of a native module**: React Native's module loader
  (`guardedLoadModule`) calls `ErrorUtils.reportFatalError` and shows a red crash screen. Check first
  (`TurboModuleRegistry.get(...)`, `Constants.executionEnvironment === ExecutionEnvironment.StoreClient`).
- Planned testing setup (user decided to fully invest in Expo): EXPO_TOKEN as an environment secret +
  network access to Expo hosts → `eas workflow:runs`/`workflow:logs`, `eas update` straight from the
  sandbox (no queue), and EAS Simulator (`eas simulator:*`, experimental remote iOS simulator with
  agent-device/Appium automation) to drive and screenshot the app.
- Expo Go must be signed in as a member of `daunos-team` (the project is private) or it shows HTTP 403.
- Sandbox network blocks openfoodfacts, docs.expo.dev, api.expo.dev, *.github.io, cloudflare — test with
  Playwright route mocks; use `EXPO_OFFLINE=1` for `npx expo install/config/prebuild/lint/export`.
- Expo APIs drift: read package `.d.ts` files in node_modules (docs site blocked). AGENTS.md in foodlog-mobile.
- Don't `pkill -f <pattern>` from a Bash command whose own text contains the pattern (kills the shell);
  use a script file.
- Leptos `view!`: wrap attribute closures containing `>`/`<` in braces.
- Toasts from async tasks: web app uses a thread_local TOAST signal (context isn't available there).
- Commit trailers required by the session; don't put model names in commits/code.
- Merge to master = deploys web app + triggers Expo publish; user has asked for each merge explicitly so far.
