-- ============================================================
-- ÓRBITA (hábitos) v4 · Script de base de datos
-- Ejecútalo UNA vez en Supabase → SQL Editor → New query → Run.
-- Se puede volver a ejecutar sin duplicar nada.
-- No borra la tabla antigua (activity_logs): queda como copia de
-- seguridad y sus registros se copian a la tabla nueva.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Actividades (ya no viven en config.js) ----------
create table if not exists activities (
  id          text primary key,
  category_id text not null,
  name        text not null,
  icon        text not null default '⭐',
  type        text not null default 'check' check (type in ('check','qty','avoid')),
  goal        numeric,                     -- solo para type = 'qty'
  unit        text,
  step        numeric default 1,
  weekly      int not null default 0,      -- 0 = diaria; N = veces por semana
  slot        text not null default 'any' check (slot in ('manana','tarde','noche','any')),
  who         text not null default 'ambos' check (who in ('jose','blanca','ambos')),
  sort_order  int not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- 2. Registros diarios (una fila por persona, actividad y día) ----------
create table if not exists habit_logs (
  id           uuid primary key default gen_random_uuid(),
  profile      text not null check (profile in ('jose','blanca')),
  activity_id  text references activities(id) on update cascade,
  custom_name  text,                       -- actividades puntuales sin hábito
  category_id  text not null,
  log_date     date not null,
  status       text not null default 'done' check (status in ('done','skip','fail')),
  qty          numeric,
  note         text,
  logged_time  text,                       -- 'HH:MM'
  legacy_id    uuid unique,                -- id en activity_logs (migración)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint habit_logs_one_per_day unique (profile, activity_id, log_date)
);
create index if not exists idx_habit_logs_date on habit_logs (log_date desc);

-- ---------- 3. Metas a largo plazo ----------
create table if not exists goals (
  id          text primary key,
  name        text not null,
  category_id text not null,
  target      numeric not null,
  unit        text not null default 'unidades',
  step        numeric not null default 1,
  start_date  date not null default current_date,
  end_date    date not null,
  profile     text not null default 'jose',
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists goal_entries (
  id          uuid primary key default gen_random_uuid(),
  goal_id     text not null references goals(id) on delete cascade,
  amount      numeric not null,
  entry_date  date not null default current_date,
  created_at  timestamptz not null default now()
);

-- ---------- 4. Ajustes por persona (modo vacaciones) ----------
create table if not exists profile_settings (
  profile   text primary key check (profile in ('jose','blanca')),
  vac_on    boolean not null default false,
  vac_from  date,
  vac_to    date
);
insert into profile_settings (profile) values ('jose'), ('blanca') on conflict do nothing;

-- ---------- 5. Permisos (misma política que antes: app privada familiar) ----------
do $$
declare t text;
begin
  foreach t in array array['activities','habit_logs','goals','goal_entries','profile_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app_all" on %I', t);
    execute format('create policy "app_all" on %I for all using (true) with check (true)', t);
  end loop;
end $$;
grant select, insert, update, delete on activities, habit_logs, goals, goal_entries, profile_settings to anon, authenticated;

-- ---------- 6. Actividades iniciales (las tuyas + ejemplos de Finanzas y Trabajo) ----------
insert into activities (id, category_id, name, icon, type, goal, unit, step, weekly, slot, who, sort_order) values
  ('meditar',       'yo',       'Meditar',                                 '🧘', 'check', null, null, 1, 0, 'manana', 'ambos', 10),
  ('diario',        'yo',       'Escribir diario',                         '📓', 'check', null, null, 1, 0, 'noche',  'ambos', 20),
  ('solas',         'yo',       'Tiempo a solas',                          '🌿', 'check', null, null, 1, 0, 'any',    'ambos', 30),
  ('gratitud',      'yo',       'Practicar gratitud',                      '🙏', 'check', null, null, 1, 0, 'noche',  'ambos', 40),
  ('coaching',      'yo',       'Terapia / coaching',                      '🗣️', 'check', null, null, 1, 1, 'any',    'ambos', 50),
  ('agua',          'salud',    'Beber agua',                              '💧', 'qty',   8,    'vasos', 1, 0, 'any', 'ambos', 10),
  ('vitaminas',     'salud',    'Tomar vitaminas',                         '💊', 'check', null, null, 1, 0, 'manana', 'ambos', 20),
  ('pasos',         'salud',    'Caminar 10.000 pasos',                    '🚶', 'check', null, null, 1, 0, 'any',    'ambos', 30),
  ('proteina',      'salud',    'Comer más proteína',                      '🥚', 'check', null, null, 1, 0, 'any',    'ambos', 40),
  ('menos-azucar',  'salud',    'Comer menos azúcar/grasa/carbohidratos',  '🥗', 'check', null, null, 1, 0, 'any',    'ambos', 50),
  ('dormir',        'salud',    'Descansar 8 horas',                       '😴', 'check', null, null, 1, 0, 'manana', 'ambos', 60),
  ('medico',        'salud',    'Revisión médica',                         '🩺', 'check', null, null, 1, 1, 'any',    'ambos', 70),
  ('ejercicio',     'salud',    'Hacer ejercicio',                         '🏋️', 'check', null, null, 1, 0, 'tarde',  'ambos', 80),
  ('blanca',        'familia',  'Pasar tiempo con Blanca',                 '❤️', 'check', null, null, 1, 0, 'noche',  'jose',  10),
  ('regalos',       'familia',  'Comprar regalos para la familia',         '🎁', 'check', null, null, 1, 1, 'any',    'jose',  20),
  ('madre',         'familia',  'Llamar a mi madre',                       '📞', 'check', null, null, 1, 0, 'tarde',  'jose',  30),
  ('padre',         'familia',  'Llamar a mi padre',                       '☎️', 'check', null, null, 1, 0, 'tarde',  'jose',  40),
  ('hermano',       'familia',  'Llamar a mi hermano',                     '💬', 'check', null, null, 1, 0, 'tarde',  'jose',  50),
  ('abuelos',       'familia',  'Llamar a mis abuelos',                    '👵', 'check', null, null, 1, 1, 'any',    'jose',  60),
  ('viaje',         'familia',  'Agendar viaje para visitar a la familia', '✈️', 'check', null, null, 1, 1, 'any',    'jose',  70),
  ('gastos',        'finanzas', 'Registrar gastos del día',                '🧾', 'check', null, null, 1, 0, 'noche',  'ambos', 10),
  ('presupuesto',   'finanzas', 'Revisar presupuesto',                     '📊', 'check', null, null, 1, 1, 'any',    'ambos', 20),
  ('impulso',       'finanzas', 'Evitar compras impulsivas',               '🛍️', 'avoid', null, null, 1, 0, 'any',    'ambos', 30),
  ('planificar',    'trabajo',  'Planificar el día',                       '🗓️', 'check', null, null, 1, 0, 'manana', 'jose',  10),
  ('foco',          'trabajo',  'Bloques de trabajo profundo',             '🎯', 'qty',   2,    'bloques', 1, 0, 'tarde', 'jose', 20),
  ('aprender',      'trabajo',  'Aprender algo nuevo',                     '📚', 'check', null, null, 1, 0, 'any',    'jose',  30),
  ('leer',          'hobbies',  'Leer',                                    '📖', 'check', null, null, 1, 0, 'noche',  'ambos', 10),
  ('podcast',       'hobbies',  'Escuchar un podcast',                     '🎧', 'check', null, null, 1, 0, 'any',    'ambos', 20),
  ('naturaleza',    'hobbies',  'Pasar tiempo en la naturaleza',           '🌳', 'check', null, null, 1, 1, 'any',    'ambos', 30)
on conflict (id) do nothing;

-- ---------- 7. Copiar los registros de la versión anterior ----------
-- Todos se asignan a José (la versión anterior no distinguía personas).
-- 7.0 La tabla antigua puede no tener la columna «note»: se añade si falta.
do $$
begin
  if to_regclass('public.activity_logs') is not null then
    alter table activity_logs add column if not exists note text;
  end if;
end $$;

do $$
begin
  if to_regclass('public.activity_logs') is not null then
    -- 7a. Actividades predeterminadas: se agrupan en un registro por día
    insert into habit_logs (profile, activity_id, category_id, log_date, status, qty, note, logged_time)
    select 'jose', a.id, a.category_id,
           (l.logged_at at time zone 'America/Havana')::date,
           'done',
           case when a.type = 'qty' then count(*) * coalesce(a.step, 1) end,
           nullif(string_agg(nullif(l.note, ''), ' · '), ''),
           to_char(min(l.logged_at at time zone 'America/Havana'), 'HH24:MI')
    from activity_logs l
    join activities a on lower(a.name) = lower(l.activity)
    group by a.id, a.category_id, a.type, a.step, (l.logged_at at time zone 'America/Havana')::date
    on conflict (profile, activity_id, log_date) do nothing;

    -- 7b. Actividades personalizadas: se copian tal cual
    insert into habit_logs (profile, custom_name, category_id, log_date, status, note, logged_time, legacy_id)
    select 'jose', l.activity, l.category_id,
           (l.logged_at at time zone 'America/Havana')::date, 'done', nullif(l.note, ''),
           to_char(l.logged_at at time zone 'America/Havana', 'HH24:MI'), l.id
    from activity_logs l
    where not exists (select 1 from activities a where lower(a.name) = lower(l.activity))
    on conflict (legacy_id) do nothing;
  end if;
end $$;

-- ---------- 8. Funciones para los Atajos de iOS (widget) ----------
-- Lista de actividades para el menú del atajo, en el mismo orden que la app.
create or replace function shortcut_menu(p_profile text default 'jose')
returns json
language sql stable
as $$
  select coalesce(json_agg(a.icon || ' ' || a.name order by c.ord, a.sort_order), '[]'::json)
  from activities a
  join (values ('yo',1),('salud',2),('familia',3),('finanzas',4),('trabajo',5),('hobbies',6)) as c(id, ord)
    on c.id = a.category_id
  where not a.archived
    and a.type <> 'avoid'
    and (a.who = 'ambos' or a.who = p_profile);
$$;

-- Registra una actividad hoy. Acepta el id, el nombre o «icono + nombre».
-- En actividades con cantidad suma un paso (p. ej. +1 vaso).
create or replace function quick_log(p_activity text, p_profile text default 'jose')
returns json
language plpgsql
as $$
declare
  a    activities%rowtype;
  d    date := (now() at time zone 'America/Havana')::date;
  t    text := to_char(now() at time zone 'America/Havana', 'HH24:MI');
  q    numeric;
  fmt  text;
begin
  if p_profile not in ('jose', 'blanca') then
    return json_build_object('ok', false, 'mensaje', 'Perfil desconocido: ' || coalesce(p_profile, '(vacío)'));
  end if;

  select * into a from activities
  where not archived
    and (id = trim(p_activity)
         or lower(name) = lower(trim(p_activity))
         or lower(icon || ' ' || name) = lower(trim(p_activity)))
  order by sort_order
  limit 1;

  if not found then
    return json_build_object('ok', false, 'mensaje', 'No encuentro la actividad «' || coalesce(p_activity, '') || '»');
  end if;

  if a.type = 'qty' then
    insert into habit_logs (profile, activity_id, category_id, log_date, status, qty, logged_time)
    values (p_profile, a.id, a.category_id, d, 'done', coalesce(a.step, 1), t)
    on conflict (profile, activity_id, log_date)
    do update set qty = coalesce(habit_logs.qty, 0) + coalesce(a.step, 1),
                  status = 'done', logged_time = excluded.logged_time, updated_at = now()
    returning qty into q;
    fmt := case when q = trunc(q) then trunc(q)::text else q::text end;
    return json_build_object('ok', true, 'mensaje',
      a.icon || ' ' || a.name || ': ' || fmt || ' de ' ||
      (case when a.goal = trunc(a.goal) then trunc(a.goal)::text else a.goal::text end) || ' ' || coalesce(a.unit, ''));
  elsif a.type = 'avoid' then
    insert into habit_logs (profile, activity_id, category_id, log_date, status, logged_time)
    values (p_profile, a.id, a.category_id, d, 'fail', t)
    on conflict (profile, activity_id, log_date)
    do update set status = 'fail', logged_time = excluded.logged_time, updated_at = now();
    return json_build_object('ok', true, 'mensaje', 'Recaída registrada: ' || a.name);
  else
    insert into habit_logs (profile, activity_id, category_id, log_date, status, logged_time)
    values (p_profile, a.id, a.category_id, d, 'done', t)
    on conflict (profile, activity_id, log_date)
    do update set status = 'done', logged_time = excluded.logged_time, updated_at = now();
    return json_build_object('ok', true, 'mensaje', '✓ ' || a.icon || ' ' || a.name);
  end if;
end;
$$;

grant execute on function shortcut_menu(text) to anon, authenticated;
grant execute on function quick_log(text, text) to anon, authenticated;

-- Refresca la caché de la API para que vea las tablas y funciones nuevas al momento
notify pgrst, 'reload schema';

-- Comprobación: debería mostrar tus actividades y cuántos registros se copiaron
select
  (select count(*) from activities)                 as actividades,
  (select count(*) from habit_logs)                 as registros_copiados,
  (select count(*) from activity_logs)              as registros_version_anterior;
