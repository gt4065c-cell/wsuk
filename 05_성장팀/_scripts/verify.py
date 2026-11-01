# -*- coding: utf-8 -*-
"""엑셀 수식(LibreOffice 재계산) vs 파이썬 독립 계산 대조 (2026-11-02)
사용: python3 -I verify.py <작업폴더>   — 시나리오 3개를 만들어 재계산 후 칸마다 비교"""
import sys, os, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from decimal import Decimal, ROUND_HALF_UP
import openpyxl
import data, build

def rnd(x, n=1):  # 엑셀 ROUND (0.5는 0에서 먼 쪽)
    q = Decimal(1).scaleb(-n)
    return float(Decimal(repr(x)).quantize(q, rounding=ROUND_HALF_UP))

def clean(raw):
    s = ("" if raw is None else str(raw)).strip().upper()
    if s.endswith("-N"): return s[:-2].strip(), True
    return s, False

def read_sheet(rows, items):
    """정리된 코드 → (정답률, 맞힌 수, 비경쟁), 중복 집합, 명단 외 수"""
    roster = {c for c, _ in data.PARTICIPANTS}
    first, seen, dups, off = {}, {}, set(), 0
    for code_raw, m, n, pct in rows:
        code, nc = clean(code_raw)
        if code == "": continue
        seen[code] = seen.get(code, 0) + 1
        if seen[code] > 1: dups.add(code)
        if code not in roster: off += 1
        if pct is not None: p, c = rnd(pct), rnd(pct * items / 100)
        elif m is not None and n is not None and n > 0: p, c = rnd(m / n * 100), m
        else: p, c = None, None
        if code not in first: first[code] = (p, c, nc)
    return first, dups, off

def expected(v):
    E = {}
    S = {"진단": read_sheet(data.PASTE["진단"], v["DIAG_ITEMS"])}
    for s in ("평가A", "평가B", "평가C"): S[s] = read_sheet(data.PASTE[s], v["EVAL_ITEMS"])
    per = {}
    for i, (code, team) in enumerate(data.PARTICIPANTS):
        r = i + 3; d = {}
        for s in ("진단", "평가A", "평가B", "평가C"):
            p, c, nc = S[s][0].get(code, (None, None, False))
            st = "결석" if p is None else ("비경쟁 응시" if nc else "응시")
            d[s] = dict(p=p, c=c, st=st, dup="중복! 확인" if code in S[s][1] else "")
        # 기준점수: 평가A 고정, 없으면 첫 응시
        if d["평가A"]["p"] is not None: base, src, bc = d["평가A"]["p"], "평가A", d["평가A"]["c"]
        elif d["평가B"]["p"] is not None: base, src, bc = d["평가B"]["p"], "첫 응시(평가B)", d["평가B"]["c"]
        elif d["평가C"]["p"] is not None: base, src, bc = d["평가C"]["p"], "첫 응시(평가C)", d["평가C"]["c"]
        else: base, src, bc = None, "기준 없음", None
        dp, ap = d["진단"]["p"], d["평가A"]["p"]
        gap = rnd(dp - ap) if (dp is not None and ap is not None) else None
        flag = "교수 확인" if (gap is not None and abs(gap) >= v["DIAG_GAP"]) else ""
        if ap is None and dp is None: ref = None
        else:
            num = (ap * v["EVAL_ITEMS"] if ap is not None else 0) + (dp * v["DIAG_ITEMS"] if dp is not None else 0)
            den = (v["EVAL_ITEMS"] if ap is not None else 0) + (v["DIAG_ITEMS"] if dp is not None else 0)
            ref = rnd(num / den)
        E[("진단", f"C{r}")] = d["진단"]["c"]; E[("진단", f"D{r}")] = dp
        E[("진단", f"E{r}")] = d["진단"]["st"]; E[("진단", f"F{r}")] = d["진단"]["dup"]
        for col, val in zip("CDEFGHIJKLM", [d["평가A"]["c"], ap, d["평가A"]["st"], d["평가A"]["dup"], base, src, bc,
                                             dp, gap, flag, ref]):
            E[("평가A", f"{col}{r}")] = val
        res = {}
        for s, hold_src, hold_text in (("평가B", "첫 응시(평가B)", "판정 보류 - 평가A가 없어 이번 결과가 기준점수(평가C부터 판정)"),
                                       ("평가C", "첫 응시(평가C)", "판정 보류 - 평가A·B가 없어 이번 결과가 기준점수")):
            p, c, st = d[s]["p"], d[s]["c"], d[s]["st"]
            hold = (src == hold_src)
            chg = pts = lab = None; dcnt = None
            if p is None: why = "결석 - 기록 없음"
            elif hold: lab, why = "보류", hold_text
            else:
                chg = rnd(p - base)
                if p >= v["HIGH_CUT"]: pts, lab, why = v["PTS_HIGH"], "숙달", "숙달 - 이번 정답률이 숙달 기준 이상"
                elif chg >= v["STEP2"]: pts, lab, why = v["PTS_HIGH"], "향상", "향상 - 기준보다 크게 오름"
                elif chg >= v["STEP1"]: pts, lab, why = v["PTS_MID"], "유지", "유지 - 기준과 비슷함"
                else: pts, lab, why = v["PTS_LOW"], "보완 필요", "보완 필요 - 기준보다 크게 내려감"
            if st == "비경쟁 응시": why += " / 비경쟁: 팀 점수 제외"
            if c is not None and not hold and bc is not None: dcnt = rnd(c - bc)
            team_pts = pts if (st == "응시" and pts is not None) else None
            res[s] = dict(pts=pts, lab=lab, team=team_pts, st=st)
            vals = [d["평가A"]["c"]] + ([d["평가B"]["c"]] if s == "평가C" else []) + \
                   [c, dcnt, p, st, d[s]["dup"], base, src, chg, pts, lab, team_pts, why]
            for k, val in enumerate(vals):
                E[(s, f"{chr(67 + k)}{r}")] = val
        per[code] = dict(team=team, d=d, res=res, src=src, flag=flag)
    # 팀 점수
    tsc = {}
    for t in data.TEAMS:
        row = {}
        for s in ("평가B", "평가C"):
            pts = [per[c]["res"][s]["team"] for c, tt in data.PARTICIPANTS if tt == t and per[c]["res"][s]["team"] is not None]
            row[s] = (rnd(sum(pts) / len(pts)) if pts else None, len(pts))
        tsc[t] = row
    def ranks(vals, x):
        return 1 + sum(1 for y in vals if y is not None and y > x)
    for j, t in enumerate(data.TEAMS):
        r = j + 3
        b, nb = tsc[t]["평가B"]; c, ncn = tsc[t]["평가C"]
        bl = [tsc[x]["평가B"][0] for x in data.TEAMS]; cl = [tsc[x]["평가C"][0] for x in data.TEAMS]
        judge = lambda x: "기록 없음" if x is None else ("학습목표 달성" if x >= v["GOAL"] else "도전 중")
        rk = lambda x, l: None if (x is None or x < v["GOAL"]) else ranks(l, x)
        known = [x for x in (b, c) if x is not None]
        h = rnd(sum(known) / len(known)) if known else None
        hl = []
        for x in data.TEAMS:
            k2 = [y for y in (tsc[x]["평가B"][0], tsc[x]["평가C"][0]) if y is not None]
            hl.append(rnd(sum(k2) / len(k2)) if k2 else None)
        hr = None if h is None else (ranks(hl, h) if ranks(hl, h) <= 3 else None)
        done = None if not known else ("챌린지 완주" if all(x >= v["GOAL"] for x in known) else None)
        members = sum(1 for _, tt in data.PARTICIPANTS if tt == t)
        for col, val in zip("BCDEFGHIJLMN", [b, judge(b), rk(b, bl), c, judge(c), rk(c, cl), h, hr, done, members, nb, ncn]):
            E[("팀 점수", f"{col}{r}")] = val
    # 반 전체 요약
    n = len(data.PARTICIPANTS)
    for r, s in zip(range(17, 21), ("진단", "평가A", "평가B", "평가C")):
        sts = [per[c]["d"][s]["st"] for c, _ in data.PARTICIPANTS]
        took = sum(1 for x in sts if x.endswith("응시"))
        ps = [per[c]["d"][s]["p"] for c, _ in data.PARTICIPANTS if per[c]["d"][s]["p"] is not None]
        dupn = sum(1 for c, _ in data.PARTICIPANTS if per[c]["d"][s]["dup"])
        for col, val in zip("BDEFGHIJ", [n, took, rnd(took / n * 100), rnd(sum(ps) / len(ps)) if ps else None,
                                         dupn, S[s][2], "(출석 인원 입력 시)", sum(1 for x in sts if x == "비경쟁 응시")]):
            E[("팀 점수", f"{col}{r}")] = val
    srcs = [per[c]["src"] for c, _ in data.PARTICIPANTS]
    for r, val in zip(range(23, 28), [srcs.count("평가A"), srcs.count("첫 응시(평가B)"), srcs.count("첫 응시(평가C)"),
                                      srcs.count("기준 없음"), sum(1 for c, _ in data.PARTICIPANTS if per[c]["flag"])]):
        E[("팀 점수", f"D{r}")] = val
    for r, s in ((31, "평가B"), (32, "평가C")):
        labs = [per[c]["res"][s]["lab"] for c, _ in data.PARTICIPANTS]
        for col, lab in zip("BCDEF", ["숙달", "향상", "유지", "보완 필요", "보류"]):
            E[("팀 점수", f"{col}{r}")] = labs.count(lab)
        E[("팀 점수", f"G{r}")] = sum(1 for c, _ in data.PARTICIPANTS if per[c]["res"][s]["st"] == "결석")
    return E

def same(a, b):
    a = None if a == "" else a; b = None if b == "" else b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) < 1e-9
    return a == b

def main(work):
    os.makedirs(work, exist_ok=True); total_ok = 0; bad_all = []
    for name, ov in data.SCENARIOS.items():
        v = dict(data.DEFAULTS); v.update(ov)
        src = os.path.join(work, f"{name}.xlsx"); outd = os.path.join(work, "lo"); os.makedirs(outd, exist_ok=True)
        build.build(src, ov)
        subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx", "--outdir", outd, src],
                       check=True, capture_output=True, timeout=180, cwd=work)
        wb = openpyxl.load_workbook(os.path.join(outd, f"{name}.xlsx"), data_only=True)
        errs = sum(1 for ws in wb for row in ws.iter_rows() for c in row
                   if isinstance(c.value, str) and c.value.startswith(("#", "Err:")))
        E = expected(v); bad = []
        for (sh, cell), val in E.items():
            got = wb[sh][cell].value
            if not same(got, val): bad.append((sh, cell, val, got))
        print(f"{name}: 항목 {len(E)}개, 일치 {len(E) - len(bad)}개, 불일치 {len(bad)}개, 오류 셀 {errs}개")
        for b in bad[:20]: print("   ", b)
        total_ok += len(E) - len(bad); bad_all += bad
    print("총 일치", total_ok, "불일치", len(bad_all))

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tc_verify")
