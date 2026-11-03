/* =========================================================
   [시험용] 가짜 Supabase 라이브러리 (mock)
   - 자동 시험(run_e2e_supabase_mock.js)이 vendor/supabase.js 대신 이 파일을 끼워 넣습니다.
   - 인터넷에 나가지 않고, 브라우저 저장소 안의 "가짜 서버"가 schema.sql 의 서버 함수와
     같은 모양으로 답합니다. 부른 순서·인자는 localStorage 'mock_log' 에 적어 둡니다.
   - 가짜 문항 데이터는 시험 도구가 window.__MOCK_DATA 로 미리 넣어 줍니다(가짜 학생만 사용).
   - [M2] 팀(my_team_summary·set_team_off)과 교수 화면(이메일 매직링크 로그인 + admin_*)도 흉내 냅니다.
     로그인 저장 칸(storageKey)마다 세션을 따로 둠: 학생 'lu2_sb_auth' → 'mock_session', 교수 'lu2_sb_admin' → 'mock_session:lu2_sb_admin'
     __MOCK_DATA.team = {name, goalPerMember, mates:[{nickname,count,resting}], achievedOthers:[팀 이름]} (없으면 팀 없음)
     __MOCK_DATA.adminUsers = [교수 화면에 로그인할 수 있는(등록된) 이메일], adminEmails = [admins 표 이메일]
     __MOCK_DATA.adminStats / adminTeams = 교수 함수가 돌려줄 가짜 값
   - [M2 2차] AI 튜터: rpc tutor_status + functions.invoke('ai-tutor') 흉내. __MOCK_DATA.tutor 가 없으면 서버에 AI 튜터가 없는 것처럼(함수 없음)
     __MOCK_DATA.tutor = {enabled, reason, dayLimit, used, reply, kind, error}  (부른 내용은 mock_log 에 t:'invoke')
   - [M2 3차] 주간 공통 점검·해설 당번·교수 ④⑤ (60_m2_weekly_explainer.sql 과 같은 모양). 없으면 함수 없음(적용 전)처럼
     __MOCK_DATA.weekly = {week, reason, cohortStart, items:[{id,lecture,type,question,choices,answer_index}], teamActive, teamTaken}
       (채점은 이 가짜 서버가. 응시 기록은 mock_db.weekly[코드][주] — 맞힌 수는 화면에 돌려주지 않음)
     __MOCK_DATA.explainer = {duty:'me'|별명, item:{qid,lecture,question,sourceSection}|null, body}
     __MOCK_DATA.adminTutor / adminWeekly = 교수 함수가 돌려줄 가짜 값
   ========================================================= */
(function () {
  "use strict";
  var D = window.__MOCK_DATA;   // {practice:[...정답 포함], diag:[...diag_order 순, 정답 포함], reviewedHints:{qid:{l1,l2,l3}}, codes:[...]}
  function ls(k, v) { if (v === undefined) { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } localStorage.setItem(k, JSON.stringify(v)); }
  function db() { return ls("mock_db") || { students: {}, devices: {}, tries: {}, attempts: [], diag: {} }; }
  function save(x) { ls("mock_db", x); }
  function log(entry) { var l = ls("mock_log") || []; l.push(entry); ls("mock_log", l); }
  function fail() { return ls("mock_fail") || {}; }   // {rpc이름: '오류 메시지'} 로 오류 흉내
  function today() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function ok(data) { return Promise.resolve({ data: data, error: null }); }
  function err(message) { return Promise.resolve({ data: null, error: { message: message, code: "P0001" } }); }
  (function seed() { var x = db(); (D.codes || []).forEach(function (c) { if (!x.students[c]) x.students[c] = { code: c, nickname: null, xp: 0, diag_done: false }; }); save(x); })();

  var PBY = {}; D.practice.forEach(function (q) { PBY[q.id] = q; });
  var DBY = {}; D.diag.forEach(function (q) { DBY[q.id] = q; });

  var SKEY = "mock_session";   // 지금 부르는 클라이언트의 세션 칸 (createClient 의 storageKey 로 정함)
  function session() { return ls(SKEY); }
  function meCode() { var s = session(); if (!s) return null; return db().devices[s.uid] || null; }

  /* [M2] 팀 요약: 가짜 팀원 숫자 + 내 이번 주 기록(xp > 0)으로 schema(30_m2) 와 같은 규칙 계산 */
  function weekStartOf(day) { var d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
  function teamSummary(c) {
    var x = db(), st = x.students[c], T = D.team;
    var off = !!st.team_off, wk = weekStartOf(today());
    if (!T) return { inTeam: false, teamOff: off, weekStart: wk };
    var g = T.goalPerMember || 15;
    var mine = x.attempts.filter(function (a) { return a.code === c && a.day >= wk && a.xp > 0; }).length;
    var people = (T.mates || []).map(function (m) { return { nickname: m.nickname, me: false, resting: !!m.resting, count: m.count }; })
      .concat([{ nickname: st.nickname || "(별명 정하기 전)", me: true, resting: off, count: mine }]);
    people.sort(function (a, b) { return a.nickname < b.nickname ? -1 : a.nickname > b.nickname ? 1 : 0; });
    var act = people.filter(function (p) { return !p.resting; });
    var prog = act.reduce(function (s2, p) { return s2 + Math.min(p.count, g); }, 0), goal = g * act.length, ach = act.length > 0 && prog >= goal;
    return { inTeam: true, teamOff: off, name: T.name, weekStart: wk, goalPerMember: g,
             members: people.map(function (p) { return { nickname: p.nickname, me: p.me, resting: p.resting }; }),
             activeMembers: act.length, progress: prog, goal: goal, achieved: ach, myCount: Math.min(mine, g),
             achievedTeams: (T.achievedOthers || []).concat(ach ? [T.name] : []) };
  }
  function adminOf() {
    var s = session(); if (!s || !s.user || s.user.is_anonymous) return null;
    var e = String(s.user.email || "").toLowerCase();
    return (D.adminEmails || []).map(function (y) { return y.toLowerCase(); }).indexOf(e) >= 0 ? e : null;
  }

  /* [M2 2차] AI 튜터 상태 (오늘 쓴 횟수는 mock_db.tutorUsed 에) */
  function tutorState() {
    var T = D.tutor, x = db(), lim = T.dayLimit || 5, used = (T.used || 0) + (x.tutorUsed || 0);
    var reason = T.reason || (T.enabled === false ? "OFF" : used >= lim ? "DAY_LIMIT" : null);
    return { enabled: !reason, reason: reason, dayLimit: lim, dayLeft: Math.max(0, lim - used), monthLeft: 60, left: Math.max(0, lim - used) };
  }
  /* [M2 3차] 공통 점검 상태 (서버 weekly_check_status 와 같은 모양) */
  function weeklyState(c) {
    var W = D.weekly, x = db(), rec = ((x.weekly || {})[c] || {})[W.week] || null;
    var reason = W.reason !== undefined ? W.reason : null;
    return { open: reason === null, reason: reason, week: reason === "OFF" || reason === "NOT_STARTED" ? null : W.week,
             cohortStart: reason === "OFF" ? null : (W.cohortStart || "2027-03-01"), nItems: reason === null ? W.items.length : 0, done: !!rec,
             reviewLectures: rec ? rec.reviewLectures : null,
             team: D.team && W.teamActive ? { active: W.teamActive, taken: (W.teamTaken || 0) + (rec ? 1 : 0) } : null };
  }
  function explainerState(c) {
    var E = D.explainer, x = db(), st = x.students[c], mine = E.duty === "me";
    var saved = (x.explainer || {})[c];
    return { inTeam: true, weekStart: weekStartOf(today()), maxChars: 200, hasDuty: !!E.duty,
             dutyNickname: mine ? (st.nickname || "(별명 정하기 전)") : (E.duty || null), iAmDuty: mine,
             item: E.item || null, body: saved ? saved.body : (E.body || null), writtenAt: saved ? saved.at : null };
  }
  var RPC = {
    weekly_check_status: function () {
      if (!D.weekly) return err("Could not find the function public.weekly_check_status");
      var c = meCode(); if (!c) return err("NOT_LINKED");
      return ok(weeklyState(c));
    },
    weekly_check_items: function () {
      if (!D.weekly) return err("Could not find the function public.weekly_check_items");
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var w = weeklyState(c);
      if (!w.open) return err("WEEKLY_CLOSED"); if (w.done) return err("WEEKLY_DONE");
      return ok({ week: D.weekly.week, items: D.weekly.items.map(function (q) { return { id: q.id, lecture: q.lecture, type: q.type, question: q.question, choices: q.choices }; }) });
    },
    weekly_check_submit: function (a) {
      if (!D.weekly) return err("Could not find the function public.weekly_check_submit");
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var w = weeklyState(c); if (!w.open) return err("WEEKLY_CLOSED"); if (w.done) return err("WEEKLY_DONE");
      var ans = a.p_answers, items = D.weekly.items;
      if (!ans || typeof ans !== "object" || Array.isArray(ans) || Object.keys(ans).length !== items.length) return err("BAD_ANSWERS");
      var bad = items.some(function (q) { var v = ans[q.id]; return !(q.id in ans) || !(v === null || (typeof v === "number" && v >= 0 && v < q.choices.length && v === Math.floor(v))); });
      if (bad) return err("BAD_ANSWERS");
      var lec = {}; items.forEach(function (q) { if (ans[q.id] !== q.answer_index) lec[q.lecture] = 1; });
      var rl = Object.keys(lec).map(Number).sort(function (p, q) { return p - q; });
      var x = db(); x.weekly = x.weekly || {}; x.weekly[c] = x.weekly[c] || {};
      x.weekly[c][D.weekly.week] = { answers: ans, reviewLectures: rl, nCorrect: items.filter(function (q) { return ans[q.id] === q.answer_index; }).length };
      save(x);
      return ok({ done: true, week: D.weekly.week, reviewLectures: rl });
    },
    my_team_explainer: function () {
      if (!D.explainer) return err("Could not find the function public.my_team_explainer");
      var c = meCode(); if (!c) return err("NOT_LINKED");
      if (!D.team) return ok({ inTeam: false, weekStart: weekStartOf(today()) });
      return ok(explainerState(c));
    },
    write_team_explainer: function (a) {
      if (!D.explainer) return err("Could not find the function public.write_team_explainer");
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var e = explainerState(c);
      if (!e.iAmDuty) return err("NOT_DUTY"); if (!e.item) return err("NO_ITEM");
      if (a.p_qid !== e.item.qid) return err("ITEM_CHANGED");
      var b = String(a.p_body || "").replace(/\r/g, "").trim();
      if (b.length < 10) return err("TOO_SHORT"); if (b.length > 200) return err("TOO_LONG");
      if (/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/.test(b) || /01[016789][-. ]?\d{3,4}[-. ]?\d{4}/.test(b)) return err("PRIVATE_INFO");
      var x = db(); x.explainer = x.explainer || {}; x.explainer[c] = { body: b, at: new Date().toISOString() }; save(x);
      return ok(explainerState(c));
    },
    admin_tutor_usage: function () {
      if (!adminOf()) return err("NOT_ADMIN");
      if (!D.adminTutor) return err("Could not find the function public.admin_tutor_usage");
      return ok(D.adminTutor);
    },
    admin_weekly_stats: function (a) {
      if (!adminOf()) return err("NOT_ADMIN");
      if (!D.adminWeekly) return err("Could not find the function public.admin_weekly_stats");
      return ok(Object.assign({}, D.adminWeekly, { cohort: a.p_cohort, week: a.p_week || D.adminWeekly.currentWeek }));
    },
    tutor_status: function () {
      if (!D.tutor) return err("Could not find the function public.tutor_status");
      if (!meCode()) return err("NOT_LINKED");
      return ok(tutorState());
    },
    claim_code: function (a) {
      var s = session(); if (!s) return err("NO_AUTH");
      var x = db(); x.tries[s.uid] = (x.tries[s.uid] || 0) + 1; save(x);
      if (fail().claim_code === "too_many" || x.tries[s.uid] > 10) return ok({ ok: false, error: "too_many" });
      var c = String(a.p_code || "").replace(/\s/g, "").toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(c)) return ok({ ok: false, error: "shape" });
      var st = x.students[c]; if (!st) return ok({ ok: false, error: "unknown" });
      x.devices[s.uid] = c; save(x);
      return ok({ ok: true, student: { code: c, nickname: st.nickname || "", xp: st.xp, diagDone: st.diag_done,
                                       diagAnswered: Object.keys(x.diag[c] || {}).length } });
    },
    set_nickname: function (a) {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var x = db(); x.students[c].nickname = String(a.p_name).trim().slice(0, 12); save(x); return ok(null);
    },
    diag_answer: function (a) {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      if (!DBY[a.p_qid]) return err("NOT_DIAG");
      var x = db(); var d = x.diag[c] = x.diag[c] || {};
      if (!x.students[c].diag_done && !(a.p_qid in d)) d[a.p_qid] = a.p_choice;
      save(x); return ok(Object.keys(d).length);
    },
    diag_finish: function () {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var x = db(); var d = x.diag[c] || {};
      if (Object.keys(d).length < 10) return err("DIAG_TOO_FEW");
      x.students[c].diag_done = true; save(x);
      var review = D.diag.filter(function (q) { return q.id in d; }).map(function (q) {
        return { qid: q.id, yourChoice: d[q.id], answer_index: q.answer_index, explanation: q.explanation, common_wrong_reason: q.common_wrong_reason || null };
      });
      return ok({ strong: [1, 2], weak: [3], review: review });
    },
    next_practice: function (a) {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var x = db(); var done = {}; x.attempts.forEach(function (t) { if (t.code === c) done[t.qid] = 1; });
      var ex = a.p_exclude || [];
      var forced = ls("mock_next"); if (forced) { localStorage.removeItem("mock_next"); return ok({ qid: forced, conceptCard: false }); }   // 시험용: 다음 문항 지정
      var cand = D.practice.filter(function (q) { return ex.indexOf(q.id) < 0 && !done[q.id]; });
      // schema.sql 과 같게 E7: 이번 판(p_exclude)에 O/X가 2개 이상이면, O/X 아닌 후보가 있을 때 O/X 빼기
      // (E0 고르기용 c 0.25·Elo 구간은 흉내 내지 않음 — 이 가짜 서버엔 θ가 없어 예전처럼 문항 순서대로 고름)
      var oxUsed = ex.filter(function (id) { return PBY[id] && PBY[id].type === "ox"; }).length;
      var nonOx = cand.filter(function (q) { return q.type !== "ox"; });
      if (oxUsed >= 2 && nonOx.length) cand = nonOx;
      var q = cand[0];
      return ok(q ? { qid: q.id, conceptCard: false } : null);
    },
    close_item: function (a) {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var q = PBY[a.p_qid]; if (!q) return err("PRACTICE_ONLY");
      if (["PRACTICE", "REVIEW"].indexOf(a.p_mode) < 0) return err("BAD_MODE");
      if (!Array.isArray(a.p_submits) || typeof a.p_level !== "number") return err("BAD_SUBMITS");
      var ns = a.p_submits.length, last = ns > 0 && a.p_submits[ns - 1] === q.answer_index;
      // schema.sql 과 같게: 보기 번호 범위 밖·같은 답 두 번 → BAD_SUBMITS
      if (ns > (q.type === "ox" ? 1 : 2) || a.p_submits.some(function (v) { return !(v >= 0 && v < q.choices.length); }) ||
          (ns === 2 && a.p_submits[0] === a.p_submits[1])) return err("BAD_SUBMITS");
      if (a.p_level === 4 && ns === 0) return err("L4_BEFORE_SUBMIT");
      var outcome = a.p_level >= 4 || !last ? "정답 보고 이해" : a.p_level >= 1 ? "힌트로 해결" : ns === 1 ? "혼자 맞힘" : "두 번째에 맞힘";
      var x = db(); var xp = 10 + (a.p_mode === "REVIEW" && outcome === "혼자 맞힘" ? 5 : 0);
      // schema.sql 과 같게: 연습(PRACTICE)에서 전에 푼 적 있는 문항이면 XP 0
      if (a.p_mode === "PRACTICE" && x.attempts.some(function (t) { return t.code === c && t.qid === q.id; })) xp = 0;
      x.students[c].xp += xp;
      x.attempts.push({ code: c, qid: q.id, mode: a.p_mode, outcome: outcome, xp: xp, day: today() }); save(x);
      return ok({ xp: xp, xpTotal: x.students[c].xp, outcome: outcome, reviewNote: outcome === "혼자 맞힘" ? null : "again" });
    },
    my_team_summary: function () {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      return ok(teamSummary(c));
    },
    set_team_off: function (a) {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var x = db(); x.students[c].team_off = !!a.p_off; save(x);
      return ok(teamSummary(c));
    },
    admin_whoami: function () {
      var e = adminOf(); if (!e) return ok({ admin: false });
      var t = today();
      return ok({ admin: true, email: e, today: t, weekStart: weekStartOf(t), cohorts: ["2027-1", "2026-9"] });
    },
    admin_item_stats: function (a) {
      if (!adminOf()) return err("NOT_ADMIN");
      return ok(Object.assign({ cohort: a.p_cohort }, D.adminStats || { items: [], lectures: [] }));
    },
    admin_team_week: function (a) {
      if (!adminOf()) return err("NOT_ADMIN");
      return ok(Object.assign({}, D.adminTeams || { teams: [] }, { cohort: a.p_cohort, weekStart: a.p_week || weekStartOf(today()) }));
    },
    today_summary: function () {
      var c = meCode(); if (!c) return err("NOT_LINKED");
      var x = db(), t = today(), mine = x.attempts.filter(function (a) { return a.code === c; });
      var counts = {}; mine.forEach(function (a) { counts[a.day] = (counts[a.day] || 0) + 1; });
      var xpSum = mine.reduce(function (s, a) { return s + a.xp; }, 0);
      return ok({ day: t, reviews: [], newDone: mine.filter(function (a) { return a.day === t && a.mode === "PRACTICE"; }).length,
                  newTarget: 5, xp: x.students[c].xp, xpToday: xpSum, weekXp: xpSum, weekSolved: mine.length, counts: counts });
    }
  };

  function pick(row, cols) { var o = {}; cols.split(",").forEach(function (k) { k = k.trim(); if (k in row) o[k] = row[k]; }); return o; }
  function tableRows(table) {
    var c = meCode(), x = db();
    if (table === "questions") return D.practice.map(function (q) { return Object.assign({ pool: "practice", diag_order: null, b: 0, n_resp: 0 }, q); })
      .concat(D.diag.map(function (q, i) { return Object.assign({ pool: "diagnostic", diag_order: i + 1, b: 0, n_resp: 0 }, q); }))
      .map(function (q) { var o = Object.assign({}, q); delete o.answer_index; delete o.explanation; delete o.common_wrong_index; delete o.common_wrong_reason; return o; });
    if (table === "question_keys") return D.practice.map(function (q) {   // 학생 규칙: 연습 문항 정답만
      return { question_id: q.id, answer_index: q.answer_index, explanation: q.explanation, common_wrong_index: q.common_wrong_index, common_wrong_reason: q.common_wrong_reason };
    });
    if (table === "hints") return Object.keys(D.reviewedHints || {}).map(function (k) { var h = D.reviewedHints[k]; return { question_id: k, l1: h.l1, l2: h.l2, l3: h.l3 }; });
    if (table === "students") return c ? [x.students[c]] : [];
    if (table === "diag_answers") return c ? Object.keys(x.diag[c] || {}).map(function (k) { return { question_id: k, choice: x.diag[c][k] }; }) : [];
    return null;
  }
  function from(table) {
    var q = { table: table, cols: "*", eq: [], order: null, single: false };
    var b = {
      select: function (cols) { q.cols = cols; return b; },
      eq: function (k, v) { q.eq.push([k, v]); return b; },
      order: function (k) { q.order = k; return b; },
      maybeSingle: function () { q.single = true; return b; },
      then: function (res, rej) {
        log({ t: "from", table: table, cols: q.cols, eq: q.eq, order: q.order, single: q.single });
        var f = fail()["from:" + table];
        if (f) return err(f).then(res, rej);
        if (table === "students" && /theta|n_answers|\*/.test(q.cols)) return err("permission denied for table students").then(res, rej);
        var rows = tableRows(table);
        if (rows === null) return err("permission denied for table " + table).then(res, rej);
        q.eq.forEach(function (e) { rows = rows.filter(function (r) { return r[e[0]] === e[1]; }); });
        if (q.order) rows = rows.slice().sort(function (a, c) { return a[q.order] < c[q.order] ? -1 : a[q.order] > c[q.order] ? 1 : 0; });
        rows = rows.map(function (r) { return q.cols === "*" ? r : pick(r, q.cols); });
        return ok(q.single ? (rows[0] || null) : rows).then(res, rej);
      }
    };
    return b;
  }

  window.supabase = {
    __mock: true,
    createClient: function (url, key, opts) {
      var au = (opts && opts.auth) || {};
      var mySk = !au.storageKey || au.storageKey === "lu2_sb_auth" ? "mock_session" : "mock_session:" + au.storageKey;
      log({ t: "createClient", url: url, key: key, storageKey: au.storageKey, detectSessionInUrl: au.detectSessionInUrl, flowType: au.flowType });
      function use() { SKEY = mySk; }
      return {
        auth: {
          getSession: function () { use(); log({ t: "getSession" }); return ok({ session: session() }); },
          // [M2] 교수 이메일 로그인 흉내: 등록된 이메일(adminUsers)만 메일 발송, 6자리 숫자 123456 이면 로그인
          signInWithOtp: function (p) {
            use(); log({ t: "signInWithOtp", email: p && p.email, options: p && p.options });
            var f = fail().signInWithOtp; if (f) return Promise.resolve({ data: null, error: { message: f, status: 429 } });
            var e = String((p && p.email) || "").toLowerCase();
            var known = (D.adminUsers || []).map(function (y) { return y.toLowerCase(); }).indexOf(e) >= 0;
            if (!known && p.options && p.options.shouldCreateUser === false) return Promise.resolve({ data: null, error: { message: "Signups not allowed for otp", status: 422, code: "otp_disabled" } });
            ls("mock_otp_pending", e); return ok({ user: null, session: null });
          },
          verifyOtp: function (p) {
            use(); log({ t: "verifyOtp", email: p && p.email, token: p && p.token, type: p && p.type });
            if (String(p.token) !== "123456" || ls("mock_otp_pending") !== String(p.email).toLowerCase())
              return Promise.resolve({ data: null, error: { message: "Token has expired or is invalid", status: 403, code: "otp_expired" } });
            var s = { uid: "user-" + p.email, access_token: "fake", user: { id: "user-" + p.email, email: String(p.email).toLowerCase(), is_anonymous: false } };
            ls(SKEY, s); localStorage.removeItem("mock_otp_pending"); return ok({ user: s.user, session: s });
          },
          signInAnonymously: function () {
            use(); log({ t: "signInAnonymously" });
            var s = { uid: "anon-" + Math.random().toString(36).slice(2, 10), access_token: "fake" };
            ls(SKEY, s); return ok({ user: { id: s.uid, is_anonymous: true }, session: s });
          },
          signOut: function (o) { use(); log({ t: "signOut", scope: o && o.scope }); localStorage.removeItem(SKEY); return ok(null); }
        },
        rpc: function (name, args) {
          use(); log({ t: "rpc", name: name, args: JSON.parse(JSON.stringify(args || {})) });
          var f = fail()[name];
          if (f && f !== "too_many") return err(f);
          if (!RPC[name]) return err("Could not find the function public." + name);
          // 느린 인터넷 흉내: localStorage 'mock_delay' = {rpc이름: 밀리초}
          var dl = (ls("mock_delay") || {})[name];
          if (dl) return new Promise(function (r) { setTimeout(r, dl); }).then(function () { use(); return RPC[name](args || {}); });
          return RPC[name](args || {});
        },
        from: function (t) { use(); return from(t); },
        functions: {
          invoke: function (name, o) {
            use(); var body = (o && o.body) || {};
            log({ t: "invoke", name: name, body: JSON.parse(JSON.stringify(body)) });
            var T = D.tutor;
            if (!T || name !== "ai-tutor") return Promise.resolve({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: null } });
            if (!meCode()) return ok({ ok: false, error: "NO_AUTH", message: "로그인이 풀렸어요. 새로고침한 뒤 코드를 다시 넣어 주세요." });
            var st = tutorState();
            if (T.error) return ok({ ok: false, error: T.error, message: T.message || "가짜 거절" });   // 진짜 함수처럼: 문항 거절에는 남은 횟수 칸 없음
            if (!st.enabled) return ok(Object.assign({ ok: false, error: st.reason, message: "가짜 서버: " + st.reason }, st));
            var kind = T.kind || "ok";
            if (kind === "ok") { var x = db(); x.tutorUsed = (x.tutorUsed || 0) + 1; save(x); }
            return ok(Object.assign({ ok: true, kind: kind, reply: T.reply || "가짜 서버 AI 답이에요. 어떤 낱말이 헷갈리나요?" }, tutorState()));
          }
        }
      };
    }
  };
})();
