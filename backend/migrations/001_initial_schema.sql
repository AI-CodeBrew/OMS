-- 001_initial_schema.sql
-- Shared Postgres (Supabase). Every business table carries tenant_id.
-- RLS is a safety net; Flask service layer remains the source of truth.

create extension if not exists "pgcrypto";

-- Tenants
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'starter',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'tenant_user'
    check (role in ('super_admin', 'tenant_admin', 'tenant_user')),
  tenant_id uuid references public.tenants (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);

-- Helper: current JWT claims
create or replace function public.jwt_claim(claim text)
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> claim,
    auth.jwt() -> 'user_metadata' ->> claim
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.jwt_claim('role'), '') = 'super_admin'
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'is_super_admin')::boolean, false);
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(public.jwt_claim('tenant_id'), '')::uuid;
$$;

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;

-- Tenants: super admin all; members see own tenant
create policy tenants_select on public.tenants
  for select using (
    public.is_super_admin()
    or id = public.current_tenant_id()
  );

create policy tenants_super_admin_write on public.tenants
  for all using (public.is_super_admin())
  with check (public.is_super_admin());

-- Profiles: own row, or same tenant, or super admin
create policy profiles_select on public.profiles
  for select using (
    public.is_super_admin()
    or id = auth.uid()
    or tenant_id = public.current_tenant_id()
  );

create policy profiles_update_own on public.profiles
  for update using (
    public.is_super_admin() or id = auth.uid()
  );
