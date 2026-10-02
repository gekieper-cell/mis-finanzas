-- =====================================================================
-- 002 - Comercios recordados por el escáner de facturas
-- Ejecutar en: Supabase > SQL Editor (proyecto cfsysumtjsdofjcvocho)
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

create table if not exists public.merchants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key         text not null check (char_length(key) between 1 and 80),   -- CUIT o nombre normalizado
  name        text not null check (char_length(name) between 1 and 80),
  category_id uuid,
  updated_at  timestamptz not null default now(),
  unique (user_id, key),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id)
);

alter table public.merchants enable row level security;

drop policy if exists "own_rows" on public.merchants;
create policy "own_rows" on public.merchants for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.merchants from anon;
