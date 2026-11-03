-- [개발용] QA 낮음 수정(70_qa_fixes.sql) 시험 — 내 컴퓨터의 임시 PostgreSQL 에서만 (실제 Supabase 에서는 실행하지 말 것)
-- 순서: run_qa_fixes_local.sh 가 00 → 05 → 06 → ../schema.sql → ../30 → ../40 → ../50 → ../60 → ../70(2번) → 이 파일
-- 결과: 줄마다 "PASS Q-xx …" 또는 "FAIL Q-xx …". 학생 정보는 모두 가짜(코드·별명)
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function zz_check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;
grant execute on function zz_check(boolean, text) to anon, authenticated, service_role;
create or replace function zz_expect_error(p_sql text, p_expect text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'FAIL % (오류 없이 실행됨)', p_label;
exception when others then
  if position(p_expect in sqlerrm) > 0 then raise notice 'PASS % [%]', p_label, sqlerrm;
  else raise notice 'FAIL % (다른 오류: %)', p_label, sqlerrm; end if;
end $$;
grant execute on function zz_expect_error(text, text, text) to anon, authenticated, service_role;

-- ---------- 가짜 문항 ----------
insert into questions (id, part, lecture, difficulty, type, question, choices, source_section, pool, diag_order, b, week) values
  ('Q-P1', 1, 1, 1, 'mcq', '가짜 연습 1(힌트 있음)', '["가","나","다","라"]', '1-1', 'practice', null, -1, null),
  ('Q-P2', 1, 2, 1, 'mcq', '가짜 연습 2', '["가","나","다","라"]', '2-1', 'practice', null, -1, null),
  ('Q-P3', 1, 3, 1, 'mcq', '가짜 연습 3', '["가","나","다","라"]', '3-1', 'practice', null, -1, null),
  ('Q-P4', 1, 4, 1, 'mcq', '가짜 연습 4', '["가","나","다","라"]', '4-1', 'practice', null, -1, null),
  ('Q-P5', 1, 5, 1, 'mcq', '가짜 연습 5', '["가","나","다","라"]', '5-1', 'practice', null, -1, null),
  ('Q-P20', 2, 20, 1, 'mcq', '가짜 연습 20강(열린 강 밖)', '["가","나","다","라"]', '20-1', 'practice', null, -1, null),
  ('Q-P21', 2, 21, 1, 'mcq', '가짜 연습 21강(열린 강 밖, 복습 날)', '["가","나","다","라"]', '21-1', 'practice', null, -1, null),
  ('W1-Q1', 1, 1, 1, 'mcq', '가짜 점검 1주 1', '["가","나","다","라"]', '1-1', 'assessment', null, -1, 1),
  ('W1-Q2', 1, 2, 1, 'mcq', '가짜 점검 1주 2', '["가","나","다","라"]', '2-1', 'assessment', null, -1, 1),
  ('W2-Q1', 1, 3, 1, 'mcq', '가짜 점검 2주 1', '["가","나","다","라"]', '3-1', 'assessment', null, -1, 2),
  ('W2-Q2', 1, 4, 1, 'mcq', '가짜 점검 2주 2', '["가","나","다","라"]', '4-1', 'assessment', null, -1, 2);
insert into questions (id, part, lecture, difficulty, type, question, choices, pool, diag_order, b)
  select 'Q-D' || g, 1, 1, 1, 'mcq', '가짜 진단 ' || g, '["가","나","다","라"]', 'diagnostic', g, -1 from generate_series(1, 10) g;
insert into question_keys (question_id, answer_index, explanation)
  select id, 0, '해설' from questions where id like 'Q-%' or id like 'W_-Q_';
insert into hints (question_id, l1, l2, l3, hint_status) values ('Q-P1', 'h1', 'h2', 'h3', 'reviewed');
update app_settings set open_up_to = 15, tutor_enabled = true, cohort_start = lu_week_start(lu_today()) - 7 where id = 1;   -- 오늘 = 2주차

-- ---------- 가짜 학생: 1팀 = 나중(B, 진단 3문항 · 가장 먼저 들어옴) · 가람(A, 진단 끝) · 다솜(C, 진단 10문항 답함) ----------
insert into teams (cohort, name) values ('2027-1', '1팀');
insert into students (code, cohort, nickname, team_id, diag_done, created_at) values
  ('QABB22', '2027-1', '나중', (select id from teams where name = '1팀'), false, now() - interval '5 hours'),
  ('QAAA22', '2027-1', '가람', (select id from teams where name = '1팀'), true,  now() - interval '4 hours'),
  ('QACC22', '2027-1', '다솜', (select id from teams where name = '1팀'), false, now() - interval '3 hours');
create temp table dev as select s.code, s.id as sid, gen_random_uuid() as uid from students s where s.code like 'QA%';
grant select on dev to authenticated, service_role;
insert into auth.users (id) select uid from dev;
insert into student_devices (auth_uid, student_id) select uid, sid from dev;
insert into diag_answers (student_id, question_id, choice)
  select d.sid, 'Q-D' || g, 0 from dev d cross join generate_series(1, 10) g
   where d.code = 'QACC22' or (d.code = 'QABB22' and g <= 3);
select uid as ua, sid as sa from dev where code = 'QAAA22' \gset
select uid as ub, sid as sb from dev where code = 'QABB22' \gset
select uid as uc, sid as sc from dev where code = 'QACC22' \gset
select id as t1 from teams where name = '1팀' \gset

-- =====================================================================
-- A. #5 questions 표 칸 권한
-- =====================================================================
select zz_check(not has_column_privilege('authenticated', 'questions', 'b', 'select')
            and not has_column_privilege('authenticated', 'questions', 'n_resp', 'select')
            and not has_column_privilege('authenticated', 'questions', 'week', 'select'), 'Q-01 학생은 questions 의 b·n_resp·week 칸을 못 읽음');
select zz_check(has_column_privilege('authenticated', 'questions', 'question', 'select')
            and has_column_privilege('authenticated', 'questions', 'choices', 'select')
            and has_column_privilege('authenticated', 'questions', 'diag_order', 'select')
            and has_column_privilege('authenticated', 'questions', 'pool', 'select'), 'Q-02 앱이 쓰는 칸(question·choices·diag_order·pool 등)은 읽음');
select zz_check(not has_table_privilege('anon', 'questions', 'select'), 'Q-03 로그인 전(anon)은 questions 표 권한 없음');
set role authenticated;
select set_config('test.uid', :'ua', false);
select zz_expect_error($$select id, b from questions$$, 'permission denied', 'Q-04 학생 세션으로 select b → 거절');
select zz_expect_error($$select * from questions$$, 'permission denied', 'Q-05 학생 세션으로 select * → 거절(b 칸 포함이라)');
select zz_check((select count(*) from (select id, part, lecture, difficulty, type, question, choices, source_section from questions where pool = 'practice' order by id) z) = 7,
  'Q-06 앱이 쓰는 칸만 고르면 연습 문항 7개 그대로 읽힘(store.js loadPractice 와 같은 칸)');
select zz_check((select count(*) from (select id, diag_order from questions where pool = 'diagnostic' order by diag_order) z) = 10, 'Q-07 진단 문항(diag_order 포함) 10개 읽힘');
select zz_check((select count(*) from question_keys) = 7 and (select count(*) from hints) = 1, 'Q-08 다른 표 읽기 규칙(정답=연습만 7, 힌트=검토 끝 1)은 그대로');
select zz_check((select count(*) from questions where pool = 'assessment') = 0, 'Q-09 평가 문항은 여전히 0줄');

-- =====================================================================
-- B. #6 #7 별명 · 진단 보기 번호
-- =====================================================================
select zz_expect_error($$select set_nickname('   가  ')$$, 'NICK_LENGTH', 'Q-10 공백 정리 후 1글자 → NICK_LENGTH');
select zz_expect_error($$select set_nickname('      ')$$, 'NICK_LENGTH', 'Q-11 공백만 → NICK_LENGTH');
select zz_expect_error($$select set_nickname(null)$$, 'NICK_LENGTH', 'Q-12 null → NICK_LENGTH(DB 제약 오류 원문 아님)');
select zz_expect_error($$select set_nickname('가나다라마바사아자차카타파')$$, 'NICK_LENGTH', 'Q-13 13글자 → NICK_LENGTH(몰래 자르지 않음)');
select set_nickname(E'  하늘 \t  별  ');
reset role;
select zz_check((select nickname from students where id = :'sa') = '하늘 별', 'Q-14 앞뒤 빈칸 지우고 가운데 빈칸·탭은 하나로 → "하늘 별"');
set role authenticated;
select zz_expect_error($$select set_nickname('홍길동 010-1234')$$, 'NICK_PRIVATE', 'Q-15 "홍길동 010-1234"(전화번호 일부) → NICK_PRIVATE');
select zz_expect_error($$select set_nickname('01012345678')$$, 'NICK_PRIVATE', 'Q-16 전화번호 11자리 → NICK_PRIVATE');
select zz_expect_error($$select set_nickname('010.1234.567')$$, 'NICK_PRIVATE', 'Q-17 점으로 나눈 전화번호 모양(12글자) → NICK_PRIVATE');
select zz_expect_error($$select set_nickname('a@b.co')$$, 'NICK_PRIVATE', 'Q-18 이메일 모양 → NICK_PRIVATE');
select zz_expect_error($$select set_nickname('학번20231234')$$, 'NICK_PRIVATE', 'Q-19 숫자 8개 이어짐(학번 모양) → NICK_PRIVATE');
select set_nickname('별빛2027');
reset role;
select zz_check((select nickname from students where id = :'sa') = '별빛2027', 'Q-20 숫자 4개 섞인 별명("별빛2027")은 받음');
set role authenticated;
select set_config('test.uid', :'ub', false);
select zz_expect_error($$select diag_answer('Q-D4', 99)$$, 'BAD_CHOICE', 'Q-21 진단 보기 번호 99 → BAD_CHOICE');
select zz_expect_error($$select diag_answer('Q-D4', -1)$$, 'BAD_CHOICE', 'Q-22 진단 보기 번호 -1 → BAD_CHOICE');
select zz_expect_error($$select diag_answer('Q-D4', 4)$$, 'BAD_CHOICE', 'Q-23 보기 4개인데 4번 → BAD_CHOICE');
select zz_check(diag_answer('Q-D4', null) = 4, 'Q-24 "아직 모르겠어요"(null)는 그대로 받음 → 4문항째');
select zz_check(diag_answer('Q-D5', 3) = 5, 'Q-25 범위 안 번호(3)는 받음 → 5문항째');
select zz_expect_error($$select diag_answer('Q-P1', 0)$$, 'NOT_DIAG', 'Q-26 연습 문항은 여전히 NOT_DIAG');

-- =====================================================================
-- C. #9 close_item: 열린 강 범위 · 다시 마감 시 θ 그대로
-- =====================================================================
select set_config('test.uid', :'ua', false);
select zz_expect_error($$select close_item('Q-P20', 'PRACTICE', 0, '{0}')$$, 'NOT_OPEN', 'Q-27 열린 강(15) 밖 20강 연습 문항 마감 → NOT_OPEN');
reset role;
select theta as th0, n_answers as na0 from students where id = :'sa' \gset
select b as b0, n_resp as nr0 from questions where id = 'Q-P2' \gset
set role authenticated;
select close_item('Q-P2', 'PRACTICE', 0, '{0}') as c1 \gset
reset role;
select theta as th1, n_answers as na1 from students where id = :'sa' \gset
select zz_check((:'c1'::jsonb ->> 'xp')::int = 10 and :th1::float <> :th0::float and :na1::int = :na0::int + 1
  and (select n_resp from questions where id = 'Q-P2') = :nr0::int + 1, 'Q-28 처음 마감: XP 10 · θ 바뀜 · 답 수 +1 · 문항 응답 수 +1');
set role authenticated;
select close_item('Q-P2', 'PRACTICE', 4, '{1}') as c2 \gset
reset role;
select zz_check((:'c2'::jsonb ->> 'xp')::int = 0 and (select theta from students where id = :'sa') = :th1::float
  and (select n_answers from students where id = :'sa') = :na1::int
  and (select n_resp from questions where id = 'Q-P2') = :nr0::int + 1, 'Q-29 같은 문항 다시 마감(정답 보고 이해): XP 0 · θ·답 수·문항 응답 수 모두 그대로');
select zz_check((select count(*) from attempts where student_id = :'sa' and question_id = 'Q-P2') = 2
  and exists (select 1 from review_box where student_id = :'sa' and question_id = 'Q-P2'), 'Q-30 다시 마감 기록은 남고(2줄) 틀린 문항은 복습 상자에 들어감(학습 기능은 그대로)');
update app_settings set open_up_to = 30 where id = 1;
set role authenticated;
select zz_check((close_item('Q-P20', 'PRACTICE', 0, '{0}')::jsonb ->> 'xp')::int = 10, 'Q-31 교수님이 30강까지 열면 같은 20강 문항이 마감됨');
reset role;
update app_settings set open_up_to = 15 where id = 1;
insert into review_box values (:'sa', 'Q-P21', 1, lu_today());
set role authenticated;
select zz_check((close_item('Q-P21', 'REVIEW', 0, '{0}')::jsonb ->> 'reviewNote') = 'box-up', 'Q-32 복습 날인 문항은 열린 강 밖이어도 복습 마감됨(NOT_OPEN 아님)');

-- =====================================================================
-- D. #8 tutor_begin: 서버가 낼 수 있는 문항만
-- =====================================================================
reset role;
insert into attempts (student_id, question_id, mode, outcome, submits, xp, day) values
  (:'sa', 'Q-P4', 'PRACTICE', '혼자 맞힘', '{0}', 10, lu_today() - 3),    -- 3일 전 혼자 맞힘 (복습 상자 없음)
  (:'sa', 'Q-P5', 'PRACTICE', '혼자 맞힘', '{0}', 10, lu_today() - 8);    -- 8일 전 (7일 지나 다시 나올 수 있음)
set role service_role;
select zz_check(tutor_begin(:'ua', 'Q-P21', 0, '{1}') ->> 'error' = 'NOT_OPEN', 'Q-33 오늘 복습을 마쳐 다음 복습 날이 남은 21강 문항 → NOT_OPEN(지금 낼 문항 아님)');
reset role;
delete from review_box where student_id = :'sa' and question_id = 'Q-P21';
delete from attempts where student_id = :'sa' and question_id = 'Q-P21';
set role service_role;
select zz_check(tutor_begin(:'ua', 'Q-P21', 3, '{1}') ->> 'error' = 'NOT_OPEN', 'Q-34 열린 강 밖(21강)이고 복습 날도 아닌 문항 → NOT_OPEN');
select zz_check(tutor_begin(:'ua', 'Q-P2', 0, '{1}') ->> 'error' = 'ITEM_CLOSED', 'Q-35 오늘 이미 마감한 문항 → ITEM_CLOSED (화면이 "아직 안 끝남"이라 보내도)');
select zz_check(tutor_begin(:'ua', 'Q-P4', 0, '{1}') ->> 'error' = 'ITEM_CLOSED', 'Q-36 3일 전에 마감한 문항(지금 낼 문항 아님) → ITEM_CLOSED');
select zz_check(tutor_begin(:'ua', 'Q-P3', 0, '{1}') ->> 'ok' = 'true', 'Q-37 열린 강 안의 새 연습 문항 + 오답 1번 → 열림(정상 흐름 그대로)');
select zz_check(tutor_begin(:'ua', 'Q-P5', 0, '{1}') ->> 'ok' = 'true', 'Q-38 8일 전에 푼 문항(다시 나올 수 있는 문항) → 열림');
reset role;
insert into review_box values (:'sa', 'Q-P21', 1, lu_today());
set role service_role;
select zz_check(tutor_begin(:'ua', 'Q-P21', 0, '{1}') ->> 'ok' = 'true', 'Q-39 열린 강 밖이어도 오늘 복습 날인 문항 → 열림');
select zz_check(tutor_begin(:'ua', 'Q-P1', 2, '{}') ->> 'error' = 'NOT_YET', 'Q-40 힌트 있는 문항 L2 → 여전히 NOT_YET');
reset role;
select zz_check((select count(*) from tutor_usage where student_id = :'sa') = 3, 'Q-41 거절된 요청은 횟수 예약 줄을 만들지 않음(성공 3번만 3줄)');

-- =====================================================================
-- E. #10 진단 먼저: 공통 점검 · 해설 당번
-- =====================================================================
set role authenticated;
select set_config('test.uid', :'ub', false);    -- 나중: 진단 5문항
select weekly_check_status() as wb \gset
select zz_check(not (:'wb'::jsonb ->> 'open')::boolean and :'wb'::jsonb ->> 'reason' = 'NEED_DIAG' and (:'wb'::jsonb ->> 'week')::int = 2,
  'Q-42 진단 10문항 전: 공통 점검 카드 open=false · reason NEED_DIAG');
select zz_expect_error($$select weekly_check_items()$$, 'NEED_DIAG', 'Q-43 진단 10문항 전: 문항 받기 → NEED_DIAG');
select zz_expect_error($$select weekly_check_submit('{"W2-Q1":0,"W2-Q2":0}')$$, 'NEED_DIAG', 'Q-44 진단 10문항 전: 제출 → NEED_DIAG');
select my_team_explainer() as eb \gset
select zz_check((:'eb'::jsonb ->> 'needDiag')::boolean and not (:'eb'::jsonb ? 'item') and not (:'eb'::jsonb ? 'body') and not (:'eb'::jsonb ? 'dutyNickname'),
  'Q-45 진단 10문항 전: 해설 당번 카드는 needDiag 만(문항·해설·당번 별명 없음)');
select zz_expect_error($$select write_team_explainer('Q-P2', '열 글자가 넘는 해설입니다 정말로요')$$, 'NEED_DIAG', 'Q-46 진단 10문항 전: 해설 쓰기 → NEED_DIAG');
select set_config('test.uid', :'ua', false);    -- 가람: 진단 끝
select weekly_check_status() as wa \gset
select zz_check((:'wa'::jsonb ->> 'open')::boolean and :'wa'::jsonb ->> 'reason' is null, 'Q-47 진단 끝낸 학생: 공통 점검 열림');
select my_team_explainer() as ea \gset
select zz_check((:'ea'::jsonb ->> 'hasDuty')::boolean and :'ea'::jsonb ->> 'dutyNickname' <> '나중',
  'Q-48 가장 먼저 들어온 "나중"(진단 전)이 아니라 진단한 팀원이 당번 → ' || (:'ea'::jsonb ->> 'dutyNickname'));
reset role;
update team_explainers set student_id = :'sb' where team_id = :'t1';   -- 예전 규칙으로 진단 전 학생이 당번이었던 경우
set role authenticated;
select my_team_explainer() as ea2 \gset
select zz_check(:'ea2'::jsonb ->> 'dutyNickname' <> '나중', 'Q-49 진단 전 학생이 당번이던 줄(해설 전)은 진단한 팀원으로 다시 고름');
select set_config('test.uid', :'uc', false);    -- 다솜: 진단 10문항 답함(끝내기 전)
select zz_check((weekly_check_status()::jsonb ->> 'open')::boolean, 'Q-50 진단 10문항 답한 학생(끝내기 전)도 공통 점검 열림(화면 needDiag 와 같은 기준)');
reset role;
insert into diag_answers (student_id, question_id, choice) select :'sb', 'Q-D' || g, 0 from generate_series(6, 10) g;
set role authenticated;
select set_config('test.uid', :'ub', false);
select zz_check((weekly_check_status()::jsonb ->> 'open')::boolean and not (my_team_explainer()::jsonb ? 'needDiag'),
  'Q-51 "나중"이 진단 10문항을 마치면 공통 점검·해설 당번 카드 열림');

-- =====================================================================
-- F. #11ⓑ 일요일 시작 → 월요일 제출 (시각 흉내: lu_today·lu_kst_now 만 잠시 바꿈)
-- =====================================================================
reset role;
select date_trunc('week', now() at time zone 'Asia/Seoul')::date as mon \gset
select pg_get_functiondef('lu_today()'::regprocedure) as lu_today_def \gset
select pg_get_functiondef('lu_kst_now()'::regprocedure) as lu_kst_def \gset
create or replace function lu_today() returns date language sql stable set search_path = public as $f$ select date_trunc('week', now() at time zone 'Asia/Seoul')::date $f$;
create or replace function lu_kst_now() returns timestamp language sql stable set search_path = public as $f$ select date_trunc('week', now() at time zone 'Asia/Seoul') + interval '1 hour 30 minutes' $f$;
update app_settings set cohort_start = :'mon'::date - 7 where id = 1;   -- 오늘(흉내) = 2주차 월요일 01:30
set role authenticated;
select set_config('test.uid', :'ua', false);
select zz_expect_error($$select weekly_check_submit('{"W1-Q1":0,"W2-Q1":0}')$$, 'BAD_ANSWERS', 'Q-52 지난주·이번 주 문항이 섞인 답 → BAD_ANSWERS');
select weekly_check_submit('{"W1-Q1":0,"W1-Q2":null}') as g1 \gset
reset role;
select zz_check((:'g1'::jsonb ->> 'done')::boolean and (:'g1'::jsonb ->> 'week')::int = 1
  and exists (select 1 from weekly_checks where student_id = :'sa' and week = 1)
  and (select count(*) from weekly_answers where student_id = :'sa' and week = 1) = 2,
  'Q-53 월요일 01:30 에 지난주(1주차) 답 제출 → 지난주 점검으로 저장(답 2개 그대로)');
set role authenticated;
select zz_check((weekly_check_status()::jsonb ->> 'open')::boolean and not (weekly_check_status()::jsonb ->> 'done')::boolean
  and (weekly_check_status()::jsonb ->> 'week')::int = 2, 'Q-54 그 뒤 홈 카드: 이번 주(2주차) 점검은 아직 응시 전으로 열려 있음');
select zz_expect_error($$select weekly_check_submit('{"W1-Q1":1,"W1-Q2":1}')$$, 'WEEKLY_DONE', 'Q-55 지난주 점검을 또 내면 WEEKLY_DONE');
select zz_check((weekly_check_submit('{"W2-Q1":0,"W2-Q2":0}')::jsonb ->> 'week')::int = 2, 'Q-56 이번 주 점검은 따로 정상 제출');
reset role;
create or replace function lu_kst_now() returns timestamp language sql stable set search_path = public as $f$ select date_trunc('week', now() at time zone 'Asia/Seoul') + interval '3 hours 30 minutes' $f$;
set role authenticated;
select set_config('test.uid', :'uc', false);
select zz_expect_error($$select weekly_check_submit('{"W1-Q1":0,"W1-Q2":0}')$$, 'WEEK_CHANGED', 'Q-57 월요일 03:30(유예 지난 뒤) 지난주 답 → WEEK_CHANGED(쉬운 안내용 이름)');
reset role;
select zz_check(not exists (select 1 from weekly_checks where student_id = :'sc'), 'Q-58 유예 지난 뒤 지난주 답은 저장 안 됨');
-- 시각 흉내 되돌리기 (원래 함수 본문 그대로)
select set_config('zz.def1', :'lu_today_def', false), set_config('zz.def2', :'lu_kst_def', false);
do $$ begin execute current_setting('zz.def1'); execute current_setting('zz.def2'); end $$;
select zz_check(lu_today() = (now() at time zone 'Asia/Seoul')::date, 'Q-59 시각 흉내를 원래대로 되돌림');

-- =====================================================================
-- G. 권한
-- =====================================================================
select zz_check(not has_function_privilege('authenticated', 'lu_diag_ready(uuid)', 'execute')
            and not has_function_privilege('authenticated', 'lu_kst_now()', 'execute')
            and not has_function_privilege('anon', 'lu_diag_ready(uuid)', 'execute'), 'Q-60 새 도우미(lu_diag_ready·lu_kst_now)는 학생·로그인 전 모두 실행 불가');
select zz_check(not has_function_privilege('authenticated', 'tutor_begin(uuid,text,int,int[])', 'execute')
            and has_function_privilege('service_role', 'tutor_begin(uuid,text,int,int[])', 'execute'), 'Q-61 tutor_begin 은 여전히 service_role 만');
select zz_check(bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')),
  'Q-62 다시 만든 학생 함수 8개: 로그인 기기만 실행')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('set_nickname', 'diag_answer', 'close_item', 'weekly_check_status', 'weekly_check_items',
                                               'weekly_check_submit', 'my_team_explainer', 'write_team_explainer');
select zz_check(not has_function_privilege('authenticated', 'lu_explainer_pick(uuid,date)', 'execute'), 'Q-63 lu_explainer_pick 은 여전히 학생 실행 불가');
select zz_check(count(*) = 0, 'Q-64 RLS 꺼진 public 표 0개') from pg_tables where schemaname = 'public' and not rowsecurity;
