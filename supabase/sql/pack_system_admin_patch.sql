-- Minimal patch to allow token admin adjustments from Supabase SQL editor.
-- Run this after pack_system.sql if admin_adjust_tokens() still raises "Not authenticated".

create or replace function public.admin_adjust_tokens(
  p_target_profile_id uuid,
  p_delta integer,
  p_reason text default 'admin_adjustment',
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if not public.is_admin(auth.uid()) then
      raise exception 'Admin only';
    end if;
  elsif session_user <> 'postgres' then
    raise exception 'Not authenticated';
  end if;

  return public.add_token_ledger_entry(
    p_target_profile_id,
    p_delta,
    coalesce(nullif(btrim(p_reason), ''), 'admin_adjustment'),
    'admin',
    null,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;
