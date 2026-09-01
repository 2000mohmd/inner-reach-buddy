-- Real date of birth on the profile (item 3). Additive; nullable so existing
-- rows are unaffected. No new grants/policies needed — profiles already has RLS
-- ("Users manage own profile") and the column is covered by it.
--
-- Onboarding now collects a date and the server computes age from it:
--   age < 13  -> onboarding is rejected (the app is 13+)
--   age < 18  -> account_type is forced to 'teen'
--   age_confirmed_13_plus is persisted as (age >= 13), not a hardcoded true.

alter table public.profiles
  add column if not exists date_of_birth date;
