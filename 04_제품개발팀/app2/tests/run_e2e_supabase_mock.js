// Supabase 모드 자동 테스트 — 가짜(mock) Supabase로 (Playwright)
// 실행: node 04_제품개발팀/app2/tests/run_e2e_supabase_mock.js
// - 진짜 Supabase에는 한 번도 접속하지 않습니다(실DB 미검증). vendor/supabase.js 자리에 tests/mock_supabase.js 를 끼워 넣고,
//   store.js 의 SupabaseStore 가 서버 함수(RPC)를 "어떤 순서로, 어떤 인자로" 부르고 답을 어떻게 화면에 옮기는지 확인합니다.
// - 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)만 씁니다. 결과: tests/e2e_supabase_mock_results.json
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const load = require('./load_practice');

const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const CFG_SRC = fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8');
const URL_ = CFG_SRC.match(/SUPABASE_URL:\s*"([^"]*)"/)[1];
const KEY_ = CFG_SRC.match(/SUPABASE_ANON_KEY:\s*"([^"]*)"/)[1];
const VENDOR_SHA256 = 'ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3';   // README 5장에 적은 값

// 가짜 서버에 넣을 문항: 앱의 로컬 데이터 파일을 그대로 씀 (진단 정답은 개발용 파일에서 — 시험 도구 안에서만)
const PRACTICE = load('practice.js', 'LU_PRACTICE');
const DIAGQ = load('diagnostic.js', 'LU_DIAG');
const DKEY = load('dev_diag_key.js', 'LU_DEV_DIAG_KEY');
const HINTS = load('hints.js', 'LU_HINTS').hints;
const DIAG = DIAGQ.map(q => Object.assign({}, q, DKEY[q.id]));
const HINT_QID = PRACTICE[0].id;   // 이 문항 하나만 "검토 끝난 힌트"가 있는 것으로 흉내
const MOCK_DATA = { practice: PRACTICE, diag: DIAG, codes: ['TEST23', 'TEST45'],
  reviewedHints: { [HINT_QID]: { l1: HINTS[HINT_QID].L1, l2: HINTS[HINT_QID].L2, l3: HINTS[HINT_QID].L3 } } };

const PORT = 9600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
const DEPLOY_DIR = path.join(require('os').tmpdir(), 'lu2_deploy_test_' + process.pid);
const PORT2 = PORT + 1;
const BASE2 = `http://127.0.0.1:${PORT2}/`;
const results = [];
let browser;

function ok(c, m) { if (!c) throw new Error(m); }
async function test(id, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, status: 'pass', note: note || '', ms: Date.now() - t0 }); console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ id, name, status: 'fail', note: String(e && e.message || e), ms: Date.now() - t0 }); console.log(`  [실패] ${id} ${name} — ${e && e.message}`); }
}
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(d => { window.__MOCK_DATA = d; }, MOCK_DATA);
  await ctx.route('**/vendor/supabase.js', r => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  await ctx.route(/supabase\.co/, r => r.abort());   // 혹시라도 진짜 서버로 나가면 끊음 (아래에서 0건인지도 확인)
  const page = await ctx.newPage();
  page._errors = []; page._requests = []; page._warn = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') page._warn.push(m.text()); });
  page.on('request', r => page._requests.push(r.url()));
  return { ctx, page };
}
async function settle(page) { await page.waitForSelector('#app .screen:not([data-screen=loading])'); }
async function screen(page) { return page.getAttribute('#app .screen', 'data-screen'); }
async function logOf(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]')); }
async function clearLog(page) { await page.evaluate(() => localStorage.removeItem('mock_log')); }
const rpcs = l => l.filter(x => x.t === 'rpc');
async function answerOf(page) { const id = await page.getAttribute('#qid', 'data-id'); return PRACTICE.find(q => q.id === id).answer_index; }
async function solve(page, how) {
  const ans = await answerOf(page);
  const n = await page.$$eval('.choice', els => els.length);
  if (how === 'right') { await page.click(`.choice[data-orig="${ans}"]`); await page.click('[data-act=submit]'); }
  else {
    const wrong = [...Array(n).keys()].filter(i => i !== ans);
    await page.click(`.choice[data-orig="${wrong[0]}"]`); await page.click('[data-act=submit]');
    if (n > 2) { await page.waitForSelector('#msg'); await page.click(`.choice[data-orig="${wrong[1]}"]`); await page.click('[data-act=submit]'); }
  }
  await page.waitForSelector('#verdict');
  return { outcome: (await page.textContent('#outcome')).trim(), xp: (await page.textContent('#xp-gain')).trim() };
}
function startServer(dir, port) {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
    const t0 = Date.now();
    (function wait() {
      http.get(`http://127.0.0.1:${port}/index.html`, res => { res.resume(); resolve(p); })
        .on('error', () => Date.now() - t0 > 8000 ? reject(new Error('임시 서버 시작 실패')) : setTimeout(wait, 150));
    })();
  });
}

(async () => {
  const server = await startServer(PUBLIC, PORT);
  browser = await chromium.launch();
  let server2 = null;
  try {
    console.log('■ 라이브러리 파일');
    await test('S-01', 'vendor/supabase.js = @supabase/supabase-js 2.118.0 UMD 원본 그대로(지문 일치), createClient 있음', async () => {
      const buf = fs.readFileSync(path.join(PUBLIC, 'vendor/supabase.js'));
      ok(crypto.createHash('sha256').update(buf).digest('hex') === VENDOR_SHA256, '파일 지문이 README와 다름');
      ok(buf.toString('utf8', 0, 30).startsWith('var supabase='), 'UMD 모양 아님');
      ok(fs.existsSync(path.join(PUBLIC, 'vendor/supabase-LICENSE.txt')), '라이선스 파일');
      return (buf.length / 1024).toFixed(0) + 'KB';
    });

    console.log('■ 시작 · 로그인 (claim_code)');
    const { ctx, page } = await newPage();
    await test('S-02', '?mode=supabase 첫 화면: 설정의 주소·공개 열쇠로 연결 준비, 익명 계정은 아직 안 만듦, 로컬 띠 없음', async () => {
      await page.goto(BASE + 'index.html?mode=supabase'); await settle(page);
      ok(await screen(page) === 'login', await screen(page));
      ok(await page.$eval('#devbar', e => e.hidden), '로컬 띠');
      ok(!(await page.textContent('#app')).includes('[개발용]'), '개발용 가짜 코드 안내가 보임');
      const l = await logOf(page);
      const c = l.find(x => x.t === 'createClient');
      ok(c && c.url === URL_ && c.key === KEY_ && c.storageKey === 'lu2_sb_auth', JSON.stringify(c));
      ok(!l.some(x => x.t === 'signInAnonymously'), '열기만 했는데 익명 로그인');
      ok(!rpcs(l).length, 'RPC 호출');
    });
    await test('S-03', '모양이 틀린 코드: 서버에 묻지 않고(RPC 0·계정 0) 바로 "6자리" 안내', async () => {
      await clearLog(page);
      await page.fill('#code', 'TESTO2'); await page.click('[data-act=login]');
      await page.waitForSelector('#code-error'); ok((await page.textContent('#code-error')).includes('6자리'), 'msg');
      const l = await logOf(page); ok(!l.some(x => x.t === 'rpc' || x.t === 'signInAnonymously'), JSON.stringify(l));
    });
    await test('S-04', '없는 코드: 익명 로그인 1번 → claim_code(p_code) → "등록되지 않은 코드"', async () => {
      await clearLog(page);
      await page.fill('#code', 'ZZZZ22'); await page.click('[data-act=login]');
      await page.waitForFunction(() => document.querySelector('#code-error') && document.querySelector('#code-error').textContent.includes('등록되지 않은'));
      const l = await logOf(page);
      ok(l.filter(x => x.t === 'signInAnonymously').length === 1, '익명 로그인 수');
      const r = rpcs(l); ok(r.length === 1 && r[0].name === 'claim_code' && r[0].args.p_code === 'ZZZZ22', JSON.stringify(r));
    });
    await test('S-05', '맞는 코드(소문자·빈칸) → 세션 재사용(익명 로그인 추가 0) → claim_code("TEST23") → 별명 set_nickname → 진단', async () => {
      await clearLog(page);
      await page.fill('#code', ' test23 '); await page.click('[data-act=login]');
      await page.waitForSelector('[data-screen=nickname]');
      await page.fill('#nick', '하늘별'); await page.click('[data-act=save-nick]');
      await page.waitForSelector('[data-screen=diag]');
      const l = await logOf(page);
      ok(!l.some(x => x.t === 'signInAnonymously'), '익명 로그인을 또 함');
      const r = rpcs(l).map(x => x.name + ':' + JSON.stringify(x.args));
      ok(r[0] === 'claim_code:{"p_code":"TEST23"}' && r[1] === 'set_nickname:{"p_name":"하늘별"}', r.join(' | '));
      ok((await page.textContent('#who')).includes('하늘별'), '별명 표시');
    });

    console.log('■ 진단 (questions · diag_answer · diag_finish)');
    await test('S-06', '진단 문항: questions 표에서 pool=diagnostic, diag_order 순, 정답 칸은 요청하지 않음', async () => {
      const l = await logOf(page);
      const q = l.find(x => x.t === 'from' && x.table === 'questions' && x.eq.some(e => e[1] === 'diagnostic'));
      ok(q && q.order === 'diag_order', JSON.stringify(q));
      ok(!/answer|explanation|\bb\b|n_resp/.test(q.cols), '요청 칸: ' + q.cols);
      ok(!l.some(x => x.t === 'from' && x.table === 'students' && /theta|n_answers/.test(x.cols)), 'θ 칸 요청');
      ok((await page.getAttribute('#qid', 'data-id')) === DIAG[0].id, '첫 문항');
    });
    await test('S-07', '5문항 답한 뒤 새로고침 → 서버 기록(diag_answers)으로 6번째부터 이어 풀기', async () => {
      for (let i = 0; i < 5; i++) {
        const id = await page.getAttribute('#qid', 'data-id');
        if (i === 2) await page.click('[data-act=diag-unknown]'); else { await page.click('.choice[data-orig="0"]'); await page.click('[data-act=diag-next]'); }
        await page.waitForFunction(p => document.querySelector('#qid').dataset.id !== p, id);
      }
      await page.reload(); await page.waitForSelector('[data-screen=diag]');
      ok((await page.textContent('#count')).includes('6 / 12'), await page.textContent('#count'));
    });
    await test('S-08', '나머지 답 → diag_answer 12번(모르겠어요 = p_choice null) → diag_finish 1번 → 결과: 서버 해설 12개, [개발용] 표시 없음', async () => {
      for (let i = 5; i < 12; i++) {
        const id = await page.getAttribute('#qid', 'data-id');
        if (i % 4 === 3) await page.click('[data-act=diag-unknown]'); else { await page.click('.choice[data-orig="0"]'); await page.click('[data-act=diag-next]'); }
        if (i < 11) await page.waitForFunction(p => document.querySelector('#qid').dataset.id !== p, id);
      }
      await page.waitForSelector('[data-screen=diagResult]');
      const r = rpcs(await logOf(page));
      const da = r.filter(x => x.name === 'diag_answer');
      ok(da.length === 12, 'diag_answer ' + da.length);
      ok(da.map(x => x.args.p_qid).join() === DIAG.map(q => q.id).join(), '문항 순서');
      ok(da[2].args.p_choice === null && da[0].args.p_choice === 0, 'p_choice 값 ' + JSON.stringify(da.slice(0, 3)));
      ok(r.filter(x => x.name === 'diag_finish').length === 1, 'diag_finish');
      ok(await page.$$eval('#diag-review details', e => e.length) === 12, '해설 수');
      const txt = await page.textContent('#app');
      ok(!txt.includes('[개발용]'), '개발용 표시'); ok(txt.includes(DIAG[0].explanation.slice(0, 15)), '서버 해설 내용');
      ok((await page.textContent('#strong')).includes('01강') && (await page.textContent('#weak')).includes('03강'), '강한/먼저 볼 강의');
      ok(!page._requests.some(u => u.includes('dev_diag_key')), '개발용 정답 파일을 읽음');
    });

    console.log('■ 오늘의 학습 (today_summary · next_practice · close_item)');
    let firstQ;
    await test('S-09', '홈: today_summary 숫자 그대로 (새 문제 0/5, XP 0)', async () => {
      await clearLog(page);
      await page.click('[data-act=home]'); await page.waitForSelector('[data-screen=home]');
      ok((await page.textContent('#plan-new')).trim() === '0 / 5' && (await page.textContent('#xp-total')).trim() === '0', 'home');
      ok(rpcs(await logOf(page)).some(x => x.name === 'today_summary'), 'today_summary');
    });
    await test('S-10', '첫 문제: next_practice(p_recent [], p_exclude []) → 연습 문항·정답은 questions+question_keys 표에서 → 검토 끝난 힌트 L1 표시', async () => {
      await clearLog(page);
      await page.click('[data-act=start]'); await page.waitForSelector('[data-screen=item]');
      const l = await logOf(page);
      const np = rpcs(l).find(x => x.name === 'next_practice');
      ok(JSON.stringify(np.args) === '{"p_recent":[],"p_exclude":[]}', JSON.stringify(np.args));
      ok(l.some(x => x.t === 'from' && x.table === 'questions' && x.eq.some(e => e[1] === 'practice')), 'questions(practice)');
      ok(l.some(x => x.t === 'from' && x.table === 'question_keys'), 'question_keys');
      ok(l.some(x => x.t === 'from' && x.table === 'hints'), 'hints');
      firstQ = await page.getAttribute('#qid', 'data-id'); ok(firstQ === HINT_QID, firstQ);
      ok(!(await page.$('#draft-tag')), '검토 전 표시');
      await page.click('#hint-btn'); await page.waitForSelector('.hint-step[data-level="1"]');
      ok((await page.textContent('.hint-step[data-level="1"]')).includes(MOCK_DATA.reviewedHints[HINT_QID].l1.slice(0, 10)), '힌트 내용');
    });
    await test('S-11', '힌트 1단계 보고 맞힘 → close_item(p_qid, PRACTICE, p_level 1, p_submits [정답]) → "힌트로 해결" +10 XP', async () => {
      await clearLog(page);
      const ans = await answerOf(page);
      const r = await solve(page, 'right');
      ok(r.outcome === '힌트로 해결' && r.xp === '+10 XP', JSON.stringify(r));
      const c = rpcs(await logOf(page)).find(x => x.name === 'close_item');
      ok(JSON.stringify(c.args) === JSON.stringify({ p_qid: firstQ, p_mode: 'PRACTICE', p_level: 1, p_submits: [ans] }), JSON.stringify(c.args));
    });
    await test('S-12', '다음 문제: next_practice에 이번 판 기록(p_recent [{qid,lecture,R:0.5}], p_exclude [첫 문항]) 전달, 힌트 없는 문항은 "준비 중"', async () => {
      await clearLog(page);
      await page.click('[data-act=next]'); await page.waitForSelector('[data-screen=item] .choice');
      const np = rpcs(await logOf(page)).find(x => x.name === 'next_practice');
      const lec = PRACTICE.find(q => q.id === firstQ).lecture;
      ok(JSON.stringify(np.args) === JSON.stringify({ p_recent: [{ qid: firstQ, lecture: lec, R: 0.5 }], p_exclude: [firstQ] }), JSON.stringify(np.args));
      await page.waitForFunction(() => document.querySelector('#hint-btn').textContent.includes('준비 중'));
    });
    await test('S-13', '2번 틀림 → close_item(p_submits 오답 2개) → "정답 보고 이해" +10 XP + 복습 안내, 화면·서버 결과 이름 일치', async () => {
      await clearLog(page);
      const r = await solve(page, 'wrong2');
      ok(r.outcome === '정답 보고 이해' && r.xp === '+10 XP', JSON.stringify(r));
      const c = rpcs(await logOf(page)).find(x => x.name === 'close_item');
      ok(c.args.p_submits.length >= 1 && c.args.p_level === 0, JSON.stringify(c.args));
      ok((await page.textContent('#review-note')).includes('복습'), '복습 안내');
      ok(!page._warn.some(w => w.includes('결과 이름이 달라요')), page._warn.join('|'));
    });
    await test('S-14', '나머지 3문제 → 오늘 결과(+50 XP) → 홈 XP 50 (서버 값)', async () => {
      for (let k = 0; k < 3; k++) { await page.click('[data-act=next]'); await page.waitForSelector('[data-screen=item] .choice'); await solve(page, 'right'); }
      await page.click('[data-act=next]'); await page.waitForSelector('[data-screen=done]');
      ok((await page.textContent('#run-xp')).includes('+50'), await page.textContent('#run-xp'));
      ok((await page.textContent('#app')).includes('연속 학습 1일째'), '연속(서버 counts → logic.js streak)');
      await page.click('[data-act=home]'); await page.waitForSelector('#all-done');
      ok((await page.textContent('#xp-total')).trim() === '50', 'xp');
      const n = rpcs(await logOf(page)).filter(x => x.name === 'close_item').length;
      return 'close_item 누적 ' + n + '번(이 구간)';
    });
    await test('S-15', '새로고침 → 저장된 세션 재사용(익명 로그인 0번, claim_code 0번) → 바로 홈, 기록 유지', async () => {
      await clearLog(page);
      await page.reload(); await page.waitForSelector('[data-screen=home]');
      const l = await logOf(page);
      ok(!l.some(x => x.t === 'signInAnonymously') && !rpcs(l).some(x => x.name === 'claim_code'), JSON.stringify(l.map(x => x.t + (x.name || ''))));
      ok((await page.textContent('#xp-total')).trim() === '50' && (await page.textContent('#plan-new')).trim() === '5 / 5', 'persist');
    });

    console.log('■ 오류를 쉬운 말로');
    await test('S-16', '서버가 NOT_LINKED를 돌려주면 시작 화면에 쉬운 안내 + [다시 시도], 고친 뒤 다시 시도하면 홈', async () => {
      await page.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ today_summary: 'NOT_LINKED' })));
      await page.reload(); await page.waitForSelector('#err');
      ok((await page.textContent('#err')).includes('코드와 연결되지 않았어요'), await page.textContent('#err'));
      ok(!(await page.textContent('#err')).includes('NOT_LINKED'), '영어 오류 코드가 그대로 보임');
      await page.evaluate(() => localStorage.removeItem('mock_fail'));
      await page.click('[data-act=retry]'); await page.waitForSelector('[data-screen=home]');
    });
    await test('S-17', '오류 문장 표: 서버 오류 코드·네트워크 끊김·익명 로그인 꺼짐·알 수 없는 오류 → 모두 한국어', async () => {
      const m = await page.evaluate(() => {
        const f = window.STORE.explainError;
        return {
          too: f({ message: 'DIAG_TOO_FEW' }), due: f({ message: 'NOT_DUE' }), bad: f({ message: 'BAD_SUBMITS' }),
          net: f(new TypeError('Failed to fetch')), anon: f({ message: 'Anonymous sign-ins are disabled' }),
          jwt: f({ message: 'JWT expired' }), rate: f({ status: 429, message: 'x' }), unk: f({ message: 'weird_thing' })
        };
      });
      ok(m.too.includes('10문항'), m.too); ok(m.due.includes('복습할 날'), m.due); ok(m.bad.includes('저장하지 못했어요'), m.bad);
      ok(m.net.includes('서버에 닿지 못했어요'), m.net); ok(m.anon.includes('교수님께'), m.anon);
      ok(m.jwt.includes('만료'), m.jwt); ok(m.rate.includes('1분'), m.rate); ok(m.unk.startsWith('서버에서 문제가 생겼어요'), m.unk);
    });
    await test('S-18', '진단 10문항 전에 끝내기(DIAG_TOO_FEW) → 화면에 "10문항 이상" 안내', async () => {
      const msg = await page.evaluate(() => {
        localStorage.setItem('mock_fail', JSON.stringify({ diag_finish: 'DIAG_TOO_FEW' }));
        return window.STORE.finishDiagnostic().then(() => 'no error', e => e.message);
      });
      await page.evaluate(() => localStorage.removeItem('mock_fail'));
      ok(msg.includes('10문항 이상'), msg);
    });

    console.log('■ 나가기 · 다른 코드');
    await test('S-19', '[다른 코드로 들어가기] → signOut(이 기기만) → 로그인 화면 → 다른 코드는 새 익명 계정으로 claim_code', async () => {
      await clearLog(page);
      await page.click('[data-act=logout]'); await page.waitForSelector('[data-screen=login]');
      await page.fill('#code', 'TEST45'); await page.click('[data-act=login]');
      await page.waitForSelector('[data-screen=nickname]');
      const l = await logOf(page);
      ok(l.some(x => x.t === 'signOut' && x.scope === 'local'), 'signOut');
      ok(l.filter(x => x.t === 'signInAnonymously').length === 1, '새 익명 계정');
      ok(rpcs(l).some(x => x.name === 'claim_code' && x.args.p_code === 'TEST45'), 'claim_code');
    });
    await test('S-20', '코드를 너무 많이 넣으면(too_many) "10분 뒤" 안내', async () => {
      await page.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ claim_code: 'too_many' })));
      await page.evaluate(() => window.STORE.logout()); await page.reload(); await settle(page);
      await page.fill('#code', 'TEST23'); await page.click('[data-act=login]');
      await page.waitForFunction(() => document.querySelector('#code-error') && document.querySelector('#code-error').textContent.includes('10분'));
      await page.evaluate(() => localStorage.removeItem('mock_fail'));
    });
    await test('S-21', '전체 흐름: 자바스크립트 오류 0, 진짜 서버·바깥 주소 요청 0, data/ 파일 요청 0, 테스트용 문(__LU_APP·_debug) 없음', async () => {
      ok(!page._errors.length, page._errors.join('|'));
      ok(!page._requests.some(u => !u.startsWith(BASE)), '바깥 요청: ' + page._requests.filter(u => !u.startsWith(BASE)).join(','));
      ok(!page._requests.some(u => u.includes('/data/')), 'data/ 요청');
      ok(!(await page.evaluate(() => !!window.__LU_APP || !!window.STORE._debug)), '테스트용 문');
      return '요청 ' + page._requests.length + '건 모두 127.0.0.1';
    });
    await ctx.close();

    console.log('■ 배포용 폴더 (tools/make_deploy.py)');
    await test('S-22', '배포용 폴더: data/ 없음(진단 정답 파일 포함) · MODE=supabase가 기본 · 그 폴더만으로 로그인→진단 화면까지 동작', async () => {
      const out = execFileSync('python3', [path.join(APP, 'tools/make_deploy.py'), DEPLOY_DIR], { encoding: 'utf8' });
      ok(!fs.existsSync(path.join(DEPLOY_DIR, 'data')), 'data/ 남음');
      ok(fs.readFileSync(path.join(DEPLOY_DIR, 'js/config.js'), 'utf8').includes('MODE: "supabase"'), 'MODE');
      ok(fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8').includes('MODE: "local"'), '원본 config.js가 바뀜');
      server2 = await startServer(DEPLOY_DIR, PORT2);
      const v = await newPage();
      await v.page.goto(BASE2 + 'index.html'); await settle(v.page);   // ?mode 없이도 Supabase 모드
      ok(await v.page.$eval('#devbar', e => e.hidden), '로컬 띠');
      await v.page.fill('#code', 'TEST23'); await v.page.click('[data-act=login]');
      await v.page.waitForSelector('[data-screen=nickname]');
      await v.page.fill('#nick', '배포확인'); await v.page.click('[data-act=save-nick]');
      await v.page.waitForSelector('[data-screen=diag]');
      ok(!v.page._errors.length, v.page._errors.join('|'));
      ok(!v.page._requests.some(u => u.includes('/data/')), 'data/ 요청');
      await v.ctx.close();
      return out.trim().replace(DEPLOY_DIR, '(임시 폴더)');
    });
    await test('S-23', '로컬 모드(기본 주소)는 지금과 같음: vendor/supabase.js 안 읽음, 로컬 띠 보임', async () => {
      const v = await newPage();
      await v.page.goto(BASE + 'index.html'); await settle(v.page);
      ok(!(await v.page.$eval('#devbar', e => e.hidden)), '로컬 띠 없음');
      ok(!v.page._requests.some(u => u.includes('vendor/')), 'vendor 요청');
      ok(await v.page.evaluate(() => window.STORE.mode) === 'local', 'mode');
      await v.ctx.close();
    });
    console.log('■ 진짜 라이브러리(vendor) + 가짜 HTTP 응답 — 실제로 어떤 주소·내용으로 요청하는지');
    await test('S-24', '진짜 supabase-js가 만드는 요청: 익명 로그인(/auth/v1/signup), claim_code·next_practice(/rest/v1/rpc/…) 본문, apikey 머리말, 세션 재사용', async () => {
      const ctx2 = await browser.newContext();
      const seen = [];
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, is_anonymous: true, session_id: 'fake' }) + '.fakesig';
      const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      await ctx2.route(/supabase\.co/, async r => {
        const req = r.request(), u = new URL(req.url());
        seen.push({ method: req.method(), path: u.pathname + u.search, body: req.postData(), apikey: req.headers()['apikey'], auth: req.headers()['authorization'] });
        const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        if (u.pathname === '/auth/v1/signup') return json({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'fake-refresh', user });
        if (u.pathname === '/auth/v1/user') return json(user);
        if (u.pathname === '/rest/v1/rpc/claim_code') return json({ ok: true, student: { code: 'TEST23', nickname: '하늘별', xp: 0, diagDone: true, diagAnswered: 12 } });
        if (u.pathname === '/rest/v1/rpc/today_summary') return json({ day: '2026-11-02', reviews: [], newDone: 0, newTarget: 5, xp: 0, xpToday: 0, weekXp: 0, weekSolved: 0, counts: {} });
        if (u.pathname === '/rest/v1/students') return json([{ code: 'TEST23', nickname: '하늘별', xp: 0, diag_done: true }]);   // PostgREST는 배열로 답함 → maybeSingle이 한 줄로
        if (u.pathname === '/rest/v1/diag_answers') return json([]);
        if (u.pathname === '/rest/v1/questions') return json([{ id: 'L01-Q1', part: 1, lecture: 1, difficulty: 1, type: 'mcq', question: '가짜 문항', choices: ['가', '나', '다', '라'], source_section: '01강' }]);
        if (u.pathname === '/rest/v1/question_keys') return json([{ question_id: 'L01-Q1', answer_index: 0, explanation: '가짜 해설', common_wrong_index: 1, common_wrong_reason: null }]);
        if (u.pathname === '/rest/v1/hints') return json([]);
        if (u.pathname === '/rest/v1/rpc/next_practice') return json({ qid: 'L01-Q1', conceptCard: false });
        return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not in test"}' });
      });
      const p = await ctx2.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(BASE + 'index.html?mode=supabase'); await settle(p);
      ok(!seen.length, '열기만 했는데 서버 요청 ' + JSON.stringify(seen));
      await p.fill('#code', 'test23'); await p.click('[data-act=login]');
      await p.waitForSelector('[data-screen=home]');
      await p.click('[data-act=start]'); await p.waitForSelector('[data-screen=item] .choice');
      const signup = seen.filter(x => x.path.startsWith('/auth/v1/signup'));
      const claim = seen.find(x => x.path === '/rest/v1/rpc/claim_code');
      const np = seen.find(x => x.path === '/rest/v1/rpc/next_practice');
      const st = seen.find(x => x.path.startsWith('/rest/v1/students'));
      ok(signup.length === 1 && signup[0].method === 'POST', 'signup ' + signup.length);
      ok(claim && JSON.parse(claim.body).p_code === 'TEST23' && claim.apikey === KEY_ && /^Bearer /.test(claim.auth || ''), JSON.stringify(claim));
      ok(np && JSON.stringify(JSON.parse(np.body)) === '{"p_recent":[],"p_exclude":[]}', JSON.stringify(np));
      ok(st && /select=code%2Cnickname%2Cxp%2Cdiag_done|select=code,nickname,xp,diag_done/.test(st.path), st && st.path);
      const qd = seen.find(x => x.path.startsWith('/rest/v1/questions') && x.path.includes('practice'));
      ok(qd && qd.path.includes('pool=eq.practice') && qd.path.includes('order=id'), qd && qd.path);
      ok(!seen.some(x => x.apikey && x.apikey !== KEY_), '다른 열쇠');
      // 새로고침: 저장된 세션 재사용 → signup 추가 없음
      await p.reload(); await p.waitForSelector('[data-screen=home]');
      ok(seen.filter(x => x.path.startsWith('/auth/v1/signup')).length === 1, '새로고침 때 익명 계정을 또 만듦');
      ok(!errs.length, errs.join('|'));
      await ctx2.close();
      return '요청 ' + seen.length + '건 (signup 1, rpc ' + seen.filter(x => x.path.includes('/rpc/')).length + ')';
    });
  } finally {
    await browser.close(); server.kill(); if (server2) server2.kill();
    fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_supabase_mock_results.json'), JSON.stringify(results, null, 1));
  console.log(`\nSupabase 모드(가짜 서버) 테스트: 통과 ${pass} · 실패 ${fail}  ※ 실DB 미검증`);
  process.exit(fail ? 1 : 0);
})();
