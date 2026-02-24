-- 04_post_migration_checks.sql
-- Validaciones post-migración (NO destructivo)
-- Ejecutar en el proyecto NUEVO después de:
-- 1) 01_schema_full.sql
-- 2) 03_import_new_project.sql

-- ==============================
-- 1) Verificar objetos principales
-- ==============================
select 'table_exists:game_rooms' as check_name,
       to_regclass('public.game_rooms') is not null as ok
union all
select 'table_exists:game_questions', to_regclass('public.game_questions') is not null
union all
select 'table_exists:game_question_types', to_regclass('public.game_question_types') is not null
union all
select 'function_exists:try_lock_buzzer(text,text)',
       exists (
         select 1
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'try_lock_buzzer'
           and pg_get_function_identity_arguments(p.oid) = 'p_room text, p_team text'
       );

-- ==============================
-- 2) Conteos de datos migrados
-- ==============================
select 'count:game_rooms' as metric, count(*)::bigint as value from public.game_rooms
union all
select 'count:game_question_types', count(*)::bigint from public.game_question_types
union all
select 'count:game_questions', count(*)::bigint from public.game_questions;

-- Conteo por room_code
select room_code,
       count(*) filter (where source = 'rooms') as rows_game_rooms,
       count(*) filter (where source = 'types') as rows_game_question_types,
       count(*) filter (where source = 'questions') as rows_game_questions
from (
  select room_code, 'rooms' as source from public.game_rooms
  union all
  select room_code, 'types' as source from public.game_question_types
  union all
  select room_code, 'questions' as source from public.game_questions
) t
group by room_code
order by room_code;

-- ==============================
-- 3) RLS habilitado
-- ==============================
select c.relname as table_name,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('game_rooms', 'game_questions', 'game_question_types')
order by c.relname;

-- ==============================
-- 4) Policies esperadas (anon)
-- ==============================
select schemaname,
       tablename,
       policyname,
       cmd,
       roles
from pg_policies
where schemaname = 'public'
  and tablename in ('game_rooms', 'game_questions', 'game_question_types')
order by tablename, policyname;

-- ==============================
-- 5) Publicación realtime
-- ==============================
select p.pubname,
       c.relname as table_name
from pg_publication p
join pg_publication_rel pr on pr.prpubid = p.oid
join pg_class c on c.oid = pr.prrelid
join pg_namespace n on n.oid = c.relnamespace
where p.pubname = 'supabase_realtime'
  and n.nspname = 'public'
  and c.relname in ('game_rooms', 'game_questions', 'game_question_types')
order by c.relname;

-- ==============================
-- 6) Sanidad de datos (referencias)
-- ==============================
-- Preguntas con type_id inexistente en su room_code
select q.room_code,
       q.position,
       q.type_id
from public.game_questions q
left join public.game_question_types t
  on t.room_code = q.room_code
 and t.id = q.type_id
where q.type_id is not null
  and btrim(q.type_id) <> ''
  and t.id is null
order by q.room_code, q.position;

-- Preguntas con answers no-array
select room_code,
       position,
       jsonb_typeof(answers) as answers_type
from public.game_questions
where jsonb_typeof(answers) is distinct from 'array'
order by room_code, position;

-- ==============================
-- 7) Smoke test RPC (sin modificar datos)
-- ==============================
-- Nota: usa room inexistente para evitar side effects
select *
from public.try_lock_buzzer('__NON_EXISTING_ROOM__', 'A');
