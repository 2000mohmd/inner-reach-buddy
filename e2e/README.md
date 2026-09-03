# End-to-end tests (Playwright)

`npm test` (vitest) covers unit + contract logic. These specs drive a real build
of the app in a browser and hit the HTTP API surface.

## Running

```bash
npm run test:e2e            # headless
npm run test:e2e -- --ui    # interactive
npm run test:e2e -- --headed --project=chromium e2e/public.spec.ts
```

The config (`playwright.config.ts`) builds the app and serves it with
`vite preview` on `:8080`. If a dev server is already running there it's reused.

## Install

Playwright is **not** in `package.json` — `bun.lock` is the tracked lockfile and
adding an npm dep would desync it. It's installed on demand:

```bash
npm install --no-save @playwright/test
npx playwright install chromium
```

To make it a tracked dev dependency, add it with bun so `bun.lock` stays in
sync: `bun add -d @playwright/test`.

## What's covered

| Spec | Scope |
|---|---|
| `public.spec.ts` | landing, `/auth` (email/password + Google/Apple OAuth buttons), `/crisis` never-gated, `/legal`, protected routes redirect to `/auth` |
| `api.spec.ts` | `GET /api/v1/crisis-resources` (no auth, `?lang=` localisation, graceful fallback); every other `/api/v1/*` endpoint → 401 without a bearer token; `/api/public/unsubscribe` bad-token → 400 |
| `i18n.spec.ts` | language switcher flips `<html lang/dir>`, Arabic → RTL, persists across reload |
| `authenticated.spec.ts` | signed-in flows (chat composer, Settings "Emails from Kalm" + "What Kalm remembers about you"). **Skipped** unless `E2E_EMAIL` / `E2E_PASSWORD` point at an already-onboarded throwaway account |

## Not covered here

CI runs typecheck / lint / vitest / build only — these E2E specs are a local/
manual gate (they need a browser download and a server). Wire them into a
separate CI job when there's a stable seeded test account.
