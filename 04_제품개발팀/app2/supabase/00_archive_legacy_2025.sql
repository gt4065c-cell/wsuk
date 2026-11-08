-- edu-gamify 프로젝트에 있던 2025년 빈 표 11개 보관 (2026-11-02 적용 완료, 캡틴 선택 "② 이름 바꿔 보관")
-- 지우지 않고 old_ 이름으로 바꾸고, RLS를 켜서 아무도 못 읽게 잠금. 이름표(제약·인덱스)도 old_ 로 바꿔 새 표와 충돌 방지.
do $$
declare t text; r record;
begin
  foreach t in array array['students','quizzes','quiz_questions','quiz_attempts','battles','assignments',
                           'assignment_submissions','activities','achievements','student_achievements','leaderboards'] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I rename to %I', t, 'old_'||t);
      execute format('alter table public.%I enable row level security', 'old_'||t);
    end if;
  end loop;
  for r in select con.conname, c.relname from pg_constraint con join pg_class c on c.oid=con.conrelid
           join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname like 'old\_%' and con.conname not like 'old\_%' loop
    execute format('alter table public.%I rename constraint %I to %I', r.relname, r.conname, 'old_'||r.conname);
  end loop;
  for r in select ic.relname as idx from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_class c on c.oid=i.indrelid
           join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname like 'old\_%' and ic.relname not like 'old\_%' loop
    execute format('alter index public.%I rename to %I', r.idx, 'old_'||r.idx);
  end loop;
end $$;
