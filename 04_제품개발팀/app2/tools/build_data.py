#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
2단계 앱(M1) 데이터 만들기

하는 일 (쉬운 말):
  교육기획팀 원본 문항 파일을 읽어 앱이 읽는 파일 4개를 만듭니다.
    public/data/practice.js      연습 문항 (정답·해설 포함 — 연습은 보여 줘도 되는 문항)
    public/data/diagnostic.js    진단 12문항 (정답·해설 '없음' — 학생 화면용)
    public/data/hints.js         미리 만든 힌트 L1~L3 (검토 끝난 것만)
    public/data/dev_diag_key.js  [개발용] 진단 정답·해설 — 로컬 모드에서만 읽음.
                                 Supabase 모드에서는 이 파일을 쓰지 않고, 서버가 채점합니다.
                                 인터넷에 올릴 때는 이 파일을 빼야 합니다(README 4장).
  평가(assessment) 문항은 어떤 파일에도 넣지 않습니다.

힌트 파일(hints_part1-3.json, hints_part4-6.json)이 아직 없으면
  '시험용 가짜 힌트' 3개를 넣고, 화면에 [시험용 힌트] 표시가 나오게 합니다.

실행: python3 04_제품개발팀/app2/tools/build_data.py
"""
import json
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(TOOLS)
ROOT = os.path.dirname(os.path.dirname(APP))
BANK = os.path.join(ROOT, "03_교육기획팀", "문항은행")
OUT = os.path.join(APP, "public", "data")

Q_FILES = ["questions_part1-3.json", "questions_part4-6.json"]
H_FILES = ["hints_part1-3.json", "hints_part4-6.json"]

PRACTICE_FIELDS = ["id", "part", "lecture", "difficulty", "type", "question", "choices",
                   "answer_index", "explanation", "common_wrong_index", "common_wrong_reason",
                   "source_section"]
DIAG_FIELDS = ["id", "part", "lecture", "difficulty", "type", "question", "choices", "source_section"]
DIAG_SECRET = ["answer_index", "explanation", "common_wrong_index", "common_wrong_reason"]

FAKE_HINTS = {
    "L01-Q1": {"L1": "[시험용] 이 문제는 'AI라는 말이 처음 쓰인 때'를 묻고 있어요. 언제쯤일까요?",
               "L2": "[시험용] 01강 핵심 개념에서 AI 역사의 시작을 다시 떠올려 보세요.",
               "L3": "[시험용] 생성형 AI는 최근의 변화예요. 시작점이 아니라는 뜻이죠."},
    "L01-Q4": {"L1": "[시험용] 문제에서 가장 중요한 낱말에 밑줄을 그어 볼까요?",
               "L2": "[시험용] 01강 핵심 개념을 다시 보세요.",
               "L3": "[시험용] 보기 중 강의에서 다루지 않은 것부터 지워 보세요."},
    "L02-Q4": {"L1": "[시험용] 이 문제가 묻는 것은 '무엇'인가요, '왜'인가요?",
               "L2": "[시험용] 02강 핵심 개념을 다시 보세요.",
               "L3": "[시험용] 가장 그럴듯해 보이는 오답 하나가 왜 틀렸는지 생각해 보세요."},
}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_js(name, var, data, header):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* 자동으로 만든 파일입니다. 직접 고치지 마세요 (tools/build_data.py).\n   " + header + " */\n")
        f.write("window." + var + " = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n")
    return path


def norm_hints(raw):
    """힌트 파일 모양 두 가지를 모두 받음: [{id, L1, L2, L3, hint_status}] 또는 {id: {...}}"""
    items = raw.items() if isinstance(raw, dict) else [(h.get("id"), h) for h in raw]
    out = {}
    for qid, h in items:
        if not qid or not isinstance(h, dict):
            continue
        lv = [h.get("L1") or h.get("l1"), h.get("L2") or h.get("l2"), h.get("L3") or h.get("l3")]
        if h.get("hint_status") == "reviewed" and all(isinstance(x, str) and x.strip() for x in lv):
            out[qid] = {"L1": lv[0], "L2": lv[1], "L3": lv[2]}
    return out


def main():
    errors = []
    qs = []
    for fn in Q_FILES:
        p = os.path.join(BANK, fn)
        if os.path.exists(p):
            qs += load(p)
    sets = load(os.path.join(BANK, "quiz_sets.json"))
    by_id = {q["id"]: q for q in qs}

    practice = [{k: q.get(k) for k in PRACTICE_FIELDS} for q in qs
                if q.get("pool") == "practice"]
    # 1단계 앱과 같은 기준: 연습 문항은 draft(교수 검토 전)여도 사용, 개수만 경고
    draft_n = sum(1 for q in qs if q.get("pool") == "practice" and q.get("status") != "reviewed")
    diag_set = next((s for s in sets if s["set_id"] == "DIAG"), None)
    if not diag_set:
        errors.append("quiz_sets.json 에 DIAG 세트가 없습니다")
        diag_ids = []
    else:
        diag_ids = diag_set["question_ids"]
    diag, key = [], {}
    for qid in diag_ids:
        q = by_id.get(qid)
        if not q:
            errors.append("진단 문항을 찾을 수 없음: " + qid)
            continue
        if q.get("pool") != "diagnostic":
            errors.append(qid + " 는 diagnostic 문항이 아닙니다")
        diag.append({k: q.get(k) for k in DIAG_FIELDS})
        key[qid] = {k: q.get(k) for k in DIAG_SECRET}

    # 안전 검사: 진단 학생용 파일에 정답 칸이 없어야 함 / 평가 문항이 어디에도 없어야 함
    for d in diag:
        for k in DIAG_SECRET:
            if k in d:
                errors.append("진단 학생용 파일에 비밀 칸이 들어감: " + d["id"] + "." + k)
    eval_ids = {q["id"] for q in qs if q.get("pool") == "assessment"}
    leaked = [q["id"] for q in practice + diag if q["id"] in eval_ids]
    if leaked:
        errors.append("평가 문항이 들어감: " + ", ".join(leaked))

    # 힌트
    hints, fake = {}, False
    found = [fn for fn in H_FILES if os.path.exists(os.path.join(BANK, fn))]
    for fn in found:
        hints.update(norm_hints(load(os.path.join(BANK, fn))))
    practice_ids = {q["id"] for q in practice}
    hints = {k: v for k, v in hints.items() if k in practice_ids}   # 연습 문항 힌트만
    if not found:
        hints, fake = dict(FAKE_HINTS), True

    if errors:
        print("[빌드 실패] 파일을 만들지 않았습니다:")
        for e in errors:
            print("  x", e)
        sys.exit(1)

    os.makedirs(OUT, exist_ok=True)
    write_js("practice.js", "LU_PRACTICE", {"questions": practice},
             "연습 문항만 (진단·평가 없음).")
    write_js("diagnostic.js", "LU_DIAG", {"set_id": "DIAG", "questions": diag},
             "진단 12문항 — 정답·해설 칸 없음.")
    write_js("hints.js", "LU_HINTS", {"fake": fake, "hints": hints},
             ("시험용 가짜 힌트 3개 (원본 힌트 파일이 아직 없음)." if fake else "교수 검토 끝난 힌트만."))
    write_js("dev_diag_key.js", "LU_DEV_DIAG_KEY", key,
             "[개발용] 로컬 모드 전용 진단 정답. 배포·Supabase 모드에서는 사용하지 않음.")
    if draft_n:
        print("  ! 경고: 연습 %d문항 중 %d문항이 아직 draft(교수 검토 전) — 연습용이라 사용" % (len(practice), draft_n))
    print("[빌드 성공] 연습 %d · 진단 %d · 힌트 %d%s · 평가 0" %
          (len(practice), len(diag), len(hints), " (시험용 가짜)" if fake else ""))


if __name__ == "__main__":
    main()
