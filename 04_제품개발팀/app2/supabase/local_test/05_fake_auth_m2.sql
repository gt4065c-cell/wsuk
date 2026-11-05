-- [개발용] M2 시험용 Supabase 흉내 추가분: auth.jwt()(로그인 표의 이메일·익명 여부), auth.users 의 email·email_confirmed_at
create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
-- 순서: 00_fake_supabase.sql → 이 파일 → ../schema.sql → ../30_m2_teams_admin.sql → 30_m2_smoke.sql  (실제 Supabase에서는 실행하지 말 것)
alter table auth.users add column if not exists email text, add column if not exists email_confirmed_at timestamptz;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated;
