#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
연습 문항 데이터 만들기 (빌드 스크립트) — 트랙 B 연습 앱 v0.3

하는 일 (쉬운 말):
  교육기획팀의 원본 문항 파일 2개를 읽어서
  '연습(practice)' 문항과 '연습' 세트만 골라
  앱이 읽는 파일 public/data/practice.js 를 만듭니다.
  PRD 4장의 검사(★1~★4, 5~7)를 하나라도 통과하지 못하면
  파일을 만들지 않고 '실패'로 끝납니다.

실행 방법 (터미널에서):
  python3 04_제품개발팀/app/tools/build_data.py

시험용 옵션 (평소에는 쓰지 않음):
  --questions 경로   원본 문항 파일 대신 다른 파일 읽기
  --sets 경로        원본 세트 파일 대신 다른 파일 읽기
  --out 경로         만들 파일 위치 바꾸기
  --public 경로      ★4 검사할 '올릴 폴더' 바꾸기
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys

# ---------------------------------------------------------------- 위치
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(TOOLS_DIR)
ROOT_DIR = os.path.dirname(os.path.dirname(APP_DIR))
BANK_DIR = os.path.join(ROOT_DIR, "03_교육기획팀", "문항은행")
DEFAULT_QUESTIONS = os.path.join(BANK_DIR, "questions_part1-3.json")
DEFAULT_SETS = os.path.join(BANK_DIR, "quiz_sets.json")
DEFAULT_PUBLIC = os.path.join(APP_DIR, "public")
DEFAULT_OUT = os.path.join(DEFAULT_PUBLIC, "data", "practice.js")

# ---------------------------------------------------------------- 규칙
# 앱 파일에 넣는 칸 (그 밖의 칸 — status, review_note, difficulty, pool, set, slot 등 — 은 넣지 않음)
QUESTION_FIELDS = ["id", "type", "question", "choices", "answer_index", "explanation",
                   "common_wrong_index", "common_wrong_reason", "source_section"]
SET_FIELDS = ["set_id", "title", "question_ids"]
BANNED_SET_IDS = ["DIAG", "EVAL-A", "EVAL-B", "EVAL-C"]
BANNED_TEXT = ["DIAG", "EVAL-"]          # ★3: 이 글자가 앱 파일에 나오면 실패
SOURCE_FILE_NAMES = ["questions_part1-3.json", "quiz_sets.json"]

# 7번 검사: 원본이 바뀌면 사람이 확인한 뒤 이 숫자를 고칩니다.
EXPECTED = {"practice_total": 31, "sets": {"PRACTICE-P1": 10, "PRACTICE-P2": 10, "PRACTICE-P3": 11}}

# 경고: 보기 위치를 가리키는 말 (보기를 섞으면 틀린 말이 됨)
POSITION_PATTERNS = [
    r"[1-4]\s*번(?!째\s*강)",           # "1번", "2번과 4번"
    r"(첫|두|세|네)\s*번째\s*보기",      # "첫 번째 보기"
    r"[①②③④]",                         # 동그라미 번호
    r"(마지막|맨\s*위|맨\s*아래)\s*보기",
]


def load_json(path, label):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        fail([f"{label} 파일이 없습니다: {path}"])
    except json.JSONDecodeError as e:
        fail([f"{label} 파일의 JSON 모양이 깨졌습니다 ({e})"])


def fail(errors):
    print("\n[빌드 실패] 앱용 파일을 만들지 않았습니다. 이유:")
    for e in errors:
        print("  ✕", e)
    sys.exit(1)


def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def main():
    ap = argparse.ArgumentParser(description="연습 문항만 골라 앱용 파일 만들기")
    ap.add_argument("--questions", default=DEFAULT_QUESTIONS)
    ap.add_argument("--sets", default=DEFAULT_SETS)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--public", default=DEFAULT_PUBLIC)
    args = ap.parse_args()

    questions = load_json(args.questions, "문항")
    sets = load_json(args.sets, "세트")
    errors, warnings = [], []

    if not isinstance(questions, list) or not isinstance(sets, list):
        fail(["원본 파일은 [ ... ] 목록 모양이어야 합니다"])

    # ---------- 6번: 문항 모양 (원본 전체에서 id 겹침 확인)
    by_id, seen = {}, set()
    for q in questions:
        qid = q.get("id")
        if qid in seen:
            errors.append(f"[6 문항 모양] id가 겹칩니다: {qid}")
        seen.add(qid)
        by_id[qid] = q

    banned_ids = sorted(q["id"] for q in questions if q.get("pool") != "practice")

    # ---------- 연습 세트만 고르기
    practice_sets = [s for s in sets if s.get("purpose") == "practice"]
    for s in practice_sets:
        if s.get("set_id") in BANNED_SET_IDS:
            errors.append(f"[5 세트·문항 짝] 연습 세트 이름이 진단·평가 세트 이름과 같습니다: {s.get('set_id')}")

    # ---------- 5번: 세트·문항 짝
    for s in practice_sets:
        for qid in s.get("question_ids", []):
            if qid not in by_id:
                errors.append(f"[5 세트·문항 짝] {s['set_id']}에 적힌 {qid}가 문항 파일에 없습니다")
            elif by_id[qid].get("pool") != "practice":
                errors.append(f"[5 세트·문항 짝] {s['set_id']}에 연습이 아닌 문항 {qid}(pool={by_id[qid].get('pool')})가 들어 있습니다")

    # ---------- 연습 문항만 고르기
    practice_qs = [q for q in questions if q.get("pool") == "practice"]

    for q in practice_qs:
        qid = q.get("id")
        t = q.get("type")
        ch = q.get("choices")
        if t not in ("mcq", "ox"):
            errors.append(f"[6 문항 모양] {qid}: type이 mcq·ox가 아닙니다 ({t})")
        if not isinstance(ch, list) or len(ch) < 2 or any(not isinstance(c, str) or not c.strip() for c in ch):
            errors.append(f"[6 문항 모양] {qid}: 보기(choices)가 비었거나 이상합니다")
            continue
        if t == "ox" and len(ch) != 2:
            errors.append(f"[6 문항 모양] {qid}: OX 문항인데 보기가 2개가 아닙니다")
        if t == "mcq" and len(ch) > 6:
            errors.append(f"[6 문항 모양] {qid}: 보기가 너무 많습니다 ({len(ch)}개)")
        ai = q.get("answer_index")
        if not is_int(ai) or not (0 <= ai < len(ch)):
            errors.append(f"[6 문항 모양] {qid}: answer_index({ai})가 보기 범위 밖입니다")
        cw = q.get("common_wrong_index")
        if cw is not None and (not is_int(cw) or not (0 <= cw < len(ch))):
            errors.append(f"[6 문항 모양] {qid}: common_wrong_index({cw})가 보기 범위 밖입니다")
        if is_int(cw) and cw == ai:
            errors.append(f"[6 문항 모양] {qid}: 자주 고르는 오답이 정답과 같습니다")
        for field in ("question", "explanation"):
            if not isinstance(q.get(field), str) or not q.get(field).strip():
                errors.append(f"[6 문항 모양] {qid}: {field}가 비었습니다")

        # 경고: 보기 위치 표현
        for field in ("explanation", "common_wrong_reason"):
            text = q.get(field) or ""
            for pat in POSITION_PATTERNS:
                m = re.search(pat, text)
                if m:
                    warnings.append(f"[보기 위치 표현] {qid} {field}에 '{m.group(0)}' — 보기를 섞으면 틀린 말이 될 수 있어요")
                    break

    draft_count = sum(1 for q in practice_qs if q.get("status") != "reviewed")
    if draft_count:
        warnings.append(f"[검토 상태] 연습 {len(practice_qs)}문항 중 {draft_count}문항이 아직 draft(교수 검토 전)입니다 — 연습용이라 사용은 가능")

    # ---------- 앱용 데이터 만들기 (필요한 칸만)
    app_questions = [{k: q.get(k) for k in QUESTION_FIELDS} for q in practice_qs]
    app_sets = [{k: s.get(k) for k in SET_FIELDS} for s in practice_sets]
    data = {"version": "v0.3", "questions": app_questions, "sets": app_sets}
    body = json.dumps(data, ensure_ascii=False, indent=1)
    today = datetime.date.today().isoformat()
    text = (
        "/* 자동으로 만든 파일입니다. 직접 고치지 마세요.\n"
        "   고치는 법: 03_교육기획팀/문항은행 의 원본을 고친 뒤\n"
        "   python3 04_제품개발팀/app/tools/build_data.py 를 다시 실행하세요.\n"
        f"   만든 날: {today} · 연습 문항만 들어 있습니다. */\n"
        "window.PRACTICE_DATA = " + body + ";\n"
    )

    # ---------- ★1: 앱 파일 안 문항은 모두 연습 문항
    for aq in app_questions:
        src = by_id.get(aq["id"])
        if src is None or src.get("pool") != "practice":
            errors.append(f"[★1] 연습이 아닌 문항이 앱 파일에 들어갑니다: {aq['id']}")
    out_ids = {aq["id"] for aq in app_questions}
    for s in app_sets:
        for qid in s["question_ids"] or []:
            if qid not in out_ids:
                errors.append(f"[★1] 세트 {s['set_id']}가 앱 파일에 없는 문항 {qid}를 가리킵니다")

    # ---------- ★2: 진단·평가 문항 번호가 앱 파일 글자 전체에 0건
    leaks = [bid for bid in banned_ids if bid in text]
    if leaks:
        errors.append(f"[★2] 진단·평가 문항 번호가 앱 파일에 보입니다: {', '.join(leaks)}")

    # ---------- ★3: 진단·평가 세트 이름 0건
    set_leaks = [w for w in BANNED_TEXT if w in text]
    if set_leaks:
        errors.append(f"[★3] 진단·평가 세트 글자가 앱 파일에 보입니다: {', '.join(set_leaks)}")

    # ---------- ★4: 올릴 폴더(public/)에 원본·복사본 없음
    src_hashes = {file_hash(args.questions), file_hash(args.sets)}
    out_abs = os.path.abspath(args.out)
    if os.path.isdir(args.public):
        for dirpath, _, files in os.walk(args.public):
            for name in files:
                p = os.path.join(dirpath, name)
                rel = os.path.relpath(p, args.public)
                if name in SOURCE_FILE_NAMES:
                    errors.append(f"[★4] 올릴 폴더에 원본 파일 이름이 있습니다: public/{rel}")
                    continue
                if file_hash(p) in src_hashes:
                    errors.append(f"[★4] 올릴 폴더에 원본 복사본이 있습니다: public/{rel}")
                    continue
                if os.path.abspath(p) == out_abs:
                    continue  # 예전에 만든 앱 파일은 새로 덮어씀
                try:
                    with open(p, encoding="utf-8") as f:
                        content = f.read()
                except (UnicodeDecodeError, OSError):
                    continue  # 그림·글꼴 같은 파일
                bad = [bid for bid in banned_ids if bid in content] + [w for w in BANNED_TEXT if w in content]
                if bad or '"review_note"' in content or '"pool"' in content:
                    errors.append(f"[★4] 올릴 폴더의 public/{rel} 안에 진단·평가 흔적이 있습니다: {', '.join(bad) or 'review_note/pool 칸'}")

    # ---------- 7번: 개수 요약
    got_sets = {s["set_id"]: len(s["question_ids"] or []) for s in app_sets}
    summary = (f"연습 {len(app_questions)}문항("
               + " · ".join(f"{k.replace('PRACTICE-', '')} {v}" for k, v in got_sets.items())
               + f"), 세트 {len(app_sets)}개, 진단·평가 {len(leaks) + sum(1 for aq in app_questions if by_id.get(aq['id'], {}).get('pool') != 'practice')}개")
    if len(app_questions) != EXPECTED["practice_total"] or got_sets != EXPECTED["sets"]:
        errors.append(f"[7 개수 요약] 기대값 '연습 31문항(P1 10 · P2 10 · P3 11), 세트 3개, 진단·평가 0개'와 다릅니다 → 지금: {summary}. "
                      "원본이 일부러 바뀐 것이면 사람이 확인한 뒤 build_data.py의 EXPECTED를 고치세요")
    total_in_sets = sum(got_sets.values())
    if total_in_sets != len(app_questions):
        errors.append(f"[7 개수 요약] 세트에 든 문항 수 합({total_in_sets})과 연습 문항 수({len(app_questions)})가 다릅니다")

    # ---------- 결과
    for w in warnings:
        print("  ! 경고", w)
    if errors:
        fail(errors)

    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    tmp = out_abs + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, out_abs)
    print("\n[빌드 성공]", summary)
    print("  검사 ★1~★4, 5~7 모두 통과")
    print("  만든 파일:", out_abs)


if __name__ == "__main__":
    main()
