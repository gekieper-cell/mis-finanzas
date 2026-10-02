-- =====================================================================
-- 005 - Doble factor (TOTP) obligatorio en la BASE DE DATOS
-- Ejecutar en: Supabase > SQL Editor (proyecto cfsysumtjsdofjcvocho)
-- Idempotente.
--
-- Efecto: si el usuario tiene un segundo factor VERIFICADO, cualquier sesión que
-- solo pasó la contraseña (aal1) no ve ni modifica ninguna fila. Hace falta aal2.
-- Si no activaste el doble factor, todo sigue funcionando igual.
--
-- Si perdés el celular con el autenticador: Supabase > Authentication > Users >
-- tu usuario > eliminar el factor (o: delete from auth.mfa_factors where user_id = '<tu id>';)
-- =====================================================================

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
