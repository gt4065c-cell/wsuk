-- [개발용] 주간 공통 점검 + 팀 해설 당번 서버 함수 시험 (60_m2_weekly_explainer.sql) — 내 컴퓨터의 임시 PostgreSQL 에서만
-- 순서: run_weekly_local.sh 가 00 → 05 → 06 → ../schema.sql → ../30 → ../40 → ../50 → ../60(2번) → 이 파일 을 실행
-- 결과: 줄마다 "PASS W-xx …" 또는 "FAIL W-xx …". 학생·교수 정보는 모두 가짜(코드·별명·example.com)
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function zz_check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;
grant execute on function zz_check(boolean, text) to anon, authenticated;
create or replace function zz_expect_error(p_sql text, p_expect text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'FAIL % (오류 없이 실행됨)', p_label;
exception when others then
  if position(p_expect in sqlerrm) > 0 then raise notice 'PASS % [%]', p_label, sqlerrm;
  else raise notice 'FAIL % (다른 오류: %)', p_label, sqlerrm; end if;
end $$;
grant execute on function zz_expect_error(text, text, text) to anon, authenticated;
-- 학생 역할에서 "오류 없이 0줄"인지 보는 도우미 (RLS 로 막혀 0줄이거나 권한 오류면 통과)
create or replace function zz_rows(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || p_sql || ') z' into n; return n;
exception when insufficient_privilege then return -1;
end $$;
grant execute on function zz_rows(text) to authenticated;

-- ---------- 가짜 문항 (공통 점검: 1주 3개 · 2주 3개, 연습 4개) — 주 번호는 비워 두고 60번 파일의 채우기로 채움 ----------
insert into questions (id, part, lecture, difficulty, type, question, choices, source_section, pool, diag_order, b) values
  ('W1-Q1', 1, 1, 1, 'mcq', '가짜 점검 1주 문항 1', '["가","나","다","라"]', '1-1', 'assessment', null, -1),
  ('W1-Q2', 1, 2, 1, 'mcq', '가짜 점검 1주 문항 2', '["가","나","다","라"]', '2-1', 'assessment', null, -1),
  ('W1-Q3', 1, 2, 1, 'mcq', '가짜 점검 1주 문항 3', '["가","나","다","라"]', '2-2', 'assessment', null, -1),
  ('W2-Q1', 1, 3, 1, 'mcq', '가짜 점검 2주 문항 1', '["가","나","다","라"]', '3-1', 'assessment', null, -1),
  ('W2-Q2', 1, 4, 1, 'mcq', '가짜 점검 2주 문항 2', '["가","나","다","라"]', '4-1', 'assessment', null, -1),
  ('W2-Q3', 1, 4, 1, 'mcq', '가짜 점검 2주 문항 3', '["가","나","다","라"]', '4-2', 'assessment', null, -1),
  ('L09-Q9', 1, 9, 2, 'mcq', '가짜 평가 문항(주 점검 아님)', '["가","나","다","라"]', '9-1', 'assessment', null, 0),
  ('X-P1', 1, 5, 1, 'mcq', '가짜 연습 1', '["가","나","다","라"]', '5-1', 'practice', null, -1),
  ('X-P2', 1, 6, 1, 'mcq', '가짜 연습 2', '["가","나","다","라"]', '6-1', 'practice', null, -1),
  ('X-P3', 1, 7, 1, 'mcq', '가짜 연습 3', '["가","나","다","라"]', '7-1', 'practice', null, -1),
  ('X-P4', 1, 8, 1, 'mcq', '가짜 연습 4', '["가","나","다","라"]', '8-1', 'practice', null, -1);
insert into question_keys (question_id, answer_index, explanation) values
  ('W1-Q1', 0, '해설'), ('W1-Q2', 0, '해설'), ('W1-Q3', 0, '해설'),
  ('W2-Q1', 1, '비밀 해설 2-1'), ('W2-Q2', 2, '비밀 해설 2-2'), ('W2-Q3', 3, '비밀 해설 2-3'), ('L09-Q9', 0, '해설'),
  ('X-P1', 0, '해설'), ('X-P2', 0, '해설'), ('X-P3', 0, '해설'), ('X-P4', 0, '해설');

-- 60번 파일의 "주 번호 채우기"를 다시 실행(가짜 문항을 넣은 뒤) — 파일을 그대로 한 번 더 실행해도 안전한지도 함께 봄
\i ../60_m2_weekly_explainer.sql

-- ---------- 가짜 학생 + 기기 + 팀 ----------
-- 1팀: 가람(A) · 나래(B) · 다솜(C) · 라온(D, 팀 활동 쉼) / 2팀: 마루(E) / 팀 없음: 바람(F)
insert into teams (cohort, name) values ('2027-1', '1팀'), ('2027-1', '2팀');
insert into students (code, cohort, nickname, team_id, team_off, created_at) values
  ('WKAA22', '2027-1', '가람', (select id from teams where name = '1팀'), false, now() - interval '4 hours'),
  ('WKBB22', '2027-1', '나래', (select id from teams where name = '1팀'), false, now() - interval '3 hours'),
  ('WKCC22', '2027-1', '다솜', (select id from teams where name = '1팀'), false, now() - interval '2 hours'),
  ('WKDD22', '2027-1', '라온', (select id from teams where name = '1팀'), true,  now() - interval '5 hours'),
  ('WKEE22', '2027-1', '마루', (select id from teams where name = '2팀'), false, now()),
  ('WKFF22', '2027-1', '바람', null, false, now());
create temp table dev as select s.code, s.id as sid, gen_random_uuid() as uid from students s where s.code like 'WK%';
grant select on dev to authenticated;
insert into auth.users (id) select uid from dev;
insert into student_devices (auth_uid, student_id) select uid, sid from dev;
insert into auth.users (id, email, email_confirmed_at) values ('aaaaaaaa-0000-4000-8000-000000000001', 'prof@example.com', now());
insert into admins (email) values ('prof@example.com') on conflict do nothing;
select uid as ua, sid as sa from dev where code = 'WKAA22' \gset
select uid as ub, sid as sb from dev where code = 'WKBB22' \gset
select uid as uc, sid as sc from dev where code = 'WKCC22' \gset
select uid as ud, sid as sd from dev where code = 'WKDD22' \gset
select uid as ue, sid as se from dev where code = 'WKEE22' \gset
select uid as uf, sid as sf from dev where code = 'WKFF22' \gset
select id as t1 from teams where name = '1팀' \gset
select id as t2 from teams where name = '2팀' \gset
select lu_week_start(lu_today()) as wk \gset

-- =====================================================================
-- A. 칸·표·권한
-- =====================================================================
select zz_check((select bool_and(rowsecurity) from pg_tables where tablename in ('weekly_checks', 'weekly_answers', 'team_explainers'))
                and (select count(*) from pg_tables where tablename in ('weekly_checks', 'weekly_answers', 'team_explainers')) = 3,
  'W-01 새 표 3개(weekly_checks·weekly_answers·team_explainers) 모두 RLS 켜짐');
select zz_check(not exists (select 1 from information_schema.role_table_grants
                             where table_name in ('weekly_checks', 'weekly_answers', 'team_explainers') and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'W-02 새 표 권한: anon·authenticated 0개');
select zz_check(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'W-03 RLS 꺼진 표 0개');
select zz_check((select cohort_start is null from app_settings where id = 1), 'W-04 기수 시작일(cohort_start) 기본값 = 비어 있음(점검 꺼짐)');
select zz_expect_error($$update app_settings set cohort_start = date '2027-03-02' where id = 1$$, 'check', 'W-05 기수 시작일은 월요일만 (화요일 2027-03-02 거절)');
select zz_check((select array_agg(id || '=' || coalesce(week::text, '-') order by id) from questions where id like 'W%' or id in ('L09-Q9', 'X-P1'))
                = array['L09-Q9=-', 'W1-Q1=1', 'W1-Q2=1', 'W1-Q3=1', 'W2-Q1=2', 'W2-Q2=2', 'W2-Q3=2', 'X-P1=-'],
  'W-06 주 번호 채우기: W{주}-Q{번호} 평가 문항만 채움, 연습·다른 평가 문항은 비움');

set role authenticated;
select set_config('test.uid', :'ua', false);
select set_config('test.jwt', json_build_object('sub', :'ua', 'is_anonymous', true)::text, false);
select zz_expect_error($$select lu_check_week()$$, 'permission denied', 'W-07 학생은 내부 도우미 lu_check_week 실행 불가');
select zz_expect_error(format($$select lu_explainer_pick(%L::uuid, current_date)$$, :'t1'), 'permission denied', 'W-08 학생은 내부 도우미 lu_explainer_pick 실행 불가');
select zz_check(zz_rows('select * from weekly_checks') = -1 and zz_rows('select * from weekly_answers') = -1 and zz_rows('select * from team_explainers') = -1,
  'W-09 학생은 새 표 3개를 직접 못 읽음 (permission denied)');
select zz_expect_error(format($$insert into weekly_checks (student_id, week, cohort, n_items, n_correct) values (%L, 1, '2027-1', 8, 8)$$, :'sa'), 'permission denied',
  'W-10 학생은 응시 기록을 직접 못 씀(만점 기록 끼워 넣기 방지)');
select zz_expect_error($$update app_settings set cohort_start = null$$, 'permission denied', 'W-11 학생은 점검 켜고 끄기(cohort_start) 못 바꿈');
-- 꺼진 상태
select weekly_check_status() as s0 \gset
select zz_check(:'s0'::jsonb ->> 'reason' = 'OFF' and not (:'s0'::jsonb ->> 'open')::boolean and not (:'s0'::jsonb ->> 'done')::boolean,
  'W-12 기수 시작일이 없으면 점검 꺼짐(OFF)');
select zz_expect_error($$select weekly_check_items()$$, 'WEEKLY_CLOSED', 'W-13 꺼져 있으면 문항 안 줌(WEEKLY_CLOSED)');
select zz_expect_error($$select weekly_check_submit('{}'::jsonb)$$, 'WEEKLY_CLOSED', 'W-14 꺼져 있으면 제출 거절(WEEKLY_CLOSED)');
reset role;
set role anon;
select zz_expect_error($$select weekly_check_status()$$, 'permission denied', 'W-15 익명(로그인 전)은 점검 함수 실행 불가');
select zz_expect_error($$select my_team_explainer()$$, 'permission denied', 'W-16 익명(로그인 전)은 해설 당번 함수 실행 불가');
reset role;

-- 시작 전 · 끝난 뒤
update app_settings set cohort_start = (:'wk'::date + 7) where id = 1;
set role authenticated;
select zz_check(weekly_check_status() ->> 'reason' = 'NOT_STARTED' and (weekly_check_status() ->> 'week') is null, 'W-17 기수 시작 전(다음 주 월요일) → NOT_STARTED');
reset role;
update app_settings set cohort_start = (:'wk'::date - 7 * 5) where id = 1;
set role authenticated;
select zz_check(weekly_check_status() ->> 'reason' = 'ENDED' and (weekly_check_status() ->> 'week')::int = 6, 'W-18 마지막 주(2주차) 지난 6주차 → ENDED');
reset role;

-- =====================================================================
-- B. 2주차로 열기 → 문항 받기 · 제출
-- =====================================================================
update app_settings set cohort_start = (:'wk'::date - 7) where id = 1;
select zz_check(lu_check_week() = 2, 'W-19 기수 시작일 = 지난주 월요일 → 오늘은 2주차');
set role authenticated;
select set_config('test.uid', :'ua', false);
select weekly_check_status() as s1 \gset
select zz_check((:'s1'::jsonb ->> 'open')::boolean and (:'s1'::jsonb ->> 'week')::int = 2 and (:'s1'::jsonb ->> 'nItems')::int = 3
                and not (:'s1'::jsonb ->> 'done')::boolean and (:'s1'::jsonb -> 'team' ->> 'active')::int = 3 and (:'s1'::jsonb -> 'team' ->> 'taken')::int = 0,
  'W-20 열림: 2주차 · 3문항 · 아직 응시 전 · 팀원 0/3명 응시(쉼 팀원 빼고)');
select weekly_check_items() as it \gset
select zz_check((select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(:'it'::jsonb -> 'items') x) = array['W2-Q1', 'W2-Q2', 'W2-Q3'],
  'W-21 문항: 이번 주(2주차) 3개만 (1주차·다른 평가 문항 없음)');
select zz_check((select bool_and((select array_agg(k order by k) from jsonb_object_keys(x) k) = array['choices', 'id', 'lecture', 'question', 'type'])
                 from jsonb_array_elements(:'it'::jsonb -> 'items') x)
                and position('answer' in :'it') = 0 and position('비밀 해설' in :'it') = 0,
  'W-22 문항에는 글·보기·강·종류만 (정답 번호·해설 없음)');
select zz_check(zz_rows($$select * from questions where pool = 'assessment'$$) = 0 and zz_rows($$select * from question_keys where question_id like 'W2-%'$$) = 0,
  'W-23 학생은 표로 점검 문항·정답을 여전히 못 읽음(0줄)');
-- 잘못된 제출 (모두 거절, 기록 0)
select zz_expect_error($$select weekly_check_submit('{"W2-Q1":1,"W2-Q2":2}'::jsonb)$$, 'BAD_ANSWERS', 'W-24 한 문항 빠짐 → BAD_ANSWERS');
select zz_expect_error($$select weekly_check_submit('{"W2-Q1":1,"W2-Q2":2,"W2-Q3":3,"W1-Q1":0}'::jsonb)$$, 'BAD_ANSWERS', 'W-25 다른 주 문항 섞임 → BAD_ANSWERS');
select zz_expect_error($$select weekly_check_submit('{"W2-Q1":1,"W2-Q2":2,"W2-Q3":7}'::jsonb)$$, 'BAD_ANSWERS', 'W-26 보기 번호 범위 밖 → BAD_ANSWERS');
select zz_expect_error($$select weekly_check_submit('{"W2-Q1":"1","W2-Q2":2,"W2-Q3":3}'::jsonb)$$, 'BAD_ANSWERS', 'W-27 숫자가 아닌 답 → BAD_ANSWERS');
select zz_expect_error($$select weekly_check_submit('{"W2-Q1":-1,"W2-Q2":2,"W2-Q3":3}'::jsonb)$$, 'BAD_ANSWERS', 'W-28 음수 → BAD_ANSWERS');
select zz_expect_error($$select weekly_check_submit('[1,2,3]'::jsonb)$$, 'BAD_ANSWERS', 'W-29 목록 모양 → BAD_ANSWERS');
reset role;
select zz_check((select count(*) from weekly_checks) = 0 and (select count(*) from weekly_answers) = 0, 'W-30 거절된 제출은 기록 0줄');
-- 정상 제출: W2-Q1 정답(1), W2-Q2 오답(0, 4강), W2-Q3 모르겠어요(null, 4강)
set role authenticated;
select set_config('test.uid', :'ua', false);
select weekly_check_submit('{"W2-Q1":1,"W2-Q2":0,"W2-Q3":null}'::jsonb) as sub \gset
select zz_check((select array_agg(k order by k) from jsonb_object_keys(:'sub'::jsonb) k) = array['done', 'reviewLectures', 'week']
                and (:'sub'::jsonb -> 'reviewLectures') = '[4]'::jsonb,
  'W-31 제출 → "응시 완료" + 다시 볼 강 [4] 만 (점수·맞힌 수·문항별 정오답 없음)');
select weekly_check_status() as s2 \gset
select zz_check((:'s2'::jsonb ->> 'done')::boolean and (:'s2'::jsonb -> 'reviewLectures') = '[4]'::jsonb and (:'s2'::jsonb -> 'team' ->> 'taken')::int = 1
                and :'s2' !~ 'correct|score|점수',
  'W-32 응시 뒤 홈 상태: 응시 완료 · 다시 볼 강 [4] · 팀원 1/3명 응시 · 점수 칸 없음');
select zz_expect_error($$select weekly_check_submit('{"W2-Q1":1,"W2-Q2":2,"W2-Q3":3}'::jsonb)$$, 'WEEKLY_DONE', 'W-33 같은 주 다시 제출 → WEEKLY_DONE (만점 답으로 다시 내기 불가)');
select zz_expect_error($$select weekly_check_items()$$, 'WEEKLY_DONE', 'W-34 같은 주 다시 문항 받기 → WEEKLY_DONE');
reset role;
select zz_check((select n_items = 3 and n_correct = 1 and cohort = '2027-1' from weekly_checks where student_id = :'sa' and week = 2)
                and (select count(*) from weekly_answers where student_id = :'sa') = 3,
  'W-35 서버에는 맞힌 수 1/3 · 문항별 답 3줄 저장 (학생에게는 안 보냄)');
-- 다른 팀원 B(만점) · 쉼 팀원 D · 다른 팀 E · 팀 없는 F
set role authenticated;
select set_config('test.uid', :'ub', false);
select zz_check(weekly_check_submit('{"W2-Q1":1,"W2-Q2":2,"W2-Q3":3}'::jsonb) -> 'reviewLectures' = '[]'::jsonb, 'W-36 모두 맞히면 다시 볼 강 없음([])');
select zz_check((weekly_check_status() -> 'team' ->> 'taken')::int = 2, 'W-37 팀원 B 화면: 팀원 2/3명 응시');
select set_config('test.uid', :'ud', false);
select weekly_check_submit('{"W2-Q1":0,"W2-Q2":0,"W2-Q3":0}'::jsonb) as subd \gset
select zz_check((weekly_check_status() -> 'team' ->> 'active')::int = 3 and (weekly_check_status() -> 'team' ->> 'taken')::int = 2,
  'W-38 팀 활동 쉼 팀원(D)은 응시해도 팀 n/m 에 안 셈 (개인 응시는 됨)');
select set_config('test.uid', :'uf', false);
select zz_check((weekly_check_status() -> 'team') = 'null'::jsonb and (weekly_check_status() ->> 'open')::boolean, 'W-39 팀 없는 학생: 점검은 열림, 팀 칸은 비움');
select zz_expect_error($$select admin_weekly_stats()$$, 'NOT_ADMIN', 'W-40 학생이 교수용 점검 통계를 부르면 NOT_ADMIN');
reset role;

-- =====================================================================
-- C. 교수 화면 — 문항별 정답률 (3명 이상일 때만)
-- =====================================================================
update students set cohort = '2026-9' where id = :'sd';   -- D는 다른 기수로 옮겨 기수 거르기를 봄
set role authenticated;
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select set_config('test.jwt', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","email":"prof@example.com","is_anonymous":false}', false);
select admin_weekly_stats('2027-1', null) as aw \gset
select zz_check((:'aw'::jsonb ->> 'week')::int = 2 and (:'aw'::jsonb ->> 'currentWeek')::int = 2 and (:'aw'::jsonb ->> 'maxWeek')::int = 2
                and (:'aw'::jsonb ->> 'takers')::int = 2 and jsonb_array_length(:'aw'::jsonb -> 'items') = 3
                and (select bool_and((x ->> 'correctRate') is null and (x ->> 'n')::int = 2) from jsonb_array_elements(:'aw'::jsonb -> 'items') x),
  'W-41 교수: 2027-1 응시 2명 → 문항 3개 모두 정답률 비움(3명 미만)');
select admin_weekly_stats(null, 2) as aw2 \gset
select zz_check((select (x ->> 'correctRate')::numeric = 0.667 and (x ->> 'n')::int = 3 from jsonb_array_elements(:'aw2'::jsonb -> 'items') x where x ->> 'qid' = 'W2-Q1')
                and (select (x ->> 'correctRate')::numeric = 0.333 and (x ->> 'unknown')::int = 1 from jsonb_array_elements(:'aw2'::jsonb -> 'items') x where x ->> 'qid' = 'W2-Q3')
                and (select x ->> 'answerText' = '나' from jsonb_array_elements(:'aw2'::jsonb -> 'items') x where x ->> 'qid' = 'W2-Q1'),
  'W-42 교수: 전체 기수 3명 → W2-Q1 정답률 66.7% · W2-Q3 33.3%(모르겠어요 1) · 정답 글');
select zz_check((select (x ->> 'active')::int = 3 and (x ->> 'taken')::int = 2 from jsonb_array_elements(:'aw2'::jsonb -> 'teams') x where x ->> 'name' = '1팀')
                and :'aw2' !~ 'WK[A-F]{2}22|가람|나래|다솜|라온|n_correct',
  'W-43 교수: 팀별 응시 2/3 · 학생 코드·별명·개인 맞힌 수 없음');
reset role;

-- =====================================================================
-- D. 팀 해설 당번
-- =====================================================================
-- 이번 주 연습 기록: X-P1 = A·B·C 처음 답 오답(3), X-P2 = A 오답(1) · B 정답, X-P3 = 2팀 E 오답,
--                    W2-Q1(평가 문항)을 일부러 많이 틀린 기록(평가 문항은 해설 당번에 절대 안 씀)
insert into attempts (student_id, question_id, mode, outcome, hint_level, submits, xp, day) values
  (:'sa', 'X-P1', 'PRACTICE', '정답 보고 이해', 4, '{1,2}', 10, lu_today()),
  (:'sb', 'X-P1', 'PRACTICE', '두 번째에 맞힘', 0, '{1,0}', 10, lu_today()),
  (:'sc', 'X-P1', 'PRACTICE', '정답 보고 이해', 4, '{3}', 10, lu_today()),
  (:'sa', 'X-P2', 'PRACTICE', '두 번째에 맞힘', 0, '{1,0}', 10, lu_today()),
  (:'sb', 'X-P2', 'PRACTICE', '혼자 맞힘', 0, '{0}', 10, lu_today()),
  (:'se', 'X-P3', 'PRACTICE', '정답 보고 이해', 4, '{2}', 10, lu_today());
insert into attempts (student_id, question_id, mode, outcome, hint_level, submits, xp, day)
  select sid, 'W2-Q1', 'EVAL', '응시', 0, '{3}', 0, lu_today() from dev cross join generate_series(1, 3);

set role authenticated;
select set_config('test.jwt', '{}', false);
select set_config('test.uid', :'ub', false);
select my_team_explainer() as eb \gset
select zz_check((:'eb'::jsonb ->> 'inTeam')::boolean and (:'eb'::jsonb ->> 'hasDuty')::boolean and :'eb'::jsonb ->> 'dutyNickname' = '가람'
                and not (:'eb'::jsonb ->> 'iAmDuty')::boolean and :'eb'::jsonb -> 'item' ->> 'qid' = 'X-P1' and (:'eb'::jsonb ->> 'maxChars')::int = 200,
  'W-44 첫 당번 = 가장 먼저 들어온 활동 팀원(가람, 쉼 팀원 라온 제외) · 문항 = 팀이 가장 많이 틀린 연습 문항 X-P1');
select zz_check((:'eb'::jsonb -> 'body') = 'null'::jsonb and :'eb' !~ 'answer|WK[A-F]{2}22|W2-Q1', 'W-45 아직 해설 없음 · 정답 번호·학생 코드·평가 문항 없음');
select set_config('test.uid', :'ue', false);
select my_team_explainer() as ee \gset
select zz_check(:'ee'::jsonb ->> 'dutyNickname' = '마루' and (:'ee'::jsonb ->> 'iAmDuty')::boolean and :'ee'::jsonb -> 'item' ->> 'qid' = 'X-P3',
  'W-46 다른 팀(2팀)은 자기 팀 기록으로: 당번 마루(나) · 문항 X-P3');
select set_config('test.uid', :'uf', false);
select zz_check((my_team_explainer() ->> 'inTeam')::boolean = false and (select count(*) from jsonb_object_keys(my_team_explainer())) = 2,
  'W-47 팀 없는 학생: inTeam=false 만');
-- 쓰기
select set_config('test.uid', :'ub', false);
select zz_expect_error($$select write_team_explainer('X-P1', '당번이 아닌 사람이 쓰는 해설입니다.')$$, 'NOT_DUTY', 'W-48 당번이 아니면 쓸 수 없음(NOT_DUTY)');
select set_config('test.uid', :'ua', false);
select zz_check((my_team_explainer() ->> 'iAmDuty')::boolean, 'W-49 가람 화면: 내가 당번');
select zz_expect_error($$select write_team_explainer('X-P1', '짧아요')$$, 'TOO_SHORT', 'W-50 10자 미만 → TOO_SHORT');
select zz_expect_error(format($$select write_team_explainer('X-P1', %L)$$, repeat('가', 201)), 'TOO_LONG', 'W-51 200자 넘음 → TOO_LONG');
select zz_expect_error($$select write_team_explainer('X-P1', '궁금하면 me@example.com 으로 물어봐 주세요')$$, 'PRIVATE_INFO', 'W-52 이메일 모양 → PRIVATE_INFO');
select zz_expect_error($$select write_team_explainer('X-P1', '궁금하면 010-1234-5678 로 연락 주세요 감사')$$, 'PRIVATE_INFO', 'W-53 전화번호 모양 → PRIVATE_INFO');
select zz_expect_error($$select write_team_explainer('X-P2', '다른 문항 번호로 보내는 해설이에요.')$$, 'ITEM_CHANGED', 'W-54 화면의 문항 번호가 다르면 ITEM_CHANGED');
select write_team_explainer('X-P1', E'  정답은 행 수준 보안을 켜는 것이에요.\r\n표를 공개하면 누구나 읽을 수 있어서 틀려요.  ') as wa \gset
select zz_check(:'wa'::jsonb ->> 'body' = E'정답은 행 수준 보안을 켜는 것이에요.\n표를 공개하면 누구나 읽을 수 있어서 틀려요.' and (:'wa'::jsonb ->> 'writtenAt') is not null,
  'W-55 당번이 해설 올림(앞뒤 빈칸·\r 정리) → 바로 돌려받음');
select set_config('test.uid', :'uc', false);
select zz_check(my_team_explainer() ->> 'body' like '정답은 행 수준 보안%', 'W-56 같은 팀 팀원(다솜)에게 해설이 보임');
select set_config('test.uid', :'ud', false);
select zz_check(my_team_explainer() ->> 'body' like '정답은 행 수준 보안%', 'W-57 팀 활동 쉼 팀원(라온)도 자기 팀 해설은 읽음');
select set_config('test.uid', :'ue', false);
select zz_check(coalesce(my_team_explainer() ->> 'body', '') = '' and position('행 수준 보안' in my_team_explainer()::text) = 0, 'W-58 다른 팀(마루)에게는 1팀 해설이 안 보임');
select set_config('test.uid', :'ua', false);
select zz_check(write_team_explainer('X-P1', '고친 해설: 행 수준 보안을 켜면 자기 줄만 읽어요.') ->> 'body' like '고친 해설%', 'W-59 당번은 이번 주 안에 고쳐 쓸 수 있음');
reset role;
-- 글을 올린 뒤에는 문항 고정: X-P2 를 더 많이 틀려도 그대로
insert into attempts (student_id, question_id, mode, outcome, hint_level, submits, xp, day) values
  (:'sb', 'X-P4', 'PRACTICE', '정답 보고 이해', 4, '{1}', 10, lu_today()), (:'sc', 'X-P4', 'PRACTICE', '정답 보고 이해', 4, '{1}', 10, lu_today()),
  (:'sd', 'X-P4', 'PRACTICE', '정답 보고 이해', 4, '{1}', 10, lu_today()), (:'sc', 'X-P2', 'PRACTICE', '정답 보고 이해', 4, '{1}', 10, lu_today());
set role authenticated;
select set_config('test.uid', :'ub', false);
select zz_check(my_team_explainer() -> 'item' ->> 'qid' = 'X-P1', 'W-60 해설을 올린 뒤에는 문항이 바뀌지 않음(X-P1 그대로)');
reset role;
-- 아직 안 쓴 팀은 기록이 쌓이면 문항이 다시 골라짐
insert into attempts (student_id, question_id, mode, outcome, hint_level, submits, xp, day) values
  (:'se', 'X-P4', 'PRACTICE', '정답 보고 이해', 4, '{1}', 10, lu_today()), (:'se', 'X-P2', 'PRACTICE', '정답 보고 이해', 4, '{2}', 10, lu_today());
set role authenticated;
select set_config('test.uid', :'ue', false);
select zz_check(my_team_explainer() -> 'item' ->> 'qid' = 'X-P2', 'W-61 아직 안 쓴 팀(2팀)은 이번 주 기록이 늘면 문항이 다시 골라짐(같은 오답 수 → 번호 순 X-P2)');
select zz_expect_error($$select write_team_explainer('X-P3', '예전 화면의 문항 번호로 보내는 해설이에요.')$$, 'ITEM_CHANGED', 'W-62 바뀌기 전 문항 번호로 보내면 ITEM_CHANGED(화면이 새로 받음)');
reset role;

-- 돌아가며 맡기: 다음 주들 (lu_explainer_pick 을 날짜만 바꿔 직접 부름 — 관리자 역할)
select (lu_explainer_pick(:'t1', :'wk'::date + 7)).student_id = :'sb'::uuid as r1 \gset
select (lu_explainer_pick(:'t1', :'wk'::date + 14)).student_id = :'sc'::uuid as r2 \gset
select (lu_explainer_pick(:'t1', :'wk'::date + 21)).student_id = :'sa'::uuid as r3 \gset
select zz_check(:'r1' and :'r2' and :'r3', 'W-63 당번 돌아가기: 가람 → 나래 → 다솜 → 다시 가람 (쉼 팀원 라온은 빠짐 · 모두 같은 횟수)');
select zz_check((select count(*) from team_explainers where team_id = :'t1' and student_id = :'sd') = 0, 'W-64 팀 활동 쉼 팀원에게는 당번이 가지 않음');
-- 당번이 쓰기 전에 팀 활동을 쉬면 → 다른 팀원으로 바뀜
update students set team_off = true where id = :'sa';
select zug.student_id as rx from lu_explainer_pick(:'t1', :'wk'::date + 21) zug \gset
select zz_check(:'rx'::uuid in (:'sb'::uuid, :'sc'::uuid), 'W-65 아직 안 쓴 당번이 팀 활동을 쉬면 활동 중인 다른 팀원으로 바뀜');
update students set team_off = false where id = :'sa';
-- 이번 주에 틀린 문항이 없으면 지난주 기록에서, 그것도 없으면 문항 없음
delete from team_explainers where team_id = :'t2';
delete from attempts where student_id = :'se';
insert into attempts (student_id, question_id, mode, outcome, hint_level, submits, xp, day) values
  (:'se', 'X-P4', 'PRACTICE', '정답 보고 이해', 4, '{1}', 10, :'wk'::date - 3);
select zz_check((lu_explainer_pick(:'t2', :'wk'::date)).question_id = 'X-P4', 'W-66 이번 주에 틀린 문항이 없으면 지난주 팀 기록에서 고름');
delete from team_explainers where team_id = :'t2';
delete from attempts where student_id = :'se';
set role authenticated;
select set_config('test.uid', :'ue', false);
select zz_check((my_team_explainer() -> 'item') = 'null'::jsonb and (my_team_explainer() ->> 'iAmDuty')::boolean, 'W-67 팀 기록이 아직 없으면 당번만 정하고 문항은 비움');
select zz_expect_error($$select write_team_explainer(null, '문항이 없을 때 쓰는 해설이에요.')$$, 'NO_ITEM', 'W-68 문항이 없으면 쓸 수 없음(NO_ITEM)');
reset role;
select zz_check(not exists (select 1 from team_explainers e join questions q on q.id = e.question_id where q.pool <> 'practice'),
  'W-69 해설 당번 문항은 모두 연습 문항 (평가 문항을 아무리 많이 틀려도 안 고름)');

-- 교수 함수에 해설 글이 새지 않는지 (기존 교수 함수 + 새 교수 함수)
set role authenticated;
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select set_config('test.jwt', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","email":"prof@example.com","is_anonymous":false}', false);
select zz_check(position('행 수준 보안' in admin_weekly_stats()::text) = 0 and position('행 수준 보안' in admin_team_week()::text) = 0
                and position('행 수준 보안' in admin_item_stats()::text) = 0,
  'W-70 해설 글은 팀 안에서만: 교수 통계 함수에도 나오지 않음');
reset role;
