-- =====================================================================
-- 레벨업 캠퍼스 2단계 M2 1차 — 팀(같은 기수 3~4인 + 주간 팀 참여 목표) + 교수 화면용 서버 함수
--
-- 상태: ⏳ 실제 Supabase에는 아직 적용 안 함 (비서실장이 MCP로 적용·검증 예정)
-- 실행 순서: schema.sql (적용 완료) → 이 파일. 여러 번 실행해도 안전하게 썼습니다(create if not exists / create or replace).
-- 내 컴퓨터 시험: supabase/local_test/run_m2_local.sh (임시 PostgreSQL, 진짜 DB 아님)
--
-- 지키는 원칙 (schema.sql 과 같음)
--   1. 새 표(teams)도 RLS(줄 단위 출입 규칙)를 켜고, 학생·익명에게 표 권한을 하나도 주지 않습니다.
--   2. 쓰기는 전부 security definer 서버 함수로만. 학생은 자기 팀 요약만 함수로 받습니다.
--   3. 팀원끼리는 "별명 + 팀 활동 쉼 여부"만 보입니다. 팀원 개인의 XP·숨은 실력값 θ·정오답·푼 문항 수는
--      돌려주지 않습니다(팀게임 설계 2-5). 팀 진행은 팀 합계 하나로만.
--   4. 교수 화면 함수는 admins 표에 있는 이메일로 로그인한 교수만(auth.jwt()->>'email', 이메일 확인 끝난 계정,
--      익명 계정 제외). 학생(익명 로그인)이 불러도 NOT_ADMIN 으로 거절.
--   5. Supabase는 새 함수를 anon·authenticated에 자동으로 실행 허용합니다 → 아래 7장에서 모두 명시적으로
--      revoke 한 뒤 필요한 것만 grant 합니다.
--   6. next_practice · close_item 계산은 건드리지 않습니다(맞춤학습 설계자가 따로 고치는 중).
--
-- 이름과 실제 의미 (교훈노트 2026-11-02: 이름 = 실제 의미)
--   이 파일의 팀 목표는 "주간 팀 참여 목표"입니다 = 팀원 모두 이번 주 연습·복습 N문항(기본 15)을 끝까지 풀기.
--   설계 문서의 "학습목표 달성"(주간 공통 점검 점수 평균 ≥ 15)은 공통 점검을 만드는 다음 차수에서 따로 붙입니다.
--   그래서 화면·함수 이름도 "참여 목표 달성"이라고만 씁니다.
--
-- 숫자 규칙 (public/js/logic.js 의 LU.teamWeek 와 같아야 함)
--   - 이번 주 = 한국 날짜 기준 월요일 ~ 일요일
--   - 한 사람의 이번 주 문항 수 = 이번 주에 "경험치를 받은" 마감 기록 수 (xp > 0)
--       → 같은 문항 다시 풀기(XP 0)와 하루 상한(200 XP)을 넘은 풀이는 세지 않음 (몰아 풀기·반복 풀기로 채우기 방지)
--   - 팀 진행 = Σ min(그 사람의 문항 수, 1인 목표)  ← 한 사람이 혼자 다 채울 수 없음
--   - 팀 목표 = 1인 목표 × 활동 중 팀원 수(팀 활동 쉼 제외)  → 진행 ≥ 목표 = "참여 목표 달성" (= 활동 중 팀원 모두 N문항)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------
create table if not exists teams (
  id               uuid primary key default gen_random_uuid(),
  cohort           text not null,
  name             text not null check (char_length(name) between 1 and 20),   -- 예: "7팀" (무작위 번호, 상·중·하 같은 말 금지)
  goal_per_member  int  not null default 15 check (goal_per_member between 1 and 100),
  created_at       timestamptz not null default now(),
  unique (cohort, name)
);

-- students.team_id(이미 있는 칸) → teams 연결. 팀을 지우면 학생은 "팀 없음"으로
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'students_team_fk') then
    alter table students add constraint students_team_fk foreign key (team_id) references teams(id) on delete set null;
  end if;
end $$;
create index if not exists students_team_idx on students (team_id);

alter table teams enable row level security;
-- 규칙(policy)을 일부러 만들지 않음 = 학생은 표를 직접 읽기·쓰기 모두 불가. 서버 함수만 읽음
revoke all on teams from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. 내부 계산 도우미 (학생·교수 화면에서 직접 부를 수 없음 — 7장에서 revoke)
-- ---------------------------------------------------------------------
create or replace function lu_week_start(p_day date) returns date
language sql immutable set search_path = public as $$
  select date_trunc('week', p_day::timestamp)::date   -- 월요일
$$;

-- 한 학생의 그 주 문항 수 (경험치 받은 마감 기록만)
create or replace function lu_week_count(p_student uuid, p_week date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from attempts
  where student_id = p_student and day >= p_week and day < p_week + 7 and xp > 0
$$;

-- 한 팀의 그 주 진행: 활동 중 인원 · 진행(1인 목표에서 자름) · 목표 · 달성 여부
create or replace function lu_team_week(p_team uuid, p_week date)
returns table (active_members int, progress int, goal int, achieved boolean)
language sql stable security definer set search_path = public as $$
  with t as (select goal_per_member as g from teams where id = p_team),
       m as (select least(lu_week_count(s.id, p_week), (select g from t)) as c
             from students s where s.team_id = p_team and not s.team_off)
  select count(*)::int,
         coalesce(sum(c), 0)::int,
         (count(*) * coalesce((select g from t), 0))::int,
         count(*) > 0 and coalesce(sum(c), 0) >= count(*) * coalesce((select g from t), 0)
  from m
$$;

-- 지금 로그인한 사람이 교수인가: admins 표의 이메일 + 이메일 확인 끝난 진짜 계정 + 익명 계정 아님
create or replace function lu_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
     and coalesce(auth.jwt() ->> 'email', '') <> ''
     and exists (select 1 from admins a where lower(a.email) = lower(auth.jwt() ->> 'email'))
     and exists (select 1 from auth.users u
                 where u.id = auth.uid()
                   and lower(u.email) = lower(auth.jwt() ->> 'email')
                   and u.email_confirmed_at is not null)
$$;

-- ---------------------------------------------------------------------
-- 3. 학생용 서버 함수
-- ---------------------------------------------------------------------

-- 홈 화면 팀 카드. 팀원 개인 숫자(XP·θ·정오답·문항 수)는 돌려주지 않음. 내 문항 수(myCount)만 본인에게
create or replace function my_team_summary() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me students := lu_me(); t teams; w record;
  v_week date := lu_week_start(lu_today());
begin
  if me.team_id is null then
    return json_build_object('inTeam', false, 'teamOff', me.team_off, 'weekStart', v_week);
  end if;
  select * into t from teams where id = me.team_id;
  if not found then
    return json_build_object('inTeam', false, 'teamOff', me.team_off, 'weekStart', v_week);
  end if;
  select * into w from lu_team_week(t.id, v_week);
  return json_build_object(
    'inTeam', true,
    'teamOff', me.team_off,
    'name', t.name,
    'weekStart', v_week,
    'goalPerMember', t.goal_per_member,
    'members', (select coalesce(json_agg(json_build_object(
                    'nickname', coalesce(s.nickname, '(별명 정하기 전)'),
                    'me', s.id = me.id,
                    'resting', s.team_off) order by s.nickname nulls last), '[]')
                from students s where s.team_id = t.id),
    'activeMembers', w.active_members,
    'progress', w.progress,
    'goal', w.goal,
    'achieved', w.achieved,
    'myCount', least(lu_week_count(me.id, v_week), t.goal_per_member),
    -- 같은 기수에서 이번 주 참여 목표를 달성한 팀 이름만 (달성 못 한 팀은 이름도 안 보임, 인원·점수 없음)
    'achievedTeams', (select coalesce(json_agg(x.name order by length(x.name), x.name), '[]')
                      from teams x cross join lateral lu_team_week(x.id, v_week) xw
                      where x.cohort = t.cohort and xw.achieved)
  );
end $$;

-- 팀 활동 쉬기/다시 켜기 (언제든, 비경쟁 선택). 개인 학습·XP는 그대로. 팀원에게는 "팀 활동 쉼"으로만 보임
create or replace function set_team_off(p_off boolean) returns json
language plpgsql security definer set search_path = public as $$
begin
  update students set team_off = coalesce(p_off, false) where id = (lu_me()).id;
  return my_team_summary();
end $$;

-- ---------------------------------------------------------------------
-- 4. 교수 화면용 서버 함수 (로그인한 교수만. 학생이 부르면 NOT_ADMIN)
-- ---------------------------------------------------------------------

-- 교수인지 확인 + 기수 목록 (교수가 아니면 admin=false 만 돌려줌, 다른 정보 없음)
create or replace function admin_whoami() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not lu_is_admin() then return json_build_object('admin', false); end if;
  return json_build_object(
    'admin', true,
    'email', auth.jwt() ->> 'email',
    'today', lu_today(),
    'weekStart', lu_week_start(lu_today()),
    'cohorts', (select coalesce(json_agg(c order by c desc), '[]') from (select distinct cohort as c from students) z)
  );
end $$;

-- 반 전체 많이 틀린 문항 + 강별 첫 시도 정답률 + 인원
--   연습: 학생마다 그 문항을 "처음 푼 기록"만 셈. 오답률 = 처음 낸 답이 틀렸거나(또는 답 없이) 정답을 본 비율
--   진단: 12문항 답. "아직 모르겠어요"도 오답으로 셈(따로 unknown 칸에도 표시)
--   응답이 p_min_n(기본 3)명보다 적은 문항은 빼서, 한 학생의 답이 그대로 드러나지 않게 함
create or replace function admin_item_stats(p_cohort text default null, p_min_n int default 3, p_limit int default 10)
returns json
language plpgsql stable security definer set search_path = public as $$
declare v_week date := lu_week_start(lu_today()); v_min int := greatest(coalesce(p_min_n, 3), 1);
        v_lim int := least(greatest(coalesce(p_limit, 10), 1), 300);
begin
  if not lu_is_admin() then raise exception 'NOT_ADMIN'; end if;
  return (
    with s as (select id from students where p_cohort is null or cohort = p_cohort),
    first_try as (
      select distinct on (a.student_id, a.question_id) a.question_id, a.submits, a.hint_level
      from attempts a join s on s.id = a.student_id
      where a.mode = 'PRACTICE'
      order by a.student_id, a.question_id, a.created_at, a.id
    ),
    pr as (
      select f.question_id as qid, 'practice'::text as pool, count(*)::int as n,
             count(*) filter (where coalesce(array_length(f.submits, 1), 0) = 0 or f.submits[1] <> k.answer_index)::int as wrong,
             0 as unknown,
             count(*) filter (where f.hint_level > 0)::int as hinted,
             mode() within group (order by f.submits[1]) filter (where f.submits[1] <> k.answer_index) as top_wrong
      from first_try f join question_keys k on k.question_id = f.question_id
      group by f.question_id
    ),
    dg as (
      select d.question_id as qid, 'diagnostic'::text as pool, count(*)::int as n,
             count(*) filter (where d.choice is null or d.choice <> k.answer_index)::int as wrong,
             count(*) filter (where d.choice is null)::int as unknown,
             0 as hinted,
             mode() within group (order by d.choice) filter (where d.choice is not null and d.choice <> k.answer_index) as top_wrong
      from diag_answers d join s on s.id = d.student_id join question_keys k on k.question_id = d.question_id
      group by d.question_id
    ),
    allx as (select * from pr union all select * from dg)
    select json_build_object(
      'cohort', p_cohort,
      'minN', v_min,
      'students', (select count(*) from students where p_cohort is null or cohort = p_cohort),
      'linked', (select count(*) from students st where (p_cohort is null or st.cohort = p_cohort)
                   and exists (select 1 from student_devices sd where sd.student_id = st.id)),
      'diagDone', (select count(*) from students where (p_cohort is null or cohort = p_cohort) and diag_done),
      'activeWeek', (select count(distinct a.student_id) from attempts a join s on s.id = a.student_id where a.day >= v_week),
      'items', coalesce((
        select json_agg(json_build_object(
                 'qid', x.qid, 'pool', x.pool, 'lecture', q.lecture, 'question', q.question,
                 'n', x.n, 'wrong', x.wrong, 'unknown', x.unknown, 'hinted', x.hinted,
                 'wrongRate', round(x.wrong::numeric / x.n, 3),
                 'topWrongText', case when x.top_wrong is null then null else q.choices ->> x.top_wrong end,
                 'topWrongIndex', x.top_wrong,
                 'answerText', q.choices ->> k.answer_index)
               order by x.wrong::float / x.n desc, x.n desc, x.qid)
        from (select * from allx where n >= v_min order by wrong::float / n desc, n desc, qid limit v_lim) x
        join questions q on q.id = x.qid join question_keys k on k.question_id = x.qid), '[]'),
      'lectures', coalesce((
        select json_agg(json_build_object('lecture', z.lecture, 'n', z.n,
                                          'correctRate', round(1 - z.wrong::numeric / z.n, 3)) order by z.lecture)
        from (select q.lecture, sum(pr.n)::int as n, sum(pr.wrong)::int as wrong
              from pr join questions q on q.id = pr.qid group by q.lecture having sum(pr.n) >= v_min) z), '[]')
    )
  );
end $$;

-- 팀별 주간 참여 목표 달성 (교수용: 팀원 별명 + 쉼 여부 + 이번 주 활동 여부(1문항 이상)만. 개인 문항 수·XP는 안 보여 줌)
create or replace function admin_team_week(p_cohort text default null, p_week date default null) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_week date := lu_week_start(coalesce(p_week, lu_today()));
begin
  if not lu_is_admin() then raise exception 'NOT_ADMIN'; end if;
  return json_build_object(
    'cohort', p_cohort,
    'weekStart', v_week,
    'teams', coalesce((
      select json_agg(json_build_object(
               'name', t.name, 'cohort', t.cohort, 'goalPerMember', t.goal_per_member,
               'activeMembers', w.active_members, 'progress', w.progress, 'goal', w.goal, 'achieved', w.achieved,
               'members', (select coalesce(json_agg(json_build_object(
                              'nickname', coalesce(s.nickname, '(별명 전)'), 'resting', s.team_off,
                              'activeWeek', lu_week_count(s.id, v_week) > 0) order by s.nickname nulls last), '[]')
                           from students s where s.team_id = t.id))
             order by t.cohort, length(t.name), t.name)
      from teams t cross join lateral lu_team_week(t.id, v_week) w
      where p_cohort is null or t.cohort = p_cohort), '[]'),
    'achievedCount', (select count(*) from teams t cross join lateral lu_team_week(t.id, v_week) w
                      where (p_cohort is null or t.cohort = p_cohort) and w.achieved),
    'unassigned', (select count(*) from students
                   where team_id is null and nickname is not null and not team_off
                     and (p_cohort is null or cohort = p_cohort)),
    'resting', (select count(*) from students where team_off and (p_cohort is null or cohort = p_cohort))
  );
end $$;

-- ---------------------------------------------------------------------
-- 5. 교수님(캡틴)용 — Supabase SQL 편집기에서만 실행 (학생·교수 화면 모두 실행 불가)
-- ---------------------------------------------------------------------

-- 팀 짜기 (팀게임 설계 2-2): 같은 기수에서 별명을 정했고 팀 활동을 끄지 않은 학생을
--   숨은 실력값 θ(진단으로 정한 출발 실력 + 연습 반영) 높은 순으로 줄 세워 지그재그로 나눔 → 팀마다 실력이 고르게 섞임.
--   팀 수 = 인원 ÷ 4 올림 (대부분 3~4명. 5명이면 3+2처럼 3명이 안 되는 팀이 생길 수 있음 → admin_move_student로 조정)
--   팀 번호는 무작위(1팀이 잘하는 팀이 아님). 이미 팀이 있으면 거절(TEAMS_EXIST) — 기수 끝까지 같은 팀이 원칙.
--   다시 짜야 할 때만: select * from admin_assign_teams('2027-1', true);
-- 사용: select * from admin_assign_teams('2027-1');
-- 결과의 코드(member_code)는 교수님 화면에서만 보고, 저장소·채팅·외부 AI에 붙여 넣지 않습니다.
create or replace function admin_assign_teams(p_cohort text, p_replace boolean default false)
returns table (team_name text, member_nickname text, member_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_n int; v_k int; v_nums int[]; v_ids uuid[] := '{}'; v_id uuid; r record; i int := 0; v_round int; v_pos int; v_ix int;
begin
  if p_cohort is null or p_cohort = '' then raise exception 'NO_COHORT'; end if;
  if exists (select 1 from teams where cohort = p_cohort) then
    if not coalesce(p_replace, false) then
      raise exception 'TEAMS_EXIST' using hint = '이미 이 기수의 팀이 있어요. 다시 짜려면 admin_assign_teams(기수, true)';
    end if;
    update students set team_id = null where cohort = p_cohort;
    delete from teams where cohort = p_cohort;
  end if;
  select count(*) into v_n from students where cohort = p_cohort and nickname is not null and not team_off;
  if v_n < 3 then raise exception 'TOO_FEW' using hint = '팀을 짜려면 별명을 정한 학생이 3명 이상 필요해요'; end if;
  v_k := ceil(v_n / 4.0)::int;
  select array_agg(x order by random()) into v_nums from generate_series(1, v_k) x;
  for j in 1 .. v_k loop
    insert into teams (cohort, name) values (p_cohort, v_nums[j] || '팀') returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  for r in select s.id from students s
           where s.cohort = p_cohort and s.nickname is not null and not s.team_off
           order by s.theta desc, random()
  loop
    v_round := i / v_k; v_pos := i % v_k;
    v_ix := case when v_round % 2 = 0 then v_pos else v_k - 1 - v_pos end;   -- 지그재그: 0 1 2 | 2 1 0 | 0 1 2 …
    update students set team_id = v_ids[v_ix + 1] where id = r.id;
    i := i + 1;
  end loop;
  return query
    select t.name, s.nickname, s.code from students s join teams t on t.id = s.team_id
    where t.cohort = p_cohort order by length(t.name), t.name, s.nickname;
end $$;

-- 한 학생 팀 옮기기 / 빼기 (활동 인원이 1명이 된 팀 합치기 등)
-- 사용: select admin_move_student('ABC234', '3팀');   빼기: select admin_move_student('ABC234', null);
create or replace function admin_move_student(p_code text, p_team_name text) returns text
language plpgsql security definer set search_path = public as $$
declare s students; v_t uuid;
begin
  select * into s from students where code = upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  if not found then raise exception 'UNKNOWN_CODE'; end if;
  if p_team_name is null then
    update students set team_id = null where id = s.id;
    return '팀에서 뺐어요';
  end if;
  select id into v_t from teams where cohort = s.cohort and name = p_team_name;
  if v_t is null then raise exception 'UNKNOWN_TEAM' using hint = '같은 기수에 그 이름의 팀이 없어요'; end if;
  update students set team_id = v_t where id = s.id;
  return p_team_name || '(으)로 옮겼어요';
end $$;

-- 교수 계정 등록 (이메일 로그인 = 매직링크). 이메일은 SQL 편집기에서만 넣고, 저장소·채팅에는 쓰지 않습니다.
--   insert into admins (email) values ('교수님 이메일');
-- 1인 목표 바꾸기 (기본 15문항):  update teams set goal_per_member = 10 where cohort = '2027-1';

-- ---------------------------------------------------------------------
-- 6. (참고) 쓰지 않는 것: 다른 팀 상세, 팀원 개인 XP·θ·정오답, 개인 등수 — 어떤 함수도 돌려주지 않음
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 7. 실행 권한 — Supabase 자동 허용을 모두 걷고 필요한 것만 허용
-- ---------------------------------------------------------------------
revoke execute on function
  lu_week_start(date), lu_week_count(uuid, date), lu_team_week(uuid, date), lu_is_admin(),
  my_team_summary(), set_team_off(boolean),
  admin_whoami(), admin_item_stats(text, int, int), admin_team_week(text, date),
  admin_assign_teams(text, boolean), admin_move_student(text, text)
  from public, anon;
-- 로그인한 기기·교수 계정이 부를 수 있는 것 (교수용 3개는 함수 안에서 교수인지 다시 확인)
grant execute on function
  my_team_summary(), set_team_off(boolean),
  admin_whoami(), admin_item_stats(text, int, int), admin_team_week(text, date)
  to authenticated;
-- 내부 도우미 · SQL 편집기 전용 함수는 로그인한 사람도 못 부름
revoke execute on function
  lu_week_start(date), lu_week_count(uuid, date), lu_team_week(uuid, date), lu_is_admin(),
  admin_assign_teams(text, boolean), admin_move_student(text, text)
  from authenticated;

-- 점검 (적용 후 비서실장):
--   select tablename from pg_tables where schemaname = 'public' and not rowsecurity;            -- 0줄이어야 함
--   select grantee, privilege_type from information_schema.role_table_grants where table_name = 'teams';   -- anon·authenticated 없어야 함
--   select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1;
