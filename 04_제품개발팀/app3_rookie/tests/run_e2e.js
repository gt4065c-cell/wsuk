// 루키 1강 끝까지 자동 시험 (Playwright, 휴대폰 360px)
// 실행: node 04_제품개발팀/app3_rookie/tests/run_e2e.js
// - 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)를 띄워 시험하고 끝나면 끕니다. 외부 공개 없음.
// - 가짜 학생 2명: ① 맞게 가르친 학생(또롱이, 보통 속도, 손가락 끌기 1번)
//                 ② 틀리게 가르친 학생(삐삐, 빠른 진행, 낮은 휴대폰 360x640, 일부러 여러 번 틀림)
//   → 새 사례 문제에서 루키 행동이 서로 달라지는지, 틀리게 가르친 학생이 보고 고칠 수 있는지 확인
// - 그 밖에: 중간에 나갔다 이어 하기, 1강에 안 쓰인 부품 4종(시험장 강), 콘솔 오류 0 · 외부 요청 0 · 가로 넘침 0 · 14px 미만 글자 0
// - 결과: 화면 + tests/e2e_results.json, 스크린샷 tests/screenshots/
const path = require('path');
const fs = require('fs');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const APP = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const L1 = JSON.parse(fs.readFileSync(path.join(APP, 'content', 'lecture01.json'), 'utf8'));
const FIX99 = fs.readFileSync(path.join(__dirname, 'fixtures', 'lecture99.json'), 'utf8');

/* ---------- 임시 서버 ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(APP, p);
  if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('없음'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

const results = [];
function ok(c, m) { if (!c) throw new Error(m); }
async function test(id, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, status: 'pass', note: note || '', ms: Date.now() - t0 }); console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ id, name, status: 'fail', note: String(e && e.message || e), ms: Date.now() - t0 }); console.log(`  [실패] ${id} ${name} — ${e && e.message}`); }
}

let browser, BASE;
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page._errors = []; page._external = [];
  page.on('pageerror', e => page._errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page._errors.push('console: ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith(BASE)) page._external.push(r.url()); });
  await page.route('**/content/lecture99.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: FIX99 }));
  return { ctx, page };
}

/* ---------- 화면 점검 (매 장면마다): 가로 넘침, 14px 미만 글자 ---------- */
async function inspect(page) {
  return page.evaluate(() => {
    const W = window.innerWidth;
    const de = document.documentElement;
    const over = [];
    if (de.scrollWidth > W + 1) over.push('문서 폭 ' + de.scrollWidth + 'px');
    const ov = document.getElementById('overlay');
    if (ov && !ov.classList.contains('hidden') && ov.scrollWidth > ov.clientWidth + 1) over.push('덮개 폭 ' + ov.scrollWidth + 'px');
    const small = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      const el = n.parentElement; if (!el || el.closest('svg')) continue;
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 14) small.push(fs + 'px "' + n.nodeValue.trim().slice(0, 20) + '"');
    }
    // 눈에 보이는 버튼이 화면 오른쪽 밖으로 나갔는지
    document.querySelectorAll('button, .choice, .task, .key, .bin').forEach(b => {
      const r = b.getBoundingClientRect(); if (r.width && r.right > W + 1 && !b.closest('#toast')) over.push('버튼 밖으로: ' + (b.textContent || '').trim().slice(0, 15) + ' ' + Math.round(r.right));
    });
    const nlog = document.getElementById('nlog');
    return { over, small: small.slice(0, 5), nlog: nlog ? nlog.innerText : null, together: !!document.querySelector('.together'), hint: !!document.querySelector('.hintme'), cmp: (document.getElementById('cmpN') || {}).innerText || null };
  });
}

/* ---------- 가짜 학생 (화면에 보이는 버튼을 실제로 누름) ---------- */
// 장면 종류(body[data-step])와 내용(RK.cur.meta)을 읽고, 전략대로 누를 곳을 고름
function planInPage(S) {
  const c = window.RK && RK.cur; if (!c) return { wait: true };
  const t = c.type, m = c.meta || {};
  const sel = s => document.querySelector(s);
  const vis = s => { const e = sel(s); return e && e.getClientRects().length && !e.disabled ? s : null; };
  const W = S.wrongDone || {};
  const wantWrong = id => id && (S.wrong[id] || 0) > (W[id] || 0);
  switch (t) {
    case 'home': return { acts: [{ fill: '#rkName', v: S.name }, { click: '#startBtn' }].filter(a => !a.fill || sel('#rkName')), kind: 'go' };
    case 'talk': case 'go': return vis('#actBtn') ? { acts: [{ click: '#actBtn' }], kind: t } : { wait: true };
    case 'card': return { acts: [{ click: '#cardBtn' }], kind: 'card' };
    case 'levelup': return { acts: [{ click: '#lvBtn' }], kind: 'card' };
    case 'final': return { done: true };
    case 'pick': case 'reply': {
      const host = m.inSwipe ? '#swQuiz' : '#actions';
      const opts = m.opts; const id = m.step && m.step.id;
      const btns = [...document.querySelectorAll(host + ' .choice')];
      let i = opts.findIndex(o => o.ok); if (i < 0) i = 0;
      if (wantWrong(id)) { const j = btns.findIndex((b, k) => !b.disabled && !opts[k].ok); if (j >= 0) return { acts: [{ click: host + ' .choice[data-i="' + j + '"]' }], tagWrong: id, kind: 'hand' }; }
      return { acts: [{ click: host + ' .choice[data-i="' + i + '"]' }], kind: 'hand' };
    }
    case 'teach': {
      const opts = m.opts, note = m.note;
      const want = m.attempt ? S.reteach : (S.teach[note] || 'ok');
      let i = want === 'ok' ? opts.findIndex(o => o.ok) : opts.findIndex(o => o.k === want);
      const b = sel('#actions .choice[data-i="' + i + '"]');
      if (i < 0 || !b || b.disabled) i = opts.findIndex(o => o.ok);
      return { acts: [{ click: '#actions .choice[data-i="' + i + '"]' }], kind: 'hand', teach: note + ':' + opts[i].k };
    }
    case 'spot': {
      const st = m.step, box = '#' + (st.into || 'spot') + ' .spotlines';
      const lines = st.lines;
      if (wantWrong(st.id)) { const j = lines.findIndex(l => !l.bad); return { acts: [{ click: box + ' button[data-i="' + j + '"]' }], tagWrong: st.id, kind: 'hand' }; }
      const j = lines.findIndex((l, k) => l.bad && !sel(box + ' button[data-i="' + k + '"]').classList.contains('found'));
      return { acts: [{ click: box + ' button[data-i="' + j + '"]' }], kind: 'hand' };
    }
    case 'sort': {
      const st = m.step; const it = sel('#tray .task'); if (!it) return { wait: true };
      const item = st.items[+it.dataset.i];
      const s1 = '#tray .task[data-i="' + it.dataset.i + '"]';
      if (wantWrong(st.id)) { const wk = st.bins.find(b => b.k !== item.k).k; return { acts: [{ click: s1 }, { click: '#sortCard .bin[data-k="' + wk + '"]' }], tagWrong: st.id, kind: 'hand' }; }
      const target = '#sortCard .bin[data-k="' + item.k + '"]';
      if (S.drag && !S.dragged) return { acts: [{ drag: s1, to: target }], kind: 'hand', dragged: true };
      return { acts: [{ click: s1 }, { click: target }], kind: 'hand' };
    }
    case 'give': {
      const st = m.step; const items = st.items;
      let i;
      if (wantWrong(st.id)) i = items.findIndex(x => x.reject);
      else { const want = S.give[st.id] || 'ok'; i = want === 'ok' ? items.findIndex(x => x.ok) : items.findIndex(x => x.k === want); }
      return { acts: [{ click: '#keys .key[data-i="' + i + '"]' }, { click: '#dz' }], tagWrong: wantWrong(st.id) ? st.id : null, kind: 'hand' };
    }
    case 'swipe': return { acts: [{ click: '#swNext' }], kind: 'hand' };
    case 'exam': { const q = m.q; const j = (S.exam[q.id] != null) ? S.exam[q.id] : q.a; return { acts: [{ click: '#quizCard .choice[data-j="' + j + '"]' }], kind: 'exam', exam: q.id + ':' + j }; }
    case 'match': {
      const st = m.step; const pairs = Object.fromEntries(st.pairs);
      const l = [...document.querySelectorAll('#matchCard .mi[data-side="l"]')].find(x => !x.disabled); if (!l) return { wait: true };
      const a = l.dataset.id;
      let r = pairs[a];
      if (wantWrong(st.id)) { r = st.right.map(x => x.id).find(x => x !== pairs[a] && !sel('#matchCard .mi[data-side="r"][data-id="' + x + '"]').disabled); return { acts: [{ click: '#matchCard .mi[data-side="l"][data-id="' + a + '"]' }, { click: '#matchCard .mi[data-side="r"][data-id="' + r + '"]' }], tagWrong: st.id, kind: 'hand' }; }
      return { acts: [{ click: '#matchCard .mi[data-side="l"][data-id="' + a + '"]' }, { click: '#matchCard .mi[data-side="r"][data-id="' + r + '"]' }], kind: 'hand' };
    }
    case 'order': {
      const st = m.step;
      if (wantWrong(st.id)) return { acts: [{ click: '#actBtn' }], tagWrong: st.id, kind: 'hand' };
      const rows = [...document.querySelectorAll('#ordList .ord')].map(r => st.items[+r.dataset.i].ord);
      for (let p = 0; p < rows.length - 1; p++) if (rows[p] > rows[p + 1]) return { acts: [{ click: '#ordList button[data-mv="1"][data-p="' + p + '"]' }], kind: 'hand', again: true };
      return { acts: [{ click: '#actBtn' }], kind: 'hand' };
    }
    case 'fill': {
      const st = m.step;
      const bl = [...document.querySelectorAll('#fillCard .blank')].find(b => !b.classList.contains('ok')); if (!bl) return { wait: true };
      const ans = st.blanks.find(b => String(b.id) === bl.dataset.b).ans;
      const chips = [...document.querySelectorAll('#fillCard .chipbtn')];
      let ci = chips.findIndex(c => !c.classList.contains('used') && (wantWrong(st.id) ? !ans.includes(c.textContent) : ans.includes(c.textContent)));
      return { acts: [{ click: '#fillCard .blank[data-b="' + bl.dataset.b + '"]' }, { click: '#fillCard .chipbtn[data-c="' + chips[ci].dataset.c + '"]' }], tagWrong: wantWrong(st.id) ? st.id : null, kind: 'hand' };
    }
    case 'build': {
      const st = m.step;
      if (wantWrong(st.id)) { const trap = st.parts.find(p => !p.fit.length); return { acts: [{ click: '#bparts .chipbtn[data-p="' + trap.id + '"]' }, { click: '#slots .slot[data-s="q"]' }], tagWrong: st.id, kind: 'hand' }; }
      const s = [...document.querySelectorAll('#slots .slot')].find(x => !x.disabled); if (!s) return { wait: true };
      const p = st.parts.find(pp => pp.fit.includes(s.dataset.s));
      return { acts: [{ click: '#bparts .chipbtn[data-p="' + p.id + '"]' }, { click: '#slots .slot[data-s="' + s.dataset.s + '"]' }], kind: 'hand' };
    }
  }
  return { wait: true };
}

async function play(page, S, opts = {}) {
  const log = { steps: 0, kinds: {}, teach: [], exam: [], over: [], small: [], nlog: [], cmp: [], together: false, hint: false, shots: [] };
  S.wrongDone = {};
  let lastSeq = null;
  const t0 = Date.now();
  const stopAt = opts.stopAt || (() => false);
  for (let guard = 0; guard < 600; guard++) {
    // 새 장면 기다리기
    let seq;
    for (let k = 0; k < 400; k++) {
      seq = await page.evaluate(() => document.body.dataset.seq || null);
      if (seq && seq !== lastSeq) break;
      if (log.again) break;
      await page.waitForTimeout(50);
    }
    log.again = false;
    const insp = await inspect(page);
    insp.over.forEach(o => log.over.push(o)); insp.small.forEach(o => log.small.push(o));
    if (insp.nlog && log.nlog[log.nlog.length - 1] !== insp.nlog) log.nlog.push(insp.nlog);
    if (insp.cmp && log.cmp[log.cmp.length - 1] !== insp.cmp) log.cmp.push(insp.cmp);
    log.together = log.together || insp.together; log.hint = log.hint || insp.hint;
    if (await stopAt(page)) { log.stopped = true; break; }
    const plan = await page.evaluate(planInPage, S);
    if (plan.done) break;
    if (plan.wait) { await page.waitForTimeout(80); lastSeq = null; continue; }
    const type = await page.evaluate(() => RK.cur.type);
    if (opts.shotsAt && opts.shotsAt.includes(log.steps)) { const f = path.join(SHOTS, `${S.label}_${String(log.steps).padStart(3, '0')}_${type}.png`); await page.screenshot({ path: f }); log.shots.push(path.basename(f)); }
    for (const a of plan.acts) {
      if (a.fill) { await page.fill(a.fill, a.v); continue; }
      if (a.drag) {
        const s = await page.locator(a.drag).boundingBox(), d = await page.locator(a.to).boundingBox();
        await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(s.x + s.width / 2 + (d.x + d.width / 2 - s.x - s.width / 2) * i / 8, s.y + s.height / 2 + (d.y + d.height / 2 - s.y - s.height / 2) * i / 8);
        await page.mouse.up(); S.dragged = true; log.dragged = true; continue;
      }
      await page.locator(a.click).first().click({ timeout: 5000 });
    }
    if (plan.tagWrong) S.wrongDone[plan.tagWrong] = (S.wrongDone[plan.tagWrong] || 0) + 1;
    if (plan.teach) log.teach.push(plan.teach);
    if (plan.exam) log.exam.push(plan.exam);
    log.kinds[plan.kind] = (log.kinds[plan.kind] || 0) + 1;
    log.kinds['type:' + type] = (log.kinds['type:' + type] || 0) + 1;
    log.steps++;
    lastSeq = seq;
    if (plan.again) log.again = true;
  }
  log.ms = Date.now() - t0;
  log.state = await page.evaluate(() => JSON.parse(localStorage.getItem('rk3.save.v1') || 'null'));
  log.screens = await page.evaluate(() => RK.screens.map(s => ({ type: s.type, panel: s.panel, visual: s.visual })));
  return log;
}

// 글만 있는 화면 2개 연속 찾기: 대사(talk) 장면 중 작업판에 그림·조작이 하나도 없는 화면
function textOnlyRuns(screens) {
  const scr = []; // 화면 단위로 묶기(작업판이 바뀌기 전까지의 같은 종류 = 한 화면)
  screens.forEach(s => { const k = (s.type === 'talk' && !s.visual) ? 'text' : 'other'; const last = scr[scr.length - 1]; if (last && last.k === k && last.panel === s.panel) return; scr.push({ k, panel: s.panel }); });
  let run = 0, max = 0; scr.forEach(s => { run = s.k === 'text' ? run + 1 : 0; max = Math.max(max, run); });
  return max;
}
// 사람이 했을 때 걸리는 시간 어림: 연출 시간(실측) + 대사 넘기기 3.5초 + 조작 5초 + 평가 문제 25초 + 카드 4초
function estimateMinutes(log) {
  const k = log.kinds;
  const talk = (k.talk || 0) + (k.go || 0), hand = k.hand || 0, exam = k.exam || 0, card = k.card || 0;
  const sec = log.ms / 1000 + talk * 3.5 + hand * 5 + exam * 25 + card * 4;
  return { minutes: Math.round(sec / 6) / 10, talk, hand, exam, card, animSec: Math.round(log.ms / 1000) };
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
  console.log('루키 1강 자동 시험 — ' + BASE);

  const GOOD = { label: 'good', name: '또롱이', teach: { R1: 'exact', R2: 'check' }, give: { 'L01-T4-give': 'record' }, reteach: 'ok', exam: {}, wrong: {}, drag: true };
  const BAD = { label: 'bad', name: '삐삐', teach: { R1: 'all', R2: 'direct' }, give: { 'L01-T4-give': 'master' }, reteach: 'ok', exam: { 'L01-Q4': 3, 'L01-N1': 0 },
    wrong: { 'L01-T1-why': 2, 'L01-T2-spot': 3, 'L01-T5-sort': 1, 'L01-T4-give': 1, 'L01-T2-old': 1, 'L01-I-swipe': 0 }, drag: false };
  const runs = {};

  /* ① 맞게 가르친 학생 — 보통 속도, 360x740 */
  await test('S1', '가짜 학생 ① 맞게 가르친 학생(또롱이) 360x740 끝까지', async () => {
    const { ctx, page } = await newPage({ width: 360, height: 740 });
    await page.goto(BASE);
    const log = await play(page, GOOD, { shotsAt: [0, 2, 8, 14, 22, 30, 40, 50, 60, 70, 80] });
    await page.screenshot({ path: path.join(SHOTS, 'good_final.png'), fullPage: true });
    log.errors = page._errors; log.external = page._external;
    runs.good = log; await ctx.close();
    ok(log.state && log.state.cleared && log.state.cleared['1'], '1강 수료 기록 없음');
    return `장면 ${log.steps}개, ${Math.round(log.ms / 1000)}초(연출 실측)`;
  });

  /* ② 틀리게 가르친 학생 — 빠른 진행, 낮은 휴대폰 360x640 */
  await test('S2', '가짜 학생 ② 틀리게 가르친 학생(삐삐) 360x640·빠른 진행 끝까지', async () => {
    const { ctx, page } = await newPage({ width: 360, height: 640 });
    await page.goto(BASE);
    await page.click('#fastSwitch');
    const log = await play(page, BAD, { shotsAt: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] });
    await page.screenshot({ path: path.join(SHOTS, 'bad_final.png'), fullPage: true });
    log.errors = page._errors; log.external = page._external;
    log.fast = await page.evaluate(() => JSON.parse(localStorage.getItem('rk3.settings.v1') || '{}').fast);
    runs.bad = log; await ctx.close();
    ok(log.state && log.state.cleared && log.state.cleared['1'], '1강 수료 기록 없음');
    return `장면 ${log.steps}개, ${Math.round(log.ms / 1000)}초`;
  });

  const g = runs.good, b = runs.bad;
  await test('K1', '루키 규칙 수첩: 고른 규칙이 저장됨', async () => {
    ok(g && b, '실행 기록 없음');
    const gn = g.state.notebook, bn = b.state.notebook;
    ok(gn.R1.k === 'exact' && gn.R2.k === 'check' && gn.R3.k === 'record', '맞게 가르친 학생 수첩: ' + JSON.stringify([gn.R1.k, gn.R2.k, gn.R3.k]));
    ok(bn.R1.history[0].k === 'all' && bn.R2.history[0].k === 'direct' && bn.R3.history[0].k === 'master', '틀리게 가르친 학생의 처음 규칙이 저장되지 않음');
    return '또롱이: ' + [gn.R1, gn.R2, gn.R3].map(x => x.rule).join(' / ') + ' | 삐삐 처음: ' + [bn.R1, bn.R2, bn.R3].map(x => x.history[0].rule).join(' / ');
  });
  await test('K2', '다음 업무에서 루키가 수첩대로 행동 → 틀리게 가르친 학생이 보고 고침', async () => {
    const bn = b.state.notebook;
    ok(bn.R1.history.length === 2 && bn.R1.history[1].k === 'exact' && /업무 2/.test(bn.R1.history[1].where), '수첩 1번이 업무 2에서 고쳐지지 않음: ' + JSON.stringify(bn.R1.history));
    ok(bn.R2.history.length === 2 && bn.R2.history[1].k === 'check' && /업무 3/.test(bn.R2.history[1].where), '수첩 2번이 업무 3에서 고쳐지지 않음');
    ok(g.state.notebook.R1.history.length === 1 && g.state.notebook.R2.history.length === 1, '맞게 가르친 학생은 고칠 일이 없어야 함');
    return '삐삐: 업무 2(도서관 문의가 학사로 감) → 수첩 1번 고침, 업무 3(확인 없이 게시판에 올림) → 수첩 2번 고침';
  });
  await test('K3', '강 끝 새 사례에서 루키 행동이 달라짐 (가르친 대로)', async () => {
    const gl = g.nlog.join('\n'), bl = b.nlog;
    ok(/거절/.test(gl) && !/95/.test(gl), '맞게 가르친 루키가 점수 변경을 거절하지 않음: ' + gl);
    ok(bl.length >= 2, '틀리게 가르친 학생의 새 사례 기록이 2번(틀림 → 고친 뒤) 나와야 함: ' + bl.length);
    ok(/72 → 95/.test(bl[0]) && /마스터키/.test(bl[0]), '틀리게 가르친 루키가 마스터키로 점수를 바꾸지 않음: ' + bl[0]);
    ok(/거절/.test(bl[bl.length - 1]), '고친 뒤 루키가 거절하지 않음');
    const bn = b.state.notebook.R3;
    ok(bn.history.length === 2 && bn.history[1].k === 'record' && /새 사례/.test(bn.history[1].where), '수첩 3번이 새 사례에서 고쳐지지 않음');
    return '또롱이 루키: "' + g.nlog[g.nlog.length - 1].split('\n').slice(-1)[0] + '" / 삐삐 루키(처음): "' + bl[0].split('\n').slice(-1)[0] + '" → 고친 뒤: "' + bl[bl.length - 1].split('\n').slice(-1)[0] + '"';
  });
  await test('K4', '별은 첫 선택만, Lv = 수료한 강 수(1), 직급·장식 이름', async () => {
    ok(g.state.cleared['1'].stars === 3, '또롱이 별 ' + g.state.cleared['1'].stars);
    ok(b.state.cleared['1'].stars === 1, '삐삐 별 ' + b.state.cleared['1'].stars + ' (Q4·새 사례 첫 선택 오답 → 1개여야 함)');
    ok(g.state.lv === 1 && b.state.lv === 1, 'Lv ' + g.state.lv + '/' + b.state.lv);
    const exQ = g.state.records.filter(r => /^L01-[QN]/.test(r.id)).length;
    ok(exQ === 3, '평가 기록 수 ' + exQ);
    return '또롱이 ★★★ · 삐삐 ★☆☆ (틀린 뒤 다시 골라도 별은 안 바뀜) · 둘 다 Lv.1 · 수습 · 사원증';
  });
  await test('K5', '틀리면 도움 3단계(힌트 → 자리 표시 → 같이 하기), 막히지 않음', async () => {
    ok(b.hint, '자리 표시(노란 점선) 장면이 한 번도 안 보임');
    ok(b.together, '"함께 ✓"(같이 하기) 장면이 한 번도 안 보임');
    const sp = b.state.records.find(r => r.id === 'L01-T2-spot');
    ok(sp && sp.firstTry === false && sp.tries >= 3, '업무 2 틀린 줄 찾기 기록: ' + JSON.stringify(sp));
    const why = b.state.records.find(r => r.id === 'L01-T1-why');
    ok(why && !why.firstTry, '업무 1 고르기 기록');
    return '틀린 줄 찾기 3번 틀림 → 같이 하기로 통과, 고르기 2번 틀림 → 자리 표시, 건네기·분류도 오답 후 계속 진행';
  });
  await test('K6', '오류 0 · 외부 요청 0 · 가로 넘침 0 · 14px 미만 글자 0 (두 학생 모두)', async () => {
    [g, b].forEach((r, i) => {
      const who = i ? '삐삐' : '또롱이';
      ok(!r.errors.length, who + ' 오류: ' + r.errors.join(' | '));
      ok(!r.external.length, who + ' 외부 요청: ' + r.external.join(' '));
      ok(!r.over.length, who + ' 가로 넘침: ' + [...new Set(r.over)].slice(0, 5).join(' | '));
      ok(!r.small.length, who + ' 작은 글자: ' + [...new Set(r.small)].slice(0, 5).join(' | '));
    });
    return '두 학생 모든 장면 점검 (' + (g.steps + b.steps) + '번)';
  });
  await test('K7', '재미 규칙: 손 조작 3번 이상, 글만 있는 화면 2개 연속 없음, 손가락 끌기', async () => {
    const gm = estimateMinutes(g);
    ok(gm.hand >= 3, '손 조작 ' + gm.hand + '번');
    const tr = Math.max(textOnlyRuns(g.screens), textOnlyRuns(b.screens));
    ok(tr < 2, '글만 있는 화면이 ' + tr + '개 연속');
    ok(g.dragged, '손가락 끌기 시험 안 됨');
    return `또롱이 손 조작 ${gm.hand}번 / 대사 넘기기 ${gm.talk}번 / 평가 ${gm.exam} / 카드 ${gm.card}, 글만 있는 화면 최대 연속 ${tr}개`;
  });
  await test('K8', '한 강 5~8분 안 (사람 속도 어림, 범위)', async () => {
    const gm = estimateMinutes(g), bm = estimateMinutes(b);
    // 빠르게 읽는 사람 = 위 기준, 처음 하는 사람 = 사람 몫(읽기·조작) 1.3배. 처음 하는 사람이 5~8분 안이면 통과
    const first = Math.round((gm.animSec + (gm.minutes * 60 - gm.animSec) * 1.3) / 6) / 10;
    ok(first >= 5 && first <= 8 && gm.minutes <= 8, '처음 하는 사람 어림 ' + first + '분 / 빠른 사람 ' + gm.minutes + '분');
    return `또롱이 빠른 사람 약 ${gm.minutes}분 ~ 처음 하는 사람 약 ${first}분 (연출 실측 ${gm.animSec}초 + 대사 ${gm.talk}×3.5초 + 조작 ${gm.hand}×5초 + 평가 ${gm.exam}×25초 + 카드 ${gm.card}×4초) · 삐삐(빠른 진행·틀리고 고침) 약 ${bm.minutes}분`;
  });

  /* ③ 중간에 나갔다 이어 하기 */
  await test('R1', '업무 1 끝내고 나가기 → 다시 열면 "업무 2부터 이어 하기"', async () => {
    const { ctx, page } = await newPage({ width: 360, height: 740 });
    await page.goto(BASE); await page.click('#fastSwitch');
    const S = Object.assign({}, GOOD, { label: 'resume', drag: false });
    await play(page, S, { stopAt: async p => p.evaluate(() => RK.cur && RK.cur.type !== 'card' && /업무 2\/5/.test(document.getElementById('mtitle').textContent)) });
    await page.click('#exitBtn');
    await page.waitForSelector('#startBtn', { timeout: 5000 });
    const label = await page.textContent('#startBtn');
    ok(/업무 2부터 이어 하기/.test(label), '이어 하기 버튼 글: ' + label);
    await page.click('#startBtn');
    await page.waitForFunction(() => /업무 2\/5/.test(document.getElementById('mtitle').textContent), null, { timeout: 5000 });
    const nb = await page.evaluate(() => RK.state.notebook.R1 && RK.state.notebook.R1.k);
    ok(nb === 'exact', '수첩 1번이 이어 하기 뒤 사라짐: ' + nb);
    ok(!page._errors.length, '오류: ' + page._errors.join(' | '));
    await ctx.close();
    return label.trim() + ' → 업무 2/5부터, 수첩 1번 그대로';
  });

  /* ④ 1강에 안 쓰인 부품 4종 (짝·순서·빈칸·만들기) */
  await test('P1', '부품 시험장: 짝 맞추기·순서 맞추기·빈칸 채우기·미니 만들기 (틀림 포함)', async () => {
    const { ctx, page } = await newPage({ width: 360, height: 740 });
    await page.goto(BASE + '?lecture=99'); await page.click('#fastSwitch');
    const S = { label: 'parts', name: '루키', teach: {}, give: {}, reteach: 'ok', exam: {}, wrong: { 'T99-match': 1, 'T99-order': 1, 'T99-fill': 1, 'T99-build': 3 } };
    const log = await play(page, S, { shotsAt: [3, 6, 9, 14] });
    ok(!page._errors.length, '오류: ' + page._errors.join(' | '));
    ok(!page._external.length, '외부 요청');
    ok(!log.over.length, '가로 넘침: ' + log.over.slice(0, 3).join(' | '));
    ok(!log.small.length, '작은 글자: ' + log.small.slice(0, 3).join(' | '));
    const ids = log.state.records.map(r => r.id);
    ['T99-match', 'T99-order', 'T99-fill', 'T99-build'].forEach(id => ok(ids.includes(id), id + ' 기록 없음'));
    ok(log.state.records.filter(r => /^T99/.test(r.id)).every(r => r.firstTry === false), '일부러 틀린 기록이 firstTry=false 가 아님');
    await ctx.close();
    return '4종 모두 끝까지, 틀린 뒤에도 진행';
  });

  await browser.close(); server.close();
  const pass = results.filter(r => r.status === 'pass').length;
  const summary = { at: new Date().toISOString(), pass, fail: results.length - pass, results,
    good: g && { steps: g.steps, ms: g.ms, kinds: g.kinds, teach: g.teach, exam: g.exam, newCaseLog: g.nlog, compare: g.cmp, notebook: g.state.notebook, estimate: estimateMinutes(g), shots: g.shots },
    bad: b && { steps: b.steps, ms: b.ms, kinds: b.kinds, teach: b.teach, exam: b.exam, newCaseLog: b.nlog, compare: b.cmp, notebook: b.state.notebook, estimate: estimateMinutes(b), shots: b.shots } };
  fs.writeFileSync(path.join(__dirname, 'e2e_results.json'), JSON.stringify(summary, null, 2));
  console.log(`\n결과: ${pass}/${results.length} 통과 → tests/e2e_results.json`);
  process.exitCode = summary.fail ? 1 : 0;
})().catch(async e => { console.error(e); try { await browser.close(); } catch (_) { } server.close(); process.exitCode = 1; });
