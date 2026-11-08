#!/usr/bin/env bash
# [개발용] 임시 PostgreSQL 로 80_session_fix.sql(지워진 계정 claim_code · 강의 노트 표)을 시험하고, 끝나면 지웁니다.
# 진짜 Supabase 에는 접속하지 않습니다. 이 컴퓨터 안의 임시 폴더·임시 포트만 씁니다(외부 공개 없음).
# 실행: bash 04_제품개발팀/app2/supabase/local_test/run_session_fix_local.sh [임시 폴더]
# 필요: PostgreSQL 16 프로그램(initdb·pg_ctl·psql). root 로 실행하면 postgres 사용자로 바꿔 돌립니다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(dirname "$HERE")"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="${1:-$(mktemp -d /tmp/lu2_pgs_XXXXXX)}"
PORT=$((57000 + RANDOM % 400))
mkdir -p "$WORK"
AS=""
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; AS="runuser -u postgres --"; fi
cleanup() { $AS "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

$AS "$BIN/initdb" -D "$WORK/data" -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1
$AS "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL() { $AS "$BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
# 80번 파일이 건드리지 않아야 하는 함수 본문 지문 (claim_code 만 다시 만듦)
fp() { PSQL -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'claim_code' and p.prokind = 'f'"; }
fp80() { PSQL -At -c "select md5(pg_get_functiondef('claim_code(text)'::regprocedure))"; }

export PGOPTIONS="-c client_min_messages=warning"
PSQL < "$HERE/00_fake_supabase.sql" >/dev/null
PSQL < "$HERE/05_fake_auth_m2.sql" >/dev/null
PSQL < "$HERE/06_fake_service_role.sql" >/dev/null
for f in schema.sql 30_m2_teams_admin.sql 40_ox_fix.sql 50_ai_tutor.sql 60_m2_weekly_explainer.sql 70_qa_fixes.sql; do PSQL < "$SUPA/$f" >/dev/null; done
# 고치기 전 버그 재현: 지워진 계정(auth.users 에 없음)으로 claim_code → student_devices FK 오류 (캡틴 체험판에서 본 그 오류)
REPRO="$(PSQL 2>&1 <<'SQL' || true
insert into students (code, cohort) values ('RPRX22', '2027-1');
set role authenticated;
select set_config('test.uid', gen_random_uuid()::text, false);
select claim_code('RPRX22');
SQL
)"
PSQL -c "delete from code_attempts; delete from students where code = 'RPRX22'" >/dev/null
if echo "$REPRO" | grep -q 'violates foreign key constraint'; then L0="PASS X-29 (고치기 전 재현) 70번까지 적용한 DB에서 지워진 계정으로 코드 입력 → student_devices FK 오류"; else L0="FAIL X-29 고치기 전 버그가 재현되지 않음: $(echo "$REPRO" | head -2)"; fi
BEFORE="$(fp)"
PSQL < "$SUPA/80_session_fix.sql" >/dev/null
F1="$(fp80)"
PSQL < "$SUPA/80_session_fix.sql" >/dev/null      # 두 번 실행해도 오류 없이 같은 결과(다시 적용해도 안전)
F2="$(fp80)"
AFTER="$(fp)"
export PGOPTIONS=""
OUT="$(cd "$HERE" && PSQL < "$HERE/80_session_smoke.sql" 2>&1 || true)"
echo "$OUT" | sed -n 's/^.*NOTICE:  //p'
echo "$OUT" | grep -E "ERROR|FATAL" && echo "FAIL X-00 시험 파일 실행 중 오류" || true
if [ "$BEFORE" = "$AFTER" ]; then L1="PASS X-30 80번이 claim_code 말고 다른 함수 본문은 바꾸지 않음(next_practice·close_item 등 그대로)"; else L1="FAIL X-30 다른 함수가 바뀜"; fi
if [ -n "$F1" ] && [ "$F1" = "$F2" ]; then L2="PASS X-31 80번을 두 번 실행해도 claim_code 본문이 같음"; else L2="FAIL X-31 두 번 실행 결과가 다름"; fi
echo "$L0"; echo "$L1"; echo "$L2"

ALL="$( (echo "$OUT" | sed -n 's/^.*NOTICE:  //p'; echo "$OUT" | grep -qE "ERROR|FATAL" && echo FAIL; echo "$L0"; echo "$L1"; echo "$L2") )"
P=$(echo "$ALL" | grep -c '^PASS' || true); F=$(echo "$ALL" | grep -c '^FAIL' || true)
echo ""
echo "로컬 PostgreSQL 시험(80 지워진 계정·강의 노트 SQL): 통과 $P · 실패 $F   (임시 DB는 지웠어요)"
[ "$F" = "0" ]
