#!/usr/bin/env bash
# [개발용] 임시 PostgreSQL을 만들어 schema.sql + 30_m2_teams_admin.sql 을 시험하고, 끝나면 지웁니다.
# 진짜 Supabase에는 접속하지 않습니다. 이 컴퓨터 안의 임시 폴더·임시 포트만 씁니다(외부 공개 없음).
# 실행: bash 04_제품개발팀/app2/supabase/local_test/run_m2_local.sh [임시 폴더]
# 필요: PostgreSQL 16 프로그램(initdb·pg_ctl·psql). root 로 실행하면 postgres 사용자로 바꿔 돌립니다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPA="$(dirname "$HERE")"
BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
WORK="${1:-$(mktemp -d /tmp/lu2_pg_XXXXXX)}"
PORT=$((55400 + RANDOM % 400))
mkdir -p "$WORK"
AS=""
if [ "$(id -u)" = "0" ]; then chown postgres "$WORK"; AS="runuser -u postgres --"; fi
cleanup() { $AS "$BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

$AS "$BIN/initdb" -D "$WORK/data" -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1
$AS "$BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL() { $AS "$BIN/psql" -X -q -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
fp() { PSQL -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('next_practice', 'close_item', 'claim_code', 'today_summary', 'diag_finish')"; }

export PGOPTIONS="-c client_min_messages=warning"
PSQL < "$HERE/00_fake_supabase.sql" >/dev/null
PSQL < "$HERE/05_fake_auth_m2.sql" >/dev/null
PSQL < "$SUPA/schema.sql" >/dev/null
BEFORE="$(fp)"
PSQL < "$SUPA/30_m2_teams_admin.sql" >/dev/null
PSQL < "$SUPA/30_m2_teams_admin.sql" >/dev/null     # 두 번 실행해도 오류 없이 같은 결과(다시 적용해도 안전)
AFTER="$(fp)"
export PGOPTIONS=""
OUT="$(cd "$HERE" && PSQL < "$HERE/30_m2_smoke.sql" 2>&1 || true)"
echo "$OUT" | sed -n 's/^.*NOTICE:  //p'
echo "$OUT" | grep -E "ERROR|FATAL" && echo "FAIL M-00 시험 파일 실행 중 오류" || true
if [ "$BEFORE" = "$AFTER" ]; then echo "PASS M-66 M1 함수(next_practice·close_item·claim_code·today_summary·diag_finish) 본문은 30번 파일 적용 전후 같음"; else echo "FAIL M-66 M1 함수가 바뀜"; fi
ALL="$( (echo "$OUT" | sed -n 's/^.*NOTICE:  //p'; echo "$OUT" | grep -qE "ERROR|FATAL" && echo FAIL; [ "$BEFORE" = "$AFTER" ] && echo PASS || echo FAIL) )"
P=$(echo "$ALL" | grep -c '^PASS' || true); F=$(echo "$ALL" | grep -c '^FAIL' || true)
echo ""
echo "로컬 PostgreSQL 시험(M2 1차 SQL): 통과 $P · 실패 $F   (임시 DB는 지웠어요)"
[ "$F" = "0" ]
