-- BSD #7 Community Assistance: authenticated Web Push and safe member removal.

create extension if not exists pg_trgm with schema extensions;

create index if not exists profiles_admin_directory_idx
  on public.profiles (access_status, role, created_at desc, id desc);

create index if not exists profiles_created_at_idx
  on public.profiles (created_at desc, id desc);

create index if not exists profiles_full_name_search_idx
  on public.profiles using gin (full_name extensions.gin_trgm_ops);

-- Preserve alert history while allowing a removed Auth account and profile to
-- disappear. New alerts must still provide created_by through the insert RLS policy.
alter table public.alerts alter column created_by drop not null;
alter table public.alerts drop constraint if exists alerts_created_by_fkey;
alter table public.alerts add constraint alerts_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  device_label text,
  user_agent text,
  enabled boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_active_user_idx
  on public.push_subscriptions(user_id) where enabled;

create table if not exists public.notification_push_config (
  singleton boolean primary key default true check (singleton = true),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.alert_notification_sends (
  alert_id uuid primary key references public.alerts(id) on delete cascade,
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  delivered integer not null default 0 check (delivered >= 0),
  failed integer not null default 0 check (failed >= 0),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_push_config enable row level security;
alter table public.alert_notification_sends enable row level security;

-- These tables are server-only. The authenticated Edge Functions validate the
-- caller and use the project secret; browsers receive no direct table access.
revoke all on table public.push_subscriptions from anon, authenticated;
revoke all on table public.notification_push_config from anon, authenticated;
revoke all on table public.alert_notification_sends from anon, authenticated;

comment on table public.push_subscriptions is
  'Per-device Web Push subscriptions managed only by authenticated Edge Functions.';
comment on table public.alert_notification_sends is
  'Idempotency and delivery summary for push notifications sent for active alerts.';
