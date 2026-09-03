-- BSD7 Assist mobile app notification support.
-- This is the smaller update to run if the full setup SQL fails.

create table if not exists public.mobile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text,
  device_label text,
  enabled boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mobile_push_tokens_active_user_idx
  on public.mobile_push_tokens(user_id) where enabled;

alter table public.mobile_push_tokens enable row level security;

revoke all on table public.mobile_push_tokens from anon, authenticated;

comment on table public.mobile_push_tokens is
  'Per-device Expo mobile push tokens managed only by authenticated Edge Functions.';
