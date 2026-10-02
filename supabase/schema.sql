-- =====================================================================
-- Finanzas Personales — esquema Supabase
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query > Run
-- Idempotente en lo posible: se puede volver a correr sin romper datos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

create table if not exists public.accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  type            text not null default 'cash' check (type in ('cash','bank','card','wallet','savings')),
  initial_balance numeric(14,2) not null default 0,
  color           text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  kind       text not null check (kind in ('expense','income')),
  parent_id  uuid,
  color      text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon       text not null default 'tag' check (char_length(icon) <= 40),
  archived   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  -- La categoría padre tiene que ser del mismo usuario
  foreign key (parent_id, user_id) references public.categories(id, user_id) on delete cascade
);

create table if not exists public.recurring (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  type            text not null check (type in ('expense','income')),
  amount          numeric(14,2) not null check (amount > 0),
  account_id      uuid not null,
  category_id     uuid,
  frequency       text not null default 'monthly' check (frequency in ('weekly','monthly','yearly')),
  anchor_day      smallint check (anchor_day between 1 and 31),
  next_date       date not null,
  is_subscription boolean not null default false,
  auto_post       boolean not null default true,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id)  references public.accounts(id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id)
);

create table if not exists public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type                text not null check (type in ('expense','income','transfer')),
  amount              numeric(14,2) not null check (amount > 0),
  date                date not null default current_date,
  account_id          uuid not null,
  transfer_account_id uuid,
  category_id         uuid,
  recurring_id        uuid,
  note                text check (char_length(note) <= 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (account_id, user_id)          references public.accounts(id, user_id) on delete cascade,
  foreign key (transfer_account_id, user_id) references public.accounts(id, user_id) on delete cascade,
  foreign key (category_id, user_id)         references public.categories(id, user_id) on delete set null (category_id),
  foreign key (recurring_id, user_id)        references public.recurring(id, user_id) on delete set null (recurring_id),
  check (
    (type = 'transfer' and transfer_account_id is not null and transfer_account_id <> account_id and category_id is null)
    or (type <> 'transfer' and transfer_account_id is null)
  )
);

create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null,
  amount      numeric(14,2) not null check (amount >= 0),
  created_at  timestamptz not null default now(),
  unique (user_id, category_id),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete cascade
);

-- Historial de cambios (solo lectura para el usuario; lo escribe un trigger)
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  table_name text not null,
  action     text not null,
  row_id     uuid,
  old_data   jsonb,
  new_data   jsonb,
  at         timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transactions_account_idx   on public.transactions (account_id);
create index if not exists transactions_transfer_idx  on public.transactions (transfer_account_id);
create index if not exists transactions_category_idx  on public.transactions (category_id);
create index if not exists recurring_user_next_idx    on public.recurring (user_id, next_date);
create index if not exists audit_user_at_idx          on public.audit_log (user_id, at desc);

-- ---------------------------------------------------------------------
-- Row Level Security: cada usuario ve y modifica SOLO sus filas
-- ---------------------------------------------------------------------

alter table public.accounts     enable row level security;
alter table public.categories   enable row level security;
alter table public.recurring    enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets      enable row level security;
alter table public.audit_log    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','recurring','transactions','budgets'] loop
    execute format('drop policy if exists "own_rows" on public.%I', t);
    execute format(
      'create policy "own_rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

drop policy if exists "own_audit_read" on public.audit_log;
create policy "own_audit_read" on public.audit_log for select to authenticated
  using (user_id = (select auth.uid()));

-- El rol anónimo no necesita nada de este esquema
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke insert, update, delete on public.audit_log from authenticated;

-- ---------------------------------------------------------------------
-- Vista de saldos (security_invoker => respeta RLS del que consulta)
-- ---------------------------------------------------------------------

create or replace view public.account_balances with (security_invoker = true) as
select
  a.id,
  a.user_id,
  a.initial_balance
  + coalesce(sum(
      case
        when t.account_id = a.id and t.type = 'income'   then  t.amount
        when t.account_id = a.id and t.type = 'expense'  then -t.amount
        when t.account_id = a.id and t.type = 'transfer' then -t.amount
        when t.transfer_account_id = a.id                then  t.amount
        else 0
      end), 0) as balance
from public.accounts a
left join public.transactions t
  on t.account_id = a.id or t.transfer_account_id = a.id
group by a.id;

revoke all on public.account_balances from anon;
grant select on public.account_balances to authenticated;

-- ---------------------------------------------------------------------
-- Triggers: updated_at y auditoría
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists transactions_touch on public.transactions;
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();

-- SECURITY DEFINER para poder escribir en audit_log (el usuario no tiene INSERT).
-- search_path vacío para evitar secuestro de objetos.
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := coalesce(auth.uid(), (case when tg_op = 'DELETE' then old.user_id else new.user_id end));
begin
  insert into public.audit_log (user_id, table_name, action, row_id, old_data, new_data)
  values (
    uid, tg_table_name, tg_op,
    case when tg_op = 'DELETE' then old.id else new.id end,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

revoke execute on function public.write_audit() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['accounts','categories','recurring','transactions','budgets'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Recurrentes: cálculo de próxima fecha y registro automático
-- ---------------------------------------------------------------------

create or replace function public.next_occurrence(d date, freq text, anchor smallint)
returns date language plpgsql immutable set search_path = '' as $$
declare
  base date;
  last_day int;
begin
  if freq = 'weekly' then
    return d + 7;
  elsif freq = 'yearly' then
    base := (date_trunc('month', d) + interval '1 year')::date;
  else
    base := (date_trunc('month', d) + interval '1 month')::date;
  end if;
  last_day := extract(day from (base + interval '1 month - 1 day'))::int;
  return base + (least(coalesce(anchor, extract(day from d)::int), last_day) - 1);
end $$;

-- Registra UNA ocurrencia de un recurrente y avanza su próxima fecha
create or replace function public.post_recurring(rid uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  r public.recurring;
  tid uuid;
begin
  select * into r from public.recurring
   where id = rid and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'Recurrente no encontrado';
  end if;

  insert into public.transactions (type, amount, date, account_id, category_id, recurring_id, note)
  values (r.type, r.amount, r.next_date, r.account_id, r.category_id, r.id, r.name)
  returning id into tid;

  update public.recurring
     set next_date = public.next_occurrence(r.next_date, r.frequency, r.anchor_day)
   where id = r.id;

  return tid;
end $$;

-- Registra todo lo vencido con auto_post = true. Devuelve cuántos movimientos creó.
create or replace function public.process_recurring()
returns int language plpgsql security invoker set search_path = '' as $$
declare
  r public.recurring;
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  n int := 0;
  guard int;
begin
  for r in
    select * from public.recurring
     where user_id = auth.uid() and active and auto_post and next_date <= today
     for update
  loop
    guard := 0;
    while r.next_date <= today and guard < 120 loop
      insert into public.transactions (type, amount, date, account_id, category_id, recurring_id, note)
      values (r.type, r.amount, r.next_date, r.account_id, r.category_id, r.id, r.name);
      r.next_date := public.next_occurrence(r.next_date, r.frequency, r.anchor_day);
      n := n + 1;
      guard := guard + 1;
    end loop;
    update public.recurring set next_date = r.next_date where id = r.id;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Datos iniciales: se ejecuta desde la app en el primer login
-- ---------------------------------------------------------------------

create or replace function public.seed_defaults()
returns void language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  p uuid;
begin
  if uid is null then
    raise exception 'No autenticado';
  end if;
  if exists (select 1 from public.categories where user_id = uid) then
    return;
  end if;

  insert into public.accounts (name, type, color) values
    ('Efectivo', 'cash', '#16a34a'),
    ('Banco',    'bank', '#2563eb'),
    ('Tarjeta de crédito', 'card', '#9333ea');

  insert into public.categories (name, kind, color, icon) values ('Vivienda & Servicios', 'expense', '#2a78d6', 'home') returning id into p;
  insert into public.categories (name, kind, color, icon, parent_id) values
    ('Alquiler / Expensas', 'expense', '#2a78d6', 'home', p),
    ('Luz', 'expense', '#2a78d6', 'zap', p),
    ('Gas', 'expense', '#2a78d6', 'flame', p),
    ('Internet / Teléfono', 'expense', '#2a78d6', 'wifi', p);

  insert into public.categories (name, kind, color, icon) values ('Transporte', 'expense', '#eb6834', 'car') returning id into p;
  insert into public.categories (name, kind, color, icon, parent_id) values
    ('Combustible', 'expense', '#eb6834', 'fuel', p),
    ('Seguro', 'expense', '#eb6834', 'shield', p),
    ('Patente / Mantenimiento', 'expense', '#eb6834', 'wrench', p);

  insert into public.categories (name, kind, color, icon) values
    ('Salud', 'expense', '#1baf7a', 'heart-pulse'),
    ('Finanzas', 'expense', '#eda100', 'landmark'),
    ('Bienestar', 'expense', '#e87ba4', 'sparkles'),
    ('Sueldo', 'income', '#2a78d6', 'briefcase'),
    ('Otros ingresos', 'income', '#1baf7a', 'plus-circle');
end $$;

revoke execute on function public.post_recurring(uuid)  from public, anon;
revoke execute on function public.process_recurring()   from public, anon;
revoke execute on function public.seed_defaults()       from public, anon;
grant  execute on function public.post_recurring(uuid)  to authenticated;
grant  execute on function public.process_recurring()   to authenticated;
grant  execute on function public.seed_defaults()       to authenticated;

-- ---------------------------------------------------------------------
-- Comercios recordados por el escáner (migración 002)
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- Resúmenes de tarjeta y cuotas (migración 003)
-- ---------------------------------------------------------------------

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
