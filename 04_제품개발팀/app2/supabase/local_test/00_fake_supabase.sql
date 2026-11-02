-- [개발용] Supabase 흉내: 내 컴퓨터의 임시 PostgreSQL에서 schema.sql을 시험할 때만 씀 (실제 Supabase에서는 실행하지 말 것)
create role anon nologin; create role authenticated nologin;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
