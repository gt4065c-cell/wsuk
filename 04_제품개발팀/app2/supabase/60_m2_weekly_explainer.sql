-- =====================================================================
-- 레벨업 캠퍼스 2단계 M2 3차 — 주간 팀 공통 점검(주 1회, 같은 기수 공통 8문항) + 팀 해설 당번 + 교수 화면용 함수
--
-- 상태: ⏳ 실DB 미적용 (2026-11-03 앱 개발자 작성). 적용은 비서실장이 합니다.
-- 실행 순서: schema.sql → 30_m2_teams_admin.sql → 40_ox_fix.sql → 50_ai_tutor.sql → 이 파일
--           여러 번 실행해도 안전하게 썼습니다(add column if not exists / create if not exists / create or replace).
-- 내 컴퓨터 시험: supabase/local_test/run_weekly_local.sh (임시 PostgreSQL, 진짜 DB 아님)
--
-- 근거(바꾸지 않음)
--   00_캡틴/결재함/2026-11-02_2단계_결재2_설계확정.md ⑤ "주간 팀 점검 개인 점수 = 본인에게도 숨김 — '응시 완료'와 다시 볼 개념만"
--   03_교육기획팀/2026-11-02_2단계_팀게임_설계.md 2-3(공통 점검: 혼자·힌트/AI 꺼짐·1번만) · 2-4(해설 당번: 돌아가며, 연습 문항만) · 2-5(공개 범위)
--   03_교육기획팀/문항은행/questions_weekly.json (64개 = 8주 × 8, pool = assessment, id = W{주}-Q{번호})
--
-- 지키는 원칙 (schema.sql·30번과 같음)
--   1. 새 표 3개(weekly_checks · weekly_answers · team_explainers)는 RLS 를 켜고 학생·익명 권한 0. 서버 함수만 읽고 씀.
--   2. 공통 점검 문항(assessment)은 학생이 표로 읽을 수 없음(schema.sql questions_read 규칙 그대로).
--      weekly_check_items() 가 "이번 주 8문항의 글·보기만" 돌려줌 — 정답·해설·출처 칸 없음.
--   3. 채점은 서버가. 점수(맞힌 수)는 학생 본인에게도 돌려주지 않음 → "응시 완료" + 다시 볼 강 번호만.
--   4. 교수 화면의 문항별 정답률은 응시 3명 이상일 때만 숫자를 보여 줌(한 학생 답이 드러나지 않게).
--   5. 해설 당번 글은 같은 팀 안에서만 돌려줌. 다른 팀·반 전체·교수 화면 어디에도 글을 돌려주지 않음.
--      해설 문항은 연습(practice) 문항만 — 공통 점검 문항은 쓰지 않음(평가 문항 보호, 설계 2-4).
--   6. 새 함수는 public·anon 에서 실행 권한을 모두 걷고, 필요한 것만 authenticated 에 허용.
--      내부 도우미(lu_check_week · lu_explainer_pick)는 authenticated 에서도 걷음.
--   7. 기존 함수(next_practice · close_item · my_team_summary · tutor_* 등)는 하나도 다시 만들지 않음.
--
-- 이름과 실제 의미 (교훈노트 2026-11-02)
--   "응시 완료"     = 이번 주 공통 점검 8문항을 제출함 (점수와 무관)
--   "다시 볼 개념"  = 이번 점검에서 틀렸거나 "아직 모르겠어요"를 고른 문항의 강 번호 (점수가 아님)
--   이 파일은 설계의 "학습목표 달성"(개인 0/10/20 → 팀 평균 ≥ 15)을 아직 계산하지 않습니다.
--   그 계산에는 1주차 기준점수가 필요해 다음 차수로 미뤘고, 맞힌 수는 weekly_checks.n_correct 에 저장만 해 둡니다.
--
-- 주 번호 (공통 점검)
--   app_settings.cohort_start (기수 시작 월요일) 기준: 1주차 = cohort_start ~ +6일, 2주차 = +7 ~ +13일 …
--   cohort_start 가 비어 있으면(null, 기본값) 공통 점검은 꺼져 있음 → 학생 홈에 카드가 안 보임.
--   월요일만 넣을 수 있게 막아 두었음 → 팀 주(월~일, 30번 파일)와 점검 주가 늘 같은 7일.
--   켜기 (교수님/비서실장, SQL Editor):  update app_settings set cohort_start = '2027-03-01' where id = 1;   -- 월요일
--   끄기:                                update app_settings set cohort_start = null where id = 1;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 칸 추가
-- ---------------------------------------------------------------------
-- 기수 시작일(월요일). null = 공통 점검 꺼짐
alter table app_settings
  add column if not exists cohort_start date check (cohort_start is null or extract(isodow from cohort_start) = 1);

-- 공통 점검 문항의 주 번호 (seed.json 에는 week 칸이 없어서 문항 번호 규칙 W{주}-Q{번호}로 채움)
alter table questions
  add column if not exists week int check (week is null or week between 1 and 30);

-- 주 번호 채우기 (원본 questions_weekly.json 의 week 와 같음: W1-Q1 ~ W8-Q8). 여러 번 실행해도 같은 결과
update questions
   set week = substring(id from '^W([0-9]+)-Q[0-9]+$')::int
 where pool = 'assessment'
   and id ~ '^W[0-9]+-Q[0-9]+$'
   and week is distinct from substring(id from '^W([0-9]+)-Q[0-9]+$')::int;
create index if not exists questions_week_idx on questions (week) where week is not null;

-- ---------------------------------------------------------------------
-- 2. 표 (모두 RLS 켬, 학생 권한 0)
-- ---------------------------------------------------------------------
-- 공통 점검 응시 (1명 · 1주 = 1줄 → 같은 주 다시 응시 불가)
create table if not exists weekly_checks (
  student_id  uuid not null references students(id) on delete cascade,
  week        int  not null check (week between 1 and 30),
  cohort      text not null,
  n_items     int  not null check (n_items between 1 and 20),
  n_correct   int  not null check (n_correct >= 0),     -- 교수·다음 차수 계산용. 학생에게는 돌려주지 않음
  created_at  timestamptz not null default now(),
  primary key (student_id, week)
);

-- 공통 점검 문항별 답 (교수 화면 문항별 정답률용)
create table if not exists weekly_answers (
  student_id  uuid not null references students(id) on delete cascade,
  question_id text not null references questions(id) on delete cascade,
  week        int  not null,
  choice      int,                                      -- null = "아직 모르겠어요"
  correct     boolean not null,
  created_at  timestamptz not null default now(),
  primary key (student_id, question_id)
);
create index if not exists weekly_answers_q on weekly_answers (question_id);

-- 팀 해설 당번 (1팀 · 1주(월요일) = 1줄)
create table if not exists team_explainers (
  team_id     uuid not null references teams(id) on delete cascade,
  week_start  date not null,                            -- 그 주 월요일 (팀 참여 목표와 같은 주)
  student_id  uuid references students(id) on delete set null,   -- 당번
  question_id text references questions(id) on delete set null, -- 팀이 많이 틀린 연습 문항
  body        text check (body is null or char_length(body) between 1 and 200),
  written_at  timestamptz,
  created_at  timestamptz not null default now(),
  primary key (team_id, week_start)
);

alter table weekly_checks   enable row level security;
alter table weekly_answers  enable row level security;
alter table team_explainers enable row level security;
-- 규칙(policy)을 일부러 만들지 않음 = 학생·익명은 읽기·쓰기 모두 불가
revoke all on weekly_checks, weekly_answers, team_explainers from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. 내부 도우미 (학생·교수 화면에서 직접 부를 수 없음 — 7장에서 revoke)
-- ---------------------------------------------------------------------
-- 오늘이 공통 점검 몇 주차인지. cohort_start 가 없거나 아직 시작 전이면 null
create or replace function lu_check_week() returns int
language sql stable security definer set search_path = public as $$
  select case when s.cohort_start is null or lu_today() < s.cohort_start then null
              else ((lu_today() - s.cohort_start) / 7 + 1)::int end
  from app_settings s where s.id = 1
$$;

-- 이번 주 해설 당번 줄을 만들거나(처음 부를 때) 고쳐서 돌려줌
--   당번: 아직 안 썼는데 당번이 없거나 · 팀 활동 쉼 · 다른 팀으로 옮김 → 다시 고름
--         고르는 순서 = 이 팀에서 지금까지 당번 횟수가 적은 사람 → 마지막 당번이 오래된 사람(안 해 본 사람 먼저) → 들어온 순서
--         → 돌아가며 모두 같은 횟수 (설계 2-4 "앱이 순서를 정해 돌림"). 팀 활동 쉼 팀원은 빼고 고름
--   문항: 아직 안 썼으면 부를 때마다 새로 고름(이번 주 기록이 쌓이면 바뀔 수 있음), 글을 올리면 고정
--         이번 주 팀원들의 연습 기록에서 "처음 낸 답이 틀린" 횟수가 가장 많은 연습 문항
--         (같으면 오답률 → 응답 수 → 번호 순). 이번 주에 틀린 문항이 아직 없으면 지난주 기록에서
create or replace function lu_explainer_pick(p_team uuid, p_week date) returns team_explainers
language plpgsql security definer set search_path = public as $$
declare e team_explainers; v_duty uuid; v_q text;
begin
  insert into team_explainers (team_id, week_start) values (p_team, p_week) on conflict do nothing;
  select * into e from team_explainers where team_id = p_team and week_start = p_week for update;

  if e.body is null and (e.student_id is null or not exists (
       select 1 from students s where s.id = e.student_id and s.team_id = p_team and not s.team_off)) then
    select s.id into v_duty from students s
     where s.team_id = p_team and not s.team_off
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

-- ---------------------------------------------------------------------
-- 4. 학생용 — 주간 공통 점검
-- ---------------------------------------------------------------------
-- 홈 카드: 이번 주 점검이 열렸는지 · 내가 응시했는지 · (응시했으면) 다시 볼 강 번호 · 팀원 n/m명 응시
--   reason: OFF(cohort_start 없음) · NOT_STARTED(시작 전) · ENDED(마지막 주 지남) · NO_ITEMS(그 주 문항 없음) · null(열림)
--   점수·맞힌 수·문항별 정오답은 돌려주지 않음 (결재2 ⑤)
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

-- 점검 시작: 이번 주 문항의 글·보기만 (정답·해설·출처 없음). 이미 응시했으면 WEEKLY_DONE
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
  return json_build_object(
    'week', v_week,
    'items', (select json_agg(json_build_object('id', q.id, 'lecture', q.lecture, 'type', q.type,
                                                'question', q.question, 'choices', q.choices) order by length(q.id), q.id)
                from questions q where q.pool = 'assessment' and q.week = v_week));
end $$;

-- 제출: p_answers = {"W3-Q1": 2, "W3-Q2": null, ...} — 이번 주 문항 모두(빠짐·남는 것 없이). null = "아직 모르겠어요"
--   서버가 채점·저장하고, 돌려주는 것은 "응시 완료" + 다시 볼 강 번호뿐. 같은 주 두 번째 제출은 WEEKLY_DONE
create or replace function weekly_check_submit(p_answers jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  me students := lu_me(); v_week int := lu_check_week(); r record; v_choice int; v_ok boolean;
  v_n int := 0; v_correct int := 0; v_review json;
begin
  if v_week is null or not exists (select 1 from questions where pool = 'assessment' and week = v_week) then
    raise exception 'WEEKLY_CLOSED';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'BAD_ANSWERS'; end if;
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
-- 5. 학생용 — 팀 해설 당번
-- ---------------------------------------------------------------------
-- 우리 팀 이번 주 해설 당번: 당번 별명 · 내가 당번인지 · 문항(연습) · 올라온 해설
--   같은 팀 팀원에게만. 팀이 없으면 inTeam=false 만. 다른 팀의 당번·해설은 어떤 함수도 돌려주지 않음
--   (부를 때 이번 주 줄을 만들거나 당번·문항을 고치므로 stable 이 아님)
create or replace function my_team_explainer() returns json
language plpgsql security definer set search_path = public as $$
declare me students := lu_me(); v_week date := lu_week_start(lu_today()); e team_explainers; q questions; v_nick text;
begin
  if me.team_id is null or not exists (select 1 from teams where id = me.team_id) then
    return json_build_object('inTeam', false, 'weekStart', v_week);
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

-- 당번이 해설 쓰기(또는 고치기). 200자 안, 10자 이상. 이메일·전화번호 모양은 거절(팀원에게 보이는 글이라)
--   p_qid = 화면에 보였던 문항 번호. 그사이 팀 기록이 늘어 문항이 바뀌었으면 ITEM_CHANGED → 화면이 새로 받음
--   쓰지 않아도 벌점·불이익 없음. 경험치는 주지 않음(결재2 경험치 규칙 = 문항 완료 10 · 복습 +5)
create or replace function write_team_explainer(p_qid text, p_body text) returns json
language plpgsql security definer set search_path = public as $$
declare me students := lu_me(); v_week date := lu_week_start(lu_today()); e team_explainers;
        v_body text := btrim(replace(coalesce(p_body, ''), E'\r', ''));
begin
  if me.team_id is null then raise exception 'NO_TEAM'; end if;
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
-- 6. 교수 화면용 (교수만 — lu_is_admin 은 30번 파일)
-- ---------------------------------------------------------------------
-- 공통 점검 문항별 정답률 + 팀별 응시 인원. 응시 3명 미만 문항은 숫자를 비움(null)
--   p_week 없으면 이번 주. 학생 개인 점수·별명·코드는 돌려주지 않음
create or replace function admin_weekly_stats(p_cohort text default null, p_week int default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_week int := coalesce(p_week, lu_check_week()); v_min int := 3;
begin
  if not lu_is_admin() then raise exception 'NOT_ADMIN'; end if;
  return json_build_object(
    'cohort', p_cohort,
    'cohortStart', (select cohort_start from app_settings where id = 1),
    'currentWeek', lu_check_week(),
    'maxWeek', (select max(week) from questions where pool = 'assessment' and week is not null),
    'week', v_week,
    'minN', v_min,
    'takers', (select count(*) from weekly_checks c join students s on s.id = c.student_id
                where c.week = v_week and (p_cohort is null or s.cohort = p_cohort)),
    'items', coalesce((
      select json_agg(json_build_object(
               'qid', q.id, 'lecture', q.lecture, 'question', q.question, 'n', x.n,
               'correctRate', case when x.n >= v_min then round(x.ok::numeric / x.n, 3) end,
               'unknown', case when x.n >= v_min then x.unk end,
               'answerText', q.choices ->> k.answer_index) order by length(q.id), q.id)
        from questions q
        left join question_keys k on k.question_id = q.id
        cross join lateral (
          select count(*)::int as n, count(*) filter (where w.correct)::int as ok, count(*) filter (where w.choice is null)::int as unk
            from weekly_answers w join students s on s.id = w.student_id
           where w.question_id = q.id and w.week = v_week and (p_cohort is null or s.cohort = p_cohort)) x
       where q.pool = 'assessment' and q.week = v_week), '[]'),
    'teams', coalesce((
      select json_agg(json_build_object('name', t.name, 'active', z.active, 'taken', z.taken)
                      order by t.cohort, length(t.name), t.name)
        from teams t cross join lateral (
          select count(*)::int as active,
                 count(*) filter (where exists (select 1 from weekly_checks c where c.student_id = s.id and c.week = v_week))::int as taken
            from students s where s.team_id = t.id and not s.team_off) z
       where p_cohort is null or t.cohort = p_cohort), '[]'));
end $$;

-- ---------------------------------------------------------------------
-- 7. 실행 권한 — Supabase 자동 허용을 모두 걷고 필요한 것만
-- ---------------------------------------------------------------------
revoke execute on function
  lu_check_week(), lu_explainer_pick(uuid, date),
  weekly_check_status(), weekly_check_items(), weekly_check_submit(jsonb),
  my_team_explainer(), write_team_explainer(text, text),
  admin_weekly_stats(text, int)
  from public, anon;
-- 로그인한 기기(학생) · 교수 계정 (교수용은 함수 안에서 교수인지 다시 확인)
grant execute on function
  weekly_check_status(), weekly_check_items(), weekly_check_submit(jsonb),
  my_team_explainer(), write_team_explainer(text, text),
  admin_weekly_stats(text, int)
  to authenticated;
-- 내부 도우미는 로그인한 사람도 못 부름
revoke execute on function lu_check_week(), lu_explainer_pick(uuid, date) from authenticated;

-- 점검 (적용 후 비서실장):
--   select week, count(*) from questions where pool = 'assessment' and week is not null group by 1 order by 1;   -- 1~8주 × 8개
--   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;                              -- 0줄
--   select table_name, grantee from information_schema.role_table_grants
--    where table_name in ('weekly_checks', 'weekly_answers', 'team_explainers') and grantee in ('anon', 'authenticated');   -- 0줄
--   select has_function_privilege('authenticated', 'lu_explainer_pick(uuid,date)', 'execute');                   -- false
-- 공통 점검 켜기(기수 시작 월요일): update app_settings set cohort_start = '2027-03-01' where id = 1;
