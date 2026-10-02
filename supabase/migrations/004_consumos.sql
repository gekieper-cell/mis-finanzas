-- =====================================================================
-- 004 - Importación de consumos del resumen de tarjeta
-- Ejecutar en: Supabase > SQL Editor (proyecto cfsysumtjsdofjcvocho)
-- Idempotente.
-- =====================================================================

-- Identificador del renglón del resumen: al volver a subir un resumen no se duplican movimientos
alter table public.transactions
  add column if not exists import_key text check (char_length(import_key) <= 200);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_user_import_key') then
    alter table public.transactions add constraint transactions_user_import_key unique (user_id, import_key);
  end if;
end $$;
