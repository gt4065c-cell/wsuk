#!/usr/bin/env bash
# [개발용] 임시 PostgreSQL 로 주간 공통 점검 + 팀 해설 당번 SQL(60_m2_weekly_explainer.sql)을 시험하고, 끝나면 지웁니다.
# 진짜 Supabase 에는 접속하지 않습니다. 이 컴퓨터 안의 임시 폴더·임시 포트만 씁니다(외부 공개 없음).
# 실행: bash 04_제품개발팀/app2/supabase/local_test/run_weekly_local.sh [임시 폴더]
# 필요: PostgreSQL 16 프로그램(initdb·pg_ctl·psql). root 로 실행하면 postgres 사용자로 바꿔 돌립니다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(dirname "$HERE")"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="${1:-$(mktemp -d /tmp/lu2_pgw_XXXXXX)}"
PORT=$((56200 + RANDOM % 400))
mkdir -p "$WORK"
AS=""
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; AS="runuser -u postgres --"; fi
cleanup() { $AS "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

$AS "$BIN/initdb" -D "$WORK/data" -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1
$AS "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL() { $AS "$BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
# 이미 있는 함수 본문 지문 (60번 파일이 하나도 다시 만들지 않는지)
fp() { PSQL -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('next_practice', 'close_item', 'claim_code', 'today_summary', 'diag_finish', 'my_team_summary', 'set_team_off', 'lu_is_admin', 'lu_team_week', 'admin_item_stats', 'admin_team_week', 'tutor_status', 'tutor_begin', 'tutor_finish', 'admin_tutor_usage', 'lu_tutor_state')"; }

export PGOPTIONS="-c client_min_messages=warning"
PSQL < "$HERE/00_fake_supabase.sql" >/dev/null
PSQL < "$HERE/05_fake_auth_m2.sql" >/dev/null
PSQL < "$HERE/06_fake_service_role.sql" >/dev/null
PSQL < "$SUPA/schema.sql" >/dev/null
PSQL < "$SUPA/30_m2_teams_admin.sql" >/dev/null
PSQL < "$SUPA/40_ox_fix.sql" >/dev/null
PSQL < "$SUPA/50_ai_tutor.sql" >/dev/null
BEFORE="$(fp)"
PSQL < "$SUPA/60_m2_weekly_explainer.sql" >/dev/null
PSQL < "$SUPA/60_m2_weekly_explainer.sql" >/dev/null      # 두 번 실행해도 오류 없이 같은 결과(다시 적용해도 안전)
AFTER="$(fp)"
export PGOPTIONS=""
OUT="$(cd "$HERE" && PSQL < "$HERE/60_weekly_smoke.sql" 2>&1 || true)"
echo "$OUT" | sed -n 's/^.*NOTICE:  //p'
echo "$OUT" | grep -E "ERROR|FATAL" && echo "FAIL W-00 시험 파일 실행 중 오류" || true
if [ "$BEFORE" = "$AFTER" ]; then L71="PASS W-71 이미 있는 함수 16개(next_practice·close_item·my_team_summary·tutor_* 등) 본문은 60번 적용 전후 같음"; else L71="FAIL W-71 기존 함수가 바뀜"; fi
echo "$L71"

# ---- 두 기기에서 동시에 제출: 정확히 1개만 저장, 다른 하나는 WEEKLY_DONE ----
SID="$(PSQL -At -c "insert into students (code, cohort, nickname) values ('RACEW2', '2027-1', '동시') returning id")"
UID_="$(PSQL -At -c "insert into auth.users (id) values (gen_random_uuid()) returning id")"
PSQL -c "insert into student_devices (auth_uid, student_id) values ('$UID_', '$SID')" >/dev/null
ANS='{"W2-Q1":1,"W2-Q2":2,"W2-Q3":3}'
R1="$WORK/r1"; R2="$WORK/r2"
( PSQL -At -c "begin" -c "set local role authenticated" -c "select set_config('test.uid', '$UID_', true)" \
       -c "select weekly_check_submit('$ANS'::jsonb) ->> 'done'" -c "select pg_sleep(1.5)" -c "commit" > "$R1" 2>&1 ) &
P1=$!
sleep 0.4
( PSQL -At -c "begin" -c "set local role authenticated" -c "select set_config('test.uid', '$UID_', true)" \
       -c "select weekly_check_submit('$ANS'::jsonb) ->> 'done'" -c "commit" > "$R2" 2>&1 ) &
P2=$!
wait $P1 $P2 || true
N="$(PSQL -At -c "select count(*) from weekly_checks where student_id = '$SID'")"
NA="$(PSQL -At -c "select count(*) from weekly_answers where student_id = '$SID'")"
if grep -q '^true$' "$R1" && grep -q 'WEEKLY_DONE' "$R2" && [ "$N" = "1" ] && [ "$NA" = "3" ]; then L72="PASS W-72 두 기기에서 동시에 제출해도 1번만 저장(응시 1줄·답 3줄), 두 번째는 WEEKLY_DONE"; else L72="FAIL W-72 동시 제출: r1=$(tr '\n' ' ' < "$R1") r2=$(tr '\n' ' ' < "$R2") n=$N na=$NA"; fi
echo "$L72"

ALL="$( (echo "$OUT" | sed -n 's/^.*NOTICE:  //p'; echo "$OUT" | grep -qE "ERROR|FATAL" && echo FAIL; echo "$L71"; echo "$L72") )"
P=$(echo "$ALL" | grep -c '^PASS' || true); F=$(echo "$ALL" | grep -c '^FAIL' || true)
echo ""
echo "로컬 PostgreSQL 시험(주간 공통 점검·해설 당번 SQL): 통과 $P · 실패 $F   (임시 DB는 지웠어요)"
[ "$F" = "0" ]
