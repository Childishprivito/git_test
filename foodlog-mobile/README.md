# FoodLog mobile (Expo / React Native)

The FoodLog app as a native iPhone (and Android) app, built with Expo. Same
features as the web app: diary, barcode scanning, food search, photo search,
workouts with PRs, plus **Apple Health**: meals and workouts are saved to
Health, and today's steps and active calories show on the diary.

It uses the same log format and the same server (`../foodlog-worker`) as the
web app, so both stay in sync.

## Try it free with Expo Go (no Mac, no Apple fee)

Everything except Apple Health works in the free **Expo Go** app.

The app is linked to the Expo project `daunos-team/projectfitness`, and that project is
connected to this GitHub repo (expo.dev › project › Project settings › GitHub,
base directory `/foodlog-mobile`). On every push to `master`, Expo runs
`.eas/workflows/publish-preview.yml` and publishes the app.

1. Install **Expo Go** from the App Store and sign in with the same Expo account.
2. On expo.dev open the project › **Updates** › `preview`, and tap
   **Open with Expo Go** (or scan its QR code with the iPhone camera).

## The real app with Apple Health

HealthKit only works in your own build of the app (not in Expo Go). That
needs the **Apple Developer Program ($99/year)**:

1. Join at developer.apple.com.
2. On expo.dev, link your Apple account to the project (Credentials), or run
   `npx eas-cli build -p ios` once from any computer and sign in when asked.
3. Actions › **FoodLog mobile** › Run workflow with **Build iPhone app** ticked.
   EAS builds it in the cloud and sends it to **TestFlight**; install from there.
4. In the app: Settings › Apple Health › turn it on and allow access.

## Develop (with a computer)

```sh
cd foodlog-mobile
npm install
npx expo start          # scan the QR code with your phone's camera (Expo Go)
npx tsc --noEmit        # typecheck
npx expo lint           # lint
```

## Code map

| Path | What it does |
| --- | --- |
| `app/(tabs)/index.tsx` | Diary: totals, goals, meals, Apple Health activity |
| `app/(tabs)/add.tsx` | Add food: scan, barcode, search, photo search, custom foods |
| `app/(tabs)/workout.tsx` | Program import, up next, weeks, quick log, PRs |
| `app/session.tsx` | A workout day: last time, PRs, logging sets |
| `app/(tabs)/settings.tsx` | Goals, server, Apple Health |
| `app/scan.tsx` / `app/amount.tsx` | Barcode scanner / "How much?" sheet |
| `lib/model.ts` | Data format shared with the web app, merging for sync |
| `lib/workout.ts` | PRs, last session, up next |
| `lib/importSheet.ts` | Reading .ods/.xlsx programs (on the phone only) |
| `lib/health.ts` | Apple Health (safe no-op in Expo Go) |
| `lib/server.ts`, `lib/off.ts` | Your server (sync, USDA, AI) and Open Food Facts |
| `lib/store.tsx` | App state, saving and syncing |
