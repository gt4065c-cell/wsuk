-- [개발용] AI 튜터 시험용 Supabase 흉내 추가분: service_role 역할(Edge Function 이 쓰는 서버 역할)
-- 순서: 00_fake_supabase.sql → 05_fake_auth_m2.sql → 이 파일 → ../schema.sql → ../30 → ../40 → ../50 → 50_tutor_smoke.sql
-- (실제 Supabase 에는 service_role 이 이미 있음 — 실제 DB에서는 실행하지 말 것)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to service_role;
grant usage on schema auth to service_role;
grant execute on function auth.uid() to service_role;
grant execute on function auth.jwt() to service_role;
