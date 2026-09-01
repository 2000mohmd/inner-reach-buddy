-- Item 5: full account deletion via delete_account(uuid), SECURITY DEFINER.
--
-- Approved: crisis_events.user_id becomes nullable (anonymize, not delete);
-- admin_audit_log.admin_user_id moves ON DELETE CASCADE -> ON DELETE SET NULL
-- (nullable) so audit rows survive an account deletion — per
-- docs/DATA_RETENTION.md's "safety and audit data is never auto-deleted".
--
-- Call order (see deleteMyAccount in src/lib/onboarding.functions.ts):
--   1. supabaseAdmin.rpc('delete_account', { p_user_id })  -- explicit erasure
--      of the tables below that have no FK to auth.users, and anonymizes
--      crisis_events (sets user_id to null; rows are kept).
--   2. supabaseAdmin.auth.admin.deleteUser(userId)          -- deletes the auth
--      row, which cascades every FK-linked table (profiles, user_profiles,
--      mood_logs, user_roles, thread_summaries, daily_prompts,
--      daily_prompt_responses, weekly_digests, chat_rate_limits, chat_usage,
--      support_threads + support_messages) and now SET NULLs admin_audit_log
--      instead of deleting those rows.

-- ---------------------------------------------------------------------------
-- Safety / audit tables: anonymize on account deletion, never cascade-delete.
-- ---------------------------------------------------------------------------
alter table public.crisis_events
  alter column user_id drop not null;

-- Find and replace the admin_audit_log -> auth.users FK regardless of its
-- (auto-generated) name, so this migration doesn't depend on guessing it.
do $$
declare
  fk_name text;
begin
  select con.conname into fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
  where rel.relname = 'admin_audit_log'
    and con.contype = 'f'
    and att.attname = 'admin_user_id';

  if fk_name is not null then
    execute format('alter table public.admin_audit_log drop constraint %I', fk_name);
  end if;

  alter table public.admin_audit_log alter column admin_user_id drop not null;

  alter table public.admin_audit_log
    add constraint admin_audit_log_admin_user_id_fkey
    foreign key (admin_user_id) references auth.users (id) on delete set null;
end
$$;

-- ---------------------------------------------------------------------------
-- delete_account: explicit erasure for tables with no FK to auth.users.
-- FK-safe order: habit_logs before habits; chat_threads cascades chat_messages
-- (thread_id FK), which in turn SET NULLs crisis_events.message_id and
-- commitments.thread_id automatically.
-- ---------------------------------------------------------------------------
create or replace function public.delete_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.habit_logs where user_id = p_user_id;
  delete from public.habits where user_id = p_user_id;
  delete from public.chat_threads where user_id = p_user_id;
  delete from public.screener_responses where user_id = p_user_id;
  delete from public.nudges where user_id = p_user_id;
  delete from public.commitments where user_id = p_user_id;
  delete from public.effectiveness_insights where user_id = p_user_id;
  delete from public.exercise_completions where user_id = p_user_id;
  delete from public.notification_queue
    where target_user_id = p_user_id or subject_user_id = p_user_id;

  -- Anonymize rather than delete — the safety record survives.
  update public.crisis_events set user_id = null where user_id = p_user_id;
end;
$$;

revoke all on function public.delete_account(uuid) from anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
