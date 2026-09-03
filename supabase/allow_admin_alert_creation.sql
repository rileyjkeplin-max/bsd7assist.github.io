-- Allow active creator/approver/admin users to create pending alert requests.
-- This fixes: "new row violates row-level security policy for table alerts".

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'alerts'
      and policyname = 'active staff can create pending alerts'
  ) then
    create policy "active staff can create pending alerts"
      on public.alerts
      for insert
      to authenticated
      with check (
        created_by = auth.uid()
        and status = 'pending'
        and is_public = false
        and exists (
          select 1
          from public.profiles p
          where p.id = auth.uid()
            and p.is_active = true
            and p.access_status = 'active'
            and p.role in ('creator', 'approver', 'admin')
        )
      );
  end if;
end $$;
