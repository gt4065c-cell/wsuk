-- =====================================================================
-- 레벨업 캠퍼스 2단계 M1 — Supabase 표(테이블)·보안 규칙(RLS)·서버 함수 초안
--
-- 상태: 초안 (2026-11-02, 앱 개발자). 실제 Supabase에서 아직 실행해 보지 않았습니다(미검증).
--       캡틴 계정 연결 때 비서실장·개발자가 함께 SQL 편집기에서 실행하며 고칩니다.
--
-- 원칙 (PRD 4장 "위험 크기만큼만"):
--   1. 모든 표에 RLS(줄 단위 출입 규칙)를 켭니다. "RLS 꺼진 표 0개".
--   2. 학생은 자기 줄만 읽습니다. 쓰기는 전부 아래 서버 함수(RPC)로만 — 표에 직접 쓰기 권한 없음.
--   3. 진단·평가 문항의 정답은 학생 화면으로 내려가지 않습니다(question_keys는 연습 문항만 읽기 허용).
--   4. 저장하는 개인 정보는 "참가자 코드 + 별명"뿐. 실명·학번·연락처 칸 없음.
--   5. 이 파일에는 비밀 열쇠가 없습니다. service_role 키는 어떤 화면 파일에도 넣지 않습니다.
--
-- 로그인 방식: Supabase "익명 로그인(Anonymous sign-in)"으로 기기마다 임시 계정을 만들고,
--   claim_code('ABC234')로 그 기기를 학생 코드에 연결합니다. 휴대폰·노트북이 같은 코드를 쓰면
--   student_devices에 두 줄이 생기고 기록은 하나로 합쳐집니다(PRD F1).
--
-- 규칙 숫자는 public/js/logic.js 와 같아야 합니다(Elo·경험치·복습 상자). 바꿀 때는 둘 다 고칩니다.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------

-- 앱 설정 (한 줄짜리): 교수님이 열어 둔 강의 번호
create table if not exists app_settings (
  id          int primary key default 1 check (id = 1),
  open_up_to  int not null default 15
);
insert into app_settings (id) values (1) on conflict do nothing;

-- 학생: 코드 + 별명 + 숨은 실력값 θ + 경험치
create table if not exists students (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),   -- 0·O·1·I 제외 6자리
  cohort      text not null default '2027-1',
  nickname    text check (char_length(nickname) between 2 and 12),
  theta       double precision not null default 0 check (theta between -3 and 3),
  n_answers   int not null default 0,         -- Elo에 반영된 답 수 (K값 계산용)
  xp          int not null default 0 check (xp >= 0),
  diag_done   boolean not null default false,
  team_id     uuid,                           -- M2 (팀)
  team_off    boolean not null default false, -- M2
  created_at  timestamptz not null default now()
);

-- 기기 ↔ 학생 연결 (익명 로그인 계정 1개 = 기기 1대)
create table if not exists student_devices (
  auth_uid    uuid primary key references auth.users(id) on delete cascade,
  student_id  uuid not null references students(id) on delete cascade,
  linked_at   timestamptz not null default now()
);

-- 코드 입력 시도 기록 (무작위 코드 대입 막기: 10분에 10번)
create table if not exists code_attempts (
  id        bigserial primary key,
  auth_uid  uuid not null,
  tried_at  timestamptz not null default now()
);

-- 문항 (정답·해설은 question_keys에 따로)
create table if not exists questions (
  id             text primary key,             -- 예: L01-Q1
  part           int not null,
  lecture        int not null,
  difficulty     int not null check (difficulty between 0 and 3),   -- 0 = 아주 쉬운 확인 문항
  type           text not null check (type in ('mcq', 'ox')),
  question       text not null,
  choices        jsonb not null,
  source_section text,
  pool           text not null check (pool in ('practice', 'diagnostic', 'assessment')),
  diag_order     int,                          -- 진단 12문항 순서 (모두 같은 순서)
  b              double precision not null,    -- 난이도: 0→-2, 1→-1, 2→0, 3→+1 로 시작
  n_resp         int not null default 0        -- 응답 수(학습자별 첫 응답만). 10개 전까지 b 고정
);

-- 정답·해설 (연습 문항만 학생이 읽을 수 있음. 진단·평가는 서버 함수만)
create table if not exists question_keys (
  question_id         text primary key references questions(id) on delete cascade,
  answer_index        int not null,
  explanation         text,
  common_wrong_index  int,
  common_wrong_reason text
);

-- 미리 만든 힌트 L1~L3 (교수 검토 끝난 것만 학생에게 보임)
create table if not exists hints (
  question_id  text primary key references questions(id) on delete cascade,
  l1 text not null, l2 text not null, l3 text not null,
  hint_status  text not null default 'draft' check (hint_status in ('draft', 'reviewed'))
);

-- 진단 답
create table if not exists diag_answers (
  student_id  uuid not null references students(id) on delete cascade,
  question_id text not null references questions(id),
  choice      int,                             -- null = "아직 모르겠어요"
  created_at  timestamptz not null default now(),
  primary key (student_id, question_id)
);

-- 풀이 기록 (문항 마감 1번 = 1줄)
create table if not exists attempts (
  id          bigserial primary key,
  student_id  uuid not null references students(id) on delete cascade,
  question_id text not null references questions(id),
  mode        text not null check (mode in ('PRACTICE', 'REVIEW', 'EVAL')),
  outcome     text not null check (outcome in ('혼자 맞힘', '힌트로 해결', '두 번째에 맞힘', '정답 보고 이해', '응시')),
  hint_level  int not null default 0 check (hint_level between 0 and 4),
  submits     int[] not null default '{}',
  xp          int not null default 0,
  day         date not null,                   -- 한국 날짜
  created_at  timestamptz not null default now()
);
create index if not exists attempts_student_day on attempts (student_id, day);

-- 복습 상자 (1·3·7·14일)
create table if not exists review_box (
  student_id  uuid not null references students(id) on delete cascade,
  question_id text not null references questions(id),
  box         int not null check (box between 1 and 4),
  due         date not null,
  primary key (student_id, question_id)
);

-- 교수 계정 (M2 교수 화면). 이메일 1개, 서버 함수만 읽음
create table if not exists admins (
  email text primary key
);

-- ---------------------------------------------------------------------
-- 2. RLS 켜기 + 읽기 규칙 (쓰기 규칙은 일부러 만들지 않음 → 직접 쓰기 전부 거절)
-- ---------------------------------------------------------------------
alter table app_settings    enable row level security;
alter table students        enable row level security;
alter table student_devices enable row level security;
alter table code_attempts   enable row level security;
alter table questions       enable row level security;
alter table question_keys   enable row level security;
alter table hints           enable row level security;
alter table diag_answers    enable row level security;
alter table attempts        enable row level security;
alter table review_box      enable row level security;
alter table admins          enable row level security;

-- 지금 로그인한 기기의 학생 번호
create or replace function my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select student_id from student_devices where auth_uid = auth.uid()
$$;

revoke all on all tables in schema public from anon, authenticated;
grant select on app_settings, students, student_devices, questions, question_keys, hints,
               diag_answers, attempts, review_box to authenticated;

create policy settings_read  on app_settings    for select to authenticated using (true);
create policy students_self  on students        for select to authenticated using (id = my_student_id());
create policy devices_self   on student_devices for select to authenticated using (auth_uid = auth.uid());
create policy questions_read on questions       for select to authenticated using (pool in ('practice', 'diagnostic'));
create policy keys_practice  on question_keys   for select to authenticated
  using (exists (select 1 from questions q where q.id = question_id and q.pool = 'practice'));
create policy hints_reviewed on hints           for select to authenticated
  using (hint_status = 'reviewed' and exists (select 1 from questions q where q.id = question_id and q.pool = 'practice'));
create policy diag_self      on diag_answers    for select to authenticated using (student_id = my_student_id());
create policy attempts_self  on attempts        for select to authenticated using (student_id = my_student_id());
create policy review_self    on review_box      for select to authenticated using (student_id = my_student_id());
-- code_attempts, admins: 규칙 없음 = 학생은 읽기·쓰기 모두 불가

-- ---------------------------------------------------------------------
-- 3. 계산 도우미 (logic.js 와 같은 공식)
-- ---------------------------------------------------------------------
create or replace function lu_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;
create or replace function lu_p(theta double precision, b double precision, c double precision)
returns double precision language sql immutable as $$
  select c + (1 - c) / (1 + exp(-(theta - b)))
$$;
create or replace function lu_k(n int) returns double precision language sql immutable as $$
  select 0.8 / (1 + 0.05 * n)
$$;
create or replace function lu_clamp(x double precision, lo double precision, hi double precision)
returns double precision language sql immutable as $$
  select greatest(lo, least(hi, x))
$$;
create or replace function lu_me() returns students
language plpgsql stable security definer set search_path = public as $$
declare s students;
begin
  select * into s from students where id = my_student_id();
  if not found then raise exception 'NOT_LINKED' using hint = '코드를 먼저 입력해야 해요'; end if;
  return s;
end $$;

-- ---------------------------------------------------------------------
-- 4. 서버 함수 (store.js 의 Supabase 모드가 부르는 것)
-- ---------------------------------------------------------------------

-- F1 코드 입력 → 이 기기를 학생에 연결
create or replace function claim_code(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare s students; v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if auth.uid() is null then raise exception 'NO_AUTH'; end if;
  if (select count(*) from code_attempts where auth_uid = auth.uid() and tried_at > now() - interval '10 minutes') >= 10 then
    return json_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into code_attempts (auth_uid) values (auth.uid());
  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then return json_build_object('ok', false, 'error', 'shape'); end if;
  select * into s from students where code = v_code;
  if not found then return json_build_object('ok', false, 'error', 'unknown'); end if;
  insert into student_devices (auth_uid, student_id) values (auth.uid(), s.id)
    on conflict (auth_uid) do update set student_id = excluded.student_id, linked_at = now();
  return json_build_object('ok', true, 'student', json_build_object(
    'code', s.code, 'nickname', coalesce(s.nickname, ''), 'xp', s.xp, 'diagDone', s.diag_done,
    'diagAnswered', (select count(*) from diag_answers where student_id = s.id)));   -- θ는 돌려주지 않음
end $$;

create or replace function set_nickname(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update students set nickname = left(trim(p_name), 12) where id = (lu_me()).id;
end $$;

-- 진단 답 저장 (정오답은 알려 주지 않음)
create or replace function diag_answer(p_qid text, p_choice int) returns int
language plpgsql security definer set search_path = public as $$
declare me students := lu_me();
begin
  if me.diag_done then return (select count(*) from diag_answers where student_id = me.id); end if;
  if not exists (select 1 from questions where id = p_qid and pool = 'diagnostic') then raise exception 'NOT_DIAG'; end if;
  insert into diag_answers (student_id, question_id, choice) values (me.id, p_qid, p_choice) on conflict do nothing;
  return (select count(*) from diag_answers where student_id = me.id);
end $$;

-- 진단 끝내기: 서버가 채점, θ 계산, 해설 돌려줌 (10문항 이상)
create or replace function diag_finish() returns json
language plpgsql security definer set search_path = public as $$
declare
  me students := lu_me(); r record; v_theta double precision := 0; v_n int := 0;
  v_p double precision; v_r double precision; v_review json; v_strong json; v_weak json;
begin
  if (select count(*) from diag_answers where student_id = me.id) < 10 then raise exception 'DIAG_TOO_FEW'; end if;
  for r in
    select q.difficulty, q.b, jsonb_array_length(q.choices) as nc, d.choice, k.answer_index
    from diag_answers d join questions q on q.id = d.question_id join question_keys k on k.question_id = q.id
    where d.student_id = me.id order by q.diag_order
  loop
    v_r := case when r.choice is not null and r.choice = r.answer_index then 1 else 0 end;
    v_p := lu_p(v_theta, case r.difficulty when 1 then -1 when 2 then 0 else 1 end, 1.0 / r.nc);
    v_theta := lu_clamp(v_theta + lu_k(v_n) * (v_r - v_p), -3, 3);
    v_n := v_n + 1;
  end loop;
  if not me.diag_done then
    update students set theta = v_theta, n_answers = v_n, diag_done = true where id = me.id;
  end if;
  select json_agg(x.lecture) into v_strong from (
    select q.lecture from diag_answers d join questions q on q.id = d.question_id join question_keys k on k.question_id = q.id
    where d.student_id = me.id and d.choice = k.answer_index order by q.difficulty desc, q.lecture limit 2) x;
  select json_agg(x.lecture) into v_weak from (
    select q.lecture from diag_answers d join questions q on q.id = d.question_id join question_keys k on k.question_id = q.id
    where d.student_id = me.id and (d.choice is null or d.choice <> k.answer_index) order by q.difficulty, q.lecture limit 2) x;
  select json_agg(json_build_object('qid', q.id, 'yourChoice', d.choice, 'answer_index', k.answer_index,
                                    'explanation', k.explanation, 'common_wrong_reason', k.common_wrong_reason) order by q.diag_order)
    into v_review
    from diag_answers d join questions q on q.id = d.question_id join question_keys k on k.question_id = q.id
    where d.student_id = me.id;
  return json_build_object('strong', coalesce(v_strong, '[]'), 'weak', coalesce(v_weak, '[]'), 'review', v_review);
end $$;

-- F3 다음 연습 문제 (E1~E5). p_recent = [{"lecture":3,"R":0}, ...] 이번 판 최근 결과, p_exclude = 이번 판에 낸 문항
create or replace function next_practice(p_recent jsonb default '[]', p_exclude text[] default '{}') returns json
language plpgsql security definer set search_path = public as $$
declare
  me students := lu_me(); v_today date := lu_today(); n int := jsonb_array_length(coalesce(p_recent, '[]'));
  v_avoid int := null; v_pick record; v_e4 boolean := false;
begin
  if n >= 2 and (p_recent -> (n - 1) ->> 'R')::float = 0 and (p_recent -> (n - 2) ->> 'R')::float = 0 then v_e4 := true; end if;
  if n >= 3 and (p_recent -> (n - 1) ->> 'lecture') = (p_recent -> (n - 2) ->> 'lecture')
            and (p_recent -> (n - 2) ->> 'lecture') = (p_recent -> (n - 3) ->> 'lecture') then
    v_avoid := (p_recent -> (n - 1) ->> 'lecture')::int;
  end if;
  with cand as (
    select q.id, q.lecture,
           lu_p(me.theta, q.b, 1.0 / jsonb_array_length(q.choices)) as p,
           not exists (select 1 from attempts a where a.student_id = me.id and a.question_id = q.id) as unseen
    from questions q
    where q.pool = 'practice'
      and q.lecture <= (select open_up_to from app_settings where id = 1)
      and not (q.id = any (coalesce(p_exclude, '{}')))
      and not exists (select 1 from review_box rb where rb.student_id = me.id and rb.question_id = q.id)
      and not exists (select 1 from attempts a where a.student_id = me.id and a.question_id = q.id and a.day > v_today - 7)
  ), c2 as (   -- E5: 다른 강이 있으면 같은 강 4연속 피하기
    select * from cand where v_avoid is null or lecture <> v_avoid
      or not exists (select 1 from cand where lecture <> v_avoid)
  )
  select id, p into v_pick from c2
  order by
    case when v_e4 then -p end,                                                -- E4: 가장 쉬운 문항
    case when p between 0.75 and 0.90 then 0 else 1 end,                       -- E2: 구간 안 우선
    case when p between 0.75 and 0.90 and unseen then 0 else 1 end,            --     그중 안 푼 문항
    case when p between 0.75 and 0.90 then random() else abs(p - 0.82) end     --     무작위 / E3: 0.82에 가까운 순
  limit 1;
  if v_pick.id is null then return null; end if;
  return json_build_object('qid', v_pick.id, 'conceptCard', v_e4);   -- P값은 돌려주지 않음
end $$;

-- F4·F6 문항 마감: 서버가 채점·결과 이름·경험치·Elo·복습 상자를 계산
create or replace function close_item(p_qid text, p_mode text, p_level int, p_submits int[]) returns json
language plpgsql security definer set search_path = public as $$
declare
  me students := lu_me(); q questions; k question_keys; v_today date := lu_today();
  ns int := coalesce(array_length(p_submits, 1), 0); v_max int; v_last_ok boolean; v_outcome text;
  v_r double precision; v_p double precision; v_xp int; v_xp_today int; v_first boolean; rb review_box; v_note text;
begin
  if p_mode not in ('PRACTICE', 'REVIEW') then raise exception 'BAD_MODE'; end if;
  select * into q from questions where id = p_qid and pool = 'practice';
  if not found then raise exception 'PRACTICE_ONLY'; end if;
  select * into k from question_keys where question_id = p_qid;
  v_max := case when q.type = 'ox' then 1 else 2 end;
  if ns > v_max or p_level not between 0 and 4 then raise exception 'BAD_SUBMITS'; end if;
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
    update students set theta = lu_clamp(theta + lu_k(n_answers) * (v_r - v_p), -3, 3), n_answers = n_answers + 1
      where id = me.id;
    if v_first then
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

-- 홈 화면 숫자. 연속 학습일은 counts(날짜별 마감 수)를 받아 화면의 logic.js streak()가 계산
create or replace function today_summary() returns json
language plpgsql security definer set search_path = public as $$
declare me students := lu_me(); v_today date := lu_today(); v_week date := date_trunc('week', lu_today())::date;
begin
  return json_build_object(
    'day', v_today,
    'reviews', coalesce((select json_agg(question_id) from (
        select question_id from (
          select rb.question_id, rb.due, row_number() over (partition by q.lecture order by rb.due, rb.question_id) as rn
          from review_box rb join questions q on q.id = rb.question_id
          where rb.student_id = me.id and rb.due <= v_today) z
        where rn <= 2 order by due, question_id limit 5) y), '[]'),
    'newDone', (select count(*) from attempts where student_id = me.id and day = v_today and mode = 'PRACTICE'),
    'newTarget', 5,
    'xp', me.xp,
    'xpToday', (select coalesce(sum(xp), 0) from attempts where student_id = me.id and day = v_today),
    'weekXp', (select coalesce(sum(xp), 0) from attempts where student_id = me.id and day >= v_week),
    'weekSolved', (select count(*) from attempts where student_id = me.id and day >= v_week),
    'counts', coalesce((select json_object_agg(day, c) from (
        select day, count(*) as c from attempts where student_id = me.id group by day) d), '{}')
  );
end $$;

-- 함수 실행 권한: 로그인한 기기(익명 포함)만
revoke execute on all functions in schema public from public, anon;
grant execute on function my_student_id(), claim_code(text), set_nickname(text), diag_answer(text, int),
  diag_finish(), next_practice(jsonb, text[]), close_item(text, text, int, int[]), today_summary()
  to authenticated;

-- ---------------------------------------------------------------------
-- 5. 교수님(캡틴)용 — SQL 편집기에서만 실행 (학생은 실행 불가)
-- ---------------------------------------------------------------------
-- 코드 카드 n장 만들기: select * from admin_make_codes(30, '2027-1');
-- 결과(코드 목록)는 교수님 개인 노트에만 옮기고, 저장소·채팅·외부 AI에 붙여 넣지 않습니다.
create or replace function admin_make_codes(p_n int, p_cohort text) returns setof text
language plpgsql security definer set search_path = public as $$
declare chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v text; i int := 0;
begin
  while i < p_n loop
    v := '';
    for j in 1 .. 6 loop
      v := v || substr(chars, 1 + (get_byte(gen_random_bytes(1), 0) % 32), 1);   -- 256은 32로 나눠떨어져 치우침 없음
    end loop;
    begin
      insert into students (code, cohort) values (v, p_cohort);
      i := i + 1; return next v;
    exception when unique_violation then null;   -- 겹치면 다시
    end;
  end loop;
end $$;
revoke execute on function admin_make_codes(int, text) from public, anon, authenticated;

-- 문항 넣기는 tools/ 의 가져오기 작업(다음 단계)으로: questions + question_keys + hints
-- 점검: RLS 꺼진 표가 0개인지
--   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;
