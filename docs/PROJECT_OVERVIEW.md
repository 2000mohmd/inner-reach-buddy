# Kalm — Project Documentation

An AI mental wellness companion. Lovable hosts the backend + a full web reference UI;
a separate mobile app is intended to consume the same backend later.

- Preview: https://id-preview--3ccb18b6-d5dd-414d-a598-ddc4028d95df.lovable.app
- Published: https://inner-reach-buddy.lovable.app

## 1. Product principles

1. Wellness support, **not** therapy or emergency care. Disclaimer is visible on the
   landing page, in chat, and on legal/crisis pages.
2. Every AI input path passes a **deterministic crisis gate before** any model call.
3. Privacy first: explicit consent flags, data export/delete, no dark patterns.
4. Tone: warm, validating, non-clinical; never guilt-based nudging.

## 2. Tech stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start v1 (React 19, Vite), file-based routing in `src/routes` |
| Server logic | `createServerFn` RPC in `src/lib/*.functions.ts`; server-only helpers in `*.server.ts` |
| Backend | Lovable Cloud (Supabase): Postgres + RLS, Auth (email/password + Google) |
| Data fetching | TanStack Query |
| Styling | Tailwind v4 tokens in `src/styles.css` (sage/teal oklch palette, Fraunces + Nunito Sans) |
| UI kit | shadcn/ui + Radix, lucide icons, recharts, sonner |
| LLM | Anthropic Messages API direct, `claude-sonnet-4-5`, native tool use (`ANTHROPIC_API_KEY` secret) |
| Runtime | Cloudflare Worker (edge); no Node-only packages |

## 3. Routes

Public: `/` (landing), `/auth`, `/crisis` (never gated), `/legal`.

Authenticated (`src/routes/_authenticated/`, guarded by `route.tsx`):

| Route | Purpose |
| --- | --- |
| `onboarding` | Consent → account mode → self-introduction → baseline mood |
| `dashboard` | Today's check-in, mood trend, nudge feed, "where to next" |
| `chat` | AI companion; threads, quick actions, inline tool actions |
| `habits` | Habit CRUD, 7-day grid, habit↔mood insights |
| `exercises` | Library + interactive step player with mood before/after |
| `check-ins` | PHQ-9 / GAD-7 with severity bands and score history |
| `care` | Step-up-to-professional-care resources |
| `settings` | Profile review, data deletion |

API: `src/routes/api/public/hooks/evaluate-nudges.ts` — cron/webhook nudge sweep.

## 4. Data model (Postgres, all RLS-scoped to `auth.uid()`)

- `profiles` — preferred_name, `account_type` (general | condition | teen | org_member),
  `subscription_tier` (free | premium | org), org_id, consent flags, onboarding_completed.
- `user_profiles` — self-introduction: intro_text, goals[], stressors[],
  existing_diagnosis, communication_preference, topics_to_avoid, in_professional_care.
- `mood_logs` — score 1-5, note, tags[], is_baseline.
- `habits` / `habit_logs` — user habits + per-day completion.
- `chat_threads` / `chat_messages` — sender (user | assistant | system), content,
  `flagged_crisis`, `quick_action`.
- `crisis_events` — matched_terms, severity, reviewed. Admin-readable via `has_role()`.
- `exercises` (read-only, seeded) / `exercise_completions` — mood_before/after, response_data jsonb.
- `screener_responses` — phq9 | gad7, responses jsonb, total_score, severity.
- `nudges` — trigger_type, message, suggested_exercise_slug, resource_ids[], dismissed_at, acted_on.
- `care_resources` (public read of active rows) — directory | low_cost | employer_eap | crisis.
- `commitments` — description, source (chat | exercise), status (pending | done | skipped), due_at.
- `effectiveness_insights` — per-user subject → avg_mood_delta, sample_size, confidence.
- `user_roles` + `has_role(uuid, app_role)` security-definer fn (roles never on profiles).

Seeded exercise slugs: `cbt-thought-record`, `behavioral-activation`, `grounding-54321`,
`box-breathing`, `worry-time`.

## 5. AI architecture

Flow for a chat message (`src/lib/chat.functions.ts` → `sendMessage`):

```text
user message
  └─> detectCrisis()  (regex, src/lib/crisis.ts)   ← NON-NEGOTIABLE, runs first
        ├─ flagged: mark flagged_crisis, log crisis_events, return crisis response
        │           object (calm copy + 988 / Crisis Text Line resources). No LLM call.
        └─ clear:  generateCompanionReply()  (src/lib/ai-companion.server.ts)
                     ├─ buildSystemPrompt(ctx)  — persona, session behavior,
                     │    anti-dependency instruction, disclaimer
                     ├─ context injected: user_profiles intro, recent mood_logs,
                     │    recent thread history, quick_action variant
                     └─ Anthropic tool-use loop (max 3 iterations)
```

Tools (`src/lib/companion-tools.server.ts`): `log_mood`, `create_commitment`,
`get_effectiveness_insights`, `launch_exercise`, `suggest_stepup`,
`get_exercise_steps`, `complete_exercise_in_chat`. Executed results surface in the
transcript as visible actions (e.g. "logged your mood as 4/5"). Nudges use a
read-only subset (`NUDGE_TOOLS`).

Proactive coaching (`src/lib/nudges.server.ts`), one nudge per trigger with a 7-day cooldown:
- `low_mood_streak` — 5+ consecutive days averaging < 3/5 → behavioral activation.
- `inactivity` — 4+ days silent after regular use → low-pressure care message.
- `screener_step_up` — moderate+ severity or 2+ band worsening → step-up copy + 2-3 care resources.

## 6. What's built vs. not

Built: Phases 1-3 (auth/onboarding/design system, tracking + chat + crisis middleware,
exercises + screeners + nudges + care pathway) and Phase 4.2/4.3 (Claude tool-calling,
session-like chat behavior, in-chat guided exercises, commitments, effectiveness insights).

Not built yet:
- **Subscriptions / gating** — `subscription_tier` exists but nothing enforces free vs.
  premium limits; no Stripe, no message caps, no minute allowances.
- **Workplace/org tier** — `org_id` and `employer_eap` placeholders exist; no
  `organizations` table, admin dashboard, aggregate analytics, or seat management.
- **Live avatar/voice sessions** — no `live_sessions` table, no provider chosen,
  no real-time transcript crisis checks.
- **Effectiveness engine scheduling** — insights are computed on demand in the tool;
  no scheduled recompute writing to `effectiveness_insights`.
- **Commitment follow-up loop** — commitments are created but never proactively
  revisited at the next check-in.
- **Localization** — `care_resources.region` unused; crisis resources are US-only.
- **Mobile client** — no API keys/versioning story for an external app; server
  functions are RPC-shaped for this web app.
- **Data export** — deletion exists, export (e.g. therapist-shareable PDF) does not.

## 7. Known risks / review areas for an outside reviewer

1. Crisis detection is regex-only — high recall on explicit phrasing, weak on implicit
   or coded language, non-English, and sarcasm. No second-pass classifier.
2. Crisis review workflow: `crisis_events.reviewed` exists, but there is no admin UI
   or alerting, so nothing operationally reviews flags.
3. Teen mode: `account_type = 'teen'` sets tone and `age_confirmed_13_plus`, but there
   is no real age gate, parental consent, or under-13 blocking (COPPA/GDPR-K).
4. Anthropic cost/abuse: no per-user rate limits or token budgeting on chat.
5. Model reliability: tool-use loop caps at 3 iterations then returns partial text;
   failure modes surface as generic fallback copy.
6. Screener scoring is stored but PHQ-9 item 9 (self-harm ideation) does not trigger
   its own escalation path.
7. `effectiveness_insights` reads use an admin (RLS-bypassing) client inside a tool —
   worth an access review.
8. No automated tests; verification has been manual/browser-driven.
9. Privacy posture is consent-flag based; no encryption-at-rest beyond Postgres
   defaults, no retention/TTL policy on chat transcripts.

## 8. Conventions to respect when changing code

- Never edit `src/integrations/supabase/*` generated files or `src/routeTree.gen.ts`.
- Every new public table needs `GRANT`s + RLS policies in the same migration.
- Colors/shadows come from semantic tokens in `src/styles.css`; no hardcoded hex or
  `text-white`-style utilities.
- Protected server functions use `.middleware([requireSupabaseAuth])` and must not be
  called from public-route loaders.
- The crisis gate runs first, always, regardless of model or architecture changes.

## Admin roles and bootstrap (Phase 12)

Two tiers live in `user_roles` (`app_role` enum):

- `admin` — day-to-day admin work: crisis review, support replies, Users and
  Overview pages. An admin cannot grant roles.
- `super_admin` — required for role management (Team page, Phase 13). Keeping
  role-granting separate means an admin cannot escalate themselves or others.

There is deliberately **no UI path** to create the first `super_admin` (that
would be a privilege-escalation route). Bootstrap it with a direct database
write, once, replacing the email:

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'you@example.com'
on conflict (user_id, role) do nothing;
```

### Admin audit log

`admin_audit_log` records privileged actions: `viewed_user`,
`resolved_crisis_event`, and (Phase 13) `replied_support_ticket`,
`granted_role`. Entries are append-only — admins can read and insert their own
rows only. Visible at `/admin/audit`, filterable by admin and action.
