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


-- ---------------------------------------------------------------------
-- Migración 004 (incluida acá para instalaciones nuevas)
-- ---------------------------------------------------------------------

-- Identificador del renglón del resumen: al volver a subir un resumen no se duplican movimientos
alter table public.transactions
  add column if not exists import_key text check (char_length(import_key) <= 200);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_user_import_key') then
    alter table public.transactions add constraint transactions_user_import_key unique (user_id, import_key);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- Migración 005 (incluida acá para instalaciones nuevas)
-- ---------------------------------------------------------------------

-- ¿El usuario actual tiene doble factor activo?
-- SECURITY DEFINER porque el rol "authenticated" no puede leer el esquema auth.
create or replace function public.user_has_mfa()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.mfa_factors
    where user_id = auth.uid() and status = 'verified'
  );
$$;
revoke execute on function public.user_has_mfa() from public, anon;
grant  execute on function public.user_has_mfa() to authenticated;

-- Política RESTRICTIVA: se suma (AND) a las políticas "own_rows" existentes
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','categories','recurring','transactions','budgets','audit_log',
    'merchants','card_statements','installment_plans'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "mfa_aal2" on public.%I', t);
    execute format(
      'create policy "mfa_aal2" on public.%I as restrictive for all to authenticated
         using ((select auth.jwt() ->> ''aal'') = ''aal2'' or not (select public.user_has_mfa()))
         with check ((select auth.jwt() ->> ''aal'') = ''aal2'' or not (select public.user_has_mfa()))', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- Migración 006 (incluida acá para instalaciones nuevas)
-- Requiere pg_cron y pg_net (Database > Extensions)
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pgcrypto with schema extensions;


-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint    text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh      text not null check (char_length(p256dh) between 20 and 200),
  auth        text not null check (char_length(auth) between 8 and 100),
  user_agent  text check (char_length(user_agent) <= 200),
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table if not exists public.notification_settings (
  user_id       uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  due_alerts    boolean not null default true,   -- gastos fijos / débitos por vencer
  card_alerts   boolean not null default true,   -- vencimiento del resumen de tarjeta
  budget_alerts boolean not null default true,   -- presupuesto al 80% / 100%
  due_days      smallint not null default 2 check (due_days between 0 and 7),
  show_amounts  boolean not null default false,  -- montos en la pantalla bloqueada: apagado por privacidad
  updated_at    timestamptz not null default now()
);

-- Qué ya se avisó (evita repetir). El usuario solo lo lee.
create table if not exists public.notification_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  ref        text not null,
  request_id bigint,
  sent_at    timestamptz not null default now(),
  unique (user_id, kind, ref)
);

-- Pedidos HTTP en vuelo (para leer la respuesta de Vercel en la corrida siguiente). Interno.
create table if not exists public.push_requests (
  request_id bigint primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions    enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notification_log      enable row level security;
alter table public.push_requests         enable row level security; -- sin políticas: nadie desde la API

drop policy if exists "own_rows" on public.push_subscriptions;
create policy "own_rows" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own_rows" on public.notification_settings;
create policy "own_rows" on public.notification_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own_read" on public.notification_log;
create policy "own_read" on public.notification_log for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_requests from anon, authenticated;
revoke insert, update, delete on public.notification_log from anon, authenticated;

-- Doble factor (005): mismas reglas que el resto de las tablas
do $$
declare t text;
begin
  if to_regprocedure('public.user_has_mfa()') is null then return; end if;
  foreach t in array array['push_subscriptions','notification_settings','notification_log'] loop
    execute format('drop policy if exists "mfa_aal2" on public.%I', t);
    execute format(
      'create policy "mfa_aal2" on public.%I as restrictive for all to authenticated
         using ((select auth.jwt() ->> ''aal'') = ''aal2'' or not (select public.user_has_mfa()))
         with check ((select auth.jwt() ->> ''aal'') = ''aal2'' or not (select public.user_has_mfa()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Qué avisar
-- ---------------------------------------------------------------------
create or replace function public.fmt_ars(n numeric)
returns text language sql immutable set search_path = '' as $$
  select '$ ' || translate(to_char(round(n), 'FM999,999,999,990'), ',', '.')
$$;

create or replace function public.fmt_when(d date, today date)
returns text language sql immutable set search_path = '' as $$
  select case d - today
    when 0 then 'hoy'
    when 1 then 'mañana'
    else (array['el domingo','el lunes','el martes','el miércoles','el jueves','el viernes','el sábado'])[extract(dow from d)::int + 1]
         || ' ' || extract(day from d)::int
  end
$$;

create or replace function public.ucfirst(t text)
returns text language sql immutable set search_path = '' as $$ select upper(left(t, 1)) || substr(t, 2) $$;

create or replace function public.pending_notifications(p_user uuid)
returns table (kind text, ref text, title text, body text, url text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s     public.notification_settings;
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  m0    date := date_trunc('month', today)::date;
begin
  select * into s from public.notification_settings where user_id = p_user;
  if not found then
    s.due_alerts := true; s.card_alerts := true; s.budget_alerts := true; s.due_days := 2; s.show_amounts := false;
  end if;

  -- 1) Gastos fijos / débitos automáticos por vencer
  if s.due_alerts then
    return query
      select 'due'::text, r.id::text || ':' || r.next_date,
             'Vence ' || r.name,
             public.ucfirst(public.fmt_when(r.next_date, today))
               || case when s.show_amounts then ': ' || public.fmt_ars(r.amount) else '' end
               || case when a.type = 'card' then ' · se debita de ' || a.name else '' end,
             '/recurrentes'::text
      from public.recurring r
      join public.accounts a on a.id = r.account_id
      where r.user_id = p_user and r.active and r.type = 'expense'
        and r.next_date between today and today + s.due_days;
  end if;

  -- 2) Resumen de tarjeta por vencer (lo que falta pagar)
  if s.card_alerts then
    return query
      select 'card'::text, st.id::text,
             'Vence la tarjeta ' || a.name,
             public.ucfirst(public.fmt_when(st.due_date, today))
               || case when s.show_amounts then ': ' || public.fmt_ars(st.balance - coalesce(p.paid, 0)) else '' end,
             '/cuotas'::text
      from public.card_statements st
      join public.accounts a on a.id = st.account_id
      left join lateral (
        select sum(t.amount) as paid from public.transactions t
        where t.user_id = p_user and t.type = 'transfer' and t.transfer_account_id = st.account_id
          and t.date >= st.closing_date
      ) p on true
      where st.user_id = p_user and st.due_date between today and today + s.due_days
        and st.balance is not null and st.balance - coalesce(p.paid, 0) > 0;
  end if;

  -- 3) Presupuestos del mes al 80% y al 100% (las subcategorías suman en la categoría madre)
  if s.budget_alerts then
    return query
      with spent as (
        select coalesce(c.parent_id, c.id) as root, sum(t.amount) as amt
        from public.transactions t
        join public.categories c on c.id = t.category_id
        where t.user_id = p_user and t.type = 'expense' and t.date >= m0 and t.date < (m0 + interval '1 month')::date
        group by 1
      )
      select 'budget'::text,
             b.id::text || ':' || to_char(m0, 'YYYY-MM') || case when sp.amt >= b.amount then ':100' else ':80' end,
             case when sp.amt >= b.amount then 'Te pasaste en ' || c.name else c.name || ' al ' || floor(sp.amt / b.amount * 100)::int || '%' end,
             case when s.show_amounts then 'Gastaste ' || public.fmt_ars(sp.amt) || ' de ' || public.fmt_ars(b.amount) || ' este mes'
                  else 'Mirá el detalle en Presupuestos' end,
             '/presupuestos'::text
      from public.budgets b
      join public.categories c on c.id = b.category_id
      join spent sp on sp.root = b.category_id
      where b.user_id = p_user and b.amount > 0 and sp.amt >= b.amount * 0.8;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Envío (pg_net -> Vercel) y lectura de respuestas
-- ---------------------------------------------------------------------
create or replace function public.push_post(p_user uuid, p_notes jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_url text; v_secret text; v_subs jsonb; v_payload text; v_req bigint;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'push_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_secret';
  if v_url is null or v_secret is null then
    raise exception 'Avisos sin configurar: faltan push_app_url / push_secret en Vault (correr configurar-avisos.ps1)';
  end if;
  select jsonb_agg(jsonb_build_object('id', id, 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
    into v_subs from public.push_subscriptions where user_id = p_user;
  if v_subs is null then return null; end if;

  v_payload := jsonb_build_object('v', 1, 'ts', floor(extract(epoch from now()))::bigint,
                                  'subs', v_subs, 'notifications', p_notes)::text;
  select net.http_post(
    url := rtrim(v_url, '/') || '/api/push',
    body := jsonb_build_object('payload', v_payload,
                               'sig', encode(extensions.hmac(v_payload, v_secret, 'sha256'), 'hex')),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 20000
  ) into v_req;
  insert into public.push_requests (request_id, user_id) values (v_req, p_user);
  return v_req;
end $$;

-- Lee lo que respondió Vercel: borra suscripciones muertas; si el envío falló, libera los avisos para reintentar
create or replace function public.process_push_responses()
returns void language plpgsql security definer set search_path = '' as $$
declare r record; x jsonb;
begin
  for r in
    select q.request_id, q.created_at, h.status_code, h.content, h.timed_out
    from public.push_requests q left join net._http_response h on h.id = q.request_id
  loop
    if r.status_code is null and coalesce(r.timed_out, false) = false and r.created_at > now() - interval '1 hour' then
      continue; -- todavía sin respuesta
    end if;
    if r.status_code = 200 then
      for x in select * from jsonb_array_elements(coalesce((r.content::jsonb) -> 'results', '[]'::jsonb)) loop
        if (x ->> 'status')::int in (404, 410) then
          delete from public.push_subscriptions where id = (x ->> 'id')::uuid;
        elsif (x ->> 'status')::int between 200 and 299 then
          update public.push_subscriptions set last_ok_at = now() where id = (x ->> 'id')::uuid;
        end if;
      end loop;
    else
      delete from public.notification_log where request_id = r.request_id;
    end if;
    delete from public.push_requests where request_id = r.request_id;
  end loop;
end $$;

create or replace function public.send_push_notifications()
returns int language plpgsql security definer set search_path = '' as $$
declare u record; v_notes jsonb; v_req bigint; v_n int := 0;
begin
  perform public.process_push_responses();
  for u in select distinct user_id from public.push_subscriptions loop
    select jsonb_agg(jsonb_build_object('title', p.title, 'body', p.body, 'url', p.url, 'tag', p.kind || ':' || p.ref, 'kind', p.kind, 'ref', p.ref))
      into v_notes
      from (select * from public.pending_notifications(u.user_id) n
            where not exists (select 1 from public.notification_log l
                              where l.user_id = u.user_id and l.kind = n.kind and l.ref = n.ref)
            limit 6) p;
    continue when v_notes is null;
    v_req := public.push_post(u.user_id, v_notes);
    insert into public.notification_log (user_id, kind, ref, request_id)
      select u.user_id, e ->> 'kind', e ->> 'ref', v_req from jsonb_array_elements(v_notes) e
      on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Botón "Enviar prueba" de Ajustes: solo a las suscripciones del propio usuario, 1 por minuto
create or replace function public.send_test_push()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ref text := to_char(now(), 'YYYYMMDDHH24MI');
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;
  if public.user_has_mfa() and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then raise exception 'Falta el código de doble factor'; end if;
  insert into public.notification_log (user_id, kind, ref) values (v_uid, 'test', v_ref) on conflict do nothing;
  if not found then raise exception 'Esperá un minuto antes de otra prueba'; end if;
  if public.push_post(v_uid, jsonb_build_array(jsonb_build_object(
       'title', 'Mis Finanzas', 'body', 'Los avisos funcionan en este dispositivo.', 'url', '/ajustes', 'tag', 'test'))) is null then
    raise exception 'Este usuario no tiene dispositivos suscriptos';
  end if;
end $$;

revoke execute on function public.pending_notifications(uuid) from public, anon, authenticated;
revoke execute on function public.push_post(uuid, jsonb)      from public, anon, authenticated;
revoke execute on function public.process_push_responses()    from public, anon, authenticated;
revoke execute on function public.send_push_notifications()   from public, anon, authenticated;
revoke execute on function public.send_test_push()            from public, anon;
grant  execute on function public.send_test_push()            to authenticated;

-- 9:00 Argentina = 12:00 UTC. Mismo nombre => si ya existía, se actualiza.
select cron.schedule('finanzas-avisos', '0 12 * * *', 'select public.send_push_notifications()');
select cron.schedule('finanzas-avisos-respuestas', '15 12 * * *', 'select public.process_push_responses()');
