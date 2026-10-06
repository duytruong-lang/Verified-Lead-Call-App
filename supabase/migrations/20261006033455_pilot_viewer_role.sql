-- PostgreSQL must commit a new enum label before following migrations use it.
alter type public.actor_role add value if not exists 'viewer';
