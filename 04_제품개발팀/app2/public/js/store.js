/* =========================================================
   데이터 저장 창구 (store.js)

   화면(app.js)은 데이터를 오직 이 창구(window.STORE)로만 주고받습니다.
   그래서 나중에 저장 장소를 Supabase로 바꿀 때 이 파일만 고치면 됩니다.

   창구가 하는 일 (모두 Promise = "조금 뒤에 답을 주는 약속"을 돌려줌):
     login(code)            코드 확인 → 학생 정보
     session() / logout()   자동 로그인 / 나가기
     setNickname(name)      별명 정하기 (처음 1번)
     practiceQuestions()    연습 문항 목록 (정답 포함 — 연습은 공개해도 되는 문항)
     hints(qid)             미리 만든 힌트 L1~L3 (검토 끝난 것만)
     diagnostic()           진단 12문항 (정답 없음) + 지금까지 고른 답 수
     answerDiagnostic(qid, choice)   진단 답 저장 (정오답 알려 주지 않음)
     finishDiagnostic()     진단 채점 → 출발 실력 + 해설
     today()                홈 화면 숫자 (오늘 복습 목록, 새 문제 진행, 경험치, 연속 학습일)
     nextPractice(recent, exclude)   다음 연습 문제 하나 (Elo 맞춤)
     closeItem(rec)         문항 마감 기록 → 경험치·복습 상자·Elo 반영

   화면에는 실력 숫자 θ·난이도 b·확률 P를 절대 돌려주지 않습니다(설계 E7).
   (단, 자동 테스트를 위해 로컬 모드에만 _debug()가 있습니다.)
   ========================================================= */
(function () {
  "use strict";
  var CFG = window.LU_CONFIG || {};
  var LU = window.LU;
  var O = LU.OUTCOME;

  /* ================================================================
     A. 로컬 모드 — 브라우저 저장소(localStorage) + 가짜 사용자
     ================================================================ */
  var DB_KEY = "lu2_local_db_v1";
  var SESSION_KEY = "lu2_local_session";
  var OFFSET_KEY = "lu2_dev_day_offset";   // [개발용] 날짜 앞당기기(자동 테스트용)
  var mem = {};                              // 저장소가 막힌 브라우저용 임시 메모

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return has(mem, k) ? mem[k] : null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function now() { return Date.now() + (Number(lsGet(OFFSET_KEY)) || 0) * 86400000; }
  function today() { return LU.dayKey(now()); }

  function loadDb() {
    var raw = lsGet(DB_KEY), db = null;
    try { db = raw ? JSON.parse(raw) : null; } catch (e) { db = null; }
    if (!db || db.v !== 1) db = { v: 1, students: {}, items: {}, attempts: [], diag: {}, review: {} };
    return db;
  }
  function saveDb(db) { lsSet(DB_KEY, JSON.stringify(db)); }

  var PRACTICE = (window.LU_PRACTICE && window.LU_PRACTICE.questions) || [];
  var QBY = {}; PRACTICE.forEach(function (q) { QBY[q.id] = q; });
  var DIAG = (window.LU_DIAG && window.LU_DIAG.questions) || [];
  var HINTS = (window.LU_HINTS && window.LU_HINTS.hints) || {};
  var HINTS_FAKE = !!(window.LU_HINTS && window.LU_HINTS.fake);

  function publicStudent(s, db) {
    // 화면에 넘기는 학생 정보 (θ 없음)
    var d = db.diag[s.code] || { answers: [], done: false };
    return { code: s.code, nickname: s.nickname || "", xp: s.xp, diagAnswered: d.answers.length, diagDone: !!d.done };
  }
  function current(db) {
    var code = lsGet(SESSION_KEY);
    return code && db.students[code] ? db.students[code] : null;
  }
  function needLogin() { return Promise.reject(new Error("로그인이 필요해요")); }

  /* [개발용] 진단 정답 파일을 그때 그때 읽음 — 학생 화면 파일(diagnostic.js)에는 정답이 없음 */
  var devKeyPromise = null;
  function devDiagKey() {
    if (window.LU_DEV_DIAG_KEY) return Promise.resolve(window.LU_DEV_DIAG_KEY);
    if (!devKeyPromise) devKeyPromise = new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = "data/dev_diag_key.js";
      s.onload = function () { window.LU_DEV_DIAG_KEY ? ok(window.LU_DEV_DIAG_KEY) : no(new Error("개발용 진단 정답 파일이 비어 있어요")); };
      s.onerror = function () { devKeyPromise = null; no(new Error("개발용 진단 정답 파일(data/dev_diag_key.js)을 읽지 못했어요")); };
      document.head.appendChild(s);
    });
    return devKeyPromise;
  }

  function xpToday(db, code, day) {
    return db.attempts.filter(function (a) { return a.code === code && a.day === day; })
      .reduce(function (t, a) { return t + (a.xp || 0); }, 0);
  }

  var LocalStore = {
    mode: "local",
    devLabel: "로컬 모드(개발용) · 기록은 이 브라우저에만 저장돼요",
    hintsAreFake: HINTS_FAKE,
    now: now,

    login: function (input) {
      var code = LU.normalizeCode(input);
      if (!LU.isValidCodeShape(code)) return Promise.resolve({ ok: false, error: "shape" });
      if ((CFG.DEV_CODES || []).indexOf(code) < 0) return Promise.resolve({ ok: false, error: "unknown" });
      var db = loadDb();
      if (!db.students[code]) db.students[code] = { code: code, nickname: "", theta: 0, n: 0, xp: 0, created: today() };
      saveDb(db); lsSet(SESSION_KEY, code);
      return Promise.resolve({ ok: true, student: publicStudent(db.students[code], db) });
    },
    session: function () {
      var db = loadDb(), s = current(db);
      return Promise.resolve(s ? publicStudent(s, db) : null);
    },
    logout: function () { lsDel(SESSION_KEY); return Promise.resolve(); },
    setNickname: function (name) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      s.nickname = String(name).trim().slice(0, 12); saveDb(db);
      return Promise.resolve(publicStudent(s, db));
    },

    practiceQuestions: function () { return Promise.resolve(PRACTICE); },
    question: function (qid) { return Promise.resolve(QBY[qid] || null); },
    hints: function (qid) { return Promise.resolve(HINTS[qid] ? { L1: HINTS[qid].L1, L2: HINTS[qid].L2, L3: HINTS[qid].L3, fake: HINTS_FAKE } : null); },

    diagnostic: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var d = db.diag[s.code] || { answers: [], done: false };
      return Promise.resolve({ questions: DIAG, answered: d.answers.map(function (a) { return a.qid; }), done: !!d.done });
    },
    answerDiagnostic: function (qid, choice) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var d = db.diag[s.code] = db.diag[s.code] || { answers: [], done: false };
      if (d.done) return Promise.resolve({ answered: d.answers.length });
      if (!DIAG.some(function (q) { return q.id === qid; })) return Promise.reject(new Error("진단 문항이 아니에요"));
      if (!d.answers.some(function (a) { return a.qid === qid; })) d.answers.push({ qid: qid, choice: choice === null ? null : Number(choice) });
      saveDb(db);
      return Promise.resolve({ answered: d.answers.length });   // 정오답은 알려 주지 않음 (D1)
    },
    finishDiagnostic: function () {
      return devDiagKey().then(function (key) {
        var db = loadDb(), s = current(db); if (!s) throw new Error("로그인이 필요해요");
        var d = db.diag[s.code] || { answers: [] };
        if (d.answers.length < LU.C.DIAG_MIN) throw new Error("진단은 10문항 이상 답해야 끝낼 수 있어요");
        var r = LU.scoreDiagnostic(DIAG, d.answers, key);
        if (!d.done) { s.theta = r.theta; s.n = r.n; d.done = true; d.doneDay = today(); }
        db.diag[s.code] = d; saveDb(db);
        var picked = {}; d.answers.forEach(function (a) { picked[a.qid] = a.choice; });
        return {
          strong: r.strong, weak: r.weak,
          review: DIAG.filter(function (q) { return has(picked, q.id); }).map(function (q) {
            return { q: q, yourChoice: picked[q.id], answer_index: key[q.id].answer_index,
                     explanation: key[q.id].explanation, common_wrong_reason: key[q.id].common_wrong_reason };
          }),
          devKey: true
        };
      });
    },

    today: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var day = today();
      var entries = Object.keys(db.review[s.code] || {}).map(function (qid) {
        var e = db.review[s.code][qid]; return { qid: qid, box: e.box, due: e.due };
      });
      var reviews = LU.pickReviews(entries, function (id) { return QBY[id] ? QBY[id].lecture : 0; }, day);
      var mine = db.attempts.filter(function (a) { return a.code === s.code; });
      var counts = {}; mine.forEach(function (a) { counts[a.day] = (counts[a.day] || 0) + 1; });
      var newDone = mine.filter(function (a) { return a.day === day && a.mode === "PRACTICE"; }).length;
      var reviewDone = mine.filter(function (a) { return a.day === day && a.mode === "REVIEW"; }).length;
      var week = LU.weekKey(day);
      var weekXp = mine.filter(function (a) { return a.day >= week; }).reduce(function (t, a) { return t + a.xp; }, 0);
      return Promise.resolve({
        day: day, reviews: reviews, newDone: newDone, newTarget: LU.C.NEW_PER_DAY, reviewDone: reviewDone,
        xp: s.xp, xpToday: xpToday(db, s.code, day), weekXp: weekXp,
        weekSolved: mine.filter(function (a) { return a.day >= week; }).length,
        streak: LU.streak(counts, day)
      });
    },

    nextPractice: function (recent, exclude) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var day = today();
      var r = LU.pickNext({
        theta: s.theta, questions: PRACTICE, items: db.items,
        history: db.attempts.filter(function (a) { return a.code === s.code; }),
        reviewIds: Object.keys(db.review[s.code] || {}),
        today: day, openUpTo: CFG.OPEN_UP_TO_LECTURE || 99,
        recent: recent || [], exclude: exclude || []
      });
      // 화면에는 문항 번호와 '개념 정리 카드' 여부만 (P값은 숨김)
      return Promise.resolve(r ? { qid: r.qid, conceptCard: r.conceptCard } : null);
    },

    /* rec = {qid, mode: PRACTICE|REVIEW, outcome, level(본 힌트 단계), submits:[원래 보기 번호...]} */
    closeItem: function (rec) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var q = QBY[rec.qid]; if (!q) return Promise.reject(new Error("없는 문항"));
      if (rec.mode !== "PRACTICE" && rec.mode !== "REVIEW") return Promise.reject(new Error("모드 오류"));
      if (!has(LU.R_OF, rec.outcome)) return Promise.reject(new Error("결과 이름 오류"));
      var day = today();
      var xp = LU.xpFor(rec.mode, rec.outcome, xpToday(db, s.code, day));
      var R = LU.R_OF[rec.outcome];
      var reviewNote = null;
      var box = db.review[s.code] = db.review[s.code] || {};
      if (rec.mode === "PRACTICE") {
        // Elo는 문항 하나당 한 번, 연습에서만. 문항 응답 수는 학습자별 첫 응답만 셈
        var item = db.items[q.id] || { b: LU.initialB(q), n: 0 };
        var first = !db.attempts.some(function (a) { return a.code === s.code && a.qid === q.id; });
        var e = LU.applyElo(s, item, q, R);
        s.theta = e.theta; s.n = e.n;
        if (first) { item.b = e.b; item.n = e.itemN; }
        db.items[q.id] = item;
        var nb = LU.reviewAfterPractice(rec.outcome, day);
        if (nb) { box[q.id] = nb; reviewNote = "again"; }
      } else {
        var cur = box[q.id] || { box: 1, due: day };
        var nx = LU.reviewAfterReview(cur, rec.outcome, day);
        if (nx.done) { delete box[q.id]; reviewNote = "review-done"; }
        else { box[q.id] = { box: nx.box, due: nx.due }; reviewNote = rec.outcome === O.SOLO ? "box-up" : "again"; }
      }
      s.xp += xp;
      db.attempts.push({ code: s.code, qid: q.id, mode: rec.mode, outcome: rec.outcome, level: rec.level,
                         submits: rec.submits, xp: xp, day: day, at: now() });
      saveDb(db);
      return Promise.resolve({ xp: xp, xpTotal: s.xp, reviewNote: reviewNote });
    },

    /* [개발용] 자동 테스트가 속을 들여다보는 문. 화면 코드는 쓰지 않음. Supabase 모드에는 없음 */
    _debug: function () {
      var db = loadDb(), s = current(db);
      return { db: db, me: s, today: today() };
    },
    _resetAll: function () { lsDel(DB_KEY); lsDel(SESSION_KEY); }
  };

  /* ================================================================
     B. Supabase 모드 — 자리만 비워 둠 (캡틴 계정 연결 후 채움)
        채울 때: supabase/schema.sql 의 서버 함수(RPC)를 같은 이름으로 부름
          login           → rpc('claim_code', {p_code})   (익명 로그인 뒤 코드 연결)
          answerDiagnostic→ rpc('diag_answer', ...)
          finishDiagnostic→ rpc('diag_finish')            (서버가 채점 — 정답은 화면으로 안 옴)
          nextPractice    → rpc('next_practice', ...)
          closeItem       → rpc('close_item', ...)         (경험치·Elo·복습 상자는 서버가 계산)
          today           → rpc('today_summary')
     ================================================================ */
  function notYet() { return Promise.reject(new Error("Supabase 모드는 아직 연결 전이에요. config.js 의 MODE 를 \"local\" 로 두세요.")); }
  var SupabaseStore = {
    mode: "supabase", devLabel: "", hintsAreFake: false, now: function () { return Date.now(); },
    login: notYet, session: function () { return Promise.resolve(null); }, logout: notYet, setNickname: notYet,
    practiceQuestions: notYet, question: notYet, hints: notYet,
    diagnostic: notYet, answerDiagnostic: notYet, finishDiagnostic: notYet,
    today: notYet, nextPractice: notYet, closeItem: notYet
  };

  window.STORE = CFG.MODE === "supabase" ? SupabaseStore : LocalStore;
})();
