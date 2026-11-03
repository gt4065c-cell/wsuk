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
     conceptCard(lecture)   강별 개념 정리 카드 {title, lines:[3줄]} (검토 끝난 것만, 없으면 null) — E4 개념 정리 카드
     diagnostic()           진단 12문항 (정답 없음) + 지금까지 고른 답 수
     answerDiagnostic(qid, choice)   진단 답 저장 (정오답 알려 주지 않음)
     finishDiagnostic()     진단 채점 → 출발 실력 + 해설
     today()                홈 화면 숫자 (오늘 복습 목록, 새 문제 진행, 경험치, 연속 학습일)
     nextPractice(recent, exclude)   다음 연습 문제 하나 (Elo 맞춤)
     closeItem(rec)         문항 마감 기록 → 경험치·복습 상자·Elo 반영
     myTeam()               [M2] 내 팀 요약 (팀원 별명·이번 주 팀 합계·참여 목표 달성 여부. 팀원 개인 숫자 없음)
     setTeamOff(off)        [M2] 팀 활동 쉬기 / 다시 하기 → 바뀐 팀 요약
     tutorStatus()          [M2 2차] AI 튜터 켜짐 여부 + 오늘 남은 횟수
     askTutor(rq)           [M2 2차] AI 튜터에게 질문 {qid, level, tried, question} → {ok, kind, reply, state} (로컬 모드는 가짜 응답)
     weeklyStatus()         [M2 3차] 이번 주 공통 점검: 열림 여부·주차·응시 완료·다시 볼 강·팀원 n/m명 응시 (점수 없음)
     weeklyItems()          [M2 3차] 이번 주 공통 점검 문항 (정답 없음)
     submitWeekly(answers)  [M2 3차] {문항번호: 보기 번호 | null} 한꺼번에 제출 → {done, week, reviewLectures} (서버 채점, 점수 없음)
     teamExplainer()        [M2 3차] 우리 팀 이번 주 해설 당번 (당번 별명·문항·올라온 해설 — 같은 팀만)
     writeExplainer(qid, body)  [M2 3차] 당번이 해설 쓰기(200자 안)

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
  var CARDS = (window.LU_CONCEPTS && window.LU_CONCEPTS.cards) || {};   // 강 번호 → {title, lines} (build_data.py, 검토 끝난 것만)
  function normCard(c) {
    if (!c || !Array.isArray(c.lines)) return null;
    var lines = c.lines.map(function (x) { return String(x == null ? "" : x).trim(); }).filter(Boolean).slice(0, 5);
    return lines.length ? { title: String(c.title || ""), lines: lines } : null;
  }

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
  // [QA #10] 진단 먼저 (서버 lu_diag_ready 와 같은 기준: 진단 끝냄 또는 10문항 이상 답함)
  function diagReady(db, s) { var d = db.diag[s.code] || { answers: [], done: false }; return !!d.done || d.answers.length >= LU.C.DIAG_MIN; }

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

  var FAKE_MATES = [{ nickname: "바다", count: 15 }, { nickname: "소나무", count: 15 }];   // [개발용] 가짜 팀원
  var FAKE_ACHIEVED = ["2팀", "5팀"];                                                     // [개발용] 가짜 다른 팀
  function localTeam(db, s) {
    var g = LU.C.TEAM_GOAL_PER_MEMBER, day = today(), week = LU.weekKey(day);
    var mine = LU.weekCount(db.attempts.filter(function (a) { return a.code === s.code; }), day);
    var people = FAKE_MATES.map(function (m) { return { nickname: m.nickname, me: false, resting: false, count: m.count }; })
      .concat([{ nickname: s.nickname || "(별명 정하기 전)", me: true, resting: !!s.teamOff, count: mine }]);
    people.sort(function (a, b) { return a.nickname < b.nickname ? -1 : a.nickname > b.nickname ? 1 : 0; });   // 별명 가나다순
    var w = LU.teamWeek(people, g);
    var achievedTeams = FAKE_ACHIEVED.concat(w.achieved ? ["7팀"] : []).sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); });
    return {
      inTeam: true, teamOff: !!s.teamOff, name: "7팀", weekStart: week, goalPerMember: g,
      members: people.map(function (p) { return { nickname: p.nickname, me: p.me, resting: p.resting }; }),   // 팀원 개인 숫자는 빼고
      activeMembers: w.activeMembers, progress: w.progress, goal: w.goal, achieved: w.achieved,
      myCount: Math.min(mine, g), achievedTeams: achievedTeams, fake: true
    };
  }

  /* [M2 2차] 로컬 모드 AI 튜터 = 가짜 응답 (실제 AI에 묻지 않음, 인터넷 안 씀, 질문 글은 저장하지 않음)
     하루 5번을 이 브라우저에서 셈. [개발용] 흉내 스위치(F12 → Console):
       localStorage.setItem('lu2_dev_tutor_off', 'OFF')        // 꺼짐 흉내 (BUDGET·APP_DAILY 등 이유 이름도 됨)
       localStorage.setItem('lu2_dev_tutor_kind', 'blocked')   // 다음 답을 '정답 노출 차단'(blocked)·'범위 밖'(refused)·'오류'(error)로 */
  var TUTOR_KEY = "lu2_local_tutor";
  function localTutorState(code) {
    var t = {}; try { t = JSON.parse(lsGet(TUTOR_KEY) || "{}") || {}; } catch (e) { t = {}; }
    var used = (t[code] && t[code].day === today()) ? t[code].n : 0;
    var lim = LU.TUTOR.DAY_LIMIT, off = lsGet("lu2_dev_tutor_off");
    var reason = off ? (LU.TUTOR.TEXT[off] ? off : "OFF") : used >= lim ? "DAY_LIMIT" : null;
    return { enabled: !reason, reason: reason, left: Math.max(0, lim - used), dayLeft: Math.max(0, lim - used), monthLeft: 60, dayLimit: lim, fake: true };
  }
  function localTutorUse(code) {
    var t = {}; try { t = JSON.parse(lsGet(TUTOR_KEY) || "{}") || {}; } catch (e) { t = {}; }
    if (!t[code] || t[code].day !== today()) t[code] = { day: today(), n: 0 };
    t[code].n++; lsSet(TUTOR_KEY, JSON.stringify(t));
  }

  /* [M2 3차] 로컬 모드 주간 공통 점검 = 흉내
     - 진짜 공통 점검 문항(평가 문항)은 로컬 파일에 없음(build_data.py 가 막음) → 연습 문항 8개로 흉내(개발용 표시)
     - 주 번호 = 이 브라우저에서 코드를 처음 넣은 주를 1주차로 (개발용 날짜 앞당기기로 다음 주 흉내 가능)
     - 가짜 팀원: 바다는 이미 응시, 소나무는 아직 → "팀원 n/m명 응시" */
  var WEEKLY_N = 8;
  function localWeekNo(s) { return LU.checkWeek(LU.weekKey(s.created || today()), today()) || 1; }
  function localWeeklyItems(w) {
    var mcq = PRACTICE.filter(function (q) { return q.type === "mcq"; });
    var start = ((w - 1) * WEEKLY_N) % Math.max(1, mcq.length - WEEKLY_N);
    return mcq.slice(start, start + WEEKLY_N);
  }
  function localWeekly(db, s) {
    var w = localWeekNo(s), rec = ((db.weekly || {})[s.code] || {})[w] || null;
    // 바다(응시) · 소나무(아직) · 나 — 팀 활동 쉼이면 나는 m·n 둘 다에서 빠짐 (서버 weekly_check_status 와 같음)
    var active = 2 + (s.teamOff ? 0 : 1), taken = 1 + (rec && !s.teamOff ? 1 : 0);
    var need = !rec && !diagReady(db, s);   // [QA #10] 진단 10문항 전이면 닫힘(NEED_DIAG)
    return { open: !need, reason: need ? "NEED_DIAG" : null, week: w, cohortStart: LU.weekKey(s.created || today()), nItems: WEEKLY_N, done: !!rec,
             reviewLectures: rec ? rec.reviewLectures.slice() : null, team: { active: active, taken: taken }, fake: true };
  }
  /* [M2 3차] 로컬 모드 해설 당번 = 흉내. 기본은 내가 당번(쓰기 화면을 보려고).
     [개발용] localStorage.setItem('lu2_dev_duty','mate') → 가짜 팀원 바다가 당번 + 가짜 해설(팀원 화면 보기) */
  var FAKE_EXPLAIN = "(가짜 해설 · 개발용) 정답이 맞는 이유는 문제에서 묻는 핵심 낱말이 그 역할을 하기 때문이에요. 헷갈린 보기는 비슷한 이름이지만 하는 일이 달라요.";
  function localExplainItem(db, s) {
    var week = LU.weekKey(today()), wrong = {};
    db.attempts.filter(function (a) { return a.code === s.code && a.day >= week; }).forEach(function (a) {
      var q = QBY[a.qid]; if (!q) return;
      if (!a.submits || !a.submits.length || a.submits[0] !== q.answer_index) wrong[a.qid] = (wrong[a.qid] || 0) + 1;
    });
    var ids = Object.keys(wrong).sort(function (a, b) { return wrong[b] - wrong[a] || (a < b ? -1 : 1); });
    return ids.length ? QBY[ids[0]] : null;
  }
  function localExplainer(db, s) {
    var week = LU.weekKey(today()), mate = lsGet("lu2_dev_duty") === "mate";
    if (!diagReady(db, s)) return { inTeam: true, weekStart: week, needDiag: true, fake: true };   // [QA #10] 진단 먼저
    var store = ((db.explainer || {})[s.code] || {})[week] || null;
    var q = store ? QBY[store.qid] : localExplainItem(db, s);
    if (mate) q = q || PRACTICE[0];
    var iAm = !mate && !s.teamOff;
    return {
      inTeam: true, weekStart: week, maxChars: LU.WEEKLY.EXPLAIN_MAX, hasDuty: true,
      dutyNickname: iAm ? (s.nickname || "(별명 정하기 전)") : "바다", iAmDuty: iAm,
      item: q ? { qid: q.id, lecture: q.lecture, question: q.question, sourceSection: q.source_section || "" } : null,
      body: mate ? FAKE_EXPLAIN : store ? store.body : null, writtenAt: mate ? week : store ? store.at : null, fake: true
    };
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
      var bad = LU.checkNickname(name); if (bad) return Promise.reject(new Error(ERR_TEXT[bad]));   // 서버 set_nickname 과 같은 검사
      s.nickname = LU.cleanNickname(name); saveDb(db);
      return Promise.resolve(publicStudent(s, db));
    },

    practiceQuestions: function () { return Promise.resolve(PRACTICE); },
    question: function (qid) { return Promise.resolve(QBY[qid] || null); },
    hints: function (qid) {
      var h = HINTS[qid];
      if (!h || (!h.reviewed && !CFG.SHOW_DRAFT_HINTS)) return Promise.resolve(null);   // 학생용 기준: 검토 끝난 것만
      return Promise.resolve({ L1: h.L1, L2: h.L2, L3: h.L3, fake: HINTS_FAKE, draft: !h.reviewed });
    },

    conceptCard: function (lecture) { return Promise.resolve(normCard(CARDS[String(Number(lecture))])); },

    diagnostic: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var d = db.diag[s.code] || { answers: [], done: false };
      return Promise.resolve({ questions: DIAG, answered: d.answers.map(function (a) { return a.qid; }), done: !!d.done });
    },
    answerDiagnostic: function (qid, choice) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var d = db.diag[s.code] = db.diag[s.code] || { answers: [], done: false };
      if (d.done) return Promise.resolve({ answered: d.answers.length });
      var dq = DIAG.filter(function (q) { return q.id === qid; })[0];
      if (!dq) return Promise.reject(new Error("진단 문항이 아니에요"));
      if (choice !== null && choice !== undefined && !(Number(choice) >= 0 && Number(choice) < dq.choices.length && Number(choice) === Math.floor(Number(choice))))
        return Promise.reject(new Error(ERR_TEXT.BAD_CHOICE));   // 서버 diag_answer 와 같은 검사
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
      // 서버 close_item과 같은 검사(BAD_SUBMITS): 보기 번호 범위, 같은 답 두 번 금지
      var sub = (rec.submits || []).map(Number);
      if (sub.length > LU.maxSubmitsFor(q) || sub.some(function (x) { return !(x >= 0 && x < q.choices.length && x === Math.floor(x)); }) ||
          (sub.length === 2 && sub[0] === sub[1])) return Promise.reject(new Error(ERR_TEXT.BAD_SUBMITS));
      // 서버 close_item 과 같게: 새 연습은 열린 강까지만 (QA #9)
      if (rec.mode === "PRACTICE" && q.lecture > (CFG.OPEN_UP_TO_LECTURE || 99)) return Promise.reject(new Error(ERR_TEXT.NOT_OPEN));
      var day = today();
      var xp = LU.xpFor(rec.mode, rec.outcome, xpToday(db, s.code, day));
      var R = LU.R_OF[rec.outcome];
      var reviewNote = null;
      var box = db.review[s.code] = db.review[s.code] || {};
      if (rec.mode === "PRACTICE") {
        // Elo는 문항 하나당 한 번, 연습에서만. 문항 응답 수는 학습자별 첫 응답만 셈
        var item = db.items[q.id] || { b: LU.initialB(q), n: 0 };
        var first = !db.attempts.some(function (a) { return a.code === s.code && a.qid === q.id; });
        // 서버 close_item과 같게: 복습 일정 밖에서 같은 문항을 다시 풀면 XP 없음 (팀게임 설계 1-1, QA 3번)
        if (!first) xp = 0;
        // QA #9: 다시 마감하면 θ·답 수도 그대로 (서버 70번 close_item 과 같음)
        if (first) { var e = LU.applyElo(s, item, q, R); s.theta = e.theta; s.n = e.n; item.b = e.b; item.n = e.itemN; }
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

    /* [M2] 로컬 모드 팀: 가짜 팀원 2명(바다·소나무 — 실제 사람 아님)이 이번 주 이미 15문항씩 푼 것으로 흉내.
       내 이번 주 문항 수만 실제 이 브라우저 기록에서 셈. 화면에 돌려주는 모양은 서버 my_team_summary 와 같음 */
    myTeam: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      return Promise.resolve(localTeam(db, s));
    },
    setTeamOff: function (off) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      s.teamOff = !!off; saveDb(db);
      return Promise.resolve(localTeam(db, s));
    },

    /* [M2 2차] AI 튜터 — 로컬 모드는 가짜 응답. 화면에 돌려주는 모양은 Supabase 모드(Edge Function ai-tutor)와 같음 */
    tutorStatus: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      return Promise.resolve(localTutorState(s.code));
    },
    askTutor: function (rq) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var q = QBY[rq.qid], text = String(rq.question || "").trim();
      if (!q) return Promise.resolve({ ok: false, error: "NOT_PRACTICE", message: "AI 튜터는 연습 문제에서만 쓸 수 있어요." });
      if (!text) return Promise.resolve({ ok: false, error: "EMPTY", message: "궁금한 점을 한 줄 이상 써 주세요." });
      if (text.length > LU.TUTOR.MAX_CHARS) return Promise.resolve({ ok: false, error: "TOO_LONG", message: "질문은 300자 안으로 줄여 주세요." });
      // 서버 70번 tutor_begin 과 같은 확인(QA #8): 열린 강 밖(복습 날 아님) · 최근 7일 안에 이미 마감한 문항
      var rv = (db.review[s.code] || {})[q.id], due = !!(rv && rv.due <= today());
      if (!due && q.lecture > (CFG.OPEN_UP_TO_LECTURE || 99)) return Promise.resolve({ ok: false, error: "NOT_OPEN", message: ERR_TEXT.NOT_OPEN });
      var lastDay = db.attempts.filter(function (a) { return a.code === s.code && a.qid === q.id; }).reduce(function (m, a) { return a.day > m ? a.day : m; }, "");
      if (lastDay && (due ? lastDay === today() : (rv || LU.daysBetween(lastDay, today()) < 7)))
        return Promise.resolve({ ok: false, error: "ITEM_CLOSED", message: "이 문제는 이미 끝났어요. 해설을 읽어 봐요." });
      var st = localTutorState(s.code);
      if (!st.enabled) return Promise.resolve({ ok: false, error: st.reason, message: LU.TUTOR.TEXT[st.reason], state: st });
      var kind = lsGet("lu2_dev_tutor_kind") || "ok"; lsDel("lu2_dev_tutor_kind");
      if (kind === "error") return Promise.resolve({ ok: false, error: "AI_ERROR", message: "AI 튜터가 지금 답하지 못했어요. 횟수는 줄지 않았어요. 잠시 뒤 다시 해 주세요.", state: st });
      var reply = kind === "refused" ? "이 내용은 우리 강의 범위 밖이에요. " + q.lecture + "강 '" + (q.source_section || "") + "' 부분으로 돌아가 볼까요?"
        : kind === "blocked" ? "AI 답에 정답이 그대로 들어 있어서 보여 드리지 않았어요. 이번 질문은 횟수에서 빼 드렸어요. 힌트를 다시 읽고, 문제에서 묻는 핵심 낱말이 무엇인지 먼저 떠올려 볼까요?"
        : "(가짜 AI 응답 · 개발용 — 실제 AI에 묻지 않았어요) 좋은 질문이에요. 이 문제는 " + q.lecture + "강 '" + (q.source_section || "") +
          "' 부분의 핵심 낱말을 묻고 있어요. 그 낱말이 무슨 일을 하는지 한 문장으로 말해 볼까요?";
      if (kind === "ok") localTutorUse(s.code);
      return new Promise(function (ok) { setTimeout(ok, 150); }).then(function () {   // AI가 생각하는 시간 흉내
        return { ok: true, kind: kind, reply: reply, state: localTutorState(s.code) };
      });
    },

    /* [M2 3차] 주간 공통 점검 (로컬 = 연습 문항 8개로 흉내). 화면에 돌려주는 모양은 Supabase 모드와 같음 — 점수 없음 */
    weeklyStatus: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      return Promise.resolve(localWeekly(db, s));
    },
    weeklyItems: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var st = localWeekly(db, s);
      if (st.done) return Promise.reject(new Error(ERR_TEXT.WEEKLY_DONE));
      if (st.reason === "NEED_DIAG") return Promise.reject(new Error(ERR_TEXT.NEED_DIAG));
      return Promise.resolve({ week: st.week, fake: true, items: localWeeklyItems(st.week).map(function (q) {
        return { id: q.id, lecture: q.lecture, type: q.type, question: q.question, choices: q.choices.slice() };   // 정답 칸은 빼고
      }) });
    },
    submitWeekly: function (answers) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      if (!diagReady(db, s)) return Promise.reject(new Error(ERR_TEXT.NEED_DIAG));
      var st = localWeekly(db, s), a = answers || {}, wk = st.week;
      // [QA #11ⓑ] 답이 모두 지난주 문항이면: 월요일 03:00 전 → 지난주 점검으로 받음 / 그 뒤 → WEEK_CHANGED (서버 70번과 같음)
      var keys = Object.keys(a), prev = wk >= 2 ? localWeeklyItems(wk - 1).map(function (q) { return q.id; }) : [];
      var cur = localWeeklyItems(wk).map(function (q) { return q.id; });
      if (wk >= 2 && keys.length && keys.every(function (k) { return prev.indexOf(k) >= 0 && cur.indexOf(k) < 0; })) {
        var kst = new Date(now() + 9 * 3600 * 1000);
        if (LU.daysBetween(LU.weekKey(today()), today()) === 0 && kst.getUTCHours() < 3) wk = wk - 1;
        else return Promise.reject(new Error(ERR_TEXT.WEEK_CHANGED));
      }
      if (((db.weekly || {})[s.code] || {})[wk]) return Promise.reject(new Error(ERR_TEXT.WEEKLY_DONE));
      var items = localWeeklyItems(wk);
      // 서버 weekly_check_submit 과 같은 검사: 이번 주 문항 모두(빠짐·남는 것 없이), 보기 번호 범위 또는 null
      var okShape = Object.keys(a).length === items.length && items.every(function (q) {
        if (!has(a, q.id)) return false; var c = a[q.id];
        return c === null || (typeof c === "number" && c === Math.floor(c) && c >= 0 && c < q.choices.length);
      });
      if (!okShape) return Promise.reject(new Error(ERR_TEXT.BAD_ANSWERS));
      var rl = LU.reviewLectures(items, a, function (id) { return QBY[id].answer_index; });
      db.weekly = db.weekly || {}; db.weekly[s.code] = db.weekly[s.code] || {};
      db.weekly[s.code][wk] = { answers: a, reviewLectures: rl, at: now() };   // 맞힌 수는 저장도 안 함(로컬)
      saveDb(db);
      return Promise.resolve({ done: true, week: wk, reviewLectures: rl });
    },
    /* [M2 3차] 팀 해설 당번 (로컬 = 흉내) */
    teamExplainer: function () {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      return Promise.resolve(localExplainer(db, s));
    },
    writeExplainer: function (qid, body) {
      var db = loadDb(), s = current(db); if (!s) return needLogin();
      var e = localExplainer(db, s);
      if (e.needDiag) return Promise.reject(new Error(ERR_TEXT.NEED_DIAG));
      if (!e.iAmDuty) return Promise.reject(new Error(ERR_TEXT.NOT_DUTY));
      if (!e.item) return Promise.reject(new Error(ERR_TEXT.NO_ITEM));
      if (qid !== e.item.qid) return Promise.reject(new Error(ERR_TEXT.ITEM_CHANGED));
      var bad = LU.checkExplain(body); if (bad) return Promise.reject(new Error(ERR_TEXT[bad]));
      var week = LU.weekKey(today());
      db.explainer = db.explainer || {}; db.explainer[s.code] = db.explainer[s.code] || {};
      db.explainer[s.code][week] = { qid: qid, body: LU.cleanExplain(body), at: new Date(now()).toISOString() };
      saveDb(db);
      return Promise.resolve(localExplainer(db, s));
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
    NOT_DUE: "이 복습 문제는 아직 복습할 날이 아니에요. 홈으로 가서 다시 시작해 주세요.",
    // [M2 3차] 주간 공통 점검 · 해설 당번
    WEEKLY_CLOSED: "이번 주 공통 점검이 지금은 열려 있지 않아요. 홈으로 돌아가 주세요.",
    WEEKLY_DONE: "이번 주 공통 점검은 이미 응시했어요. 한 주에 한 번만 풀 수 있어요.",
    BAD_ANSWERS: "답이 서버 규칙과 맞지 않아 제출하지 못했어요. 새로고침한 뒤 다시 풀어 주세요.",
    NOT_DUTY: "이번 주 해설 당번이 아니라서 쓸 수 없어요.",
    NO_ITEM: "아직 해설할 문항이 정해지지 않았어요. 팀이 연습 문제를 풀면 정해져요.",
    ITEM_CHANGED: "그사이 팀 기록이 늘어 해설할 문항이 바뀌었어요. 새 문항을 확인해 주세요(쓴 글은 그대로 있어요).",
    TOO_SHORT: "해설은 10글자 이상 써 주세요.",
    TOO_LONG: "해설은 200글자 안으로 줄여 주세요.",
    PRIVATE_INFO: "이메일·전화번호는 쓰지 마세요. 팀원에게 그대로 보여요.",
    NO_TEAM: "아직 팀이 없어요.",
    // [QA 낮음 수정 — 70_qa_fixes.sql]
    NICK_LENGTH: "별명은 2~12글자로 정해 주세요.",
    NICK_PRIVATE: "전화번호·이메일·학번처럼 보이는 글은 별명에 쓸 수 없어요. 팀원에게 그대로 보여요.",
    BAD_CHOICE: "고른 보기가 서버 규칙과 맞지 않아 저장하지 못했어요. 새로고침해 주세요.",
    NOT_OPEN: "이 강의는 아직 열리지 않았어요. 홈으로 돌아가 주세요.",
    NEED_DIAG: "진단을 10문항 이상 마치면 열려요. 진단부터 이어 해 주세요.",
    WEEK_CHANGED: "밤 12시가 지나 지난주 공통 점검이 닫혔어요. 고른 답은 제출되지 않았어요. 이번 주 점검을 새로 시작해 주세요."
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
  var cache = { practice: null, diag: null, hints: null, cards: null };
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

  function loadCards() {
    // DB 규칙(cards_reviewed)이 검토 끝난 카드만 돌려줌. 표가 아직 없으면(70번 SQL 적용 전) 빈 목록 → 화면은 예전처럼
    if (!cache.cards) cache.cards = sb().then(function (c) { return c.from("concept_cards").select("lecture,title,lines"); })
      .then(function (r) { var m = {}; (unwrap(r) || []).forEach(function (x) { m[String(x.lecture)] = { title: x.title, lines: asChoices(x.lines) }; }); return m; },
            function () { return {}; });
    return cache.cards;
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

  /* 서버 팀 요약 → 화면 모양 (모르는 칸은 버림: 혹시 서버가 더 보내도 화면에는 별명·쉼 여부만) */
  function normTeam(t) {
    t = t || {};
    if (!t.inTeam) return { inTeam: false, teamOff: !!t.teamOff };
    return {
      inTeam: true, teamOff: !!t.teamOff, name: String(t.name || ""), weekStart: t.weekStart || "",
      goalPerMember: Number(t.goalPerMember) || LU.C.TEAM_GOAL_PER_MEMBER,
      members: (t.members || []).map(function (m) { return { nickname: String(m.nickname || ""), me: !!m.me, resting: !!m.resting }; }),
      activeMembers: Number(t.activeMembers) || 0, progress: Number(t.progress) || 0, goal: Number(t.goal) || 0,
      achieved: !!t.achieved, myCount: Number(t.myCount) || 0,
      achievedTeams: (t.achievedTeams || []).map(String), fake: false
    };
  }

  /* [M2 2차] AI 튜터 상태·답 → 화면 모양 (모르는 칸은 버림) */
  function normTutor(t) {
    t = t || {};
    return { enabled: !!t.enabled, reason: t.reason || null, left: Number(t.left) || 0, dayLeft: Number(t.dayLeft) || 0,
             monthLeft: Number(t.monthLeft) || 0, dayLimit: Number(t.dayLimit) || LU.TUTOR.DAY_LIMIT, fake: false };
  }
  function normAsk(a) {
    a = a || {};
    // state: 바뀐 남은 횟수(서버가 보냈을 때만). 질문이 너무 길다 같은 거절에는 없음 → 화면은 전 상태 그대로
    return { ok: !!a.ok, kind: a.kind || null, reply: a.ok ? String(a.reply || "") : "",
             error: a.error || null, message: a.message ? String(a.message) : "",
             state: a.enabled === undefined ? null : normTutor(a) };
  }

  /* [M2 3차] 공통 점검 상태 · 해설 당번 → 화면 모양 (모르는 칸은 버림: 혹시 서버가 점수를 보내도 화면에는 안 넘김) */
  function normWeekly(w) {
    w = w || {};
    var team = w.team && typeof w.team === "object" ? { active: Number(w.team.active) || 0, taken: Number(w.team.taken) || 0 } : null;
    return { open: !!w.open, reason: w.reason || null, week: w.week === null || w.week === undefined ? null : Number(w.week),
             cohortStart: w.cohortStart ? String(w.cohortStart).slice(0, 10) : null, nItems: Number(w.nItems) || 0, done: !!w.done,
             reviewLectures: Array.isArray(w.reviewLectures) ? w.reviewLectures.map(Number) : null, team: team, fake: false };
  }
  function normExplainer(e) {
    e = e || {};
    if (!e.inTeam) return { inTeam: false };
    if (e.needDiag) return { inTeam: true, needDiag: true, weekStart: String(e.weekStart || "").slice(0, 10), fake: false };   // [QA #10]
    var it = e.item && e.item.qid ? { qid: String(e.item.qid), lecture: Number(e.item.lecture) || 0, question: String(e.item.question || ""),
                                     sourceSection: String(e.item.sourceSection || "") } : null;
    return { inTeam: true, weekStart: String(e.weekStart || "").slice(0, 10), maxChars: Number(e.maxChars) || LU.WEEKLY.EXPLAIN_MAX,
             hasDuty: !!e.hasDuty, dutyNickname: e.dutyNickname ? String(e.dutyNickname) : "", iAmDuty: !!e.iAmDuty,
             item: it, body: e.body ? String(e.body) : null, writtenAt: e.writtenAt || null, fake: false };
  }

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
      var bad = LU.checkNickname(name); if (bad) return Promise.reject(new Error(ERR_TEXT[bad]));   // 서버도 같은 검사(70번)
      return rpc("set_nickname", { p_name: LU.cleanNickname(name) })
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

    conceptCard: function (lecture) {
      return loadCards().then(function (m) { return normCard(m[String(Number(lecture))]); }, function () { return null; });
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
    /* [M2] 팀 — 서버 함수 my_team_summary / set_team_off (30_m2_teams_admin.sql) */
    myTeam: function () {
      return rpc("my_team_summary").then(normTeam).catch(function (e) { throw friendly(e); });
    },
    setTeamOff: function (off) {
      return rpc("set_team_off", { p_off: !!off }).then(normTeam).catch(function (e) { throw friendly(e); });
    },
    /* [M2 2차] AI 튜터 — 남은 횟수는 rpc tutor_status(), 질문은 Edge Function ai-tutor (50_ai_tutor.sql · supabase/functions/ai-tutor)
       화면은 Anthropic 에 직접 닿지 않고 키도 모릅니다. 보내는 것: 문항 번호·본 힌트 단계·낸 오답 번호·질문 글 (코드·별명 없음) */
    tutorStatus: function () {
      return rpc("tutor_status").then(normTutor).catch(function (e) { throw friendly(e); });
    },
    askTutor: function (rq) {
      var body = { qid: String(rq.qid), level: Number(rq.level) || 0, tried: (rq.tried || []).map(Number), question: String(rq.question || "") };
      return sb().then(function (c) { return c.functions.invoke("ai-tutor", { body: body }); }).then(function (r) {
        if (!r.error) return normAsk(r.data);
        // 200 이 아닌 답(로그인 풀림·질문 너무 김 등): 함수가 보낸 쉬운 안내를 꺼내 씀
        var ctxRes = r.error.context;
        return (ctxRes && typeof ctxRes.json === "function" ? ctxRes.json().catch(function () { return null; }) : Promise.resolve(null))
          .then(function (j) {
            if (j && j.message) return normAsk(j);
            throw r.error;
          });
      }).catch(function (e) { throw friendly(e); });
    },
    /* [M2 3차] 주간 공통 점검 — 60_m2_weekly_explainer.sql. 문항은 서버 함수로만(표로는 못 읽음), 채점도 서버가 */
    weeklyStatus: function () {
      return rpc("weekly_check_status").then(normWeekly).catch(function (e) { throw friendly(e); });
    },
    weeklyItems: function () {
      return rpc("weekly_check_items").then(function (r) {
        r = r || {};
        return { week: Number(r.week) || null, fake: false, items: (r.items || []).map(function (q) {
          return { id: String(q.id), lecture: Number(q.lecture) || 0, type: q.type === "ox" ? "ox" : "mcq", question: String(q.question || ""), choices: asChoices(q.choices) };
        }) };
      }).catch(function (e) { throw friendly(e); });
    },
    submitWeekly: function (answers) {
      var a = {}; Object.keys(answers || {}).forEach(function (k) { var c = answers[k]; a[k] = c === null || c === undefined ? null : Number(c); });
      return rpc("weekly_check_submit", { p_answers: a }).then(function (r) {
        r = r || {};
        return { done: !!r.done, week: Number(r.week) || null, reviewLectures: (r.reviewLectures || []).map(Number) };   // 점수 칸은 받지도 넘기지도 않음
      }).catch(function (e) { throw friendly(e); });
    },
    /* [M2 3차] 팀 해설 당번 — 같은 팀 안에서만 (서버가 막음) */
    teamExplainer: function () {
      return rpc("my_team_explainer").then(normExplainer).catch(function (e) { throw friendly(e); });
    },
    writeExplainer: function (qid, body) {
      return rpc("write_team_explainer", { p_qid: qid, p_body: String(body || "") }).then(normExplainer).catch(function (e) { throw friendly(e); });
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
