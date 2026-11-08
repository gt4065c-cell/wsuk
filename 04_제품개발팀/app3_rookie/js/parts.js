/* 조작 부품 10종 + 보조 장면 — 디자인 규격 3장
   부품 10종: sort(분류 끌기) match(짝 맞추기) order(순서 맞추기) spot(틀린 곳 찾기) pick(고르기)
             fill(빈칸 채우기) reply(대화 선택) swipe(타임라인 넘기기) give(루키에게 건네기) build(미니 만들기)
   + pick의 'teach' 모드 = 루키 규칙 수첩에 규칙 적기 (틀리게 가르쳐도 그대로 적힘 → 다음 업무에서 루키가 그대로 행동)
   보조: talk say show add inbox study draft log wait branch apply
   모든 부품: 틀림 1 → 그 보기 전용 힌트, 2 → 직접 힌트 + 자리 표시(노란 점선), 3 → 같이 하기(자동, "함께 ✓") */
(function (RK) {
  'use strict';
  const $ = RK.$, $$ = RK.$$, esc = RK.esc, fmt = RK.fmt;
  const P = RK.P = {};
  const now = () => Date.now();
  const rec = (step, r, t0) => { if (step && step.id) RK.record(step.id, r.firstTry, r.tries, (now() - t0) / 1000); };

  /* ================= 공통: 보기 고르기 ================= */
  // cfg: { host:'actions'|Element, prompt, opts, reply, hint2, fbDefault, type, meta }
  function choose(cfg) {
    return new Promise(res => {
      const opts = cfg.opts;
      const html = (cfg.prompt ? '<div class="prompt">' + fmt(cfg.prompt) + '</div>' : '') +
        opts.map((o, i) => '<button class="choice' + (cfg.reply ? ' reply' : '') + '" data-i="' + i + '">' +
          (cfg.reply ? '<span class="who">팀장</span>' : '<span class="mk" aria-hidden="true"></span>') +
          '<span class="tx">' + fmt(o.t || o.r) + '</span></button>').join('');
      let host;
      if (cfg.host === 'actions' || !cfg.host) { RK.actions(html); host = $('#actions'); }
      else { host = cfg.host; host.innerHTML = html; }
      const btns = $$('.choice', host);
      const okIdx = opts.findIndex(o => o.ok);
      let wrong = 0, done = false;
      const t0 = now();
      RK.signal(cfg.type || 'pick', Object.assign({ opts }, cfg.meta || {}));
      const finish = async (i, together) => {
        done = true;
        const b = btns[i]; b.classList.add('ok'); if (together) b.classList.add('together');
        const mk = b.querySelector('.mk'); if (mk) mk.textContent = '✓';
        btns.forEach(x => x.disabled = true);
        RK.buzz(); RK.mood('happy');
        await RK.wait(450);
        res({ i, firstTry: wrong === 0, tries: wrong + 1, together: !!together, sec: (now() - t0) / 1000 });
      };
      btns.forEach(b => b.onclick = () => {
        if (b.disabled || done) return;
        const i = +b.dataset.i, o = opts[i];
        if (o.ok || okIdx < 0) { finish(i, false); return; }
        wrong++;
        b.classList.add('bad'); const mk = b.querySelector('.mk'); if (mk) mk.textContent = '✗'; b.disabled = true;
        const fb = o.fb || (o.then && o.then.t) || cfg.fbDefault;
        const together = RK.helpStep(wrong, fb, cfg.hint2, btns[okIdx]);
        if (together) finish(okIdx, true);
        else RK.signal(cfg.type || 'pick', Object.assign({ opts, retry: wrong }, cfg.meta || {}));
      });
    });
  }
  RK.choose = choose;

  /* ================= 부품 5. 고르기 (pick) ================= */
  P.pick = async step => {
    if (step.mode === 'teach') return P.teach(step);
    RK.sayObj(step.say);
    const t0 = now();
    const r = await choose({ prompt: step.prompt, opts: step.opts, hint2: step.hint2, fbDefault: step.fbDefault, type: 'pick', meta: { step } });
    rec(step, r, t0);
    RK.sayObj(step.okSay || step.opts[r.i].then);
    if (step.okSay || step.opts[r.i].then) await RK.wait(500);
    return r;
  };

  /* ================= 수첩에 가르치기 (pick · teach 모드) =================
     어떤 보기를 골라도 루키는 그대로 수첩에 적습니다(맞음/틀림 표시 없음).
     틀린 규칙이면 다음 업무(apply)에서 루키가 그대로 틀리게 행동 → 팀장이 보고 다시 가르침.
     다시 가르칠 때도 도움 3단계: 1번째 = 썼던 규칙 ✗ 표시, 2번째 = 힌트 + 맞는 규칙 깜빡, 3번째 = 같이 고치기 */
  P.teach = async (step, ctx) => {
    ctx = ctx || {};
    const attempt = ctx.attempt || 0;
    const used = ctx.used || [];
    const opts = step.opts;
    const okIdx = opts.findIndex(o => o.ok);
    const t0 = now();
    if (attempt >= 3) {
      RK.say(RK.HELP_DEFAULT[2], 'happy');
      await RK.wait(700);
      RK.writeNote(step.note, opts[okIdx], ctx.where || '같이 고침');
      RK.toast('📒 수첩 ' + (opts[okIdx].no || '') + '번을 같이 고쳤어요 (함께 ✓)');
      RK.sayObj(opts[okIdx].then);
      await RK.wait(600);
      return opts[okIdx];
    }
    RK.sayObj(attempt ? (step.fixSay || step.say) : step.say);
    return new Promise(res => {
      RK.actions('<div class="prompt">' + fmt(attempt ? (step.fixPrompt || step.prompt) : step.prompt) + '</div>' +
        opts.map((o, i) => '<button class="choice" data-i="' + i + '"><span class="mk" aria-hidden="true">' + (used.includes(o.k) ? '✗' : '') + '</span><span class="tx">' + fmt(o.t) + '</span><span class="tch">📒 적기</span></button>').join(''));
      const btns = $$('#actions .choice');
      btns.forEach((b, i) => { if (used.includes(opts[i].k)) { b.classList.add('bad'); b.disabled = true; } });
      if (attempt >= 2) { RK.say(step.hint2 || RK.HELP_DEFAULT[1], 'think'); RK.hintMe(btns[okIdx]); }
      RK.signal('teach', { step, opts, attempt, note: step.note });
      btns.forEach(b => b.onclick = async () => {
        if (b.disabled) return;
        const o = opts[+b.dataset.i];
        btns.forEach(x => x.disabled = true);
        b.classList.add('mine'); b.querySelector('.mk').textContent = '📒';
        RK.writeNote(step.note, o, ctx.where || (attempt ? '다시 가르침' : '처음 가르침'));
        if (step.id) RK.record(step.id + (attempt ? '-fix' + attempt : ''), attempt === 0 && !!o.ok, attempt + 1, (now() - t0) / 1000);
        RK.mood('think');
        await RK.wait(350);
        RK.actions('');
        RK.sayObj(o.then);
        await RK.wait(650);
        res(o);
      });
    });
  };

  /* ================= 부품 7. 대화 선택 (reply) ================= */
  P.reply = async step => {
    RK.sayObj(step.say);
    const t0 = now();
    const allOk = step.opts.every(o => o.ok);
    const r = await choose({ prompt: step.prompt, opts: step.opts.map(o => Object.assign({}, o, { ok: allOk ? true : o.ok })), reply: true, hint2: step.hint2, fbDefault: step.fbDefault, type: 'reply', meta: { step } });
    rec(step, r, t0);
    RK.sayObj(step.opts[r.i].then);
    await RK.wait(700);
    return r;
  };

  /* ================= 부품 4. 틀린 곳 찾기 (spot) ================= */
  P.spot = async step => {
    const lines = step.lines;
    const need = step.need || lines.filter(l => l.bad).length || 1;
    const code = step.show === 'code';
    const id = step.into || 'spot';
    const html = '<div class="card vis" id="' + id + '">' +
      (step.ref ? '<div class="lbl">📄 ' + esc(step.ref.label) + '</div><div class="memo" style="margin-bottom:10px">' + fmt(step.ref.t) + '</div>' : '') +
      '<div class="lbl">' + esc(RK.plain(step.label || '루키의 결과물')) + ' <span class="r counter" id="spotCnt">찾았다 0/' + need + '</span></div>' +
      '<div class="spotlines"></div><div class="hint">' + esc(step.tip || '틀린 줄을 눌러 주세요') + '</div></div>';
    const old = $('#' + id);
    if (old) { old.outerHTML = html; RK.panelVer++; } else RK.panelAdd(html);
    const box = $('#' + id + ' .spotlines');
    const mk = (l, i) => step.show === 'rows'
      ? '<button class="rowbtn" data-i="' + i + '"><span>' + fmt(l.t) + (l.nw ? ' <span class="newmk">★처음 본 말</span>' : '') + '</span><span class="cls">' + fmt(l.tag) + '</span></button>'
      : '<button class="dl' + (code ? ' code' : '') + '" data-i="' + i + '">' + fmt(l.t) + '</button>';
    if (step.typing && !step.into) {
      for (let i = 0; i < lines.length; i++) { await RK.wait(600); box.insertAdjacentHTML('beforeend', mk(lines[i], i)); }
    } else box.innerHTML = lines.map(mk).join('');
    RK.sayObj(step.say);
    const t0 = now();
    let wrong = 0, found = 0;
    const r = await new Promise(res => {
      const btns = $$('button', box);
      const markFound = (b, together) => {
        const l = lines[+b.dataset.i]; l._found = true; found++;
        b.classList.add('found'); if (together) b.classList.add('together');
        if (step.show === 'rows') b.querySelector('.cls').textContent = '✗ ' + RK.plain(l.mark || '틀림');
        else b.insertAdjacentHTML('beforeend', '<span class="mark">✗ ' + esc(RK.plain(l.mark || '틀림')) + '</span>');
        $('#spotCnt').textContent = '찾았다 ✓ ' + found + '/' + need;
        RK.buzz();
      };
      RK.signal('spot', { step });
      btns.forEach(b => b.onclick = () => {
        const l = lines[+b.dataset.i];
        if (l._found) return;
        if (l.bad) {
          markFound(b);
          if (found >= need) res({ firstTry: wrong === 0, tries: wrong + 1 });
          else { RK.say(step.moreSay || '하나 찾았어요!|더 있어요.', 'normal'); RK.signal('spot', { step }); }
          return;
        }
        wrong++; RK.nope(b);
        const target = btns.find(x => lines[+x.dataset.i].bad && !lines[+x.dataset.i]._found);
        const together = RK.helpStep(wrong, step.nopeSay && step.nopeSay.t || step.nopeSay, step.hint2, target);
        if (together) {
          btns.filter(x => lines[+x.dataset.i].bad && !lines[+x.dataset.i]._found).forEach(x => markFound(x, true));
          res({ firstTry: false, tries: wrong, together: true });
        } else RK.signal('spot', { step, retry: wrong });
      });
    });
    lines.forEach(l => delete l._found);
    rec(step, r, t0);
    RK.mood('confused');
    RK.sayObj(step.okSay);
    await RK.wait(600);
    return r;
  };

  /* ================= 부품 1. 분류 끌기 (sort) ================= */
  P.sort = async step => {
    const bins = step.bins, items = step.items;
    const bcls = bins.length === 2 ? ' b2' : bins.length === 4 ? ' b4' : '';
    RK.panelAdd('<div class="card vis" id="sortCard"><div class="lbl">🗂️ ' + esc(step.prompt || '카드를 알맞은 상자로') +
      (step.timer === 'show' ? ' <span class="r timer" id="tm">⏱ 0초</span>' : '') + '</div>' +
      '<div class="bins' + bcls + '">' + bins.map(b => '<div class="bin" role="button" tabindex="0" data-k="' + b.k + '" aria-label="상자: ' + esc(b.name) + '"><div class="bi" aria-hidden="true">' + (b.icon || '📦') + '</div><div class="bn">' + esc(b.name) + '</div><div class="bc" id="c-' + b.k + '">0장</div></div>').join('') + '</div>' +
      '<div class="tray" id="tray">' + items.map((x, i) => '<div class="task drag" role="button" tabindex="0" data-i="' + i + '">' + fmt(x.t) + (x.nw ? '<span class="newmk">★처음 보는 일</span>' : '') + '</div>').join('') + '</div>' +
      '<div class="hint">끌어다 놓거나, 카드를 누른 뒤 상자를 눌러요</div></div>');
    RK.sayObj(step.say);
    const t0 = now();
    const tick = step.timer === 'show' ? setInterval(() => { const e = $('#tm'); if (e) e.textContent = '⏱ ' + Math.floor((now() - t0) / 1000) + '초'; }, 500) : null;
    const cnt = {}; bins.forEach(b => cnt[b.k] = 0);
    const w = items.map(() => 0);
    let left = items.length, anyWrong = false;
    await new Promise(res => {
      const place = (it, z, together) => {
        const tk = items[+it.dataset.i];
        cnt[tk.k]++; $('#c-' + tk.k).textContent = cnt[tk.k] + '장 ✓';
        z.classList.remove('flash'); void z.offsetWidth; z.classList.add('flash');
        it.remove(); left--;
        RK.buzz();
        if (together) RK.toast('함께 ✓ ' + RK.plain(tk.t) + ' → ' + bins.find(b => b.k === tk.k).name);
        if (left) { RK.say((step.okSay || '맞아요.|남은 카드 {left}장.').replace('{left}', left), 'happy'); RK.signal('sort', { step }); }
        else res();
      };
      RK.dragSetup($$('#tray .task'), $$('#sortCard .bin'), (it, z) => {
        const i = +it.dataset.i, tk = items[i];
        if (tk.k === z.dataset.k) { place(it, z); return; }
        w[i]++; anyWrong = true; RK.nope(it);
        const right = $('#sortCard .bin[data-k="' + tk.k + '"]');
        const together = RK.helpStep(w[i], (step.fbByBin || {})[tk.k] || tk.why, step.hint2 || ('이 카드는 노란 상자예요.|' + (tk.why || '')), right);
        if (together) place(it, right, true); else RK.signal('sort', { step, retry: w[i] });
      });
      RK.signal('sort', { step });
    });
    if (tick) clearInterval(tick);
    const sec = Math.floor((now() - t0) / 1000);
    $('#tray').innerHTML = '<div class="note" style="text-align:center">🏁 ' + items.length + '장 정리 완료 · ' + sec + '초</div>';
    rec(step, { firstTry: !anyWrong, tries: 1 + w.reduce((a, b) => a + b, 0) }, t0);
    RK.sayObj(step.doneSay || { t: '다 넣었어요!', m: 'happy' });
    await RK.wait(500);
  };

  /* ================= 부품 9. 루키에게 건네기 (give) =================
     item.ok = 맞는 것, item.reject = 루키가 못 받는 것(도움 3단계), 둘 다 아니면 '받지만 틀린 가르침'(수첩에 그대로 적힘) */
  P.give = async step => {
    RK.panelAdd('<div class="card vis" id="giveCard"><div class="lbl">🎯 ' + fmt(step.task) + '</div>' +
      '<div class="dropzone" id="dz" role="button" tabindex="0" aria-label="루키에게 건네기"><div class="mini" id="dzRk">' + RK.rookieSVG(null, 'normal') + '</div><div><div class="dz-t">여기로 끌어다 놓기</div><div class="dz-s">또는 카드를 누른 뒤 여기를 눌러요</div></div></div>' +
      '<div id="keys">' + step.items.map((x, i) => '<div class="key drag" role="button" tabindex="0" data-i="' + i + '"><span class="ico" aria-hidden="true">' + (x.icon || '🔑') + '</span><span>' + fmt(x.t) + '<small>' + fmt(x.s || '') + '</small></span></div>').join('') + '</div></div>');
    if (step.pre) await RK.runSteps(step.pre);
    RK.sayObj(step.say);
    const t0 = now();
    let wrong = 0;
    const okI = step.items.findIndex(x => x.ok);
    const chosen = await new Promise(res => {
      const accept = (it) => { it.classList.add('used'); res(step.items[+it.dataset.i]); };
      RK.dragSetup($$('#keys .key'), [$('#dz')], it => {
        const item = step.items[+it.dataset.i];
        if (item.reject) {
          wrong++; RK.nope(it); it.classList.add('nope');
          const together = RK.helpStep(wrong, item.fb, step.hint2, $('#keys .key[data-i="' + okI + '"]'));
          if (together) { const k = $('#keys .key[data-i="' + okI + '"]'); k.classList.add('together'); accept(k); }
          else RK.signal('give', { step, retry: wrong });
          return;
        }
        accept(it);
      });
      RK.signal('give', { step });
    });
    RK.styleRk($('#dzRk svg'), 'happy');
    if (step.note) RK.writeNote(step.note, chosen, '처음 가르침(건네기)');
    rec(step, { firstTry: wrong === 0 && !!chosen.ok, tries: wrong + 1 }, t0);
    RK.sayObj(chosen.then);
    await RK.wait(600);
    const keys = $('#keys'); if (keys) keys.remove();
    return chosen;
  };

  /* ================= 부품 2. 짝 맞추기 (match) ================= */
  P.match = async step => {
    const pairs = {}; step.pairs.forEach(([a, b]) => pairs[a] = b);
    RK.panelAdd('<div class="card vis" id="matchCard"><div class="lbl">🔗 ' + esc(step.prompt || '짝을 이어 주세요') + '</div><div class="match"><div class="col">' +
      step.left.map(x => '<button class="mi" data-side="l" data-id="' + x.id + '"><span class="pn"></span>' + fmt(x.t) + '</button>').join('') + '</div><div class="col">' +
      step.right.map(x => '<button class="mi" data-side="r" data-id="' + x.id + '"><span class="pn"></span>' + fmt(x.t) + '</button>').join('') + '</div></div>' +
      '<div class="hint">왼쪽을 누르고, 짝이 되는 오른쪽을 눌러요</div></div>');
    RK.sayObj(step.say);
    const t0 = now();
    let sel = null, made = 0, anyWrong = false; const w = {};
    await new Promise(res => {
      const pair = (l, r, together) => {
        made++; const n = '①②③④⑤'[made - 1] || made;
        [l, r].forEach(x => { x.classList.add('done'); x.disabled = true; x.querySelector('.pn').textContent = n + ' ✓'; if (together) x.classList.add('together'); });
        RK.buzz(); RK.mood('happy');
        if (made >= step.pairs.length) res(); else RK.signal('match', { step });
      };
      $$('#matchCard .mi').forEach(b => b.onclick = () => {
        if (b.disabled) return;
        if (b.dataset.side === 'l') { $$('#matchCard .mi.sel').forEach(x => x.classList.remove('sel')); sel = b; b.classList.add('sel'); return; }
        if (!sel) { RK.toast('왼쪽 칸을 먼저 눌러 주세요'); return; }
        const a = sel.dataset.id, r = b.dataset.id;
        sel.classList.remove('sel');
        if (pairs[a] === r) { pair(sel, b); sel = null; return; }
        anyWrong = true; w[a] = (w[a] || 0) + 1; RK.nope(b);
        const right = $('#matchCard .mi[data-side="r"][data-id="' + pairs[a] + '"]');
        const together = RK.helpStep(w[a], (step.fb || {})[a + '-' + r] || step.fbDefault, step.hint2, right);
        if (together) { pair(sel, right, true); sel = null; } else { sel.classList.add('sel'); RK.signal('match', { step, retry: w[a] }); }
      });
      RK.signal('match', { step });
    });
    rec(step, { firstTry: !anyWrong, tries: 1 }, t0);
    RK.sayObj(step.okSay);
    await RK.wait(500);
  };

  /* ================= 부품 3. 순서 맞추기 (order) ================= */
  P.order = async step => {
    let list = step.items.map((x, i) => Object.assign({ _i: i }, x));
    RK.panelAdd('<div class="card vis" id="orderCard"><div class="lbl">🔢 ' + esc(step.prompt || '차례대로 줄 세워요') + '</div><div id="ordList"></div><div class="hint">▲▼ 버튼으로 옮긴 뒤 [다 놓았어요]</div></div>');
    const draw = (marks) => {
      $('#ordList').innerHTML = list.map((x, i) => '<div class="ord' + (marks ? (x.ord === i + 1 ? ' ok' : ' bad') : '') + '" data-i="' + x._i + '"><span class="n">' + (i + 1) + '</span><span class="tx">' + fmt(x.t) + '</span>' +
        '<button aria-label="위로" data-mv="-1" data-p="' + i + '"' + (i === 0 ? ' disabled' : '') + '>▲</button><button aria-label="아래로" data-mv="1" data-p="' + i + '"' + (i === list.length - 1 ? ' disabled' : '') + '>▼</button></div>').join('');
      $$('#ordList button').forEach(b => b.onclick = () => {
        const p = +b.dataset.p, q = p + (+b.dataset.mv);
        if (q < 0 || q >= list.length) return;
        [list[p], list[q]] = [list[q], list[p]]; draw(false);
      });
    };
    draw(false);
    RK.sayObj(step.say);
    const t0 = now();
    let rounds = 0;
    for (; ;) {
      await RK.act('다 놓았어요 ✓', 'primary', { kind: 'order', step, list: () => list });
      const bad = list.filter((x, i) => x.ord !== i + 1).length;
      draw(true);
      if (!bad) break;
      rounds++;
      const firstBad = $$('#ordList .ord.bad')[0];
      const together = RK.helpStep(rounds, (step.fbWrong || '{n}개가 제자리가 아니에요.|✗ 줄을 옮겨 봐요.').replace('{n}', bad), step.hint2, firstBad);
      if (together) { list.sort((a, b) => a.ord - b.ord); draw(true); $$('#ordList .ord').forEach(x => x.classList.add('together')); break; }
    }
    rec(step, { firstTry: rounds === 0, tries: rounds + 1 }, t0);
    RK.mood('happy'); RK.sayObj(step.okSay);
    await RK.wait(500);
  };

  /* ================= 부품 6. 빈칸 채우기 (fill) ================= */
  P.fill = async step => {
    const parts = String(step.text).split(/(\{\d+\})/);
    const html = parts.map(p => { const m = p.match(/^\{(\d+)\}$/); return m ? '<button class="blank" data-b="' + m[1] + '" aria-label="빈칸 ' + m[1] + '">＿＿</button>' : esc(RK.fill(p)); }).join('');
    RK.panelAdd('<div class="card vis" id="fillCard"><div class="lbl">🧩 ' + esc(step.prompt || '빈칸을 채워 주세요') + '</div><div class="filltext' + (step.display === 'code' ? ' code' : '') + '">' + html + '</div>' +
      '<div class="chipsrow">' + step.chips.map((c, i) => '<button class="chipbtn" data-c="' + i + '">' + esc(c) + '</button>').join('') + '</div><div class="hint">조각을 누르면 빈칸에 들어가요</div></div>');
    RK.sayObj(step.say);
    const t0 = now();
    const blanks = {}; step.blanks.forEach(b => blanks[b.id] = b);
    const w = {}; let anyWrong = false, filled = 0;
    let selBlank = null;
    await new Promise(res => {
      const firstEmpty = () => $$('#fillCard .blank').find(b => !b.classList.contains('ok'));
      const setOk = (bEl, chip, together) => {
        bEl.textContent = chip; bEl.classList.add('ok'); if (together) bEl.classList.add('together'); bEl.disabled = true; filled++;
        const cEl = $$('#fillCard .chipbtn').find(c => c.textContent === chip && !c.classList.contains('used')); if (cEl) cEl.classList.add('used');
        RK.buzz();
        if (filled >= step.blanks.length) res(); else RK.signal('fill', { step });
      };
      $$('#fillCard .blank').forEach(b => b.onclick = () => { $$('#fillCard .blank').forEach(x => x.style.outline = ''); selBlank = b; b.style.outline = '3px solid #FFD166'; });
      $$('#fillCard .chipbtn').forEach(c => c.onclick = () => {
        if (c.classList.contains('used')) return;
        const bEl = (selBlank && !selBlank.classList.contains('ok')) ? selBlank : firstEmpty(); if (!bEl) return;
        const b = blanks[bEl.dataset.b], chip = c.textContent;
        if (b.ans.includes(chip)) { setOk(bEl, chip); selBlank = null; return; }
        anyWrong = true; w[b.id] = (w[b.id] || 0) + 1; RK.nope(bEl);
        const right = $$('#fillCard .chipbtn').find(x => b.ans.includes(x.textContent) && !x.classList.contains('used'));
        const together = RK.helpStep(w[b.id], (step.fb || {})[chip] || step.fbDefault, step.hint2, right);
        if (together) setOk(bEl, b.ans[0], true); else RK.signal('fill', { step, retry: w[b.id] });
      });
      RK.signal('fill', { step });
    });
    rec(step, { firstTry: !anyWrong, tries: 1 }, t0);
    RK.mood('happy'); RK.sayObj(step.okSay);
    if (step.run) await P.log(step.run);
    await RK.wait(400);
  };

  /* ================= 부품 8. 타임라인 넘기기 (swipe) ================= */
  P.swipe = async step => {
    const cards = step.cards;
    RK.panelAdd('<div class="card vis" id="swCard"><div class="dots" id="swDots" aria-hidden="true"></div><div id="swBody"></div><div class="swnav"><button class="btn ghost" id="swPrev">◀ 이전</button><button class="btn primary" id="swNext">다음 ▶</button></div><div class="hint" id="swTip">옆으로 밀거나 버튼으로 넘겨요</div></div>');
    RK.sayObj(step.say);
    const t0 = now();
    const solved = {};
    let idx = 0, combo = 0, best = 0, quizWrong = false;
    await new Promise(res => {
      const body = $('#swBody');
      const draw = () => {
        const c = cards[idx];
        $('#swDots').innerHTML = cards.map((x, i) => '<span class="' + (i === idx ? 'on' : '') + '">' + (x.quiz ? '◆' : (i === idx ? '●' : '○')) + '</span>').join('');
        $('#swPrev').disabled = idx === 0;
        const last = idx === cards.length - 1;
        $('#swNext').innerHTML = last ? '다 봤어요 ✓' : '다음 ▶';
        if (c.quiz && !solved[idx]) {
          $('#swNext').disabled = true; $('#swNext').innerHTML = '🔒 퀴즈를 풀면 열려요';
          body.innerHTML = '<div class="swcard"><div class="tt">' + fmt(c.quiz.prompt) + '</div><div id="swQuiz"></div></div>';
          choose({ host: $('#swQuiz'), opts: c.quiz.opts, hint2: c.quiz.hint2, type: 'pick', meta: { step: c.quiz, inSwipe: true } }).then(r => {
            solved[idx] = true;
            if (r.firstTry) { combo++; best = Math.max(best, combo); if (combo >= 2) RK.toast(combo + '콤보!'); } else { combo = 0; quizWrong = true; }
            RK.sayObj(c.quiz.okSay); draw();
          });
          return;
        }
        $('#swNext').disabled = false;
        body.innerHTML = '<div class="swcard"><div class="art" aria-hidden="true">' + (c.art || '') + '</div>' + (c.big ? '<div class="big">' + fmt(c.big) + '</div>' : '') +
          '<div class="tt">' + fmt(c.t) + '</div><div class="ss">' + fmt(c.s || '') + '</div></div>';
        if (c.say) RK.sayObj(c.say);
        RK.signal('swipe', { step, idx, last });
      };
      $('#swPrev').onclick = () => { if (idx > 0) { idx--; draw(); } };
      $('#swNext').onclick = () => { if ($('#swNext').disabled) return; if (idx < cards.length - 1) { idx++; draw(); } else res(); };
      let sx = null;
      body.addEventListener('pointerdown', e => { sx = e.clientX; });
      body.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) { if (dx < 0) $('#swNext').click(); else $('#swPrev').click(); } });
      draw();
    });
    rec(step, { firstTry: !quizWrong, tries: 1 }, t0);
    $('#swCard .swnav').remove(); $('#swTip').textContent = best >= 2 ? '최고 ' + best + '콤보' : '다 봤어요 ✓';
    RK.sayObj(step.okSay);
    await RK.wait(300);
  };

  /* ================= 부품 10. 미니 만들기 (build) ================= */
  P.build = async step => {
    RK.panelAdd('<div class="card vis" id="buildCard"><div class="lbl">🛠️ ' + fmt(step.goal) + '</div><div id="slots">' +
      step.slots.map(s => '<button class="slot" data-s="' + s.id + '"><span class="sl">' + esc(s.label) + '</span><span class="sv">여기에 조각 놓기</span></button>').join('') + '</div>' +
      '<div class="chipsrow" id="bparts">' + step.parts.map(p => '<button class="chipbtn" data-p="' + p.id + '">' + fmt(p.t) + '</button>').join('') + '</div>' +
      '<div class="hint">조각을 누른 뒤 칸을 눌러요</div><div id="bout"></div></div>');
    RK.sayObj(step.say);
    const t0 = now();
    const parts = {}; step.parts.forEach(p => parts[p.id] = p);
    let sel = null, anyWrong = false; const w = {};
    const filled = {};
    await new Promise(res => {
      const check = () => { if (step.slots.every(s => filled[s.id])) res(); else RK.signal('build', { step }); };
      const put = (slotEl, p, together) => {
        filled[slotEl.dataset.s] = p.id; slotEl.classList.add('filled'); if (together) slotEl.classList.add('together');
        slotEl.querySelector('.sv').textContent = RK.plain(p.t); slotEl.disabled = true;
        $('#bparts .chipbtn[data-p="' + p.id + '"]').classList.add('used'); RK.buzz(); check();
      };
      $$('#bparts .chipbtn').forEach(c => c.onclick = () => { if (c.classList.contains('used')) return; $$('#bparts .chipbtn').forEach(x => x.style.outline = ''); sel = c; c.style.outline = '3px solid #FFD166'; });
      $$('#slots .slot').forEach(s => s.onclick = () => {
        if (s.disabled) return;
        if (!sel) { RK.toast('조각을 먼저 눌러 주세요'); return; }
        const p = parts[sel.dataset.p]; sel.style.outline = '';
        if (p.fit.includes(s.dataset.s)) { put(s, p); sel = null; return; }
        anyWrong = true; w[p.id] = (w[p.id] || 0) + 1; RK.nope(s);
        const right = p.fit.length ? $('#slots .slot[data-s="' + p.fit[0] + '"]') : null;
        const together = RK.helpStep(w[p.id], p.trap || step.fbDefault, step.hint2, right || sel);
        if (together) {
          if (right && !right.disabled) put(right, p, true);
          else { sel.classList.add('used'); RK.toast('함께 ✓ 그 조각은 빼 둘게요'); check(); }
          sel = null;
        } else RK.signal('build', { step, retry: w[p.id] });
      });
      RK.signal('build', { step });
    });
    await RK.act('{name}에게 맡기기 ▶', 'primary', { kind: 'go', step });
    RK.mood('think');
    if (step.run) await P.log(Object.assign({ into: 'bout' }, step.run));
    if (step.result) $('#bout').insertAdjacentHTML('beforeend', '<div class="resultcard">🃏 ' + fmt(step.result.title) + '<br>' + step.slots.map(s => esc(s.label) + ': ' + esc(RK.plain(parts[filled[s.id]].t))).join('<br>') + '</div>');
    rec(step, { firstTry: !anyWrong, tries: 1 }, t0);
    RK.mood('happy'); RK.sayObj(step.okSay);
    await RK.wait(500);
  };

  /* ================= 보조 장면 ================= */
  P.talk = async step => {
    for (const L of step.lines) {
      if (L.flavor && RK.settings.fast) continue;   // 빠른 진행: 분위기용 대사는 건너뜀
      RK.say(L.t, L.m);
      await RK.act(L.r || '다음 ▶', L.r ? 'reply' : 'primary', { kind: 'talk', line: L });
    }
  };
  P.say = async step => { RK.say(step.t, step.m); if (step.ms) await RK.wait(step.ms); };
  P.wait = async step => { await RK.wait(step.ms || 500); };
  P.go = async step => { RK.sayObj(step.say); await RK.act(step.label || '다음 ▶', 'primary', { kind: 'go', step }); };

  // 작업판 그림 조각
  const W = {
    rules: w => '<div class="card vis" id="' + (w.id || 'rules') + '"><div class="lbl">📋 ' + esc(RK.plain(w.label || '루키의 규칙표')) + '</div><div class="rulerows">' + rulesRows(w) + '</div></div>',
    inbox: w => '<div class="card vis"><div class="lbl">📥 ' + esc(RK.plain(w.label || '받은 문의함')) + '</div><div id="' + (w.id || 'inbox') + '"></div></div>',
    memo: w => '<div class="card vis"><div class="lbl">📄 ' + esc(RK.plain(w.label || '팀장이 준 메모')) + '</div><div class="memo">' + fmt(w.t) + '</div></div>',
    draft: w => '<div class="card vis" id="' + (w.id || 'draft') + '"><div class="lbl">✍️ ' + esc(RK.plain(w.label || '루키가 쓴 초안')) + '</div><div class="spotlines"></div><div class="hint" id="' + (w.id || 'draft') + 'Tip">' + esc(w.tip || '루키가 쓰는 중…') + '</div></div>',
    notebook: () => RK.notebookHTML(),
    note: w => '<div class="note vis">' + fmt(w.t) + '</div>',
    complaint: w => '<div class="complaint vis"' + (w.id ? ' id="' + w.id + '"' : '') + ' role="status"><small>' + esc(RK.plain(w.who || '받은 문의')) + '</small>📩 ' + fmt(w.t) + '</div>',
    task: w => '<div class="card vis"><div class="lbl">🎯 오늘의 일</div><div style="font-weight:800">' + fmt(w.t) + '</div></div>',
    log: w => '<div class="log vis" id="' + (w.id || 'log') + '" aria-live="polite"></div>',
    team: w => '<div class="teamprev vis"><div class="heads">' + RK.miniHead('#FF8A5B') + RK.miniHead('#5AA8FF') + RK.miniHead('#4FE3C1') + '</div><div class="tx">' + fmt(w.t || '팀원 루키 3명이 기다려요') + '<small>' + fmt(w.s || '팀 연결은 다음 업데이트에서 (지금은 예시)') + '</small></div></div>',
    compare: w => '<div class="compare vis" id="' + (w.id || 'cmp') + '"><div class="' + (w.aOk ? 'ok' : 'bad') + '"><small>' + esc(w.aLabel || '팀장님의 답') + '</small>' + fmt(w.a) + '</div><div class="' + (w.bOk ? 'ok' : 'bad') + '"><small>' + esc(RK.plain(w.bLabel || '{name}의 행동')) + '</small>' + fmt(w.b) + '</div></div>',
    study: w => '<div class="card vis" id="learn"><div class="lbl">📚 ' + esc(RK.plain(w.label || '예시로 공부 중')) + '</div><div class="chips" id="chips"></div><div class="bar"><i id="lbar"></i></div>' + (w.note ? '<div class="note">' + fmt(w.note) + '</div>' : '') + '</div>'
  };
  RK.W = W;
  function rulesRows(w) {
    const rows = (w.rows || []).map(r => '<div class="rule">' + fmt(r) + '</div>');
    (w.notes || []).forEach(k => { const n = RK.state.notebook[k]; if (n) rows.push('<div class="rule nb" data-note="' + k + '">수첩 ' + n.no + ': ' + esc(n.rule) + '</div>'); });
    return rows.join('');
  }
  P.show = async step => { RK.panel((step.w || []).map(w => W[w.k](w)).join('')); };
  P.add = async step => {
    (step.w || []).forEach(w => {
      const html = W[w.k](w);
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      const id = tmp.firstElementChild && tmp.firstElementChild.id;
      const old = id && $('#' + id);
      if (old) { old.outerHTML = html; RK.panelVer++; } else RK.panelAdd(html);
    }); if (step.scroll !== false) { const p = $('#panel').lastElementChild; if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest', behavior: RK.settings.fast ? 'auto' : 'smooth' }); } };

  // 루키가 규칙표 + 수첩 규칙으로 문의를 나눔 (AI 없음: 낱말 포함 규칙 → 분기)
  RK.classify = (q, base, notes) => {
    const rules = (base || []).slice();
    (notes || []).forEach(k => { const n = RK.state.notebook[k]; if (n && n.apply) rules.push(n.apply); });
    for (const r of rules) if (r.kw && r.kw.some(k => q.includes(k))) return { to: r.to, by: r };
    for (const r of rules) if (r.fallback) return { to: r.fallback, by: r };
    return { to: null, by: null };
  };
  P.inbox = async step => {
    const box = $('#' + (step.into || 'inbox'));
    if (step.reset) box.innerHTML = '';
    const rw = $('#' + (step.rulesId || 'rules') + ' .rulerows');
    if (rw && step.notes) { rw.innerHTML = rulesRows({ rows: step.baseRows || [], notes: step.notes }); $$('.rule.nb', rw).forEach(x => x.classList.add('flash')); }
    RK.sayObj(step.say);
    if (step.send) await RK.act(step.send, 'primary', { kind: 'go', step });
    const rows = step.msgs.map(m => {
      const row = document.createElement('div'); row.className = 'msgrow';
      row.innerHTML = '<div class="msg">📩 ' + fmt(m.q) + '</div><div class="tag wait">' + '확인 중…' + '</div>';
      box.appendChild(row); return row;
    });
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      RK.mood('think'); await RK.wait(750);
      const m = step.msgs[i];
      const c = RK.classify(m.q, step.rules, step.notes);
      const t = rows[i].querySelector('.tag');
      const label = c.to || '분류 못 함';
      const right = c.to === m.truth;
      t.className = 'tag ' + (c.to == null ? 'unk' : right ? 'ok' : 'bad');
      t.textContent = (c.to == null ? '? ' : right ? '✓ ' : '✗ ') + label + (c.by && c.by.note ? ' (수첩 ' + c.by.note + ')' : '');
      if (c.to && !right && step.showTruth) rows[i].insertAdjacentHTML('beforeend', '<div class="truth">실제: ' + esc(m.truth) + '</div>');
      out.push({ q: m.q, to: c.to, right });
    }
    RK.lastInbox = out;
    RK.mood('normal');
    return out;
  };
  P.study = async step => {
    RK.panelAdd(W.study(step));
    RK.mood('think'); RK.sayObj(step.say);
    const ex = step.chips || [];
    for (let i = 0; i < ex.length; i++) {
      const s = document.createElement('span'); s.textContent = RK.plain(ex[i]); $('#chips').appendChild(s);
      $('#lbar').style.width = Math.round((i + 1) / ex.length * 100) + '%';
      await RK.wait(200);
    }
    await RK.wait(250);
  };
  P.draft = async step => {
    if (!$('#' + (step.into || 'draft'))) RK.panelAdd(W.draft({ id: step.into, label: step.label }));
    const box = $('#' + (step.into || 'draft') + ' .spotlines');
    RK.mood('think'); RK.sayObj(step.say);
    for (const l of step.lines) { await RK.wait(550); box.insertAdjacentHTML('beforeend', '<div class="dl">' + fmt(l.t) + '</div>'); }
    const tip = $('#' + (step.into || 'draft') + 'Tip'); if (tip) tip.textContent = step.doneTip || '초안 완성';
  };
  P.log = async step => {
    let el = step.into ? $('#' + step.into) : $('#' + (step.id || 'log'));
    if (!el) { RK.panelAdd(W.log({ id: step.id || 'log' })); el = $('#' + (step.id || 'log')); }
    else if (step.clear) el.innerHTML = '';
    RK.mood('think'); RK.sayObj(step.say);
    for (const t of step.lines) {
      await RK.wait(650);
      const d = document.createElement('div'); d.textContent = RK.plain(t); if (/^⚠/.test(t)) d.className = 'warn'; el.appendChild(d);
    }
    await RK.wait(250);
  };

  /* 수첩 값에 따라 갈래 (AI 없이 규칙 + 분기) */
  P.branch = async step => {
    const n = RK.state.notebook[step.note];
    let list;
    if (step.cases && n && step.cases[n.k]) list = step.cases[n.k];
    else list = (n && n.ok) ? step.ok : step.bad;
    await RK.runSteps(list || []);
  };

  /* 수첩 규칙을 실제 일에 적용 → 틀린 규칙이면 결과를 보여 주고 다시 가르치게 함 (고칠 때까지 반복, 도움 3단계) */
  P.apply = async step => {
    let attempt = 0; const used = [];
    for (; ;) {
      await RK.runSteps(step.run || []);
      const n = RK.state.notebook[step.note];
      if (n && n.ok) break;
      if (n && !used.includes(n.k)) used.push(n.k);
      const bad = Array.isArray(step.bad) ? step.bad : ((step.bad || {})[n && n.k] || step.bad.default || []);
      await RK.runSteps(bad);
      attempt++;
      const rt = typeof step.reteach === 'string' ? RK.findStep(step.reteach) : step.reteach;
      await P.teach(rt, { attempt, used, where: step.where || '결과 보고 다시 가르침' });
    }
    if (attempt) RK.record((step.id || step.note) + '-applied', false, attempt + 1, 0);
  };

  // 강 안에서 id로 장면 찾기 (같은 수첩 칸을 다시 가르칠 때 재사용)
  RK.findStep = id => {
    let hit = null;
    const walk = v => { if (hit || !v || typeof v !== 'object') return; if (Array.isArray(v)) { v.forEach(walk); return; } if (v.id === id && v.type) { hit = v; return; } Object.values(v).forEach(walk); };
    walk(RK.lecture);
    if (!hit) throw new Error('장면을 찾지 못했어요: ' + id);
    return hit;
  };
  RK.runSteps = async steps => {
    for (const s of steps) {
      const f = P[s.type];
      if (!f) { console.warn('모르는 장면 종류:', s.type); continue; }
      await f(s);
    }
  };
})(window.RK);
