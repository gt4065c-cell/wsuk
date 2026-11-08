-- =====================================================================
-- 40_ox_fix.sql — O/X 쏠림 수정: next_practice 함수만 다시 만듭니다
-- 상태: ✅ 실제 Supabase에 적용 완료 (2026-11-02, 비서실장 — 실DB 시험: θ-2.9 O/X 0/5, θ0 0/5, θ1 2/5)
-- 근거: 03_교육기획팀/2026-11-02_OX쏠림_해결안.md 4장 (QA 중간 7번)
--
-- 바뀌는 것 (쉬운 말):
--   E0: 문제를 "고를 때만" 맞힐 확률을 O/X도 4지선다처럼 찍기 0.25로 계산 (O/X 착시 없애기)
--   E7: 한 판(이번 판에 낸 문항 p_exclude)에 O/X가 이미 2개면, 4지선다 후보가 있을 때 O/X를 빼기
-- 바뀌지 않는 것: close_item(실력 점수 고치기)·diag_finish(진단 채점)는 진짜 찍기 확률(1 ÷ 보기 수) 그대로.
--   화면 → 서버로 보내는 값(p_recent, p_exclude)도 그대로. 표·데이터는 건드리지 않습니다.
--
-- 실행 순서: schema.sql → 30_m2_teams_admin.sql 이 이미 적용된 DB에서 SQL 편집기로 이 파일 전체 실행.
-- 여러 번 실행해도 같은 결과(create or replace). 본문은 schema.sql 의 next_practice 와 글자까지 같습니다.
-- =====================================================================

create or replace function next_practice(p_recent jsonb default '[]', p_exclude text[] default '{}') returns json
language plpgsql security definer set search_path = public as $$
declare
  me students := lu_me(); v_today date := lu_today(); n int := jsonb_array_length(coalesce(p_recent, '[]'));
  v_avoid int := null; v_pick record; v_e4 boolean := false;
  v_ox_used int := (select count(*) from questions where id = any (coalesce(p_exclude, '{}')) and type = 'ox');
begin
  if n >= 2 and (p_recent -> (n - 1) ->> 'R')::float = 0 and (p_recent -> (n - 2) ->> 'R')::float = 0 then v_e4 := true; end if;
  if n >= 3 and (p_recent -> (n - 1) ->> 'lecture') = (p_recent -> (n - 2) ->> 'lecture')
            and (p_recent -> (n - 2) ->> 'lecture') = (p_recent -> (n - 3) ->> 'lecture') then
    v_avoid := (p_recent -> (n - 1) ->> 'lecture')::int;
  end if;
  with cand as (
    select q.id, q.lecture, q.type,
           lu_p(me.theta, q.b, 0.25) as p,                                     -- E0: 고르기용 P (c 0.25)
           not exists (select 1 from attempts a where a.student_id = me.id and a.question_id = q.id) as unseen
    from questions q
    where q.pool = 'practice'
      and q.lecture <= (select open_up_to from app_settings where id = 1)
      and not (q.id = any (coalesce(p_exclude, '{}')))
      and not exists (select 1 from review_box rb where rb.student_id = me.id and rb.question_id = q.id)
      and not exists (select 1 from attempts a where a.student_id = me.id and a.question_id = q.id and a.day > v_today - 7)
  ), c1 as (   -- E7: 이번 판 O/X 2개 이상이면 O/X 빼기 (O/X 아닌 후보가 있을 때만)
    select * from cand where v_ox_used < 2 or type <> 'ox'
      or not exists (select 1 from cand where type <> 'ox')
  ), c2 as (   -- E5: 다른 강이 있으면 같은 강 4연속 피하기
    select * from c1 where v_avoid is null or lecture <> v_avoid
      or not exists (select 1 from c1 where lecture <> v_avoid)
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

-- 실행 권한: 로그인한 기기(authenticated)만. 누구나(public)·로그인 전(anon)은 금지
revoke execute on function next_practice(jsonb, text[]) from public, anon;
grant execute on function next_practice(jsonb, text[]) to authenticated;

-- 확인(선택): 아래 결과가 authenticated 한 줄이면 OK
--   select grantee from information_schema.routine_privileges where routine_name = 'next_practice' and privilege_type = 'EXECUTE';
