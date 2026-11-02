#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
배포용 폴더 만들기 (인터넷에 올릴 파일만 골라 담기) — 실제 배포(업로드)는 하지 않습니다.

하는 일 (쉬운 말):
  public/ 을 복사해 deploy_public/ 을 만들되
    1) data/ 폴더는 통째로 뺍니다.
       - data/dev_diag_key.js : [개발용] 진단 정답 → 절대 올리면 안 됨
       - data/practice.js · diagnostic.js · hints.js : Supabase 모드에서는 쓰지 않음(문항은 서버에서 받음).
         특히 hints.js 에는 교수 검토 전 힌트가 들어 있어 빼는 것이 안전
    2) 복사본 config.js 의 MODE 를 "supabase" 로 바꿉니다(원본 public/ 은 그대로 local).
       개발용 줄도 지웁니다: DEV_CODES(가짜 코드) → [], SHOW_DRAFT_HINTS → false (QA 13번)
       이 도구가 만든 폴더라는 표시는 config.js 첫 줄 주석으로 남깁니다(따로 표시 파일 없음).
    3) 다 만든 뒤 스스로 검사: data/ 없음, 진단 정답 파일 없음, 관리자 열쇠 모양 없음. 하나라도 걸리면 실패.

실행: python3 04_제품개발팀/app2/tools/make_deploy.py [만들 폴더]
      (만들 폴더를 안 적으면 04_제품개발팀/app2/deploy_public — 깃에는 올라가지 않음)
"""
import os
import re
import shutil
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(TOOLS)
SRC = os.path.join(APP, "public")
STAMP = "/* make_deploy.py 가 만든 배포용 복사본 — 고치려면 public/js/config.js 를 고친 뒤 다시 만드세요 */"


def main():
    out = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(APP, "deploy_public")
    if os.path.abspath(out) == os.path.abspath(SRC):
        sys.exit("[실패] public/ 자체에 덮어쓸 수 없어요")
    if os.path.exists(out):
        made_by_me = os.path.exists(os.path.join(out, ".lu_deploy"))   # 옛 표시 파일
        try:
            made_by_me = made_by_me or open(os.path.join(out, "js", "config.js"), encoding="utf-8").read().startswith(STAMP)
        except OSError:
            pass
        if not made_by_me:
            sys.exit("[실패] %s 가 이미 있고 이 도구가 만든 폴더가 아니에요. 다른 이름을 주세요." % out)
        shutil.rmtree(out)
    shutil.copytree(SRC, out, ignore=lambda d, names: ["data"] if os.path.abspath(d) == SRC else [])

    cfg = os.path.join(out, "js", "config.js")
    s = open(cfg, encoding="utf-8").read()
    s2 = re.sub(r'MODE:\s*"local"', 'MODE: "supabase"', s, count=1)
    if s2 == s:
        sys.exit('[실패] config.js 에서 MODE: "local" 줄을 찾지 못했어요')
    s2 = re.sub(r'DEV_CODES:\s*\[[^\]]*\]', "DEV_CODES: []", s2, count=1)
    s2 = re.sub(r'SHOW_DRAFT_HINTS:\s*true', "SHOW_DRAFT_HINTS: false", s2, count=1)
    open(cfg, "w", encoding="utf-8").write(STAMP + "\n" + s2)

    # 스스로 검사
    problems = []
    if os.path.exists(os.path.join(out, "data")):
        problems.append("data/ 폴더가 남아 있음")
    texts = {}
    for d, _, files in os.walk(out):
        for f in files:
            p = os.path.join(d, f)
            rel = os.path.relpath(p, out)
            if f == "dev_diag_key.js":
                problems.append("진단 정답 파일: " + rel)
            if f.endswith((".js", ".html", ".css")) and not rel.startswith("vendor"):
                texts[rel] = open(p, encoding="utf-8").read()
    for rel, t in texts.items():
        if re.search(r"sk-ant-|eyJhbGci|sb_secret_", t):
            problems.append("비밀 열쇠 모양: " + rel)
        if re.search(r"service_role[\"']?\s*[:=]\s*[\"'][^\"']+", t):
            problems.append("service_role 값: " + rel)
        if rel.endswith("config.js") and re.search(r'DEV_CODES:\s*\[\s*"|SHOW_DRAFT_HINTS:\s*true', t):
            problems.append("개발용 설정이 남음: " + rel)
        if "window.LU_DEV_DIAG_KEY = {" in t:
            problems.append("진단 정답 내용: " + rel)
    if problems:
        sys.exit("[실패] " + " / ".join(problems))
    n = sum(len(fs) for _, _, fs in os.walk(out))
    print("[배포용 폴더 완성] %s · 파일 %d개 · data/ 없음 · MODE=supabase · 업로드는 하지 않았어요" % (out, n))


if __name__ == "__main__":
    main()
