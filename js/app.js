/* ==========================================================
   누니 홈 화면 동작 (js/app.js)
   - 목업 데이터로 목록을 그리고, 버튼 클릭(I1~I11)에 반응합니다.
   - 모든 상태는 메모리에만 있어요. 새로고침하면 처음으로 돌아갑니다.
   ========================================================== */

/* ---------- 1. 목업 데이터 ---------- */
const user = { name: "김민지", dept: "경영학과", level: 7, title: "탐구하는 새싹",
  xp: 1240, xpMax: 1500, streak: 12, coins: 340, nextTitle: "꾸준한 탐험가" };

const today = { course: "경영통계", title: "표본분포와 중심극한정리 감 잡기",
  reason: "지난 퀴즈에서 '표준오차' 정답률 58% → 기초 예제부터 다시 볼게요",
  level: "보통", minutes: 15, total: 8, done: 3, xpByLevel: { 쉬움: 80, 보통: 120, 어려움: 180 } };

const quests = [
  { id: "q1", icon: "📘", title: "오늘의 맞춤 학습 1개 완료하기", xp: 50, done: false },
  { id: "q2", icon: "⚔️", title: "친구와 퀴즈 대결 1판 하기",     xp: 40, done: false },
  { id: "q3", icon: "✅", title: "출석 체크하기",                xp: 10, done: true },
  { id: "q4", icon: "💬", title: "스터디방에서 질문 1개 답하기",   xp: 30, done: true },
];

const friends = [
  { name: "박서준", online: true }, { name: "이하은", online: true },
  { name: "최도윤", online: false }, { name: "정유나", online: true },
  { name: "강지호", online: false }, { name: "윤소율", online: false },
];

const rooms = [
  { id: "r1", type: "대결",   title: "경영통계 퀴즈 배틀", host: "박서준", now: 3, max: 4, left: "5분 후 시작" },
  { id: "r2", type: "스터디", title: "파이썬 기초 과제 같이 풀기", host: "이하은", now: 2, max: 6, left: "진행 중 · 40분 남음" },
];

const ranking = {
  우리반: [
    { name: "이하은", dept: "경영학과", xp: 2480 }, { name: "박서준", dept: "경영학과", xp: 2210 },
    { name: "김민지", dept: "경영학과", xp: 1960, me: true }, { name: "정유나", dept: "경영학과", xp: 1720 },
    { name: "최도윤", dept: "경영학과", xp: 1530 },
  ],
  전체: [
    { name: "한지민", dept: "글로벌호텔외식", xp: 4120 }, { name: "오세훈", dept: "AI빅데이터", xp: 3890 },
    { name: "임채원", dept: "철도경영", xp: 3650 }, { name: "이하은", dept: "경영학과", xp: 2480 },
    { name: "송민재", dept: "물류시스템", xp: 2400 },
  ],
  myAllRank: { rank: 27, xp: 1960 },   // 전체 탭에서 5위 밖 내 순위로 표시
};

const courses = [
  { name: "경영통계",       color: "#2B44E0", progress: 62, next: "7차시 · 표본분포" },
  { name: "파이썬 기초",     color: "#14B88A", progress: 45, next: "5차시 · 반복문" },
  { name: "마케팅원론",     color: "#FF6B35", progress: 80, next: "9차시 · 가격 전략" },
  { name: "회계원리",       color: "#FFC233", progress: 30, next: "4차시 · 분개" },
  { name: "비즈니스 영어",   color: "#C2410C", progress: 55, next: "6차시 · 이메일 쓰기" },
];

/* 난이도 순서와 배지 색 클래스 */
const LEVELS = ["쉬움", "보통", "어려움"];
const LEVEL_CLASS = { 쉬움: "lv-easy", 보통: "lv-mid", 어려움: "lv-hard" };

/* 화면 상태 (메모리에만 저장) */
const state = {
  learned: false,      // 오늘 학습 완료 여부
  bonusOpened: false,  // 보너스 상자 받았는지
  rankScope: "우리반", // 랭킹 탭
  joined: {},          // 참여한 방 { r1: true }
};

/* ---------- 2. 작은 도우미 함수 ---------- */
// id로 요소 찾기
const $ = (id) => document.getElementById(id);
// 1240 → "1,240"
const fmt = (n) => n.toLocaleString("ko-KR");
// 사용자가 "움직임 줄이기"를 켰는지
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- 3. 토스트 (한 번에 하나, 2.2초) ---------- */
let toastTimer = null;
function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("is-show");
  clearTimeout(toastTimer);           // 이전 토스트 타이머는 취소
  toastTimer = setTimeout(() => el.classList.remove("is-show"), 2200);
}

/* ---------- 4. 떠오르는 "+30 XP" 숫자 ---------- */
function floatXp(text, fromEl) {
  if (reduceMotion() || !fromEl) return;   // 움직임 줄이기면 생략
  const rect = fromEl.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = "float-xp";
  el.textContent = text;
  el.setAttribute("aria-hidden", "true");
  el.style.left = rect.left + rect.width / 2 + "px";
  el.style.top = rect.top - 8 + "px";
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

/* ---------- 5. 헤더 · 레벨 카드 그리기 ---------- */
function renderHeader() {
  $("streak").textContent = user.streak + "일";
  $("coins").textContent = fmt(user.coins);
  $("coins").parentElement.setAttribute("aria-label", "코인 " + fmt(user.coins) + "개");
  $("level-num").textContent = "Lv." + user.level;
  $("level-title").textContent = user.title;
  $("xp-text").textContent = fmt(user.xp) + " / " + fmt(user.xpMax) + " XP";
  $("xp-left").textContent = "다음 레벨까지 " + fmt(user.xpMax - user.xp) + " XP";
  $("xp-bar").setAttribute("aria-valuenow", user.xp);
  $("xp-bar").setAttribute("aria-valuemax", user.xpMax);
}

// XP 바 너비 설정 (animate=false면 순간 이동)
function setXpBar(percent, animate) {
  const fill = $("xp-fill");
  fill.classList.toggle("no-anim", !animate);
  fill.style.width = percent + "%";
  if (!animate) {
    void fill.offsetWidth;            // 브라우저에 즉시 반영시키는 요령
    fill.classList.remove("no-anim");
  }
}

/* ---------- 6. XP 얻기 + 레벨 업 (I1, I2) ---------- */
function addXp(amount, fromEl) {
  floatXp("+" + amount + " XP", fromEl);
  user.xp += amount;

  let leveledUp = false;
  // 1,500 이상이면 레벨 업, 남은 XP는 이월 (필요 XP는 1,500 고정)
  while (user.xp >= user.xpMax) {
    user.xp -= user.xpMax;
    user.level += 1;
    leveledUp = true;
  }

  const percent = (user.xp / user.xpMax) * 100;
  if (leveledUp) {
    user.title = user.nextTitle;
    if (reduceMotion()) {
      setXpBar(percent, false);
    } else {
      // 바를 끝까지 채운 뒤 → 0으로 돌아가 → 이월된 만큼 다시 채움
      setXpBar(100, true);
      setTimeout(() => {
        setXpBar(0, false);
        setXpBar(percent, true);
      }, 600);
    }
    renderHeader();
    openModal("modal-level", null);
    $("levelup-text").textContent = "Lv." + user.level + " '" + user.title + "'";
  } else {
    setXpBar(percent, true);
    renderHeader();
  }
}

/* ---------- 7. 오늘의 맞춤 학습 (I4, I5) ---------- */
function renderToday() {
  const xp = today.xpByLevel[today.level];
  const badge = $("today-badge");
  badge.textContent = today.level;
  badge.className = "badge " + LEVEL_CLASS[today.level];
  $("today-course").textContent = today.course;
  $("today-title").textContent = today.title;
  $("today-reason").textContent = today.reason;
  $("today-min").textContent = today.minutes;
  $("today-total").textContent = today.total;
  $("today-xp").textContent = "+" + xp + " XP";
  $("today-progress").textContent = today.done + "/" + today.total + " 완료";
  $("today-fill").style.width = (today.done / today.total) * 100 + "%";
  $("today-bar").setAttribute("aria-valuenow", today.done);

  if (state.learned) {
    $("btn-start").textContent = "오늘 학습 완료";
    $("btn-start").disabled = true;
    $("btn-level").disabled = true;   // 학습을 끝낸 뒤엔 난이도 변경 막기
  }
}

// I5: 난이도 순환 (쉬움 → 보통 → 어려움 → 쉬움 …)
function cycleLevel() {
  const next = LEVELS[(LEVELS.indexOf(today.level) + 1) % LEVELS.length];
  today.level = next;
  renderToday();
  showToast("난이도를 '" + next + "'으로 바꿨어요");
}

// I4: 바텀시트 열기
function openStartSheet() {
  $("sheet-course").textContent = today.course;
  $("sheet-title").textContent = today.title;
  $("sheet-text").textContent = today.total + "문제 중 " + (today.done + 1) + "번부터 시작해요";
  openModal("modal-start", $("btn-start"));
}

// I4: 시작 → (데모) 학습 완료 처리
function finishLearning() {
  closeModal();
  const xp = today.xpByLevel[today.level];
  today.done = today.total;           // 진행 바 8/8
  state.learned = true;
  renderToday();
  addXp(xp, $("btn-start"));
  showToast("학습 완료! +" + xp + " XP");
  completeQuest("q1");                // 퀘스트 q1 자동 완료 (+50)
}

/* ---------- 8. 오늘의 퀘스트 (I1, I3) ---------- */
function renderQuests() {
  $("quest-list").innerHTML = quests.map((q) => `
    <li class="quest-item ${q.done ? "is-done" : ""}">
      <span class="quest-icon" aria-hidden="true">${q.icon}</span>
      <div class="quest-body">
        <p class="quest-title">${q.title}</p>
        <p class="quest-xp num">+${q.xp} XP</p>
      </div>
      <button type="button" class="btn btn-sm btn-done ${q.done ? "is-done" : ""}"
              data-quest="${q.id}" ${q.done ? "disabled" : ""}
              aria-label="${q.title} ${q.done ? "완료됨" : "완료하기"}">
        ${q.done ? "✓" : "완료"}
      </button>
    </li>`).join("");

  const doneCount = quests.filter((q) => q.done).length;
  $("quest-count").textContent = doneCount + "/" + quests.length + " 완료";

  // 4개 모두 완료하면 보너스 상자 활성
  const bonus = $("btn-bonus");
  if (state.bonusOpened) {
    bonus.disabled = true;
    bonus.textContent = "받기 완료";
    $("bonus-hint").textContent = "보너스 상자를 받았어요 (+100 XP, +50 코인)";
  } else if (doneCount === quests.length) {
    bonus.disabled = false;
    $("bonus-hint").textContent = "퀘스트를 모두 끝냈어요! 상자를 열어 보세요";
  }
}

// I1: 퀘스트 하나 완료
function completeQuest(id) {
  const q = quests.find((item) => item.id === id);
  if (!q || q.done) return;
  const btn = document.querySelector(`[data-quest="${id}"]`);
  q.done = true;
  addXp(q.xp, btn);
  renderQuests();
}

// I3: 보너스 상자
function openBonus() {
  if (state.bonusOpened) return;
  state.bonusOpened = true;
  user.coins += 50;
  addXp(100, $("btn-bonus"));
  renderQuests();
  showToast("보너스 상자! +100 XP, +50 코인");
}

/* ---------- 9. 친구 · 방 (I6, I7) ---------- */
function renderFriends() {
  const invite = `
    <li class="friend">
      <button type="button" class="avatar avatar-invite" id="btn-invite" aria-label="친구 초대">+</button>
      <span class="friend-name">친구 초대</span>
    </li>`;
  const list = friends.map((f) => `
    <li class="friend">
      <span class="avatar" aria-hidden="true">
        ${f.name.slice(0, 1)}
        ${f.online ? '<span class="online"></span>' : ""}
      </span>
      <span class="friend-name">${f.name}<span class="sr-only">${f.online ? " (온라인)" : ""}</span></span>
    </li>`).join("");
  $("friend-row").innerHTML = invite + list;
}

function renderRooms() {
  $("room-list").innerHTML = rooms.map((r) => {
    const joined = state.joined[r.id];
    const full = r.now >= r.max;
    let label = "참여";
    if (joined) label = "참여 중";
    else if (full) label = "가득 참";
    return `
      <li class="card room">
        <div class="room-body">
          <p class="room-title">${r.title}</p>
          <p class="room-meta">
            <span class="badge ${r.type === "대결" ? "t-battle" : "t-study"}">${r.type}</span>
            <span>👥 <b class="num">${r.now}/${r.max}</b></span>
            <span>${r.left}</span>
          </p>
        </div>
        <button type="button" class="btn btn-sm btn-brand btn-join ${joined ? "is-joined" : ""}"
                data-room="${r.id}" ${joined || full ? "disabled" : ""}>${label}</button>
      </li>`;
  }).join("");
}

// I6: 방 참여
function joinRoom(id) {
  const r = rooms.find((item) => item.id === id);
  if (!r || state.joined[id] || r.now >= r.max) return;
  r.now += 1;
  state.joined[id] = true;
  renderRooms();
  showToast("'" + r.title + "' 방에 들어갔어요");
}

// I7: 친구 초대 (복사는 시도만, 실패해도 토스트)
function inviteFriend() {
  const link = "https://nooni.app/invite/minji";
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).catch(() => {});
    }
  } catch (e) { /* 복사가 안 돼도 괜찮아요 */ }
  showToast("초대 링크를 복사했어요");
}

/* ---------- 10. 랭킹 (I8) ---------- */
function rankRow(rank, p) {
  const medal = rank <= 3 ? " r" + rank : "";
  return `
    <li class="rank-row ${p.me ? "is-me" : ""}">
      <span class="rank num${medal}">${rank}</span>
      <div class="rank-body">
        <p class="rank-name">${p.name}${p.me ? '<span class="me-tag">나</span>' : ""}</p>
        <p class="rank-dept">${p.dept}</p>
      </div>
      <span class="rank-xp num">${fmt(p.xp)} XP</span>
    </li>`;
}

function renderRanking() {
  const list = ranking[state.rankScope];
  $("rank-list").innerHTML = list.map((p, i) => rankRow(i + 1, p)).join("");

  // 내가 5위 안에 없으면 구분선 뒤에 내 순위 표시
  const meInList = list.some((p) => p.me);
  if (!meInList && state.rankScope === "전체") {
    const my = ranking.myAllRank;
    $("rank-me").innerHTML = `
      <p class="rank-me-sep">내 순위 ${my.rank}위</p>
      <ol class="list">${rankRow(my.rank, { name: user.name, dept: user.dept, xp: my.xp, me: true })}</ol>`;
  } else {
    $("rank-me").innerHTML = "";
  }

  // 탭 강조와 aria-selected 갱신
  document.querySelectorAll(".segment-btn").forEach((btn) => {
    const on = btn.dataset.scope === state.rankScope;
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.tabIndex = on ? 0 : -1;
    if (on) $("rank-panel").setAttribute("aria-labelledby", btn.id);
  });
}

/* ---------- 11. 과목 바로가기 (I11) ---------- */
function renderCourses() {
  $("course-list").innerHTML = courses.map((c) => `
    <li>
      <button type="button" class="card course-card" data-course="${c.name}">
        <span class="course-strip" style="background:${c.color}" aria-hidden="true"></span>
        <span class="course-name">${c.name}</span>
        <span class="course-progress num">${c.progress}%</span>
        <span class="course-next">${c.next}</span>
      </button>
    </li>`).join("");
}

/* ---------- 12. 모달 (배경 클릭 · Esc · 닫기 버튼) ---------- */
let openModalEl = null;   // 지금 열린 모달
let returnFocusEl = null; // 닫힌 뒤 포커스를 돌려줄 버튼

function openModal(id, returnTo) {
  if (openModalEl) closeModal();
  openModalEl = $(id);
  returnFocusEl = returnTo || document.activeElement;
  openModalEl.hidden = false;
  // 첫 번째 주요 버튼에 포커스 (닫기 X 다음 버튼)
  const focusTarget = openModalEl.querySelector(".modal-actions .btn:last-child");
  if (focusTarget) focusTarget.focus();
}

function closeModal() {
  if (!openModalEl) return;
  openModalEl.hidden = true;
  openModalEl = null;
  if (returnFocusEl && document.contains(returnFocusEl) && !returnFocusEl.disabled) {
    returnFocusEl.focus();
  } else if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();    // 돌아갈 버튼이 사라졌으면 숨겨진 모달 버튼에 포커스가 남지 않게
  }
  returnFocusEl = null;
}

/* ---------- 13. 이벤트 연결 ---------- */
function bindEvents() {
  $("btn-start").addEventListener("click", openStartSheet);
  $("btn-sheet-go").addEventListener("click", finishLearning);
  $("btn-level").addEventListener("click", cycleLevel);
  $("btn-bonus").addEventListener("click", openBonus);

  // 퀘스트 목록은 다시 그려지므로 부모에서 클릭을 받음 (이벤트 위임)
  $("quest-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quest]");
    if (btn) completeQuest(btn.dataset.quest);
  });

  $("room-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-room]");
    if (btn) joinRoom(btn.dataset.room);
  });

  $("friend-row").addEventListener("click", (e) => {
    if (e.target.closest("#btn-invite")) inviteFriend();
  });

  // I8: 랭킹 탭 (클릭 + 좌우 화살표 키)
  const segBtns = document.querySelectorAll(".segment-btn");
  segBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.rankScope = btn.dataset.scope;
      renderRanking();
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const other = btn === segBtns[0] ? segBtns[1] : segBtns[0];
      state.rankScope = other.dataset.scope;
      renderRanking();
      other.focus();
    });
  });

  // I9: 하단 탭
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.remove("is-active");
        t.removeAttribute("aria-current");
      });
      tab.classList.add("is-active");
      tab.setAttribute("aria-current", "page");
      const name = tab.dataset.tab;
      if (name !== "홈") showToast("'" + name + "' 화면은 준비 중이에요");
    });
  });

  // I10: 알림 종
  $("btn-bell").addEventListener("click", () => {
    $("bell-dot").classList.add("is-hidden");
    $("btn-bell").setAttribute("aria-label", "알림");
    showToast("새 알림 2개: 박서준님이 대결을 신청했어요 외 1개");
  });

  // I11: 과목 카드
  $("course-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-course]");
    if (card) showToast("'" + card.dataset.course + "' 강의실로 이동해요");
  });

  // 모달: 배경·닫기·나중에·확인 버튼 (data-close)
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeModal();
    });
  });
  // 모달: Esc 키
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
    // 모달이 열려 있으면 Tab 포커스가 모달 안에서만 돌게 (뒤 화면으로 빠지지 않게)
    if (e.key === "Tab" && openModalEl) {
      const items = [...openModalEl.querySelectorAll(".modal-box button:not(:disabled)")];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !openModalEl.contains(document.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !openModalEl.contains(document.activeElement))) {
        e.preventDefault(); first.focus();
      }
    }
  });
}

/* ---------- 14. 시작 ---------- */
function init() {
  renderHeader();
  setXpBar((user.xp / user.xpMax) * 100, false);  // 첫 화면 약 83%
  renderToday();
  renderQuests();
  renderFriends();
  renderRooms();
  renderRanking();
  renderCourses();
  bindEvents();
}

init();
