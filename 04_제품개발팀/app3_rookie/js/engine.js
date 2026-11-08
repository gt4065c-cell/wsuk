/* 스테이지 엔진 — 한 강 = 입구 → 도입 대화 → 업무 2~5개 → 업무 평가 3문제 → 보상·지도 (디자인 규격 2장)
   강 내용은 content/lectureNN.json 만 읽습니다. 새 강 = JSON 파일 하나 추가 + course.json 에 번호 등록 */
(function (RK) {
  'use strict';
  const $ = RK.$, $$ = RK.$$, esc = RK.esc, fmt = RK.fmt;

  RK.loadJSON = async url => {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' 을(를) 읽지 못했어요 (' + r.status + ')');
    return r.json();
  };
  const pad = n => String(n).padStart(2, '0');
  RK.loadLecture = n => RK.loadJSON('content/lecture' + pad(n) + '.json');

  /* ---------- 상단 막대 ---------- */
  RK.hud = () => {
    const L = RK.lecture; if (!L) return;
    const total = L.tasks.length + 2; // 도입 + 업무들 + 평가
    $('#hudLv').textContent = 'Lv.' + RK.state.lv;
    $('#hudTitle').textContent = L.lecture + '강 진행';
    $('#hudXp').textContent = 'XP ' + RK.state.xp;
    const got = (L.cards || []).filter(c => RK.run && RK.run.cards.includes(c.id)).length;
    $('#hudCards').textContent = '🃏 ' + got + '/' + (L.cards || []).length;
    $('#hudBar').style.width = Math.round(((RK.run && RK.run.unit) || 0) / total * 100) + '%';
    $('#fastBtn').setAttribute('aria-pressed', RK.settings.fast ? 'true' : 'false');
  };
  RK.toggleFast = () => {
    RK.settings.fast = !RK.settings.fast; RK.saveSettings(); RK.applyFast(); RK.hud();
    RK.toast(RK.settings.fast ? '빠른 진행 켬 — 연출과 분위기 대사를 줄여요' : '빠른 진행 끔 — 연출을 모두 보여 줘요');
    const sw = $('#fastSwitch'); if (sw) sw.setAttribute('aria-checked', RK.settings.fast ? 'true' : 'false');
  };

  /* ---------- 능력 카드 ---------- */
  RK.cardHTML = (c, extra) => '<div class="abil ' + (c.c || 'c1') + (c.grade === 'core' ? ' core' : '') + '"><div class="abil-top"><span class="abil-ico" aria-hidden="true">' + (c.icon || '🃏') + '</span><span class="abil-rar">' + (c.grade === 'core' ? '핵심 카드' : '업무 카드') + '</span></div>' +
    '<div class="abil-name">' + esc(c.name) + '</div><div class="abil-sub">' + esc(c.sub || '') + '</div>' +
    '<ul>' + (c.pts || []).map(p => '<li>' + fmt(p) + '</li>').join('') + '</ul>' + (c.src ? '<div class="abil-src src">근거: 강의대본 ' + esc(c.src) + '줄</div>' : '') + (extra || '') + '</div>';

  RK.cardGet = (card, xp) => new Promise(res => {
    const ov = $('#overlay');
    ov.innerHTML = '<div class="lvup" role="dialog" aria-label="업무 완료"><div class="lv-title" style="font-size:28px">업무 완료</div><div class="lv-from">능력 카드 획득' + (xp ? ' · <b style="font-size:18px">+' + xp + ' XP</b>' : '') + '</div>' +
      RK.cardHTML(card) + '<button class="btn gold" id="cardBtn">카드 받기 ✓</button></div>';
    ov.classList.remove('hidden'); ov.scrollTop = 0;
    RK.signal('card', { card });
    $('#cardBtn').onclick = () => { ov.classList.add('hidden'); ov.innerHTML = ''; res(); };
  });

  /* ---------- 한 강 실행 ---------- */
  RK.runLecture = async (L, fromTask) => {
    RK.lecture = L; RK.lectureNo = L.lecture;
    const st = RK.state;
    const resuming = fromTask > 0 && st.progress && st.progress.lecture === L.lecture;
    if (!resuming) {
      // 이 강을 새로 시작: 이 강 수첩 칸은 비우고 다시 가르침 (다른 강 수첩은 그대로)
      (L.notebook || []).forEach(s => { delete st.notebook[s.key]; });
      st.progress = { lecture: L.lecture, task: -1, startedAt: Date.now(), cards: [] };
      fromTask = 0;
    }
    RK.run = { unit: fromTask ? fromTask + 1 : 0, cards: st.progress.cards || [], t0: Date.now() };
    RK.save();
    $('#home').classList.add('hidden'); $('#final').classList.add('hidden'); $('#game').classList.remove('hidden');
    $('#rkStage').innerHTML = RK.rookieSVG(RK.stageFor(st.lv), 'normal');
    $('#bubble .who').textContent = st.name;
    RK.hud(); window.scrollTo(0, 0);

    if (!resuming) {
      RK.setTitle(L.introTitle || '출근', L.introName || '첫 인사', '');
      await RK.runSteps(L.intro || []);
      RK.run.unit = 1; RK.hud();
    }
    for (let i = fromTask; i < L.tasks.length; i++) {
      const T = L.tasks[i];
      st.progress.task = i; RK.save();
      RK.setTitle('업무 ' + (i + 1) + '/' + L.tasks.length, T.name, T.concept);
      RK.panel('');
      window.scrollTo(0, 0);
      RK.miss = 0;
      await RK.runSteps(T.steps);
      const miss = RK.miss;
      const card = (L.cards || []).find(c => c.id === T.card);
      if (card) {
        await RK.cardGet(card, L.taskXp || 30);
        st.xp += (L.taskXp || 30);
        if (!st.cards.includes(card.id)) st.cards.push(card.id);
        if (!RK.run.cards.includes(card.id)) RK.run.cards.push(card.id);
        st.progress.cards = RK.run.cards;
      }
      RK.run.unit = i + 2; st.progress.task = i + 1; RK.save(); RK.hud();
      // 눈높이 갈림길: 이 업무에서 2번 이상 틀림 → 다음 업무 앞에 쉬운 예시 / 한 번도 안 틀림 → 도전 업무 제안
      if (T.easy && miss >= (L.easyAt || 2)) await RK.showEasy(L, T, miss);
      else if (T.hard && miss === 0) await RK.offerHard(L, T);
    }
    const stars = await RK.runExam(L);
    RK.run.unit = L.tasks.length + 2; RK.hud();
    await RK.finishLecture(L, stars);
  };

  /* ---------- 눈높이 갈림길 ---------- */
  const adaptLog = o => { const st = RK.state; st.adapt = st.adapt || []; st.adapt.push(Object.assign({ lec: RK.lectureNo, at: RK.now() }, o)); if (st.adapt.length > 200) st.adapt.splice(0, st.adapt.length - 200); RK.save(); };
  RK.showEasy = async (L, T, miss) => {
    const E = T.easy;
    RK.setTitle('쉬운 예시', E.title || T.name, '눈높이 맞춤');
    RK.panel('<div class="card vis easy" id="easyCard"><div class="lbl">💡 쉬운 예시 한 장면 <span class="r">' + esc(T.name) + '</span></div>' +
      '<ul class="easylines">' + (E.lines || []).map(l => '<li>' + fmt(l) + '</li>').join('') + '</ul>' +
      (E.src ? '<div class="note src">근거: 강의대본 ' + esc(E.src) + '줄</div>' : '') + '</div>');
    window.scrollTo(0, 0);
    RK.sayObj(E.say || { t: '헷갈렸죠?|쉬운 예로 볼게요.', m: 'think' });
    adaptLog({ task: T.id, kind: 'easy', miss });
    await RK.act(E.btn || '이해했어요 ▶', 'primary', { kind: 'easy', task: T.id });
  };
  RK.offerHard = async (L, T) => {
    const H = T.hard, st = RK.state;
    RK.setTitle('도전 업무', T.name, '선택');
    RK.panel('<div class="card vis hardoffer" id="hardCard"><div class="lbl">🔥 도전 업무 (선택) <span class="r">+10 XP</span></div>' +
      '<p>첫 시도에 모두 맞혔어요. 한 문제만 더 어렵게 풀어 볼까요? 건너뛰어도 잃는 것은 없어요.</p></div>');
    window.scrollTo(0, 0);
    RK.say(H.offerSay || '팀장님, 한 단계|어려운 것도 해 볼까요?', 'happy');
    const go = await new Promise(res => {
      RK.actions('<button class="btn gold" id="hardGo">🔥 도전해 볼게요</button><button class="btn ghost" id="hardSkip">다음으로 넘어가기</button>');
      RK.signal('offer', { task: T.id });
      $('#hardGo').onclick = () => { RK.actions(''); res(true); };
      $('#hardSkip').onclick = () => { RK.actions(''); res(false); };
    });
    if (!go) { adaptLog({ task: T.id, kind: 'hard', took: false }); return; }
    RK.panel('<div class="card vis quiz" id="hardQ"><div class="qno">🔥 도전 업무</div><div class="qtext">' + fmt(H.q) + '</div><div id="hexp"></div></div>');
    RK.sayObj(H.say || { t: '어려운 문제예요.|천천히 골라 주세요.', m: 'think' });
    const t0 = Date.now();
    const r = await RK.choose({ opts: H.opts, hint2: H.hint2, fbDefault: H.fbDefault, type: 'pick', meta: { step: { id: T.id + '-hard' }, hard: true } });
    RK.record(T.id + '-hard', r.firstTry, r.tries, (Date.now() - t0) / 1000);
    $('#hexp').innerHTML = '<div class="exp" role="status">' + (r.firstTry ? '✓ 첫 선택 정답. ' : '✓ 같이 찾았어요. ') + fmt(H.e) + (H.src ? '<span class="note" style="display:block">근거: 강의대본 ' + esc(H.src) + '줄</span>' : '') + '</div>';
    st.xp += 10; RK.save(); RK.hud();
    RK.say(r.firstTry ? '도전 성공!|+10 XP 받았어요.' : '어려웠죠?|+10 XP는 그대로예요.', 'happy');
    adaptLog({ task: T.id, kind: 'hard', took: true, ok: r.firstTry });
    await RK.act('계속하기 ▶', 'primary', { kind: 'talk' });
  };

  /* ---------- 업무 평가 3문제 (별 = 첫 선택만) ---------- */
  RK.runExam = async L => {
    let stars = 0; const miss = [];
    RK.panel('');
    for (let i = 0; i < L.exam.length; i++) {
      const q = L.exam[i];
      RK.setTitle('평가', '업무 평가 ' + (i + 1) + '/' + L.exam.length, q.newCase ? '새 사례' : (L.lecture + '강 문제'));
      RK.panel(''); window.scrollTo(0, 0);
      if (q.scene) await RK.runSteps(q.scene);
      RK.panelAdd('<div class="card quiz vis" id="quizCard"><div class="qno">📋 업무 평가 ' + (i + 1) + '/' + L.exam.length + (q.newCase ? '<span class="newcase">★ 새 사례</span>' : '') + '</div>' +
        '<div class="qtext">' + fmt(q.q) + '</div>' +
        q.c.map((t, j) => '<button class="choice" data-j="' + j + '"><span class="mk">' + 'ABCD'[j] + '</span><span>' + fmt(t) + '</span></button>').join('') + '<div id="qexp"></div></div>');
      RK.actions('');
      RK.sayObj(q.say || (L.examSay && L.examSay[i]));
      const t0 = Date.now();
      const j = await new Promise(res => {
        const bs = $$('#quizCard .choice');
        RK.signal('exam', { q, i });
        bs.forEach(b => b.onclick = () => { bs.forEach(x => x.disabled = true); res(+b.dataset.j); });
      });
      const bs = $$('#quizCard .choice');
      const right = j === q.a;
      bs[q.a].classList.add('ok'); bs[q.a].querySelector('.mk').textContent = '✓';
      let h = '<div class="exp" role="status">' + (right ? '✓ 첫 선택 정답. ' : '✗ 첫 선택 오답 — 정답은 ' + 'ABCD'[q.a] + '. ') + fmt(q.e);
      if (right) { stars++; RK.say(q.okSay || '정답이에요.|근거까지 기억할게요.', 'happy'); }
      else {
        bs[j].classList.add('bad'); bs[j].querySelector('.mk').textContent = '✗';
        if (j === q.cw && q.w) h += '<span class="warn">💡 자주 하는 실수: ' + fmt(q.w) + '</span>';
        RK.say(q.badSay || '해설을 같이 보고|기억해 둘게요.', 'confused');
        miss.push(q);
      }
      h += (q.src ? '<span class="note" style="display:block">근거: 강의대본 ' + esc(q.src) + '</span>' : '') + '</div>';
      $('#qexp').innerHTML = h;
      RK.record(q.id, right, 1, (Date.now() - t0) / 1000);
      setTimeout(() => { const e = $('#qexp'); if (e && e.scrollIntoView) e.scrollIntoView({ behavior: RK.settings.fast ? 'auto' : 'smooth', block: 'nearest' }); }, 50);
      if (q.after) {
        await RK.act(q.afterLabel || '{name}에게 맡겨 보기 ▶', 'primary', { kind: 'go' });
        await RK.runSteps(q.after);
      }
      await RK.act(i < L.exam.length - 1 ? '다음 문제 ▶' : '평가 결과 보기 ▶', 'primary', { kind: 'talk' });
    }
    // 결과: 칭찬 대신 결과 피드백
    RK.setTitle('평가', '평가 결과', '첫 선택 기준');
    RK.panel('<div class="card vis" style="text-align:center"><div class="lbl" style="justify-content:center">평가 결과 (처음 고른 답만 별로 기록)</div>' +
      '<div style="font-size:30px;font-weight:900;color:#FFD166">' + '★'.repeat(stars) + '☆'.repeat(L.exam.length - stars) + '</div>' +
      '<div style="font-weight:800;font-size:17px;margin-top:4px">' + stars + ' / ' + L.exam.length + ' 첫 선택 정답</div>' +
      (miss.length ? '<div class="note" style="text-align:left">↺ 복습 추천: ' + miss.map(q => esc(q.topic || q.id)).join(' · ') + '</div>' : '<div class="note">놓친 문제 없음</div>') + '</div>');
    const fbk = (L.examResult || {})[String(stars)] || (stars === L.exam.length ? '세 문제 모두 첫 선택 정답.|수료 처리할게요.' : '수료는 됐어요.|놓친 부분은 복습해요.');
    if (typeof fbk === 'string') RK.say(fbk, stars >= 2 ? 'happy' : 'normal'); else RK.sayObj(fbk);
    await RK.act('수료 처리 ▶', 'primary', { kind: 'talk' });
    return stars;
  };

  /* ---------- 강 끝: LEVEL UP(Lv = 수료한 강 수) → 승진(겉모습) → 결과 화면 ---------- */
  RK.finishLecture = async (L, stars) => {
    const st = RK.state;
    const prev = st.cleared[L.lecture];
    const firstClear = !prev;
    const fromLv = st.lv, fromStage = RK.stageFor(st.lv);
    if (firstClear) st.lv = Object.keys(st.cleared).length + 1;
    st.cleared[L.lecture] = { stars, best: Math.max(stars, prev ? prev.best || 0 : 0), at: Date.now(), plays: (prev ? prev.plays || 1 : 0) + 1, minutes: Math.round((Date.now() - RK.run.t0) / 6000) / 10 };
    st.progress = null;
    // 기억 다지기 예약: 처음 수료한 날 기준 1·3·7·14일 뒤
    st.review = st.review || {};
    if (!st.review[L.lecture]) st.review[L.lecture] = { box: 0, stars: 0, due: RK.dayNo() + RK.REVIEW_DAYS[0], hist: [] };
    RK.save();
    const toStage = RK.stageFor(st.lv);
    if (firstClear) {
      await new Promise(res => {
        const ov = $('#overlay');
        let conf = '';
        if (!RK.settings.fast) { const cols = ['#FFD166', '#4FE3C1', '#8B7BFF', '#5AA8FF', '#FF8A5B']; for (let i = 0; i < 26; i++) conf += '<i style="left:' + (Math.random() * 100) + '%;background:' + cols[i % 5] + ';animation-delay:' + (Math.random() * 0.8).toFixed(2) + 's"></i>'; }
        const core = (L.cards || []).find(c => c.grade === 'core');
        ov.innerHTML = '<div class="lvup" role="dialog" aria-label="레벨 업"><div class="confetti">' + conf + '</div>' +
          '<div class="lv-title">LEVEL UP!</div><div class="lv-from">' + L.lecture + '강 수료 · Lv.' + fromLv + ' → <b>Lv.' + st.lv + '</b></div>' +
          (toStage !== fromStage
            ? '<div class="promo"><div class="p">' + RK.rookieSVG(fromStage, 'normal') + '<div>' + RK.STAGES[fromStage].name + '</div></div><div class="arrow" aria-hidden="true">▶</div><div class="p">' + RK.rookieSVG(toStage, 'happy') + '<div>' + RK.STAGES[toStage].name + '</div></div></div>' +
              '<div class="note" style="text-align:center">새 장식: <b>' + esc(RK.STAGES[toStage].deco) + '</b> · 직급 ' + esc(RK.rankFor(st.lv)) + '</div>'
            : '<div class="rkbig">' + RK.rookieSVG(toStage, 'happy') + '</div>') +
          (core ? RK.cardHTML(core) : '') +
          '<button class="btn gold" id="lvBtn">결과 보기 ▶</button></div>';
        ov.classList.remove('hidden'); ov.scrollTop = 0;
        RK.signal('levelup', {});
        $('#lvBtn').onclick = () => { ov.classList.add('hidden'); ov.innerHTML = ''; res(); };
      });
    }
    RK.showFinal(L, stars, firstClear);
  };

  /* ---------- 30강 지도 — A안 루키 회사 빌딩 (층 = 부, 방 = 강) ---------- */
  RK.mapHTML = () => {
    const C = RK.course, st = RK.state;
    const nextLec = Math.min(st.lv + 1, 30);
    const promoSet = new Set(C.promoLectures || []);
    return '<div class="bld" aria-label="30강 지도">' + C.parts.map(p => {
      const locked = nextLec < p.a;
      let rooms = '';
      for (let n = p.a; n <= p.b; n++) {
        const c = st.cleared[n];
        const ready = (C.ready || []).includes(n);
        const cls = c ? 'done' : (n === nextLec ? 'now' : '');
        const lab = c ? n + '강 수료' : (n === nextLec ? n + '강 지금 할 강' + (ready ? '' : ' (준비 중)') : n + '강 잠김');
        rooms += '<div class="roomwrap"><div class="room ' + cls + (promoSet.has(n) ? ' promo' : '') + '" role="img" aria-label="' + lab + '">' + (c ? '✓' + n : n === nextLec ? '◎' + n : '🔒') + '</div>' +
          (c ? '<span class="st" aria-hidden="true">' + '★'.repeat(c.best || 0) + '☆'.repeat(3 - (c.best || 0)) + '</span>' : (n === nextLec ? '<span class="st">' + (ready ? '여기!' : '준비 중') + '</span>' : '<span class="st" aria-hidden="true">' + n + '</span>')) + '</div>';
      }
      return '<div class="floor' + (locked ? ' locked' : '') + '"><div class="floor-n">' + (locked ? '🔒 ' : '') + p.n + '층 · ' + esc(p.name) + '<span class="rank">' + esc(p.rank) + '</span></div><div class="rooms">' + rooms + '</div></div>';
    }).join('') + '</div><div class="map-legend">✓ 수료 · ◎ 지금 할 강 · 🔒 잠김 · 굵은 테두리 = 승진 강 · 별은 내 화면에만</div>';
  };

  /* ---------- 결과 화면 ---------- */
  RK.starsHTML = (n, of) => '★'.repeat(n) + '<span style="opacity:.35">' + '☆'.repeat((of || 3) - n) + '</span>' + '<span class="sr"> (' + n + '/' + (of || 3) + ')</span>';
  RK.rkCardHTML = (L, stars) => {
    const st = RK.state;
    return '<div class="rkcard"><div class="rkc-top"><div class="rkm">' + RK.rookieSVG(RK.stageFor(st.lv), 'happy') + '</div><div>' +
      '<div class="rkc-name">' + esc(st.name) + '</div><span class="rkc-lv">' + esc(RK.statusText(st.lv)) + '</span>' +
      '<div class="rkc-stars">업무 평가 ' + RK.starsHTML(stars) + '</div></div></div>' +
      '<div class="rkc-line"><small>오늘 배운 한 줄</small>' + fmt(L.oneLine) + '</div>' +
      '<div class="rkc-cards">' + (L.cards || []).map(c => '<span class="' + c.c + '">' + c.icon + '<b>' + esc(c.name) + '</b></span>').join('') + '</div></div>';
  };
  RK.historyHTML = L => {
    const nb = RK.state.notebook;
    return '<div class="nbook vis history"><div class="lbl">📒 내가 가르친 업무 수첩</div><ol>' + (L.notebook || []).map(s => {
      const n = nb[s.key]; if (!n) return '';
      const h = n.history || [];
      const fixed = h.length > 1;
      return '<li><span class="no">' + s.no + '.</span><span>' + esc(n.rule) + (fixed ? '<small>처음엔 "' + esc(h[0].rule) + '" → ' + esc(h[h.length - 1].where || '다시 가르침') + '</small>' : '<small>처음 가르친 그대로</small>') + '</span></li>';
    }).join('') + '</ol></div>';
  };
  RK.showFinal = (L, stars, firstClear) => {
    $('#game').classList.add('hidden'); $('#home').classList.add('hidden');
    const f = $('#final'); f.classList.remove('hidden');
    const st = RK.state;
    const next = L.lecture + 1, nextReady = (RK.course.ready || []).includes(next);
    f.innerHTML = '<div class="fin-h">' + L.lecture + '강 수료</div><div class="fin-s">' + esc(RK.statusText(st.lv)) + (firstClear ? '' : ' · 다시 하기 기록') + '</div>' +
      RK.rkCardHTML(L, stars) +
      '<div class="fin-btns"><button class="btn gold" id="shareBtn">📤 내 루키 카드 미리 보기</button></div>' +
      (st.review && st.review[L.lecture] && st.review[L.lecture].box < 4 ? '<div class="note memnote">🧠 기억 다지기 예약: ' + RK.dayLabel(st.review[L.lecture].due) + ' ' + L.lecture + '강 복습 2문제 (사무실에서 알려 줘요)</div>' : '') +
      '<div class="sec-h">📒 가르친 규칙</div>' + RK.historyHTML(L) +
      '<div class="sec-h">🗺️ 30강 지도 <small>' + Object.keys(st.cleared).length + '/30강 수료</small></div>' + RK.mapHTML() +
      '<div class="sec-h">👥 다음에 만날 팀원 루키</div>' + RK.W.team({ t: '내 수첩대로 일하는 루키가|팀원 루키를 만나요', s: '팀 연결·도전장은 다음 업데이트 (지금은 예시)' }) +
      '<div class="sec-h">📝 오늘의 미션</div><div class="mission">' + fmt(L.mission.t) + '<small>' + fmt(L.mission.ex || '') + '</small></div>' +
      '<div class="fin-btns"><button class="btn ' + (nextReady ? 'primary' : 'ghost') + '" id="nextBtn"' + (nextReady ? '' : ' aria-disabled="true"') + '>' + (nextReady ? next + '강 시작하기 ▶' : '🔒 ' + next + '강 (준비 중)') + '</button>' +
      '<button class="btn ghost" id="againBtn">↺ ' + L.lecture + '강 처음부터 다시 하기</button><button class="btn ghost" id="homeBtn">🏢 사무실로</button></div>';
    window.scrollTo(0, 0);
    RK.signal('final', { stars });
    $('#shareBtn').onclick = RK.openShare.bind(null, L, stars);
    $('#nextBtn').onclick = () => { if (nextReady) location.href = '?lecture=' + next; else RK.toast(next + '강은 다음 조각에서 열려요'); };
    $('#againBtn').onclick = () => RK.startLecture(L.lecture, 0);
    $('#homeBtn').onclick = () => { location.href = location.pathname + '?office=1'; };
  };
  RK.openShare = (L, stars) => {
    const ov = $('#overlay');
    ov.innerHTML = '<div class="lvup" role="dialog" aria-label="루키 카드"><h3 style="margin-bottom:10px">오늘의 루키 카드</h3>' + RK.rkCardHTML(L, stars) +
      '<p class="note" style="text-align:center">실명·점수 없이 루키 이름만 들어가요. 실제로 단톡방에 보내기는 출시 때 결재 후 켭니다.</p>' +
      '<div style="height:10px"></div><button class="btn ghost" id="closeShare">닫기</button></div>';
    ov.classList.remove('hidden');
    $('#closeShare').onclick = () => { ov.classList.add('hidden'); ov.innerHTML = ''; };
  };

  /* ---------- 사무실(홈) = 다음 강 입구 ---------- */
  RK.showHome = L => {
    const st = RK.state;
    $('#game').classList.add('hidden'); $('#final').classList.add('hidden');
    const h = $('#home'); h.classList.remove('hidden');
    const prog = st.progress && st.progress.lecture === L.lecture && st.progress.task >= 0 ? st.progress : null;
    const cleared = st.cleared[L.lecture];
    const canName = L.askName && !Object.keys(st.cleared).length && !prog;
    h.innerHTML = '<div class="badge-day">' + L.lecture + '강 · ' + esc(L.title) + '</div>' +
      '<h1>오늘 루키에게<br>가르칠 일은 <em>\'' + esc(L.teach) + '\'</em></h1>' +
      '<p class="sub">' + fmt(L.cover || '당신은 교육팀 팀장. 신입 AI에게 일을 가르쳐요.') + '</p>' +
      '<div class="intro-rk">' + RK.rookieSVG(RK.stageFor(st.lv), 'normal') + '</div>' +
      (canName ? '<div class="namebox"><label for="rkName">내 루키 이름 (8자 이내, 실명 말고 별명)</label><input id="rkName" maxlength="8" autocomplete="off" value="' + esc(st.name) + '"><div class="err" id="nameErr" role="alert"></div></div>' : '') +
      '<div class="idcard"><div class="row"><span>내 루키</span><b>' + esc(st.name) + ' · ' + esc(RK.statusText(st.lv)) + '</b></div>' +
      '<div class="row"><span>오늘 할 일</span><b>업무 ' + L.tasks.length + '개 + 평가 ' + L.exam.length + '문제</b></div>' +
      '<div class="row"><span>걸리는 시간</span><b>약 ' + L.minutes + '분</b></div>' +
      '<div class="row"><span>친구 소식</span><b>팀 연결 전 (다음 업데이트)</b></div>' +
      (cleared ? '<div class="row"><span>지난 기록</span><b>수료 ✓ · 최고 ' + '★'.repeat(cleared.best || 0) + '☆'.repeat(3 - (cleared.best || 0)) + '</b></div>' : '') + '</div>' +
      '<button class="switch" id="fastSwitch" role="switch" aria-checked="' + (RK.settings.fast ? 'true' : 'false') + '"><span>⏩ 빠른 진행 (연출 줄이기)<small>분위기 대사·움직임을 줄여요</small></span><span class="knob" aria-hidden="true"></span></button>' +
      '<div class="home-btns">' + (prog
        ? '<button class="btn primary" id="startBtn">업무 ' + (prog.task + 1) + '부터 이어 하기 ▶</button><button class="btn ghost" id="restartBtn">처음부터</button>'
        : '<button class="btn primary" id="startBtn">' + (cleared ? '↺ ' + L.lecture + '강 다시 하기' : '팀장으로 출근하기 ▶') + '</button>') + '</div>' +
      (Object.keys(st.cleared).length ? '<div class="sec-h" style="align-self:stretch">🗺️ 30강 지도</div><div style="align-self:stretch;text-align:left">' + RK.mapHTML() + '</div>' : '') +
      (Object.keys(st.cleared).length ? '<button class="btn ghost" id="officeBtn" style="margin-top:12px">🏢 루키 사무실로</button>' : '') +
      '<button class="linkbtn" id="wipeBtn">이 휴대폰의 기록 지우기</button>';
    const ob = $('#officeBtn'); if (ob) ob.onclick = () => { location.href = location.pathname + '?office=1'; };
    $('#fastSwitch').onclick = RK.toggleFast;
    $('#wipeBtn').onclick = () => { if (confirm('이 휴대폰에 저장된 루키 기록을 모두 지울까요?')) { RK.resetAll(); location.href = location.pathname; } };
    const start = from => {
      if (canName) {
        const v = ($('#rkName').value || '').trim() || '루키';
        if (/[@]|\d{3,}|https?:/i.test(v)) { $('#nameErr').textContent = '전화번호·이메일 모양은 쓸 수 없어요. 별명으로 지어 주세요.'; return; }
        st.name = v.slice(0, 8); RK.save();
      }
      RK.startLecture(L.lecture, from);
    };
    $('#startBtn').onclick = () => start(prog ? prog.task : 0);
    const rs = $('#restartBtn'); if (rs) rs.onclick = () => start(0);
    RK.signal('home', { resume: prog ? prog.task : null });
  };

  RK.startLecture = async (n, from) => {
    try {
      const L = RK.lecture && RK.lecture.lecture === n ? RK.lecture : await RK.loadLecture(n);
      await RK.runLecture(L, from || 0);
    } catch (e) { RK.fatal(e); }
  };
  RK.exitLecture = () => { RK.save(); if (RK.mode === 'review') { location.href = location.pathname + '?office=1'; return; } location.href =location.pathname + (RK.lectureNo && RK.lectureNo !== 1 ? '?lecture=' + RK.lectureNo : ''); };

  RK.fatal = e => {
    console.error(e);
    const h = $('#home'); h.classList.remove('hidden'); $('#game').classList.add('hidden');
    h.innerHTML = '<div class="card" style="margin-top:40px;text-align:left"><div class="lbl">문제가 생겼어요</div><p>' + esc(e && e.message || e) + '</p><p class="note">인터넷 주소로 열었는지 확인해 주세요 (파일을 직접 열면 내용 파일을 못 읽어요).</p></div>';
  };

  RK.boot = async () => {
    RK.applyFast();
    $('#fastBtn').onclick = RK.toggleFast;
    $('#exitBtn').onclick = () => { RK.toast('여기까지 저장했어요'); setTimeout(RK.exitLecture, 500); };
    try {
      RK.course = await RK.loadJSON('content/course.json');
      const q = new URLSearchParams(location.search);
      RK.migrateReview();
      // 루키 사무실(로비): ?office=1, 또는 수료한 강이 있고 하던 강이 없을 때 첫 화면
      if (!q.get('lecture') && (q.get('office') || (Object.keys(RK.state.cleared).length && !RK.state.progress))) { await RK.showOffice(); return; }
      const n =+(q.get('lecture') || 0) || (RK.state.progress && RK.state.progress.lecture) || Math.min((RK.course.ready || [1]).filter(x => !RK.state.cleared[x])[0] || 1, 30);
      const L = await RK.loadLecture(n);
      RK.lecture = L; RK.lectureNo = L.lecture;
      RK.showHome(L);
    } catch (e) { RK.fatal(e); }
  };
})(window.RK);
