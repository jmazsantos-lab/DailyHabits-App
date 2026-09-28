-- ============================================================
-- Esquema de base de datos para el Habit Tracker
-- Ejecuta esto en el SQL Editor de tu proyecto Supabase
-- (ver README.md para el paso a paso)
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  category_id text not null,
  activity text not null,
  is_custom boolean not null default false,
  note text,                  -- nota corta opcional al registrar
  device text,               -- 'iphone', 'ipad', etc. (informativo)
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Si ya tenías la tabla creada de antes (sin la columna note), esta
-- línea la añade sin tocar tus datos existentes:
alter table activity_logs add column if not exists note text;

create index if not exists idx_activity_logs_logged_at on activity_logs (logged_at desc);
create index if not exists idx_activity_logs_category on activity_logs (category_id);

-- Row Level Security: la app usa la clave "anon" pública, así que
-- abrimos lectura/escritura a quien tenga esa clave. Es apropiado
-- para una app privada de uso familiar cuya URL y clave no se
-- publican. No la compartas fuera de tu pareja y de ti.
alter table activity_logs enable row level security;

create policy "allow read for anon" on activity_logs
  for select using (true);

create policy "allow insert for anon" on activity_logs
  for insert with check (true);

create policy "allow delete for anon" on activity_logs
  for delete using (true);
