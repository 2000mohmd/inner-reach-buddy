# Data retention — proposal (item 10)

Mental-health data is sensitive personal data. Today Kalm stores everything
forever, with only a manual "delete my data" action in Settings. This proposes
automatic retention windows plus a safe, dry-run-by-default purge job.

**Status: DRAFT. Nothing is scheduled or deleted until the numbers below are
confirmed.** The draft migration
`supabase/migrations/20260902000000_data_retention_draft.sql` is not applied.

## Principles

1. **Safety and audit data is never auto-deleted.** `crisis_events` and
   `admin_audit_log` are kept indefinitely — they may be needed for
   duty-of-care, incident review, or a regulator.
2. **Self-tracking history the user expects to persist is kept.** Mood logs,
   exercise completions and screener scores are the point of the product;
   deleting them silently would be a dark pattern. Kept indefinitely (revisit if
   storage cost ever matters — a 5-year window is the fallback).
3. **Transcripts and transient records are bounded.** Chat content, summaries,
   nudges, digests, support threads, and the outbound/queue tables get a finite
   window.
4. The user's manual export/delete always wins and is unaffected by this.

## Proposed windows

| Table | Auto-delete after | Anchor | Rationale |
|---|---|---|---|
| `crisis_events` | **never** | — | safety / audit / legal |
| `admin_audit_log` | **never** | — | compliance trail (append-only) |
| `screener_responses` | **never** (fallback 5y) | `taken_at` | PHQ-9 / GAD-7 trends are meaningful over years |
| `mood_logs` | **never** (fallback 5y) | `logged_at` | core self-tracking history |
| `exercise_completions` | **never** (fallback 5y) | `completed_at` | core self-tracking history |
| `chat_messages` | **26 months** | parent thread `updated_at` | bounded transcript retention |
| `chat_threads` | **26 months** | `updated_at` | deleted once empty of messages |
| `thread_summaries` | **26 months** | `created_at` | cross-session memory; worthless once the thread is gone |
| `support_messages` / `support_threads` | **24 months** | thread `updated_at` | account-support history |
| `weekly_digests` | **24 months** | `created_at` | progress recaps, rarely revisited |
| `nudges` | **12 months** | `created_at` | ephemeral prompts; effectiveness lives in `effectiveness_insights` |
| `notification_queue` | **90 days** after delivery (30 days if never delivered) | `delivered_at` / `created_at` | outbound queue, no long-term value |
| `job_queue` | **14 days** | `completed_at` | transient work records |
| `chat_rate_limits` | n/a | — | self-rolling window, nothing accumulates |

## How the purge job works

`public.purge_expired_data(p_dry_run boolean default true)`:

- **`p_dry_run = true` (default):** deletes nothing, returns a row per table with
  the count that *would* be removed. Run this first, review the numbers.
- **`p_dry_run = false`:** performs the deletes, children before parents, in one
  transaction. Never touches the "never" tables above.
- Windows are plain `interval` literals at the top of the function — edit and
  re-run the migration to change them.

Once the numbers are confirmed, uncomment the `cron.schedule(...)` block at the
bottom of the migration to run it nightly at 03:30 UTC.

## Follow-ups this does not cover

- **Backups / PITR** retain deleted rows for the backup window — fine, but note it
  for a formal retention statement.
- **`live_sessions`** (avatar/voice transcripts) — not built yet; add a window
  (proposed: 12 months) when it lands.
- A user-facing retention statement in `/legal` once the numbers are final.
