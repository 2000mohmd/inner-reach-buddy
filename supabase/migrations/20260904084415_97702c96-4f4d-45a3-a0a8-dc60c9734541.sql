create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended', 'failed')),
  provider text not null default 'openai_realtime',
  model text not null default '',
  voice text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  turn_count integer not null default 0,
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  crisis_triggered boolean not null default false,
  crisis_severity text,
  end_reason text,
  created_at timestamptz not null default now()
);

create index if not exists call_sessions_user_started_idx
  on public.call_sessions (user_id, started_at desc);
create index if not exists call_sessions_thread_idx
  on public.call_sessions (thread_id);

grant select, insert, update, delete on public.call_sessions to authenticated;
grant all on public.call_sessions to service_role;

alter table public.call_sessions enable row level security;

drop policy if exists "Users read own call sessions" on public.call_sessions;
create policy "Users read own call sessions"
  on public.call_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users create own call sessions" on public.call_sessions;
create policy "Users create own call sessions"
  on public.call_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own call sessions" on public.call_sessions;
create policy "Users update own call sessions"
  on public.call_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own call sessions" on public.call_sessions;
create policy "Users delete own call sessions"
  on public.call_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Admins read call sessions" on public.call_sessions;
create policy "Admins read call sessions"
  on public.call_sessions for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));