/* =========================================================
   레벨업 캠퍼스 2단계 M1 — 화면(app.js)

   화면 순서: 코드 입력 → 별명(처음 1번) → 진단 12문항 → 진단 결과 → 홈(오늘의 학습)
              → 문제(힌트 사다리) → 해설·경험치 → … → 오늘 결과
   데이터는 전부 window.STORE(store.js)로만 주고받습니다.
   규칙 계산은 window.LU(logic.js)에 있습니다.
   ========================================================= */
(function () {
  "use strict";
  var STORE = window.STORE, LU = window.LU, O = LU.OUTCOME;
  var app = document.getElementById("app");
  var CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];

  var S = {
    screen: "loading", student: null, err: "", draft: "",
    diag: null, diagResult: null, today: null,
    team: null, teamErr: "", teamConfirm: false,   // [M2] 홈 팀 카드
    weekly: null, wk: null, wkResult: null,        // [M2 3차] 공통 점검 상태 · 푸는 중 {week, items, idx, answers:{qid: 보기|null}, selected, fake} · 제출 결과
    expl: null, explQ: null, explDraft: null, explMsg: "",   // [M2 3차] 해설 당번 (explDraft: null = 쓰는 중 아님)
    busy: false,  // 서버(저장소)에 묻는 중이면 true → 그동안 버튼 잠금 (QA 1·2번: 연타로 문제 건너뜀 방지)
    run: null,    // {reviews:[qid], newLeft, extra, xpStart, recent:[{qid,lecture,R}], seen:[qid], log:[{qid,mode,outcome,xp}]}
    item: null    // {qid, q, mode, order, st, selected, hints, thought, concept, result, triedWrong:[orig], msg, tutor}
                  // tutor = [M2 2차] AI 튜터 {loading, hidden, status, draft, msg, replies:[{q, kind, reply}]} — 질문 글은 이 문제 화면 안(메모리)에만
  };

  /* ---------- 도우미 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function range(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }
  function lecName(n) { return (n < 10 ? "0" : "") + n + "강"; }
  function fail(e) { S.err = (e && e.message) || String(e); render(); }
  function go(screen) { S.screen = screen; S.err = ""; render(); window.scrollTo(0, 0); }
  function needDiag(s) { return !!s && !s.diagDone && s.diagAnswered < LU.C.DIAG_MIN; }   // 설계 D4: 10문항 미만이면 연습 전 진단 먼저

  /* ---------- 연타 막기 (QA 1·2번) ----------
     버튼을 누르면 응답이 올 때까지 화면의 모든 버튼을 잠그고, 그 사이 누른 것은 무시합니다. */
  var renders = 0;
  function lockButtons() {
    app.setAttribute("aria-busy", "true");
    Array.prototype.forEach.call(app.querySelectorAll("button"), function (x) { x.disabled = true; });
  }
  function guard(fn) {
    if (S.busy) return;
    S.busy = true; var r0 = renders; lockButtons();
    var p; try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
    return p.catch(fail).then(function () {
      S.busy = false; app.removeAttribute("aria-busy");
      if (renders === r0) render();   // 화면이 그대로면 잠근 버튼을 다시 풀어 줌
    });
  }

  /* ---------- 시작 ---------- */
  function boot() {
    if (STORE.devLabel) { var d = document.getElementById("devbar"); d.textContent = STORE.devLabel; d.hidden = false; }
    return STORE.session().then(function (s) { S.student = s; return route(); }).catch(fail);
  }
  function route() {
    var s = S.student;
    if (!s) return go("login");
    if (!s.nickname) return go("nickname");
    if (needDiag(s)) return startDiag();
    return goHome();
  }
  function refreshStudent() { return STORE.session().then(function (s) { S.student = s; }); }

  /* ---------- 진단 ---------- */
  function startDiag() {
    return STORE.diagnostic().then(function (d) {
      var done = {}; d.answered.forEach(function (id) { done[id] = true; });
      var idx = 0; while (idx < d.questions.length && done[d.questions[idx].id]) idx++;
      S.diag = { questions: d.questions, idx: idx, selected: null };
      if (idx >= d.questions.length) return finishDiag();
      go("diag");
    }).catch(fail);
  }
  function finishDiag() {
    return STORE.finishDiagnostic().then(function (r) {
      S.diagResult = r; return refreshStudent();
    }).then(function () { go("diagResult"); }).catch(fail);
  }

  /* ---------- 홈 ---------- */
  function goHome() {
    S.explMsg = ""; S.explDraft = null;
    return Promise.all([refreshStudent(), STORE.today(), loadTeam(), loadWeekly(), loadExplainer()]).then(function (r) { S.today = r[1]; go("home"); }).catch(fail);
  }
  /* [M2 3차] 공통 점검 상태 · 해설 당번도 실패하면 카드만 숨김 (서버에 60번 SQL 적용 전이어도 홈은 열림) */
  function loadWeekly() {
    if (!STORE.weeklyStatus) { S.weekly = null; return Promise.resolve(); }
    return STORE.weeklyStatus().then(function (w) { S.weekly = w; }, function (e) {
      S.weekly = null;
      if (window.console) console.warn("[레벨업] 공통 점검 정보를 불러오지 못했어요:", (e && e.message) || e);
    });
  }
  function loadExplainer() {
    if (!STORE.teamExplainer) { S.expl = null; return Promise.resolve(); }
    return STORE.teamExplainer().then(function (e) {
      S.expl = e; S.explQ = null;
      // 당번에게는 정답 글도 보여 주려고 연습 문항(정답 포함 — 원래 공개되는 연습 문항)을 찾아 둠
      if (e && e.inTeam && e.iAmDuty && e.item) return STORE.question(e.item.qid).then(function (q) { S.explQ = q; }, function () {});
    }, function (e) {
      S.expl = null;
      if (window.console) console.warn("[레벨업] 해설 당번 정보를 불러오지 못했어요:", (e && e.message) || e);
    });
  }
  /* [M2] 팀 요약은 실패해도 홈은 열림 (서버에 팀 함수가 아직 없거나 인터넷이 잠깐 끊겨도 오늘의 학습은 가능) */
  function loadTeam() {
    if (!STORE.myTeam) { S.team = null; return Promise.resolve(); }
    return STORE.myTeam().then(function (t) { S.team = t; S.teamErr = ""; }, function (e) {
      S.team = null; S.teamErr = (e && e.message) || "팀 정보를 불러오지 못했어요";
      if (window.console) console.warn("[레벨업] 팀 정보를 불러오지 못했어요:", S.teamErr);
    });
  }

  /* ---------- 오늘의 학습 ---------- */
  function startRun(extra) {
    if (needDiag(S.student)) return startDiag();   // 진단 10문항 전에는 연습 못 함 (D4)
    var t = S.today;
    S.run = { reviews: extra ? [] : t.reviews.slice(), newLeft: extra ? LU.C.NEW_PER_DAY : Math.max(0, t.newTarget - t.newDone),
              extra: !!extra, xpStart: Number(t.xpToday) || 0, recent: [], seen: [], log: [] };
    return nextItem();
  }
  function nextItem() {
    var run = S.run;
    if (run.reviews.length) return openItem(run.reviews.shift(), "REVIEW", false);
    if (run.newLeft <= 0) return endRun(false);
    return STORE.nextPractice(run.recent, run.seen).then(function (p) {
      if (!p) return endRun(true);
      run.newLeft--;
      return openItem(p.qid, "PRACTICE", p.conceptCard);
    }).catch(fail);
  }
  function openItem(qid, mode, concept) {
    return Promise.all([STORE.question(qid), STORE.hints(qid)]).then(function (r) {
      var q = r[0];
      S.run.seen.push(qid);
      S.item = {
        qid: qid, q: q, mode: mode, hints: r[1], thought: "", concept: concept, result: null, triedWrong: [], msg: "",
        order: q.type === "mcq" ? shuffle(range(q.choices.length)) : range(q.choices.length),
        st: LU.newItemState(mode, LU.maxSubmitsFor(q)), selected: null
      };
      go("item");
    }).catch(fail);
  }
  function endRun(noMore) {
    S.run.noMore = noMore;
    return Promise.all([refreshStudent(), STORE.today()]).then(function (r) { S.today = r[1]; go("done"); }).catch(fail);
  }
  function closeIfNeeded() {
    var it = S.item;
    if (!it.st.closed || it.result) { render(); return Promise.resolve(); }
    return STORE.closeItem({ qid: it.qid, mode: it.mode, outcome: it.st.outcome, level: it.st.level, submits: it.submitted || [] })
      .then(function (res) {
        // 서버(또는 로컬 저장소)가 돌려준 XP를 그대로 씀. 이 문제 전까지 오늘 받은 XP도 기억(상한/다시 풀기 안내 구분용)
        it.xpBefore = (S.run.xpStart || 0) + S.run.log.reduce(function (a, l) { return a + l.xp; }, 0);
        it.result = res;
        S.run.recent.push({ qid: it.qid, lecture: it.q.lecture, R: LU.R_OF[it.st.outcome] });
        S.run.log.push({ qid: it.qid, mode: it.mode, outcome: it.st.outcome, xp: res.xp, reviewNote: res.reviewNote });
        render(); window.scrollTo(0, 0);
      }).catch(fail);
  }

  /* ---------- 화면 그리기 ---------- */
  function render() {
    stopTick(); renders++;
    var who = document.getElementById("who");
    who.textContent = S.student && S.student.nickname ? S.student.nickname + " 님" : "";
    var h = ({ loading: vLoading, login: vLogin, nickname: vNickname, diag: vDiag, diagResult: vDiagResult,
               home: vHome, item: vItem, done: vDone, weekly: vWeekly, weeklyDone: vWeeklyDone })[S.screen]();
    var err = S.err ? '<div class="note" role="alert" id="err"><div class="note-title">문제가 생겼어요</div>' + esc(S.err) + '</div>' : "";
    app.innerHTML = '<section class="screen" data-screen="' + S.screen + '">' + h.replace("<!--ERR-->", err) + '</section>';
    if (S.screen === "item") { startTick(); maybeLoadTutor(); }
  }
  function vLoading() {
    // 시작하다 막히면(인터넷 끊김 등) 오류 문장 + 다시 시도 버튼
    return '<div class="content"><p class="sub">불러오는 중…</p><!--ERR-->' +
      (S.err ? '<button class="btn btn-secondary" data-act="retry">다시 시도</button>' : "") + '</div>';
  }

  function vLogin() {
    var local = STORE.mode === "local";
    return '<div class="content">' +
      '<div class="brand"><div class="logo">LU</div><div><h1>레벨업 캠퍼스</h1><div class="brand-sub">내 수준에 맞춘 오늘의 학습</div></div></div>' +
      '<div class="field' + (S.err ? " err" : "") + '"><label for="code">참가자 코드 (6자리)</label>' +
      '<input id="code" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="교수님께 받은 코드" value="' + esc(S.draft) + '">' +
      '<p class="help">영문 대문자와 숫자 6자리예요. 헷갈리는 0·O·1·I는 쓰지 않아요.</p>' +
      (S.err ? '<p class="error" id="code-error">' + esc(S.err) + '</p>' : "") + '</div>' +
      (local ? '<div class="info">[개발용] 로컬 모드 가짜 코드: <span class="mono">' + esc((window.LU_CONFIG.DEV_CODES || []).join(" · ")) + '</span></div>' : "") +
      '</div><div class="bottombar"><button class="btn btn-primary" data-act="login">들어가기</button></div>';
  }
  function vNickname() {
    return '<div class="content"><h2>별명을 정해 주세요</h2>' +
      '<p class="sub">처음 한 번만 정해요. 팀원에게 이 별명으로 보여요.</p>' +
      '<div class="note"><div class="note-title">실명은 쓰지 마세요</div>이름·학번·전화번호 대신 별명만 써 주세요.</div>' +
      '<div class="field' + (S.nickHint ? " err" : "") + '"><label for="nick">별명 (2~12글자)</label><input id="nick" class="text" maxlength="12" autocomplete="off" value="' + esc(S.draft) + '">' +
      (S.nickHint ? '<p class="error" id="nick-error">' + esc(S.nickHint) + '</p>' : "") + '</div>' +
      '<!--ERR--></div><div class="bottombar"><button class="btn btn-primary" data-act="save-nick">이 별명으로 시작</button></div>';
  }

  function choiceBtns(q, order, opts) {
    var ox = q.type === "ox";
    return '<div class="choices' + (ox ? " ox" : "") + '" role="list">' + order.map(function (orig, pos) {
      var cls = "choice", mark = "";
      if (opts.reveal) {
        if (orig === opts.answer) { cls += " is-correct"; mark = '<span class="mark ok">정답</span>'; }
        else if (opts.picked && opts.picked.indexOf(orig) >= 0) { cls += " is-wrong"; mark = '<span class="mark no">고른 답</span>'; }
        else cls += " dim";
      } else if (opts.tried && opts.tried.indexOf(orig) >= 0) cls += " tried-wrong";
      else if (opts.selected === orig) cls += " selected";
      var dis = opts.reveal || (opts.tried && opts.tried.indexOf(orig) >= 0);
      var num = ox ? esc(q.choices[orig]) : CIRCLED[pos];
      var txt = ox ? (q.choices[orig] === "O" ? "맞아요" : "아니에요") : q.choices[orig];
      return '<button class="' + cls + '" data-act="pick" data-orig="' + orig + '" data-pos="' + pos + '"' +
        (dis ? ' aria-disabled="true"' : "") + '><span class="num">' + num + '</span><span class="txt">' + esc(txt) + '</span>' + mark + '</button>';
    }).join("") + '</div>';
  }

  function vDiag() {
    var d = S.diag, q = d.questions[d.idx];
    return '<div class="content">' +
      '<div class="qhead"><div class="qhead-row"><span class="count" id="count">진단 ' + (d.idx + 1) + ' / ' + d.questions.length + '</span><span class="tag">' + esc(lecName(q.lecture)) + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round(d.idx / d.questions.length * 100) + '%"></i></div></div>' +
      (d.idx === 0 ? '<div class="info">출발점을 찾는 12문항이에요. 맞았는지는 끝난 뒤에 한꺼번에 보여 드려요. 모르면 찍지 말고 "아직 모르겠어요"를 눌러 주세요.</div>' : "") +
      '<div class="card qcard"><p class="qtext" id="qid" data-id="' + esc(q.id) + '">' + esc(q.question) + '</p></div>' +
      choiceBtns(q, range(q.choices.length), { selected: d.selected }) +
      '<button class="btn btn-secondary" data-act="diag-unknown">아직 모르겠어요</button>' +
      '<!--ERR--><button class="linkbtn" data-act="diag-later">나중에 이어서 하기</button></div>' +
      '<div class="bottombar"><button class="btn btn-primary" data-act="diag-next"' + (d.selected === null ? " disabled" : "") + '>' +
      (d.idx + 1 === d.questions.length ? "진단 끝내기" : "다음") + '</button></div>';
  }
  function vDiagResult() {
    var r = S.diagResult;
    var lec = function (arr) { return arr.length ? arr.map(function (n) { return '<span class="tag">' + lecName(n) + '</span>'; }).join("") : '<span class="sub">아직 없어요</span>'; };
    return '<div class="content"><h2>진단을 마쳤어요</h2>' +
      '<p class="sub">점수나 등급은 없어요. 오늘부터 내 수준에 맞는 문제가 나와요.</p>' +
      '<div class="card"><h3>강한 강의</h3><div class="lect" id="strong">' + lec(r.strong) + '</div></div>' +
      '<div class="card"><h3>먼저 볼 강의</h3><div class="lect" id="weak">' + lec(r.weak) + '</div></div>' +
      '<div class="card"><h3>오늘 첫 연습 추천</h3><p>홈의 "오늘의 학습"에서 내 수준에 맞춘 새 문제 5개로 시작해요.</p></div>' +
      (r.devKey ? '<p class="storage-note">[개발용] 로컬 모드라 정답을 개발용 파일에서 읽었어요. Supabase 모드에서는 서버가 채점해요.</p>' : "") +
      '<h3>12문항 해설</h3><div class="rv" id="diag-review">' + r.review.map(function (x, i) {
        var ok = x.yourChoice === x.answer_index;
        return '<details class="card"><summary><b>' + (i + 1) + '. </b>' + esc(x.q.question) + '</summary>' +
          '<p class="sub">내 답: ' + (x.yourChoice === null ? "아직 모르겠어요" : esc(x.q.choices[x.yourChoice])) + (ok ? " (맞음)" : "") + '</p>' +
          '<p><b>정답: ' + esc(x.q.choices[x.answer_index]) + '</b></p><p>' + esc(x.explanation) + '</p></details>';
      }).join("") + '</div></div>' +
      '<div class="bottombar"><button class="btn btn-primary" data-act="home">오늘의 학습으로</button></div>';
  }

  function vHome() {
    var t = S.today, s = S.student, st = t.streak;
    var diagPending = !s.diagDone, diagFirst = needDiag(s), diagLeft = Math.max(0, LU.C.DIAG_COUNT - s.diagAnswered);
    var total = t.reviews.length + t.newTarget, doneN = Math.min(t.newDone, t.newTarget);
    var allDone = t.reviews.length === 0 && t.newDone >= t.newTarget;
    var streakTxt = st.current > 0
      ? '연속 학습 <b id="streak">' + st.current + '</b>일째 <span class="sub">(학습 ' + st.studied + '일 · 휴식 보호 ' + st.protectedDays + '일)</span>'
      : '오늘 3문항을 끝까지 풀면 연속 학습이 시작돼요' + '<span id="streak" hidden>0</span>';
    return '<div class="content"><h2>오늘 이것만 하면 돼요</h2>' +
      (diagFirst ? '<div class="note" id="diag-first"><div class="note-title">진단을 먼저 끝내요</div>' +
        '진단을 ' + LU.C.DIAG_MIN + '문항 이상 마치면 오늘의 학습이 열려요. 지금 ' + s.diagAnswered + ' / ' + LU.C.DIAG_COUNT + '문항 했어요.</div>'
      : diagPending && diagLeft === 0 ? '<div class="note"><div class="note-title">진단 채점만 남았어요</div>' +
        '<div class="btn-col"><button class="btn btn-secondary" data-act="diag-finish">진단 결과 보기</button></div></div>'
      : diagPending ? '<div class="note"><div class="note-title">진단이 ' + diagLeft + '문항 남았어요</div>' +
        '<div class="btn-col"><button class="btn btn-secondary" data-act="diag-resume">진단 마저 하기</button>' +
        '<button class="btn btn-secondary" data-act="diag-finish">여기까지로 진단 끝내기</button></div></div>' : "") +
      '<div class="card plan"><div class="plan-row"><span>복습</span><span id="plan-review">' + t.reviews.length + '문제</span></div>' +
      '<div class="plan-row"><span>새 문제</span><span id="plan-new">' + doneN + ' / ' + t.newTarget + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round((doneN) / total * 100) + '%"></i></div></div>' +
      '<p>' + streakTxt + (st.longest > st.current ? ' <span class="sub">· 최장 기록 ' + st.longest + '일</span>' : "") + '</p>' +
      '<ul class="stats"><li><b id="xp-week">' + t.weekXp + '</b><span>이번 주 학습량 XP</span></li>' +
      '<li><b id="solved-week">' + t.weekSolved + '</b><span>이번 주 푼 문항</span></li>' +
      '<li><b id="xp-total">' + s.xp + '</b><span>모은 XP</span></li></ul>' +
      weeklyCard() + teamCard() + explainerCard() +
      '<p class="sub">경험치는 문제를 끝까지 풀면 10 XP, 복습에서 혼자 맞히면 +5 XP예요. 힌트를 써도 줄지 않아요. 이미 푼 문제는 복습 날에 다시 풀 때만 경험치가 있어요.</p>' +
      '<!--ERR--><button class="linkbtn" data-act="logout">다른 코드로 들어가기</button></div>' +
      '<div class="bottombar">' + (diagFirst
        ? '<button class="btn btn-primary" data-act="diag-resume">진단 이어 하기</button>'
        : allDone
        ? '<p class="hint" id="all-done">오늘 할 일 완료! 더 풀고 싶으면 아래를 눌러요.</p><button class="btn btn-secondary" data-act="start-extra">더 풀기 (선택)</button>'
        : '<button class="btn btn-primary" data-act="start">오늘의 학습 시작</button>') + '</div>';
  }

  /* ---------- [M2] 홈 팀 카드 ----------
     보이는 것: 팀 이름, 팀원 별명(가나다순)·팀 활동 쉼, 이번 주 팀 합계/목표, 참여 목표 달성 여부, 내 이번 주 문항 수,
               같은 기수에서 달성한 팀 이름. 팀원 개인 XP·실력·정오답·문항 수는 서버도 보내지 않음(팀게임 설계 2-5) */
  function teamCard() {
    var t = S.team;
    if (!t) return "";
    var offBtn = S.teamConfirm
      ? '<div class="note" id="team-confirm"><div class="note-title">팀 활동을 쉴까요?</div>개인 학습과 경험치는 그대로예요. 팀원에게는 "팀 활동 쉼"으로만 보이고, 팀 목표 계산에서 빠져요. 언제든 다시 켤 수 있어요.' +
        '<div class="btn-col"><button class="btn btn-secondary" data-act="team-off-yes">네, 쉴게요</button><button class="btn btn-secondary" data-act="team-off-no">아니요</button></div></div>'
      : "";
    if (!t.inTeam) {
      return '<div class="card team-card" id="team-card" data-state="none"><h3>팀</h3>' +
        (t.teamOff
          ? '<p id="team-status">팀 활동을 하지 않기로 해 두었어요. 혼자 학습은 그대로 할 수 있어요.</p><button class="linkbtn" data-act="team-on">팀 활동 다시 하기</button>'
          : '<p id="team-status">팀은 2주차부터 교수님이 같은 기수 3~4명으로 정해 드려요. 그 전까지는 혼자 연습해요.</p>' +
            (S.teamConfirm ? offBtn : '<button class="linkbtn" data-act="team-off">팀 활동 안 하기</button>')) + '</div>';
    }
    var pct = t.goal ? Math.min(100, Math.round(t.progress / t.goal * 100)) : 0;
    var names = t.members.map(function (m) {
      return '<span class="team-mate' + (m.resting ? " resting" : "") + '">' + esc(m.nickname) + (m.me ? " (나)" : "") + (m.resting ? " · 팀 활동 쉼" : "") + '</span>';
    }).join('<span class="sep"> · </span>');
    var status = t.teamOff
      ? '<p id="team-status">팀 활동을 쉬고 있어요. 개인 학습과 경험치는 그대로예요.</p>'
      : t.achieved
      ? '<p id="team-status" class="team-ok"><b>이번 주 팀 참여 목표 달성</b> — 활동 중인 팀원 모두 ' + t.goalPerMember + '문항을 끝까지 풀었어요.</p>'
      : '<p id="team-status"><b>도전 중</b> · 내 이번 주 <b id="team-mine">' + t.myCount + '</b> / ' + t.goalPerMember + '문항</p>';
    var wk = S.weekly && S.weekly.open && S.weekly.team ? S.weekly.team : null;   // [M2 3차] 누가 응시했는지는 안 보임, 숫자만
    var wkLine = wk ? '<p class="sub" id="team-weekly">이번 주 공통 점검: 팀원 <b>' + wk.taken + '/' + wk.active + '</b>명 응시</p>' : "";
    var others = t.achievedTeams.length
      ? '<p class="sub" id="team-achieved">이번 주 참여 목표 달성 팀: ' + t.achievedTeams.map(esc).join(" · ") + '</p>' : "";
    return '<div class="card team-card" id="team-card" data-state="' + (t.teamOff ? "off" : t.achieved ? "achieved" : "trying") + '">' +
      '<div class="plan-row"><h3 id="team-name">' + esc(t.name) + '</h3>' + (t.fake ? '<span class="tag">가짜 팀원(개발용)</span>' : "") + '</div>' +
      '<p class="team-mates" id="team-mates">' + names + '</p>' +
      '<div class="plan-row"><span>이번 주 팀 참여 목표 <span class="sub">(팀원 모두 ' + t.goalPerMember + '문항)</span></span><span id="team-progress">' + t.progress + ' / ' + t.goal + '</span></div>' +
      '<div class="progress"><i style="width:' + pct + '%"></i></div>' + status + wkLine + others +
      '<p class="sub">팀 합계만 보여요. 팀원 개인 기록은 서로 보이지 않아요. 경험치를 받은 풀이만 세요(같은 문제 다시 풀기 제외).</p>' +
      (t.teamOff ? '<button class="linkbtn" data-act="team-on">팀 활동 다시 하기</button>'
        : S.teamConfirm ? offBtn : '<button class="linkbtn" data-act="team-off">팀 활동 쉬기</button>') + '</div>';
  }

  /* ---------- [M2 3차] 홈 공통 점검 카드 ----------
     결재2 ⑤: 점수는 본인에게도 숨김 → "응시 완료"와 다시 볼 개념(강 번호)만. 꺼져 있으면(OFF) 카드 없음 */
  var WEEKLY_CLOSED_TEXT = {
    NOT_STARTED: "공통 점검은 기수가 시작되면 매주 열려요.",
    ENDED: "이번 기수 공통 점검이 모두 끝났어요. 수고했어요.",
    NO_ITEMS: "이번 주 공통 점검 문항이 아직 준비되지 않았어요."
  };
  function reviewLine(arr) {
    return arr && arr.length
      ? '<p id="weekly-review">다시 볼 개념: ' + arr.map(function (n) { return '<span class="tag">' + esc(lecName(n)) + '</span>'; }).join(" ") + '</p>' +
        '<p class="sub">이 강의를 한 번 더 보고, 오늘의 학습에서 연습해요.</p>'
      : '<p id="weekly-review">이번 점검에서 따로 표시된 개념은 없어요. 지금처럼 복습을 이어 가요.</p>';
  }
  function weeklyCard() {
    var w = S.weekly;
    if (!w || w.reason === "OFF") return "";
    var head = '<div class="plan-row"><h3 id="weekly-title">' + (w.week ? w.week + "주차 " : "") + '공통 점검</h3>' +
      (w.fake ? '<span class="tag">연습 문항으로 흉내(개발용)</span>' : "") + '</div>';
    var body = !w.open
      ? '<p id="weekly-status">' + esc(WEEKLY_CLOSED_TEXT[w.reason] || "이번 주 공통 점검이 아직 열리지 않았어요.") +
        (w.reason === "NOT_STARTED" && w.cohortStart ? ' <span class="sub">(시작 ' + esc(w.cohortStart) + ')</span>' : "") + '</p>'
      : w.done
      ? '<p id="weekly-status" class="team-ok"><b>응시 완료</b></p>' + reviewLine(w.reviewLectures)
      : '<p id="weekly-status">이번 주 ' + w.nItems + '문항 · 혼자 풀어요(힌트·AI 튜터 없음) · 한 주에 한 번만</p>' +
        '<p class="sub">점수는 나에게도 보여 주지 않아요. 끝나면 다시 볼 개념만 알려 드려요.</p>' +
        '<button class="btn btn-secondary" data-act="weekly-start">공통 점검 시작</button>';
    return '<div class="card weekly-card" id="weekly-card" data-state="' + (!w.open ? "closed" : w.done ? "done" : "open") + '">' + head + body + '</div>';
  }

  /* ---------- [M2 3차] 홈 해설 당번 카드 (같은 팀 안에서만) ---------- */
  var EXPL_TEXT = { TOO_SHORT: "해설은 10글자 이상 써 주세요.", TOO_LONG: "해설은 200글자 안으로 줄여 주세요.",
                    PRIVATE_INFO: "이메일·전화번호는 쓰지 마세요. 팀원에게 그대로 보여요." };
  function explainerCard() {
    var e = S.expl, t = S.team;
    if (!e || !e.inTeam || !t || !t.inTeam) return "";
    var wrap = function (inner, state) {
      return '<div class="card expl-card" id="expl-card" data-state="' + state + '"><div class="plan-row"><h3>이번 주 해설 당번</h3>' +
        (e.fake ? '<span class="tag">가짜(개발용)</span>' : "") + '</div>' + inner +
        (S.explMsg ? '<p class="tried" id="expl-msg" role="alert">' + esc(S.explMsg) + '</p>' : "") + '</div>';
    };
    if (!e.hasDuty) return wrap('<p id="expl-status">팀 활동 중인 팀원이 없어 이번 주 당번이 없어요.</p>', "none");
    var it = e.item, q = S.explQ;
    var item = it ? '<div class="expl-item"><span class="tag">' + esc(lecName(it.lecture)) + '</span> <span class="qtext" id="expl-q" data-id="' + esc(it.qid) + '">' + esc(it.question) + '</span>' +
      (e.iAmDuty && q ? '<p class="sub" id="expl-answer">정답: ' + esc(q.choices[q.answer_index]) + '</p>' : "") + '</div>' : "";
    var bodyView = e.body ? '<div class="expl-text" id="expl-text">' + esc(e.body) + '</div>' : "";
    if (!e.iAmDuty) {
      return wrap('<p id="expl-status">이번 주 해설 당번: <b>' + esc(e.dutyNickname) + '</b> 님</p>' +
        (it ? '<p class="sub">팀에서 가장 많이 헷갈린 문항 1개</p>' + item : '<p class="sub">팀이 연습 문제를 풀면 해설할 문항이 정해져요.</p>') +
        (bodyView || (it ? '<p class="sub" id="expl-none">아직 해설이 올라오지 않았어요.</p>' : "")), e.body ? "read" : "waiting");
    }
    var status = '<p id="expl-status"><b>이번 주 해설 당번은 나예요.</b> ' +
      (it ? "팀에서 가장 많이 헷갈린 문항 1개를 짧게 풀어 주세요." : "팀이 연습 문제를 풀면 가장 많이 헷갈린 문항이 정해져요.") + '</p>';
    if (!it) return wrap(status, "duty-wait");
    var max = e.maxChars || LU.WEEKLY.EXPLAIN_MAX, editing = S.explDraft !== null;
    var editor = editing
      ? '<div class="field"><label for="expl-body">해설 (' + max + '자 안 · 팀원에게만 보여요)</label>' +
        '<textarea id="expl-body" rows="4" maxlength="' + max + '" placeholder="정답의 이유 / 헷갈린 보기가 틀린 이유 / 내 업무라면?">' + esc(S.explDraft) + '</textarea>' +
        '<p class="tutor-count" id="expl-count">' + S.explDraft.length + ' / ' + max + '</p></div>' +
        '<div class="btn-col"><button class="btn btn-secondary" data-act="expl-save">' + (e.body ? "고친 해설 올리기" : "해설 올리기") + '</button>' +
        '<button class="linkbtn" data-act="expl-cancel">취소</button></div>'
      : (bodyView ? '<p class="sub">올린 해설</p>' + bodyView : "") +
        '<button class="btn btn-secondary" data-act="expl-edit">' + (e.body ? "해설 고치기" : "해설 쓰기") + '</button>';
    return wrap(status + item + editor +
      '<p class="sub">세 가지를 짧게: 정답의 이유 · 헷갈린 보기가 틀린 이유 · 내 업무라면? 이름·연락처는 쓰지 마세요. 쓰지 않아도 괜찮아요 — 벌점은 없어요.</p>',
      editing ? "duty-edit" : e.body ? "duty-done" : "duty");
  }

  /* ---------- [M2 3차] 공통 점검 화면 (진단과 같은 모양 · 힌트·AI 튜터 없음 · 정오답은 끝까지 안 보여 줌) ---------- */
  function vWeekly() {
    var k = S.wk, q = k.items[k.idx], last = k.idx + 1 === k.items.length;
    return '<div class="content">' +
      '<div class="qhead"><div class="qhead-row"><span class="count" id="count">공통 점검 ' + (k.idx + 1) + ' / ' + k.items.length + '</span><span class="tag">' + esc(lecName(q.lecture)) + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round(k.idx / k.items.length * 100) + '%"></i></div></div>' +
      (k.idx === 0 ? '<div class="info" id="weekly-intro">' + (k.week ? k.week + "주차 " : "") + '공통 점검이에요. 혼자 풀어요 — 힌트·AI 튜터는 없어요. 맞았는지는 보여 주지 않고, 끝나면 다시 볼 개념만 알려 드려요. 모르면 찍지 말고 "아직 모르겠어요"를 눌러 주세요.</div>' : "") +
      (k.fake ? '<p class="storage-note">[개발용] 로컬 모드는 연습 문항 8개로 흉내 내요. Supabase 모드에서는 서버의 공통 점검 문항이 나와요.</p>' : "") +
      '<div class="card qcard"><p class="qtext" id="qid" data-id="' + esc(q.id) + '">' + esc(q.question) + '</p></div>' +
      choiceBtns(q, range(q.choices.length), { selected: k.selected }) +
      '<button class="btn btn-secondary" data-act="weekly-unknown">아직 모르겠어요' + (last ? " (그리고 제출)" : "") + '</button>' +
      (last ? '<div class="note" id="weekly-last"><div class="note-title">마지막 문항이에요</div>제출하면 이번 주에는 다시 풀 수 없어요.</div>' : "") +
      '<!--ERR-->' + (k.idx > 0 ? '<button class="linkbtn" data-act="weekly-prev">이전 문항</button>' : "") +
      '<button class="linkbtn" data-act="weekly-later">나중에 하기 (고른 답은 저장되지 않아요)</button></div>' +
      '<div class="bottombar"><button class="btn btn-primary" data-act="weekly-next"' + (k.selected === null ? " disabled" : "") + '>' + (last ? "제출하기" : "다음") + '</button></div>';
  }
  function vWeeklyDone() {
    var r = S.wkResult || {};
    return '<div class="content"><h2 id="weekly-done">' + (r.week ? r.week + "주차 " : "") + '공통 점검 응시 완료</h2>' +
      '<p class="sub">점수는 보여 주지 않아요 — 나에게도, 팀원에게도요. 팀 카드에는 팀원 몇 명이 응시했는지만 보여요.</p>' +
      '<div class="card">' + reviewLine(r.reviewLectures) + '</div></div>' +
      '<div class="bottombar"><button class="btn btn-primary" data-act="home">홈으로</button></div>';
  }
  function weeklyAdvance(choice) {
    var k = S.wk, q = k.items[k.idx];
    k.answers[q.id] = choice;
    if (k.idx + 1 >= k.items.length) {
      return STORE.submitWeekly(k.answers).then(function (r) {
        S.wkResult = r; S.wk = null; return loadWeekly();
      }).then(function () { go("weeklyDone"); });
    }
    k.idx++;
    var nq = k.items[k.idx];
    k.selected = Object.prototype.hasOwnProperty.call(k.answers, nq.id) ? k.answers[nq.id] : null;
    go("weekly");
  }

  function hintPanel() {
    var it = S.item, st = it.st;
    if (it.mode !== "PRACTICE" && it.mode !== "REVIEW") return "";   // 진단·평가에는 힌트 없음
    var shown = "";
    for (var L = 1; it.hints && L <= Math.min(st.level, 3); L++) {
      shown += '<div class="hint-step" data-level="' + L + '"><span class="h-lv">힌트 ' + L + '단계</span>' + esc(it.hints["L" + L]) + '</div>';
    }
    var noHints = !it.hints ? '<p class="sub" id="no-hints">이 문제는 미리 만든 힌트를 준비 중이에요. 답을 한 번 낸 뒤에는 정답과 해설을 볼 수 있어요.</p>' : "";
    var ladder = '<div class="ladder" aria-label="힌트 ' + st.level + ' / 4단계">' + [1, 2, 3, 4].map(function (k) { return '<i class="' + (k <= st.level ? "on" : "") + '"></i>'; }).join("") + '</div>';
    if (st.closed) return st.level || tutorHistory() ? '<div class="hints">' + (st.level ? ladder + shown : "") + tutorHistory() + '</div>' : "";
    var needThought = st.level + 1 >= 3 && st.level + 1 <= 4 && !!it.hints;
    return '<div class="hints" id="hints"><div class="h-label">' + (it.hints ? "막히면 힌트를 한 단계씩 열어요" : "정답과 해설") + (it.hints && it.hints.fake ? ' <span class="tag">시험용 힌트</span>' : "") + (it.hints && it.hints.draft ? ' <span class="tag" id="draft-tag">검토 전 힌트(개발용)</span>' : "") + '</div>' +
      ladder + shown + noHints +
      (needThought ? '<div class="field"><label for="thought">내 생각 한 줄 (꼭 써야 다음 힌트가 열려요)</label><textarea id="thought" rows="2" maxlength="200">' + esc(it.thought) + '</textarea></div>' : "") +
      '<button class="btn btn-secondary" id="hint-btn" data-act="hint"></button>' + tutorPanel() + '</div>';
  }

  /* ---------- [M2 2차] AI 튜터 ----------
     보이는 때: LU.tutorEligible (힌트 3단계를 본 뒤 / 미리 만든 힌트가 없으면 답을 한 번 낸 뒤, 연습·복습만)
     남은 횟수는 처음 보일 때 한 번 STORE.tutorStatus()로 받고, 질문할 때마다 서버가 준 값으로 바꿈 */
  function tutorHistory() {
    var t = S.item.tutor; if (!t || !t.replies.length) return "";
    return t.replies.map(function (x, i) {
      var l2 = x.kind === "blocked" && S.item.hints ? '<div class="hint-step" data-level="2"><span class="h-lv">힌트 2단계 다시 보기</span>' + esc(S.item.hints.L2) + '</div>' : "";
      return '<div class="tutor-q" data-n="' + i + '"><b>내 질문</b> ' + esc(x.q) + '</div>' +
        '<div class="tutor-a" data-kind="' + esc(x.kind) + '"><span class="h-lv">AI 튜터' + (S.item.tutor.status && S.item.tutor.status.fake ? " (가짜 응답 · 개발용)" : "") + '</span>' + esc(x.reply) +
        (x.kind === "refused" ? '<br><span class="sub">(이번 질문은 횟수에서 빼지 않았어요)</span>' : "") + '</div>' + l2;
    }).join("") + '<p class="sub">AI 답은 틀릴 수 있어요. 미리 만든 해설과 함께 확인해요.</p>';
  }
  function tutorPanel() {
    var it = S.item, t = it.tutor;
    if (!STORE.tutorStatus || !LU.tutorEligible(it.st, !!it.hints)) {
      // 캡틴 결정(2026-11-03 ①): 아직 열리기 전이면 "언제 열리는지" 한 줄 안내 (4지선다·연습/복습·아직 안 끝난 문항만)
      var st = it.st, pre = st && (st.mode === "PRACTICE" || st.mode === "REVIEW") && !st.closed && st.level < 4 &&
        it.q && it.q.type !== "ox" && !(it.tutor && it.tutor.hidden);
      return tutorHistory() + (pre ? '<p class="sub tutor-pre" id="tutor-pre">💬 ' +
        (it.hints ? "힌트 3단계까지 보고도 막히면 AI 튜터에게 물어볼 수 있어요." : "틀린 답을 한 번 고르면 AI 튜터에게 물어볼 수 있어요.") + '</p>' : "");
    }
    if (!t || t.loading) return '<div class="tutor" id="tutor" data-state="loading"><p class="sub">AI 튜터를 확인하는 중…</p></div>';
    if (t.hidden) return tutorHistory();   // 서버에 AI 튜터가 아직 없음(SQL 적용 전) → 조용히 숨김
    var s = t.status, n = (t.draft || "").length;
    var head = '<div class="tutor-head"><span>아직 막혔다면 AI 튜터에게 물어보기</span>' +
      (s.enabled ? '<span class="tutor-left" id="tutor-left">오늘 ' + s.left + '번 남음</span>' : '') + '</div>';
    if (!s.enabled) {
      return '<div class="tutor" id="tutor" data-state="off" data-reason="' + esc(s.reason) + '">' + head + tutorHistory() +
        '<p class="tutor-off" id="tutor-off">' + esc(LU.TUTOR.TEXT[s.reason] || LU.TUTOR.TEXT.OFF) + '</p>' +
        (t.msg && t.msg !== LU.TUTOR.TEXT[s.reason] ? '<p class="tutor-msg" id="tutor-msg" role="alert">' + esc(t.msg) + '</p>' : "") +
        '<button class="btn btn-secondary" id="tutor-btn" disabled>AI 튜터에게 물어보기</button></div>';
    }
    return '<div class="tutor" id="tutor" data-state="on">' + head + tutorHistory() +
      '<div class="field"><label for="tutor-q">무엇이 헷갈리나요? (' + LU.TUTOR.MAX_CHARS + '자 안, 이름·연락처는 쓰지 마세요)</label>' +
      '<textarea id="tutor-q" rows="2" maxlength="' + LU.TUTOR.MAX_CHARS + '" placeholder="예: 제가 고른 답이 왜 틀렸는지 모르겠어요">' + esc(t.draft) + '</textarea>' +
      '<p class="tutor-count" id="tutor-count">' + n + ' / ' + LU.TUTOR.MAX_CHARS + '</p></div>' +
      (t.msg ? '<p class="tutor-msg" id="tutor-msg" role="alert">' + esc(t.msg) + '</p>' : "") +
      // 빈 칸이면 버튼이 꺼진 이유를 버튼 바로 위에 보여 줌(고장처럼 보이지 않게). 누르면 질문 칸으로 이동(label)
      '<label for="tutor-q" class="tutor-empty" id="tutor-empty"' + (String(t.draft || "").trim() || t.asking ? " hidden" : "") + '>궁금한 점을 한 줄 쓰면 버튼이 켜져요</label>' +
      '<button class="btn btn-secondary" id="tutor-btn" data-act="ask-tutor"' + (String(t.draft || "").trim() && !t.asking ? "" : " disabled") + '>' +
      (t.asking ? "AI 튜터가 생각하는 중…" : "AI 튜터에게 물어보기") + '</button>' +
      '<p class="sub">AI는 정답을 바로 알려 주지 않고, 스스로 풀 수 있게 한 단계씩 도와요.</p></div>';
  }
  function maybeLoadTutor() {
    var it = S.item;
    if (!it || it.tutor || !STORE.tutorStatus || !LU.tutorEligible(it.st, !!it.hints)) return;
    it.tutor = { loading: true, replies: [], draft: "", msg: "" };
    STORE.tutorStatus().then(function (s) { it.tutor.loading = false; it.tutor.status = s; },
      function (e) {
        it.tutor.loading = false; it.tutor.hidden = true;
        if (window.console) console.warn("[레벨업] AI 튜터 상태를 불러오지 못해 버튼을 숨겼어요:", (e && e.message) || e);
      }).then(function () { if (S.item === it && S.screen === "item") render(); });
  }
  function hintBtnState() {
    var it = S.item, st = it.st, next = st.level + 1;
    var r = LU.canOpenHint(st, STORE.now(), it.thought, !!it.hints);
    var label = next === 4 || !it.hints ? "정답과 해설 보기" : "힌트 " + next + "단계 보기";
    if (r.ok) return { label: label, disabled: false };
    var why = { wait: Math.ceil((r.waitMs || 0) / 1000) + "초 뒤에 " + label, thought: "내 생각 한 줄을 쓰면 " + label,
                "submit-first": "정답 보기는 답을 한 번 낸 뒤에 열려요", "not-ready": "힌트 준비 중 · 정답 보기는 답을 낸 뒤에 열려요",
                max: label, closed: label, off: label }[r.reason];
    return { label: why, disabled: true };
  }
  function vItem() {
    var it = S.item, q = it.q, st = it.st, run = S.run;
    var n = run.log.length + (it.result ? 0 : 1);
    var head = '<div class="qhead"><div class="qhead-row"><span class="count" id="count">' +
      (it.mode === "REVIEW" ? "복습" : "새 문제") + ' · 오늘 ' + n + '번째</span><span class="tag">' + esc(lecName(q.lecture)) + '</span></div></div>';
    var concept = it.concept && !it.result ? '<div class="concept" id="concept"><b>이 개념을 한 번 정리하고 갈게요</b><br>' + esc(q.source_section) + ' 부분을 떠올리며 천천히 풀어 봐요.</div>' : "";
    var qcard = '<div class="card qcard"><p class="qtext" id="qid" data-id="' + esc(q.id) + '">' + esc(q.question) + '</p></div>';
    if (!st.closed || !it.result) {
      var left = st.maxSubmits - st.submits.length;
      return '<div class="content">' + head + concept + qcard +
        choiceBtns(q, it.order, { selected: it.selected, tried: it.triedWrong }) +
        (it.msg ? '<p class="tried" id="msg">' + esc(it.msg) + '</p>' : "") +
        hintPanel() + '<!--ERR--></div>' +
        '<div class="bottombar">' + (st.closed
          ? '<button class="btn btn-primary" data-act="retry-close">기록 다시 저장하기</button>'
          : '<button class="btn btn-primary" data-act="submit"' + (it.selected === null ? " disabled" : "") + '>답 내기' +
            (st.submits.length ? ' (남은 기회 ' + left + '번)' : "") + '</button>') + '</div>';
    }
    // 마감 → 해설 (L4)
    var res = it.result, oc = st.outcome;
    var good = oc !== O.SHOWN;
    var verdict = '<div class="verdict ' + (good ? "ok" : "calm") + '" id="verdict"><div class="v-body"><b id="outcome">' + esc(oc) + '</b><br>' +
      (good ? "잘했어요!" : "괜찮아요. 해설을 읽고 이해하면 그것도 공부예요.") + '</div></div>';
    var note = "";
    if (res.reviewNote === "again") note = it.mode === "REVIEW" ? "한 번 더 만나요. 내일 복습에 다시 나와요." : "이 문제는 복습 때 다시 만나요. 그때 혼자 맞히면 +5 XP를 더 받아요.";
    if (res.reviewNote === "box-up") note = "다시 도전 성공! 다음 복습은 조금 더 뒤에 만나요.";
    if (res.reviewNote === "review-done") note = "복습 완료! 이 문제는 이제 졸업이에요.";
    var last = run.reviews.length === 0 && run.newLeft <= 0;
    var fullXp = LU.C.XP_COMPLETE + (it.mode === "REVIEW" && oc === O.SOLO ? LU.C.XP_REVIEW_SOLO_BONUS : 0);
    var xpWhy = "";
    if (res.xp < fullXp) xpWhy = (it.xpBefore || 0) + fullXp > LU.C.XP_DAILY_CAP
      ? ' <span class="sub" id="xp-why">(오늘 경험치 상한에 닿았어요)</span>'
      : ' <span class="sub" id="xp-why">(전에 풀어 본 문제라 이번엔 경험치가 없어요. 복습 날에 다시 만나면 받아요)</span>';
    return '<div class="content">' + head + verdict +
      '<p><span class="xp-pop" id="xp-gain">+' + res.xp + ' XP</span>' + xpWhy + '</p>' +
      (note ? '<p class="sub" id="review-note">' + esc(note) + '</p>' : "") + qcard +
      choiceBtns(q, it.order, { reveal: true, answer: q.answer_index, picked: it.submitted || [] }) +
      hintPanel() +
      '<div class="card explain"><h3>해설</h3><p id="explain">' + esc(q.explanation) + '</p>' +
      (q.common_wrong_reason ? '<p class="sub">자주 하는 착각: ' + esc(q.common_wrong_reason) + '</p>' : "") +
      '<p class="source">' + esc(q.source_section) + '</p></div><!--ERR--></div>' +
      '<div class="bottombar"><button class="btn btn-primary" data-act="next">' + (last ? "오늘 결과 보기" : "다음 문제") + '</button></div>';
  }

  function vDone() {
    var run = S.run, t = S.today, st = t.streak;
    var xp = run.log.reduce(function (a, l) { return a + l.xp; }, 0);
    return '<div class="content"><h2>' + (run.extra ? "더 풀기 끝!" : "오늘 할 일 완료") + '</h2>' +
      (run.noMore ? '<div class="info" id="no-more">지금 열린 강의의 새 문제를 다 풀었어요. 복습 날짜가 되면 다시 나와요.</div>' : "") +
      '<p><span class="xp-pop" id="run-xp">이번에 +' + xp + ' XP</span></p>' +
      '<div class="rv" id="run-log">' + run.log.map(function (l) {
        return '<div class="rv-row ' + (l.outcome === O.SHOWN ? "no" : "ok") + '"><span class="rv-k">' + (l.mode === "REVIEW" ? "복습" : "새 문제") + '</span><span class="rv-v">' + esc(l.outcome) + ' · +' + l.xp + ' XP</span></div>';
      }).join("") + '</div>' +
      '<p>' + (st.current ? '연속 학습 ' + st.current + '일째' : '오늘 ' + LU.C.STUDY_DAY_MIN + '문항을 끝까지 풀면 학습한 날이 돼요') + '</p></div>' +
      '<div class="bottombar"><button class="btn btn-primary" data-act="home">홈으로</button></div>';
  }

  /* ---------- 힌트 버튼 시계 (1초마다 글자만 바꿈) ---------- */
  var tick = null;
  function updateHintBtn() {
    var b = document.getElementById("hint-btn"); if (!b || !S.item) return;
    var s = hintBtnState(); b.textContent = s.label; b.disabled = s.disabled || S.busy;
  }
  function startTick() { updateHintBtn(); tick = setInterval(updateHintBtn, 500); }
  function stopTick() { if (tick) clearInterval(tick); tick = null; }

  /* ---------- 버튼 동작 ---------- */
  app.addEventListener("input", function (e) {
    if (e.target.id === "thought" && S.item) { S.item.thought = e.target.value; updateHintBtn(); }
    if (e.target.id === "tutor-q" && S.item && S.item.tutor) {
      var tt = S.item.tutor; tt.draft = e.target.value;
      var cnt = document.getElementById("tutor-count"); if (cnt) cnt.textContent = tt.draft.length + " / " + LU.TUTOR.MAX_CHARS;
      var tb = document.getElementById("tutor-btn"); if (tb && tb.dataset.act) tb.disabled = !tt.draft.trim() || !!tt.asking || S.busy;
      var te = document.getElementById("tutor-empty"); if (te) te.hidden = !!tt.draft.trim() || !!tt.asking;
    }
    if (e.target.id === "code" || e.target.id === "nick") S.draft = e.target.value;
    if (e.target.id === "expl-body" && S.explDraft !== null) {
      S.explDraft = e.target.value;
      var ec = document.getElementById("expl-count"); if (ec) ec.textContent = S.explDraft.length + " / " + ((S.expl && S.expl.maxChars) || LU.WEEKLY.EXPLAIN_MAX);
    }
  });
  app.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "code") act("login");
    if (e.key === "Enter" && e.target.id === "nick") act("save-nick");
  });
  app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    if (S.busy) return;   // 저장 중에 누른 것은 무시 (연타 방지)
    act(b.dataset.act, b);
  });

  function act(a, b) {
    if (S.busy) return;
    var it = S.item;
    switch (a) {
      case "login":
        return guard(function () {
          return STORE.login(S.draft).then(function (r) {
            if (!r.ok) {
              S.err = r.error === "shape" ? "코드는 영문 대문자와 숫자 6자리예요 (0·O·1·I 없음)."
                : r.error === "too_many" ? "코드를 너무 여러 번 넣었어요. 10분쯤 뒤에 다시 해 주세요."
                : "등록되지 않은 코드예요. 교수님께 받은 카드를 다시 확인해 주세요.";
              return render();
            }
            S.student = r.student; S.draft = ""; return route();
          });
        });
      case "save-nick":
        var nick = (S.draft || "").trim();
        if (nick.length < 2) { S.nickHint = "별명은 2글자 이상이어야 해요."; return render(); }
        S.nickHint = "";
        return guard(function () { return STORE.setNickname(nick).then(function (s) { S.student = s; S.draft = ""; return route(); }); });
      case "logout": return guard(function () { return STORE.logout().then(function () { S.student = null; S.draft = ""; go("login"); }); });

      case "pick":
        if (S.screen === "diag") { S.diag.selected = Number(b.dataset.orig); render(); }
        else if (S.screen === "weekly") { S.wk.selected = Number(b.dataset.orig); render(); }
        else if (it && !it.st.closed) { it.selected = Number(b.dataset.orig); render(); }
        break;
      case "diag-unknown": return guard(function () { return diagAnswer(null); });
      case "diag-next": if (S.diag.selected === null) return; return guard(function () { return diagAnswer(S.diag.selected); });
      case "diag-later": return guard(goHome);
      case "diag-resume": return guard(startDiag);
      case "diag-finish": return guard(finishDiag);

      case "team-off": S.teamConfirm = true; return render();
      case "team-off-no": S.teamConfirm = false; return render();
      case "team-off-yes":
      case "team-on":
        return guard(function () {
          return STORE.setTeamOff(a === "team-off-yes").then(function (t) {
            S.team = t; S.teamConfirm = false;
            return Promise.all([loadWeekly(), loadExplainer()]);   // 쉼이면 당번·팀 응시 인원도 바뀜
          }).then(function () { render(); });
        });
      case "home": return guard(goHome);
      case "retry": S.err = ""; render(); return guard(boot);
      case "start": return guard(function () { return startRun(false); });
      case "start-extra": return guard(function () { return startRun(true); });

      case "hint":
        return guard(function () {
          var r = LU.openHint(it.st, STORE.now(), it.thought, !!it.hints);
          if (r.ok) { it.thought = ""; it.msg = ""; return closeIfNeeded(); }
          updateHintBtn();
        });
      case "submit":
        if (it.selected === null || it.st.closed) return;
        return guard(function () {
          var orig = it.selected, correct = orig === it.q.answer_index;
          it.submitted = (it.submitted || []).concat([orig]);
          LU.submit(it.st, correct);
          it.selected = null;
          if (!it.st.closed) { it.triedWrong.push(orig); it.msg = "아직 아니에요. 힌트를 보거나 한 번 더 골라 보세요."; }
          return closeIfNeeded();
        });
      case "retry-close": S.err = ""; return guard(closeIfNeeded);
      case "ask-tutor":
        var tu = it && it.tutor, qtext = tu ? String(tu.draft || "").trim() : "";
        if (!tu || !qtext || !LU.tutorEligible(it.st, !!it.hints)) return;
        tu.asking = true; tu.msg = ""; render();   // "AI 튜터가 생각하는 중…" 표시
        return guard(function () {
          return STORE.askTutor({ qid: it.qid, level: it.st.level, tried: it.triedWrong.slice(), question: qtext }).then(function (r) {
            tu.asking = false;
            if (r.state) tu.status = r.state;
            if (r.ok) { tu.replies.push({ q: qtext, kind: r.kind, reply: r.reply }); tu.draft = ""; }
            else tu.msg = r.message || "AI 튜터가 지금 답하지 못했어요. 잠시 뒤 다시 해 주세요.";
            render();
          }, function (e) { tu.asking = false; tu.msg = (e && e.message) || "AI 튜터가 지금 답하지 못했어요."; render(); });
        });
      case "next": return guard(nextItem);

      /* [M2 3차] 공통 점검 */
      case "weekly-start":
        return guard(function () {
          return STORE.weeklyItems().then(function (r) {
            if (!r.items.length) throw new Error("이번 주 공통 점검 문항이 아직 준비되지 않았어요.");
            S.wk = { week: r.week, items: r.items, idx: 0, answers: {}, selected: null, fake: !!r.fake }; go("weekly");
          }, function (e) { return loadWeekly().then(function () { throw e; }); });   // 다른 기기에서 이미 응시 등 → 카드도 새로
        });
      case "weekly-next": if (!S.wk || S.wk.selected === null) return; return guard(function () { return weeklyAdvance(S.wk.selected); });
      case "weekly-unknown": if (!S.wk) return; return guard(function () { return weeklyAdvance(null); });
      case "weekly-prev":
        if (!S.wk || S.wk.idx === 0) return;
        S.wk.idx--; S.wk.selected = S.wk.answers[S.wk.items[S.wk.idx].id];
        if (S.wk.selected === undefined) S.wk.selected = null;
        return go("weekly");
      case "weekly-later": S.wk = null; return guard(goHome);

      /* [M2 3차] 해설 당번 */
      case "expl-edit": S.explDraft = (S.expl && S.expl.body) || ""; S.explMsg = ""; return render();
      case "expl-cancel": S.explDraft = null; S.explMsg = ""; return render();
      case "expl-save":
        var ex = S.expl, bad = LU.checkExplain(S.explDraft);
        if (!ex || !ex.item) return;
        if (bad) { S.explMsg = EXPL_TEXT[bad]; return render(); }
        return guard(function () {
          return STORE.writeExplainer(ex.item.qid, LU.cleanExplain(S.explDraft)).then(function (e2) {
            S.expl = e2; S.explDraft = null; S.explMsg = "해설을 올렸어요. 팀원에게 보여요."; render();
          }, function (er) {
            S.explMsg = (er && er.message) || "해설을 올리지 못했어요.";
            if (/문항이 바뀌었어요/.test(S.explMsg)) return loadExplainer().then(function () { render(); });   // 쓴 글(explDraft)은 그대로
            render();
          });
        });
    }
  }
  function diagAnswer(choice) {
    var d = S.diag, q = d.questions[d.idx];
    return STORE.answerDiagnostic(q.id, choice).then(function () {
      d.idx++; d.selected = null;
      if (d.idx >= d.questions.length) return finishDiag();
      render(); window.scrollTo(0, 0);
    }).catch(fail);
  }

  /* ---------- 밝게/어둡게 ---------- */
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

  // 자동 테스트용 (로컬 모드에서만): 화면 상태 보기, 특정 문항 바로 열기
  if (STORE.mode === "local") window.__LU_APP = { S: S, openItem: function (qid, mode) {
    if (!S.run) S.run = { reviews: [], newLeft: 0, extra: true, recent: [], seen: [], log: [] };
    openItem(qid, mode || "PRACTICE", false);
  } };
  boot();
})();
