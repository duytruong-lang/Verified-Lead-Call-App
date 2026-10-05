-- Configure only after deploying sheets-worker and approving a pilot copy.
-- Store sheets_worker_url and service_role_key in Supabase Vault, never here.
select cron.schedule(
  'sheets-worker-every-minute',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sheets_worker_url'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
      ),
      body := jsonb_build_object('source', 'cron')
    );
  $$
);
