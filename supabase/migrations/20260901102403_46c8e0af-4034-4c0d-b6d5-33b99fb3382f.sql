revoke all on function public.claim_jobs(integer) from public;
grant execute on function public.claim_jobs(integer) to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'kalm_sweep_url') then
    perform vault.create_secret(
      'https://project--3ccb18b6-d5dd-414d-a598-ddc4028d95df.lovable.app/api/public/hooks/evaluate-nudges',
      'kalm_sweep_url');
  else
    perform vault.update_secret(
      (select id from vault.secrets where name = 'kalm_sweep_url'),
      'https://project--3ccb18b6-d5dd-414d-a598-ddc4028d95df.lovable.app/api/public/hooks/evaluate-nudges');
  end if;

  if not exists (select 1 from vault.secrets where name = 'kalm_sweep_secret') then
    perform vault.create_secret('318939866107ed08cc815d10ced9d23c8fd6ccab9ece2eb3', 'kalm_sweep_secret');
  else
    perform vault.update_secret(
      (select id from vault.secrets where name = 'kalm_sweep_secret'),
      '318939866107ed08cc815d10ced9d23c8fd6ccab9ece2eb3');
  end if;
end
$$;

select cron.unschedule('kalm-evaluate-nudges')
where exists (select 1 from cron.job where jobname = 'kalm-evaluate-nudges');

select cron.schedule(
  'kalm-evaluate-nudges',
  '* * * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'kalm_sweep_url'),
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kalm_sweep_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);