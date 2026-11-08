#!/usr/bin/env bash
# [개발용] 임시 PostgreSQL 로 AI 튜터 SQL(50_ai_tutor.sql)을 시험하고, 끝나면 지웁니다.
# 진짜 Supabase 에는 접속하지 않습니다. 이 컴퓨터 안의 임시 폴더·임시 포트만 씁니다(외부 공개 없음).
# 실행: bash 04_제품개발팀/app2/supabase/local_test/run_tutor_local.sh [임시 폴더]
# 필요: PostgreSQL 16 프로그램(initdb·pg_ctl·psql). root 로 실행하면 postgres 사용자로 바꿔 돌립니다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(dirname "$HERE")"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="${1:-$(mktemp -d /tmp/lu2_pgt_XXXXXX)}"
PORT=$((55800 + RANDOM % 400))
mkdir -p "$WORK"
AS=""
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; AS="runuser -u postgres --"; fi
cleanup() { $AS "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

$AS "$BIN/initdb" -D "$WORK/data" -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1
$AS "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL() { $AS "$BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
fp() { PSQL -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('next_practice', 'close_item', 'claim_code', 'today_summary', 'diag_finish', 'my_team_summary', 'lu_is_admin', 'admin_item_stats')"; }

export PGOPTIONS="-c client_min_messages=warning"
PSQL < "$HERE/00_fake_supabase.sql" >/dev/null
PSQL < "$HERE/05_fake_auth_m2.sql" >/dev/null
PSQL < "$HERE/06_fake_service_role.sql" >/dev/null
PSQL < "$SUPA/schema.sql" >/dev/null
PSQL < "$SUPA/30_m2_teams_admin.sql" >/dev/null
PSQL < "$SUPA/40_ox_fix.sql" >/dev/null
BEFORE="$(fp)"
PSQL < "$SUPA/50_ai_tutor.sql" >/dev/null
PSQL < "$SUPA/50_ai_tutor.sql" >/dev/null      # 두 번 실행해도 오류 없이 같은 결과(다시 적용해도 안전)
AFTER="$(fp)"
export PGOPTIONS=""
OUT="$(cd "$HERE" && PSQL < "$HERE/50_tutor_smoke.sql" 2>&1 || true)"
echo "$OUT" | sed -n 's/^.*NOTICE:  //p'
echo "$OUT" | grep -E "ERROR|FATAL" && echo "FAIL T-00 시험 파일 실행 중 오류" || true
if [ "$BEFORE" = "$AFTER" ]; then L62="PASS T-62 M1·M2 1차 함수(next_practice·close_item·claim_code·today_summary·diag_finish·my_team_summary·lu_is_admin·admin_item_stats) 본문은 50번 적용 전후 같음"; else L62="FAIL T-62 기존 함수가 바뀜"; fi
echo "$L62"

# ---- 동시에 두 번 누르기: 4번 쓴 학생이 두 연결에서 동시에 tutor_begin → 정확히 1개만 성공 (6회 안 됨) ----
PSQL -c "update app_settings set tutor_enabled = true where id = 1" >/dev/null
SID="$(PSQL -At -c "insert into students (code, cohort, nickname) values ('RACE22', '2027-1', '동시') returning id")"
UID_="$(PSQL -At -c "insert into auth.users (id) values (gen_random_uuid()) returning id")"
PSQL -c "insert into student_devices (auth_uid, student_id) values ('$UID_', '$SID')" >/dev/null
PSQL -c "insert into tutor_usage (student_id, question_id, day, month, status) select '$SID', 'T-P1', lu_today(), date_trunc('month', lu_today())::date, 'ok' from generate_series(1, 4)" >/dev/null
R1="$WORK/r1"; R2="$WORK/r2"
( PSQL -At -c "begin" -c "set local role service_role" -c "select tutor_begin('$UID_', 'T-P1', 3, '{}') ->> 'ok'" -c "select pg_sleep(1.5)" -c "commit" > "$R1" 2>&1 ) &
P1=$!
sleep 0.4
( PSQL -At -c "begin" -c "set local role service_role" -c "select tutor_begin('$UID_', 'T-P1', 3, '{}') ->> 'error'" -c "commit" > "$R2" 2>&1 ) &
P2=$!
wait $P1 $P2 || true
N="$(PSQL -At -c "select count(*) from tutor_usage where student_id = '$SID' and status in ('ok', 'pending')")"
if grep -q '^true$' "$R1" && grep -q '^DAY_LIMIT$' "$R2" && [ "$N" = "5" ]; then L63="PASS T-63 두 연결에서 동시에 눌러도 5번째만 성공, 6번째는 DAY_LIMIT (기록 5줄)"; else L63="FAIL T-63 동시 누르기: r1=$(tr '\n' ' ' < "$R1") r2=$(tr '\n' ' ' < "$R2") n=$N"; fi
echo "$L63"

ALL="$( (echo "$OUT" | sed -n 's/^.*NOTICE:  //p'; echo "$OUT" | grep -qE "ERROR|FATAL" && echo FAIL; echo "$L62"; echo "$L63") )"
P=$(echo "$ALL" | grep -c '^PASS' || true); F=$(echo "$ALL" | grep -c '^FAIL' || true)
echo ""
echo "로컬 PostgreSQL 시험(AI 튜터 SQL): 통과 $P · 실패 $F   (임시 DB는 지웠어요)"
[ "$F" = "0" ]
