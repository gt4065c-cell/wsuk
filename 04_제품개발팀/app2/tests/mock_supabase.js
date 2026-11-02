/* =========================================================
   [시험용] 가짜 Supabase 라이브러리 (mock)
   - 자동 시험(run_e2e_supabase_mock.js)이 vendor/supabase.js 대신 이 파일을 끼워 넣습니다.
   - 인터넷에 나가지 않고, 브라우저 저장소 안의 "가짜 서버"가 schema.sql 의 서버 함수와
     같은 모양으로 답합니다. 부른 순서·인자는 localStorage 'mock_log' 에 적어 둡니다.
   - 가짜 문항 데이터는 시험 도구가 window.__MOCK_DATA 로 미리 넣어 줍니다(가짜 학생만 사용).
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

  function session() { return ls("mock_session"); }
  function meCode() { var s = session(); if (!s) return null; return db().devices[s.uid] || null; }

  var RPC = {
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
      var q = D.practice.find(function (q) { return ex.indexOf(q.id) < 0 && !done[q.id]; });
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
      log({ t: "createClient", url: url, key: key, storageKey: opts && opts.auth && opts.auth.storageKey });
      return {
        auth: {
          getSession: function () { log({ t: "getSession" }); return ok({ session: session() }); },
          signInAnonymously: function () {
            log({ t: "signInAnonymously" });
            var s = { uid: "anon-" + Math.random().toString(36).slice(2, 10), access_token: "fake" };
            ls("mock_session", s); return ok({ user: { id: s.uid, is_anonymous: true }, session: s });
          },
          signOut: function (o) { log({ t: "signOut", scope: o && o.scope }); localStorage.removeItem("mock_session"); return ok(null); }
        },
        rpc: function (name, args) {
          log({ t: "rpc", name: name, args: JSON.parse(JSON.stringify(args || {})) });
          var f = fail()[name];
          if (f && f !== "too_many") return err(f);
          if (!RPC[name]) return err("Could not find the function public." + name);
          // 느린 인터넷 흉내: localStorage 'mock_delay' = {rpc이름: 밀리초}
          var dl = (ls("mock_delay") || {})[name];
          if (dl) return new Promise(function (r) { setTimeout(r, dl); }).then(function () { return RPC[name](args || {}); });
          return RPC[name](args || {});
        },
        from: from
      };
    }
  };
})();
