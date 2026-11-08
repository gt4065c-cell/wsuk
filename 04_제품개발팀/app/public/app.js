/* =========================================================
   레벨업 캠퍼스 · AI Agent 실무역량 연습 앱 v0.3.2 — 동작(자바스크립트)

   읽는 순서 (위에서 아래로):
     1. 문항 데이터 준비       — data/practice.js 를 읽어 정리
     2. 브라우저 저장소 도우미   — 이어 풀기·코드 기억 (막혀 있어도 앱은 동작)
     3. 상태(S)               — 지금 어느 화면인지, 무엇을 골랐는지
     4. 도우미 함수            — 섞기, 글자 안전하게 바꾸기 등
     5. 판 시작 / 이어 풀기
     6. 화면 그리기            — 첫 화면, 이어 풀기, 세트 고르기, 문제·해설, 결과, 다시 보기
     7. 버튼 동작
     8. 밝게/어둡게
     9. 시작

   서버로 보내는 것은 하나도 없습니다(점수·코드·답 모두 이 휴대폰 안에만).
   ========================================================= */

/* ---------- 1. 문항 데이터 준비 ---------- */
var DATA = window.PRACTICE_DATA;
var QUESTIONS = {};   // 문항 번호 → 문항   예) QUESTIONS["L11-Q1"]
var SETS = [];        // 연습 세트 3개
if (DATA) {
  DATA.questions.forEach(function (q) { QUESTIONS[q.id] = q; });
  SETS = DATA.sets.map(function (s) {
    var part = /(\d+)\s*부/.exec(s.title);        // "연습 세트 3부 (11~15강)" → 3
    var range = /\(([^)]*)\)/.exec(s.title);      // → "11~15강"
    return {
      id: s.set_id,
      part: part ? part[1] : "",
      title: part ? part[1] + "부 연습" : s.title,
      range: range ? range[1] : "",
      ids: s.question_ids.slice(),
      total: s.question_ids.length
    };
  });
}
var TEAM_MAX = 40;    // 지정 링크에 넣을 수 있는 최대 문항 수 (연습 31문항 전부 가능)
var PICK_COUNT = 8;   // [8문항(무작위)]에서 뽑는 문항 수

/* ---------- 2. 브라우저 저장소 도우미 ---------- */
/* localStorage(브라우저 안의 작은 메모장)는 시크릿 창 등에서 막혀 있을 수 있어요.
   그래서 모든 사용을 try/catch(실패해도 멈추지 않게 감싸기)로 감쌉니다. */
var KEY_CODE = "levelup_practice_code";    // 마지막에 넣은 참가자 코드
var KEY_RUN = "levelup_practice_run";      // 풀던 판 메모
var KEY_THEME = "levelup_practice_theme";  // 밝게/어둡게 고른 것

var store = {
  ok: false,
  check: function () {
    try {
      localStorage.setItem("levelup_test", "1");
      localStorage.removeItem("levelup_test");
      store.ok = true;
    } catch (e) { store.ok = false; }
    return store.ok;
  },
  get: function (k) {
    if (!store.ok) return null;
    try { return localStorage.getItem(k); } catch (e) { return null; }
  },
  set: function (k, v) {
    if (!store.ok) return false;
    try { localStorage.setItem(k, v); return true; }
    catch (e) { store.ok = false; S.storageOff = true; return false; }
  },
  remove: function (k) {
    if (!store.ok) return;
    try { localStorage.removeItem(k); } catch (e) { /* 무시 */ }
  }
};

/* ---------- 3. 상태 ---------- */
var S = {
  screen: "start",     // start | resume | sets | quiz | result | review | error
  code: "",            // 확정된 참가자 코드
  draft: "",           // 입력칸에 적고 있는 글자
  codeError: "",
  setId: SETS.length ? SETS[0].id : "",
  amount: "8",         // "8" = 8문항(무작위), "all" = 세트 전체
  team: false,         // 교수님 지정 링크(?ids=)로 들어왔나
  teamIds: [],         // 링크에 적힌 문항 중 앱에 있는 것 (적힌 순서 그대로)
  teamKey: "",         // 링크를 구별하는 글자 (이어 풀기 확인용)
  missing: 0,          // 링크에 적혔지만 제외한 번호 수 (없는 번호·겹친 번호·너무 많은 번호)
  missingDetail: "",   // 제외한 이유 한 줄
  conflict: false,     // 풀던 연습이 지금 연 주소(일반/지정 링크)와 다른가
  depth: 0,            // 뒤로 가기용: 지금 화면이 몇 단계째인가
  items: [],           // 이번 판 문항들 [{id, q, order}]  order = 화면 위치 → 원래 보기 번호
  idx: 0,              // 지금 몇 번째 문항(0부터)
  answers: [],         // 확정한 답 [{pickedOrig, pickedPos, correct}]
  selected: null,      // 확정 전 고른 화면 위치
  lockUntil: 0,        // 연타 방지: 이 시각 전에는 [다음 문제]를 무시
  storageOff: false,   // 저장소가 막혀 이어 풀기가 꺼졌나
  pendingRun: null     // 이어 풀 수 있는 판 메모
};
var CIRCLED = ["①", "②", "③", "④", "⑤", "⑥"];
var app = document.getElementById("app");

/* ---------- 4. 도우미 함수 ---------- */
/* 글자를 화면에 '글자 그대로' 보이게 바꾸기 (<b> 같은 것이 명령으로 실행되지 않게) */
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
/* 순서 섞기 (피셔-예이츠 방법) — 원본은 그대로 두고 새 목록을 돌려줌 */
function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function range(n) { var r = []; for (var i = 0; i < n; i++) r.push(i); return r; }
function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }
function setById(id) {
  for (var i = 0; i < SETS.length; i++) if (SETS[i].id === id) return SETS[i];
  return null;
}
function ic(name, size) {
  size = size || 20;
  var p = {
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
    cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>',
    info: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.3v.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    alert: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v6.2M12 16.6v.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  }[name];
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true">' + p + '</svg>';
}
/* 문항 목록 → 이번 판 문항. 객관식은 보기 순서를 섞고, OX와 지정 링크는 섞지 않음 */
function buildItems(ids, shuffleChoices) {
  return ids.map(function (id) {
    var q = QUESTIONS[id];
    var n = q.choices.length;
    var order = (shuffleChoices && q.type === "mcq") ? shuffle(range(n)) : range(n);
    return { id: id, q: q, order: order };
  });
}
/* 채점은 '보기 번호'가 아니라 '원래 보기'로 합니다 */
function correctPos(it) { return it.order.indexOf(it.q.answer_index); }
function choiceLabel(it, pos) { return it.q.type === "ox" ? it.q.choices[it.order[pos]] : CIRCLED[pos]; }
function choiceText(it, pos) { return it.q.choices[it.order[pos]]; }
function oxWord(v) { return v === "O" ? "맞아요" : "아니에요"; }
function score() { var c = 0; S.answers.forEach(function (a) { if (a && a.correct) c++; }); return c; }
function amountLabel() { return S.amount === "8" ? PICK_COUNT + "문항 · 무작위" : "세트 전체"; }
function runTitle() {
  if (S.team) return "팀 연습";
  var set = setById(S.setId);
  return set ? set.title : "연습";
}

/* ---------- 5. 판 시작 / 이어 풀기 ---------- */
function startSet(setId, amount) {
  var set = setById(setId);
  if (!set) return;
  S.team = false; S.setId = setId; S.amount = amount;
  var ids = shuffle(set.ids);                                    // 문제 순서 섞기
  if (amount === "8") ids = ids.slice(0, Math.min(PICK_COUNT, ids.length)); // 겹치지 않게 8개
  beginRun(buildItems(ids, true));                               // 보기 순서 섞기(OX 제외)
}
function startTeam() {
  S.team = true;
  beginRun(buildItems(S.teamIds, false));                        // 적힌 순서 그대로, 섞지 않음
}
function beginRun(items) {
  S.items = items; S.idx = 0; S.answers = []; S.selected = null;
  S.screen = "quiz";
  store.remove(KEY_RUN);                                         // 예전 메모는 버림
}
/* 답을 확정할 때마다 "풀던 판"을 메모해 둠 */
function saveRun() {
  if (!store.ok) return;
  var memo = {
    v: 1,
    code: S.code,
    team: S.team,
    teamKey: S.team ? S.teamKey : "",
    setId: S.setId,
    amount: S.amount,
    items: S.items.map(function (it) { return { id: it.id, order: it.order }; }),
    picks: S.answers.map(function (a) { return a.pickedOrig; })   // 고른 '원래 보기' 번호만
  };
  store.set(KEY_RUN, JSON.stringify(memo));
}
/* 메모 읽기 — 조금이라도 이상하면 버리고 null (v0.3.2: 모든 칸을 쓰기 전에 검사)
   메모는 브라우저에 있어서 누구나 개발자 도구로 고칠 수 있으므로 하나도 믿지 않습니다. */
function isInt(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }
function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function loadRun() {
  var raw = store.get(KEY_RUN);
  if (!raw) return null;
  try {
    if (typeof raw !== "string" || raw.length > 20000) throw "크기";
    var m = JSON.parse(raw);
    if (!isPlainObject(m) || m.v !== 1) throw "모양";
    if (typeof m.team !== "boolean") throw "모드";
    if (typeof m.code !== "string" || !validCode(m.code)) throw "코드";
    if (!Array.isArray(m.items) || m.items.length < 1 || m.items.length > TEAM_MAX) throw "문항 개수";
    if (!Array.isArray(m.picks) || m.picks.length > m.items.length) throw "답 개수";
    if (m.amount !== "8" && m.amount !== "all") throw "분량";
    if (typeof m.setId !== "string") throw "세트";

    /* 문항: 앱에 있는 연습 문항 번호만, 겹침 없이, 보기 순서는 올바른 섞임 */
    var seen = {};
    var items = m.items.map(function (x) {
      if (!isPlainObject(x) || typeof x.id !== "string" || !has(QUESTIONS, x.id) || seen[x.id]) throw "문항";
      seen[x.id] = true;
      var q = QUESTIONS[x.id], n = q.choices.length;
      if (!Array.isArray(x.order) || x.order.length !== n) throw "보기 순서";
      var used = {};
      for (var i = 0; i < n; i++) {
        var o = x.order[i];
        if (!isInt(o) || o < 0 || o >= n || used[o]) throw "보기 순서";
        used[o] = true;
      }
      if (q.type === "ox" && (x.order[0] !== 0 || x.order[1] !== 1)) throw "OX 순서";
      if (m.team) { for (var j = 0; j < n; j++) if (x.order[j] !== j) throw "지정 링크는 보기를 섞지 않음"; }
      return { id: x.id, q: q, order: x.order.slice() };
    });
    var ids = items.map(function (it) { return it.id; });

    if (m.team) {
      /* 지정 링크 판: 링크 번호(teamKey)가 실제 문항 목록과 글자 하나까지 같아야 함 */
      if (typeof m.teamKey !== "string" || m.teamKey !== ids.join(",")) throw "링크 번호";
      if (m.setId !== "" && !setById(m.setId)) throw "세트";
    } else {
      /* 일반 판: 그 세트 안의 문항만, 분량과 개수가 맞아야 함 */
      var set = setById(m.setId);
      if (!set) throw "세트";
      if (ids.some(function (id) { return set.ids.indexOf(id) < 0; })) throw "세트 밖 문항";
      var want = m.amount === "8" ? Math.min(PICK_COUNT, set.total) : set.total;
      if (ids.length !== want) throw "분량과 개수";
      if (m.teamKey !== undefined && m.teamKey !== "") throw "링크 번호";
    }

    var answers = m.picks.map(function (orig, k) {
      var it = items[k];
      if (!isInt(orig) || orig < 0 || orig >= it.q.choices.length) throw "답";
      return { pickedOrig: orig, pickedPos: it.order.indexOf(orig), correct: orig === it.q.answer_index }; // 채점은 다시 계산
    });
    return { code: m.code, team: m.team, teamIds: m.team ? ids : [], teamKey: m.team ? ids.join(",") : "",
             setId: setById(m.setId) ? m.setId : (SETS.length ? SETS[0].id : ""), amount: m.amount, items: items, answers: answers };
  } catch (e) {
    store.remove(KEY_RUN);   // 망가진 메모는 버리고 첫 화면으로
    return null;
  }
}
function resumeRun(run) {
  if (S.conflict) {                               // 다른 주소의 기록을 이어 풀 때: 그 판의 모드로 바꿈
    if (run.team) { S.teamIds = run.teamIds.slice(); S.teamKey = run.teamKey; S.missing = 0; S.missingDetail = ""; }  // 검사를 통과한 문항 목록만 씀
    else leaveTeam();
    S.conflict = false;
  }
  S.code = run.code; S.draft = run.code;
  S.team = run.team; S.setId = run.setId || S.setId; S.amount = run.amount || S.amount;
  S.items = run.items; S.answers = run.answers; S.selected = null;
  S.pendingRun = null;
  S.idx = run.answers.length;                     // 다음 안 푼 문항부터
  if (S.idx >= S.items.length) { finishRun(); return; }
  S.screen = "quiz";
}
function finishRun() {
  store.remove(KEY_RUN);                          // 결과까지 오면 메모는 지움
  S.screen = "result";
}

/* 참가자 코드 검사: 영문·숫자 2~10자, '-' 허용(K7M2PX-N), 첫 글자는 영문·숫자.
   한글·특수문자·이모지는 거절. 대문자로 바꾸기 '전'에도 검사해서
   ß → SS 처럼 바뀌며 통과하는 외국 글자도 막습니다 (v0.3.1). */
function validCode(v) { return /^[A-Z0-9][A-Z0-9-]{1,9}$/.test(v); }
function cleanCode(raw) {
  var t = String(raw || "").trim();
  if (!/^[A-Za-z0-9-]+$/.test(t)) return null;   // 바꾸기 전: 영문 A-Z·숫자·'-'만
  var v = t.toUpperCase();
  return validCode(v) ? v : null;                // 바꾼 뒤: 다시 검사
}

/* 교수님 지정 링크 읽기: ?ids=L11-Q1,L12-Q2,... */
function readTeamLink() {
  var m = /[?&]ids=([^&#]*)/.exec(location.search);
  if (!m) return;
  var raw = "";
  try { raw = decodeURIComponent(m[1].replace(/\+/g, " ")); } catch (e) { raw = m[1]; }
  var tokens = raw.split(",").map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s) { return s.length > 0; });
  var ok = [], seen = {}, notFound = 0, dup = 0, over = 0;
  tokens.forEach(function (id) {
    if (seen[id]) { dup++; return; }               // 같은 번호가 두 번 적힘
    seen[id] = true;
    if (!has(QUESTIONS, id)) { notFound++; return; } // 앱에 없는 번호(진단·평가 포함)는 셀 뿐 보여 주지 않음
    if (ok.length >= TEAM_MAX) { over++; return; }   // 너무 많이 적힘
    ok.push(id);
  });
  var parts = [];
  if (notFound) parts.push("앱에 없는 번호 " + notFound + "개");
  if (dup) parts.push("겹친 번호 " + dup + "개");
  if (over) parts.push(TEAM_MAX + "개를 넘은 번호 " + over + "개");
  S.team = true; S.teamIds = ok; S.teamKey = ok.join(",");
  S.missing = notFound + dup + over; S.missingDetail = parts.join(" · ");
}

/* ---------- 6. 화면 그리기 ---------- */
function band() {
  if (!S.team) return "";
  var n = S.teamIds.length;
  var text = n ? '교수님 지정 링크 · 팀 연습 ' + n + '문항 · 순서 고정' : '교수님 지정 링크 · 풀 수 있는 문항 없음';
  return '<div class="band">' + ic("link", 18) + '<span>' + text + '</span></div>';
}
function storageNote() {
  if (!S.storageOff) return "";
  return '<p class="storage-note">' + ic("alert", 16) + '<span>이 브라우저에서는 이어 풀기가 꺼져 있어요. 풀기·채점은 정상이에요.</span></p>';
}

/* ① 첫 화면 */
function viewStart() {
  var err = S.codeError;
  var lead = S.team
    ? (S.teamIds.length
      ? '코드를 넣으면 바로 1번 문제가 열려요. 팀원 모두 <b>같은 문제·같은 보기 순서</b>예요.'
      : '이 링크에는 풀 수 있는 문항이 없어요. 교수님께 알려 주세요. 코드를 넣으면 연습 세트를 고를 수 있어요.')
    : '연습 문제를 풀고 바로 해설을 봐요. 점수는 어디에도 기록되지 않아요.';
  return '<div class="screen">' + band() +
    '<div class="content">' +
    '<div class="brand"><div class="logo" aria-hidden="true">Lv</div>' +
    '<div class="brand-sub">AI Agent 실무자 단기실습과정<br>레벨업 캠퍼스</div></div>' +
    '<div><h1>AI Agent 실무역량 연습</h1><p class="sub" style="margin-top:6px">' + lead + '</p></div>' +
    '<ol class="today" aria-label="오늘 할 일">' +
    '<li><b>1</b>코드 넣기</li>' +
    (S.team ? '<li><b>2</b>팀과 상의</li>' : '<li><b>2</b>세트 고르기</li>') +
    '<li><b>3</b>풀고 바로 해설</li>' +
    '</ol>' +
    '<form class="card" data-form="code" novalidate>' +
    '<div class="field' + (err ? ' err' : '') + '">' +
    '<label for="code">참가자 코드</label>' +
    '<input id="code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="카드에 적힌 코드 (예: K7M2PX)" value="' + esc(S.draft) + '" aria-describedby="code-help' + (err ? ' code-err' : '') + '"' + (err ? ' aria-invalid="true"' : '') + '>' +
    (err ? '<p class="error" id="code-err" role="alert">' + ic("cross", 18) + '<span>' + esc(err) + '</span></p>' : '') +
    '<p class="help" id="code-help">이름·학번은 넣지 마세요.</p>' +
    '</div>' +
    '<div class="info" style="margin-top:12px">' + ic("info", 18) + '<span>이 코드는 화면에만 표시되고 어디에도 저장·전송되지 않아요.</span></div>' +
    '<button class="btn btn-primary" type="submit" data-act="start" style="margin-top:16px">시작하기</button>' +
    '</form>' +
    '<p class="sub" style="text-align:center">공식 평가는 이 앱에서 하지 않아요. 이 앱은 점수와 무관한 연습용이에요.</p>' +
    storageNote() +
    '</div></div>';
}

/* ①-b 이어 풀기 */
function viewResume() {
  var r = S.pendingRun, n = r.items.length, k = r.answers.length;
  var title = r.team ? "팀 연습 · 순서 고정" : (setById(r.setId).title + " · " + (r.amount === "8" ? PICK_COUNT + "문항 무작위" : "세트 전체"));
  var btn = k >= n ? "이어 풀기 (결과 보기)" : "이어 풀기 (" + (k + 1) + "번부터)";
  var conflictNote = !S.conflict ? '' :
    '<div class="note" id="conflict"><p class="note-title">' + ic("alert", 18) + (S.team ? '지금 연 주소는 교수님 지정 링크예요' : '지금 연 주소는 일반 연습이에요') + '</p>' +
    '<p>[기록 지우고 새로 시작]을 누르면 아래 풀던 기록은 지워져요. 이어 풀려면 [이어 풀기]를 누르세요.</p></div>';
  return '<div class="screen">' + band() + '<div class="content">' +
    '<div class="brand"><div class="logo" aria-hidden="true">Lv</div><div class="brand-sub">AI Agent 실무역량 연습</div></div>' +
    '<div class="card" style="display:flex;flex-direction:column;gap:12px">' +
    '<h2>풀던 연습이 있어요</h2>' + conflictNote +
    '<p><b>' + esc(title) + '</b><br><span class="sub"><span class="mono">' + esc(r.code) + '</span>님 · ' + n + '문항 중 ' + k + '문항까지 풀었어요. 문제·보기 순서와 고른 답이 그대로 남아 있어요.</span></p>' +
    '<div class="btn-col">' +
    '<button class="btn btn-primary" data-act="resume">' + btn + '</button>' +
    '<button class="btn btn-secondary" data-act="new-start">' + (S.conflict ? '기록 지우고 새로 시작' : '새로 시작') + '</button>' +
    '</div>' +
    '<div class="info">' + ic("info", 18) + '<span>이 메모는 이 휴대폰 브라우저에만 있어요. 결과 화면까지 가면 지워져요.</span></div>' +
    '</div>' +
    '</div></div>';
}

/* ② 세트 고르기 */
function viewSets() {
  var set = setById(S.setId);
  var cards = SETS.map(function (s) {
    var on = s.id === S.setId;
    return '<button class="setcard" role="radio" aria-checked="' + on + '" data-act="pick-set" data-id="' + esc(s.id) + '">' +
      '<span class="partno">' + esc(s.part) + '<small>부</small></span>' +
      '<span><span class="st-title">' + esc(s.title) + '</span><br><span class="st-range">' + esc(s.range) + '</span></span>' +
      '<span class="st-count">' + s.total + '문항' + (on ? '<span class="st-check">' + ic("check", 16) + '선택됨</span>' : '') + '</span>' +
      '</button>';
  }).join("");
  var a8 = S.amount === "8";
  var pick = Math.min(PICK_COUNT, set.total);
  return '<div class="screen"><div class="content">' +
    '<div><p class="h-label"><span class="mono">' + esc(S.code) + '</span>님</p><h2 style="margin-top:2px">어떤 범위를 연습할까요?</h2></div>' +
    '<div class="setlist" role="radiogroup" aria-label="연습 세트">' + cards + '</div>' +
    '<div><h3 style="margin-bottom:8px">분량</h3>' +
    '<div class="seg" role="radiogroup" aria-label="분량">' +
    '<button role="radio" aria-checked="' + a8 + '" data-act="pick-amount" data-v="8">' + pick + '문항<small>무작위로 뽑기</small></button>' +
    '<button role="radio" aria-checked="' + (!a8) + '" data-act="pick-amount" data-v="all">세트 전체<small>' + set.total + '문항 모두</small></button>' +
    '</div></div>' +
    '<div class="info">' + ic("info", 18) + '<span>풀 때마다 문제와 보기 순서가 바뀌어요. 시간 제한은 없어요.</span></div>' +
    '<button class="linkbtn" data-act="home">코드 바꾸기</button>' +
    '</div>' +
    '<div class="bottombar"><button class="btn btn-primary" data-act="start-set">' + esc(set.title) + ' · ' + (a8 ? pick + '문항' : '세트 전체 ' + set.total + '문항') + ' 시작</button></div>' +
    '</div>';
}

/* ③④ 문제 + 해설 */
function viewQuiz() {
  if (!S.items.length) {
    return '<div class="screen">' + band() + '<div class="content"><div class="note"><p class="note-title">' + ic("alert", 18) + '이 링크에 풀 수 있는 문항이 없어요</p><p>교수님께 알려 주세요.</p></div>' +
      '<button class="btn btn-secondary" data-act="other-set">연습 세트 고르기</button></div></div>';
  }
  var n = S.items.length, i = S.idx, it = S.items[i], q = it.q;
  var ans = S.answers[i], locked = !!ans, sel = S.selected, ox = q.type === "ox";
  var many = n > 14;
  /* 진행 칸: 실제 문항 수(n)만큼 */
  var steps = S.items.map(function (_, k) {
    var a = S.answers[k], cls = "step" + (many ? " many" : "");
    if (a) return '<span class="' + cls + (a.correct ? " ok" : " no") + '">' + ic(a.correct ? "check" : "cross", 13) + '</span>';
    if (k === i) return '<span class="' + cls + ' now"></span>';
    return '<span class="' + cls + '"></span>';
  }).join("");
  var cp = correctPos(it);
  var choices = it.order.map(function (_, p) {
    var cls = "choice", mark = "";
    if (locked) {
      if (p === cp) { cls += " is-correct"; mark = '<span class="mark ok">' + ic("check", 20) + '<span>정답</span>' + (ans.pickedPos === p ? '<span>내 답</span>' : '') + '</span>'; }
      else if (p === ans.pickedPos) { cls += " is-wrong"; mark = '<span class="mark no">' + ic("cross", 20) + '<span>내 답</span></span>'; }
      else cls += " dim";
    } else if (sel === p) cls += " selected";
    var label = choiceLabel(it, p), text = choiceText(it, p);
    var inner = ox
      ? '<span class="num" aria-hidden="true">' + esc(label) + '</span><span class="txt">' + oxWord(label) + '</span>'
      : '<span class="num" aria-hidden="true">' + (p + 1) + '</span><span class="txt">' + esc(text) + '</span>';
    var aria = ox ? label + " " + oxWord(label) : (p + 1) + "번 " + text;
    if (locked) { aria += (p === cp ? " — 정답" : "") + (p === ans.pickedPos ? " — 내 답" : "") + " (잠김)"; }
    return '<button class="' + cls + '" data-act="select" data-pos="' + p + '" data-orig="' + it.order[p] + '" aria-label="' + esc(aria) + '"' +
      (locked ? ' aria-disabled="true"' : ' aria-pressed="' + (sel === p) + '"') + '>' + inner + mark + '</button>';
  }).join("");

  var feedback = "";
  if (locked) {
    var right = '<b>' + esc(choiceLabel(it, cp)) + ' ' + esc(ox ? oxWord(choiceLabel(it, cp)) : choiceText(it, cp)) + '</b>';
    var verdict = ans.correct
      ? '<div class="verdict ok pop" id="verdict" tabindex="-1" role="status" data-result="correct"><span class="v-icon">' + ic("check", 18) + '</span><span class="v-body">정답입니다</span></div>'
      : '<div class="verdict no pop" id="verdict" tabindex="-1" role="status" data-result="wrong"><span class="v-icon">' + ic("cross", 18) + '</span><span class="v-body">아쉬워요, 정답은 ' + right + '</span></div>';
    var confuse = (!ans.correct && ans.pickedOrig === q.common_wrong_index && q.common_wrong_reason)
      ? '<div class="note" id="confuse"><p class="note-title">' + ic("alert", 18) + '이렇게 헷갈리기 쉬워요</p><p>' + esc(q.common_wrong_reason) + '</p></div>' : '';
    feedback = verdict +
      '<section class="card explain" aria-label="해설"><h3>해설</h3><p>' + esc(q.explanation) + '</p>' + confuse +
      (q.source_section ? '<p class="source">근거: ' + esc(q.source_section) + '</p>' : '') + '</section>';
  }
  var missing = (S.team && S.missing > 0 && i === 0 && !locked)
    ? '<div class="note" id="missing"><p class="note-title">' + ic("alert", 18) + '링크의 번호 중 ' + S.missing + '개는 제외했어요</p><p>' + esc(S.missingDetail) + '. 있는 문항만 진행해요. 교수님께 알려 주세요.</p></div>' : '';
  var last = i === n - 1;
  var bar = locked
    ? '<button class="btn btn-primary" data-act="next">' + (last ? '결과 보기' : '다음 문제') + '</button>'
    : '<p class="hint">' + (sel === null ? '보기를 먼저 고르세요' : '확정하면 바로 채점과 해설이 나와요') + '</p>' +
      '<button class="btn btn-primary" data-act="confirm"' + (sel === null ? ' disabled' : '') + '>답 확정</button>';
  var sub = S.team ? "순서 고정" : amountLabel();
  return '<div class="screen' + (S.team ? ' is-team' : '') + '">' + band() +
    '<div class="content">' +
    '<div class="qhead">' +
    '<div class="qhead-row"><span class="h-label">' + esc(runTitle()) + ' · ' + sub + '</span>' +
    '<span class="count" id="count">' + (i + 1) + ' / ' + n + '</span></div>' +
    '<div class="steps" aria-hidden="true">' + steps + '</div>' +
    '<span class="sr">전체 ' + n + '문항 중 ' + (i + 1) + '번째 문항</span>' +
    '</div>' + missing +
    '<div class="card qcard"><div class="qmeta"><span class="tag" id="qid" title="문항 표지">' + esc(it.id) + '</span><span class="qtype">' + (ox ? 'O / X' : q.choices.length + '지선다') + '</span></div>' +
    '<p class="qtext">' + esc(q.question) + '</p></div>' +
    '<div class="choices' + (ox ? ' ox' : '') + '" role="group" aria-label="보기">' + choices + '</div>' +
    feedback +
    '</div>' +
    '<div class="bottombar">' + storageNote() + bar + '</div>' +
    '</div>';
}

/* ⑤ 결과 */
function viewResult() {
  var n = S.items.length, c = score(), wrong = n - c;
  var feet = S.items.map(function (it, k) {
    var a = S.answers[k], ok = a && a.correct;
    return '<li class="' + (ok ? 'ok' : 'no') + '"><span class="f-top">' + (k + 1) + ' ' + ic(ok ? "check" : "cross", 16) + (ok ? '정답' : '오답') + '</span><span class="f-id">' + esc(it.id) + '</span></li>';
  }).join("");
  var title = S.team ? "팀 연습 · 순서 고정" : runTitle() + " · " + (S.amount === "8" ? n + "문항 무작위" : "세트 전체");
  var msg = wrong === 0 ? n + '문항 모두 정답입니다.' : '틀린 ' + wrong + '문항의 해설을 다시 보면 좋아요.';
  return '<div class="screen">' + band() +
    '<div class="content">' +
    '<div><p class="h-label"><span class="mono" id="result-code">' + esc(S.code) + '</span>님 결과</p>' +
    '<div class="score" style="margin-top:6px"><b id="score">' + c + '</b><span>/ ' + n + ' 정답</span></div>' +
    '<p style="margin-top:6px" id="result-line">' + n + '문항 중 ' + c + '문항 정답 · ' + msg + '</p>' +
    '<p style="margin-top:8px"><span class="chip">' + esc(title) + '</span></p></div>' +
    '<div class="card"><h3 style="margin-bottom:10px">문항별 결과</h3><ol class="feet" aria-label="문항별 결과">' + feet + '</ol></div>' +
    '<div class="info">' + ic("info", 18) + '<span>이 결과는 <b>이 휴대폰 화면에만</b> 있어요. 교수님을 포함해 아무에게도 전송되지 않아요.</span></div>' +
    '<div class="btn-col">' +
    (wrong > 0 ? '<button class="btn btn-secondary" data-act="review">틀린 문항 다시 보기 (' + wrong + ')</button>' : '<p class="sub" style="text-align:center">틀린 문항이 없어요.</p>') +
    '<button class="btn btn-primary" data-act="replay">' + (S.team ? '같은 문항 다시 풀기' : '다시 풀기 — 새로 섞어요') + '</button>' +
    '<button class="btn btn-secondary" data-act="other-set">다른 세트</button>' +
    '</div>' +
    '</div></div>';
}

/* ⑥ 틀린 문항 다시 보기 */
function viewReview() {
  var list = [];
  S.items.forEach(function (it, k) {
    var a = S.answers[k];
    if (!a || a.correct) return;
    var q = it.q, ox = q.type === "ox", cp = correctPos(it);
    function show(pos) { var l = choiceLabel(it, pos); return esc(l) + ' ' + esc(ox ? oxWord(l) : choiceText(it, pos)); }
    var confuse = (a.pickedOrig === q.common_wrong_index && q.common_wrong_reason) ? '<div class="note"><p class="note-title">' + ic("alert", 18) + '이렇게 헷갈리기 쉬워요</p><p>' + esc(q.common_wrong_reason) + '</p></div>' : '';
    list.push('<article class="card rv" data-id="' + esc(it.id) + '"><div class="qmeta"><span class="tag">' + esc(it.id) + '</span><span class="qtype">' + (k + 1) + '번째 문항</span></div>' +
      '<p class="qtext">' + esc(q.question) + '</p>' +
      '<div class="rv-row no"><span class="rv-k">' + ic("cross", 18) + '내 답</span><span class="rv-v">' + show(a.pickedPos) + '</span></div>' +
      '<div class="rv-row ok"><span class="rv-k">' + ic("check", 18) + '정답</span><span class="rv-v">' + show(cp) + '</span></div>' +
      '<p>' + esc(q.explanation) + '</p>' + confuse +
      (q.source_section ? '<p class="source">근거: ' + esc(q.source_section) + '</p>' : '') + '</article>');
  });
  return '<div class="screen">' + band() +
    '<div class="content">' +
    '<div><p class="h-label">결과 › 다시 보기</p><h2 style="margin-top:2px">틀린 문항 ' + list.length + '개</h2></div>' +
    (list.length ? list.join("") : '<div class="card empty">틀린 문항이 없어요.</div>') +
    '</div>' +
    '<div class="bottombar"><button class="btn btn-secondary" data-act="back-result">결과로 돌아가기</button></div>' +
    '</div>';
}

/* 문항 파일이 없을 때 */
function viewError() {
  return '<div class="screen"><div class="content"><div class="note"><p class="note-title">' + ic("alert", 18) + '문항 파일을 찾지 못했어요</p>' +
    '<p>data/practice.js 가 없어요. README의 "문항 데이터 다시 만들기"를 따라 해 주세요.</p></div></div></div>';
}

var VIEWS = { start: viewStart, resume: viewResume, sets: viewSets, quiz: viewQuiz, result: viewResult, review: viewReview, error: viewError };
function render(opts) {
  opts = opts || {};
  app.innerHTML = VIEWS[S.screen]();
  if (opts.top) window.scrollTo(0, 0);
  if (opts.focusVerdict) {
    var v = document.getElementById("verdict");
    if (v) {
      v.focus({ preventScroll: true });
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      v.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
  }
  if (opts.focusCode) { var c = document.getElementById("code"); if (c) c.focus(); }
  fitBars();
}
/* 위·아래 고정 띠가 화면을 너무 많이 가리면(가로 모드 + 큰 글자 등) 고정을 풂 (v0.3.1) */
function fitBars() {
  var scr = app.querySelector(".screen");
  document.body.classList.remove("bars-loose");
  if (!scr) return;
  var h = 0;
  [".band", ".bottombar"].forEach(function (sel) { var el = scr.querySelector(sel); if (el) h += el.offsetHeight; });
  if (h > window.innerHeight * 0.35) document.body.classList.add("bars-loose");
}
window.addEventListener("resize", fitBars);

/* ---------- 뒤로 가기 (v0.3.1) ----------
   앱 안의 화면 이동을 브라우저 기록(history)에 한 칸씩 적어 둡니다.
   그래서 휴대폰 '뒤로 가기'를 누르면 앱 밖으로 나가지 않고 앱 안의 이전 화면으로 갑니다.
   단계: 첫 화면(0) → 세트 고르기(1) → 문제·결과(2) → 다시 보기(3)
         지정 링크는 세트 고르기가 없어서 첫 화면(0) → 문제·결과(1) → 다시 보기(2) */
function depthOf(screen) {
  if (screen === "sets") return 1;
  var base = S.team ? 1 : 2;
  if (screen === "quiz" || screen === "result") return base;
  if (screen === "review") return base + 1;
  return 0;                                        // start, resume, error
}
function screenAtDepth(d) {                        // 중간 단계를 채울 때 쓰는 화면
  if (d === 0) return "start";
  if (!S.team && d === 1) return "sets";
  return "result";
}
var popIgnore = false;                             // 앱이 스스로 뒤로 이동할 때는 popstate를 무시
function hist(method, screen, url) {
  try { history[method]({ lu: 1, screen: screen, d: depthOf(screen) }, "", url); } catch (e) { /* 무시 */ }
}
/* 화면 바꾸기 + 브라우저 기록 맞추기 */
function nav(screen, opts) {
  var from = S.depth, to = depthOf(screen);
  S.screen = screen;
  render(opts || { top: true });
  if (to > from) {
    for (var d = from + 1; d < to; d++) hist("pushState", screenAtDepth(d));
    hist("pushState", screen);
  } else if (to === from) {
    hist("replaceState", screen);
  } else {
    popIgnore = true;
    try { history.go(to - from); } catch (e) { popIgnore = false; }
  }
  S.depth = to;
}
/* 이 화면을 지금 보여 줄 수 있나 */
function canShow(screen) {
  var done = S.items.length > 0 && S.answers.length === S.items.length;
  if (screen === "start") return true;
  if (screen === "resume") return !!S.pendingRun;
  if (screen === "sets") return !!S.code;
  if (screen === "quiz") return S.items.length > 0 && !done;
  if (screen === "result" || screen === "review") return done;
  return false;
}
function fallbackAt(d) {
  if (d >= 1 && canShow("result")) return "result";
  if (d >= 1 && !S.team && S.code) return "sets";
  return "start";
}
/* 휴대폰 '뒤로 가기' / '앞으로 가기' */
window.addEventListener("popstate", function (e) {
  if (!DATA) return;
  if (popIgnore) { popIgnore = false; hist("replaceState", S.screen); return; }
  var st = (e.state && e.state.lu) ? e.state : { screen: "start", d: 0 };
  var inRun = S.screen === "quiz" && S.items.length > 0 && S.answers.length < S.items.length;
  if (inRun && st.d < S.depth) {
    var quit = window.confirm("그만 풀까요?\n지금까지 푼 기록은 이 휴대폰에 남아 있어서, 다시 열면 '이어 풀기'로 이어 풀 수 있어요.");
    if (!quit) { hist("pushState", "quiz"); return; }   // 취소: 문제 화면 그대로
  }
  var target = canShow(st.screen) ? st.screen : fallbackAt(st.d);
  S.selected = null;
  S.screen = target;
  render({ top: true });
  S.depth = depthOf(target);
  hist("replaceState", target);
});

/* 지정 링크에서 나와 일반 연습으로 (주소의 ?ids= 도 지움) */
function leaveTeam() {
  S.team = false; S.missing = 0; S.missingDetail = ""; S.teamIds = []; S.teamKey = "";
  hist("replaceState", S.screen, location.pathname);
}

/* ---------- 7. 버튼 동작 ---------- */
app.addEventListener("input", function (e) { if (e.target.id === "code") S.draft = e.target.value; });

/* [시작하기] — 참가자 코드 확인 */
app.addEventListener("submit", function (e) {
  e.preventDefault();
  var v = cleanCode(S.draft);
  if (!v) {
    S.codeError = "카드에 적힌 영문·숫자 코드를 넣어 주세요 (2~10자).";
    render({ focusCode: true });
    return;
  }
  S.codeError = ""; S.code = v; S.draft = v;
  store.set(KEY_CODE, v);                       // 다음에 미리 채워 두기 (이 휴대폰에만)
  if (S.team && S.teamIds.length) { startTeam(); nav("quiz"); }
  else { if (S.team) leaveTeam(); nav("sets"); }
});

app.addEventListener("click", function (e) {
  var b = e.target.closest("[data-act]");
  if (!b || !app.contains(b)) return;
  var act = b.getAttribute("data-act");
  var now = Date.now();
  switch (act) {
    case "home":
      S.codeError = ""; nav("start"); break;
    case "new-start":
      store.remove(KEY_RUN); S.pendingRun = null; S.conflict = false; S.codeError = ""; nav("start"); break;
    case "resume":
      if (S.pendingRun) { resumeRun(S.pendingRun); nav(S.screen); }
      break;
    case "pick-set":
      if (setById(b.getAttribute("data-id"))) { S.setId = b.getAttribute("data-id"); render(); }
      break;
    case "pick-amount":
      S.amount = b.getAttribute("data-v") === "all" ? "all" : "8"; render(); break;
    case "start-set":
      startSet(S.setId, S.amount); nav("quiz"); break;
    case "select":
      if (S.screen !== "quiz" || S.answers[S.idx]) return;        // 확정 후에는 바꿀 수 없음
      S.selected = +b.getAttribute("data-pos"); render(); break;
    case "confirm":
      if (S.selected === null || S.answers[S.idx]) return;        // 연타해도 한 번만 채점
      var it = S.items[S.idx], orig = it.order[S.selected];
      S.answers[S.idx] = { pickedOrig: orig, pickedPos: S.selected, correct: orig === it.q.answer_index };
      S.lockUntil = now + 600;                                    // 같은 자리 [다음 문제]가 연타로 눌리지 않게
      saveRun();
      render({ focusVerdict: true }); break;
    case "next":
      if (now < S.lockUntil || !S.answers[S.idx]) return;         // 연타해도 한 문항만
      S.lockUntil = now + 600;
      S.selected = null;
      if (S.idx >= S.items.length - 1) { finishRun(); nav("result"); }
      else { S.idx++; render({ top: true }); }
      break;
    case "review": nav("review"); break;
    case "back-result": nav("result"); break;
    case "replay":
      if (S.team) startTeam(); else startSet(S.setId, S.amount);
      nav("quiz"); break;
    case "other-set":
      if (S.team) leaveTeam();                                    // 지정 링크에서 나와 일반 연습으로
      nav("sets"); break;
  }
});

/* ---------- 8. 밝게/어둡게 ---------- */
var themeBtn = document.getElementById("theme-btn");
function isDark() {
  var m = document.documentElement.getAttribute("data-mode");
  if (m) return m === "dark";
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function syncThemeBtn() { if (themeBtn) themeBtn.textContent = isDark() ? "밝게 보기" : "어둡게 보기"; }
function applyTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.setAttribute("data-mode", mode);
  else document.documentElement.removeAttribute("data-mode");   // 기기 설정 따라가기
  syncThemeBtn();
}
if (themeBtn) themeBtn.addEventListener("click", function () {
  var next = isDark() ? "light" : "dark";
  applyTheme(next);
  store.set(KEY_THEME, next);
});
if (window.matchMedia) {
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", syncThemeBtn);
}

/* ---------- 9. 시작 ---------- */
(function init() {
  store.check();
  S.storageOff = !store.ok;
  applyTheme(store.get(KEY_THEME));
  if (!DATA) { S.screen = "error"; render(); return; }

  readTeamLink();                                  // ?ids= 가 있으면 지정 링크 모드
  var saved = store.get(KEY_CODE);
  if (saved && validCode(saved)) { S.draft = saved; }

  var run = loadRun();
  if (run) {
    var same = S.team ? (run.team && run.teamKey === S.teamKey) : !run.team;
    S.pendingRun = run; S.screen = "resume";
    S.conflict = !same;                            // 다른 주소의 기록이면 지우기 전에 물어봄 (v0.3.1)
  }
  S.depth = 0;
  hist("replaceState", S.screen);                  // 지금 자리를 '첫 단계'로 적어 둠
  render();
})();
