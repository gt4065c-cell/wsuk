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
    run: null,    // {reviews:[qid], newLeft, extra, recent:[{qid,lecture,R}], seen:[qid], log:[{qid,mode,outcome,xp}]}
    item: null    // {qid, q, mode, order, st, selected, hints, thought, concept, result, triedWrong:[orig], msg}
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

  /* ---------- 시작 ---------- */
  function boot() {
    if (STORE.devLabel) { var d = document.getElementById("devbar"); d.textContent = STORE.devLabel; d.hidden = false; }
    STORE.session().then(function (s) { S.student = s; route(); }).catch(fail);
  }
  function route() {
    var s = S.student;
    if (!s) return go("login");
    if (!s.nickname) return go("nickname");
    if (!s.diagDone && s.diagAnswered < LU.C.DIAG_MIN) return startDiag();
    return goHome();
  }
  function refreshStudent() { return STORE.session().then(function (s) { S.student = s; }); }

  /* ---------- 진단 ---------- */
  function startDiag() {
    STORE.diagnostic().then(function (d) {
      var done = {}; d.answered.forEach(function (id) { done[id] = true; });
      var idx = 0; while (idx < d.questions.length && done[d.questions[idx].id]) idx++;
      S.diag = { questions: d.questions, idx: idx, selected: null };
      if (idx >= d.questions.length) return finishDiag();
      go("diag");
    }).catch(fail);
  }
  function finishDiag() {
    STORE.finishDiagnostic().then(function (r) {
      S.diagResult = r; return refreshStudent();
    }).then(function () { go("diagResult"); }).catch(fail);
  }

  /* ---------- 홈 ---------- */
  function goHome() {
    Promise.all([refreshStudent(), STORE.today()]).then(function (r) { S.today = r[1]; go("home"); }).catch(fail);
  }

  /* ---------- 오늘의 학습 ---------- */
  function startRun(extra) {
    var t = S.today;
    S.run = { reviews: extra ? [] : t.reviews.slice(), newLeft: extra ? LU.C.NEW_PER_DAY : Math.max(0, t.newTarget - t.newDone),
              extra: !!extra, recent: [], seen: [], log: [] };
    nextItem();
  }
  function nextItem() {
    var run = S.run;
    if (run.reviews.length) return openItem(run.reviews.shift(), "REVIEW", false);
    if (run.newLeft <= 0) return endRun(false);
    STORE.nextPractice(run.recent, run.seen).then(function (p) {
      if (!p) return endRun(true);
      run.newLeft--;
      openItem(p.qid, "PRACTICE", p.conceptCard);
    }).catch(fail);
  }
  function openItem(qid, mode, concept) {
    Promise.all([STORE.question(qid), STORE.hints(qid)]).then(function (r) {
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
    Promise.all([refreshStudent(), STORE.today()]).then(function (r) { S.today = r[1]; go("done"); }).catch(fail);
  }
  function closeIfNeeded() {
    var it = S.item;
    if (!it.st.closed || it.result) return render();
    STORE.closeItem({ qid: it.qid, mode: it.mode, outcome: it.st.outcome, level: it.st.level, submits: it.submitted || [] })
      .then(function (res) {
        it.result = res;
        S.run.recent.push({ qid: it.qid, lecture: it.q.lecture, R: LU.R_OF[it.st.outcome] });
        S.run.log.push({ qid: it.qid, mode: it.mode, outcome: it.st.outcome, xp: res.xp, reviewNote: res.reviewNote });
        render(); window.scrollTo(0, 0);
      }).catch(fail);
  }

  /* ---------- 화면 그리기 ---------- */
  function render() {
    stopTick();
    var who = document.getElementById("who");
    who.textContent = S.student && S.student.nickname ? S.student.nickname + " 님" : "";
    var h = ({ loading: vLoading, login: vLogin, nickname: vNickname, diag: vDiag, diagResult: vDiagResult,
               home: vHome, item: vItem, done: vDone })[S.screen]();
    var err = S.err ? '<div class="note" role="alert" id="err"><div class="note-title">문제가 생겼어요</div>' + esc(S.err) + '</div>' : "";
    app.innerHTML = '<section class="screen" data-screen="' + S.screen + '">' + h.replace("<!--ERR-->", err) + '</section>';
    if (S.screen === "item") startTick();
  }
  function vLoading() { return '<div class="content"><p class="sub">불러오는 중…</p></div>'; }

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
      '<div class="field"><label for="nick">별명 (2~12글자)</label><input id="nick" class="text" maxlength="12" autocomplete="off" value="' + esc(S.draft) + '"></div>' +
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
    var diagPending = !s.diagDone;
    var total = t.reviews.length + t.newTarget, doneN = Math.min(t.newDone, t.newTarget);
    var allDone = t.reviews.length === 0 && t.newDone >= t.newTarget;
    var streakTxt = st.current > 0
      ? '연속 학습 <b id="streak">' + st.current + '</b>일째 <span class="sub">(학습 ' + st.studied + '일 · 휴식 보호 ' + st.protectedDays + '일)</span>'
      : '오늘 3문항을 끝까지 풀면 연속 학습이 시작돼요' + '<span id="streak" hidden>0</span>';
    return '<div class="content"><h2>오늘 이것만 하면 돼요</h2>' +
      (diagPending ? '<div class="note"><div class="note-title">진단이 ' + (LU.C.DIAG_COUNT - s.diagAnswered) + '문항 남았어요</div>' +
        '<div class="btn-col"><button class="btn btn-secondary" data-act="diag-resume">진단 마저 하기</button>' +
        '<button class="btn btn-secondary" data-act="diag-finish">여기까지로 진단 끝내기</button></div></div>' : "") +
      '<div class="card plan"><div class="plan-row"><span>복습</span><span id="plan-review">' + t.reviews.length + '문제</span></div>' +
      '<div class="plan-row"><span>새 문제</span><span id="plan-new">' + doneN + ' / ' + t.newTarget + '</span></div>' +
      '<div class="progress"><i style="width:' + Math.round((doneN) / total * 100) + '%"></i></div></div>' +
      '<p>' + streakTxt + (st.longest > st.current ? ' <span class="sub">· 최장 기록 ' + st.longest + '일</span>' : "") + '</p>' +
      '<ul class="stats"><li><b id="xp-week">' + t.weekXp + '</b><span>이번 주 학습량 XP</span></li>' +
      '<li><b id="solved-week">' + t.weekSolved + '</b><span>이번 주 푼 문항</span></li>' +
      '<li><b id="xp-total">' + s.xp + '</b><span>모은 XP</span></li></ul>' +
      '<p class="sub">경험치는 문제를 끝까지 풀면 10 XP, 복습에서 혼자 맞히면 +5 XP예요. 힌트를 써도 줄지 않아요.</p>' +
      '<!--ERR--><button class="linkbtn" data-act="logout">다른 코드로 들어가기</button></div>' +
      '<div class="bottombar">' + (allDone
        ? '<p class="hint" id="all-done">오늘 할 일 완료! 더 풀고 싶으면 아래를 눌러요.</p><button class="btn btn-secondary" data-act="start-extra">더 풀기 (선택)</button>'
        : '<button class="btn btn-primary" data-act="start">오늘의 학습 시작</button>') + '</div>';
  }

  function hintPanel() {
    var it = S.item, st = it.st;
    if (it.mode !== "PRACTICE" && it.mode !== "REVIEW") return "";   // 진단·평가에는 힌트 없음
    var shown = "";
    for (var L = 1; L <= Math.min(st.level, 3); L++) {
      shown += '<div class="hint-step" data-level="' + L + '"><span class="h-lv">힌트 ' + L + '단계</span>' + esc(it.hints["L" + L]) + '</div>';
    }
    var ladder = '<div class="ladder" aria-label="힌트 ' + st.level + ' / 4단계">' + [1, 2, 3, 4].map(function (k) { return '<i class="' + (k <= st.level ? "on" : "") + '"></i>'; }).join("") + '</div>';
    if (st.closed) return st.level ? '<div class="hints">' + ladder + shown + '</div>' : "";
    var needThought = st.level + 1 >= 3 && st.level + 1 <= 4 && !!it.hints;
    return '<div class="hints" id="hints"><div class="h-label">막히면 힌트를 한 단계씩 열어요' + (it.hints && it.hints.fake ? ' <span class="tag">시험용 힌트</span>' : "") + (it.hints && it.hints.draft ? ' <span class="tag" id="draft-tag">검토 전 힌트(개발용)</span>' : "") + '</div>' +
      ladder + shown +
      (needThought ? '<div class="field"><label for="thought">내 생각 한 줄 (꼭 써야 다음 힌트가 열려요)</label><textarea id="thought" rows="2" maxlength="200">' + esc(it.thought) + '</textarea></div>' : "") +
      '<button class="btn btn-secondary" id="hint-btn" data-act="hint"></button></div>';
  }
  function hintBtnState() {
    var it = S.item, st = it.st, next = st.level + 1;
    var r = LU.canOpenHint(st, STORE.now(), it.thought, !!it.hints);
    var label = next === 4 ? "정답과 해설 보기" : "힌트 " + next + "단계 보기";
    if (r.ok) return { label: label, disabled: false };
    var why = { wait: Math.ceil((r.waitMs || 0) / 1000) + "초 뒤에 " + label, thought: "내 생각 한 줄을 쓰면 " + label,
                "submit-first": "정답 보기는 답을 한 번 낸 뒤에 열려요", "not-ready": "이 문제 힌트는 준비 중이에요",
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
        '<div class="bottombar"><button class="btn btn-primary" data-act="submit"' + (it.selected === null || st.closed ? " disabled" : "") + '>답 내기' +
        (st.submits.length ? ' (남은 기회 ' + left + '번)' : "") + '</button></div>';
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
    return '<div class="content">' + head + verdict +
      '<p><span class="xp-pop" id="xp-gain">+' + res.xp + ' XP</span>' + (res.xp < LU.C.XP_COMPLETE ? ' <span class="sub">(오늘 경험치 상한에 닿았어요)</span>' : "") + '</p>' +
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
    var s = hintBtnState(); b.textContent = s.label; b.disabled = s.disabled;
  }
  function startTick() { updateHintBtn(); tick = setInterval(updateHintBtn, 500); }
  function stopTick() { if (tick) clearInterval(tick); tick = null; }

  /* ---------- 버튼 동작 ---------- */
  app.addEventListener("input", function (e) {
    if (e.target.id === "thought" && S.item) { S.item.thought = e.target.value; updateHintBtn(); }
    if (e.target.id === "code" || e.target.id === "nick") S.draft = e.target.value;
  });
  app.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.id === "code") act("login");
    if (e.key === "Enter" && e.target.id === "nick") act("save-nick");
  });
  app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    act(b.dataset.act, b);
  });

  function act(a, b) {
    var it = S.item;
    switch (a) {
      case "login":
        STORE.login(S.draft).then(function (r) {
          if (!r.ok) {
            S.err = r.error === "shape" ? "코드는 영문 대문자와 숫자 6자리예요 (0·O·1·I 없음)." : "등록되지 않은 코드예요. 교수님께 받은 카드를 다시 확인해 주세요.";
            return render();
          }
          S.student = r.student; S.draft = ""; route();
        }).catch(fail); break;
      case "save-nick":
        var nick = (S.draft || "").trim();
        if (nick.length < 2) { S.err = "별명은 2글자 이상이어야 해요."; return render(); }
        STORE.setNickname(nick).then(function (s) { S.student = s; S.draft = ""; route(); }).catch(fail); break;
      case "logout": STORE.logout().then(function () { S.student = null; go("login"); }); break;

      case "pick":
        if (S.screen === "diag") { S.diag.selected = Number(b.dataset.orig); render(); }
        else if (it && !it.st.closed) { it.selected = Number(b.dataset.orig); render(); }
        break;
      case "diag-unknown": diagAnswer(null); break;
      case "diag-next": diagAnswer(S.diag.selected); break;
      case "diag-later": goHome(); break;
      case "diag-resume": startDiag(); break;
      case "diag-finish": finishDiag(); break;

      case "home": goHome(); break;
      case "start": startRun(false); break;
      case "start-extra": startRun(true); break;

      case "hint":
        var r = LU.openHint(it.st, STORE.now(), it.thought, !!it.hints);
        if (r.ok) { it.thought = ""; it.msg = ""; closeIfNeeded(); }
        else updateHintBtn();
        break;
      case "submit":
        if (it.selected === null) return;
        var orig = it.selected, correct = orig === it.q.answer_index;
        it.submitted = (it.submitted || []).concat([orig]);
        LU.submit(it.st, correct);
        it.selected = null;
        if (!it.st.closed) { it.triedWrong.push(orig); it.msg = "아직 아니에요. 힌트를 보거나 한 번 더 골라 보세요."; }
        closeIfNeeded(); break;
      case "next": nextItem(); break;
    }
  }
  function diagAnswer(choice) {
    var d = S.diag, q = d.questions[d.idx];
    STORE.answerDiagnostic(q.id, choice).then(function () {
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
