# Kalm Mobile API — `/api/v1`

The HTTP contract the Flutter app integrates against. It sits on top of the
existing web app: every endpoint calls the **same** server-side logic the web
client uses (`*.server.ts` / `*.functions.ts`) — no business logic is
reimplemented, and the crisis gate / rate limiter / screener escalation behave
identically to the web.

- **Base URL:** same origin as the web app, e.g. `https://<deployment>/api/v1`
- **Transport:** file-based API routes under `src/routes/api/v1/` (the pattern in
  `src/routes/api/public/hooks/evaluate-nudges.ts`). Not a separate Edge
  Functions project.
- **Status:** Phases 1–3 shipped and tested. This document is the complete v1
  contract for the mobile integration.

---

## Authentication

Send the user's **Supabase access token** as a bearer header on every request
except where marked _no auth_:

```
Authorization: Bearer <supabase access token>
```

In Flutter that token is `Supabase.instance.client.auth.currentSession!.accessToken`
— the same one you use for direct Supabase SDK calls (see
[Direct Supabase access](#direct-supabase-access)).

- Verified by `authenticateBearer` (`src/lib/api-auth.server.ts`), which calls
  `supabase.auth.getUser(token)` — a real round trip, so **expired or revoked
  tokens are rejected**, not just malformed ones.
- Missing / malformed / expired / non-Bearer → `401` and the request does
  **not** proceed. There is no anonymous fallback.
- This is additive; the web app's own auth is unchanged.

### Error model

| Status | Body                                    | When                                             |
| ------ | --------------------------------------- | ----------------------------------------------- |
| `400`  | `{ "error", "details"? }`               | invalid JSON / failed validation                |
| `401`  | `{ "error" }`                           | missing/invalid/expired bearer token            |
| `404`  | `{ "error" }`                           | resource not found / not owned by the caller    |
| `501`  | `{ "error" }`                           | endpoint intentionally not implemented yet      |
| `500`  | `{ "error": "Internal error" }`         | unexpected; details are logged, not returned    |

### All endpoints at a glance

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/api/v1/chat/messages` | yes | send a message; crisis-gated, rate-limited |
| GET  | `/api/v1/crisis-resources` | no | localized crisis resource list |
| GET  | `/api/v1/entitlements` | yes | tier + "N messages left today" |
| GET  | `/api/v1/chat/threads` | yes | list the caller's threads |
| GET  | `/api/v1/chat/threads/:id/messages` | yes | paginated message history |
| POST | `/api/v1/screeners/:type/responses` | yes | submit PHQ-9 / GAD-7; item-9 escalation |
| POST | `/api/v1/onboarding` | yes | complete onboarding (server computes age) |

Everything else — profile, mood, habits, exercises — is read/written
**directly via the Supabase Flutter SDK** under RLS. See
[Direct Supabase access](#direct-supabase-access).

---

## Phase 1 — safety-critical path (shipped)

### `POST /api/v1/chat/messages`

Calls `sendMessageCore` (`src/lib/chat.functions.ts`) — the transport-decoupled
core that the web RPC `sendMessage` also calls, so behaviour is identical on both
paths. The deterministic crisis gate + semantic backstop run **before** the
per-user rate limiter; this endpoint adds nothing ahead of that call. The
ordering guarantee is covered three ways: `runCrisisGate` directly
(`crisis-gate.test.ts`), the HTTP wrapper adds no pre-check
(`src/routes/api/v1/-handlers.test.ts`), and end-to-end through this endpoint
with a client that throws if `chat_rate_limits` is read
(`src/lib/chat-messages-ordering.test.ts`).

**Auth:** required.

**Request**

```json
{ "thread_id": "uuid (optional — omit to start a new thread)",
  "content": "string, 1–4000 chars",
  "quick_action": "string (optional; one of the known quick-action ids)" }
```

**Response `200`** — `reply` is one of two shapes, discriminated by `type`:

_Normal reply_

```json
{
  "thread_id": "uuid",
  "userMessage": { "id": "uuid", "sender": "user", "content": "…",
                   "flagged_crisis": false, "created_at": "ISO-8601" },
  "reply": { "type": "message", "id": "uuid", "content": "…",
             "created_at": "ISO-8601", "actions": [ { "summary": "…", "...": "…" } ] }
}
```

_Crisis reply_ — the **full structured object**; never parse free text for this:

```json
{
  "thread_id": "uuid",
  "userMessage": { "id": "uuid", "sender": "user", "content": "…",
                   "flagged_crisis": true, "created_at": "ISO-8601" },
  "reply": {
    "type": "crisis",
    "severity": "critical | high | moderate",
    "message": "localized supportive message",
    "matched": ["…"],
    "resources": [ { "name": "…", "contact": "…", "detail": "…" } ],
    "disclaimer": "…",
    "id": "uuid",
    "created_at": "ISO-8601"
  }
}
```

When `reply.type === "crisis"` the client must show the crisis UI (message +
`resources` + `disclaimer`) and must not send the text through any normal
message-rendering path.

**Rate / daily-cap notice** is **not** an error: it returns a normal `200` with
`reply.type === "message"`, a warm non-punitive message as `content`, and — when
the daily cap is what tripped — a `reply.limit` object so the client can render
an upgrade prompt without a second call:

```json
"reply": {
  "type": "message", "id": "uuid", "content": "warm message to show",
  "created_at": "ISO-8601", "actions": [],
  "limit": { "reason": "daily", "tier": "free", "dailyLimit": 8,
             "resetsAt": "ISO-8601 (next UTC midnight)" }
}
```

`reply.limit` is absent on a normal reply and on a short-term sliding-window
throttle (`reason` would be `"window"` there, with no upgrade framing). The
`dailyLimit` here is the exact number `GET /api/v1/entitlements` reports — they
come from one source (`dailyMessageCap(tier)` in `src/lib/chat-limits.ts`).

---

### `GET /api/v1/crisis-resources`

The localized resource list `crisisCopy()` produces (`src/lib/crisis.ts`).

**Auth:** _no auth required_, and **never gated**. A bad/expired token, a bad
`lang`, or an internal error still returns `200` with the English list — this
endpoint must never be the reason someone can't reach help.

**Query:** `?lang=en|ar|fr` (optional).

Language resolution: `?lang=` → the authenticated user's `profiles.language` (if
a valid token is sent) → English.

**Response `200`**

```json
{
  "language": "en",
  "resources": [ { "name": "…", "contact": "…", "detail": "…" } ],
  "disclaimer": "…"
}
```

---

## Phase 2 — screeners, entitlements, chat reads (shipped)

### `POST /api/v1/screeners/:type/responses`

Calls `submitScreenerCore` (`src/lib/screeners.server.ts`) as-is, **including the
PHQ-9 item-9 escalation**: an item-9 answer ≥ 1 sets `crisisTriggered: true` and
returns the structured `crisis` object regardless of total score (`item9 === 1` →
`moderate`, `item9 ≥ 2` → `high`). Covered end-to-end through this endpoint by
`src/routes/api/v1/-handlers.phase2.test.ts`.

`:type` is `phq9` or `gad7` (in the path, not the body).

**Auth:** required.

**Request:** `{ "responses": number[] }` — exactly 7 ints (GAD-7) or 9 (PHQ-9),
each `0–3`. Wrong type → `400 "Unknown screener type"`; wrong count →
`400 "<type> expects N responses"`.

**Response `200`**

```json
{ "id": "uuid", "total_score": 0, "severity": "minimal|mild|moderate|…",
  "taken_at": "ISO-8601",
  "crisisTriggered": false,
  "crisis": null }
```

When `crisisTriggered` is `true`, `crisis` is the same structured object as the
crisis chat reply: `{ "type": "crisis", "severity", "message", "matched",
"resources": [ { "name", "contact", "detail" } ], "disclaimer" }`.

### `GET /api/v1/entitlements`

Wraps `getEntitlementsFor` (`src/lib/entitlements.server.ts`). Lets the app show a
real "N messages left today" indicator instead of guessing.

**Auth:** required.

**Response `200`**

```json
{
  "tier": "free | premium | org",
  "chat": { "unlimited": false, "dailyLimit": 8, "dailyCredits": 8,
            "usedToday": 0, "remainingToday": 8,
            "resetsAt": "ISO-8601 (next UTC midnight)" },
  "features": { "unlimitedHistory": false, "liveSessions": false, "dataExport": false }
}
```

- `dailyLimit` — the **enforced** daily message cap for this tier. Same number
  the chat endpoint blocks on (`reply.limit.dailyLimit`); one source of truth
  (`src/lib/chat-limits.ts`). Free = 8 (env `FREE_DAILY_MESSAGE_CAP`); premium /
  org = the high cap (env `CHAT_DAILY_MESSAGE_CAP`, default 200).
- `usedToday` — messages consumed today, from the counter the limiter enforces
  on (`chat_rate_limits.day_count`), so `remainingToday === dailyLimit -
  usedToday` exactly matches when the block will trigger.
- For premium/org, `unlimited` is `true` and `dailyCredits` / `remainingToday`
  are `null` (but `dailyLimit` still carries the real number).
- `liveSessions` is always `false` (not built — see
  [Out of scope](#out-of-scope)).

### `GET /api/v1/chat/threads`

Wraps `listThreadsCore`. **Auth:** required. Newest activity first.

```json
[ { "id": "uuid", "title": "…", "created_at": "ISO-8601", "updated_at": "ISO-8601" } ]
```

There is no thread-create endpoint: a thread is created by
`POST /api/v1/chat/messages` with no `thread_id`, and its id comes back on the
response.

### `GET /api/v1/chat/threads/:id/messages?limit=&before=`

Wraps `getThreadMessagesPageCore`. **Auth:** required. Keyset-paginated,
**newest-first internally but returned ascending for display**. `limit` defaults
to 50 (clamped 1–200); `before` is the previous page's `nextBefore` (an exclusive
ISO `created_at` cursor). `404` if the thread isn't owned by the caller; `400`
for a non-uuid id.

```json
{
  "thread": { "id": "uuid", "title": "…", "created_at": "ISO-8601", "updated_at": "ISO-8601" },
  "messages": [ { "id": "uuid", "sender": "user | assistant | system", "content": "…",
                  "content_type": "text | …", "exercise_slug": null,
                  "flagged_crisis": false, "quick_action": null, "created_at": "ISO-8601" } ],
  "nextBefore": "ISO-8601 | null"
}
```

`nextBefore: null` means the first (oldest) message is in this page — stop
paging.

---

## Phase 3 — onboarding & CRUD-shaped screens (shipped)

### `POST /api/v1/onboarding`

Calls `completeOnboardingCore` (`src/lib/onboarding.functions.ts`) as-is — the
core the web RPC `completeOnboarding` also calls. Tests:
`src/routes/api/v1/-handlers.phase3.test.ts`.

**Auth:** required.

**Request** (mirrors the web onboarding form):

```json
{ "preferred_name": "string",
  "account_type": "general | condition | teen | org_member",
  "privacy_consent": true,
  "ai_context_consent": true,
  "date_of_birth": "YYYY-MM-DD",
  "intro_text": "string?", "goals": ["string"], "stressors": ["string"],
  "existing_diagnosis": "string?", "communication_preference": "string?",
  "topics_to_avoid": "string?", "in_professional_care": false,
  "baseline_mood": 1, "baseline_tags": ["string"] }
```

Everything except `intro_text`/`goals`/`stressors`/`existing_diagnosis`/
`communication_preference`/`topics_to_avoid` (all optional) is required.
`privacy_consent` must be `true`. `baseline_mood` is `1–5`.

> **Contract note (was flagged as a bug — already fixed in the codebase):**
> onboarding does **not** send a hardcoded `age_confirmed_13_plus: true`. The
> client sends a real `date_of_birth`; the **server** computes age, rejects
> under-13, and forces `account_type` to `teen` for anyone under 18. The mobile
> app must collect a real DOB and must not send `age_confirmed_13_plus` at all.

**Responses:** `200 { "ok": true }` · `400` for a malformed body, a
non-`YYYY-MM-DD` `date_of_birth`, or an under-13 DOB (`"Kalm is for people aged
13 and over."`) · `401` without a valid token.

### Direct Supabase access

Every table below is Row-Level-Security-scoped to `auth.uid()` (`FOR ALL` for the
user's own rows; `exercises` is a read-only catalogue). There are **no database
triggers** on any of them. The mobile app talks to these **directly with the
Supabase Flutter SDK** using the user's JWT — no `/api/v1` wrapper is needed.
Decision confirmed: not building CRUD endpoints for these this pass.

| Table                            | Direct access | Notes |
| -------------------------------- | ------------- | ----- |
| `profiles`                       | select / update | one row per user (`id = auth.uid()`) |
| `user_profiles`                  | select / upsert | the free-text intro / goals / stressors (`user_id = auth.uid()`) |
| `mood_logs`                      | select / insert | check-ins; only onboarding sets `is_baseline` — the app inserts with `is_baseline: false` |
| `habits`                         | select / insert / update / delete | user-owned |
| `habit_logs`                     | select / **insert (see below)** | user-owned; upsert on `(habit_id, log_date)` |
| `exercises`                      | select | catalogue, read-only |
| `exercise_completions`           | select / **insert (see below)** | user-owned |
| `screener_responses`             | **select only** | writes MUST use `POST /api/v1/screeners/:type/responses` — a direct insert skips the PHQ-9 item-9 crisis escalation |
| `chat_threads` / `chat_messages` | **select only** | reads OK; sending MUST use `POST /api/v1/chat/messages` — a direct insert skips the crisis gate and rate limiter |

**`exercise_completions` / `habit_logs` — the one caveat.** A direct SDK insert
stores the row correctly, but the web app's `completeExercise` / `logHabit`
server functions also do two extra things a direct insert will **not**: (1) an
optional follow-up `mood_logs` row when the user logs a mood after an exercise,
and (2) a short "activity card + companion reaction" posted into the user's chat
thread (streak / effectiveness aware). None of that is required for correctness
or safety — the data and the Insights screens work fine either way — it's the
in-chat encouragement loop. If the mobile app wants parity, insert the
`mood_logs` row itself and skip the chat side; otherwise a dedicated
`POST /api/v1/exercises/completions` / `POST /api/v1/habits/logs` endpoint can be
added later. Not built now (agreed low-priority).

Rule of thumb: **reads → Supabase SDK directly; anything that can trigger crisis
handling, rate limiting, or the companion → the `/api/v1` endpoint.**

---

## Out of scope

Not built at any layer; no endpoint depends on them, and none will be added in
this pass:

- **Push notifications** — no device-token storage, no send path.
- **Live call / live sessions** — `entitlements.features.liveSessions` is a
  permanent `false` placeholder.
- **Payments / subscriptions / receipt validation** — `subscription_tier` exists
  as a column but there is no billing flow; `src/lib/billing/receipt-validation.ts`
  is an interface-only stub that returns `501`.
- **Org / workplace tier** — `account_type: "org_member"` / `tier: "org"` are
  accepted enum values with no org backend behind them.

---

## Changelog

- **Phase 1** — `authenticateBearer` + `POST /api/v1/chat/messages` +
  `GET /api/v1/crisis-resources`. `sendMessage`'s body was extracted to
  `sendMessageCore(supabase, userId, input)` so both transports share one code
  path with no ambient-context dependency. Tests: `src/lib/api-auth.test.ts` (11),
  `src/routes/api/v1/-handlers.test.ts` (10),
  `src/lib/chat-messages-ordering.test.ts` (2). `POST /api/v1/chat/send` (earlier
  scaffold) renamed to `POST /api/v1/chat/messages`.
- **Phase 2** — `POST /api/v1/screeners/:type/responses`, `GET /api/v1/entitlements`,
  `GET /api/v1/chat/threads`, `GET /api/v1/chat/threads/:id/messages`.
  `listThreads` / `getThreadHistory` bodies extracted to `listThreadsCore` /
  `getThreadHistoryCore`, plus a new `getThreadMessagesPageCore` for keyset
  pagination. `handle()` now maps `"… not found"` → `404`. The old
  `GET /api/v1/chat/history?thread_id=` still exists but is superseded by
  `…/threads/:id/messages`. Tests: `src/routes/api/v1/-handlers.phase2.test.ts`
  (14), including the PHQ-9 item-9 escalation through the endpoint.
- **Phase 3** — `POST /api/v1/onboarding` (`completeOnboarding`'s body extracted
  to `completeOnboardingCore`; `GET /api/v1/onboarding` dropped — profile reads
  go to `GET /api/v1/profile` or the SDK). Finalized the direct-Supabase-access
  table: verified RLS on every listed table and that there are no DB triggers;
  flagged that direct `exercise_completions` / `habit_logs` inserts skip the
  web's companion-feedback side effects. Tests:
  `src/routes/api/v1/-handlers.phase3.test.ts` (6). Full suite: 59 passing.
