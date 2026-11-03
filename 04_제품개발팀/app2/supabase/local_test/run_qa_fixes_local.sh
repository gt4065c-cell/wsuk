#!/usr/bin/env bash
# [개발용] 임시 PostgreSQL 로 QA 낮음 수정 SQL(70_qa_fixes.sql)을 시험하고, 끝나면 지웁니다.
# 진짜 Supabase 에는 접속하지 않습니다. 이 컴퓨터 안의 임시 폴더·임시 포트만 씁니다(외부 공개 없음).
# 실행: bash 04_제품개발팀/app2/supabase/local_test/run_qa_fixes_local.sh [임시 폴더]
# 필요: PostgreSQL 16 프로그램(initdb·pg_ctl·psql). root 로 실행하면 postgres 사용자로 바꿔 돌립니다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(dirname "$HERE")"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="${1:-$(mktemp -d /tmp/lu2_pgq_XXXXXX)}"
PORT=$((56600 + RANDOM % 400))
mkdir -p "$WORK"
AS=""
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; AS="runuser -u postgres --"; fi
cleanup() { $AS "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

$AS "$BIN/initdb" -D "$WORK/data" -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1
$AS "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL() { $AS "$BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
# 70번 파일이 건드리지 않아야 하는 함수 본문 지문
fp() { PSQL -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('next_practice', 'claim_code', 'today_summary', 'diag_finish', 'my_team_summary', 'set_team_off', 'lu_is_admin', 'lu_team_week', 'admin_item_stats', 'admin_team_week', 'tutor_status', 'tutor_finish', 'admin_tutor_usage', 'lu_tutor_state', 'lu_check_week', 'admin_weekly_stats', 'lu_today', 'lu_me')"; }
# 70번 파일이 다시 만드는 함수 지문 (두 번 실행해도 같아야 함)
fp70() { PSQL -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('set_nickname', 'diag_answer', 'close_item', 'tutor_begin', 'weekly_check_status', 'weekly_check_items', 'weekly_check_submit', 'lu_explainer_pick', 'my_team_explainer', 'write_team_explainer', 'lu_diag_ready', 'lu_kst_now')"; }

export PGOPTIONS="-c client_min_messages=warning"
PSQL < "$HERE/00_fake_supabase.sql" >/dev/null
PSQL < "$HERE/05_fake_auth_m2.sql" >/dev/null
PSQL < "$HERE/06_fake_service_role.sql" >/dev/null
PSQL < "$SUPA/schema.sql" >/dev/null
PSQL < "$SUPA/30_m2_teams_admin.sql" >/dev/null
PSQL < "$SUPA/40_ox_fix.sql" >/dev/null
PSQL < "$SUPA/50_ai_tutor.sql" >/dev/null
PSQL < "$SUPA/60_m2_weekly_explainer.sql" >/dev/null
BEFORE="$(fp)"
PSQL < "$SUPA/70_qa_fixes.sql" >/dev/null
F1="$(fp70)"
PSQL < "$SUPA/70_qa_fixes.sql" >/dev/null      # 두 번 실행해도 오류 없이 같은 결과(다시 적용해도 안전)
F2="$(fp70)"
AFTER="$(fp)"
export PGOPTIONS=""
OUT="$(cd "$HERE" && PSQL < "$HERE/70_qa_smoke.sql" 2>&1 || true)"
echo "$OUT" | sed -n 's/^.*NOTICE:  //p'
echo "$OUT" | grep -E "ERROR|FATAL" && echo "FAIL Q-00 시험 파일 실행 중 오류" || true
if [ "$BEFORE" = "$AFTER" ]; then L65="PASS Q-65 70번이 건드리지 않는 함수 18개(next_practice·today_summary·tutor_finish·admin_* 등) 본문은 적용 전후 같음"; else L65="FAIL Q-65 건드리면 안 되는 함수가 바뀜"; fi
if [ -n "$F1" ] && [ "$F1" = "$F2" ]; then L66="PASS Q-66 70번을 두 번 실행해도 다시 만든 함수 12개 본문이 같음"; else L66="FAIL Q-66 두 번 실행 결과가 다름"; fi
echo "$L65"; echo "$L66"

ALL="$( (echo "$OUT" | sed -n 's/^.*NOTICE:  //p'; echo "$OUT" | grep -qE "ERROR|FATAL" && echo FAIL; echo "$L65"; echo "$L66") )"
P=$(echo "$ALL" | grep -c '^PASS' || true); F=$(echo "$ALL" | grep -c '^FAIL' || true)
echo ""
echo "로컬 PostgreSQL 시험(QA 낮음 수정 SQL): 통과 $P · 실패 $F   (임시 DB는 지웠어요)"
[ "$F" = "0" ]
