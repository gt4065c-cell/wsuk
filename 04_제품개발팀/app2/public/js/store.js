/* =========================================================
   데이터 저장 창구 (store.js)

   화면(app.js)은 데이터를 오직 이 창구(window.STORE)로만 주고받습니다.
   그래서 나중에 저장 장소를 바꿔도 화면 코드는 그대로입니다.

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

   두 가지 창구가 같은 모양으로 들어 있습니다.
     A. LocalStore    : 로컬 모드(개발용). 이 브라우저에만 저장
     B. SupabaseStore : Supabase 모드. 실제 서버에 저장 (config.js MODE 또는 주소 ?mode=supabase)

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

  var picks = [];
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
    hints: function (qid) {
      var h = HINTS[qid];
      if (!h || (!h.reviewed && !CFG.SHOW_DRAFT_HINTS)) return Promise.resolve(null);   // 학생용 기준: 검토 끝난 것만
      return Promise.resolve({ L1: h.L1, L2: h.L2, L3: h.L3, fake: HINTS_FAKE, draft: !h.reviewed });
    },

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
      if (r) picks.push({ qid: r.qid, P: r.P, rule: r.rule, theta: s.theta });   // [개발용] 테스트 확인용 메모(저장 안 함)
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
      return { db: db, me: s, today: today(), picks: picks.slice() };
    },
    _resetAll: function () { lsDel(DB_KEY); lsDel(SESSION_KEY); }
  };

  /* ================================================================
     B. Supabase 모드 — 실제 서버(edu-gamify)
        - 처음 [들어가기]를 누를 때 익명 로그인(기기별 임시 계정)을 만들고, 다음부터는 그 세션을 다시 씀
        - 쓰기는 전부 서버 함수(RPC)로만. 표는 읽기만 (DB 규칙이 그렇게 막아 둠)
            login            → rpc claim_code(p_code)
            setNickname      → rpc set_nickname(p_name)
            answerDiagnostic → rpc diag_answer(p_qid, p_choice)
            finishDiagnostic → rpc diag_finish()       (서버가 채점 — 진단 정답은 끝난 뒤 해설로만 옴)
            nextPractice     → rpc next_practice(p_recent, p_exclude)
            closeItem        → rpc close_item(p_qid, p_mode, p_level, p_submits)   (경험치·Elo·복습 상자는 서버 계산)
            today            → rpc today_summary()     (연속 학습일만 화면의 logic.js streak()로 계산)
        - 읽기: questions(연습·진단) · question_keys(연습만) · hints(검토 끝난 것만) · students(내 줄, θ 칸 없음)
                · diag_answers(내 것만)
        - data/dev_diag_key.js 는 이 모드에서 절대 읽지 않음 (devDiagKey()를 부르지 않음)
     ================================================================ */

  /* 서버·네트워크 오류 → 쉬운 한국어 한 줄 */
  var ERR_TEXT = {
    NOT_LINKED: "이 기기가 아직 코드와 연결되지 않았어요. [다른 코드로 들어가기]를 눌러 코드를 다시 넣어 주세요.",
    NO_AUTH: "로그인이 풀렸어요. 새로고침한 뒤 코드를 다시 넣어 주세요.",
    NOT_DIAG: "진단 문항이 아니에요. 새로고침해 주세요.",
    DIAG_TOO_FEW: "진단은 10문항 이상 답해야 끝낼 수 있어요",
    BAD_MODE: "문제 종류가 잘못 전달됐어요. 새로고침해 주세요.",
    PRACTICE_ONLY: "연습 문제가 아니라서 기록하지 못했어요. 새로고침해 주세요.",
    BAD_SUBMITS: "답 기록이 서버 규칙과 맞지 않아 저장하지 못했어요. 새로고침해 주세요.",
    NOT_CLOSED: "아직 끝나지 않은 문제라 저장하지 못했어요. 새로고침해 주세요.",
    L4_BEFORE_SUBMIT: "정답 보기는 답을 한 번 낸 뒤에만 기록돼요.",
    NOT_DUE: "이 복습 문제는 아직 복습할 날이 아니에요. 홈으로 가서 다시 시작해 주세요."
  };
  function explainError(e) {
    var m = String((e && (e.message || e.error_description || e.msg)) || e || "");
    var code = e && (e.code || e.status);
    for (var k in ERR_TEXT) if (has(ERR_TEXT, k) && m.indexOf(k) >= 0) return ERR_TEXT[k];
    if (/anonymous sign-?ins? (are )?disabled/i.test(m)) return "지금은 서버가 새 기기 로그인을 받지 않아요(서버 설정). 교수님께 알려 주세요.";
    if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|ERR_|timeout/i.test(m) || (e && e.name === "TypeError" && /fetch/i.test(m)))
      return "서버에 닿지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.";
    if (code === 429 || code === "429" || /rate limit|too many/i.test(m)) return "잠깐 너무 자주 눌렀어요. 1분쯤 뒤에 다시 해 주세요.";
    if (/jwt|token|refresh/i.test(m)) return "로그인 정보가 만료됐어요. 새로고침한 뒤 코드를 다시 넣어 주세요.";
    if (/permission denied|row-level security/i.test(m)) return "이 정보는 볼 수 없게 막혀 있어요(보안 규칙). 새로고침해 주세요.";
    if (/supabase 라이브러리/.test(m)) return m;
    return "서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요." + (m ? " (" + m.slice(0, 60) + ")" : "");
  }
  function friendly(e) { var x = new Error(explainError(e)); x.raw = e; return x; }

  function loadScript(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { no(new Error("Supabase 라이브러리(" + src + ")를 불러오지 못했어요. 새로고침해 주세요.")); };
      document.head.appendChild(s);
    });
  }
  var clientPromise = null;
  function sb() {
    if (!clientPromise) clientPromise = (window.supabase && window.supabase.createClient ? Promise.resolve() : loadScript("vendor/supabase.js"))
      .then(function () {
        if (!window.supabase || !window.supabase.createClient) throw new Error("Supabase 라이브러리(vendor/supabase.js)가 비어 있어요.");
        if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) throw new Error("config.js 에 SUPABASE_URL·SUPABASE_ANON_KEY 가 비어 있어요.");
        return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "lu2_sb_auth" }
        });
      })
      .catch(function (e) { clientPromise = null; throw e; });
    return clientPromise;
  }
  /* 결과 {data, error} → data 또는 오류 */
  function unwrap(r) { if (r.error) throw r.error; return r.data; }
  function rpc(name, args) {
    return sb().then(function (c) { return c.rpc(name, args || {}); }).then(unwrap);
  }
  /* 세션 있으면 재사용, 없을 때만 익명 로그인 (화면을 열기만 해서는 계정을 만들지 않음) */
  function hasSession() {
    return sb().then(function (c) { return c.auth.getSession(); })
      .then(function (r) { return !!(r && r.data && r.data.session); });
  }
  function ensureAuth() {
    return sb().then(function (c) {
      return c.auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) return c;
        return c.auth.signInAnonymously().then(function (x) { unwrap(x); return c; });
      });
    });
  }

  /* 문항은 한 번 받아 두고 다시 씀 (연습 + 정답·해설, 진단(정답 없음), 검토 끝난 힌트) */
  var QCOLS = "id,part,lecture,difficulty,type,question,choices,source_section";
  var cache = { practice: null, diag: null, hints: null };
  function asChoices(c) { if (typeof c === "string") { try { return JSON.parse(c); } catch (e) { return []; } } return c || []; }
  function loadPractice() {
    if (!cache.practice) cache.practice = sb().then(function (c) {
      return Promise.all([
        c.from("questions").select(QCOLS).eq("pool", "practice").order("id"),
        c.from("question_keys").select("question_id,answer_index,explanation,common_wrong_index,common_wrong_reason")
      ]);
    }).then(function (r) {
      var qs = unwrap(r[0]) || [], keys = {};
      (unwrap(r[1]) || []).forEach(function (k) { keys[k.question_id] = k; });
      var list = [], by = {};
      qs.forEach(function (q) {
        var k = keys[q.id]; if (!k) return;   // 정답이 없는 연습 문항은 내지 않음
        var x = { id: q.id, part: q.part, lecture: q.lecture, difficulty: q.difficulty, type: q.type, question: q.question,
                  choices: asChoices(q.choices), answer_index: k.answer_index, explanation: k.explanation || "",
                  common_wrong_index: k.common_wrong_index, common_wrong_reason: k.common_wrong_reason || "",
                  source_section: q.source_section || "" };
        list.push(x); by[x.id] = x;
      });
      return { list: list, by: by };
    }).catch(function (e) { cache.practice = null; throw e; });
    return cache.practice;
  }
  function loadDiag() {
    if (!cache.diag) cache.diag = sb().then(function (c) {
      return c.from("questions").select(QCOLS + ",diag_order").eq("pool", "diagnostic").order("diag_order");
    }).then(function (r) {
      var list = (unwrap(r) || []).map(function (q) {
        return { id: q.id, part: q.part, lecture: q.lecture, difficulty: q.difficulty, type: q.type, question: q.question,
                 choices: asChoices(q.choices), source_section: q.source_section || "" };
      });
      var by = {}; list.forEach(function (q) { by[q.id] = q; });
      return { list: list, by: by };
    }).catch(function (e) { cache.diag = null; throw e; });
    return cache.diag;
  }
  function loadHints() {
    // DB 규칙(hints_reviewed)이 검토 끝난 연습 문항 힌트만 돌려줌. 없으면 화면은 "힌트 준비 중"
    if (!cache.hints) cache.hints = sb().then(function (c) { return c.from("hints").select("question_id,l1,l2,l3"); })
      .then(function (r) { var m = {}; (unwrap(r) || []).forEach(function (h) { m[h.question_id] = h; }); return m; })
      .catch(function (e) { cache.hints = null; throw e; });
    return cache.hints;
  }

  /* 내 학생 정보 (θ 칸은 DB에서 아예 못 읽음). 코드와 연결 안 된 기기면 null */
  function me() {
    return sb().then(function (c) {
      return Promise.all([
        c.from("students").select("code,nickname,xp,diag_done").maybeSingle(),
        c.from("diag_answers").select("question_id")
      ]);
    }).then(function (r) {
      var s = unwrap(r[0]); if (!s) return null;
      var answered = unwrap(r[1]) || [];
      return { code: s.code, nickname: s.nickname || "", xp: s.xp || 0, diagAnswered: answered.length, diagDone: !!s.diag_done,
               _answered: answered.map(function (a) { return a.question_id; }) };
    });
  }
  function strip(s) { if (!s) return s; var o = {}; for (var k in s) if (has(s, k) && k[0] !== "_") o[k] = s[k]; return o; }

  var SupabaseStore = {
    mode: "supabase", devLabel: "", hintsAreFake: false,
    now: function () { return Date.now(); },
    explainError: explainError,   // 오류 문장 바꾸기 (자동 테스트도 씀 — 비밀 정보 없음)

    login: function (input) {
      var code = LU.normalizeCode(input);
      // 모양이 틀리면 서버에 묻지도, 계정을 만들지도 않음
      if (!LU.isValidCodeShape(code)) return Promise.resolve({ ok: false, error: "shape" });
      return ensureAuth().then(function () { return rpc("claim_code", { p_code: code }); })
        .then(function (r) {
          if (!r || !r.ok) return { ok: false, error: (r && r.error) || "unknown" };
          var st = r.student || {};
          return { ok: true, student: { code: st.code, nickname: st.nickname || "", xp: st.xp || 0,
                                        diagAnswered: Number(st.diagAnswered) || 0, diagDone: !!st.diagDone } };
        })
        .catch(function (e) { throw friendly(e); });
    },
    session: function () {
      return hasSession().then(function (yes) { return yes ? me() : null; })
        .then(strip)
        .catch(function (e) {
          // 저장된 로그인이 망가졌으면(만료·삭제된 임시 계정) 이 기기 세션만 지우고 코드 입력 화면으로
          var m = String((e && e.message) || e);
          if ((e && (e.status === 401 || e.code === "PGRST301" || e.code === "PGRST303")) || /jwt|refresh token|invalid claim|session/i.test(m)) {
            return sb().then(function (c) { return c.auth.signOut({ scope: "local" }); }).then(function () { return null; }, function () { return null; });
          }
          throw friendly(e);
        });
    },
    logout: function () {
      // 이 기기의 임시 계정 세션만 지움 (서버의 학생 기록은 그대로 — 같은 코드로 다시 들어오면 이어짐)
      cache.hints = null;
      return sb().then(function (c) { return c.auth.signOut({ scope: "local" }); })
        .then(function () {}, function () {});
    },
    setNickname: function (name) {
      return rpc("set_nickname", { p_name: String(name).trim().slice(0, 12) })
        .then(me).then(function (s) { if (!s) throw new Error("NOT_LINKED"); return strip(s); })
        .catch(function (e) { throw friendly(e); });
    },

    practiceQuestions: function () {
      return loadPractice().then(function (p) { return p.list; }).catch(function (e) { throw friendly(e); });
    },
    question: function (qid) {
      return loadPractice().then(function (p) { return p.by[qid] || null; }).catch(function (e) { throw friendly(e); });
    },
    hints: function (qid) {
      return loadHints().then(function (m) {
        var h = m[qid];
        return h ? { L1: h.l1, L2: h.l2, L3: h.l3, fake: false, draft: false } : null;
      }).catch(function (e) { throw friendly(e); });
    },

    diagnostic: function () {
      return Promise.all([loadDiag(), me()]).then(function (r) {
        var s = r[1]; if (!s) throw new Error("NOT_LINKED");
        return { questions: r[0].list, answered: s._answered, done: s.diagDone };
      }).catch(function (e) { throw friendly(e); });
    },
    answerDiagnostic: function (qid, choice) {
      return rpc("diag_answer", { p_qid: qid, p_choice: choice === null || choice === undefined ? null : Number(choice) })
        .then(function (n) { return { answered: Number(n) || 0 }; })   // 정오답은 서버도 알려 주지 않음
        .catch(function (e) { throw friendly(e); });
    },
    finishDiagnostic: function () {
      return Promise.all([rpc("diag_finish"), loadDiag()]).then(function (r) {
        var res = r[0] || {}, by = r[1].by;
        return {
          strong: res.strong || [], weak: res.weak || [],
          review: (res.review || []).filter(function (x) { return by[x.qid]; }).map(function (x) {
            return { q: by[x.qid], yourChoice: x.yourChoice === undefined ? null : x.yourChoice, answer_index: x.answer_index,
                     explanation: x.explanation || "", common_wrong_reason: x.common_wrong_reason || "" };
          }),
          devKey: false
        };
      }).catch(function (e) { throw friendly(e); });
    },

    today: function () {
      return rpc("today_summary").then(function (t) {
        t = t || {};
        var day = String(t.day || LU.dayKey(Date.now())).slice(0, 10);
        return {
          day: day, reviews: t.reviews || [], newDone: Number(t.newDone) || 0, newTarget: Number(t.newTarget) || LU.C.NEW_PER_DAY,
          reviewDone: 0, xp: Number(t.xp) || 0, xpToday: Number(t.xpToday) || 0, weekXp: Number(t.weekXp) || 0,
          weekSolved: Number(t.weekSolved) || 0,
          streak: LU.streak(t.counts || {}, day)
        };
      }).catch(function (e) { throw friendly(e); });
    },
    nextPractice: function (recent, exclude) {
      // 서버가 Elo로 고름. 화면에는 문항 번호와 '개념 정리 카드' 여부만 옴 (P값 없음)
      var rec = (recent || []).map(function (x) { return { qid: x.qid, lecture: x.lecture, R: x.R }; });
      return Promise.all([rpc("next_practice", { p_recent: rec, p_exclude: (exclude || []).slice() }), loadPractice()])
        .then(function (r) {
          var p = r[0];
          if (!p || !p.qid) return null;
          if (!r[1].by[p.qid]) throw new Error("서버가 고른 문항(" + p.qid + ")을 화면 문항 목록에서 찾지 못했어요");
          return { qid: p.qid, conceptCard: !!p.conceptCard };
        }).catch(function (e) { throw friendly(e); });
    },
    closeItem: function (rec) {
      return rpc("close_item", { p_qid: rec.qid, p_mode: rec.mode, p_level: Number(rec.level) || 0,
                                 p_submits: (rec.submits || []).map(Number) })
        .then(function (r) {
          r = r || {};
          if (r.outcome && rec.outcome && r.outcome !== rec.outcome && window.console) {
            console.warn("[레벨업] 화면과 서버의 결과 이름이 달라요:", rec.outcome, "→ 서버", r.outcome);
          }
          return { xp: Number(r.xp) || 0, xpTotal: Number(r.xpTotal) || 0, reviewNote: r.reviewNote || null, outcome: r.outcome };
        }).catch(function (e) { throw friendly(e); });
    }
  };

  window.STORE = CFG.MODE === "supabase" ? SupabaseStore : LocalStore;
})();
