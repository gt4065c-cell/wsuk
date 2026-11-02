#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Supabase에 넣을 문항·정답·힌트를 한 파일(supabase/seed/seed.json)로 모읍니다.
실행: python3 04_제품개발팀/app2/tools/build_seed.py
가져오기: supabase/20_import_seed.sql (Supabase가 GitHub에서 이 파일을 직접 받아 넣음)
※ 저장소는 공개(캡틴 결정)라 이 파일도 공개 상태입니다. 학생 개인정보는 없습니다."""
import json, os, re
APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(os.path.dirname(os.path.dirname(APP)), "03_교육기획팀", "문항은행")
Q_FILES = ["questions_part1-3.json", "questions_part4-6.json", "questions_easy.json", "questions_weekly.json"]
H_FILES = ["hints_part1-3.json", "hints_part4-6.json"]
B = {0: -2.0, 1: -1.0, 2: 0.0, 3: 1.0}

def load(n):
    with open(os.path.join(BANK, n), encoding="utf-8") as f: return json.load(f)

diag_js = open(os.path.join(APP, "public", "data", "diagnostic.js"), encoding="utf-8").read()
diag_ids = [q["id"] for q in json.loads(diag_js[diag_js.index("{"):diag_js.rstrip().rstrip(";").rindex("}") + 1])["questions"]]

qs, keys, seen = [], [], set()
for fn in Q_FILES:
    for x in load(fn):
        assert x["id"] not in seen, x["id"]; seen.add(x["id"])
        assert 0 <= x["answer_index"] < len(x["choices"])
        qs.append({"id": x["id"], "part": x["part"], "lecture": x["lecture"], "difficulty": x["difficulty"],
                   "type": x["type"], "question": x["question"], "choices": x["choices"],
                   "source_section": x.get("source_section"), "pool": x["pool"],
                   "diag_order": (diag_ids.index(x["id"]) + 1) if x["id"] in diag_ids else None,
                   "b": B[x["difficulty"]]})
        keys.append({"question_id": x["id"], "answer_index": x["answer_index"], "explanation": x.get("explanation"),
                     "common_wrong_index": x.get("common_wrong_index"), "common_wrong_reason": x.get("common_wrong_reason")})
hints = []
for fn in H_FILES:
    if not os.path.exists(os.path.join(BANK, fn)): continue
    for h in load(fn):
        assert h["id"] in seen, h["id"]
        hints.append({"question_id": h["id"], "l1": h["L1"], "l2": h["L2"], "l3": h["L3"],
                      "hint_status": "reviewed" if h.get("hint_status") == "reviewed" else "draft"})
assert len([q for q in qs if q["diag_order"]]) == len(diag_ids) == 12
out = os.path.join(APP, "supabase", "seed"); os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "seed.json"), "w", encoding="utf-8") as f:
    json.dump({"questions": qs, "keys": keys, "hints": hints}, f, ensure_ascii=False, separators=(",", ":"))
from collections import Counter
print("문항", len(qs), dict(Counter(q["pool"] for q in qs)), "힌트", len(hints))
