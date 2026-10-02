-- =====================================================================
-- 003 - Resúmenes de tarjeta y compras en cuotas
-- Ejecutar en: Supabase > SQL Editor (proyecto cfsysumtjsdofjcvocho)
-- Idempotente: se puede correr más de una vez.
-- =====================================================================

create table if not exists public.card_statements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id   uuid not null,
  issuer       text check (char_length(issuer) <= 60),
  card_last4   text check (card_last4 ~ '^\d{4}$'),
  closing_date date not null,
  due_date     date,
  next_closing date,
  next_due     date,
  balance      numeric(14,2),
  balance_usd  numeric(14,2),
  min_payment  numeric(14,2),
  bank_projection jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  unique (user_id, account_id, closing_date),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete cascade
);

create table if not exists public.installment_plans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id         uuid not null,
  plan_key           text not null check (char_length(plan_key) between 1 and 120),
  description        text not null check (char_length(description) between 1 and 80),
  voucher            text check (char_length(voucher) <= 30),
  purchase_date      date,
  installment_amount numeric(14,2) not null check (installment_amount > 0),
  installments_total smallint not null check (installments_total between 1 and 99),
  first_closing      date not null,             -- mes de cierre de la cuota 1 (día 1)
  currency           text not null default 'ARS' check (currency in ('ARS','USD')),
  category_id        uuid,
  source             text not null default 'resumen' check (source in ('resumen','manual')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, account_id, plan_key),
  foreign key (account_id, user_id)  references public.accounts(id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id)
);

create index if not exists installment_plans_user_idx on public.installment_plans (user_id, first_closing);
create index if not exists card_statements_user_idx  on public.card_statements (user_id, closing_date desc);

alter table public.card_statements   enable row level security;
alter table public.installment_plans enable row level security;

do $$
declare t text;
begin
  foreach t in array array['card_statements','installment_plans'] loop
    execute format('drop policy if exists "own_rows" on public.%I', t);
    execute format(
      'create policy "own_rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
    -- historial de cambios (misma auditoría que el resto)
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.write_audit()', t || '_audit', t);
  end loop;
end $$;

revoke all on public.card_statements   from anon;
revoke all on public.installment_plans from anon;
