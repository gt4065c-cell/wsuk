/* 루키 엔진 — 공통 도우미 (저장·글 다듬기·루키 말풍선·도움 3단계·끌기)
   모든 강이 함께 씁니다. 강별 내용은 content/lectureNN.json 에만 적습니다. */
window.RK = window.RK || {};
(function (RK) {
  'use strict';
  const SAVE_KEY = 'rk3.save.v1';
  const SET_KEY = 'rk3.settings.v1';
  const clone = o => JSON.parse(JSON.stringify(o));

  RK.$ = (s, r) => (r || document).querySelector(s);
  RK.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- 저장 (지금은 휴대폰 브라우저 안 localStorage만. 서버 연결은 다음 조각) ---------- */
  const DEFAULT_SAVE = {
    v: 1, name: '루키', lv: 0, xp: 0,
    cleared: {},          // { "1": { stars, at, plays } }
    cards: [],            // 받은 능력 카드 id
    notebook: {},         // 루키 규칙 수첩 { R1: { k, ok, rule, no, history:[{k,ok,rule,at,where}] } }
    records: [],          // 부품 기록 { id, firstTry, tries, sec, lecture } — 점수 아님, 맞춤학습 재료
    progress: null,       // { lecture, task, startedAt, notebookAtStart }
    review: {},           // 기억 다지기 { "1": { box:0~4, stars:0~4, due:날짜번호, hist:[] } } — 수료한 강마다 1·3·7·14일 뒤
    adapt: []             // 눈높이 갈림길 기록 { lec, task, kind:'easy'|'hard', miss, took, ok, at }
  };
  function read(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ? Object.assign(clone(def), v) : clone(def); }
    catch (e) { return clone(def); }
  }
  RK.state = read(SAVE_KEY, DEFAULT_SAVE);
  RK.settings = read(SET_KEY, { fast: false });
  RK.save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(RK.state)); } catch (e) { /* 저장 공간 없음: 진행은 계속 */ } };
  RK.saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(RK.settings)); } catch (e) { } };
  RK.resetAll = () => { localStorage.removeItem(SAVE_KEY); RK.state = clone(DEFAULT_SAVE); };
  RK.record = (id, firstTry, tries, sec) => {
    RK.state.records.push({ id, firstTry: !!firstTry, tries, sec: Math.round(sec || 0), lecture: RK.lectureNo || 0 });
    if (RK.state.records.length > 400) RK.state.records.splice(0, RK.state.records.length - 400);
  };

  /* ---------- 날짜 (기억 다지기용, 휴대폰 시계의 '날' 단위) ---------- */
  RK.now = () => Date.now();
  RK.dayNo = ms => { const t = ms == null ? RK.now() : ms; return Math.floor((t - new Date(t).getTimezoneOffset() * 60000) / 864e5); };
  RK.dayLabel = d => { const t = new Date(d * 864e5); return (t.getUTCMonth() + 1) + '월 ' + t.getUTCDate() + '일'; };

  /* ---------- 빠른 진행(연출 줄이기) ---------- */
  RK.applyFast = () => { document.body.classList.toggle('fast', !!RK.settings.fast); };
  RK.wait = ms => new Promise(r => setTimeout(r, RK.settings.fast ? Math.min(ms * 0.12, 90) : ms));

  /* ---------- 글 다듬기: {name} {rule:R1} 끼우기, | = 줄바꿈, *굵게* ---------- */
  RK.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  RK.fill = s => String(s == null ? '' : s)
    .replace(/\{name\}/g, RK.state.name || '루키')
    .replace(/\{rule:(\w+)\}/g, (m, k) => (RK.state.notebook[k] && RK.state.notebook[k].rule) || '(아직 없음)');
  RK.fmt = s => RK.esc(RK.fill(s)).replace(/\|/g, '<br>').replace(/\*([^*]+)\*/g, '<b>$1</b>');
  RK.plain = s => RK.fill(s).replace(/\|/g, ' ');

  /* ---------- 화면 칸 ---------- */
  RK.panel = h => { const p = RK.$('#panel'); p.innerHTML = h; RK.panelVer = (RK.panelVer || 0) + 1; return p; };
  RK.panelAdd = h => { const p = RK.$('#panel'); p.insertAdjacentHTML('beforeend', h); RK.panelVer = (RK.panelVer || 0) + 1; return p.lastElementChild; };
  RK.actions = h => { RK.$('#actions').innerHTML = h || ''; };
  RK.setTitle = (chip, name, concept) => {
    RK.$('#mtitle').innerHTML = '<span class="chip">' + RK.esc(chip) + '</span><span>' + RK.esc(name) + '</span>' +
      (concept ? '<span class="concept">' + RK.esc(concept) + '</span>' : '');
  };
  RK.toast = t => {
    const el = RK.$('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(RK.toast._t); RK.toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  };

  /* ---------- 루키 말풍선 + 표정 ---------- */
  RK.mood = m => {
    RK.curMood = m || 'normal';
    const svg = RK.$('#rkStage svg'); if (svg) RK.styleRk(svg, RK.curMood);
    const w = RK.$('#rkStage'); if (!w) return;
    w.classList.remove('hop', 'shake'); void w.offsetWidth;
    if (m === 'happy') w.classList.add('hop');
    if (m === 'confused') w.classList.add('shake');
  };
  RK.say = (t, m) => {
    if (!t) return;
    const b = RK.$('#bubble');
    RK.$('#btext').innerHTML = RK.fmt(t);
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    RK.mood(m || 'normal');
    RK.lastSay = RK.plain(t);
  };
  RK.sayObj = o => { if (!o) return; if (typeof o === 'string') RK.say(o); else RK.say(o.t, o.m); };

  /* ---------- 사람 입력 기다림 신호 (화면 점검·자동 시험이 읽음) ---------- */
  RK.screens = [];
  RK.signal = (type, meta) => {
    RK.cur = { type, meta: meta || null };
    document.body.dataset.step = type;
    document.body.dataset.seq = String((+document.body.dataset.seq || 0) + 1);
    const p = RK.$('#panel');
    const visual = !!(p && p.querySelector('.vis, .card, .nbook, .log, .complaint, .swcard, svg'));
    RK.screens.push({ type, panel: RK.panelVer || 0, visual, at: Date.now() });
  };

  /* 아래 행동칸 버튼 하나 */
  RK.act = (label, cls, meta) => new Promise(res => {
    RK.actions('<button class="btn ' + (cls || 'primary') + '" id="actBtn">' + RK.fmt(label) + '</button>');
    RK.signal((meta && meta.kind) || 'talk', meta);
    RK.$('#actBtn').onclick = () => { RK.actions(''); res(); };
  });

  RK.nope = el => { if (!el) return; el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); setTimeout(() => el.classList.remove('nope'), 700); };
  RK.hintMe = el => { if (!el) return; el.classList.remove('hintme'); void el.offsetWidth; el.classList.add('hintme'); setTimeout(() => el.classList.remove('hintme'), 3200); };
  RK.buzz = () => { try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { } };

  /* ---------- 도움 3단계 (틀림 1: 그 보기 전용 힌트 → 2: 직접 힌트 + 자리 표시 → 3: 같이 하기) ---------- */
  RK.HELP_DEFAULT = ['음… 그건 아닌 것 같아요.|다시 봐 주세요.', '노랗게 깜빡이는 곳을|봐 주세요!', '같이 해 봐요!|제가 옮길게요.'];
  RK.miss = 0; // 지금 업무에서 틀린 횟수 (눈높이 갈림길: 2번 이상 → 쉬운 예시, 0번 → 도전 업무 제안)
  RK.helpStep = (n, fb, hint2, target) => {
    RK.miss++;
    if (n === 1) { RK.say(fb || RK.HELP_DEFAULT[0], 'confused'); return false; }
    if (n === 2) { RK.say(hint2 || RK.HELP_DEFAULT[1], 'think'); RK.hintMe(target); return false; }
    RK.say(RK.HELP_DEFAULT[2], 'happy'); return true; // 3번째: 같이 하기
  };

  /* ---------- 끌어다 놓기 (누르고-누르기도 가능, 8px 넘게 움직여야 끌기) ---------- */
  RK.dragSetup = (items, zones, onDrop) => {
    let selected = null;
    const zoneAt = (x, y) => zones.find(z => { const r = z.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
    const clearHot = () => zones.forEach(z => z.classList.remove('hot'));
    items.forEach(it => {
      let sx = 0, sy = 0, dragging = false, pid = null;
      it.addEventListener('pointerdown', e => {
        if (it.classList.contains('used')) return;
        pid = e.pointerId; sx = e.clientX; sy = e.clientY; dragging = false;
        try { it.setPointerCapture(pid); } catch (_) { }
      });
      it.addEventListener('pointermove', e => {
        if (pid !== e.pointerId) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!dragging && Math.hypot(dx, dy) > 8) { dragging = true; it.classList.add('dragging'); if (selected) { selected.classList.remove('sel'); selected = null; } }
        if (dragging) {
          it.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.04)';
          clearHot(); const z = zoneAt(e.clientX, e.clientY); if (z) z.classList.add('hot');
        }
      });
      const end = (e, cancel) => {
        if (pid !== e.pointerId) return;
        pid = null; it.classList.remove('dragging'); it.style.transform = ''; clearHot();
        if (cancel) return;
        if (dragging) { const z = zoneAt(e.clientX, e.clientY); if (z) onDrop(it, z); }
        else {
          if (selected === it) { it.classList.remove('sel'); selected = null; }
          else { if (selected) selected.classList.remove('sel'); selected = it; it.classList.add('sel'); }
        }
      };
      it.addEventListener('pointerup', e => end(e, false));
      it.addEventListener('pointercancel', e => end(e, true));
      it.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (selected) selected.classList.remove('sel'); selected = it; it.classList.add('sel'); } });
    });
    zones.forEach(z => z.addEventListener('click', () => {
      if (selected) { const s = selected; s.classList.remove('sel'); selected = null; onDrop(s, z); }
      else RK.toast('먼저 카드를 누르거나, 끌어다 놓아 주세요');
    }));
  };

  /* 루키 규칙 수첩에 적기 */
  RK.writeNote = (key, opt, where) => {
    const nb = RK.state.notebook;
    const prev = nb[key];
    const entry = { k: opt.k, ok: !!opt.ok, rule: opt.rule || opt.t, no: opt.no || (prev && prev.no) || Object.keys(nb).length + 1, apply: opt.apply || null, lec: RK.lectureNo || (prev && prev.lec) || 0 };
    entry.history = (prev && prev.history ? prev.history : []).concat([{ k: opt.k, ok: !!opt.ok, rule: entry.rule, where: where || '', at: Date.now() }]);
    nb[key] = entry;
    RK.save();
    RK.renderNotebook(key);
  };
  RK.noteOk = key => !!(RK.state.notebook[key] && RK.state.notebook[key].ok);

  /* 수첩 그림 (작업판 위 노란 쪽지). 학습자가 고른 규칙 글만 보여 줌 — 맞음/틀림 표시는 하지 않음 */
  RK.notebookHTML = () => {
    const L = RK.lecture; const slots = (L && L.notebook) || [];
    const nb = RK.state.notebook;
    const lis = slots.map(s => {
      const n = nb[s.key];
      return '<li data-note="' + s.key + '" class="' + (n ? '' : 'empty') + '"><span class="no">' + s.no + '.</span><span>' +
        (n ? RK.esc(n.rule) : RK.esc(s.empty || '아직 비어 있어요')) + '</span></li>';
    }).join('');
    return '<div class="nbook vis" id="nbook"><div class="lbl">📒 ' + RK.esc(RK.state.name) + '의 업무 수첩 <span class="r">팀장이 가르친 대로 일해요</span></div><ol>' + lis + '</ol></div>';
  };
  RK.renderNotebook = fresh => {
    const el = RK.$('#nbook'); if (!el) return;
    el.outerHTML = RK.notebookHTML();
    if (fresh) { const li = RK.$('#nbook li[data-note="' + fresh + '"]'); if (li) li.classList.add('fresh'); }
  };
})(window.RK);
