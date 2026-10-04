-- =====================================================================
-- 007 - Categorías nuevas: Comida (súper, restaurantes, kiosco) y Gimnasio
-- Ejecutar en: Supabase > SQL Editor. Idempotente: no duplica ni pisa
-- categorías que ya existan con el mismo nombre (aunque las hayas creado a mano).
-- =====================================================================

do $$
declare u uuid; p uuid; s record;
begin
  for u in select distinct user_id from public.categories loop

    -- Comida (categoría principal)
    select id into p from public.categories
      where user_id = u and parent_id is null and kind = 'expense'
        and lower(name) in ('comida', 'alimentos', 'alimentación', 'comida y bebida');
    if p is null then
      insert into public.categories (user_id, name, kind, color, icon)
        values (u, 'Comida', 'expense', '#e34948', 'food') returning id into p;
    end if;
    for s in select * from (values
        ('Supermercado', 'cart'),
        ('Restaurantes y delivery', 'food'),
        ('Kiosco y café', 'coffee')) v(name, icon) loop
      insert into public.categories (user_id, name, kind, color, icon, parent_id)
        select u, s.name, 'expense', '#e34948', s.icon, p
        where not exists (select 1 from public.categories
                          where user_id = u and parent_id = p and lower(name) = lower(s.name));
    end loop;

    -- Bienestar: Gimnasio y Streaming
    select id into p from public.categories
      where user_id = u and parent_id is null and kind = 'expense' and name = 'Bienestar';
    if p is not null then
      for s in select * from (values ('Gimnasio', 'gym'), ('Streaming y apps', 'tv')) v(name, icon) loop
        insert into public.categories (user_id, name, kind, color, icon, parent_id)
          select u, s.name, 'expense', '#e87ba4', s.icon, p
          where not exists (select 1 from public.categories
                            where user_id = u and parent_id = p and lower(name) = lower(s.name));
      end loop;
    end if;
  end loop;
end $$;

-- Ver el resultado
select coalesce(pa.name || ' › ', '') || c.name as categoria
from public.categories c left join public.categories pa on pa.id = c.parent_id
where c.kind = 'expense' and not c.archived
order by coalesce(pa.name, c.name), c.parent_id nulls first, c.name;
