-- [개발용] 80_session_fix.sql 시험 — 내 컴퓨터의 임시 PostgreSQL 에서만 (실제 Supabase 에서는 실행하지 말 것)
-- 순서: run_session_fix_local.sh 가 00 → 05 → 06 → ../schema.sql → ../30 → ../40 → ../50 → ../60 → ../70 → ../80(2번) → 이 파일
-- 결과: 줄마다 "PASS X-xx …" 또는 "FAIL X-xx …". 학생 정보는 모두 가짜(코드·별명)
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

-- 가짜 학생 1명 + 살아 있는 계정 1개 + 지워진 계정(auth.users 에 없음) 1개
insert into students (code, cohort, nickname) values ('SXAA22', '2027-1', '가짜별');
select gen_random_uuid() as alive \gset
select gen_random_uuid() as gone \gset
insert into auth.users (id) values (:'alive');

-- =====================================================================
-- A. claim_code
-- =====================================================================
set role authenticated;
select set_config('test.uid', :'gone', false);
select zz_check((claim_code('SXAA22')->>'ok') = 'false' and (claim_code('SXAA22')->>'error') = 'NO_AUTH',
  'X-01 지워진 계정으로 코드 입력 → 오류(FK) 대신 {ok:false, error:NO_AUTH}');
reset role;
select zz_check(not exists (select 1 from student_devices where auth_uid = :'gone') and not exists (select 1 from code_attempts where auth_uid = :'gone'),
  'X-02 지워진 계정은 기기 연결·코드 입력 횟수 모두 남지 않음');
set role authenticated;
select set_config('test.uid', :'alive', false);
select zz_check((claim_code(' sxaa22 ')->>'ok') = 'true' and (claim_code('SXAA22')->'student'->>'nickname') = '가짜별',
  'X-03 살아 있는 계정은 예전처럼 연결(소문자·빈칸 정리) · 별명 돌려줌');
select zz_check((claim_code('ZZZZ22')->>'error') = 'unknown' and (claim_code('AB')->>'error') = 'shape', 'X-04 없는 코드 unknown · 모양 틀림 shape 그대로');
select zz_check(not ((claim_code('SXAA22')->'student')::jsonb ? 'theta'), 'X-05 θ는 여전히 돌려주지 않음');
select set_config('test.uid', '', false);
select zz_expect_error($$select claim_code('SXAA22')$$, 'NO_AUTH', 'X-06 로그인 없음(uid 없음)은 예전처럼 NO_AUTH 오류');
reset role;
select zz_check((select count(*) from student_devices where auth_uid = :'alive') = 1, 'X-07 연결은 한 줄');
-- 10번 제한도 그대로
insert into code_attempts (auth_uid) select :'alive'::uuid from generate_series(1, 10);
set role authenticated;
select set_config('test.uid', :'alive', false);
select zz_check((claim_code('SXAA22')->>'error') = 'too_many', 'X-08 10분에 10번 넘으면 too_many 그대로');
reset role;
select zz_check(has_function_privilege('authenticated', 'claim_code(text)', 'execute') and not has_function_privilege('anon', 'claim_code(text)', 'execute'),
  'X-09 claim_code: 로그인 기기만 실행 (로그인 전 anon 불가)');

-- =====================================================================
-- B. lectures
-- =====================================================================
insert into lectures (lecture, title, minutes, body_json, status) values
  (1, '가짜 강의 하나', 5, '[{"t":"p","text":[["본문",0]]}]', 'reviewed'),
  (2, '가짜 강의 둘(검토 전)', 4, '[{"t":"p","text":[["검토 전",0]]}]', 'draft');
set role authenticated;
select set_config('test.uid', :'alive', false);
select zz_check((select count(*) from (select lecture, title, minutes, body_json from lectures) z) = 1
            and (select title from lectures where lecture = 1) = '가짜 강의 하나', 'X-20 학생은 검토 끝난(reviewed) 강의만 읽음(1강), 검토 전 강은 0줄');
select zz_expect_error($$select status from lectures$$, 'permission denied', 'X-21 학생은 status 칸을 못 읽음');
select zz_expect_error($$insert into lectures (lecture, title, body_json) values (3, 'x', '[{"t":"p"}]')$$, 'permission denied', 'X-22 학생은 강의를 못 씀');
select zz_expect_error($$update lectures set title = 'x' where lecture = 1$$, 'permission denied', 'X-23 학생은 강의를 못 고침');
reset role;
set role anon;
select zz_expect_error($$select lecture from lectures$$, 'permission denied', 'X-24 로그인 전(anon)은 못 읽음');
reset role;
select zz_check((select relrowsecurity from pg_class where relname = 'lectures'), 'X-25 lectures: RLS 켜짐');
select zz_expect_error($$insert into lectures (lecture, title, body_json) values (31, 'x', '[{"t":"p"}]')$$, 'check', 'X-26 강 번호 1~30 밖은 표가 거절');
select zz_expect_error($$insert into lectures (lecture, title, body_json) values (5, 'x', '{"t":"p"}')$$, 'check', 'X-27 본문이 목록(배열)이 아니면 표가 거절');
select zz_check(count(*) = 0, 'X-28 RLS 꺼진 public 표 0개') from pg_tables where schemaname = 'public' and not rowsecurity;
