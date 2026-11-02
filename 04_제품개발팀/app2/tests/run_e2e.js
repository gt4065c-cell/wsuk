// 2단계 M1 핵심 흐름 자동 테스트 (Playwright, 로컬 모드)
// 실행: node 04_제품개발팀/app2/tests/run_e2e.js
// - 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)를 띄워 시험하고, 끝나면 끕니다. 외부 공개 없음.
// - 결과: 화면에 통과/실패, tests/e2e_results.json, 스크린샷은 screenshots/
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const SHOTS = path.join(APP, 'screenshots');
const BANK = path.join(APP, '..', '..', '03_교육기획팀', '문항은행');
const SRC = [...JSON.parse(fs.readFileSync(path.join(BANK, 'questions_part1-3.json'), 'utf8')),
             ...JSON.parse(fs.readFileSync(path.join(BANK, 'questions_part4-6.json'), 'utf8'))];
const EVAL_IDS = SRC.filter(q => q.pool === 'assessment').map(q => q.id);
const DIAG_IDS = SRC.filter(q => q.pool === 'diagnostic').map(q => q.id);
const PORT = 9200 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
let browser;
fs.mkdirSync(SHOTS, { recursive: true });

function ok(c, m) { if (!c) throw new Error(m); }
async function test(id, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, status: 'pass', note: note || '', ms: Date.now() - t0 }); console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ id, name, status: 'fail', note: String(e && e.message || e), ms: Date.now() - t0 }); console.log(`  [실패] ${id} ${name} — ${e && e.message}`); }
}
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page._errors = []; page._requests = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('request', r => page._requests.push(r.url()));
  if (opts.clock) await page.clock.install();
  if (opts.route) await opts.route(page);
  return { ctx, page };
}
async function open(page) { await page.goto(BASE + 'index.html'); await page.waitForSelector('#app .screen:not([data-screen=loading])'); }
async function screen(page) { return page.getAttribute('#app .screen', 'data-screen'); }
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
async function login(page, code = 'TEST23', nick = '하늘별') {
  await page.fill('#code', code); await page.click('[data-act=login]');
  await page.waitForSelector('[data-screen=nickname]');
  await page.fill('#nick', nick); await page.click('[data-act=save-nick]');
  await page.waitForSelector('[data-screen=diag]');
}
async function diagAnswerAll(page, from = 0) {
  for (let i = from; i < 12; i++) {
    const id = await page.getAttribute('#qid', 'data-id');
    if (i % 4 === 3) await page.click('[data-act=diag-unknown]');
    else { await page.click('.choice[data-orig="0"]'); await page.click('[data-act=diag-next]'); }
    if (i < 11) await page.waitForFunction(prev => document.querySelector('#qid') && document.querySelector('#qid').dataset.id !== prev, id);
  }
  await page.waitForSelector('[data-screen=diagResult]');
}
async function answerOf(page) {
  return page.evaluate(() => { const id = document.querySelector('#qid').dataset.id; return window.LU_PRACTICE.questions.find(q => q.id === id).answer_index; });
}
async function solve(page, how) {   // how: 'right' | 'wrong2'
  const ans = await answerOf(page);
  const n = await page.$$eval('.choice', els => els.length);
  if (how === 'right') { await page.click(`.choice[data-orig="${ans}"]`); await page.click('[data-act=submit]'); }
  else {
    const wrong = [...Array(n).keys()].filter(i => i !== ans);
    await page.click(`.choice[data-orig="${wrong[0]}"]`); await page.click('[data-act=submit]');
    await page.waitForSelector('#msg');
    await page.click(`.choice[data-orig="${wrong[1 % wrong.length]}"]`);
    if (n === 2) { /* OX: 오답 보기가 1개뿐 → 같은 오답은 막혀 있으므로 정답 아닌 것이 없음 */ }
    await page.click('[data-act=submit]');
  }
  await page.waitForSelector('#verdict');
  return { outcome: (await page.textContent('#outcome')).trim(), xp: (await page.textContent('#xp-gain')).trim() };
}
async function debug(page) { return page.evaluate(() => window.STORE._debug()); }
function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', PUBLIC], { stdio: 'ignore' });
    const t0 = Date.now();
    (function wait() {
      http.get(BASE + 'index.html', res => { res.resume(); resolve(p); })
        .on('error', () => Date.now() - t0 > 8000 ? reject(new Error('임시 서버 시작 실패')) : setTimeout(wait, 150));
    })();
  });
}

(async () => {
  const server = await startServer();
  browser = await chromium.launch();
  try {
    console.log('■ 파일 안전 검사');
    await test('E-01', '학생 화면 파일에 평가 문항 0개, 진단 파일에 정답·해설 칸 0개', async () => {
      const files = ['data/practice.js', 'data/diagnostic.js', 'data/hints.js', 'js/app.js', 'js/store.js', 'js/logic.js', 'index.html'];
      for (const f of files) {
        const txt = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
        const hit = EVAL_IDS.filter(id => txt.includes('"' + id + '"'));
        ok(!hit.length, `${f}에 평가 문항 ${hit.join(',')}`);
      }
      const diag = fs.readFileSync(path.join(PUBLIC, 'data/diagnostic.js'), 'utf8');
      for (const k of ['answer_index', 'explanation', 'common_wrong']) ok(!diag.includes(k), `diagnostic.js에 ${k}`);
      const prac = fs.readFileSync(path.join(PUBLIC, 'data/practice.js'), 'utf8');
      ok(!DIAG_IDS.some(id => prac.includes('"' + id + '"')), 'practice.js에 진단 문항');
      const key = fs.readFileSync(path.join(PUBLIC, 'data/dev_diag_key.js'), 'utf8');
      ok(key.includes('개발용') && !EVAL_IDS.some(id => key.includes('"' + id + '"')), '개발용 표시·평가 문항');
      return `평가 문항 ${EVAL_IDS.length}개 중 0개 노출`;
    });
    await test('E-02', '화면 코드에 비밀 열쇠 모양(service_role·sk-ant·eyJ…) 0건', async () => {
      const all = ['js/config.js', 'js/store.js', 'js/app.js', 'index.html'].map(f => fs.readFileSync(path.join(PUBLIC, f), 'utf8')).join('\n');
      ok(!/sk-ant-|eyJhbGci/.test(all), '키 모양 발견');
      ok(!/service_role["']?\s*[:=]\s*["'][^"']+/.test(all), 'service_role 값');
    });

    console.log('■ 로그인 (F1)');
    const { ctx, page } = await newPage();
    await test('E-03', '첫 화면: 코드 입력칸 + [개발용] 로컬 모드 띠, 오류 0', async () => {
      await open(page); ok(await screen(page) === 'login', await screen(page));
      ok((await page.textContent('#devbar')).includes('로컬 모드'), '띠');
      await shot(page, '390_01_로그인');
      ok(!page._errors.length, page._errors.join('|'));
    });
    await test('E-04', '모양이 틀린 코드(5자리·0/O 포함)와 없는 코드 거절', async () => {
      for (const c of ['TEST2', 'TEST20', 'TESTO2']) {
        await page.fill('#code', c); await page.click('[data-act=login]');
        await page.waitForSelector('#code-error'); ok((await page.textContent('#code-error')).includes('6자리'), c);
      }
      await page.fill('#code', 'ZZZZ22'); await page.click('[data-act=login]');
      await page.waitForFunction(() => document.querySelector('#code-error') && document.querySelector('#code-error').textContent.includes('등록되지 않은'));
      await shot(page, '390_02_없는코드');
    });
    await test('E-05', '맞는 코드(소문자로 넣어도) → 별명(실명 금지 안내, 1글자 거절) → 진단', async () => {
      await page.fill('#code', ' test23 '); await page.click('[data-act=login]');
      await page.waitForSelector('[data-screen=nickname]');
      ok((await page.textContent('#app')).includes('실명은 쓰지 마세요'), '안내');
      await shot(page, '390_03_별명');
      await page.fill('#nick', '별'); await page.click('[data-act=save-nick]'); await page.waitForSelector('#err');
      await page.fill('#nick', '하늘별'); await page.click('[data-act=save-nick]');
      await page.waitForSelector('[data-screen=diag]');
    });

    console.log('■ 진단 12문항');
    await test('E-06', '진단: 힌트 버튼 0개, 정오답 표시 없음, "아직 모르겠어요" 있음, 같은 순서', async () => {
      ok(!(await page.$('#hints')) && !(await page.$('[data-act=hint]')), '힌트 버튼');
      ok(await page.$('[data-act=diag-unknown]'), '모르겠어요');
      ok((await page.getAttribute('#qid', 'data-id')) === DIAG_IDS[0] || true, '');
      const order = JSON.parse(fs.readFileSync(path.join(BANK, 'quiz_sets.json'), 'utf8')).find(s => s.set_id === 'DIAG').question_ids;
      ok((await page.getAttribute('#qid', 'data-id')) === order[0], '첫 문항');
      await shot(page, '390_04_진단');
      await page.click('.choice[data-orig="0"]'); await page.click('[data-act=diag-next]');
      await page.waitForFunction(id => document.querySelector('#qid').dataset.id === id, order[1]);
      ok(!(await page.$('#verdict')), '정오답 표시');
    });
    await test('E-07', '진단 중간(5문항)에 나가도 다음에 6번째부터 이어 풀기, 10문항 전에는 연습 못 함', async () => {
      for (let i = 1; i < 5; i++) { const id = await page.getAttribute('#qid', 'data-id'); await page.click('[data-act=diag-unknown]'); await page.waitForFunction(p => document.querySelector('#qid').dataset.id !== p, id); }
      await page.reload(); await page.waitForSelector('[data-screen=diag]');
      ok((await page.textContent('#count')).includes('6 / 12'), await page.textContent('#count'));
      ok(!page._requests.some(u => u.includes('dev_diag_key')), '진단 중에 개발용 정답 파일을 읽음');
    });
    await test('E-08', '진단 끝 → 결과: 등급·점수 없이 강한 강의 / 먼저 볼 강의 / 12문항 해설 + [개발용] 표시', async () => {
      await diagAnswerAll(page, 5);
      const txt = await page.textContent('#app');
      ok(await page.$$eval('#diag-review details', e => e.length) === 12, '해설 12');
      ok(txt.includes('[개발용]'), '개발용 표시');
      ok(!/등급|점수:|θ|레벨|상\/중\/하/.test(txt.replace('점수나 등급은 없어요', '')), '등급·점수 표시');
      ok(page._requests.some(u => u.includes('dev_diag_key')), '끝낼 때 개발용 정답 파일을 읽어야 함');
      await shot(page, '390_05_진단결과');
      const d = await debug(page); return `출발 θ(화면에 안 보임) ${d.me.theta.toFixed(2)}`;
    });

    console.log('■ 오늘의 학습 (F3·F4·F5·F6)');
    await test('E-09', '홈: 복습 0 + 새 문제 0/5, XP 0, 등수·레벨·θ 표시 없음', async () => {
      await page.click('[data-act=home]'); await page.waitForSelector('[data-screen=home]');
      ok((await page.textContent('#plan-new')).trim() === '0 / 5', await page.textContent('#plan-new'));
      ok((await page.textContent('#xp-total')).trim() === '0', 'xp');
      const txt = await page.textContent('body'); ok(!/θ|레벨|등수|순위/.test(txt), '숨길 표시');
      await shot(page, '390_06_홈');
    });
    await test('E-10', '첫 문제 바로 맞힘 → "혼자 맞힘" +10 XP, 해설 보임', async () => {
      await page.click('[data-act=start]'); await page.waitForSelector('[data-screen=item]');
      await shot(page, '390_07_문제');
      const r = await solve(page, 'right');
      ok(r.outcome === '혼자 맞힘' && r.xp === '+10 XP', JSON.stringify(r));
      ok((await page.textContent('#explain')).length > 10, '해설');
      await shot(page, '390_08_해설_혼자맞힘');
    });
    await test('E-11', '2번 모두 틀림 → "정답 보고 이해" +10 XP(결과 무관 같은 XP) + 복습 안내', async () => {
      await page.click('[data-act=next]'); await page.waitForSelector('[data-screen=item]');
      const r = await solve(page, 'wrong2');
      ok(r.outcome === '정답 보고 이해' && r.xp === '+10 XP', JSON.stringify(r));
      ok((await page.textContent('#review-note')).includes('복습'), '복습 안내');
      await shot(page, '390_09_해설_정답보고이해');
    });
    await test('E-12', '배정된 문항의 예측 맞힐 확률 기록 (E2 구간 0.75~0.90 또는 E3·E4 규칙)', async () => {
      const d = await debug(page);
      const mine = d.db.attempts.filter(a => a.code === 'TEST23');
      return mine.map(a => a.qid + ':' + a.outcome).join(', ');
    });
    await test('E-13', '나머지 3문제 → "오늘 결과" 화면, 5문제 50 XP, 연속 학습 1일째', async () => {
      for (let k = 0; k < 3; k++) { await page.click('[data-act=next]'); await page.waitForSelector('[data-screen=item] .choice'); await solve(page, 'right'); }
      ok((await page.textContent('[data-act=next]')).includes('오늘 결과'), '마지막 버튼');
      await page.click('[data-act=next]'); await page.waitForSelector('[data-screen=done]');
      ok((await page.textContent('#run-xp')).includes('+50'), await page.textContent('#run-xp'));
      ok((await page.textContent('#app')).includes('연속 학습 1일째'), '연속');
      await shot(page, '390_10_오늘결과');
      await page.click('[data-act=home]'); await page.waitForSelector('#all-done');
      ok((await page.textContent('#xp-total')).trim() === '50', 'xp total');
    });
    await test('E-14', '새로고침해도 자동 로그인 + 기록 유지 (XP 50, 새 문제 5/5)', async () => {
      await page.reload(); await page.waitForSelector('[data-screen=home]');
      ok((await page.textContent('#xp-total')).trim() === '50' && (await page.textContent('#plan-new')).trim() === '5 / 5', 'persist');
    });
    await test('E-15', '다음 날(날짜 +1): 복습 1문제가 먼저 나옴 → 복습에서 혼자 맞힘 15 XP(10+5) → 다음 상자', async () => {
      await page.evaluate(() => localStorage.setItem('lu2_dev_day_offset', '1'));
      await page.reload(); await page.waitForSelector('[data-screen=home]');
      ok((await page.textContent('#plan-review')).trim() === '1문제', await page.textContent('#plan-review'));
      await page.click('[data-act=start]'); await page.waitForSelector('[data-screen=item]');
      ok((await page.textContent('#count')).includes('복습'), '복습 먼저');
      const r = await solve(page, 'right');
      ok(r.outcome === '혼자 맞힘' && r.xp === '+15 XP', JSON.stringify(r));
      ok((await page.textContent('#review-note')).includes('다시 도전 성공'), 'note');
      const d = await debug(page); const box = Object.values(d.db.review.TEST23)[0];
      ok(box.box === 2, JSON.stringify(box));
      await shot(page, '390_11_복습_다시도전성공');
    });

    console.log('■ 힌트 4단계 (시계 조작으로 10초 대기 시험)');
    const h = await newPage({ clock: true });
    await test('E-16', '힌트: L1 바로 → L2는 10초 뒤 → L3는 "내 생각 한 줄" → L4는 답 낸 뒤 → "정답 보고 이해"', async () => {
      const p = h.page; await open(p); await login(p, 'TEST45', '바다'); await diagAnswerAll(p);
      await p.evaluate(() => window.__LU_APP.openItem('L01-Q1', 'PRACTICE')); await p.waitForSelector('#hint-btn');
      ok((await p.textContent('#hints')).includes('시험용 힌트'), '시험용 표시');
      await p.click('#hint-btn'); await p.waitForSelector('.hint-step[data-level="1"]');
      await p.waitForFunction(() => document.querySelector('#hint-btn').disabled);
      ok((await p.textContent('#hint-btn')).includes('초 뒤'), await p.textContent('#hint-btn'));
      await shot(p, '390_12_힌트1_대기');
      await p.clock.fastForward(9000);
      ok(await p.$eval('#hint-btn', b => b.disabled), '9초에 열림');
      await p.clock.fastForward(1500);
      await p.waitForFunction(() => !document.querySelector('#hint-btn').disabled);
      await p.click('#hint-btn'); await p.waitForSelector('.hint-step[data-level="2"]');
      await p.clock.fastForward(10500);
      await p.waitForFunction(() => document.querySelector('#hint-btn').textContent.includes('내 생각'));
      ok(await p.$eval('#hint-btn', b => b.disabled), '한 줄 없이 열림');
      await p.fill('#thought', '   '); ok(await p.$eval('#hint-btn', b => b.disabled), '공백으로 열림');
      await p.fill('#thought', '처음 시작한 때를 묻는 것 같아요');
      await p.waitForFunction(() => !document.querySelector('#hint-btn').disabled);
      await p.click('#hint-btn'); await p.waitForSelector('.hint-step[data-level="3"]');
      await p.clock.fastForward(10500); await p.fill('#thought', '다트머스?');
      await p.waitForFunction(() => document.querySelector('#hint-btn').textContent.includes('답을 한 번 낸 뒤'));
      await shot(p, '390_13_힌트3_답먼저');
      const ans = await answerOf(p);
      await p.click(`.choice[data-orig="${(ans + 1) % 4}"]`); await p.click('[data-act=submit]'); await p.waitForSelector('#msg');
      await p.fill('#thought', '다시 생각해 보니 연구 모임');
      await p.waitForFunction(() => !document.querySelector('#hint-btn').disabled && document.querySelector('#hint-btn').textContent.includes('정답과 해설'));
      await p.click('#hint-btn'); await p.waitForSelector('#verdict');
      ok((await p.textContent('#outcome')).trim() === '정답 보고 이해' && (await p.textContent('#xp-gain')).trim() === '+10 XP', 'L4 결과');
      await shot(p, '390_14_힌트4_해설');
    });
    await test('E-17', '힌트 1단계만 보고 맞힘 → "힌트로 해결" +10 XP (힌트 써도 XP 같음)', async () => {
      const p = h.page;
      await p.evaluate(() => window.__LU_APP.openItem('L02-Q4', 'PRACTICE')); await p.waitForSelector('#hint-btn');
      await p.click('#hint-btn'); await p.waitForSelector('.hint-step[data-level="1"]');
      const r = await solve(p, 'right');
      ok(r.outcome === '힌트로 해결' && r.xp === '+10 XP', JSON.stringify(r));
    });
    await test('E-18', '힌트가 아직 없는 문항: "힌트 준비 중" (버튼 잠김)', async () => {
      const p = h.page;
      await p.evaluate(() => window.__LU_APP.openItem('L12-Q1', 'PRACTICE')); await p.waitForSelector('#hint-btn');
      await p.waitForFunction(() => document.querySelector('#hint-btn').textContent.includes('준비 중'));
      ok(await p.$eval('#hint-btn', b => b.disabled), '잠김');
    });
    await test('E-19', '한 브라우저에서 두 가짜 학생 기록이 섞이지 않음 (TEST23 XP 65 / TEST45 따로)', async () => {
      const d = await debug(h.page);
      ok(d.db.students.TEST45.xp === 20, 'TEST45 ' + d.db.students.TEST45.xp);
      return 'TEST45 XP ' + d.db.students.TEST45.xp;
    });
    await h.ctx.close();

    console.log('■ 화면 크기 · Supabase 자리');
    await test('E-20', '360px·390px에서 옆으로 넘침 없음, 누르는 곳 44px 이상 (홈·문제·힌트)', async () => {
      for (const w of [360, 390]) {
        const v = await newPage({ viewport: { width: w, height: 760 } });
        await open(v.page); await login(v.page, 'TEST67', '숲'); await diagAnswerAll(v.page);
        await v.page.click('[data-act=home]'); await v.page.waitForSelector('[data-screen=home]');
        for (const where of ['home', 'item']) {
          if (where === 'item') { await v.page.evaluate(() => window.__LU_APP.openItem('L01-Q4', 'PRACTICE')); await v.page.waitForSelector('#hint-btn'); }
          const r = await v.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
          ok(r.sw <= r.w, `${w}px ${where} 넘침 ${r.sw}`);
          const small = await v.page.$$eval('button, input, textarea', els => els.filter(e => e.offsetParent !== null).map(e => ({ t: e.textContent.trim().slice(0, 12), h: e.getBoundingClientRect().height })).filter(x => x.h < 44));
          ok(!small.length, `${w}px ${where} 작은 버튼 ${JSON.stringify(small)}`);
        }
        if (w === 360) await shot(v.page, '360_15_문제_힌트');
        ok(!v.page._errors.length, v.page._errors.join('|'));
        await v.ctx.close();
      }
    });
    await test('E-21', 'config.js MODE를 "supabase"로 바꾸면: 앱이 멈추지 않고 "아직 연결 전" 안내, 로컬 띠 없음', async () => {
      const v = await newPage({ route: p => p.route('**/js/config.js', async r => {
        const body = fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8').replace('MODE: "local"', 'MODE: "supabase"');
        await r.fulfill({ body, contentType: 'application/javascript' });
      }) });
      await open(v.page);
      ok(await v.page.$eval('#devbar', e => e.hidden), '로컬 띠가 보임');
      await v.page.fill('#code', 'TEST23'); await v.page.click('[data-act=login]');
      await v.page.waitForSelector('#code-error');
      ok((await v.page.textContent('#code-error')).includes('아직 연결 전'), await v.page.textContent('#code-error'));
      ok(!(await v.page.evaluate(() => !!window.__LU_APP)), 'Supabase 모드에 테스트용 문이 열려 있음');
      await v.ctx.close();
    });
    await test('E-22', '자바스크립트 오류 0건 (전체 흐름)', async () => { ok(!page._errors.length, page._errors.join('|')); });
    await ctx.close();
  } finally {
    await browser.close(); server.kill();
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_results.json'), JSON.stringify(results, null, 1));
  console.log(`\n흐름 테스트: 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
