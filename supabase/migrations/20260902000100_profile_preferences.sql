-- Companion persona + theme preference for the mobile client (item 7).
-- Additive; safe to apply.

alter table public.profiles
  add column if not exists companion_persona text not null default 'warm',
  add column if not exists theme_preference  text not null default 'system';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_companion_persona_check'
  ) then
    alter table public.profiles
      add constraint profiles_companion_persona_check
      check (companion_persona in ('warm', 'direct', 'reflective'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_theme_preference_check'
  ) then
    alter table public.profiles
      add constraint profiles_theme_preference_check
      check (theme_preference in ('system', 'light', 'dark'));
  end if;
end
$$;
