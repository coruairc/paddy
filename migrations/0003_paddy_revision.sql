-- Optimistic concurrency for workspace snapshots (lost-update guard).
alter table paddy_workspace
  add column if not exists revision integer not null default 0;
