-- [개발용] O/X 쏠림 수정(40_ox_fix.sql) 시험 — 내 컴퓨터의 임시 PostgreSQL에서만 (실제 Supabase에서는 실행하지 말 것)
-- 순서(따로 만든 빈 DB): 00_fake_supabase.sql → 05_fake_auth_m2.sql → ../schema.sql → ../30_m2_teams_admin.sql → ../40_ox_fix.sql(2번) → 이 파일
-- 근거: 03_교육기획팀/2026-11-02_OX쏠림_해결안.md 4장 (E0 고르기용 c 0.25, E7 한 판 O/X 최대 2, Elo·진단은 진짜 c)
-- 결과: 줄마다 "PASS X-xx …" / "FAIL X-xx …" 알림. run_m2_local.sh 가 셉니다. 학생·문항 모두 가짜입니다.
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function zz_check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;
grant execute on function zz_check(boolean, text) to anon, authenticated;

-- ---------- 가짜 연습 문항: 실제 은행처럼 O/X는 거의 난이도 2, 30강에 흩어 놓음 ----------
-- 4지선다 난이도0(b −2) 30 · 난이도1(b −1) 27 · 난이도2(b 0) 13 · 난이도3(b +1) 20 / O/X 난이도1 1 · 난이도2 15
insert into questions (id, part, lecture, difficulty, type, question, choices, pool, diag_order, b)
select 'F' || g.i, 1, (g.i % 30) + 1, g.d, g.t, '가짜 문항 ' || g.i,
       case when g.t = 'ox' then '["O","X"]'::jsonb else '["가","나","다","라"]'::jsonb end, 'practice', null, g.d - 2
from (
  select i, case when i < 30 then 0 when i < 57 then 1 when i < 70 then 2 when i < 90 then 3 when i < 91 then 1 else 2 end as d,
            case when i < 90 then 'mcq' else 'ox' end as t
  from generate_series(0, 105) i
) g;
insert into question_keys (question_id, answer_index, explanation) select id, 0, '해설' from questions;
update app_settings set open_up_to = 30 where id = 1;

-- 가짜 학생 3명(θ −3, 1, 0) + 기기
insert into students (code, cohort, nickname, theta, diag_done) values
  ('PXLWA2', '2027-1', '낮음', -3, true), ('PXHGB2', '2027-1', '높음', 1, true), ('PXMDC2', '2027-1', '보통', 0, true);
create temp table dev as select s.code, gen_random_uuid() as uid from students s;
grant select on dev to authenticated;
insert into auth.users (id) select uid from dev;
insert into student_devices (auth_uid, student_id) select d.uid, s.id from dev d join students s on s.code = d.code;

-- 한 판 시뮬레이션 도우미: next_practice 를 p_exclude 를 늘려 가며 n번 부름 (기록은 안 남김 = 빈 기록 학생)
create or replace function zz_session(p_n int) returns text[] language plpgsql as $$
declare ex text[] := '{}'; r json;
begin
  for i in 1 .. p_n loop
    r := next_practice('[]'::jsonb, ex);
    exit when r is null;
    ex := ex || (r ->> 'qid');
  end loop;
  return ex;
end $$;
grant execute on function zz_session(int) to authenticated;

-- =====================================================================
-- A. E0 고르기용 c 0.25 — θ −3 학생: 5문제 모두 4지선다·난이도 0 (고치기 전엔 O/X 5개)
-- =====================================================================
select uid as uid_low from dev where code = 'PXLWA2' \gset
set role authenticated; set test.uid = :'uid_low';
create temp table low_runs as select s, zz_session(5) as ids from generate_series(1, 10) s;
reset role;
select zz_check(bool_and(array_length(ids, 1) = 5) and
  (select count(*) from low_runs, unnest(ids) x join questions q on q.id = x where q.type <> 'mcq' or q.difficulty <> 0) = 0,
  'X-01 θ −3: 한 판 5문제 × 10번 모두 4지선다·난이도 0') from low_runs;

-- =====================================================================
-- B. E7 한 판 O/X 최대 2 — θ 1 학생: 20판 모두 O/X 2개 이하
-- =====================================================================
select uid as uid_high from dev where code = 'PXHGB2' \gset
set role authenticated; set test.uid = :'uid_high';
create temp table high_runs as select s, zz_session(5) as ids from generate_series(1, 20) s;
reset role;
create temp table high_ox as
  select r.s, count(*) filter (where q.type = 'ox') as n_ox from high_runs r, unnest(r.ids) x join questions q on q.id = x group by r.s;
select zz_check(count(*) = 20 and max(n_ox) <= 2,
  'X-02 θ 1: 한 판 5문제 × 20번, 어느 판도 O/X 3개 이상 없음 (판당 최대 ' || max(n_ox) || '개, 평균 ' || round(avg(n_ox) * 20) || '%)') from high_ox;

-- E7 자세히: O/X 2개 낸 뒤엔 4지선다, O/X 아닌 후보가 0개면 O/X 허용
set role authenticated; set test.uid = :'uid_high';
select next_practice('[]'::jsonb, array['F90', 'F91']) ->> 'qid' as after2 \gset
select next_practice('[]'::jsonb, (select array_agg(id) from questions where pool = 'practice' and (type = 'mcq' or id in ('F90', 'F91')))) ->> 'qid' as onlyox \gset
reset role;
select zz_check((select type from questions where id = :'after2') = 'mcq', 'X-03 이번 판 O/X 2개(p_exclude) 뒤에는 4지선다 → ' || :'after2');
select zz_check((select type from questions where id = :'onlyox') = 'ox', 'X-04 4지선다 후보가 0개면 O/X도 냄(빼지 않음) → ' || :'onlyox');

-- =====================================================================
-- C. 바뀌지 않아야 하는 곳: close_item 의 Elo 는 진짜 c (O/X 0.5)
-- =====================================================================
select uid as uid_mid from dev where code = 'PXMDC2' \gset
set role authenticated; set test.uid = :'uid_mid';
select close_item('F95', 'PRACTICE', 0, array[0]) ->> 'outcome' as mid_outcome \gset
reset role;
select zz_check(:'mid_outcome' = '혼자 맞힘' and abs((select theta from students where code = 'PXMDC2') - 0.2) < 1e-9,
  'X-05 θ 0 학생이 O/X(b 0) 혼자 맞힘 → close_item 은 P 0.75(c 0.5)로 계산: θ 0 → 0.2');
select zz_check(position('1.0 / r.nc' in pg_get_functiondef('diag_finish()'::regprocedure)) > 0
  and position('1.0 / jsonb_array_length(q.choices)' in pg_get_functiondef('close_item(text,text,int,int[])'::regprocedure)) > 0,
  'X-06 diag_finish·close_item 은 진짜 c(1 ÷ 보기 수) 그대로');
select zz_check(position('lu_p(me.theta, q.b, 0.25)' in pg_get_functiondef('next_practice(jsonb,text[])'::regprocedure)) > 0,
  'X-07 next_practice 만 고르기용 c 0.25');

-- =====================================================================
-- D. 실행 권한
-- =====================================================================
select zz_check(not has_function_privilege('anon', 'next_practice(jsonb,text[])', 'execute')
  and has_function_privilege('authenticated', 'next_practice(jsonb,text[])', 'execute')
  and not exists (select 1 from information_schema.routine_privileges where routine_name = 'next_practice' and grantee = 'PUBLIC'),
  'X-08 next_practice: anon·public 실행 불가, authenticated 가능');
