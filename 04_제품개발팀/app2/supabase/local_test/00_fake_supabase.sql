-- [개발용] Supabase 흉내: 내 컴퓨터의 임시 PostgreSQL에서 schema.sql을 시험할 때만 씀 (실제 Supabase에서는 실행하지 말 것)
do $$ begin   -- 역할(role)은 DB 묶음 전체에 하나라 두 번째 DB에서는 이미 있음
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
