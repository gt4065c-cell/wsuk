-- =====================================================================
-- 레벨업 캠퍼스 2단계 — 결재3 전 QA "낮음" 지적 정리 (QA #5 ~ #11)
--
-- 상태: ⏳ 실DB 미적용 (2026-11-03 앱 개발자 작성). 적용은 비서실장이 합니다.
-- 실행 순서: schema.sql → 30_m2_teams_admin.sql → 40_ox_fix.sql → 50_ai_tutor.sql → 60_m2_weekly_explainer.sql → 이 파일
--           여러 번 실행해도 같은 결과(create or replace / revoke·grant 만). 표·데이터는 바꾸지 않습니다.
-- 내 컴퓨터 시험: supabase/local_test/run_qa_fixes_local.sh (임시 PostgreSQL, 진짜 DB 아님)
-- 근거: 04_제품개발팀/테스트보고서/2026-11-03_app2_결재3전_QA.md 표 #5~#11
--       결과 정리: 04_제품개발팀/테스트보고서/2026-11-03_app2_QA낮음_수정.md
--
-- 바뀌는 것 (쉬운 말)
--   #5  questions 표: 학생은 앱이 쓰는 칸만 읽음. 난이도 b·응답 수 n_resp·주 번호 week 는 못 읽음(칸 단위 허용)
--   #6  set_nickname: 앞뒤 빈칸 지우고 가운데 빈칸은 하나로 → 2~12글자가 아니면 NICK_LENGTH
--       diag_answer : 보기 번호가 0 ~ (보기 수-1) 이 아니면 BAD_CHOICE ("아직 모르겠어요" = null 은 그대로 받음)
--   #7  set_nickname: 이메일 모양·전화번호 모양(해설 당번과 같은 규칙) + 숫자 7개 이상 이어짐(전화번호 일부·학번)이면 NICK_PRIVATE
--   #8  tutor_begin : 서버가 낼 수 있는 문항인지 확인 — 열린 강 범위 밖이면 NOT_OPEN,
--                     최근 7일 안에 이미 마감한 문항(복습 날인 문항 제외)이면 ITEM_CLOSED. (힌트 단계는 서버 기록이 없어 그대로)
--   #9  close_item  : 연습(PRACTICE)에서 열린 강 범위 밖 문항이면 NOT_OPEN.
--                     같은 문항을 다시 마감하면 XP 0 에 더해 θ(숨은 실력)·답 수도 바꾸지 않음
--   #10 진단 먼저 (맞춤학습 설계 D4·D5, 팀게임 설계 2-1 "1주차 진단 → 기준 점검", 1일차 "진단 후 공통 평가")
--       진단 10문항 전(진단 끝내기 전)에는 공통 점검(상태 NEED_DIAG, 문항 받기·제출 NEED_DIAG)과
--       해설 당번(카드 needDiag, 당번으로 뽑히지 않음, 쓰기 NEED_DIAG)이 닫힘
--   #11ⓑ 공통 점검: 일요일에 시작해 월요일 0시가 지나 제출하면
--       월요일 03:00(한국 시간) 전까지는 지난주 점검으로 받아 줌(유예 3시간). 그 뒤면 WEEK_CHANGED(답이 지난주 것이라는 쉬운 안내)
-- 바뀌지 않는 것: 상한(하루 200 XP·튜터 4겹), 복습 상자 규칙, next_practice, 팀·교수 함수, 점수 비공개 원칙
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. (#5) questions 표 읽기: 칸 단위로만 허용
--    앱(store.js)이 읽는 칸: id, part, lecture, difficulty, type, question, choices, source_section, diag_order + 거르기용 pool
--    다른 표의 읽기 규칙(question_keys·hints)이 questions.id·pool 을 살펴보므로 그 두 칸도 필요
-- ---------------------------------------------------------------------
revoke select on questions from authenticated;
revoke all on questions from anon;
grant select (id, part, lecture, difficulty, type, question, choices, source_section, pool, diag_order) on questions to authenticated;

-- ---------------------------------------------------------------------
-- 2. 내부 도우미: 진단을 충분히 했는가 (화면 needDiag 와 같은 규칙: 진단 끝냄 또는 10문항 이상 답함)
-- ---------------------------------------------------------------------
create or replace function lu_diag_ready(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select diag_done from students where id = p_student), false)
      or (select count(*) from diag_answers where student_id = p_student) >= 10
$$;

-- ---------------------------------------------------------------------
-- 3. (#6 #7) 별명: 빈칸 정리 → 2~12글자 → 개인 정보 모양 거절
-- ---------------------------------------------------------------------
create or replace function set_nickname(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := regexp_replace(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'), '^ | $', '', 'g');
        me students := lu_me();
begin
  if char_length(v) < 2 or char_length(v) > 12 then raise exception 'NICK_LENGTH' using hint = '별명은 2~12글자'; end if;
  -- 해설 당번(write_team_explainer)과 같은 이메일·전화번호 규칙 + 별명은 짧아서 숫자 7개 이상 이어지면(전화번호 일부·학번) 거절
  if v ~ '[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}'
     or v ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}'
     or regexp_replace(v, '[-. ]', '', 'g') ~ '[0-9]{7,}' then
    raise exception 'NICK_PRIVATE' using hint = '전화번호·이메일·학번 모양은 별명에 쓸 수 없어요';
  end if;
  update students set nickname = v where id = me.id;
end $$;

-- ---------------------------------------------------------------------
-- 4. (#6) 진단 답: 보기 번호 범위 확인 (schema.sql 본문 + BAD_CHOICE 한 줄)
-- ---------------------------------------------------------------------
create or replace function diag_answer(p_qid text, p_choice int) returns int
language plpgsql security definer set search_path = public as $$
declare me students := lu_me(); q questions;
begin
  if me.diag_done then return (select count(*) from diag_answers where student_id = me.id); end if;
  select * into q from questions where id = p_qid and pool = 'diagnostic';
  if not found then raise exception 'NOT_DIAG'; end if;
  if p_choice is not null and (p_choice < 0 or p_choice >= jsonb_array_length(q.choices)) then raise exception 'BAD_CHOICE'; end if;
  insert into diag_answers (student_id, question_id, choice) values (me.id, p_qid, p_choice) on conflict do nothing;
  return (select count(*) from diag_answers where student_id = me.id);
end $$;

-- ---------------------------------------------------------------------
-- 5. (#9) 문항 마감: 열린 강 범위 확인 + 다시 마감하면 θ 그대로 (schema.sql 본문에서 표시한 두 곳만 바뀜)
-- ---------------------------------------------------------------------
create or replace function close_item(p_qid text, p_mode text, p_level int, p_submits int[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  me students := lu_me(); q questions; k question_keys; v_today date := lu_today();
  ns int := coalesce(array_length(p_submits, 1), 0); v_max int; v_last_ok boolean; v_outcome text;
  v_r double precision; v_p double precision; v_xp int; v_xp_today int; v_first boolean; rb review_box; v_note text;
begin
  if p_mode not in ('PRACTICE', 'REVIEW') then raise exception 'BAD_MODE'; end if;
  -- QA 4번: 같은 학생의 요청을 한 줄로 세움(하루 상한 200 동시 요청으로 뚫기 방지). 잠근 뒤 최신 값을 다시 읽음
  select * into me from students where id = me.id for update;
  select * into q from questions where id = p_qid and pool = 'practice';
  if not found then raise exception 'PRACTICE_ONLY'; end if;
  -- [70번 #9] 새 연습은 열린 강까지만 (next_practice 가 내는 범위와 같음). 복습은 아래 NOT_DUE 가 따로 확인
  if p_mode = 'PRACTICE' and q.lecture > (select open_up_to from app_settings where id = 1) then raise exception 'NOT_OPEN'; end if;
  select * into k from question_keys where question_id = p_qid;
  v_max := case when q.type = 'ox' then 1 else 2 end;
  if ns > v_max or p_level not between 0 and 4 then raise exception 'BAD_SUBMITS'; end if;
  -- QA 3번: 보기 번호는 0 ~ (보기 수-1)만, 같은 답 두 번 금지
  for i in 1 .. ns loop
    if p_submits[i] is null or p_submits[i] < 0 or p_submits[i] >= jsonb_array_length(q.choices) then raise exception 'BAD_SUBMITS'; end if;
  end loop;
  if ns = 2 and p_submits[1] = p_submits[2] then raise exception 'BAD_SUBMITS'; end if;
  -- 마지막 제출 전 답은 모두 오답이어야 함(정답이면 그때 마감됐어야 함)
  for i in 1 .. greatest(ns - 1, 0) loop
    if p_submits[i] = k.answer_index then raise exception 'BAD_SUBMITS'; end if;
  end loop;
  v_last_ok := ns > 0 and p_submits[ns] = k.answer_index;
  if p_level < 4 and not v_last_ok and ns < v_max then raise exception 'NOT_CLOSED'; end if;
  if p_level = 4 and ns = 0 then raise exception 'L4_BEFORE_SUBMIT'; end if;
  v_outcome := case
    when p_level >= 4 or not v_last_ok then '정답 보고 이해'
    when p_level >= 1 then '힌트로 해결'
    when ns = 1 then '혼자 맞힘'
    else '두 번째에 맞힘' end;
  v_r := case v_outcome when '혼자 맞힘' then 1 when '정답 보고 이해' then 0 else 0.5 end;

  select coalesce(sum(xp), 0) into v_xp_today from attempts where student_id = me.id and day = v_today;
  v_xp := least(10 + case when p_mode = 'REVIEW' and v_outcome = '혼자 맞힘' then 5 else 0 end,
                greatest(0, 200 - v_xp_today));

  if p_mode = 'PRACTICE' then
    v_p := lu_p(me.theta, q.b, 1.0 / jsonb_array_length(q.choices));
    v_first := not exists (select 1 from attempts where student_id = me.id and question_id = q.id);
    -- QA 3번 / 팀게임 설계: 복습 일정 밖에서 같은 문항을 다시 풀면 XP 없음
    -- [70번 #9] 그리고 θ·답 수도 바꾸지 않음 (같은 문항 반복 마감으로 θ → 팀 편성을 움직이지 못하게)
    if not v_first then v_xp := 0; end if;
    if v_first then
      update students set theta = lu_clamp(theta + lu_k(n_answers) * (v_r - v_p), -3, 3), n_answers = n_answers + 1
        where id = me.id;
      update questions set
        b = case when n_resp >= 10 then lu_clamp(b - lu_k(n_resp) * (v_r - v_p), -2.5, 2.5) else b end,
        n_resp = n_resp + 1
      where id = q.id;
    end if;
    if v_outcome <> '혼자 맞힘' then
      insert into review_box values (me.id, q.id, 1, v_today + 1)
        on conflict (student_id, question_id) do update set box = 1, due = v_today + 1;
      v_note := 'again';
    end if;
  else
    select * into rb from review_box where student_id = me.id and question_id = q.id and due <= v_today;
    if not found then raise exception 'NOT_DUE'; end if;
    if v_outcome = '혼자 맞힘' then
      if rb.box >= 4 then delete from review_box where student_id = me.id and question_id = q.id; v_note := 'review-done';
      else
        update review_box set box = rb.box + 1,
          due = v_today + case rb.box + 1 when 2 then 3 when 3 then 7 else 14 end
          where student_id = me.id and question_id = q.id;
        v_note := 'box-up';
      end if;
    else
      update review_box set box = 1, due = v_today + 1 where student_id = me.id and question_id = q.id;
      v_note := 'again';
    end if;
  end if;

  update students set xp = xp + v_xp where id = me.id;
  insert into attempts (student_id, question_id, mode, outcome, hint_level, submits, xp, day)
    values (me.id, q.id, p_mode, v_outcome, p_level, p_submits, v_xp, v_today);
  return json_build_object('xp', v_xp, 'xpTotal', me.xp + v_xp, 'outcome', v_outcome, 'reviewNote', v_note);
end $$;

-- ---------------------------------------------------------------------
-- 6. (#8) AI 튜터 시작: 서버가 낼 수 있는 문항인지 확인 (50번 본문 + 표시한 한 덩어리)
--    "낼 수 있는 문항" = 오늘 복습 날인 문항  또는  열린 강 안의 연습 문항 중 복습 상자에 없고 최근 7일 안 마감 기록이 없는 것
--    (= next_practice 후보와 같은 규칙). 힌트 단계(p_level)·낸 오답(p_tried)은 서버에 기록이 없어 화면 값을 그대로 씀 → 남은 위험
-- ---------------------------------------------------------------------
create or replace function tutor_begin(p_auth_uid uuid, p_qid text, p_level int, p_tried int[] default '{}')
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid; q questions; k question_keys; v_state json; v_has_hints boolean; v_max int; v_id bigint; v_due boolean;
  nt int := coalesce(array_length(p_tried, 1), 0);
begin
  if p_auth_uid is null then return json_build_object('ok', false, 'error', 'NO_AUTH'); end if;
  select student_id into v_sid from student_devices where auth_uid = p_auth_uid;
  if v_sid is null then return json_build_object('ok', false, 'error', 'NOT_LINKED'); end if;

  select * into q from questions where id = p_qid;
  if not found then return json_build_object('ok', false, 'error', 'NO_QUESTION'); end if;
  -- 진단·평가 문항에는 절대 안 켜짐 (설계 0장 "if mode != PRACTICE: ai_tutor = off")
  if q.pool <> 'practice' then return json_build_object('ok', false, 'error', 'NOT_PRACTICE'); end if;

  -- [70번 #8] 지금 풀 수 있는 문항인지 (Anthropic 호출·횟수 예약 전에 멈춤)
  v_due := exists (select 1 from review_box rb where rb.student_id = v_sid and rb.question_id = q.id and rb.due <= lu_today());
  if not v_due then
    if q.lecture > (select open_up_to from app_settings where id = 1) then
      return json_build_object('ok', false, 'error', 'NOT_OPEN');
    end if;
    if exists (select 1 from review_box rb where rb.student_id = v_sid and rb.question_id = q.id)
       or exists (select 1 from attempts a where a.student_id = v_sid and a.question_id = q.id and a.day > lu_today() - 7) then
      return json_build_object('ok', false, 'error', 'ITEM_CLOSED');
    end if;
  elsif exists (select 1 from attempts a where a.student_id = v_sid and a.question_id = q.id and a.day = lu_today()) then
    return json_build_object('ok', false, 'error', 'ITEM_CLOSED');   -- 오늘 이미 마감한 문항
  end if;

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

-- ---------------------------------------------------------------------
-- 7. 내부 도우미: 지금 한국 시각 (공통 점검 월요일 새벽 유예 계산용. 시험에서는 이 함수만 바꿔 시각을 흉내 냄)
-- ---------------------------------------------------------------------
create or replace function lu_kst_now() returns timestamp
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Seoul')
$$;

-- ---------------------------------------------------------------------
-- 8. (#10) 공통 점검 홈 카드: 진단 10문항 전이면 open=false · reason NEED_DIAG (60번 본문 + 표시한 한 줄)
-- ---------------------------------------------------------------------
create or replace function weekly_check_status() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me students := lu_me(); v_start date; v_week int := lu_check_week(); v_max int; v_n int := 0;
  v_done boolean := false; v_reason text; v_team json := null; v_review json := null;
begin
  select cohort_start into v_start from app_settings where id = 1;
  select max(week) into v_max from questions where pool = 'assessment' and week is not null;
  if v_week is not null then
    select count(*) into v_n from questions where pool = 'assessment' and week = v_week;
    v_done := exists (select 1 from weekly_checks where student_id = me.id and week = v_week);
  end if;
  v_reason := case when v_start is null then 'OFF'
                   when v_week is null then 'NOT_STARTED'
                   when v_n = 0 and v_week > coalesce(v_max, 0) then 'ENDED'
                   when v_n = 0 then 'NO_ITEMS'
                   when not v_done and not lu_diag_ready(me.id) then 'NEED_DIAG'   -- [70번 #10] 진단 먼저
                   else null end;
  if v_done then
    select coalesce(json_agg(z.lecture order by z.lecture), '[]') into v_review from (
      select distinct q.lecture from weekly_answers w join questions q on q.id = w.question_id
       where w.student_id = me.id and w.week = v_week and not w.correct) z;
  end if;
  if me.team_id is not null and exists (select 1 from teams where id = me.team_id) and v_week is not null then
    -- 팀원 n/m명 응시: m = 팀 활동 중인 팀원(쉼 제외, 나 포함), n = 그중 이번 주 응시한 사람 수 (누가 했는지는 안 보냄)
    select json_build_object('active', count(*), 'taken', count(*) filter (where exists (
             select 1 from weekly_checks c where c.student_id = s.id and c.week = v_week)))
      into v_team
      from students s where s.team_id = me.team_id and not s.team_off;
  end if;
  return json_build_object(
    'open', v_reason is null,
    'reason', v_reason,
    'week', v_week,
    'cohortStart', v_start,
    'nItems', v_n,
    'done', v_done,
    'reviewLectures', v_review,
    'team', v_team);
end $$;

-- 점검 시작: 진단 10문항 전이면 NEED_DIAG (60번 본문 + 한 줄)
create or replace function weekly_check_items() returns json
language plpgsql stable security definer set search_path = public as $$
declare me students := lu_me(); v_week int := lu_check_week();
begin
  if v_week is null or not exists (select 1 from questions where pool = 'assessment' and week = v_week) then
    raise exception 'WEEKLY_CLOSED' using hint = '이번 주 공통 점검이 열려 있지 않아요';
  end if;
  if exists (select 1 from weekly_checks where student_id = me.id and week = v_week) then
    raise exception 'WEEKLY_DONE' using hint = '이번 주 공통 점검은 이미 응시했어요';
  end if;
  if not lu_diag_ready(me.id) then raise exception 'NEED_DIAG' using hint = '진단을 10문항 이상 마치면 열려요'; end if;   -- [70번 #10]
  return json_build_object(
    'week', v_week,
    'items', (select json_agg(json_build_object('id', q.id, 'lecture', q.lecture, 'type', q.type,
                                                'question', q.question, 'choices', q.choices) order by length(q.id), q.id)
                from questions q where q.pool = 'assessment' and q.week = v_week));
end $$;

-- 제출 (60번 본문 + [70번] 두 덩어리)
--   #10 진단 10문항 전이면 NEED_DIAG
--   #11ⓑ 답이 모두 "지난주" 문항이면: 월요일 03:00(한국 시각) 전 → 지난주 점검으로 받아 줌 / 그 뒤 → WEEK_CHANGED
create or replace function weekly_check_submit(p_answers jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  me students := lu_me(); v_week int := lu_check_week(); r record; v_choice int; v_ok boolean;
  v_n int := 0; v_correct int := 0; v_review json; v_start date;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'BAD_ANSWERS'; end if;
  -- [70번 #11ⓑ] 일요일에 시작해 월요일에 낸 답: 답 번호가 하나 이상이고 모두 지난주 문항이면
  select cohort_start into v_start from app_settings where id = 1;
  if v_week is not null and v_week >= 2
     and exists (select 1 from jsonb_object_keys(p_answers))
     and not exists (select 1 from jsonb_object_keys(p_answers) as kk(k)
                      where not exists (select 1 from questions q where q.id = kk.k and q.pool = 'assessment' and q.week = v_week - 1)) then
    if lu_kst_now()::date = lu_today() and (lu_today() - v_start) % 7 = 0 and lu_kst_now()::time < time '03:00' then
      v_week := v_week - 1;   -- 유예 3시간: 지난주 점검으로 받음
    else
      raise exception 'WEEK_CHANGED' using hint = '지난주 공통 점검은 닫혔어요';
    end if;
  end if;
  if v_week is null or not exists (select 1 from questions where pool = 'assessment' and week = v_week) then
    raise exception 'WEEKLY_CLOSED';
  end if;
  if not lu_diag_ready(me.id) then raise exception 'NEED_DIAG'; end if;   -- [70번 #10] 진단 먼저 (닫힘 확인 다음)
  -- 같은 학생의 동시 제출(두 기기·연타)을 한 줄로 세움 → 두 번째는 아래에서 WEEKLY_DONE
  perform 1 from students where id = me.id for update;
  if exists (select 1 from weekly_checks where student_id = me.id and week = v_week) then raise exception 'WEEKLY_DONE'; end if;
  -- 이번 주 문항이 아닌 답이 섞여 있으면 거절
  if exists (select 1 from jsonb_object_keys(p_answers) as kk(k)
              where not exists (select 1 from questions q where q.id = kk.k and q.pool = 'assessment' and q.week = v_week)) then
    raise exception 'BAD_ANSWERS';
  end if;
  insert into weekly_checks (student_id, week, cohort, n_items, n_correct)
    values (me.id, v_week, me.cohort, (select count(*) from questions where pool = 'assessment' and week = v_week), 0);
  for r in
    select q.id, jsonb_array_length(q.choices) as nc, k.answer_index
      from questions q left join question_keys k on k.question_id = q.id
     where q.pool = 'assessment' and q.week = v_week
  loop
    if not (p_answers ? r.id) then raise exception 'BAD_ANSWERS'; end if;   -- 빠진 문항
    if jsonb_typeof(p_answers -> r.id) = 'null' then
      v_choice := null;
    elsif jsonb_typeof(p_answers -> r.id) = 'number' and (p_answers ->> r.id) ~ '^[0-9]{1,2}$' then
      v_choice := (p_answers ->> r.id)::int;
      if v_choice >= r.nc then raise exception 'BAD_ANSWERS'; end if;
    else
      raise exception 'BAD_ANSWERS';
    end if;
    v_ok := v_choice is not null and r.answer_index is not null and v_choice = r.answer_index;
    insert into weekly_answers (student_id, question_id, week, choice, correct) values (me.id, r.id, v_week, v_choice, v_ok);
    v_n := v_n + 1; v_correct := v_correct + case when v_ok then 1 else 0 end;
  end loop;
  update weekly_checks set n_items = v_n, n_correct = v_correct where student_id = me.id and week = v_week;
  select coalesce(json_agg(z.lecture order by z.lecture), '[]') into v_review from (
    select distinct q.lecture from weekly_answers w join questions q on q.id = w.question_id
     where w.student_id = me.id and w.week = v_week and not w.correct) z;
  return json_build_object('done', true, 'week', v_week, 'reviewLectures', v_review);   -- 맞힌 수는 돌려주지 않음
end $$;

-- ---------------------------------------------------------------------
-- 9. (#10) 해설 당번: 진단 10문항 전인 팀원은 당번으로 뽑지 않음 (60번 본문 + 표시한 두 곳)
-- ---------------------------------------------------------------------
create or replace function lu_explainer_pick(p_team uuid, p_week date) returns team_explainers
language plpgsql security definer set search_path = public as $$
declare e team_explainers; v_duty uuid; v_q text;
begin
  insert into team_explainers (team_id, week_start) values (p_team, p_week) on conflict do nothing;
  select * into e from team_explainers where team_id = p_team and week_start = p_week for update;

  if e.body is null and (e.student_id is null or not exists (
       select 1 from students s where s.id = e.student_id and s.team_id = p_team and not s.team_off
                                  and lu_diag_ready(s.id))) then                               -- [70번 #10]
    select s.id into v_duty from students s
     where s.team_id = p_team and not s.team_off and lu_diag_ready(s.id)                        -- [70번 #10]
     order by (select count(*) from team_explainers x where x.team_id = p_team and x.student_id = s.id and x.week_start < p_week),
              (select max(x.week_start) from team_explainers x where x.team_id = p_team and x.student_id = s.id and x.week_start < p_week) nulls first,
              s.created_at, s.id
     limit 1;
    update team_explainers set student_id = v_duty where team_id = p_team and week_start = p_week;
  end if;

  if e.body is null then
    for i in 0 .. 1 loop   -- 0 = 이번 주, 1 = 지난주
      select x.qid into v_q from (
        select f.question_id as qid, count(*) as n,
               count(*) filter (where coalesce(array_length(f.submits, 1), 0) = 0 or f.submits[1] <> k.answer_index) as wrong
        from (select distinct on (a.student_id, a.question_id) a.student_id, a.question_id, a.submits
                from attempts a join students s on s.id = a.student_id
               where s.team_id = p_team and a.day >= p_week - 7 * i and a.day < p_week - 7 * i + 7
               order by a.student_id, a.question_id, a.created_at, a.id) f
        join questions q on q.id = f.question_id and q.pool = 'practice'
        join question_keys k on k.question_id = f.question_id
        group by f.question_id) x
      where x.wrong > 0
      order by x.wrong desc, x.wrong::float / x.n desc, x.n desc, x.qid
      limit 1;
      exit when v_q is not null;
    end loop;
    update team_explainers set question_id = v_q where team_id = p_team and week_start = p_week;
  end if;

  select * into e from team_explainers where team_id = p_team and week_start = p_week;
  return e;
end $$;

-- 우리 팀 해설 당번 카드: 진단 10문항 전이면 needDiag 만 (당번·문항·해설 글 없음) (60번 본문 + 한 덩어리)
create or replace function my_team_explainer() returns json
language plpgsql security definer set search_path = public as $$
declare me students := lu_me(); v_week date := lu_week_start(lu_today()); e team_explainers; q questions; v_nick text;
begin
  if me.team_id is null or not exists (select 1 from teams where id = me.team_id) then
    return json_build_object('inTeam', false, 'weekStart', v_week);
  end if;
  if not lu_diag_ready(me.id) then                                                               -- [70번 #10]
    return json_build_object('inTeam', true, 'weekStart', v_week, 'needDiag', true);
  end if;
  e := lu_explainer_pick(me.team_id, v_week);
  select coalesce(nickname, '(별명 정하기 전)') into v_nick from students where id = e.student_id;
  select * into q from questions where id = e.question_id;
  return json_build_object(
    'inTeam', true,
    'weekStart', v_week,
    'maxChars', 200,
    'hasDuty', e.student_id is not null,
    'dutyNickname', v_nick,
    'iAmDuty', e.student_id is not null and e.student_id = me.id,
    'item', case when q.id is null then null else json_build_object(
              'qid', q.id, 'lecture', q.lecture, 'question', q.question, 'sourceSection', q.source_section) end,
    'body', e.body,
    'writtenAt', e.written_at);
end $$;

-- 해설 쓰기: 진단 10문항 전이면 NEED_DIAG (60번 본문 + 한 줄)
create or replace function write_team_explainer(p_qid text, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare me students := lu_me(); v_week date := lu_week_start(lu_today()); e team_explainers;
        v_body text := btrim(replace(coalesce(p_body, ''), E'\r', ''));
begin
  if me.team_id is null then raise exception 'NO_TEAM'; end if;
  if not lu_diag_ready(me.id) then raise exception 'NEED_DIAG'; end if;                         -- [70번 #10]
  select * into e from team_explainers where team_id = me.team_id and week_start = v_week for update;
  if not found or e.student_id is distinct from me.id or me.team_off then raise exception 'NOT_DUTY'; end if;
  if e.question_id is null then raise exception 'NO_ITEM'; end if;
  if p_qid is distinct from e.question_id then raise exception 'ITEM_CHANGED'; end if;
  if char_length(v_body) < 10 then raise exception 'TOO_SHORT'; end if;
  if char_length(v_body) > 200 then raise exception 'TOO_LONG'; end if;
  if v_body ~ '[^[:space:]@]+@[^[:space:]@]+\.[A-Za-z]{2,}' or v_body ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}' then
    raise exception 'PRIVATE_INFO';
  end if;
  update team_explainers set body = v_body, written_at = now() where team_id = me.team_id and week_start = v_week;
  return my_team_explainer();
end $$;

-- ---------------------------------------------------------------------
-- 10. 실행 권한 — 새 도우미 2개는 아무도 직접 못 부름. 다시 만든 함수는 원래 권한 그대로(create or replace 는 권한을 지키지만,
--     처음 만드는 DB를 위해 한 번 더 적음)
-- ---------------------------------------------------------------------
revoke execute on function lu_diag_ready(uuid), lu_kst_now() from public, anon, authenticated;
revoke execute on function
  set_nickname(text), diag_answer(text, int), close_item(text, text, int, int[]),
  weekly_check_status(), weekly_check_items(), weekly_check_submit(jsonb),
  my_team_explainer(), write_team_explainer(text, text), lu_explainer_pick(uuid, date),
  tutor_begin(uuid, text, int, int[])
  from public, anon;
grant execute on function
  set_nickname(text), diag_answer(text, int), close_item(text, text, int, int[]),
  weekly_check_status(), weekly_check_items(), weekly_check_submit(jsonb),
  my_team_explainer(), write_team_explainer(text, text)
  to authenticated;
revoke execute on function lu_explainer_pick(uuid, date), tutor_begin(uuid, text, int, int[]) from authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function tutor_begin(uuid, text, int, int[]) to service_role';
  end if;
end $$;

-- 점검 (적용 후 비서실장):
--   select has_column_privilege('authenticated', 'questions', 'b', 'select');          -- false
--   select has_column_privilege('authenticated', 'questions', 'question', 'select');   -- true
--   select has_function_privilege('authenticated', 'lu_diag_ready(uuid)', 'execute');   -- false
--   select has_function_privilege('authenticated', 'tutor_begin(uuid,text,int,int[])', 'execute');   -- false
--   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;    -- 0줄
