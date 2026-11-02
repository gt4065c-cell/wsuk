-- =====================================================================
-- 레벨업 캠퍼스 2단계 M2 2차 — 실시간 AI 튜터: 사용 기록 표 + 켜고 끄는 스위치 + 4겹 상한 서버 함수
--
-- 상태: ⏳ 아직 실제 DB에 적용하지 않음 (적용은 비서실장이 MCP로). 여러 번 실행해도 안전하게 썼습니다.
-- 실행 순서: schema.sql → 30_m2_teams_admin.sql → 40_ox_fix.sql → 이 파일
-- 내 컴퓨터 시험: supabase/local_test/run_tutor_local.sh (임시 PostgreSQL, 진짜 DB 아님)
--
-- 근거(바꾸지 않음): 00_캡틴/결재함/2026-11-02_2단계_결재2_설계확정.md (4겹 상한, 9,000원 자동 꺼짐, 연습에서만),
--   05_성장팀/2026-11-02_AI튜터_비용추정.md (Claude Haiku 5.5: 입력 $0.10 / 출력 $0.50, 100만 토큰당),
--   03_교육기획팀/2026-11-02_2단계_맞춤학습_설계.md ④ (A3 하루 5회, A4 성공했을 때만 차감, A8 범위 밖은 차감 X, A9 9,000원 꺼짐),
--   04_제품개발팀/2026-11-02_PRD_v1.0_2단계앱.md 5장 (동시에 눌러도 6회 안 됨, 정답 노출 답은 버리고 횟수 돌려줌)
--
-- 지키는 원칙
--   1. 이 표에는 "숫자"만 저장합니다: 누가(student_id) · 어느 문항 · 날짜 · 토큰 수 · 추정 금액 · 결과 종류.
--      학생 질문 글·AI 답 글은 저장하지 않습니다(그래서 30일 뒤 지울 글도 없음).
--   2. tutor_usage 표는 RLS를 켜고 학생·익명에게 권한 0. 학생은 tutor_status()로 "내 남은 횟수"만 봅니다.
--   3. tutor_begin / tutor_finish 는 Edge Function(ai-tutor)이 service_role 로만 부릅니다.
--      학생이 직접 부르면 permission denied — 학생이 가짜 토큰 수를 적어 비용을 부풀리거나(=앱 전체를 꺼 버리기)
--      줄이는 일을 막기 위해서입니다. 금액은 토큰 수로 이 DB가 계산합니다(호출자가 금액을 정하지 못함).
--   4. 진단·평가 문항은 tutor_begin 이 NOT_PRACTICE 로 거절합니다(Anthropic 호출 전에 멈춤).
--   5. 비밀 열쇠는 이 파일에 없습니다. Anthropic 키는 Supabase Edge Functions → Secrets 에만.
--
-- 4겹 상한 (app_settings 칸으로 조절. 숫자 = 결재2 확정값)
--   ① 1인 하루 5회   ② 1인 한 달 60회   ③ 앱 전체 하루 300회   ④ Anthropic 콘솔 월 $7(캡틴이 콘솔에서 설정 — 이 파일 밖)
--   + 이번 달 추정 비용이 $6.40(약 ₩9,000)에 닿으면 자동으로 꺼짐 (다음 달 1일에 저절로 다시 켜짐)
--   + [남용 방지] 1인 하루 "모든 호출" 15번 (범위 밖·차단·오류처럼 횟수에서 빼 주는 호출도 셈 — 공짜 호출 반복으로 비용 쓰기 방지)
--
-- 횟수 세는 법 (설계 A4·A8, PRD 5장)
--   status = 'pending'  : 막 시작(예약). 2분 안의 예약은 횟수에 셈 → 두 기기로 동시에 눌러도 6번째는 거절
--            'ok'       : 답을 잘 받음 → 횟수에 셈
--            'refused'  : 강의 범위 밖이라 거절 → 횟수에 안 셈
--            'blocked'  : 답에 정답이 들어 있어 서버가 버림 → 횟수에 안 셈(돌려줌)
--            'error'    : AI 호출 실패 → 횟수에 안 셈
--   앱 전체 하루 300·1인 하루 모든 호출 15·이번 달 비용은 결과와 상관없이 모든 줄을 셉니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 앱 설정에 스위치·상한 칸 추가 (기본: 꺼짐 — 캡틴이 API 키를 넣은 뒤 켬, README 7장)
-- ---------------------------------------------------------------------
alter table app_settings
  add column if not exists tutor_enabled       boolean      not null default false,
  add column if not exists tutor_day_limit     int          not null default 5    check (tutor_day_limit between 0 and 50),
  add column if not exists tutor_month_limit   int          not null default 60   check (tutor_month_limit between 0 and 1000),
  add column if not exists tutor_app_day_limit int          not null default 300  check (tutor_app_day_limit between 0 and 5000),
  add column if not exists tutor_call_cap      int          not null default 15   check (tutor_call_cap between 0 and 100),
  add column if not exists tutor_budget_usd    numeric(8,2) not null default 6.40 check (tutor_budget_usd between 0 and 7);

-- ---------------------------------------------------------------------
-- 2. 사용 기록 표 (숫자만)
-- ---------------------------------------------------------------------
create table if not exists tutor_usage (
  id             bigserial primary key,
  student_id     uuid not null references students(id) on delete cascade,
  question_id    text references questions(id) on delete set null,
  day            date not null,                  -- 한국 날짜
  month          date not null,                  -- 그 달 1일 (한국 날짜 기준)
  status         text not null default 'pending' check (status in ('pending', 'ok', 'refused', 'blocked', 'error')),
  input_tokens   int not null default 0 check (input_tokens >= 0),
  output_tokens  int not null default 0 check (output_tokens >= 0),
  est_cost_usd   numeric(12, 8) not null default 0 check (est_cost_usd >= 0),
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index if not exists tutor_usage_student_day on tutor_usage (student_id, day);
create index if not exists tutor_usage_month on tutor_usage (month);
create index if not exists tutor_usage_day on tutor_usage (day);

alter table tutor_usage enable row level security;
-- 규칙(policy)을 일부러 만들지 않음 = 학생·익명은 읽기·쓰기 모두 불가. 서버 함수만 씀
revoke all on tutor_usage from public, anon, authenticated;
revoke all on sequence tutor_usage_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. 내부 도우미 (학생은 못 부름 — 6장에서 revoke)
-- ---------------------------------------------------------------------
-- 추정 금액(달러): Claude Haiku 5.5 입력 $0.10 / 출력 $0.50 (100만 토큰당). 가격이 바뀌면 이 두 숫자만 고침
create or replace function lu_tutor_cost(p_in int, p_out int) returns numeric
language sql immutable set search_path = public as $$
  select round((greatest(coalesce(p_in, 0), 0) * 0.10 + greatest(coalesce(p_out, 0), 0) * 0.50) / 1000000.0, 8)
$$;

-- 한 학생의 지금 상태: 켜짐 여부 + 꺼진 이유 + 남은 횟수 (학생 화면·Edge Function 공통)
create or replace function lu_tutor_state(p_student uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  st app_settings; v_today date := lu_today(); v_month date := date_trunc('month', lu_today())::date;
  v_day int; v_mon int; v_calls int; v_app int; v_cost numeric; v_reason text;
begin
  select * into st from app_settings where id = 1;
  select count(*) filter (where u.day = v_today and (u.status = 'ok' or (u.status = 'pending' and u.created_at > now() - interval '2 minutes'))),
         count(*) filter (where (u.status = 'ok' or (u.status = 'pending' and u.created_at > now() - interval '2 minutes'))),
         count(*) filter (where u.day = v_today)
    into v_day, v_mon, v_calls
    from tutor_usage u where u.student_id = p_student and u.month = v_month;
  select count(*) into v_app from tutor_usage where day = v_today;
  select coalesce(sum(est_cost_usd), 0) into v_cost from tutor_usage where month = v_month;
  v_reason := case
    when not st.tutor_enabled                then 'OFF'
    when v_cost >= st.tutor_budget_usd       then 'BUDGET'        -- 이번 달 ₩9,000 도달 → 모든 학생 꺼짐
    when v_app >= st.tutor_app_day_limit     then 'APP_DAILY'
    when v_mon >= st.tutor_month_limit       then 'MONTH_LIMIT'
    when v_day >= st.tutor_day_limit         then 'DAY_LIMIT'
    when v_calls >= st.tutor_call_cap        then 'CALL_CAP'
    else null end;
  return json_build_object(
    'enabled',   v_reason is null,
    'reason',    v_reason,
    'dayLimit',  st.tutor_day_limit,
    'dayLeft',   greatest(0, st.tutor_day_limit - v_day),
    'monthLeft', greatest(0, st.tutor_month_limit - v_mon),
    'left',      greatest(0, least(st.tutor_day_limit - v_day, st.tutor_month_limit - v_mon)));
end $$;

-- ---------------------------------------------------------------------
-- 4. 학생용 (로그인한 기기) — 내 남은 횟수만. 다른 학생·앱 전체 금액은 돌려주지 않음
-- ---------------------------------------------------------------------
create or replace function tutor_status() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  return lu_tutor_state((lu_me()).id);
end $$;

-- ---------------------------------------------------------------------
-- 5. Edge Function(ai-tutor) 전용 — service_role 로만 실행
-- ---------------------------------------------------------------------
-- 시작(예약): 확인을 모두 통과하면 'pending' 한 줄을 넣고, AI에 보낼 문항 내용을 돌려줌
--   p_auth_uid : Edge Function 이 학생 로그인 토큰으로 Supabase Auth 에 물어 확인한 계정 번호
--   p_level    : 화면에서 본 힌트 단계(0~3). 4 = 정답을 이미 본 것 → 문항이 끝났으므로 거절
--   p_tried    : 이미 낸 오답 보기 번호(원래 순서). 비어 있음 = 아직 한 번도 답을 안 냄
create or replace function tutor_begin(p_auth_uid uuid, p_qid text, p_level int, p_tried int[] default '{}')
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid; q questions; k question_keys; v_state json; v_has_hints boolean; v_max int; v_id bigint;
  nt int := coalesce(array_length(p_tried, 1), 0);
begin
  if p_auth_uid is null then return json_build_object('ok', false, 'error', 'NO_AUTH'); end if;
  select student_id into v_sid from student_devices where auth_uid = p_auth_uid;
  if v_sid is null then return json_build_object('ok', false, 'error', 'NOT_LINKED'); end if;

  select * into q from questions where id = p_qid;
  if not found then return json_build_object('ok', false, 'error', 'NO_QUESTION'); end if;
  -- 진단·평가 문항에는 절대 안 켜짐 (설계 0장 "if mode != PRACTICE: ai_tutor = off")
  if q.pool <> 'practice' then return json_build_object('ok', false, 'error', 'NOT_PRACTICE'); end if;

  -- 모든 시작 요청을 한 줄로 세움 → 앱 전체 하루 300 · 1인 하루 5 · 이번 달 금액을 동시에 눌러도 넘지 않음
  perform pg_advisory_xact_lock(hashtext('lu_tutor_begin'));

  v_state := lu_tutor_state(v_sid);
  if not (v_state ->> 'enabled')::boolean then
    return json_build_object('ok', false, 'error', v_state ->> 'reason', 'state', v_state);
  end if;

  -- 문항 상태 확인: 보기 번호 범위·중복, 이미 끝난 문항(정답을 냈거나 기회를 다 씀)
  select * into k from question_keys where question_id = q.id;
  v_max := case when q.type = 'ox' then 1 else 2 end;
  if p_level is null or p_level < 0 or p_level > 4 then return json_build_object('ok', false, 'error', 'BAD_INPUT'); end if;
  for i in 1 .. nt loop
    if p_tried[i] is null or p_tried[i] < 0 or p_tried[i] >= jsonb_array_length(q.choices) then
      return json_build_object('ok', false, 'error', 'BAD_INPUT');
    end if;
  end loop;
  if nt = 2 and p_tried[1] = p_tried[2] then return json_build_object('ok', false, 'error', 'BAD_INPUT'); end if;
  if p_level = 4 or nt >= v_max or k.answer_index = any (coalesce(p_tried, '{}')) then
    return json_build_object('ok', false, 'error', 'ITEM_CLOSED');
  end if;

  -- 힌트 사다리 다음 단계에서만: 검토 끝난 힌트가 있으면 L3까지 본 뒤, 없으면 답을 한 번 낸 뒤
  v_has_hints := exists (select 1 from hints h where h.question_id = q.id and h.hint_status = 'reviewed');
  if (v_has_hints and p_level < 3) or (not v_has_hints and nt < 1) then
    return json_build_object('ok', false, 'error', 'NOT_YET');
  end if;

  insert into tutor_usage (student_id, question_id, day, month)
    values (v_sid, q.id, lu_today(), date_trunc('month', lu_today())::date)
    returning id into v_id;

  return json_build_object(
    'ok', true,
    'usageId', v_id,
    'state', lu_tutor_state(v_sid),
    -- AI에 보낼 것: 문항·보기·정답·해설·흔한 착각·이미 낸 오답. 학생 코드·별명·번호는 넣지 않음
    'context', json_build_object(
      'lecture', q.lecture, 'sourceSection', q.source_section, 'type', q.type,
      'question', q.question, 'choices', q.choices,
      'answerIndex', k.answer_index, 'explanation', k.explanation, 'commonWrongReason', k.common_wrong_reason,
      'tried', to_json(coalesce(p_tried, '{}')),
      'hasHints', v_has_hints));
end $$;

-- 끝내기: 결과 종류 + 토큰 수 기록. 금액은 여기서 계산. 같은 줄을 두 번 끝낼 수 없음
create or replace function tutor_finish(p_usage_id bigint, p_status text, p_input int, p_output int) returns json
language plpgsql security definer set search_path = public as $$
declare u tutor_usage; v_in int; v_out int;
begin
  if p_status is null or p_status not in ('ok', 'refused', 'blocked', 'error') then raise exception 'BAD_STATUS'; end if;
  select * into u from tutor_usage where id = p_usage_id for update;
  if not found then raise exception 'NO_USAGE'; end if;
  if u.status <> 'pending' then raise exception 'ALREADY_FINISHED'; end if;
  v_in := least(greatest(coalesce(p_input, 0), 0), 200000);
  v_out := least(greatest(coalesce(p_output, 0), 0), 200000);
  update tutor_usage set status = p_status, input_tokens = v_in, output_tokens = v_out,
         est_cost_usd = lu_tutor_cost(v_in, v_out), finished_at = now()
   where id = p_usage_id;
  return lu_tutor_state(u.student_id);
end $$;

-- 교수 화면용(나중에 화면 연결): 오늘·이번 달 호출 수와 추정 금액. 교수만 (lu_is_admin 은 30번 파일)
create or replace function admin_tutor_usage() returns json
language plpgsql stable security definer set search_path = public as $$
declare v_today date := lu_today(); v_month date := date_trunc('month', lu_today())::date; st app_settings;
begin
  if not lu_is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into st from app_settings where id = 1;
  return json_build_object(
    'enabled', st.tutor_enabled,
    'budgetUsd', st.tutor_budget_usd,
    'todayCalls', (select count(*) from tutor_usage where day = v_today),
    'todayOk', (select count(*) from tutor_usage where day = v_today and status = 'ok'),
    'monthCalls', (select count(*) from tutor_usage where month = v_month),
    'monthStudents', (select count(distinct student_id) from tutor_usage where month = v_month),
    'monthBlocked', (select count(*) from tutor_usage where month = v_month and status = 'blocked'),
    'monthCostUsd', (select coalesce(sum(est_cost_usd), 0) from tutor_usage where month = v_month),
    'monthCostKrw', (select round(coalesce(sum(est_cost_usd), 0) * 1400) from tutor_usage where month = v_month));
end $$;

-- ---------------------------------------------------------------------
-- 6. 실행 권한 — Supabase 자동 허용을 모두 걷고 필요한 것만
-- ---------------------------------------------------------------------
revoke execute on function
  lu_tutor_cost(int, int), lu_tutor_state(uuid), tutor_status(),
  tutor_begin(uuid, text, int, int[]), tutor_finish(bigint, text, int, int), admin_tutor_usage()
  from public, anon, authenticated;
-- 학생(로그인 기기): 내 남은 횟수 / 교수: 사용량 (함수 안에서 교수인지 다시 확인)
grant execute on function tutor_status(), admin_tutor_usage() to authenticated;
-- Edge Function(ai-tutor)만: 시작·끝내기 (service_role = 서버 비밀 열쇠로만 쓸 수 있는 역할)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function tutor_begin(uuid, text, int, int[]), tutor_finish(bigint, text, int, int) to service_role';
  end if;
end $$;

-- 켜기 / 끄기 (캡틴·비서실장, SQL Editor):
--   update app_settings set tutor_enabled = true  where id = 1;   -- 켜기 (API 키를 Secrets 에 넣은 뒤)
--   update app_settings set tutor_enabled = false where id = 1;   -- 끄기 (바로 모든 학생 버튼이 "쉬는 중")
-- 점검 (적용 후 비서실장):
--   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;              -- 0줄
--   select grantee, privilege_type from information_schema.role_table_grants where table_name = 'tutor_usage';   -- anon·authenticated 없음
--   select has_function_privilege('authenticated', 'tutor_begin(uuid,text,int,int[])', 'execute');  -- false
--   select month, count(*), sum(est_cost_usd) from tutor_usage group by 1 order by 1 desc;         -- 달별 사용량
