-- [개발용] M2 1차(팀 + 교수 화면) 서버 함수 시험 — 내 컴퓨터의 임시 PostgreSQL에서만 (실제 Supabase에서는 실행하지 말 것)
-- 순서: 00_fake_supabase.sql → 05_fake_auth_m2.sql → ../schema.sql → ../30_m2_teams_admin.sql(2번 실행: 다시 실행해도 안전한지) → 이 파일
-- 결과: 줄마다 "PASS M-xx …" 또는 "FAIL M-xx …" 알림. run_m2_local.sh 가 FAIL 이 0개인지 셉니다.
-- 학생·교수 정보는 모두 가짜입니다(코드·별명·이메일 example.com).
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------- 시험 도우미 (시험 DB 안에만 있음) ----------
create or replace function zz_check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;
grant execute on function zz_check(boolean, text) to anon, authenticated;
-- 오류가 나야 하는 호출: 오류 문장에 p_expect 가 들어 있으면 통과
create or replace function zz_expect_error(p_sql text, p_expect text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'FAIL % (오류 없이 실행됨)', p_label;
exception when others then
  if position(p_expect in sqlerrm) > 0 then raise notice 'PASS % [%]', p_label, sqlerrm;
  else raise notice 'FAIL % (다른 오류: %)', p_label, sqlerrm; end if;
end $$;
grant execute on function zz_expect_error(text, text, text) to anon, authenticated;

-- ---------- 가짜 문항 (문항은행과 무관한 시험용) ----------
insert into questions (id, part, lecture, difficulty, type, question, choices, pool, diag_order, b) values
  ('T-P1', 1, 1, 1, 'mcq', '가짜 연습 문항 1', '["가","나","다","라"]', 'practice', null, -1),
  ('T-P2', 1, 2, 1, 'mcq', '가짜 연습 문항 2', '["가","나","다","라"]', 'practice', null, -1),
  ('T-P3', 1, 2, 1, 'ox',  '가짜 OX 문항',     '["O","X"]',            'practice', null, -1),
  ('T-D1', 1, 1, 1, 'mcq', '가짜 진단 문항 1', '["가","나","다","라"]', 'diagnostic', 1, -1),
  ('T-A1', 1, 1, 1, 'mcq', '가짜 평가 문항',   '["가","나","다","라"]', 'assessment', null, -1);
insert into question_keys (question_id, answer_index, explanation) values
  ('T-P1', 0, '해설'), ('T-P2', 0, '해설'), ('T-P3', 0, '해설'), ('T-D1', 0, '해설'), ('T-A1', 0, '해설');

-- ---------- 가짜 학생 ----------
-- 2027-1 기수: 별명 있는 9명(θ 다양) + 별명 없는 1명 + 팀 끈 1명 / 다른 기수 3명
insert into students (code, cohort, nickname, theta) values
  ('TEAMA2', '2027-1', '가람', 2.0), ('TEAMB2', '2027-1', '나래', 1.5), ('TEAMC2', '2027-1', '다솜', 1.0),
  ('TEAMD2', '2027-1', '라온', 0.5), ('TEAME2', '2027-1', '마루', 0.0), ('TEAMF2', '2027-1', '바다', -0.5),
  ('TEAMG2', '2027-1', '사랑', -1.0), ('TEAMH2', '2027-1', '아라', -1.5), ('TEAMJ2', '2027-1', '자람', -2.0);
insert into students (code, cohort, nickname) values ('NNNNK2', '2027-1', null);
insert into students (code, cohort, nickname, team_off) values ('RESTX2', '2027-1', '쉼표', true);
insert into students (code, cohort, nickname) values ('ZZZZA2', '2026-9', '옛하나'), ('ZZZZB2', '2026-9', '옛둘'), ('ZZZZC2', '2026-9', '옛셋');

-- 기기(익명 계정) 1대씩 + 교수 계정들
insert into auth.users (id) select gen_random_uuid() from generate_series(1, 1);   -- 아무 학생과도 연결 안 된 기기
create temp table dev as
  select s.code, gen_random_uuid() as uid from students s;
grant select on dev to authenticated;
insert into auth.users (id) select uid from dev;
insert into student_devices (auth_uid, student_id) select d.uid, s.id from dev d join students s on s.code = d.code;
insert into auth.users (id, email, email_confirmed_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'prof@example.com', now()),        -- 진짜 교수(가짜 주소)
  ('aaaaaaaa-0000-4000-8000-000000000002', 'prof2@example.com', null),        -- admins 에 있지만 메일 확인 안 됨
  ('aaaaaaaa-0000-4000-8000-000000000003', 'student@example.com', now());     -- 이메일 계정이지만 교수 아님
insert into admins (email) values ('Prof@Example.com'), ('prof2@example.com');
select code as code_a from students where code = 'TEAMA2' \gset

-- =====================================================================
-- A. 팀 짜기 (SQL 편집기 = 관리자 권한)
-- =====================================================================
select zz_check(count(*) = 0, 'M-01 시작 전 팀 0개') from teams;
create temp table assigned as select * from admin_assign_teams('2027-1');
select zz_check(count(*) = 9, 'M-02 팀 짜기: 별명 있고 팀 켠 9명만 배정 (별명 없는 1명·팀 끈 1명 제외)') from assigned;
select zz_check((select count(*) from teams where cohort = '2027-1') = 3, 'M-03 팀 수 = 9 ÷ 4 올림 = 3');
select zz_check(bool_and(n between 3 and 4), 'M-04 모든 팀 3~4명') from (select team_id, count(*) n from students where team_id is not null group by team_id) z;
select zz_check(count(distinct team_id) = 3, 'M-05 지그재그: θ 상위 3명(가람·나래·다솜)이 서로 다른 팀')
  from students where code in ('TEAMA2', 'TEAMB2', 'TEAMC2');
select zz_check((select team_id from students where code = 'RESTX2') is null and (select team_id from students where code = 'NNNNK2') is null,
  'M-06 팀 끈 학생·별명 없는 학생은 팀 없음');
select zz_check(bool_and(name ~ '^[0-9]+팀$'), 'M-07 팀 이름은 "n팀"만 (상·중·하 같은 말 없음)') from teams;
select zz_expect_error($$select * from admin_assign_teams('2027-1')$$, 'TEAMS_EXIST', 'M-08 이미 팀이 있으면 다시 짜기 거절(기수 끝까지 같은 팀)');
select zz_expect_error($$select * from admin_assign_teams('2026-8')$$, 'TOO_FEW', 'M-09 3명 미만 기수는 거절');
create temp table assigned2 as select * from admin_assign_teams('2026-9');   -- 다른 기수 3명 → 1팀
select zz_check((select count(*) from teams where cohort = '2026-9') = 1, 'M-10 다른 기수는 따로 팀(3명 → 1팀)');

-- =====================================================================
-- B. 학생 권한 (익명 로그인 기기 = authenticated)
-- =====================================================================
select uid as uid_a from dev where code = 'TEAMA2' \gset
select uid as uid_rest from dev where code = 'RESTX2' \gset
select uid as uid_b from dev where code = 'TEAMB2' \gset
select id as uid_free from auth.users where email is null and id not in (select auth_uid from student_devices) limit 1 \gset
select lu_today() - 7 as lastweek \gset
set role authenticated;
select set_config('test.uid', :'uid_a', false);
select set_config('test.jwt', json_build_object('sub', :'uid_a', 'role', 'authenticated', 'is_anonymous', true)::text, false);

select zz_expect_error($$select * from teams$$, 'permission denied', 'M-11 학생은 teams 표를 직접 못 읽음');
select zz_expect_error($$insert into teams (cohort, name) values ('2027-1', '99팀')$$, 'permission denied', 'M-12 학생은 teams 표에 직접 못 씀');
select zz_expect_error($$update students set team_id = null$$, 'permission denied', 'M-13 학생은 자기 팀을 직접 못 바꿈');
select zz_expect_error($$select * from admin_assign_teams('2027-1', true)$$, 'permission denied', 'M-14 학생은 팀 짜기 함수 실행 불가');
select zz_expect_error($$select admin_move_student('TEAMA2', null)$$, 'permission denied', 'M-15 학생은 팀 옮기기 함수 실행 불가');
select zz_expect_error($$select * from lu_team_week(null, current_date)$$, 'permission denied', 'M-16 내부 도우미(lu_team_week) 실행 불가');
select zz_expect_error($$select lu_is_admin()$$, 'permission denied', 'M-17 내부 도우미(lu_is_admin) 실행 불가');
select zz_expect_error($$select lu_week_count(null, current_date)$$, 'permission denied', 'M-18 내부 도우미(lu_week_count) 실행 불가');

-- 팀 요약 (아직 이번 주 기록 없음)
select my_team_summary() as s0 \gset
select zz_check((:'s0'::jsonb ->> 'inTeam')::boolean and jsonb_array_length(:'s0'::jsonb -> 'members') = 3, 'M-19 내 팀 요약: 팀 안, 팀원 3명');
select zz_check(not (:'s0'::text ~* '"(xp|theta|n_answers|code|outcome|submits|score|id)"\s*:'),
  'M-20 팀 요약에 XP·θ·코드·정오답·개인 점수 칸이 없음');
select zz_check((select bool_and((select array_agg(k order by k) from jsonb_object_keys(m) k) = array['me', 'nickname', 'resting'])
                 from jsonb_array_elements(:'s0'::jsonb -> 'members') m), 'M-21 팀원 한 명당 보이는 칸은 별명·나인지·쉼 여부 3개뿐');
select zz_check((:'s0'::jsonb ->> 'progress')::int = 0 and (:'s0'::jsonb ->> 'goal')::int = 45 and not (:'s0'::jsonb ->> 'achieved')::boolean,
  'M-22 처음: 진행 0 / 목표 45(15 × 3명), 미달성');
select zz_check((select count(*) from jsonb_array_elements(:'s0'::jsonb -> 'members') m where (m ->> 'me')::boolean) = 1, 'M-23 팀원 목록에 "나" 표시는 1명');

-- =====================================================================
-- C. 이번 주 진행 계산 (관리자 권한으로 가짜 풀이 기록을 넣고 학생 화면 값 확인)
-- =====================================================================
reset role;
create temp table myteam as
  select s.id, s.code, row_number() over (order by s.code) as k from students s
  where s.team_id = (select team_id from students where code = 'TEAMA2');
-- 팀원1(나 = 가람) 20문항(→ 15로 자름), 팀원2 15문항, 팀원3 5문항 / 세지 않을 것: XP 0 기록 7개, 지난주 기록 30개
insert into attempts (student_id, question_id, mode, outcome, xp, day)
  select m.id, 'T-P1', 'PRACTICE', '혼자 맞힘', 10, lu_today()
  from myteam m cross join lateral generate_series(1, case when m.code = 'TEAMA2' then 20 when m.k = (select min(k) from myteam where code <> 'TEAMA2') then 15 else 5 end);
insert into attempts (student_id, question_id, mode, outcome, xp, day)
  select m.id, 'T-P1', 'PRACTICE', '혼자 맞힘', 0, lu_today() from myteam m cross join generate_series(1, 7) where m.code <> 'TEAMA2';
insert into attempts (student_id, question_id, mode, outcome, xp, day)
  select m.id, 'T-P1', 'REVIEW', '혼자 맞힘', 15, lu_week_start(lu_today()) - 1 from myteam m cross join generate_series(1, 30);
set role authenticated;
select my_team_summary() as s1 \gset
select zz_check((:'s1'::jsonb ->> 'progress')::int = 35, 'M-24 진행 = min(20,15)+15+5 = 35 (XP 0 기록·지난주 기록은 안 셈) → ' || (:'s1'::jsonb ->> 'progress'));
select zz_check(not (:'s1'::jsonb ->> 'achieved')::boolean and (:'s1'::jsonb ->> 'myCount')::int = 15, 'M-25 35/45 미달성, 내 이번 주 수 15(목표에서 자름)');
select zz_check(:'s1'::jsonb -> 'achievedTeams' = '[]'::jsonb, 'M-26 달성 팀 없음 → 달성 팀 목록 비어 있음');

reset role;
insert into attempts (student_id, question_id, mode, outcome, xp, day)
  select m.id, 'T-P1', 'PRACTICE', '힌트로 해결', 10, lu_today() from myteam m cross join generate_series(1, 10)
  where m.code <> 'TEAMA2' and m.k <> (select min(k) from myteam where code <> 'TEAMA2');
set role authenticated;
select my_team_summary() as s2 \gset
select zz_check((:'s2'::jsonb ->> 'progress')::int = 45 and (:'s2'::jsonb ->> 'achieved')::boolean, 'M-27 팀원 3명 모두 15문항 → 45/45 "참여 목표 달성"');
select zz_check(jsonb_array_length(:'s2'::jsonb -> 'achievedTeams') = 1 and (:'s2'::jsonb -> 'achievedTeams' ->> 0) = (:'s2'::jsonb ->> 'name'),
  'M-28 달성 팀 목록에 우리 팀 이름만(다른 기수 팀·미달성 팀 없음, 인원·점수 없음)');

-- 팀 활동 쉬기
select set_team_off(true) as s3 \gset
select zz_check((:'s3'::jsonb ->> 'teamOff')::boolean and (:'s3'::jsonb ->> 'activeMembers')::int = 2 and (:'s3'::jsonb ->> 'goal')::int = 30,
  'M-29 팀 활동 쉼: 나는 빠지고 활동 2명 → 목표 30');
select zz_check((select bool_or((m ->> 'me')::boolean and (m ->> 'resting')::boolean) from jsonb_array_elements(:'s3'::jsonb -> 'members') m),
  'M-30 팀원 목록에서 나는 "팀 활동 쉼"으로 보임');
select set_team_off(false) as s4 \gset
select zz_check(not (:'s4'::jsonb ->> 'teamOff')::boolean and (:'s4'::jsonb ->> 'goal')::int = 45, 'M-31 다시 켜면 목표 45로 돌아옴');
select set_config('test.uid', :'uid_b', false);
select my_team_summary() as sb \gset
select zz_check((:'sb'::jsonb ->> 'name') <> (:'s4'::jsonb ->> 'name') and not (:'sb'::text like '%가람%'),
  'M-32 다른 팀 학생에게는 그 팀 정보만(우리 팀 이름·별명 안 보임)');
select set_config('test.uid', :'uid_a', false);

-- 팀 없는 학생 · 연결 안 된 기기
select set_config('test.uid', :'uid_rest', false);
select my_team_summary() as s5 \gset
select zz_check(not (:'s5'::jsonb ->> 'inTeam')::boolean and (:'s5'::jsonb ->> 'teamOff')::boolean and :'s5'::jsonb -> 'members' is null,
  'M-33 팀 끈 학생: 팀 없음 + teamOff 표시, 다른 정보 없음');
select set_config('test.uid', :'uid_free', false);
select zz_expect_error($$select my_team_summary()$$, 'NOT_LINKED', 'M-34 코드와 연결 안 된 기기는 NOT_LINKED');

-- =====================================================================
-- D. 교수 화면 함수
-- =====================================================================
-- 학생(익명)이 부르면
select set_config('test.uid', :'uid_a', false);
select zz_check((admin_whoami() ->> 'admin')::boolean = false and admin_whoami()::jsonb - 'admin' = '{}'::jsonb, 'M-35 학생이 admin_whoami → admin=false 만(다른 정보 없음)');
select zz_expect_error($$select admin_item_stats()$$, 'NOT_ADMIN', 'M-36 학생이 반 전체 오답 통계 → NOT_ADMIN');
select zz_expect_error($$select admin_team_week()$$, 'NOT_ADMIN', 'M-37 학생이 팀별 주간 달성 → NOT_ADMIN');
-- 학생 기기가 JWT에 교수 이메일을 흉내 내도(익명 계정) 거절
select set_config('test.jwt', json_build_object('sub', :'uid_a', 'email', 'prof@example.com', 'is_anonymous', true)::text, false);
select zz_check((admin_whoami() ->> 'admin')::boolean = false, 'M-38 익명 계정 + 교수 이메일 흉내 → 교수 아님');
-- 이메일은 교수지만 메일 확인 안 된 계정
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000002', false);
select set_config('test.jwt', '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","email":"prof2@example.com","is_anonymous":false}', false);
select zz_check((admin_whoami() ->> 'admin')::boolean = false, 'M-39 admins 에 있어도 메일 확인 안 된 계정 → 교수 아님');
-- 이메일 계정이지만 admins 에 없음
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000003', false);
select set_config('test.jwt', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","email":"student@example.com","is_anonymous":false}', false);
select zz_check((admin_whoami() ->> 'admin')::boolean = false, 'M-40 admins 에 없는 이메일 → 교수 아님');
select zz_expect_error($$select admin_item_stats()$$, 'NOT_ADMIN', 'M-41 admins 에 없는 이메일 → 통계 거절');
-- 다른 사람 uid 에 교수 이메일 JWT (uid 와 users.email 불일치)
select set_config('test.jwt', '{"sub":"aaaaaaaa-0000-4000-8000-000000000003","email":"prof@example.com","is_anonymous":false}', false);
select zz_check((admin_whoami() ->> 'admin')::boolean = false, 'M-42 JWT 이메일과 계정 이메일이 다르면 교수 아님');

-- 진짜 교수 (대소문자 달라도 같은 이메일)
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select set_config('test.jwt', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","email":"PROF@example.com","is_anonymous":false}', false);
select admin_whoami() as w \gset
select zz_check((:'w'::jsonb ->> 'admin')::boolean and :'w'::jsonb -> 'cohorts' = '["2027-1","2026-9"]'::jsonb, 'M-43 교수 로그인: admin=true, 기수 목록');

-- 문항 통계용 가짜 기록: 학생 4명이 T-P2 를 처음 풀 때 → 오답 3(①번 2명, ②번 1명), 정답 1. 다시 푼 기록(정답)은 안 셈
reset role;
insert into attempts (student_id, question_id, mode, outcome, hint_level, submits, xp, day, created_at)
select s.id, 'T-P2', 'PRACTICE', v.o, v.h, v.sub, 10, lu_today(), now() - interval '1 hour'
from (values ('TEAMB2', '두 번째에 맞힘', 0, array[1, 0]), ('TEAMC2', '정답 보고 이해', 2, array[1, 2]),
             ('TEAMD2', '정답 보고 이해', 4, array[2]), ('TEAME2', '혼자 맞힘', 0, array[0])) v(c, o, h, sub)
join students s on s.code = v.c;
insert into attempts (student_id, question_id, mode, outcome, submits, xp, day)
  select id, 'T-P2', 'PRACTICE', '혼자 맞힘', array[0], 0, lu_today() from students where code in ('TEAMB2', 'TEAMC2', 'TEAMD2');
-- T-P3 는 2명만 → 최소 인원(3) 미만이라 목록에서 빠져야 함
insert into attempts (student_id, question_id, mode, outcome, submits, xp, day)
  select id, 'T-P3', 'PRACTICE', '정답 보고 이해', array[1], 10, lu_today() from students where code in ('TEAMB2', 'TEAMC2');
-- 진단 T-D1: 3명 (정답 1, 오답 ③ 1, 모르겠어요 1)
insert into diag_answers (student_id, question_id, choice)
  select s.id, 'T-D1', v.ch from (values ('TEAMF2', 0), ('TEAMG2', 3), ('TEAMH2', null)) v(c, ch) join students s on s.code = v.c;
-- 다른 기수 학생 기록은 2027-1 통계에 안 들어가야 함
insert into attempts (student_id, question_id, mode, outcome, submits, xp, day)
  select id, 'T-P2', 'PRACTICE', '혼자 맞힘', array[0], 10, lu_today() from students where cohort = '2026-9';
set role authenticated;

select admin_item_stats('2027-1') as st \gset
select (select x from jsonb_array_elements(:'st'::jsonb -> 'items') x where x ->> 'qid' = 'T-P2') as p2 \gset
select zz_check((:'p2'::jsonb ->> 'n')::int = 4 and (:'p2'::jsonb ->> 'wrong')::int = 3 and (:'p2'::jsonb ->> 'wrongRate')::numeric = 0.75,
  'M-44 T-P2: 응답 4(학생마다 첫 풀이만, 다른 기수 제외) · 오답 3 · 오답률 0.75 → ' || :'p2');
select zz_check((:'p2'::jsonb ->> 'topWrongText') = '나' and (:'p2'::jsonb ->> 'answerText') = '가' and (:'p2'::jsonb ->> 'hinted')::int = 2,
  'M-45 가장 많이 고른 오답 "나"(②), 정답 "가", 힌트 쓴 사람 2');
select zz_check(not exists (select 1 from jsonb_array_elements(:'st'::jsonb -> 'items') x where x ->> 'qid' = 'T-P3'),
  'M-46 응답 2명뿐인 문항은 빠짐(한 학생 답이 드러나지 않게, 최소 3명)');
select (select x from jsonb_array_elements(:'st'::jsonb -> 'items') x where x ->> 'qid' = 'T-D1') as d1 \gset
select zz_check((:'d1'::jsonb ->> 'pool') = 'diagnostic' and (:'d1'::jsonb ->> 'n')::int = 3 and (:'d1'::jsonb ->> 'wrong')::int = 2
  and (:'d1'::jsonb ->> 'unknown')::int = 1 and (:'d1'::jsonb ->> 'topWrongText') = '라', 'M-47 진단 문항: 응답 3 · 오답 2(모르겠어요 1 포함) · 많이 고른 오답 "라"');
select zz_check((select array_agg(x ->> 'qid' order by o) from jsonb_array_elements(:'st'::jsonb -> 'items') with ordinality t(x, o)) = array['T-P1', 'T-P2', 'T-D1'],
  'M-48 오답률 높은 순 정렬: T-P1(1.0) → T-P2(0.75) → T-D1(0.67)');
select zz_check((:'st'::jsonb ->> 'students')::int = 11 and (:'st'::jsonb ->> 'linked')::int = 11, 'M-49 기수 인원 11 · 기기 연결 11');
select zz_check(not (:'st'::text ~* '"(code|nickname|theta|student_id)"\s*:'), 'M-50 문항 통계에 학생 코드·별명·θ 없음');
select zz_check(jsonb_array_length(:'st'::jsonb -> 'lectures') >= 1, 'M-51 강별 첫 시도 정답률 있음');
select zz_check(jsonb_array_length(admin_item_stats('2027-1', 3, 1)::jsonb -> 'items') = 1, 'M-52 p_limit=1 → 1개만');

select admin_team_week('2027-1') as tw \gset
select zz_check(jsonb_array_length(:'tw'::jsonb -> 'teams') = 3 and (:'tw'::jsonb ->> 'unassigned')::int = 0 and (:'tw'::jsonb ->> 'resting')::int = 1,
  'M-53 팀별 주간: 2027-1 팀 3개, 배정 안 된 학생 0, 팀 쉼 1');
select zz_check((:'tw'::jsonb ->> 'achievedCount')::int = 1, 'M-54 이번 주 참여 목표 달성 팀 1개');
select zz_check(not (:'tw'::text ~* '"(code|xp|theta|count|score)"\s*:'), 'M-55 교수 팀 화면에도 개인 코드·XP·θ·개인 문항 수 없음(활동 여부만)');
select zz_check(jsonb_array_length(admin_team_week('2027-1', :'lastweek')::jsonb -> 'teams') = 3
  and (admin_team_week('2027-1', :'lastweek')::jsonb ->> 'achievedCount')::int = 1
  and (admin_team_week('2027-1', :'lastweek')::jsonb ->> 'weekStart') <> (:'tw'::jsonb ->> 'weekStart'), 'M-56 지난주 보기: 지난주 기록(복습 30개씩)으로 따로 계산 → 달성 1');

-- =====================================================================
-- E. 권한 표 점검 (Supabase 자동 허용 흉내 없이도 명시적으로 막혔는지)
-- =====================================================================
reset role;
select zz_check(not has_table_privilege('authenticated', 'teams', 'select') and not has_table_privilege('anon', 'teams', 'select'), 'M-57 teams 표 권한: anon·authenticated 없음');
select zz_check((select relrowsecurity from pg_class where relname = 'teams'), 'M-58 teams 표 RLS 켜짐');
select zz_check(count(*) = 0, 'M-59 RLS 꺼진 public 표 0개') from pg_tables where schemaname = 'public' and not rowsecurity;
select zz_check(bool_and(not has_function_privilege('anon', p.oid, 'execute')), 'M-60 새 함수 11개 모두 anon(로그인 전) 실행 불가')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('lu_week_start', 'lu_week_count', 'lu_team_week', 'lu_is_admin', 'my_team_summary', 'set_team_off',
    'admin_whoami', 'admin_item_stats', 'admin_team_week', 'admin_assign_teams', 'admin_move_student');
select zz_check(string_agg(p.proname, ',' order by p.proname) = 'admin_item_stats,admin_team_week,admin_whoami,my_team_summary,set_team_off',
  'M-61 로그인한 사람이 부를 수 있는 새 함수는 5개뿐 → ' || string_agg(p.proname, ',' order by p.proname))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('lu_week_start', 'lu_week_count', 'lu_team_week', 'lu_is_admin', 'my_team_summary', 'set_team_off',
    'admin_whoami', 'admin_item_stats', 'admin_team_week', 'admin_assign_teams', 'admin_move_student')
    and has_function_privilege('authenticated', p.oid, 'execute');
-- 팀 옮기기 (관리자 권한)
select admin_move_student('teama2', null) as moved \gset
select zz_check(:'moved' like '%뺐어요%' and (select team_id from students where code = 'TEAMA2') is null, 'M-62 팀 옮기기: 빼기(코드 소문자도 받음)');
select zz_expect_error($$select admin_move_student('TEAMA2', '없는팀')$$, 'UNKNOWN_TEAM', 'M-63 없는 팀 이름 거절');
select zz_check(admin_move_student('TEAMA2', (select name from teams where cohort = '2027-1' order by name limit 1)) like '%옮겼어요%', 'M-64 팀 옮기기: 넣기');
select zz_expect_error($$select admin_move_student('ZZZZA2', (select name from teams where cohort = '2027-1' and name not in (select name from teams where cohort = '2026-9') limit 1))$$,
  'UNKNOWN_TEAM', 'M-65 다른 기수의 팀으로는 못 옮김(같은 기수 안에서만 찾음)');
-- 기존 M1 함수(next_practice·close_item)는 이 파일이 바꾸지 않음: 함수 본문 지문이 schema.sql 적용 직후와 같은지 run_m2_local.sh 가 확인
