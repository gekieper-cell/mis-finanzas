-- =====================================================================
-- 006 - Avisos push: "Supabase decide, Vercel envía"
-- Ejecutar en: Supabase > SQL Editor, DESPUÉS de 005. Idempotente.
--
-- Cómo funciona
--  1. Todos los días a las 9:00 (hora Argentina) pg_cron corre send_push_notifications().
--  2. La base arma los avisos de cada usuario (vencimientos, tarjeta, presupuestos) y
--     los manda a https://<tu-app>/api/push con pg_net, firmados con HMAC-SHA256.
--  3. Vercel verifica la firma y la hora, y entrega el push a Apple/Google con las claves VAPID.
--     Vercel NO tiene credenciales de la base: solo recibe lo que la base decide mandar.
--  4. Las suscripciones vencidas (404/410) se borran solas en la corrida siguiente.
--
-- Requisitos (una sola vez):
--  - Database > Extensions: habilitar pg_cron y pg_net.
--  - Guardar en Vault la URL de la app y el secreto compartido. Lo hace configurar-avisos.ps1
--    (te copia el SQL al portapapeles; el secreto no pasa por ningún chat).
-- =====================================================================

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
