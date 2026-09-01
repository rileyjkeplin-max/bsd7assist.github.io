-- Run this once in the Supabase SQL Editor to make Riley the first manager/admin.
-- This requires access to the Supabase project dashboard.

update public.profiles as p
set
  role = 'admin',
  is_active = true,
  access_status = 'active',
  full_name = coalesce(nullif(p.full_name, ''), 'Riley Keplin'),
  updated_at = now()
from auth.users as u
where p.id = u.id
  and lower(u.email) = lower('riley.j.keplin@belcourt.k12.nd.us');

select
  p.id,
  u.email,
  p.full_name,
  p.role,
  p.is_active,
  p.access_status
from public.profiles as p
join auth.users as u on u.id = p.id
where lower(u.email) = lower('riley.j.keplin@belcourt.k12.nd.us');
