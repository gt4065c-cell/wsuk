-- [개발용] AI 튜터 서버 함수 시험 (50_ai_tutor.sql) — 내 컴퓨터의 임시 PostgreSQL 에서만 (실제 Supabase 에서는 실행하지 말 것)
-- 순서: run_tutor_local.sh 가 00 → 05 → 06 → ../schema.sql → ../30 → ../40 → ../50(2번) → 이 파일 을 실행
-- 결과: 줄마다 "PASS T-xx …" 또는 "FAIL T-xx …". 학생·교수 정보는 모두 가짜(코드·별명·example.com)
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
insert into questions (id, part, lecture, difficulty, type, question, choices, source_section, pool, diag_order, b) values
  ('T-P1', 1, 3, 1, 'mcq', '가짜 연습 문항: 줄 단위 출입 규칙의 이름은?', '["행 수준 보안 정책을 켠다","표를 모두 공개한다","비밀번호를 화면에 쓴다","아무것도 하지 않는다"]', '3-2 보안 규칙', 'practice', null, -1),
  ('T-P2', 1, 4, 1, 'mcq', '가짜 연습 문항 2 (힌트 없음)', '["가나다라마바사아","하나","둘","셋"]', '4-1', 'practice', null, -1),
  ('T-P3', 1, 5, 1, 'ox',  '가짜 OX 문항 (힌트 없음)', '["O","X"]', '5-1', 'practice', null, -1),
  ('T-P4', 1, 5, 1, 'ox',  '가짜 OX 문항 (힌트 있음)', '["O","X"]', '5-1', 'practice', null, -1),
  ('T-D1', 1, 1, 1, 'mcq', '가짜 진단 문항', '["가","나","다","라"]', '1-1', 'diagnostic', 1, -1),
  ('T-A1', 1, 1, 1, 'mcq', '가짜 평가 문항', '["가","나","다","라"]', '1-1', 'assessment', null, -1);
insert into question_keys (question_id, answer_index, explanation, common_wrong_reason) values
  ('T-P1', 0, '가짜 해설', '가짜 착각'), ('T-P2', 0, '해설', null), ('T-P3', 0, '해설', null), ('T-P4', 1, '해설', null),
  ('T-D1', 0, '해설', null), ('T-A1', 0, '해설', null);
insert into hints (question_id, l1, l2, l3, hint_status) values
  ('T-P1', 'L1', 'L2', 'L3', 'reviewed'), ('T-P4', 'L1', 'L2', 'L3', 'reviewed'), ('T-P2', 'd1', 'd2', 'd3', 'draft');   -- 검토 전 힌트 = 힌트 없음과 같음

-- ---------- 가짜 학생 + 기기 ----------
insert into students (code, cohort, nickname) values
  ('TUTA22', '2027-1', '튜터가'), ('TUTB22', '2027-1', '튜터나'), ('TUTC22', '2027-1', '튜터다'),
  ('TUTD22', '2027-1', '튜터라'), ('TUTE22', '2027-1', '튜터마'), ('TUTF22', '2027-1', '튜터바');
create temp table dev as select s.code, s.id as sid, gen_random_uuid() as uid from students s where s.code like 'TUT%';
grant select on dev to authenticated, service_role;
insert into auth.users (id) select uid from dev;
insert into student_devices (auth_uid, student_id) select uid, sid from dev;
insert into auth.users (id) values ('bbbbbbbb-0000-4000-8000-000000000009');            -- 코드와 연결 안 된 기기
insert into auth.users (id, email, email_confirmed_at) values ('aaaaaaaa-0000-4000-8000-000000000001', 'prof@example.com', now());
insert into admins (email) values ('prof@example.com') on conflict do nothing;
select uid as ua, sid as sa from dev where code = 'TUTA22' \gset
select uid as ub, sid as sb from dev where code = 'TUTB22' \gset
select uid as uc, sid as sc from dev where code = 'TUTC22' \gset
select uid as ud, sid as sd from dev where code = 'TUTD22' \gset
select uid as ue, sid as se from dev where code = 'TUTE22' \gset
select uid as uf, sid as sf from dev where code = 'TUTF22' \gset
select date_trunc('month', lu_today())::date as mstart \gset

-- =====================================================================
-- A. 표·권한
-- =====================================================================
select zz_check((select rowsecurity from pg_tables where tablename = 'tutor_usage'), 'T-01 tutor_usage 표 RLS 켜짐');
select zz_check(not exists (select 1 from information_schema.role_table_grants where table_name = 'tutor_usage' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'T-02 tutor_usage 표 권한: anon·authenticated 0개');
select zz_check(not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'T-03 RLS 꺼진 표 0개');
select zz_check((select not tutor_enabled and tutor_day_limit = 5 and tutor_month_limit = 60 and tutor_app_day_limit = 300 and tutor_budget_usd = 6.40
                 from app_settings where id = 1), 'T-04 기본값: 꺼짐 · 하루 5 · 월 60 · 앱 하루 300 · 예산 $6.40');
select zz_check(lu_tutor_cost(1000000, 1000000) = 0.60 and lu_tutor_cost(1500, 200) = 0.00025, 'T-05 금액 계산: 입력 $0.10 + 출력 $0.50 (100만 토큰당), 1,500+200토큰 = $0.00025');

set role authenticated;
select set_config('test.uid', :'ua', false);
select set_config('test.jwt', json_build_object('sub', :'ua', 'is_anonymous', true)::text, false);
select zz_expect_error($$select * from tutor_usage$$, 'permission denied', 'T-06 학생은 사용 기록 표를 직접 못 읽음');
select zz_expect_error($$insert into tutor_usage (student_id, day, month) values (gen_random_uuid(), current_date, current_date)$$, 'permission denied', 'T-07 학생은 사용 기록 표에 직접 못 씀');
select zz_expect_error(format($$select tutor_begin(%L::uuid, 'T-P1', 3, '{}')$$, :'ua'), 'permission denied', 'T-08 학생은 tutor_begin(예약) 직접 실행 불가');
select zz_expect_error($$select tutor_finish(1, 'ok', 0, 0)$$, 'permission denied', 'T-09 학생은 tutor_finish(토큰 기록) 직접 실행 불가 — 가짜 토큰 수로 비용 부풀리기 방지');
select zz_expect_error(format($$select lu_tutor_state(%L::uuid)$$, :'sb'), 'permission denied', 'T-10 학생은 남의 상태(lu_tutor_state) 못 봄');
select zz_expect_error($$update app_settings set tutor_enabled = true$$, 'permission denied', 'T-11 학생은 AI 튜터 스위치를 못 켬');
select tutor_status() as s0 \gset
select zz_check(not (:'s0'::jsonb ->> 'enabled')::boolean and :'s0'::jsonb ->> 'reason' = 'OFF' and (:'s0'::jsonb ->> 'left')::int = 5, 'T-12 학생 tutor_status(): 꺼짐(OFF) · 5번 남음');
select zz_check((select array_agg(k order by k) from jsonb_object_keys(:'s0'::jsonb) k) = array['dayLeft','dayLimit','enabled','left','monthLeft','reason'],
  'T-13 tutor_status 에는 내 남은 횟수·켜짐 여부만 (앱 전체 금액·다른 학생 없음)');
select zz_expect_error($$select admin_tutor_usage()$$, 'NOT_ADMIN', 'T-14 학생이 교수용 사용량 함수를 부르면 NOT_ADMIN');
reset role;
set role anon;
select zz_expect_error($$select tutor_status()$$, 'permission denied', 'T-15 익명(로그인 전)은 tutor_status 실행 불가');
reset role;

-- =====================================================================
-- B. Edge Function(service_role) — 거절 조건
-- =====================================================================
set role service_role;
select tutor_begin(:'ua', 'T-P1', 3, '{}') as b0 \gset
select zz_check(:'b0'::jsonb ->> 'error' = 'OFF', 'T-16 스위치가 꺼져 있으면 OFF (Anthropic 호출 전에 멈춤)');
reset role;
select zz_check((select count(*) from tutor_usage) = 0, 'T-17 거절된 요청은 기록 줄을 만들지 않음');
update app_settings set tutor_enabled = true where id = 1;
set role service_role;
select zz_check(tutor_begin(:'ua', 'T-D1', 3, '{}') ->> 'error' = 'NOT_PRACTICE', 'T-18 진단 문항 → NOT_PRACTICE');
select zz_check(tutor_begin(:'ua', 'T-A1', 3, '{}') ->> 'error' = 'NOT_PRACTICE', 'T-19 평가 문항 → NOT_PRACTICE');
select zz_check(tutor_begin(:'ua', 'NOPE-1', 3, '{}') ->> 'error' = 'NO_QUESTION', 'T-20 없는 문항 → NO_QUESTION');
select zz_check(tutor_begin('bbbbbbbb-0000-4000-8000-000000000009', 'T-P1', 3, '{}') ->> 'error' = 'NOT_LINKED', 'T-21 코드와 연결 안 된 기기 → NOT_LINKED');
select zz_check(tutor_begin(null, 'T-P1', 3, '{}') ->> 'error' = 'NO_AUTH', 'T-22 계정 번호 없음 → NO_AUTH');
select zz_check(tutor_begin(:'ua', 'T-P1', 2, '{}') ->> 'error' = 'NOT_YET', 'T-23 검토 끝난 힌트가 있는 문항: L2까지만 봤으면 NOT_YET (L3 이후에만)');
select zz_check(tutor_begin(:'ua', 'T-P2', 0, '{}') ->> 'error' = 'NOT_YET', 'T-24 힌트 없는 문항(검토 전 힌트 포함): 답을 내기 전이면 NOT_YET');
select zz_check(tutor_begin(:'ua', 'T-P1', 4, '{1}') ->> 'error' = 'ITEM_CLOSED', 'T-25 정답을 이미 봄(L4) → ITEM_CLOSED');
select zz_check(tutor_begin(:'ua', 'T-P2', 0, '{0}') ->> 'error' = 'ITEM_CLOSED', 'T-26 이미 정답을 냄 → ITEM_CLOSED');
select zz_check(tutor_begin(:'ua', 'T-P1', 3, '{1,2}') ->> 'error' = 'ITEM_CLOSED', 'T-27 4지선다 2번 다 씀 → ITEM_CLOSED');
select zz_check(tutor_begin(:'ua', 'T-P4', 3, '{0}') ->> 'error' = 'ITEM_CLOSED', 'T-28 O/X 1번 씀 → ITEM_CLOSED');
select zz_check(tutor_begin(:'ua', 'T-P1', 3, '{7}') ->> 'error' = 'BAD_INPUT' and tutor_begin(:'ua', 'T-P1', 3, '{1,1}') ->> 'error' = 'BAD_INPUT',
  'T-29 보기 번호 범위 밖·같은 답 두 번 → BAD_INPUT');
reset role;
select zz_check((select count(*) from tutor_usage) = 0, 'T-30 B의 거절은 모두 기록 줄 0 (횟수 안 씀)');

-- =====================================================================
-- C. 정상 흐름 + 횟수 세기
-- =====================================================================
set role service_role;
select tutor_begin(:'ua', 'T-P1', 3, '{}') as b1 \gset
select zz_check((:'b1'::jsonb ->> 'ok')::boolean and (:'b1'::jsonb ->> 'usageId') is not null, 'T-31 L3 본 연습 문항 → 예약 성공(usageId)');
select zz_check((:'b1'::jsonb -> 'context' ->> 'question') like '가짜 연습 문항%' and jsonb_array_length(:'b1'::jsonb -> 'context' -> 'choices') = 4
                and (:'b1'::jsonb -> 'context' ->> 'answerIndex')::int = 0, 'T-32 AI에 보낼 문항·보기·정답 번호를 돌려줌');
select zz_check(position('TUTA22' in :'b1') = 0 and position('튜터가' in :'b1') = 0 and position(:'sa' in :'b1') = 0 and position(:'ua' in :'b1') = 0,
  'T-33 돌려준 내용에 학생 코드·별명·학생 번호·기기 번호 없음');
select zz_check((:'b1'::jsonb -> 'state' ->> 'left')::int = 4, 'T-34 예약하자마자 남은 횟수 4 (동시 연타 대비)');
select tutor_finish((:'b1'::jsonb ->> 'usageId')::bigint, 'ok', 1500, 200) as f1 \gset
select zz_check((:'f1'::jsonb ->> 'left')::int = 4, 'T-35 답 성공 → 1회 차감(남은 4)');
reset role;
select zz_check((select status = 'ok' and input_tokens = 1500 and output_tokens = 200 and est_cost_usd = 0.00025 and day = lu_today() and month = :'mstart'::date
                 from tutor_usage where id = (:'b1'::jsonb ->> 'usageId')::bigint), 'T-36 기록 줄: ok · 토큰 1500/200 · $0.00025 · 오늘 날짜·이번 달');
select zz_check((select array_agg(column_name::text order by column_name) from information_schema.columns where table_name = 'tutor_usage')
                = array['created_at','day','est_cost_usd','finished_at','id','input_tokens','month','output_tokens','question_id','status','student_id'],
  'T-37 사용 기록 표에는 숫자·날짜·종류만 (질문 글·답 글 칸 없음)');
set role service_role;
select zz_expect_error(format($$select tutor_finish(%s, 'ok', 1, 1)$$, :'b1'::jsonb ->> 'usageId'), 'ALREADY_FINISHED', 'T-38 같은 줄을 두 번 끝낼 수 없음');
select zz_expect_error($$select tutor_finish(999999, 'ok', 1, 1)$$, 'NO_USAGE', 'T-39 없는 줄 → NO_USAGE');
select tutor_begin(:'ua', 'T-P2', 0, '{2}') as b2 \gset
select zz_check((:'b2'::jsonb ->> 'ok')::boolean, 'T-40 힌트 없는 문항: 오답 1번 낸 뒤에는 열림');
select zz_expect_error(format($$select tutor_finish(%s, 'free', 1, 1)$$, :'b2'::jsonb ->> 'usageId'), 'BAD_STATUS', 'T-41 결과 종류는 ok·refused·blocked·error 만');
select tutor_finish((:'b2'::jsonb ->> 'usageId')::bigint, 'refused', 900, 40) as f2 \gset
select zz_check((:'f2'::jsonb ->> 'left')::int = 4, 'T-42 강의 범위 밖 거절(refused) → 횟수 안 줄어듦');
select tutor_begin(:'ua', 'T-P1', 3, '{}') as b3 \gset
select tutor_finish((:'b3'::jsonb ->> 'usageId')::bigint, 'blocked', 1500, 250) as f3 \gset
select zz_check((:'f3'::jsonb ->> 'left')::int = 4, 'T-43 정답 노출로 버린 답(blocked) → 횟수 돌려줌');
select tutor_begin(:'ua', 'T-P1', 3, '{}') as b4 \gset
select tutor_finish((:'b4'::jsonb ->> 'usageId')::bigint, 'error', 0, 0) as f4 \gset
select zz_check((:'f4'::jsonb ->> 'left')::int = 4, 'T-44 AI 오류(error) → 횟수 안 줄어듦');
select tutor_finish((tutor_begin(:'ua', 'T-P1', 3, '{}') ->> 'usageId')::bigint, 'ok', 10, 10) from generate_series(1, 4);
select tutor_begin(:'ua', 'T-P1', 3, '{}') as b6 \gset
select zz_check(:'b6'::jsonb ->> 'error' = 'DAY_LIMIT' and (:'b6'::jsonb -> 'state' ->> 'left')::int = 0, 'T-45 하루 5번 다 쓰면 6번째 → DAY_LIMIT');
reset role;
select zz_check((select count(*) from tutor_usage where student_id = :'sa' and status = 'ok') = 5, 'T-46 A의 성공 기록은 정확히 5줄');
set role authenticated;
select set_config('test.uid', :'ua', false);
select zz_check(tutor_status() ->> 'reason' = 'DAY_LIMIT' and (tutor_status() ->> 'left')::int = 0, 'T-47 학생 화면 상태: A는 오늘 0번 남음(DAY_LIMIT)');
select set_config('test.uid', :'ub', false);
select zz_check((tutor_status() ->> 'enabled')::boolean and (tutor_status() ->> 'left')::int = 5, 'T-48 다른 학생 B는 영향 없음(5번 남음)');
reset role;

-- 예약(pending) 세기: 2분 안의 예약은 셈, 오래된 예약(Edge Function 이 중간에 멈춤)은 안 셈
set role service_role;
select tutor_begin(:'ub', 'T-P1', 3, '{}') as bb \gset
reset role;
select zz_check((lu_tutor_state(:'sb') ->> 'left')::int = 4, 'T-49 끝나지 않은 예약(2분 안)은 횟수에 셈');
update tutor_usage set created_at = now() - interval '3 minutes' where id = (:'bb'::jsonb ->> 'usageId')::bigint;
select zz_check((lu_tutor_state(:'sb') ->> 'left')::int = 5, 'T-50 2분 넘은 예약은 횟수에서 빠짐(학생 손해 없음)');

-- 남용 방지: 횟수에서 빼 주는 호출도 하루 15번까지만
set role service_role;
select tutor_finish((tutor_begin(:'uc', 'T-P1', 3, '{}') ->> 'usageId')::bigint, 'refused', 10, 10) from generate_series(1, 15);
select zz_check(tutor_begin(:'uc', 'T-P1', 3, '{}') ->> 'error' = 'CALL_CAP', 'T-51 범위 밖 질문만 15번 → 16번째 CALL_CAP (공짜 호출 반복으로 비용 쓰기 방지)');
reset role;

-- 1인 한 달 60회
insert into tutor_usage (student_id, question_id, day, month, status) select :'sd', 'T-P1', :'mstart'::date, :'mstart'::date, 'ok' from generate_series(1, 60);
set role service_role;
select zz_check(tutor_begin(:'ud', 'T-P1', 3, '{}') ->> 'error' = 'MONTH_LIMIT', 'T-52 이번 달 60번 다 쓰면 → MONTH_LIMIT');
reset role;
select zz_check((lu_tutor_state(:'sd') ->> 'monthLeft')::int = 0, 'T-53 남은 월 횟수 0');
update tutor_usage set day = (:'mstart'::date - 1), month = date_trunc('month', :'mstart'::date - 1)::date where student_id = :'sd';
select zz_check((lu_tutor_state(:'sd') ->> 'enabled')::boolean and (lu_tutor_state(:'sd') ->> 'monthLeft')::int = 60, 'T-54 지난달 기록은 이번 달 횟수에 안 셈');

-- 앱 전체 하루 300회
insert into tutor_usage (student_id, question_id, day, month, status)
  select :'sf', 'T-P1', lu_today(), :'mstart'::date, 'refused' from generate_series(1, 300 - (select count(*) from tutor_usage where day = lu_today()));
set role service_role;
select zz_check(tutor_begin(:'ue', 'T-P1', 3, '{}') ->> 'error' = 'APP_DAILY', 'T-55 앱 전체 오늘 300번 → 처음 쓰는 학생도 APP_DAILY');
reset role;
delete from tutor_usage where student_id = :'sf';

-- 이번 달 추정 비용 $6.40(약 ₩9,000) → 모든 학생 자동 꺼짐
insert into tutor_usage (student_id, question_id, day, month, status, est_cost_usd) values (:'sf', 'T-P1', :'mstart'::date, :'mstart'::date, 'ok', 6.39);
set role service_role;
select zz_check((tutor_begin(:'ue', 'T-P1', 3, '{}') ->> 'ok')::boolean, 'T-56 이번 달 $6.39 → 아직 켜짐');
reset role;
update tutor_usage set est_cost_usd = 6.40 where student_id = :'sf';
set role service_role;
select zz_check(tutor_begin(:'ue', 'T-P1', 3, '{}') ->> 'error' = 'BUDGET', 'T-57 이번 달 $6.40 도달 → BUDGET (자동 꺼짐)');
reset role;
set role authenticated;
select set_config('test.uid', :'ub', false);
select zz_check(tutor_status() ->> 'reason' = 'BUDGET', 'T-58 다른 학생 화면도 BUDGET');
reset role;
update tutor_usage set day = (:'mstart'::date - 1), month = date_trunc('month', :'mstart'::date - 1)::date where student_id = :'sf';
select zz_check((lu_tutor_state(:'se') ->> 'enabled')::boolean, 'T-59 지난달 비용은 이번 달 예산에 안 셈 → 다음 달엔 저절로 다시 켜짐');

-- 스위치 끄기
update app_settings set tutor_enabled = false where id = 1;
set role service_role;
select zz_check(tutor_begin(:'ue', 'T-P1', 3, '{}') ->> 'error' = 'OFF', 'T-60 스위치를 끄면 바로 OFF');
reset role;
update app_settings set tutor_enabled = true where id = 1;

-- 교수 사용량
set role authenticated;
select set_config('test.uid', 'aaaaaaaa-0000-4000-8000-000000000001', false);
select set_config('test.jwt', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","email":"prof@example.com","is_anonymous":false}', false);
select admin_tutor_usage() as au \gset
select zz_check((:'au'::jsonb ->> 'todayOk')::int >= 5 and (:'au'::jsonb ->> 'monthCostUsd')::numeric > 0 and not (:'au'::text ~ 'TUT[A-F]22|튜터'),
  'T-61 교수 사용량: 오늘·이번 달 숫자·금액만 (학생 코드·별명 없음)');
reset role;
