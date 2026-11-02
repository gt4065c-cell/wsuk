-- [개발용] schema.sql 연기 시험(smoke test). 순서: 00_fake_supabase.sql → ../schema.sql → 문항 넣기 → 이 파일
-- 결과 기록: 04_제품개발팀/테스트보고서/2026-11-02_app2_M1_자체테스트.md 4장
\set ON_ERROR_STOP 0
select count(*) as made from admin_make_codes(2,'2027-1');
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222'),('33333333-3333-3333-3333-333333333333');
-- 학생 A 기기 1
set role authenticated; set test.uid = '11111111-1111-1111-1111-111111111111';
select claim_code('ZZZZ22')->>'error' as unknown_code;
select claim_code('ABC10') ->>'error' as bad_shape;
reset role; select min(code) as code from students \gset
set role authenticated;
select claim_code(lower(:'code'))->>'ok' as claim_ok;
select set_nickname('하늘별');
select diag_answer(question_id_x, 0) from (select id as question_id_x from questions where pool='diagnostic' order by diag_order limit 11) z;
select diag_finish()->'strong' as strong, json_array_length(diag_finish()->'review') as review_n;
select round(theta::numeric,2) as theta_after_diag, diag_done from students;
select next_practice() as pick1;
-- 4지선다 연습 문항 바로 맞힘 / 2번 틀림
select close_item('L01-Q1','PRACTICE',0, array[(select answer_index from question_keys where question_id='L01-Q1')]) as solo;
select close_item('L01-Q4','PRACTICE',0, array[(select (answer_index+1)%4 from question_keys where question_id='L01-Q4'),(select (answer_index+2)%4 from question_keys where question_id='L01-Q4')]) as shown;
select close_item('L02-Q4','PRACTICE',0, array[(select (answer_index+1)%4 from question_keys where question_id='L02-Q4')]) as not_closed_should_fail;
select close_item('L02-Q1','PRACTICE',0, array[0]) as eval_should_fail;
select xp, n_answers from students;
select question_id, box, due from review_box;
-- 같은 학생 기기 2: 기록 합쳐짐
set test.uid = '22222222-2222-2222-2222-222222222222';
select claim_code(:'code')->'student'->>'xp' as device2_xp;
-- RLS: 읽기 범위
select count(*) as diag_keys_visible from question_keys k join questions q on q.id=k.question_id where q.pool<>'practice';
select count(*) as eval_questions_visible from questions where pool='assessment';
select count(*) as draft_hints_visible from hints where hint_status<>'reviewed';
insert into attempts(student_id,question_id,mode,outcome,day) select id,'L01-Q1','PRACTICE','혼자 맞힘',lu_today() from students; -- 직접 쓰기 거절돼야 함
update students set xp = 9999; select xp as xp_after_direct_update from students;
select admin_make_codes(1,'x'); -- 거절돼야 함
-- 학생 B (다른 코드)
reset role; select max(code) as code2 from students \gset
set role authenticated; set test.uid = '33333333-3333-3333-3333-333333333333';
select claim_code(:'code2')->>'ok' as b_ok;
select count(*) as b_sees_students, (select count(*) from attempts) as b_sees_attempts, (select count(*) from review_box) as b_sees_review from students;
-- 복습: 날짜가 안 됐으면 거절
set test.uid = '11111111-1111-1111-1111-111111111111';
select close_item('L01-Q4','REVIEW',0, array[(select answer_index from question_keys where question_id='L01-Q4')]) as review_not_due_should_fail;
select today_summary() as summary;
