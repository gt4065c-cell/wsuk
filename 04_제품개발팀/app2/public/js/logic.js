/* =========================================================
   레벨업 캠퍼스 2단계 M1 — 계산 규칙 모음 (logic.js)

   화면·저장과 상관없는 "규칙"만 모았습니다. 그래서
     - 브라우저에서도, 자동 테스트(node)에서도 똑같이 돌고
     - 나중에 Supabase 서버 함수로 옮길 때 그대로 베끼면 됩니다.

   근거: 03_교육기획팀/2026-11-02_2단계_맞춤학습_설계.md (①Elo ②복습 ③힌트 ⑤진단)
         00_캡틴/결재함/2026-11-02_2단계_결재2_설계확정.md (경험치: 완료 10, 복습 혼자 맞힘 +5)
         03_교육기획팀/2026-11-02_2단계_팀게임_설계.md 1-2 (연속 학습일), 1-1 (하루 상한 200)
   ========================================================= */
(function (root) {
  "use strict";

  var C = {
    THETA_MIN: -3, THETA_MAX: 3,
    B_MIN: -2.5, B_MAX: 2.5,
    B_FROM_DIFFICULTY: { 1: -1, 2: 0, 3: 1 },
    ITEM_FIXED_UNTIL: 10,          // 문항 난이도는 응답 10개 전까지 고정
    P_LOW: 0.75, P_HIGH: 0.90, P_TARGET: 0.82,
    RECENT_DAYS: 7,                // 최근 7일 안에 푼 문항은 빼기
    SAME_LECTURE_RUN: 3,           // 같은 강 3연속이면 4번째는 다른 강
    NEW_PER_DAY: 5, REVIEW_PER_DAY: 5, REVIEW_SAME_LECTURE_PER_DAY: 2,
    REVIEW_GAP_DAYS: { 1: 1, 2: 3, 3: 7, 4: 14 },
    HINT_WAIT_MS: 10000,
    MAX_SUBMITS: 2,
    XP_COMPLETE: 10,               // 문항을 끝까지 풀면 결과와 상관없이 10
    XP_REVIEW_SOLO_BONUS: 5,       // 복습에서 혼자 맞히면 +5
    XP_DAILY_CAP: 200,             // 연습·복습 XP 하루 상한
    STUDY_DAY_MIN: 3,              // 하루 3문항 이상 끝까지 풀면 '학습한 날'
    PROTECT_PER_WEEK: 2,           // 주(월~일)마다 쉬는 날 보호 2일
    DIAG_COUNT: 12, DIAG_MIN: 10,
    CODE_CHARS: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   // 0·O·1·I 제외
  };

  var OUTCOME = {
    SOLO: "혼자 맞힘",
    HINT: "힌트로 해결",
    SECOND: "두 번째에 맞힘",
    SHOWN: "정답 보고 이해"
  };
  var R_OF = {};
  R_OF[OUTCOME.SOLO] = 1; R_OF[OUTCOME.HINT] = 0.5; R_OF[OUTCOME.SECOND] = 0.5; R_OF[OUTCOME.SHOWN] = 0;

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /* ---------- 1. 참가자 코드 ---------- */
  function normalizeCode(s) { return String(s || "").replace(/\s+/g, "").toUpperCase(); }
  function isValidCodeShape(s) {
    if (s.length !== 6) return false;
    for (var i = 0; i < s.length; i++) if (C.CODE_CHARS.indexOf(s[i]) < 0) return false;
    return true;
  }

  /* ---------- 2. Elo ---------- */
  function guessRate(q) { return 1 / (q.choices ? q.choices.length : (q.type === "ox" ? 2 : 4)); }
  function initialB(q) { return C.B_FROM_DIFFICULTY[q.difficulty] !== undefined ? C.B_FROM_DIFFICULTY[q.difficulty] : 0; }
  /* 맞힐 확률 P = c + (1 − c) / (1 + e^−(θ − b)) */
  function pCorrect(theta, b, c) { return c + (1 - c) / (1 + Math.exp(-(theta - b))); }
  function kLearner(n) { return 0.8 / (1 + 0.05 * n); }
  /* 학습자 실력 고치기: θ ← θ + K × (R − P) */
  function updateTheta(theta, n, R, P) { return clamp(theta + kLearner(n) * (R - P), C.THETA_MIN, C.THETA_MAX); }
  /* 문항 난이도 고치기: 응답 10개 전에는 그대로, 그 뒤 b ← b − K × (R − P) */
  function updateB(b, nItem, R, P) {
    if (nItem < C.ITEM_FIXED_UNTIL) return b;
    return clamp(b - kLearner(nItem) * (R - P), C.B_MIN, C.B_MAX);
  }
  /* 한 문항 마감 → 새 θ, 새 b (n값은 반영 전 값) */
  function applyElo(st, item, q, R) {
    var c = guessRate(q);
    var P = pCorrect(st.theta, item.b, c);
    return {
      P: P,
      theta: updateTheta(st.theta, st.n, R, P),
      n: st.n + 1,
      b: updateB(item.b, item.n, R, P),
      itemN: item.n + 1
    };
  }

  /* ---------- 3. 진단 ---------- */
  /* answers: [{qid, choice(null=모르겠어요)}] 순서대로. key[qid].answer_index 로 채점 */
  function scoreDiagnostic(questions, answers, key) {
    var byId = {}; questions.forEach(function (q) { byId[q.id] = q; });
    var theta = 0, n = 0, rows = [];
    answers.forEach(function (a) {
      var q = byId[a.qid]; if (!q) return;
      var correct = a.choice !== null && a.choice !== undefined && a.choice === key[a.qid].answer_index;
      var R = correct ? 1 : 0;
      var P = pCorrect(theta, initialB(q), guessRate(q));
      theta = updateTheta(theta, n, R, P); n++;
      rows.push({ qid: q.id, lecture: q.lecture, difficulty: q.difficulty, correct: correct, unknown: a.choice === null });
    });
    var strong = rows.filter(function (r) { return r.correct; })
      .sort(function (a, b) { return b.difficulty - a.difficulty || a.lecture - b.lecture; })
      .slice(0, 2).map(function (r) { return r.lecture; });
    var weak = rows.filter(function (r) { return !r.correct; })
      .sort(function (a, b) { return a.difficulty - b.difficulty || a.lecture - b.lecture; })
      .slice(0, 2).map(function (r) { return r.lecture; });
    return { theta: theta, n: n, rows: rows, strong: strong, weak: weak };
  }

  /* ---------- 4. 날짜 (한국 시간 기준 'YYYY-MM-DD') ---------- */
  function dayKey(ms) {
    var d = new Date(ms + 9 * 3600 * 1000);   // 한국 시간 = 세계 표준시 + 9시간
    return d.toISOString().slice(0, 10);
  }
  function addDays(day, k) {
    var d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }
  function weekKey(day) {   // 그 주 월요일
    var d = new Date(day + "T00:00:00Z"); var w = (d.getUTCDay() + 6) % 7;
    return addDays(day, -w);
  }

  /* ---------- 5. 다음 연습 문제 고르기 (E1~E6) ---------- */
  /* ctx = {theta, questions, items:{qid:{b,n}}, history:[{qid, day, outcome, mode}], reviewIds:[],
            today, openUpTo, recent:[최근 마감 결과 {qid, lecture, R}], exclude:[], rand} */
  function pickNext(ctx) {
    var rand = ctx.rand || Math.random;
    var lastDay = {};
    (ctx.history || []).forEach(function (h) {
      if (!lastDay[h.qid] || h.day >= lastDay[h.qid]) lastDay[h.qid] = h.day;
    });
    var inReview = {}; (ctx.reviewIds || []).forEach(function (id) { inReview[id] = true; });
    var excl = {}; (ctx.exclude || []).forEach(function (id) { excl[id] = true; });
    var open = ctx.questions.filter(function (q) { return q.lecture <= ctx.openUpTo && !excl[q.id]; });
    // E1
    var cand = open.filter(function (q) {
      if (inReview[q.id]) return false;
      if (lastDay[q.id] && daysBetween(lastDay[q.id], ctx.today) < C.RECENT_DAYS) return false;
      return true;
    });
    // E6: 안 푼 문항이 없으면 7일 지난 문항(복습 상자 밖 = '혼자 맞힘'·'복습 완료')이 다시 후보.
    //     E1이 이미 '7일 지난 + 복습 상자 밖' 문항을 남겨 두므로 따로 할 일 없음. 그마저 0개면 null.
    if (!cand.length) return null;
    var reused = cand.every(function (q) { return lastDay[q.id]; });
    // E5: 같은 강 3연속이면 다른 강
    var rec = ctx.recent || [];
    if (rec.length >= C.SAME_LECTURE_RUN) {
      var tail = rec.slice(-C.SAME_LECTURE_RUN), L = tail[0].lecture;
      if (tail.every(function (r) { return r.lecture === L; })) {
        var other = cand.filter(function (q) { return q.lecture !== L; });
        if (other.length) cand = other;
      }
    }
    var withP = cand.map(function (q) {
      var it = (ctx.items && ctx.items[q.id]) || { b: initialB(q), n: 0 };
      return { q: q, P: pCorrect(ctx.theta, it.b, guessRate(q)), unseen: !lastDay[q.id] };
    });
    // E4: 바로 전 2문항이 연속 R = 0 → P가 가장 높은 문항 + 개념 정리 카드
    if (rec.length >= 2 && rec[rec.length - 1].R === 0 && rec[rec.length - 2].R === 0) {
      withP.sort(function (a, b) { return b.P - a.P; });
      return { qid: withP[0].q.id, P: withP[0].P, rule: "E4", conceptCard: true, reused: reused };
    }
    // E2
    var inBand = withP.filter(function (x) { return x.P >= C.P_LOW && x.P <= C.P_HIGH; });
    if (inBand.length) {
      var unseen = inBand.filter(function (x) { return x.unseen; });
      var pool = unseen.length ? unseen : inBand;
      var pick = pool[Math.floor(rand() * pool.length)];
      return { qid: pick.q.id, P: pick.P, rule: "E2", conceptCard: false, reused: reused };
    }
    // E3
    withP.sort(function (a, b) { return Math.abs(a.P - C.P_TARGET) - Math.abs(b.P - C.P_TARGET); });
    return { qid: withP[0].q.id, P: withP[0].P, rule: "E3", conceptCard: false, reused: reused };
  }

  /* ---------- 6. 힌트 사다리 + 제출 ---------- */
  /* 문항 하나의 상태: {mode, level(본 힌트 단계 0~4), lastOpenAt, submits:[bool], closed, outcome, thought} */
  function newItemState(mode) { return { mode: mode, level: 0, lastOpenAt: 0, submits: [], closed: false, outcome: null }; }
  /* 다음 힌트를 열 수 있나? → {ok, reason, waitMs} */
  function canOpenHint(st, now, thought, hasHints) {
    if (st.mode !== "PRACTICE" && st.mode !== "REVIEW") return { ok: false, reason: "off" };
    if (st.closed) return { ok: false, reason: "closed" };
    var next = st.level + 1;
    if (next > 4) return { ok: false, reason: "max" };
    if (next <= 3 && !hasHints) return { ok: false, reason: "not-ready" };
    if (next >= 2) {
      var wait = st.lastOpenAt + C.HINT_WAIT_MS - now;
      if (wait > 0) return { ok: false, reason: "wait", waitMs: wait };
    }
    if (next >= 3 && !(thought && String(thought).trim())) return { ok: false, reason: "thought" };
    if (next === 4 && st.submits.length < 1) return { ok: false, reason: "submit-first" };
    return { ok: true };
  }
  function openHint(st, now, thought, hasHints) {
    var r = canOpenHint(st, now, thought, hasHints);
    if (!r.ok) return r;
    st.level++; st.lastOpenAt = now;
    if (st.level === 4) { st.closed = true; st.outcome = OUTCOME.SHOWN; }
    return { ok: true, level: st.level };
  }
  /* 답 제출 → {closed, correct} */
  function submit(st, correct) {
    if (st.closed) return { closed: true, correct: correct, ignored: true };
    st.submits.push(!!correct);
    if (correct) { st.closed = true; st.outcome = outcomeOf(st); }
    else if (st.submits.length >= C.MAX_SUBMITS) { st.closed = true; st.outcome = OUTCOME.SHOWN; }
    return { closed: st.closed, correct: correct };
  }
  function outcomeOf(st) {
    if (st.level >= 4) return OUTCOME.SHOWN;
    var s = st.submits;
    if (!s[s.length - 1]) return OUTCOME.SHOWN;
    if (st.level >= 1) return OUTCOME.HINT;
    if (s.length === 1) return OUTCOME.SOLO;
    return OUTCOME.SECOND;
  }

  /* ---------- 7. 경험치 ---------- */
  /* mode: PRACTICE | REVIEW, xpToday: 오늘 이미 받은 연습·복습 XP */
  function xpFor(mode, outcome, xpToday) {
    var raw = C.XP_COMPLETE;
    if (mode === "REVIEW" && outcome === OUTCOME.SOLO) raw += C.XP_REVIEW_SOLO_BONUS;
    var room = Math.max(0, C.XP_DAILY_CAP - (xpToday || 0));
    return Math.min(raw, room);
  }

  /* ---------- 8. 복습 상자 (R1~R5) ---------- */
  /* 연습 마감 뒤: 혼자 맞힘이 아니면 상자 1 */
  function reviewAfterPractice(outcome, today) {
    if (outcome === OUTCOME.SOLO) return null;
    return { box: 1, due: addDays(today, C.REVIEW_GAP_DAYS[1]) };
  }
  /* 복습 마감 뒤: 혼자 맞힘 → 상자 +1 (4에서 맞히면 끝 = null), 아니면 상자 1 */
  function reviewAfterReview(entry, outcome, today) {
    if (outcome !== OUTCOME.SOLO) return { box: 1, due: addDays(today, 1), done: false };
    if (entry.box >= 4) return { done: true };
    var nb = entry.box + 1;
    return { box: nb, due: addDays(today, C.REVIEW_GAP_DAYS[nb]), done: false };
  }
  /* 오늘 복습: 복습일이 오늘 이하, 오래 밀린 순, 최대 5개, 같은 강 최대 2개 */
  function pickReviews(entries, lectureOf, today) {
    var due = entries.filter(function (e) { return e.due <= today; })
      .sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.qid < b.qid ? -1 : 1); });
    var out = [], perLec = {};
    for (var i = 0; i < due.length && out.length < C.REVIEW_PER_DAY; i++) {
      var L = lectureOf(due[i].qid);
      if ((perLec[L] || 0) >= C.REVIEW_SAME_LECTURE_PER_DAY) continue;
      perLec[L] = (perLec[L] || 0) + 1; out.push(due[i].qid);
    }
    return out;
  }

  /* ---------- 9. 연속 학습일 ---------- */
  /* countsByDay: {"2026-12-01": 마감한 문항 수}. 오늘 아직 안 했으면 끊긴 것으로 치지 않음 */
  function streak(countsByDay, today) {
    var days = Object.keys(countsByDay).filter(function (d) { return countsByDay[d] >= C.STUDY_DAY_MIN; }).sort();
    if (!days.length) return { current: 0, studied: 0, protectedDays: 0, longest: 0 };
    var study = {}; days.forEach(function (d) { study[d] = true; });
    var cur = 0, studied = 0, prot = 0, longest = 0, used = {};
    for (var d = days[0]; d <= today; d = addDays(d, 1)) {
      if (study[d]) { cur++; studied++; }
      else if (d === today) { /* 오늘은 아직 진행 중 */ }
      else {
        var w = weekKey(d);
        if ((used[w] || 0) < C.PROTECT_PER_WEEK && cur > 0) { used[w] = (used[w] || 0) + 1; cur++; prot++; }
        else { cur = 0; studied = 0; prot = 0; }
      }
      if (cur > longest) longest = cur;
    }
    return { current: cur, studied: studied, protectedDays: prot, longest: longest };
  }

  var api = {
    C: C, OUTCOME: OUTCOME, R_OF: R_OF,
    normalizeCode: normalizeCode, isValidCodeShape: isValidCodeShape,
    guessRate: guessRate, initialB: initialB, pCorrect: pCorrect, kLearner: kLearner,
    updateTheta: updateTheta, updateB: updateB, applyElo: applyElo,
    scoreDiagnostic: scoreDiagnostic,
    dayKey: dayKey, addDays: addDays, daysBetween: daysBetween, weekKey: weekKey,
    pickNext: pickNext,
    newItemState: newItemState, canOpenHint: canOpenHint, openHint: openHint, submit: submit, outcomeOf: outcomeOf,
    xpFor: xpFor,
    reviewAfterPractice: reviewAfterPractice, reviewAfterReview: reviewAfterReview, pickReviews: pickReviews,
    streak: streak
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LU = api;
})(typeof window !== "undefined" ? window : this);
