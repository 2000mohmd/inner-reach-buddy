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
- **Status:** Phase 1 shipped and tested. Phases 2–3 below are the agreed
  contract; endpoints land incrementally and this file is updated as they do.

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

Rate-limited (free tier, daily cap reached) is **not** an error: it returns a
normal `200` with `reply.type === "message"` and a supportive system message as
`content`. Read [`GET /api/v1/entitlements`](#get-apiv1entitlements) to show a
counter before the user hits it.

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

## Phase 2 — screeners, entitlements, chat reads (in progress)

Contracts below are agreed; wiring lands next. Each wraps existing logic as-is.

### `POST /api/v1/screeners/:type/responses`

Wraps `submitScreenerCore` (`src/lib/screeners.server.ts`), **including the PHQ-9
item-9 escalation** (item 9 ≥ 1 triggers the crisis pathway regardless of total
score). `:type` is `phq9` or `gad7`.

**Auth:** required.

**Request:** `{ "responses": number[] }` — 7 ints (GAD-7) or 9 ints (PHQ-9), each
`0–3`.

**Response `200`**

```json
{ "id": "uuid", "total_score": 0, "severity": "…", "taken_at": "ISO-8601",
  "crisisTriggered": false,
  "crisis": null }
```

When `crisisTriggered` is `true`, `crisis` is the same structured object as the
crisis reply above (`type`, `severity`, `message`, `resources`, `disclaimer`).

### `GET /api/v1/entitlements`

Wraps `getEntitlementsFor` (`src/lib/entitlements.server.ts`). Lets the app show a
real "N messages left today" indicator instead of guessing.

**Auth:** required.

**Response `200`**

```json
{
  "tier": "free | premium | org",
  "chat": { "unlimited": false, "dailyCredits": 1, "usedToday": 0,
            "remainingToday": 1, "resetsAt": "ISO-8601 (next UTC midnight)" },
  "features": { "unlimitedHistory": false, "liveSessions": false, "dataExport": false }
}
```

`liveSessions` is always `false` (not built — see [Out of scope](#out-of-scope)).

### `GET /api/v1/chat/threads`

Wraps `listThreads`. **Auth:** required.

```json
[ { "id": "uuid", "title": "…", "created_at": "ISO-8601", "updated_at": "ISO-8601" } ]
```

### `GET /api/v1/chat/threads/:id/messages`

Wraps `getThreadHistory`. **Auth:** required. Paginated (params: `?limit=` default
50, `?before=` ISO cursor — final shape confirmed on delivery). `404` if the
thread isn't owned by the caller.

```json
{
  "thread": { "id": "uuid", "title": "…", "created_at": "ISO-8601", "updated_at": "ISO-8601" },
  "messages": [ { "id": "uuid", "sender": "user | assistant | system", "content": "…",
                  "content_type": "text | …", "exercise_slug": null,
                  "flagged_crisis": false, "quick_action": null, "created_at": "ISO-8601" } ]
}
```

---

## Phase 3 — onboarding & CRUD-shaped screens (planned)

### `POST /api/v1/onboarding`

Wraps `completeOnboarding` (`src/lib/onboarding.functions.ts`) as-is.

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

> **Contract note (was flagged as a bug — already fixed):** onboarding no longer
> sends a hardcoded `age_confirmed_13_plus: true`. The client sends a real
> `date_of_birth`; the **server** computes age, rejects under-13, and forces
> `account_type` to `teen` for anyone under 18. The mobile app must collect a
> real DOB and must not send `age_confirmed_13_plus` at all.

**Response `200`:** `{ "ok": true }`

### Direct Supabase access

These are fully scoped by Postgres RLS to `auth.uid()`. The mobile app should
read/write them **directly with the Supabase Flutter SDK** using the user's JWT —
wrapping them in `/api/v1` routes this week would be redundant work with no
server-side logic to add.

| Table                  | Access               | Notes                                                        |
| ---------------------- | -------------------- | ----------------------------------------------------------- |
| `profiles`             | select / update      | one row per user (`id = auth.uid()`)                        |
| `user_profiles`        | select / upsert      | the free-text intro / goals / stressors                     |
| `mood_logs`            | select / insert      | check-ins; `is_baseline` set only by onboarding             |
| `habits`               | select / insert / update | user-owned                                             |
| `habit_logs`           | select / insert      | user-owned                                                  |
| `exercises`            | select               | catalogue (read-only)                                       |
| `exercise_completions` | select / insert      | plain insert — no mood-delta or trigger logic server-side   |
| `screener_responses`   | select               | history reads; **writes must go through** `POST /api/v1/screeners/:type/responses` for the item-9 escalation |
| `chat_threads` / `chat_messages` | select     | reads OK directly; **sending must go through** `POST /api/v1/chat/messages` for the crisis gate |

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
