/* =========================================================
   레벨업 캠퍼스 2단계 M2 1차 — 교수 화면 (admin.js, admin.html 전용)

   보여 주는 것
     ① 반 전체 많이 틀린 문항 TOP 10 (오답률·응답 수·가장 많이 고른 오답·정답)
     ② 강별 첫 시도 정답률
     ③ 팀별 이번 주(또는 지난주) 참여 목표 달성
     ④ [M2 3차] AI 튜터 사용량 (오늘·이번 달 호출 수, 추정 금액 / 예산) — 서버 admin_tutor_usage()
     ⑤ [M2 3차] 주간 공통 점검 문항별 정답률(응시 3명 이상일 때만) + 팀별 응시 인원 — 서버 admin_weekly_stats()
        ④·⑤ 함수가 서버에 아직 없으면(SQL 적용 전) 그 칸만 "아직 설치 전"으로 보이고 나머지 화면은 그대로
   보여 주지 않는 것: 학생 코드, 개인 XP·숨은 실력값·정오답 (학생은 별명으로만)

   로그인
     Supabase 모드: [기본] 교수 이메일 + 비밀번호 (signInWithPassword) — 메일을 보내지 않으므로 메일 한도(시간당 몇 통)와 무관
                    [보조] "메일로 로그인 링크 받기" → Supabase가 로그인 메일(매직링크) 발송 → 링크를 누르면 이 화면으로 돌아와 로그인
                    (메일에 6자리 숫자가 있으면 숫자로도 가능). 새 계정은 만들지 않음(shouldCreateUser: false)
                    비밀번호는 입력 칸에서 바로 읽어 서버에 보내고 끝 — 변수·localStorage·로그 어디에도 남기지 않음
                    어느 방법이든 로그인 뒤 admin_whoami 가 교수 여부를 판정
                    → 교수 계정은 Supabase 관리 화면에서 미리 등록 + admins 표에 이메일 등록(README 6장)
                    서버 함수(admin_*)가 매번 "admins 표에 있는, 메일 확인 끝난 계정인지" 다시 확인 → 학생이 열면 거절
     로컬 모드   : 메일 없이 config.js 의 가짜 교수 이메일(DEV_ADMIN_EMAILS)로 바로 들어감 + 가짜 통계(가짜 학생 50명)

   학생 화면(index.html)과 로그인 저장 칸을 따로 씀(storageKey "lu2_sb_admin") → 같은 브라우저에서도 섞이지 않음
   ========================================================= */
(function () {
  "use strict";
  var CFG = window.LU_CONFIG || {};
  var LOCAL = CFG.MODE !== "supabase";
  var root = document.getElementById("admin");
  var A = { screen: "loading", err: "", info: "", email: "", code: "", sent: false, who: null,
            cohort: null, weekBack: 0, stats: null, teams: null, tutor: null, weekly: null, wkWeek: null, busy: false };

  /* ---------- 도우미 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function loadScript(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = src; s.onload = function () { ok(); };
      s.onerror = function () { no(new Error("파일(" + src + ")을 불러오지 못했어요. 새로고침해 주세요.")); };
      document.head.appendChild(s);
    });
  }
  function addDays(day, n) {
    var d = new Date(String(day).slice(0, 10) + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
  function mondayOf(day) { var d = new Date(day + "T00:00:00Z"); return addDays(day, -((d.getUTCDay() + 6) % 7)); }
  function pct(x) { return Math.round((Number(x) || 0) * 100) + "%"; }
  function lec(n) { return (n < 10 ? "0" : "") + n + "강"; }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  /* 오류 → 쉬운 한국어 한 줄 */
  function explain(e) {
    var m = String((e && (e.message || e.error_description || e.msg)) || e || "");
    var code = e && (e.status || e.code);
    var ecode = String((e && e.code) || "");
    if (/NOT_ADMIN/.test(m)) return "교수 계정이 아니라서 볼 수 없어요.";
    if (ecode === "invalid_credentials" || /invalid login credentials/i.test(m))
      return "이메일이나 비밀번호가 맞지 않아요. 다시 확인해 주세요. 비밀번호가 생각나지 않으면 아래 '메일로 로그인 링크 받기'를 눌러 주세요.";
    if (ecode === "email_not_confirmed" || /email not confirmed/i.test(m))
      return "아직 이메일 확인이 끝나지 않은 계정이에요. 비서실장에게 확인을 부탁하세요.";
    if (/signups? not allowed|user not found|otp_disabled/i.test(m))
      return "교수 계정으로 등록되지 않은 이메일이에요. 비서실장에게 등록을 부탁하세요.";
    if (/jwt expired|refresh token|invalid jwt/i.test(m)) return "로그인이 만료됐어요. 다시 로그인해 주세요.";
    if (ecode === "over_email_send_rate_limit" || /email rate limit|over_email_send_rate_limit|after \d+ seconds/i.test(m))
      return "로그인 메일은 한 시간에 몇 통만 보낼 수 있어요. 비밀번호로 로그인하거나 한 시간쯤 뒤에 다시 해 주세요.";
    if (code === 429 || code === "429" || /rate limit|too many/i.test(m)) return "짧은 시간에 너무 여러 번 시도했어요. 몇 분 뒤에 다시 해 주세요.";
    if (/token has expired|otp.?expired|invalid.*(token|otp)|(token|otp).*invalid|expired/i.test(m)) return "숫자나 링크가 틀렸거나 시간이 지났어요. 로그인 메일을 다시 받아 주세요.";
    if (/could not find the function|PGRST202/i.test(m)) return "서버에 교수 화면 기능이 아직 설치되지 않았어요(30_m2_teams_admin.sql 적용 전). 비서실장에게 알려 주세요.";
    if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(m)) return "서버에 닿지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.";
    if (/jwt|refresh token|session/i.test(m)) return "로그인이 만료됐어요. 다시 로그인해 주세요.";
    if (/파일\(/.test(m) || /라이브러리/.test(m)) return m;
    return "문제가 생겼어요. 잠시 뒤 다시 해 주세요." + (m ? " (" + m.slice(0, 80) + ")" : "");
  }

  /* ================================================================
     A. 로컬 모드 — 가짜 교수 · 가짜 통계 (가짜 학생 50명, 실제 사람 아님)
     ================================================================ */
  var LOCAL_KEY = "lu2_admin_local_session";
  function rng(seed) {   // 늘 같은 가짜 숫자가 나오는 난수 (mulberry32)
    var a = 0; for (var i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) | 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  var LocalAdmin = {
    mode: "local",
    devLabel: "로컬 모드(개발용) · 가짜 학생 50명의 가짜 통계예요",
    init: function () {
      // 문항 글만 필요(연습 정답은 연습 파일에 원래 있음). 진단 정답 파일(dev_diag_key.js)은 읽지 않음
      return Promise.all([loadScript("data/practice.js"), loadScript("data/diagnostic.js")]);
    },
    session: function () { var e = lsGet(LOCAL_KEY); return Promise.resolve(e ? { email: e } : null); },
    sendLink: function (email) {
      var list = (CFG.DEV_ADMIN_EMAILS || []).map(function (x) { return String(x).toLowerCase(); });
      if (list.indexOf(email.toLowerCase()) < 0) return Promise.reject(new Error("Signups not allowed for otp"));
      lsSet(LOCAL_KEY, email);
      return Promise.resolve({ instant: true });
    },
    verifyCode: function () { return Promise.resolve(); },
    passwordLogin: function (email) { return LocalAdmin.sendLink(email); },   // 로컬 모드는 비밀번호 칸이 없음(가짜 교수 이메일만)
    logout: function () { lsDel(LOCAL_KEY); return Promise.resolve(); },
    whoami: function () {
      var t = kstToday();
      return Promise.resolve({ admin: true, email: lsGet(LOCAL_KEY), today: t, weekStart: mondayOf(t), cohorts: ["2027-1"], fake: true });
    },
    itemStats: function (cohort) {
      var r = rng("items|" + cohort), items = [], lecs = {};
      var P = ((window.LU_PRACTICE || {}).questions || []).slice(0, 80), D = (window.LU_DIAG || {}).questions || [];
      P.forEach(function (q) {
        var n = 3 + Math.floor(r() * 28), rate = Math.pow(r(), 1.6), wrong = Math.round(n * rate);
        var wrongs = q.choices.map(function (_, i) { return i; }).filter(function (i) { return i !== q.answer_index; });
        var tw = wrong ? wrongs[Math.floor(r() * wrongs.length)] : null;
        items.push({ qid: q.id, pool: "practice", lecture: q.lecture, question: q.question, n: n, wrong: wrong, unknown: 0,
                     hinted: Math.floor(wrong * r()), wrongRate: Math.round(wrong / n * 1000) / 1000,
                     topWrongText: tw === null ? null : q.choices[tw], topWrongIndex: tw, answerText: q.choices[q.answer_index] });
        var L = lecs[q.lecture] = lecs[q.lecture] || { lecture: q.lecture, n: 0, wrong: 0 }; L.n += n; L.wrong += wrong;
      });
      D.forEach(function (q) {
        var n = 46, wrong = Math.round(n * r() * 0.8), unk = Math.floor(wrong * r() * 0.5);
        items.push({ qid: q.id, pool: "diagnostic", lecture: q.lecture, question: q.question, n: n, wrong: wrong, unknown: unk, hinted: 0,
                     wrongRate: Math.round(wrong / n * 1000) / 1000, topWrongText: q.choices[Math.floor(r() * q.choices.length)], topWrongIndex: null,
                     answerText: null });   // 로컬 모드는 진단 정답 파일을 읽지 않음 → 정답 칸 비움
      });
      items.sort(function (a, b) { return b.wrongRate - a.wrongRate || b.n - a.n || (a.qid < b.qid ? -1 : 1); });
      return Promise.resolve({
        cohort: cohort, minN: 3, students: 50, linked: 48, diagDone: 46, activeWeek: 37, fake: true,
        items: items.slice(0, 10),
        lectures: Object.keys(lecs).map(function (k) { var L = lecs[k]; return { lecture: L.lecture, n: L.n, correctRate: Math.round((1 - L.wrong / L.n) * 1000) / 1000 }; })
          .sort(function (a, b) { return a.lecture - b.lecture; })
      });
    },
    // [M2 3차] 가짜 AI 튜터 사용량 · 가짜 공통 점검 통계 (연습 문항 글을 빌려 씀 — 진짜 공통 점검 문항은 로컬 파일에 없음)
    tutorUsage: function () {
      return Promise.resolve({ enabled: false, budgetUsd: 6.4, todayCalls: 23, todayOk: 19, monthCalls: 412, monthStudents: 37,
                               monthBlocked: 3, monthCostUsd: 0.4123, monthCostKrw: 577, fake: true });
    },
    weeklyStats: function (cohort, week) {
      var cur = 3, w = week || cur, r = rng("weekly|" + cohort + "|" + w);
      var P = ((window.LU_PRACTICE || {}).questions || []).filter(function (q) { return q.type === "mcq"; }).slice((w - 1) * 8, w * 8);
      var takers = w > cur ? 0 : w === cur ? 2 + Math.floor(r() * 30) : 30 + Math.floor(r() * 15);
      return Promise.resolve({
        cohort: cohort, cohortStart: "2027-03-01", currentWeek: cur, maxWeek: 8, week: w, minN: 3, takers: takers, fake: true,
        items: P.map(function (q, i) {
          var n = w === cur && i === 7 ? 2 : takers, ok = Math.round(n * (0.35 + r() * 0.6));
          return { qid: "W" + w + "-Q" + (i + 1), lecture: q.lecture, question: q.question, n: n,
                   correctRate: n >= 3 ? Math.round(ok / n * 1000) / 1000 : null, unknown: n >= 3 ? Math.floor(r() * 4) : null,
                   answerText: q.choices[q.answer_index] };
        }),
        teams: [1, 2, 3, 4, 5].map(function (k) { var a = k === 5 ? 3 : 4; return { name: k + "팀", active: a, taken: w > cur ? 0 : Math.min(a, Math.floor(r() * (a + 1))) }; })
      });
    },
    teamWeek: function (cohort, week) {
      var r = rng("teams|" + cohort + "|" + week), nums = [], k = 13, teams = [], idx = 0;
      for (var i = 1; i <= k; i++) nums.push(i);
      nums.sort(function () { return r() - 0.5; });
      for (var j = 0; j < k; j++) {
        var size = j < 11 ? 4 : 3, members = [], counts = [];
        for (var m = 0; m < size; m++) {
          idx++;
          var resting = r() < 0.06, c = r() < 0.7 ? 15 + Math.floor(r() * 8) : Math.floor(r() * 15);
          members.push({ nickname: "가짜" + (idx < 10 ? "0" : "") + idx, resting: resting, activeWeek: c > 0 });
          counts.push({ count: c, resting: resting });
        }
        var w = teamWeekRule(counts, 15);
        teams.push({ name: nums[j] + "팀", cohort: cohort, goalPerMember: 15, activeMembers: w.activeMembers, progress: w.progress,
                     goal: w.goal, achieved: w.achieved, members: members });
      }
      teams.sort(function (a, b) { return a.name.length - b.name.length || (a.name < b.name ? -1 : 1); });
      return Promise.resolve({ cohort: cohort, weekStart: week, teams: teams, fake: true,
        achievedCount: teams.filter(function (t) { return t.achieved; }).length, unassigned: 0,
        resting: teams.reduce(function (s, t) { return s + t.members.filter(function (m) { return m.resting; }).length; }, 0) });
    }
  };
  // logic.js 의 LU.teamWeek 와 같은 규칙(교수 화면은 logic.js 를 읽지 않아 여기 짧게 둠 — 가짜 데이터용)
  function teamWeekRule(members, g) {
    var act = members.filter(function (m) { return !m.resting; });
    var p = act.reduce(function (s, m) { return s + Math.min(m.count, g); }, 0);
    return { activeMembers: act.length, progress: p, goal: g * act.length, achieved: act.length > 0 && p >= g * act.length };
  }

  /* ================================================================
     B. Supabase 모드 — 이메일 매직링크 로그인 + 교수용 서버 함수
     ================================================================ */
  var clientP = null;
  function sb() {
    if (!clientP) clientP = (window.supabase && window.supabase.createClient ? Promise.resolve() : loadScript("vendor/supabase.js"))
      .then(function () {
        if (!window.supabase || !window.supabase.createClient) throw new Error("Supabase 라이브러리(vendor/supabase.js)가 비어 있어요.");
        if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) throw new Error("config.js 에 SUPABASE_URL·SUPABASE_ANON_KEY 가 비어 있어요.");
        return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: "lu2_sb_admin" }
        });
      })
      .catch(function (e) { clientP = null; throw e; });
    return clientP;
  }
  function unwrap(r) { if (r && r.error) throw r.error; return r ? r.data : null; }
  function rpc(name, args) { return sb().then(function (c) { return c.rpc(name, args || {}); }).then(unwrap); }
  function redirectUrl() {
    var keep = /[?&]mode=supabase\b/.test(window.location.search) ? "?mode=supabase" : "";
    return window.location.origin + window.location.pathname + keep;
  }
  var SupabaseAdmin = {
    mode: "supabase", devLabel: "",
    init: function () { return sb(); },
    session: function () {
      return sb().then(function (c) { return c.auth.getSession(); }).then(function (r) {
        var s = r && r.data && r.data.session; if (!s || !s.user) return null;
        if (s.user.is_anonymous) return null;   // 학생용 익명 계정은 교수 로그인으로 치지 않음
        return { email: s.user.email || "" };
      });
    },
    sendLink: function (email) {
      return sb().then(function (c) {
        return c.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, emailRedirectTo: redirectUrl() } });
      }).then(unwrap).then(function () { return { instant: false }; });
    },
    verifyCode: function (email, code) {
      return sb().then(function (c) { return c.auth.verifyOtp({ email: email, token: code, type: "email" }); }).then(unwrap);
    },
    // 비밀번호는 인자로만 받아 바로 보냄(어디에도 저장·기록하지 않음). 교수 여부는 이어서 admin_whoami 가 판정
    passwordLogin: function (email, password) {
      return sb().then(function (c) { return c.auth.signInWithPassword({ email: email, password: password }); }).then(unwrap);
    },
    logout: function () {
      return sb().then(function (c) { return c.auth.signOut({ scope: "local" }); }).then(function () {}, function () {});
    },
    whoami: function () { return rpc("admin_whoami"); },
    itemStats: function (cohort) { return rpc("admin_item_stats", { p_cohort: cohort || null, p_min_n: 3, p_limit: 10 }); },
    teamWeek: function (cohort, week) { return rpc("admin_team_week", { p_cohort: cohort || null, p_week: week || null }); },
    tutorUsage: function () { return rpc("admin_tutor_usage"); },
    weeklyStats: function (cohort, week) { return rpc("admin_weekly_stats", { p_cohort: cohort || null, p_week: week || null }); }
  };

  var ADM = LOCAL ? LocalAdmin : SupabaseAdmin;

  /* ---------- 흐름 ---------- */
  function go(screen) { A.screen = screen; render(); window.scrollTo(0, 0); }
  function fail(e) { A.err = explain(e); render(); }
  function guard(fn) {
    if (A.busy) return;
    A.busy = true; Array.prototype.forEach.call(root.querySelectorAll("button,select"), function (b) { b.disabled = true; });
    var p; try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    return p.catch(fail).then(function () { A.busy = false; render(); });
  }
  function boot() {
    if (ADM.devLabel) { var d = document.getElementById("devbar"); d.textContent = ADM.devLabel; d.hidden = false; }
    // 메일 링크가 만료·잘못됐으면 Supabase가 주소 뒤(#)에 오류를 붙여 돌려보냄 → 쉬운 말로 보여 주고 주소는 깨끗이
    var h = window.location.hash || "";
    if (/error_description=|error_code=/.test(h)) {
      var q = new URLSearchParams(h.slice(1));
      A.err = explain(q.get("error_code") === "otp_expired" ? "otp_expired" : (q.get("error_description") || q.get("error") || "링크 오류"));
      try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) { /* 무시 */ }
    }
    return ADM.init().then(function () { return ADM.session(); }).then(function (s) {
      if (!s) return go("login");
      A.email = s.email; return afterLogin();
    }).catch(function (e) { A.err = explain(e); go(A.email ? "error" : "login"); });
  }
  function afterLogin() {
    return ADM.whoami().then(function (w) {
      A.who = w || { admin: false };
      if (!A.who.admin) return go("notAdmin");
      if (A.cohort === null) A.cohort = (A.who.cohorts && A.who.cohorts[0]) || "";
      return loadDash();
    });
  }
  function weekStart() {
    var base = (A.who && A.who.weekStart) ? String(A.who.weekStart).slice(0, 10) : mondayOf(kstToday());
    return addDays(base, -7 * A.weekBack);
  }
  /* ④·⑤는 실패해도 대시보드는 열림: 그 칸에만 이유 한 줄 (NOT_ADMIN 은 그대로 오류로) */
  function soft(p) {
    return p.then(function (x) { return x || {}; }, function (e) {
      if (/NOT_ADMIN/.test(String((e && e.message) || e))) throw e;
      return { _missing: true, _why: explain(e) };
    });
  }
  function loadDash() {
    return Promise.all([ADM.itemStats(A.cohort), ADM.teamWeek(A.cohort, weekStart()), soft(ADM.tutorUsage()), soft(ADM.weeklyStats(A.cohort, A.wkWeek))]).then(function (r) {
      A.stats = r[0] || {}; A.teams = r[1] || {}; A.tutor = r[2]; A.weekly = r[3]; A.err = ""; go("dash");
    });
  }

  /* ---------- 화면 ---------- */
  function render() {
    var who = document.getElementById("who");
    who.textContent = A.screen === "dash" && A.email ? "교수 화면 · " + A.email : "교수 화면";
    var v = ({ loading: vLoading, login: vLogin, notAdmin: vNotAdmin, error: vError, dash: vDash })[A.screen]();
    var err = A.err ? '<div class="note" role="alert" id="err"><div class="note-title">문제가 생겼어요</div>' + esc(A.err) + '</div>' : "";
    root.innerHTML = '<section class="screen" data-screen="' + A.screen + '">' + v.replace("<!--ERR-->", err) + '</section>';
    if (A.busy) Array.prototype.forEach.call(root.querySelectorAll("button,select"), function (b) { b.disabled = true; });
  }
  function vLoading() { return '<div class="content"><p class="sub">불러오는 중…</p><!--ERR--></div>'; }
  function vLogin() {
    var local = ADM.mode === "local";
    return '<div class="content"><div class="brand"><div class="logo">LU</div><div><h1>교수 화면</h1><div class="brand-sub">반 전체 학습 현황 (교수 계정 전용)</div></div></div>' +
      '<div class="field"><label for="email">교수 이메일</label><input id="email" class="text" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="이메일 주소" value="' + esc(A.email) + '"' + (A.sent ? " readonly" : "") + '></div>' +
      (local ? '<div class="info">[개발용] 로컬 모드 가짜 교수 이메일: <span class="mono">' + esc((CFG.DEV_ADMIN_EMAILS || []).join(" · ")) + '</span> (메일 없이 바로 들어가요)</div>'
             : (A.sent ? "" :
               // 비밀번호 칸: value 를 넣지 않음(다시 그리면 비워짐) · 브라우저 비밀번호 저장/자동완성은 허용
               '<div class="field"><label for="password">비밀번호</label><input id="password" class="text" type="password" autocomplete="current-password" spellcheck="false" autocapitalize="off" placeholder="교수 계정 비밀번호"></div>' +
               '<div class="btn-col"><button class="btn btn-primary" data-act="password">로그인</button></div>' +
               '<p class="sub" id="pw-help">학생 코드로는 들어올 수 없어요. 비밀번호가 생각나지 않으면 아래 버튼으로 로그인 메일을 받을 수 있어요(메일은 한 시간에 몇 통만 보낼 수 있어요).</p>' +
               '<div class="btn-col"><button class="btn btn-secondary" data-act="send">메일로 로그인 링크 받기</button></div>')) +
      (A.sent ? '<div class="info" id="sent">로그인 메일을 보냈어요. <b>메일의 링크를 이 브라우저에서</b> 누르면 이 화면으로 돌아와요. 메일에 6자리 숫자가 있으면 아래에 넣어도 돼요.</div>' +
        '<div class="field"><label for="otp">메일의 숫자 (있을 때만)</label><input id="otp" class="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" value="' + esc(A.code) + '"></div>' +
        '<div class="btn-col"><button class="btn btn-secondary" data-act="verify">숫자로 들어가기</button><button class="linkbtn" data-act="reset">다른 이메일로</button></div>' : "") +
      '<!--ERR--></div>' +
      (A.sent || !local ? "" : '<div class="bottombar"><button class="btn btn-primary" data-act="send">들어가기</button></div>');
  }
  function vNotAdmin() {
    return '<div class="content"><h2>교수 계정이 아니에요</h2><p id="not-admin">' + esc(A.email || "이 계정") + ' 은(는) 교수 계정으로 등록되어 있지 않아 반 전체 정보를 볼 수 없어요.</p>' +
      '<p class="sub">학생은 학생 화면(index.html)에서 참가자 코드로 들어가요.</p><!--ERR-->' +
      '<button class="btn btn-secondary" data-act="logout">로그아웃</button></div>';
  }
  function vError() {   // 로그인은 됐는데 교수 정보를 못 받음(서버 함수 미설치·인터넷 끊김 등)
    return '<div class="content"><h2>교수 화면을 열지 못했어요</h2><!--ERR-->' +
      '<div class="btn-col"><button class="btn btn-secondary" data-act="retry">다시 시도</button><button class="linkbtn" data-act="logout">로그아웃</button></div></div>';
  }
  function vDash() {
    var s = A.stats || {}, t = A.teams || {}, w = A.who || {};
    var cohorts = w.cohorts || [];
    var fake = s.fake || t.fake;
    var head = '<div class="row-flex" id="filters"><label for="cohort" class="sub">기수</label><select id="cohort" class="sel">' +
      cohorts.map(function (c) { return '<option value="' + esc(c) + '"' + (c === A.cohort ? " selected" : "") + '>' + esc(c) + '</option>'; }).join("") +
      '<option value=""' + (A.cohort === "" ? " selected" : "") + '>전체 기수</option></select>' +
      '<button class="btn btn-secondary" data-act="refresh">새로 고침</button><button class="linkbtn" data-act="logout">로그아웃</button></div>';
    var grid = '<ul class="admin-grid" id="totals">' +
      '<li><b>' + (s.students || 0) + '</b><span>학생(코드 카드)</span></li><li><b>' + (s.linked || 0) + '</b><span>코드로 들어온 학생</span></li>' +
      '<li><b>' + (s.diagDone || 0) + '</b><span>진단 끝냄</span></li><li><b>' + (s.activeWeek || 0) + '</b><span>이번 주 학습한 학생</span></li></ul>';
    var items = s.items || [];
    var tbl = items.length ? '<table class="tbl" id="top-items"><thead><tr><th>#</th><th>강</th><th class="hide-sm">종류</th><th>문항</th><th>오답률</th><th>응답</th><th class="hide-sm">많이 고른 오답</th><th class="hide-sm">정답</th></tr></thead><tbody>' +
      items.map(function (x, i) {
        return '<tr data-qid="' + esc(x.qid) + '"><td class="num">' + (i + 1) + '</td><td>' + esc(lec(x.lecture)) + '</td>' +
          '<td class="hide-sm"><span class="tag">' + (x.pool === "diagnostic" ? "진단" : "연습") + '</span></td>' +
          '<td class="qtxt">' + esc(x.question) + '<div class="sub mono">' + esc(x.qid) + (x.unknown ? ' · 모르겠어요 ' + x.unknown + '명' : "") + (x.hinted ? ' · 힌트 쓴 학생 ' + x.hinted + '명' : "") + '</div></td>' +
          '<td class="num"><b class="rate">' + pct(x.wrongRate) + '</b><div class="bar"><i style="width:' + pct(x.wrongRate) + '"></i></div></td>' +
          '<td class="num">' + x.n + '</td><td class="hide-sm">' + esc(x.topWrongText || "—") + '</td><td class="hide-sm">' + esc(x.answerText || "—") + '</td></tr>';
      }).join("") + '</tbody></table>'
      : '<p class="sub" id="top-items-empty">아직 응답이 ' + (s.minN || 3) + '명 넘은 문항이 없어요.</p>';
    var lecs = (s.lectures || []).map(function (L) {
      return '<div class="row-flex lec-row"><span class="tag">' + esc(lec(L.lecture)) + '</span><div class="bar" style="flex:1"><i style="width:' + pct(L.correctRate) + '"></i></div>' +
        '<span class="mono">' + pct(L.correctRate) + '</span><span class="sub">(' + L.n + '건)</span></div>';
    }).join("") || '<p class="sub">아직 기록이 없어요.</p>';
    var teams = t.teams || [];
    var weekLbl = A.weekBack === 0 ? "이번 주" : "지난주";
    var teamHtml = teams.length ? '<div class="team-list" id="team-list">' + teams.map(function (x) {
      var p = x.goal ? Math.min(100, Math.round(x.progress / x.goal * 100)) : 0;
      return '<div class="card" data-team="' + esc(x.name) + '" data-achieved="' + (x.achieved ? 1 : 0) + '"><div class="plan-row"><h3>' + esc(x.name) + '</h3>' +
        '<span class="tag">' + (x.achieved ? "참여 목표 달성" : "도전 중") + '</span></div>' +
        '<div class="plan-row"><span class="sub">팀원 모두 ' + x.goalPerMember + '문항</span><span class="mono">' + x.progress + ' / ' + x.goal + '</span></div>' +
        '<div class="progress"><i style="width:' + p + '%"></i></div>' +
        '<p class="sub">' + (x.members || []).map(function (m) {
          return esc(m.nickname) + (m.resting ? " (쉼)" : m.activeWeek ? " ✔" : "");
        }).join(" · ") + '</p></div>';
    }).join("") + '</div>' : '<p class="sub" id="team-empty">아직 팀이 없어요. 팀 짜기는 Supabase SQL 편집기에서 <span class="mono">select * from admin_assign_teams(\'기수\');</span> (README 6장)</p>';
    return '<div class="content">' + (fake ? '<div class="info" id="fake-note">[개발용] 가짜 학생 50명의 가짜 통계예요. 실제 학생 기록이 아니에요.</div>' : "") +
      head + '<!--ERR-->' + grid +
      '<div class="admin-section"><h2>① 반 전체 많이 틀린 문항 TOP 10</h2>' +
      '<p class="sub">연습은 학생마다 <b>처음 푼 기록</b>만, 오답률 = 처음 낸 답이 틀린 비율. 진단은 "아직 모르겠어요"도 오답으로 셈. 응답이 ' + (s.minN || 3) + '명보다 적은 문항은 빼요(한 학생 답이 드러나지 않게).</p>' + tbl + '</div>' +
      '<div class="admin-section"><h2>② 강별 첫 시도 정답률 (연습)</h2><div id="lectures">' + lecs + '</div></div>' +
      '<div class="admin-section"><div class="row-flex"><h2>③ 팀별 ' + weekLbl + ' 참여 목표</h2>' +
      '<select id="week" class="sel"><option value="0"' + (A.weekBack === 0 ? " selected" : "") + '>이번 주</option><option value="1"' + (A.weekBack === 1 ? " selected" : "") + '>지난주</option></select></div>' +
      '<p class="sub" id="team-summary">' + esc(String(t.weekStart || weekStart()).slice(0, 10)) + ' 주 · 달성 <b>' + (t.achievedCount || 0) + '</b> / ' + teams.length + '팀 · 팀 없는 학생 ' + (t.unassigned || 0) + '명 · 팀 활동 쉼 ' + (t.resting || 0) + '명. ✔ = 그 주에 1문항 이상 학습. ' +
      '참여 목표 = 활동 중인 팀원 모두 그 주 N문항(경험치 받은 풀이만). "학습목표 달성"(주간 공통 점검)과는 다른 목표예요.</p>' + teamHtml + '</div>' +
      tutorSection() + weeklySection() +
      '<p class="sub">학생은 별명으로만 보여요. 학생 코드·개인 경험치·숨은 실력 숫자는 이 화면에도 나오지 않아요.</p></div>';
  }

  /* ---------- [M2 3차] ④ AI 튜터 사용량 ---------- */
  function usd(x) { return "$" + (Number(x) || 0).toFixed(2); }
  function tutorSection() {
    var u = A.tutor || {};
    var inner;
    if (u._missing) inner = '<p class="sub" id="tutor-usage-missing">' + esc(/설치되지 않았어요/.test(u._why) ? "서버에 AI 튜터 사용량 기능이 아직 설치되지 않았어요(50_ai_tutor.sql 적용 전)." : u._why) + '</p>';
    else {
      var budget = Number(u.budgetUsd) || 0, cost = Number(u.monthCostUsd) || 0, p = budget ? Math.min(100, Math.round(cost / budget * 100)) : 0;
      inner = '<p id="tutor-switch">스위치: <b>' + (u.enabled ? "켜짐" : "꺼짐") + '</b>' + (u.enabled ? "" : ' <span class="sub">(켜는 법: README 7-4)</span>') + '</p>' +
        '<ul class="tutor-usage" id="tutor-usage">' +
        '<li><b>' + (Number(u.todayCalls) || 0) + '</b><span>오늘 호출 (답 성공 ' + (Number(u.todayOk) || 0) + ')</span></li>' +
        '<li><b>' + (Number(u.monthCalls) || 0) + '</b><span>이번 달 호출</span></li>' +
        '<li><b>' + (Number(u.monthStudents) || 0) + '</b><span>이번 달 쓴 학생</span></li>' +
        '<li><b>' + (Number(u.monthBlocked) || 0) + '</b><span>정답 노출로 버린 답</span></li></ul>' +
        '<div class="row-flex"><span>이번 달 추정 비용 <b class="mono" id="tutor-cost">' + usd(cost) + '</b> <span class="sub">(약 ₩' + (Number(u.monthCostKrw) || 0).toLocaleString("ko-KR") + ')</span> / 자동 꺼짐 ' + usd(budget) + '</span>' +
        '<div class="bar" style="flex:1"><i style="width:' + p + '%"></i></div><span class="mono">' + p + '%</span></div>' +
        '<p class="sub">숫자만 저장해요(학생 질문 글·AI 답 글은 저장하지 않음). 추정 비용이 ' + usd(budget) + '에 닿으면 이번 달은 모든 학생에게 저절로 꺼져요.</p>';
    }
    return '<div class="admin-section" id="tutor-section"><h2>④ AI 튜터 사용량</h2>' + inner + '</div>';
  }

  /* ---------- [M2 3차] ⑤ 주간 공통 점검 문항별 정답률 ---------- */
  function weeklySection() {
    var w = A.weekly || {}, inner = "", sel = "";
    if (w._missing) inner = '<p class="sub" id="weekly-missing">' + esc(/설치되지 않았어요/.test(w._why) ? "서버에 공통 점검 기능이 아직 설치되지 않았어요(60_m2_weekly_explainer.sql 적용 전)." : w._why) + '</p>';
    else if (!w.cohortStart) inner = '<p class="sub" id="weekly-off">공통 점검이 꺼져 있어요. 기수 시작 월요일을 넣으면 켜져요: <span class="mono">update app_settings set cohort_start = \'2027-03-01\' where id = 1;</span> (README 8장)</p>';
    else {
      var max = Number(w.maxWeek) || 0, cur = w.currentWeek, wk = w.week;
      sel = '<select id="wk-week" class="sel">' + Array.apply(null, Array(max)).map(function (_, i) {
        var n = i + 1; return '<option value="' + n + '"' + (n === wk ? " selected" : "") + '>' + n + '주차' + (n === cur ? " (이번 주)" : "") + '</option>';
      }).join("") + '</select>';
      var items = w.items || [];
      var tbl = items.length ? '<table class="tbl" id="weekly-items"><thead><tr><th>#</th><th>강</th><th>문항</th><th>정답률</th><th>응시</th><th class="hide-sm">모르겠어요</th><th class="hide-sm">정답</th></tr></thead><tbody>' +
        items.map(function (x, i) {
          var has = x.correctRate !== null && x.correctRate !== undefined;
          return '<tr data-qid="' + esc(x.qid) + '"><td class="num">' + (i + 1) + '</td><td>' + esc(lec(x.lecture)) + '</td>' +
            '<td class="qtxt">' + esc(x.question) + '<div class="sub mono">' + esc(x.qid) + '</div></td>' +
            '<td class="num">' + (has ? '<b class="rate">' + pct(x.correctRate) + '</b><div class="bar"><i style="width:' + pct(x.correctRate) + '"></i></div>' : '<span class="sub">3명 미만</span>') + '</td>' +
            '<td class="num">' + (Number(x.n) || 0) + '</td><td class="num hide-sm">' + (has ? (Number(x.unknown) || 0) : "—") + '</td><td class="hide-sm">' + esc(x.answerText || "—") + '</td></tr>';
        }).join("") + '</tbody></table>' : '<p class="sub" id="weekly-items-empty">' + (wk ? wk + "주차 문항이 없어요." : "기수 시작 전이에요.") + '</p>';
      var teams = (w.teams || []).length ? '<p class="sub" id="weekly-teams">팀별 응시: ' + w.teams.map(function (t) { return esc(t.name) + ' ' + t.taken + '/' + t.active + '명'; }).join(" · ") + '</p>' : "";
      inner = '<p class="sub" id="weekly-summary">' + (wk ? wk + '주차' : '') + ' · 응시 <b>' + (Number(w.takers) || 0) + '</b>명 · 기수 시작 ' + esc(String(w.cohortStart).slice(0, 10)) +
        '. 응시가 ' + (w.minN || 3) + '명보다 적은 문항은 정답률을 비워요(한 학생 답이 드러나지 않게). 학생 개인 점수는 학생에게도 보이지 않아요.</p>' + tbl + teams;
    }
    return '<div class="admin-section" id="weekly-section"><div class="row-flex"><h2>⑤ 주간 공통 점검 문항별 정답률</h2>' + sel + '</div>' + inner + '</div>';
  }

  /* ---------- 버튼 ---------- */
  root.addEventListener("input", function (e) {
    if (e.target.id === "email") A.email = e.target.value;
    if (e.target.id === "otp") A.code = e.target.value;
  });
  root.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "email") {
      var pw = document.getElementById("password");
      if (pw) pw.focus(); else act("send");
    }
    if (e.key === "Enter" && e.target.id === "password") act("password");
    if (e.key === "Enter" && e.target.id === "otp") act("verify");
  });
  root.addEventListener("change", function (e) {
    if (A.busy) return;
    if (e.target.id === "cohort") { A.cohort = e.target.value; guard(loadDash); }
    if (e.target.id === "week") { A.weekBack = Number(e.target.value) || 0; guard(loadDash); }
    if (e.target.id === "wk-week") { A.wkWeek = Number(e.target.value) || null; guard(loadDash); }
  });
  root.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b || b.disabled || A.busy) return;
    act(b.dataset.act);
  });
  function act(a) {
    if (A.busy) return;
    switch (a) {
      case "send":
        var email = String(A.email || "").trim();
        if (!validEmail(email)) { A.err = "이메일 주소 모양이 아니에요. 다시 확인해 주세요."; return render(); }
        A.email = email; A.err = "";
        return guard(function () {
          return ADM.sendLink(email).then(function (r) {
            if (r && r.instant) return afterLogin();
            A.sent = true; go("login");
          });
        });
      case "password":
        var pemail = String(A.email || "").trim();
        var pel = document.getElementById("password");
        var pw = pel ? pel.value : "";
        if (!validEmail(pemail)) { A.err = "이메일 주소 모양이 아니에요. 다시 확인해 주세요."; return render(); }
        if (!pw) { A.err = "비밀번호를 넣어 주세요."; return render(); }
        A.email = pemail; A.err = "";
        return guard(function () {
          var p = ADM.passwordLogin(pemail, pw); pw = ""; if (pel) pel.value = "";
          return p.then(function () { return afterLogin(); });
        });
      case "verify":
        var code = String(A.code || "").replace(/\s/g, "");
        if (!/^\d{6,10}$/.test(code)) { A.err = "메일에 있는 숫자 6자리를 넣어 주세요."; return render(); }
        A.err = "";
        return guard(function () { return ADM.verifyCode(A.email, code).then(function () { A.sent = false; A.code = ""; return afterLogin(); }); });
      case "reset": A.sent = false; A.code = ""; A.err = ""; return render();
      case "refresh": return guard(loadDash);
      case "retry": A.err = ""; return guard(afterLogin);
      case "logout":
        return guard(function () {
          return ADM.logout().then(function () { A.who = null; A.stats = null; A.teams = null; A.tutor = null; A.weekly = null; A.wkWeek = null; A.cohort = null; A.sent = false; A.err = ""; go("login"); });
        });
    }
  }

  /* ---------- 밝게/어둡게 (학생 화면과 같은 설정) ---------- */
  var themeBtn = document.getElementById("theme-btn");
  function isDark() {
    var m = document.documentElement.dataset.mode;
    return m ? m === "dark" : (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function syncTheme() { themeBtn.textContent = isDark() ? "밝게 보기" : "어둡게 보기"; }
  try { var saved = localStorage.getItem("lu2_theme"); if (saved) document.documentElement.dataset.mode = saved; } catch (e) { /* 무시 */ }
  themeBtn.addEventListener("click", function () {
    var m = isDark() ? "light" : "dark";
    document.documentElement.dataset.mode = m;
    try { localStorage.setItem("lu2_theme", m); } catch (e) { /* 무시 */ }
    syncTheme();
  });
  syncTheme();

  render();
  boot();
})();
