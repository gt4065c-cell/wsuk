/* 루키 사무실(로비) + 기억 다지기(복습 1·3·7·14일)
   - 사무실: 내 루키(직급·장식), 기억 다지기 알림, 다음 강 입구, 수첩 요약, 획득 카드 모음, 30강 빌딩 지도 입구, 팀(예시)
   - 기억 다지기: 수료한 강마다 1·3·7·14일 뒤 그 강 평가 문항 2개(장면 없는 문항)를 순서·보기 섞어 다시 물음
     둘 다 첫 선택에 맞히면 다음 상자 + 기억 별 +1, 틀려도 잃는 것 없음(카드·별·레벨 그대로) → 내일 다시 */
(function (RK) {
  'use strict';
  const $ = RK.$, $$ = RK.$$, esc = RK.esc, fmt = RK.fmt;
  RK.REVIEW_DAYS = [1, 3, 7, 14];        // 처음 수료한 날부터 며칠 뒤에 묻는지
  RK.REVIEW_XP = 10; RK.REVIEW_BONUS = 5; // 끝까지 10, 혼자 다 맞히면 +5 (성장친구 시스템 표)

  const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const lecOfNote = (k, n) => (n && n.lec) || (/^L(\d+)R/.test(k) ? +RegExp.$1 : (/^R\d+$/.test(k) ? 1 : 0));

  /* 예전 기록(이 기능 전에 수료) → 수료한 날 기준으로 예약 채워 넣기 */
  RK.migrateReview = () => {
    const st = RK.state; st.review = st.review || {}; st.adapt = st.adapt || [];
    let ch = false;
    Object.entries(st.cleared).forEach(([n, c]) => { if (!st.review[n]) { st.review[n] = { box: 0, stars: 0, due: RK.dayNo(c.at || RK.now()) + RK.REVIEW_DAYS[0], hist: [] }; ch = true; } });
    if (ch) RK.save();
  };
  RK.dueReviews = () => {
    const today = RK.dayNo();
    return Object.entries(RK.state.review || {}).filter(([, r]) => r.box < RK.REVIEW_DAYS.length && r.due <= today).map(([n]) => +n).sort((a, b) => a - b);
  };
  RK.nextReview = () => {
    const list = Object.entries(RK.state.review || {}).filter(([, r]) => r.box < RK.REVIEW_DAYS.length).map(([n, r]) => ({ n: +n, due: r.due }));
    list.sort((a, b) => a.due - b.due || a.n - b.n);
    return list[0] || null;
  };
  const memStars = r => '★'.repeat(r ? r.stars : 0) + '☆'.repeat(RK.REVIEW_DAYS.length - (r ? r.stars : 0));

  /* ---------- 사무실 ---------- */
  RK.showOffice = async () => {
    RK.mode = 'office';
    const st = RK.state, C = RK.course;
    $('#game').classList.add('hidden'); $('#final').classList.add('hidden');
    const h = $('#home'); h.classList.remove('hidden'); h.classList.add('office');
    const clearedNos = Object.keys(st.cleared).map(Number).sort((a, b) => a - b);
    // 수료한 강 내용(카드 이름·수첩 칸)을 이 컴퓨터/휴대폰 안 파일에서 읽음
    const lecs = {};
    await Promise.all(clearedNos.filter(n => (C.ready || []).includes(n)).map(n => RK.loadLecture(n).then(L => { lecs[n] = L; }).catch(() => { })));
    const nextLec = (C.ready || []).find(n => !st.cleared[n]) || Math.min(st.lv + 1, 30);
    const nextReady = (C.ready || []).includes(nextLec);
    const prog = st.progress && st.progress.task >= 0 ? st.progress : null;
    const due = RK.dueReviews(), nx = RK.nextReview();
    const today = RK.dayNo();

    // 기억 다지기 알림
    let mem;
    if (due.length) {
      const first = lecs[due[0]];
      mem = '<div class="card vis memcard due" id="memAlert"><div class="lbl">🧠 기억 다지기 <span class="r">' + due.length + '개 강</span></div>' +
        '<p class="memsay">"팀장님, ' + due[0] + '강 \'' + esc(first ? first.teach || first.title : '') + '\' 기술이 가물가물해요…"</p>' +
        '<div class="membtns">' + due.map(n => '<button class="btn primary" id="revBtn' + n + '">' + n + '강 기억 다지기 (2문제) ▶</button>').join('') + '</div>' +
        '<div class="note">다시 꺼낼 때가 된 기술이에요. 틀려도 잃는 것은 없어요.</div></div>';
    } else {
      mem = '<div class="card vis memcard" id="memAlert"><div class="lbl">🧠 기억 다지기</div>' +
        (nx ? '<p>오늘은 없어요. 다음: <b>' + nx.n + '강 · ' + RK.dayLabel(nx.due) + '</b>' + (nx.due - today === 1 ? ' (내일)' : '') + '</p>' : '<p>모든 강 복습 완료 — 단단한 카드!</p>') + '</div>';
    }
    // 수첩 요약: 강별 규칙 수 + 가장 최근 강 규칙
    const notes = Object.entries(st.notebook).map(([k, n]) => ({ k, n, lec: lecOfNote(k, n) }));
    const byLec = {}; notes.forEach(x => { (byLec[x.lec] = byLec[x.lec] || []).push(x); });
    const lastLec = clearedNos[clearedNos.length - 1];
    const lastNotes = (byLec[lastLec] || []).sort((a, b) => (a.n.no || 0) - (b.n.no || 0));
    const nbook = '<div class="nbook vis" id="nbSum"><div class="lbl">📒 ' + esc(st.name) + '의 업무 수첩 <span class="r">규칙 ' + notes.length + '개</span></div>' +
      (lastNotes.length ? '<div class="nbsub">' + lastLec + '강에서 가르친 규칙</div><ol>' + lastNotes.map(x => '<li><span class="no">' + x.n.no + '.</span><span>' + esc(x.n.rule) + '</span></li>').join('') + '</ol>' : '<p>아직 적힌 규칙이 없어요.</p>') +
      '<div class="nbsub">' + Object.keys(byLec).sort((a, b) => a - b).map(n => n + '강 ' + byLec[n].length + '개').join(' · ') + '</div></div>';
    // 획득 카드 모음 (강마다 줄, 기억 별)
    const cardRows = clearedNos.map(n => {
      const L = lecs[n]; if (!L) return '';
      const r = (st.review || {})[n];
      const isDue = due.includes(n);
      const got = (L.cards || []).filter(c => st.cards.includes(c.id));
      return '<div class="crow' + (isDue ? ' fade' : '') + '" data-lec="' + n + '"><div class="crow-h"><b>' + n + '강 · ' + esc(L.title) + '</b><span class="mem" aria-label="기억 별 ' + (r ? r.stars : 0) + '/4">기억 ' + memStars(r) + '</span></div>' +
        '<div class="rkc-cards">' + got.map(c => '<span class="' + (c.c || 'c1') + (c.grade === 'core' ? ' core' : '') + '">' + c.icon + '<b>' + esc(c.name) + '</b></span>').join('') + '</div>' +
        (isDue ? '<div class="note">다시 꺼낼 때가 된 기술</div>' : (r && r.stars >= 4 ? '<div class="note">단단한 카드 (복습 완료)</div>' : '')) + '</div>';
    }).join('');

    h.innerHTML = '<div class="badge-day">🏢 루키 사무실</div>' +
      '<div class="office-me"><div class="rkm">' + RK.rookieSVG(RK.stageFor(st.lv), due.length ? 'think' : 'happy') + '</div><div class="me-tx">' +
      '<div class="rkc-name">' + esc(st.name) + '</div><div class="me-st">' + esc(RK.statusText(st.lv)) + '</div>' +
      '<div class="me-deco">장식: ' + esc(RK.STAGES[RK.stageFor(st.lv)].deco) + '</div><div class="me-deco">경력 XP ' + st.xp + ' · 수료 ' + clearedNos.length + '/30강</div></div></div>' +
      mem +
      '<div class="home-btns">' + (prog
        ? '<button class="btn primary" id="goLecture">' + prog.lecture + '강 업무 ' + (prog.task + 1) + '부터 이어 하기 ▶</button>'
        : '<button class="btn ' + (nextReady ? 'primary' : 'ghost') + '" id="goLecture">' + (nextReady ? '🚪 ' + nextLec + '강 입구로 ▶' : '🔒 ' + nextLec + '강 (준비 중)') + '</button>') +
      '<button class="btn ghost" id="mapBtn">🗺️ 30강 빌딩 지도</button></div>' +
      '<div class="sec-h">📒 수첩 요약</div>' + nbook +
      '<div class="sec-h">🃏 획득 카드 <small>' + st.cards.length + '장</small></div><div class="cards-all" id="cardsAll">' + (cardRows || '<p class="note">아직 받은 카드가 없어요.</p>') + '</div>' +
      '<div class="sec-h">👥 팀 사무실 <small>예시</small></div>' + RK.W.team({ t: '7팀 사무실 (예시)|친구 루키 3명', s: '팀 연결은 다음 업데이트 (지금은 예시 화면)' }) +
      '<button class="switch" id="fastSwitch" role="switch" aria-checked="' + (RK.settings.fast ? 'true' : 'false') + '"><span>⏩ 빠른 진행 (연출 줄이기)<small>분위기 대사·움직임을 줄여요</small></span><span class="knob" aria-hidden="true"></span></button>' +
      '<button class="linkbtn" id="wipeBtn">이 휴대폰의 기록 지우기</button>';
    window.scrollTo(0, 0);
    $('#fastSwitch').onclick = RK.toggleFast;
    $('#wipeBtn').onclick = () => { if (confirm('이 휴대폰에 저장된 루키 기록을 모두 지울까요?')) { RK.resetAll(); location.href = location.pathname; } };
    $('#goLecture').onclick = () => {
      if (prog) { location.href = location.pathname + '?lecture=' + prog.lecture; return; }
      if (nextReady) location.href = location.pathname + '?lecture=' + nextLec; else RK.toast(nextLec + '강은 다음 조각에서 열려요');
    };
    $('#mapBtn').onclick = RK.openMap;
    due.forEach(n => { $('#revBtn' + n).onclick = () => RK.runReview(n, lecs[n]); });
    RK.signal('office', { due });
  };

  RK.openMap = () => {
    const ov = $('#overlay');
    ov.innerHTML = '<div class="lvup mapov" role="dialog" aria-label="30강 빌딩 지도"><h3 style="margin-bottom:10px">🗺️ 30강 빌딩 지도</h3><div style="text-align:left">' + RK.mapHTML() + '</div>' +
      '<div style="height:10px"></div><button class="btn ghost" id="closeMap">닫기</button></div>';
    ov.classList.remove('hidden'); ov.scrollTop = 0;
    RK.signal('map', {});
    $('#closeMap').onclick = () => { ov.classList.add('hidden'); ov.innerHTML = ''; RK.signal('office', { due: RK.dueReviews() }); };
  };

  /* ---------- 기억 다지기 2문제 ---------- */
  RK.pickReview = L => {
    const pool = (L.exam || []).filter(q => !q.scene && !q.after);
    const use = shuffle(pool.length >= 2 ? pool : L.exam).slice(0, 2);
    return use.map(q => {
      const order = shuffle(q.c.map((_, j) => j));        // 보기 순서도 섞음
      return Object.assign({}, q, { c: order.map(j => q.c[j]), a: order.indexOf(q.a), cw: q.cw != null ? order.indexOf(q.cw) : null, _order: order });
    });
  };
  RK.runReview = async (n, L) => {
    try {
      L = L || await RK.loadLecture(n);
      RK.mode = 'review'; RK.lecture = L; RK.lectureNo = n;
      const st = RK.state, r = st.review[n];
      const qs = RK.pickReview(L);
      RK.lastReview = { lec: n, ids: qs.map(q => q.id), orders: qs.map(q => q._order) };
      $('#home').classList.add('hidden'); $('#final').classList.add('hidden'); $('#game').classList.remove('hidden');
      $('#rkStage').innerHTML = RK.rookieSVG(RK.stageFor(st.lv), 'think');
      $('#bubble .who').textContent = st.name;
      const hud = k => {
        $('#hudLv').textContent = 'Lv.' + st.lv; $('#hudTitle').textContent = n + '강 복습'; $('#hudXp').textContent = 'XP ' + st.xp;
        $('#hudCards').textContent = '🧠 ' + k + '/' + qs.length; $('#hudBar').style.width = Math.round(k / qs.length * 100) + '%';
      };
      hud(0); window.scrollTo(0, 0);
      let right = 0;
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i];
        RK.setTitle('기억 다지기', n + '강 · ' + L.title, (i + 1) + '/' + qs.length);
        RK.panel('<div class="card quiz vis" id="quizCard"><div class="qno">🧠 기억 다지기 ' + (i + 1) + '/' + qs.length + '<span class="newcase">' + RK.REVIEW_DAYS[r.box] + '일째</span></div>' +
          '<div class="qtext">' + fmt(q.q) + '</div>' +
          q.c.map((t, j) => '<button class="choice" data-j="' + j + '"><span class="mk">' + 'ABCD'[j] + '</span><span>' + fmt(t) + '</span></button>').join('') + '<div id="qexp"></div></div>');
        RK.actions('');
        RK.say(i ? '하나 더요!|이것도 기억나요?' : '팀장님, 이거|다시 알려 주세요.', 'think');
        const t0 = Date.now();
        const j = await new Promise(res => {
          const bs = $$('#quizCard .choice');
          RK.signal('review', { q, i, lec: n });
          bs.forEach(b => b.onclick = () => { bs.forEach(x => x.disabled = true); res(+b.dataset.j); });
        });
        const bs = $$('#quizCard .choice'); const ok = j === q.a;
        bs[q.a].classList.add('ok'); bs[q.a].querySelector('.mk').textContent = '✓';
        if (!ok) { bs[j].classList.add('bad'); bs[j].querySelector('.mk').textContent = '✗'; }
        $('#qexp').innerHTML = '<div class="exp" role="status">' + (ok ? '✓ 기억났어요. ' : '✗ 정답은 ' + 'ABCD'[q.a] + '. ') + fmt(q.e) +
          (!ok && j === q.cw && q.w ? '<span class="warn">💡 자주 하는 실수: ' + fmt(q.w) + '</span>' : '') + (q.src ? '<span class="note" style="display:block">근거: 강의대본 ' + esc(q.src) + '</span>' : '') + '</div>';
        RK.say(ok ? '맞아요!|기억났어요.' : '같이 다시 볼래요?|해설을 읽어 봐요.', ok ? 'happy' : 'confused');
        if (ok) right++;
        RK.record('rv-' + q.id, ok, 1, (Date.now() - t0) / 1000);
        hud(i + 1);
        setTimeout(() => { const e = $('#qexp'); if (e && e.scrollIntoView) e.scrollIntoView({ behavior: 'auto', block: 'nearest' }); }, 50);
        await RK.act(i < qs.length - 1 ? '다음 문제 ▶' : '결과 보기 ▶', 'primary', { kind: 'talk' });
      }
      // 결과: 다 맞히면 다음 상자·별 +1, 아니면 상자 처음으로(내일 다시) — 카드·별·레벨은 빼앗지 않음
      const pass = right === qs.length, today = RK.dayNo(), was = r.box;
      if (pass) {
        r.box++; r.stars = Math.min(RK.REVIEW_DAYS.length, r.stars + 1);
        if (r.box < RK.REVIEW_DAYS.length) r.due = today + (RK.REVIEW_DAYS[r.box] - RK.REVIEW_DAYS[r.box - 1]);
      } else { r.box = 0; r.due = today + 1; }
      const xp = RK.REVIEW_XP + (pass ? RK.REVIEW_BONUS : 0);
      st.xp += xp;
      r.hist = (r.hist || []).concat([{ day: today, box: was, right, of: qs.length, pass }]).slice(-20);
      RK.save(); hud(qs.length);
      const done = r.box >= RK.REVIEW_DAYS.length;
      RK.setTitle('기억 다지기', n + '강 결과', pass ? '기억 별 +1' : '내일 다시');
      RK.panel('<div class="card vis" id="revResult" style="text-align:center"><div class="lbl" style="justify-content:center">' + n + '강 기억 다지기 결과</div>' +
        '<div style="font-size:28px;font-weight:900;color:#FFD166">' + memStars(r) + '</div>' +
        '<div style="font-weight:800;font-size:17px;margin-top:4px">' + right + ' / ' + qs.length + ' 혼자 맞힘 · +' + xp + ' XP</div>' +
        '<div class="note">' + (done ? '단단한 카드 완성! 이 강 복습은 끝이에요.' : (pass ? '다음 기억 다지기: ' : '카드·별은 그대로예요. 다음: ') + RK.dayLabel(r.due)) + '</div></div>');
      RK.say(pass ? (done ? '단단한 카드!|이제 안 잊어요.' : '기억났어요!|별 하나 더 받았어요.') : '괜찮아요.|내일 또 물어볼게요.', pass ? 'happy' : 'normal');
      RK.actions('<button class="btn primary" id="revDone">🏢 사무실로 ▶</button>');
      RK.signal('reviewDone', { lec: n, pass, right });
      $('#revDone').onclick = () => { location.href = location.pathname + '?office=1'; };
    } catch (e) { RK.fatal(e); }
  };
})(window.RK);
