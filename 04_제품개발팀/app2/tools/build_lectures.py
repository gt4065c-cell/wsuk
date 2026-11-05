#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
강의 노트(30강) 마크다운 → 안전한 JSON 으로 바꾸기 ("강의 보기" 화면용)

하는 일 (쉬운 말):
  03_교육기획팀/강의콘텐츠/NN강.md (01~30) 를 읽어서
    1) public/data/lectures.js      — 로컬 모드(개발용) 화면이 읽는 파일
    2) supabase/seed/seed.json 의 "lectures" — Supabase lectures 표에 넣을 데이터(넣기는 비서실장)
  를 만듭니다. 아직 없는 강은 건너뜁니다(화면은 "준비 중").

안전 규칙:
  - HTML 태그(<b>, <script> 같은 것)가 하나라도 있으면 그 강은 통째로 건너뜀 → 원본을 고쳐 다시 실행
  - 아는 마크다운만 바꿈: 제목(## ###) · 목록(- * 1.) · 굵게(**글자**) · 표(| 칸 |) · 인용(> 글)
    그 밖의 것(링크·그림 등)은 글자 그대로 둠. `코드` 표시는 따옴표 없이 글자만
  - 결과에는 HTML 이 없고 "글자 + 굵게 여부"만 있음. 화면(app.js)이 글자를 한 번 더 안전하게 바꿔(escape) 보여 줌

원본 모양 (커리큘럼 설계자):
  # 01강 제목
  > 읽는 시간: 약 5분
  > 상태: 검토 완료        (선택. 이 줄이 있으면 status = reviewed, 없으면 draft)
  ## 핵심 개념 / ## 예시 / ## 꼭 기억할 3가지 / ## 다음 단계

실행: python3 04_제품개발팀/app2/tools/build_lectures.py
      (시험용) --src 폴더 --js 파일 --seed 파일   로 읽을 곳·만들 곳을 바꿀 수 있음
끝나면: 건너뛴 강이 있으면 이유를 적고 종료 코드 1 (만든 파일은 그대로 남음)
"""
import argparse
import json
import os
import re
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(TOOLS)
ROOT = os.path.dirname(os.path.dirname(APP))
SRC = os.path.join(ROOT, "03_교육기획팀", "강의콘텐츠")
OUT_JS = os.path.join(APP, "public", "data", "lectures.js")
OUT_SEED = os.path.join(APP, "supabase", "seed", "seed.json")

N_LECTURES = 30
MAX_TITLE = 60
MAX_TEXT = 20000        # 한 강 글자 수 상한 (5분 읽기 ≈ 2~3천 자. 너무 크면 원본 실수로 봄)
MAX_BLOCKS = 300
MAX_ITEMS = 50
MAX_COLS = 6

HTML_TAG = re.compile(r"</?[A-Za-z][^>\n]{0,40}>?|<[!?]|&#|&[A-Za-z]+;")   # 꺾쇠 바로 뒤에 영문(<b, </p, <img …)·<!-- ·&nbsp; 같은 것
CTRL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")
TITLE = re.compile(r"^#\s+(\d{1,2})\s*강\s*[:：·\-–—]?\s*(.*)$")
MINUTES = re.compile(r"^>\s*읽는\s*시간\s*[:：]\s*약?\s*(\d{1,2})\s*분")
STATUS = re.compile(r"^>\s*상태\s*[:：]\s*(.+)$")
HEAD = re.compile(r"^(#{1,6})\s+(.*)$")
UL = re.compile(r"^\s*[-*+]\s+(.*)$")
OL = re.compile(r"^\s*\d{1,3}[.)]\s+(.*)$")
QUOTE = re.compile(r"^>\s?(.*)$")
TABLE_SEP = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
HR = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$")


class Reject(Exception):
    pass


def inline(text):
    """한 줄 글 → [[글자, 굵게(0/1)], ...]. 아는 표시는 **굵게** / __굵게__ / `코드` 뿐"""
    text = text.strip()
    text = re.sub(r"`([^`]*)`", r"\1", text)
    out = []
    pos = 0
    for m in re.finditer(r"\*\*(.+?)\*\*|__(.+?)__", text):
        if m.start() > pos:
            out.append([text[pos:m.start()], 0])
        out.append([m.group(1) if m.group(1) is not None else m.group(2), 1])
        pos = m.end()
    if pos < len(text):
        out.append([text[pos:], 0])
    # 남은 짝 없는 ** 는 글자 그대로. 빈 조각은 버림
    return [s for s in out if s[0]]


def cells(line):
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [inline(c) for c in s.split("|")][:MAX_COLS]


def plain_len(blocks):
    n = 0
    def il(x):
        return sum(len(s[0]) for s in x)
    for b in blocks:
        if b["t"] in ("h", "p"):
            n += il(b["text"])
        elif b["t"] == "quote":
            n += sum(il(x) for x in b["lines"])
        elif b["t"] in ("ul", "ol"):
            n += sum(il(x) for x in b["items"])
        elif b["t"] == "table":
            n += sum(il(c) for c in b["head"]) + sum(il(c) for r in b["rows"] for c in r)
    return n


def parse(md, want_no):
    """마크다운 글 → {lecture, title, minutes, status, body:[블록]}. 문제가 있으면 Reject"""
    md = md.replace("\r\n", "\n").replace("\r", "\n")
    if HTML_TAG.search(md):
        raise Reject("HTML 태그(또는 &…; 글자 코드)가 들어 있어요: " + HTML_TAG.search(md).group(0)[:30])
    md = CTRL.sub("", md)
    lines = md.split("\n")
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines):
        raise Reject("빈 파일이에요")
    m = TITLE.match(lines[i].strip())
    if not m:
        raise Reject("첫 줄이 '# NN강 제목' 모양이 아니에요")
    if int(m.group(1)) != want_no:
        raise Reject("파일 이름(%02d강)과 첫 줄 강 번호(%s강)가 달라요" % (want_no, m.group(1)))
    title = re.sub(r"\s+", " ", m.group(2)).strip()
    title = "".join(s[0] for s in inline(title)) if title else ""
    if not title:
        raise Reject("제목이 비어 있어요")
    if len(title) > MAX_TITLE:
        raise Reject("제목이 %d글자를 넘어요" % MAX_TITLE)
    i += 1

    minutes, status = None, "draft"
    # 제목 바로 아래 인용 줄(읽는 시간·상태)은 본문이 아니라 정보
    while i < len(lines):
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        mm, ms = MINUTES.match(s), STATUS.match(s)
        if mm:
            minutes = max(1, min(60, int(mm.group(1))))
            i += 1
        elif ms:
            status = "reviewed" if re.sub(r"\s", "", ms.group(1)) in ("검토완료", "reviewed") else "draft"
            i += 1
        else:
            break

    blocks = []
    para = []
    last_head = ""

    def flush():
        if para:
            blocks.append({"t": "p", "text": inline(" ".join(para))})
            del para[:]

    in_fence = False
    while i < len(lines):
        raw = lines[i]
        s = raw.strip()
        i += 1
        if s.startswith("```") or s.startswith("~~~"):
            flush()
            in_fence = not in_fence
            continue
        if in_fence:   # 코드 묶음은 모르는 것 → 한 줄씩 글자 그대로
            if s:
                blocks.append({"t": "p", "text": [[s, 0]]})
            continue
        if not s:
            flush()
            continue
        if HR.match(s):
            flush()
            continue
        mh = HEAD.match(s)
        if mh:
            flush()
            lv = 2 if len(mh.group(1)) <= 2 else 3   # 본문 안의 # 제목도 큰 제목(2)으로
            blocks.append({"t": "h", "lv": lv, "text": inline(mh.group(2))})
            last_head = mh.group(2)
            continue
        if s.startswith("|"):
            flush()
            rows = [s]
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            head = []
            if len(rows) >= 2 and TABLE_SEP.match(rows[1]):
                head = cells(rows[0])
                rows = rows[2:]
            body = [cells(r) for r in rows if not TABLE_SEP.match(r)][:MAX_ITEMS]
            blocks.append({"t": "table", "head": head, "rows": body})
            continue
        mq = QUOTE.match(s)
        if mq:
            flush()
            ql = [mq.group(1)]
            while i < len(lines) and QUOTE.match(lines[i].strip()):
                ql.append(QUOTE.match(lines[i].strip()).group(1))
                i += 1
            ql = [inline(x) for x in ql if x.strip()]
            if ql:
                blocks.append({"t": "quote", "lines": ql[:MAX_ITEMS]})
            continue
        mu, mo = UL.match(raw), OL.match(raw)
        if mu or mo:
            flush()
            kind = "ul" if mu else "ol"
            pat = UL if mu else OL
            items = [inline((mu or mo).group(1))]
            while i < len(lines):
                nxt = lines[i]
                mn = pat.match(nxt)
                if mn:
                    items.append(inline(mn.group(1)))
                    i += 1
                elif nxt.strip() and nxt.startswith(("  ", "\t")) and not UL.match(nxt) and not OL.match(nxt) and items:
                    items[-1] = items[-1] + [[" ", 0]] + inline(nxt)   # 목록 줄이 이어짐
                    i += 1
                else:
                    break
            items = [x for x in items if x][:MAX_ITEMS]
            b = {"t": kind, "items": items}
            if "꼭 기억" in last_head:
                b["key"] = 1   # 화면에서 눈에 띄게
            if items:
                blocks.append(b)
            continue
        para.append(s)
    flush()

    if not blocks:
        raise Reject("본문이 비어 있어요")
    if len(blocks) > MAX_BLOCKS:
        raise Reject("본문 덩어리가 %d개를 넘어요" % MAX_BLOCKS)
    if plain_len(blocks) > MAX_TEXT:
        raise Reject("본문이 %d글자를 넘어요" % MAX_TEXT)
    return {"lecture": want_no, "title": title, "minutes": minutes, "status": status, "body": blocks}


def check_safe(lec):
    """만든 결과를 한 번 더 검사: HTML 꺾쇠 태그 모양이 글자에 남지 않았는지 (이중 안전장치)"""
    dump = json.dumps(lec, ensure_ascii=False)
    if HTML_TAG.search(dump):
        raise Reject("변환 결과에 태그 모양이 남았어요")


def js_text(obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return s.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029").replace("</", "<\\/")


def main(argv=None):
    ap = argparse.ArgumentParser(description="강의 노트 md → JSON")
    ap.add_argument("--src", default=SRC)
    ap.add_argument("--js", default=OUT_JS)
    ap.add_argument("--seed", default=OUT_SEED)
    a = ap.parse_args(argv)

    lectures, skipped, missing = [], [], []
    for n in range(1, N_LECTURES + 1):
        p = os.path.join(a.src, "%02d강.md" % n)
        if not os.path.isfile(p):
            missing.append(n)
            continue
        try:
            with open(p, encoding="utf-8") as f:
                lec = parse(f.read(), n)
            check_safe(lec)
            lectures.append(lec)
        except Reject as e:
            skipped.append((n, str(e)))
        except UnicodeDecodeError:
            skipped.append((n, "UTF-8 글자가 아니에요"))

    by = {str(x["lecture"]): {"title": x["title"], "minutes": x["minutes"], "status": x["status"], "body": x["body"]} for x in lectures}
    os.makedirs(os.path.dirname(a.js), exist_ok=True)
    with open(a.js, "w", encoding="utf-8") as f:
        f.write("/* 자동으로 만든 파일입니다. 직접 고치지 마세요 (tools/build_lectures.py).\n"
                "   강의 노트(로컬 모드 · 개발용). 키 = 강 번호. body = [{t:'h'|'p'|'ul'|'ol'|'quote'|'table', ...}] — HTML 없음 */\n")
        f.write("window.LU_LECTURES = " + js_text({"lectures": by}) + ";\n")

    seed = {}
    if os.path.exists(a.seed):
        with open(a.seed, encoding="utf-8") as f:
            seed = json.load(f)
    seed["lectures"] = [{"lecture": x["lecture"], "title": x["title"], "minutes": x["minutes"],
                         "body_json": x["body"], "status": x["status"]} for x in lectures]
    os.makedirs(os.path.dirname(a.seed), exist_ok=True)
    with open(a.seed, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, separators=(",", ":"))

    print("강의 노트 %d강 변환 (검토 끝 %d) · 아직 없음 %d강 · 건너뜀 %d강" % (
        len(lectures), sum(1 for x in lectures if x["status"] == "reviewed"), len(missing), len(skipped)))
    for n, why in skipped:
        print("  [건너뜀] %02d강: %s" % (n, why))
    return 1 if skipped else 0


if __name__ == "__main__":
    sys.exit(main())
