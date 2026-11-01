# -*- coding: utf-8 -*-
"""팀 챌린지 향상점수 스프레드시트 — 가짜 예시 데이터와 검증용 노란 칸 값 (2026-11-02)
실제 학생 데이터 아님. 참가자 코드는 6자리 무작위(헷갈리는 0/O, 1/I/L 제외)."""

# 참가자 명단: (코드, 팀)
PARTICIPANTS = [
    ("K7M2QX", "1팀"), ("R4XT9H", "1팀"), ("H9WC3P", "1팀"),
    ("B3NV7K", "2팀"), ("Z8DQ4T", "2팀"), ("M2PF6Y", "2팀"),
    ("T6YH8R", "3팀"), ("C5JR2W", "3팀"), ("W3KE5N", "3팀"),
    ("F8UA7G", "4팀"), ("N4GS9B", "4팀"), ("D7VB3M", "4팀"),
]
TEAMS = ["1팀", "2팀", "3팀", "4팀"]

# 붙여넣기 영역: (참가자 코드 원문, 맞힌 수, 문항 수, 정답률%) — None은 빈칸
PASTE = {
    "진단": [
        ("K7M2QX", 6, 12, None), ("R4XT9H", 10, 12, None), ("H9WC3P", 5, 12, None),
        ("B3NV7K", 4, 12, None), ("Z8DQ4T", 9, 12, None), ("M2PF6Y", 8, 12, None),
        ("T6YH8R", 12, 12, None), ("C5JR2W", 7, 12, None),
        ("F8UA7G", 3, 12, None), ("N4GS9B", 11, 12, None), ("D7VB3M", 2, 12, None),
    ],
    # C5JR2W: 진단만 보고 평가A 없음 / W3KE5N: 1회차 결석
    "평가A": [
        ("K7M2QX", 4, 8, None), ("R4XT9H", 7, 8, None), ("H9WC3P", 0, 8, None),
        ("B3NV7K", 1, 8, None), ("Z8DQ4T", 5, 8, None), ("M2PF6Y", 6, 8, None),
        ("T6YH8R", 8, 8, None),
        ("F8UA7G", 3, 8, None), ("N4GS9B", 3, 8, None), ("D7VB3M", 2, 8, None),
    ],
    "평가B": [
        (" k7m2qx ", 6, 8, None),   # 소문자·앞뒤 빈칸
        ("R4XT9H", 6, 8, None), ("H9WC3P", 0, 8, None), ("B3NV7K", 3, 8, None),
        ("Z8DQ4T", 5, 8, None), ("M2PF6Y", 4, 8, None), ("T6YH8R", 7, 8, None),
        ("C5JR2W", 3, 8, None),     # 평가A 없음 → 첫 응시 = 기준, 판정 보류
        ("F8UA7G-n", 5, 8, None),   # 비경쟁(소문자 -n)
        ("N4GS9B", 6, 8, None), ("D7VB3M", 2, 8, None),
        ("M2PF6Y", 8, 8, None),     # 중복 제출(먼저 나온 줄만 인정)
        (None, None, None, None),   # 빈 줄
    ],
    "평가C": [
        ("K7M2QX", None, None, 70),     # 정답률만, 정확히 +20%p
        ("R4XT9H", None, None, 67.5),   # 정확히 −20%p
        ("H9WC3P", 2, 8, None), ("Z8DQ4T", 7, 8, None), ("M2PF6Y", 5, 8, None),
        ("T6YH8R", 6, 8, None), ("C5JR2W", 5, 8, None),
        ("W3KE5N", 4, 8, None),         # 첫 응시가 평가C → 판정 보류
        ("F8UA7G", None, None, 17.5),   # 정답률만, 정확히 −20%p
        ("N4GS9B", 4, 8, None),
        ("D7VB3N", 5, 8, None),         # 명단에 없는 코드(오타)
    ],
}

DEFAULTS = {
    "HIGH_CUT": 80, "STEP1": -20, "STEP2": 20,
    "PTS_LOW": 0, "PTS_MID": 10, "PTS_HIGH": 20,
    "GOAL": 15, "DIAG_GAP": 25, "DIAG_ITEMS": 12, "EVAL_ITEMS": 8,
}

SCENARIOS = {
    "1_확정값": {},
    "2_변경A": {"HIGH_CUT": 90, "STEP1": 0, "STEP2": 10, "PTS_MID": 15, "GOAL": 18, "DIAG_GAP": 50},
    "3_변경B": {"HIGH_CUT": 75, "STEP1": -12.5, "STEP2": 12.5, "GOAL": 12, "DIAG_GAP": 10,
                "DIAG_ITEMS": 10, "EVAL_ITEMS": 10},
}
