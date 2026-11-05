-- =====================================================================
-- 레벨업 캠퍼스 2단계 — ① 지워진 익명 계정으로 코드 입력 시 오류(student_devices FK) 막기 ② 강의 노트(lectures) 표
--
-- 상태: ✅ 실DB 적용 완료 (2026-11-05 비서실장, apply_migration). 작성 2026-11-05 앱 개발자
-- 실행 순서: schema.sql → 30 → 40 → 50 → 60 → 70_qa_fixes.sql → 이 파일
--           여러 번 실행해도 같은 결과(create or replace / if not exists / drop policy if exists). 기존 데이터는 바꾸지 않음
-- 내 컴퓨터 시험: supabase/local_test/run_session_fix_local.sh (임시 PostgreSQL, 진짜 DB 아님)
--
-- 바뀌는 것 (쉬운 말)
--   ① claim_code: 브라우저에 남은 로그인(임시 계정)이 서버 Auth Users 에서 이미 지워졌으면
--      예전에는 "insert or update on table student_devices violates foreign key…" 오류가 그대로 화면에 나왔음
--      → 이제는 {ok:false, error:'NO_AUTH'} 를 돌려줌. 화면(store.js)은 이 답을 받으면 이 기기 로그인만 지우고
--        새 임시 계정을 만들어 한 번 더 시도함 (학생은 코드를 다시 넣을 필요 없음)
--      코드 입력 횟수 기록(code_attempts)에도 남기지 않음(없는 계정이라)
--   ② lectures 표: 강의 노트 30강 (강 번호·제목·읽는 시간·본문 JSON·검토 상태)
--      학생은 검토 끝난(reviewed) 강의 lecture·title·minutes·body_json 만 읽음. 쓰기 권한 없음. 로그인 전(anon) 권한 없음
--      본문 JSON 은 tools/build_lectures.py 가 만든 "글자 + 굵게 여부" 덩어리 목록 (HTML 없음)
-- 바뀌지 않는 것: next_practice · close_item · 경험치 규칙(읽기에는 XP 없음) · 다른 표·함수
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. claim_code — 계정이 auth.users 에 없으면 NO_AUTH (json)
--    (schema.sql 원래 본문 + 4번째 줄 확인 하나만 추가)
-- ---------------------------------------------------------------------
create or replace function claim_code(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare s students; v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
begin
  if auth.uid() is null then raise exception 'NO_AUTH'; end if;
  -- [80] 브라우저에 남은 로그인의 계정이 지워졌으면(Auth Users 에서 삭제 등) 연결하지 않고 알려 줌 → 화면이 새 계정으로 다시 시도
  if not exists (select 1 from auth.users u where u.id = auth.uid()) then
    return json_build_object('ok', false, 'error', 'NO_AUTH');
  end if;
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
revoke all on function claim_code(text) from public, anon;
grant execute on function claim_code(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. lectures — 강의 노트 (원본: 03_교육기획팀/강의콘텐츠/NN강.md → tools/build_lectures.py → seed.json "lectures")
-- ---------------------------------------------------------------------
create table if not exists lectures (
  lecture    int primary key check (lecture between 1 and 30),
  title      text not null check (char_length(title) between 1 and 60),
  minutes    int check (minutes between 1 and 60),
  body_json  jsonb not null check (jsonb_typeof(body_json) = 'array' and jsonb_array_length(body_json) between 1 and 300),
  status     text not null default 'draft' check (status in ('draft', 'reviewed')),
  updated_at timestamptz not null default now()
);
alter table lectures enable row level security;
revoke all on lectures from public, anon, authenticated;
grant select (lecture, title, minutes, body_json) on lectures to authenticated;
drop policy if exists lectures_reviewed on lectures;
create policy lectures_reviewed on lectures for select to authenticated using (status = 'reviewed');

-- 넣기 예 (비서실장, SQL 편집기 — 20_import_seed.sql 과 같은 방법으로 seed.json 을 받은 뒤 <seed> 자리에 그 jsonb):
--   insert into lectures (lecture, title, minutes, body_json, status)
--     select (l->>'lecture')::int, l->>'title', nullif(l->>'minutes', '')::int, l->'body_json', l->>'status'
--       from jsonb_array_elements(<seed>->'lectures') l
--     on conflict (lecture) do update set title = excluded.title, minutes = excluded.minutes,
--       body_json = excluded.body_json, status = excluded.status, updated_at = now();
-- 원본 md 에 "> 상태: 검토 완료" 줄이 없으면 'draft' 로 들어가 학생에게 안 보임. 검토가 끝나면:
--   update lectures set status = 'reviewed' where lecture in (1, 2, 3);
-- 확인:
--   select lecture, title, minutes, status, jsonb_array_length(body_json) from lectures order by lecture;
