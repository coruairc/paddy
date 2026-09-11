-- Unified Paddy workspace snapshots. Unowned on purpose (auth is off):
-- profile_id is an agent mind (paddy, …), not a signed-in user.
create table if not exists paddy_workspace (
  profile_id text primary key,
  snapshot   jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists paddy_meta (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
