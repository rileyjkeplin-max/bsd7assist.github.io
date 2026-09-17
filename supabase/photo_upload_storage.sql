-- BSD7 Assist photo upload storage setup.
-- Run this once in Supabase SQL Editor before using the photo upload field.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'alert-photos',
  'alert-photos',
  true,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Active creators can upload alert photos" on storage.objects;
drop policy if exists "Public can view alert photos" on storage.objects;

create policy "Active creators can upload alert photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'alert-photos'
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.access_status = 'active'
        and p.role in ('creator', 'approver', 'admin')
    )
  );

create policy "Public can view alert photos"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'alert-photos');
