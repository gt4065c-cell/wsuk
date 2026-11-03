// 2단계 M2 2차 자동 테스트 — AI 튜터 화면 (Playwright)
// 실행: node 04_제품개발팀/app2/tests/run_e2e_tutor.js
// - 로컬 모드(가짜 AI 응답) + Supabase 모드(가짜 서버 tests/mock_supabase.js, 진짜 라이브러리 + 가짜 HTTP 응답)
// - 진짜 Supabase·진짜 Anthropic 에는 한 번도 접속하지 않습니다. 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)만 씁니다.
// - 결과: tests/e2e_tutor_results.json, 스크린샷 screenshots/390_3x_*.png (가짜 학생만)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const load = require('./load_practice');

const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const SHOTS = path.join(APP, 'screenshots');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const KEY_ = fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8').match(/SUPABASE_ANON_KEY:\s*"([^"]*)"/)[1];
const PRACTICE = load('practice.js', 'LU_PRACTICE');
const DIAGQ = load('diagnostic.js', 'LU_DIAG');
const DKEY = load('dev_diag_key.js', 'LU_DEV_DIAG_KEY');
const DIAG = DIAGQ.map(q => Object.assign({}, q, DKEY[q.id]));
const MCQ = PRACTICE.filter(q => q.type === 'mcq');
const PORT = 10300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let browser;
function ok(c, m) { if (!c) throw new Error(m); }
async function test(id, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, status: 'pass', note: note || '', ms: Date.now() - t0 }); console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ id, name, status: 'fail', note: String(e && e.message || e), ms: Date.now() - t0 }); console.log(`  [실패] ${id} ${name} — ${e && e.message}`); }
}
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (opts.mock) {
    await ctx.addInitScript(([d, pre]) => {
      window.__MOCK_DATA = d;
      if (pre && !localStorage.getItem('mock_db')) localStorage.setItem('mock_db', JSON.stringify(pre));
    }, [opts.mock, opts.preDb || null]);
    await ctx.route('**/vendor/supabase.js', r => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  }
  if (!opts.realHttp) await ctx.route(/supabase\.co|anthropic\.com/, r => r.abort());   // 진짜 서버로 나가면 끊음
  const page = await ctx.newPage();
  page._errors = []; page._requests = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('request', r => page._requests.push(r.url()));
  return { ctx, page };
}
const settled = '#app .screen:not([data-screen=loading])';
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
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
// 로컬 모드: 코드 → 별명 → 진단 12문항("모르겠어요") → 홈
async function localLogin(p, code = 'TEST23', nick = '튜터시험') {
  await p.goto(BASE + 'index.html'); await p.waitForSelector(settled);
  await p.fill('#code', code); await p.click('[data-act=login]');
  await p.waitForSelector('[data-screen=nickname]'); await p.fill('#nick', nick); await p.click('[data-act=save-nick]');
  await p.waitForSelector('[data-screen=diag]');
  for (let i = 0; i < 12; i++) {
    const id = await p.getAttribute('#qid', 'data-id');
    ok(!(await p.$('#tutor')) && !(await p.$('#tutor-btn')), '진단 화면에 AI 튜터가 보임 (' + id + ')');
    await p.click('[data-act=diag-unknown]');
    if (i < 11) await p.waitForFunction(prev => document.querySelector('#qid') && document.querySelector('#qid').dataset.id !== prev, id);
  }
  await p.waitForSelector('[data-screen=diagResult]');
}
// 힌트 한 단계 열기 (10초 대기는 상태의 마지막 연 시각을 앞당겨 건너뜀 — 대기 규칙 자체는 run_e2e.js E-16이 시험)
async function openHint(p, level) {
  await p.evaluate(() => { window.__LU_APP.S.item.st.lastOpenAt = 0; });
  if (level >= 3) await p.fill('#thought', '내 생각 한 줄');
  await p.waitForFunction(() => !document.querySelector('#hint-btn').disabled);
  await p.click('#hint-btn'); await p.waitForSelector(`.hint-step[data-level="${level}"]`);
}
async function answerOf(p) {
  return p.evaluate(() => { const id = document.querySelector('#qid').dataset.id; return window.LU_PRACTICE.questions.find(q => q.id === id).answer_index; });
}
async function ask(p, text) {
  await p.fill('#tutor-q', text);
  await p.waitForFunction(() => !document.querySelector('#tutor-btn').disabled);
  const n = await p.$$eval('.tutor-a', x => x.length);
  await p.click('#tutor-btn');
  await p.waitForFunction(n => {
    const b = document.querySelector('#tutor-btn');
    return !(b && b.textContent.includes('생각하는 중')) && (document.querySelectorAll('.tutor-a').length > n || document.querySelector('#tutor-msg'));
  }, n);
}

(async () => {
  const server = await startServer(PUBLIC, PORT);
  browser = await chromium.launch();
  try {
    console.log('■ 로컬 모드 — 가짜 AI 응답');
    const L = await newPage(); const p = L.page;
    await test('U-01', '진단 12문항 화면에는 AI 튜터 버튼이 한 번도 안 보임', async () => { await localLogin(p); });
    const withHint = await p.evaluate(() => Object.keys(window.LU_HINTS.hints).find(id => { const q = window.LU_PRACTICE.questions.find(x => x.id === id); return q && q.type === 'mcq'; }));
    await test('U-02', '미리 만든 힌트가 있는 문항: L0~L2 에서는 AI 튜터 없음 → L3 본 뒤 [AI 튜터에게 물어보기] + "오늘 5번 남음"', async () => {
      await p.evaluate(id => window.__LU_APP.openItem(id, 'PRACTICE'), withHint); await p.waitForSelector('#hint-btn');
      ok(!(await p.$('#tutor')), 'L0에 보임');
      await openHint(p, 1); ok(!(await p.$('#tutor')), 'L1에 보임');
      await openHint(p, 2); ok(!(await p.$('#tutor')), 'L2에 보임');
      await openHint(p, 3); await p.waitForSelector('#tutor[data-state=on]');
      ok((await p.textContent('#tutor-left')).trim() === '오늘 5번 남음', await p.textContent('#tutor-left'));
      ok(await p.$eval('#tutor-btn', b => b.disabled), '빈 질문인데 버튼이 켜짐');
      ok(await p.$eval('#tutor-q', t => t.maxLength) === 300, '300자 제한');
      await shot(p, '390_30_AI튜터_L3뒤');
      return withHint;
    });
    await test('U-13', '빈 질문 칸: 버튼 위 "궁금한 점을 한 줄 쓰면 버튼이 켜져요" 안내 + 예시 placeholder → 글 쓰면 안내 사라지고 버튼 켜짐 (360·390px)', async () => {
      ok(await p.isVisible('#tutor-empty'), '빈 칸인데 안내가 안 보임');
      ok((await p.textContent('#tutor-empty')).includes('궁금한 점을 한 줄 쓰면 버튼이 켜져요'));
      ok(await p.$eval('#tutor-q', t => t.placeholder) === '예: 제가 고른 답이 왜 틀렸는지 모르겠어요', 'placeholder');
      ok(await p.$eval('#tutor-btn', b => b.disabled), '빈 칸인데 버튼이 켜짐');
      ok(await p.evaluate(() => { const e = document.querySelector('#tutor-empty'), b = document.querySelector('#tutor-btn'); return e.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING; }), '안내가 버튼 위에 있지 않음');
      for (const w of [360, 390]) {
        await p.setViewportSize({ width: w, height: 800 });
        await p.click('#tutor-empty');   // 안내를 누르면 질문 칸으로 이동
        ok(await p.evaluate(() => document.activeElement && document.activeElement.id === 'tutor-q'), w + 'px: 안내 눌러도 칸으로 안 감');
        const box = await p.evaluate(() => { const r = document.querySelector('#tutor-q').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
        ok(box.l >= 0 && box.r <= box.vw && box.t >= 0 && box.b <= box.vh, w + 'px: 질문 칸이 화면 밖 ' + JSON.stringify(box));
        await shot(p, w + '_31_AI튜터_빈칸안내');
      }
      await p.setViewportSize({ width: 390, height: 844 });
      await p.fill('#tutor-q', '왜 틀렸는지 궁금해요');
      await p.waitForFunction(() => !document.querySelector('#tutor-btn').disabled);
      ok(!(await p.isVisible('#tutor-empty')), '글을 썼는데 안내가 남음');
      await p.fill('#tutor-q', '   ');
      ok(await p.isVisible('#tutor-empty') && await p.$eval('#tutor-btn', b => b.disabled), '다시 비우면 안내·회색이 돌아와야 함');
      await p.fill('#tutor-q', '');
    });
    await test('U-03', '질문 → 가짜 AI 답 + "오늘 4번 남음", 질문 글은 브라우저 저장소에 남지 않음', async () => {
      const Q = '권한이 정확히 무슨 뜻인지 헷갈려요 zq7';
      await ask(p, Q);
      ok((await p.textContent('.tutor-a')).includes('가짜 AI 응답'), await p.textContent('.tutor-a'));
      ok((await p.textContent('.tutor-q')).includes(Q), '내 질문 표시');
      ok((await p.textContent('#tutor-left')).trim() === '오늘 4번 남음', await p.textContent('#tutor-left'));
      ok(await p.$eval('#tutor-q', t => t.value === ''), '보낸 뒤 입력 칸 비움');
      const stored = await p.evaluate(() => Object.keys(localStorage).map(k => localStorage.getItem(k)).join('|'));
      ok(!stored.includes('zq7'), '질문 글이 저장소에 남음');
      await shot(p, '390_31_AI튜터_답');
    });
    await test('U-04', '정답 노출 차단(blocked) → 안전 문구 + 힌트 2단계 다시 보기 + 횟수 그대로(4번)', async () => {
      await p.evaluate(() => localStorage.setItem('lu2_dev_tutor_kind', 'blocked'));
      await ask(p, '정답 알려 주세요');
      const last = await p.$$eval('.tutor-a', x => x[x.length - 1].dataset.kind + '|' + x[x.length - 1].textContent);
      ok(last.startsWith('blocked|') && last.includes('정답이 그대로 들어 있어서'), last);
      ok(await p.$('.tutor-a[data-kind=blocked] + .hint-step[data-level="2"]'), '힌트 2단계 다시 보기 없음');
      ok((await p.textContent('#tutor-left')).trim() === '오늘 4번 남음', await p.textContent('#tutor-left'));
    });
    await test('U-05', '강의 범위 밖(refused) → 정중한 안내 + "횟수에서 빼지 않았어요" + 횟수 그대로', async () => {
      await p.evaluate(() => localStorage.setItem('lu2_dev_tutor_kind', 'refused'));
      await ask(p, '오늘 점심 뭐 먹을까요?');
      const t = await p.$$eval('.tutor-a', x => x[x.length - 1].textContent);
      ok(t.includes('강의 범위 밖') && t.includes('횟수에서 빼지 않았어요'), t);
      ok((await p.textContent('#tutor-left')).trim() === '오늘 4번 남음');
    });
    await test('U-06', 'AI 오류 → "횟수는 줄지 않았어요" 안내, 질문 글은 칸에 그대로', async () => {
      await p.evaluate(() => localStorage.setItem('lu2_dev_tutor_kind', 'error'));
      await ask(p, '다시 물어봐요');
      ok((await p.textContent('#tutor-msg')).includes('횟수는 줄지 않았어요'));
      ok(await p.$eval('#tutor-q', t => t.value === '다시 물어봐요'), '질문 글이 사라짐');
    });
    await test('U-07', '오늘 남은 횟수 0 → 버튼 회색 + "내일 다시 열려요. 팀원에게 물어보는 것도 좋아요"', async () => {
      for (let i = 0; i < 4; i++) await ask(p, '질문 ' + i);
      await p.waitForSelector('#tutor[data-state=off][data-reason=DAY_LIMIT]');
      ok(await p.$eval('#tutor-btn', b => b.disabled), '버튼이 켜져 있음');
      ok((await p.textContent('#tutor-off')).includes('내일 다시 열려요. 팀원에게 물어보는 것도 좋아요'), await p.textContent('#tutor-off'));
      ok((await p.$$('.tutor-a')).length === 7, '지난 답이 사라짐');
      await shot(p, '390_32_AI튜터_오늘다씀');
    });
    await test('U-08', '문항을 끝내면(정답과 해설) 질문 칸은 사라지고 주고받은 답은 남음', async () => {
      const ans = await answerOf(p);
      await p.click(`.choice[data-orig="${(ans + 1) % 4}"]`); await p.click('[data-act=submit]'); await p.waitForSelector('#msg');
      await openHint(p, 4).catch(() => {});   // L4 = 해설 → 마감
      await p.waitForSelector('#verdict');
      ok(!(await p.$('#tutor-q')) && !(await p.$('#tutor-btn')), '끝난 문항에 질문 칸');
      ok((await p.$$('.tutor-a')).length === 7, '답이 사라짐');
    });

    const L2 = await newPage(); const q2 = L2.page;
    await test('U-09', '미리 만든 힌트가 없는 문항: 답 전에는 없음 → 오답 1번 낸 뒤 AI 튜터 열림', async () => {
      await localLogin(q2, 'TEST45', '힌트없음');
      const id = await q2.evaluate(() => window.LU_PRACTICE.questions.find(x => !window.LU_HINTS.hints[x.id] && x.type === 'mcq').id);
      await q2.evaluate(id => window.__LU_APP.openItem(id, 'PRACTICE'), id); await q2.waitForSelector('#hint-btn');
      ok(!(await q2.$('#tutor')), '답 전에 보임');
      const ans = await answerOf(q2);
      await q2.click(`.choice[data-orig="${(ans + 1) % 4}"]`); await q2.click('[data-act=submit]'); await q2.waitForSelector('#msg');
      await q2.waitForSelector('#tutor[data-state=on]');
      return id;
    });
    await test('U-10', '꺼짐 흉내(BUDGET) → "이번 달 AI 튜터 사용량이 다 찼어요" + 버튼 회색', async () => {
      await q2.evaluate(() => localStorage.setItem('lu2_dev_tutor_off', 'BUDGET'));
      const id = await q2.evaluate(() => window.LU_PRACTICE.questions.filter(x => !window.LU_HINTS.hints[x.id] && x.type === 'mcq')[1].id);
      await q2.evaluate(id => window.__LU_APP.openItem(id, 'PRACTICE'), id); await q2.waitForSelector('#hint-btn');
      const ans = await answerOf(q2);
      await q2.click(`.choice[data-orig="${(ans + 1) % 4}"]`); await q2.click('[data-act=submit]'); await q2.waitForSelector('#msg');
      await q2.waitForSelector('#tutor[data-state=off][data-reason=BUDGET]');
      ok((await q2.textContent('#tutor-off')).includes('이번 달 AI 튜터 사용량이 다 찼어요') && await q2.$eval('#tutor-btn', b => b.disabled));
      await shot(q2, '390_33_AI튜터_예산꺼짐');
    });
    await test('U-11', 'O/X 문항(힌트 없음)은 1번 내면 끝나므로 AI 튜터가 열리지 않음', async () => {
      await q2.evaluate(() => localStorage.removeItem('lu2_dev_tutor_off'));
      const id = await q2.evaluate(() => (window.LU_PRACTICE.questions.find(x => !window.LU_HINTS.hints[x.id] && x.type === 'ox') || {}).id);
      if (!id) return '힌트 없는 O/X 문항 없음 — 건너뜀';
      await q2.evaluate(id => window.__LU_APP.openItem(id, 'PRACTICE'), id); await q2.waitForSelector('[data-act=submit]');
      ok(!(await q2.$('#tutor')));
      const ans = await answerOf(q2);
      await q2.click(`.choice[data-orig="${1 - ans}"]`); await q2.click('[data-act=submit]'); await q2.waitForSelector('#verdict');
      ok(!(await q2.$('#tutor-btn')), '끝난 O/X 에 AI 버튼');
    });
    await test('U-12', '로컬 모드: 인터넷 요청 0건(Anthropic·Supabase), 자바스크립트 오류 0건', async () => {
      const out = p._requests.concat(q2._requests).filter(u => !u.startsWith(BASE));
      ok(!out.length, out.join(', '));
      ok(!p._errors.length && !q2._errors.length, p._errors.concat(q2._errors).join(' / '));
    });
    await L.ctx.close(); await L2.ctx.close();

    console.log('■ Supabase 모드 — 가짜 서버(mock)');
    const PRE = { students: { TEST23: { code: 'TEST23', nickname: '하늘별', xp: 0, diag_done: true } }, devices: {}, tries: {}, attempts: [], diag: {} };
    const BASE_DATA = { practice: MCQ, diag: DIAG, codes: ['TEST23'], reviewedHints: {} };
    async function mockToItem(data) {
      const M = await newPage({ mock: data, preDb: PRE }); const mp = M.page;
      await mp.goto(BASE + 'index.html?mode=supabase'); await mp.waitForSelector(settled);
      await mp.fill('#code', 'TEST23'); await mp.click('[data-act=login]'); await mp.waitForSelector('[data-screen=home]');
      await mp.click('[data-act=start]'); await mp.waitForSelector('[data-screen=item] .choice');
      const id = await mp.getAttribute('#qid', 'data-id'); const ans = MCQ.find(q => q.id === id).answer_index;
      await mp.click(`.choice[data-orig="${(ans + 1) % 4}"]`); await mp.click('[data-act=submit]'); await mp.waitForSelector('#msg');
      return { M, mp, id, ans };
    }
    const logOf = mp => mp.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]'));
    await test('V-01', '서버 남은 횟수(tutor_status) 표시 → 질문은 Edge Function ai-tutor 로, 보내는 것은 문항 번호·힌트 단계·오답 번호·질문 글뿐', async () => {
      const { M, mp, id, ans } = await mockToItem(Object.assign({}, BASE_DATA, { tutor: { enabled: true, used: 2, reply: '가짜 서버 답: 표마다 켜는 설정이 무엇이었죠?' } }));
      await mp.waitForSelector('#tutor[data-state=on]');
      ok((await mp.textContent('#tutor-left')).trim() === '오늘 3번 남음', await mp.textContent('#tutor-left'));
      await ask(mp, '이 보기가 왜 틀렸는지 모르겠어요');
      ok((await mp.textContent('.tutor-a')).includes('가짜 서버 답') && (await mp.textContent('#tutor-left')).trim() === '오늘 2번 남음');
      const inv = (await logOf(mp)).filter(x => x.t === 'invoke');
      ok(inv.length === 1 && inv[0].name === 'ai-tutor', JSON.stringify(inv));
      const b = inv[0].body;
      ok(JSON.stringify(Object.keys(b).sort()) === '["level","qid","question","tried"]', JSON.stringify(b));
      ok(b.qid === id && b.level === 0 && JSON.stringify(b.tried) === JSON.stringify([(ans + 1) % 4]) && b.question === '이 보기가 왜 틀렸는지 모르겠어요', JSON.stringify(b));
      ok(!JSON.stringify(b).includes('TEST23') && !JSON.stringify(b).includes('하늘별'), '코드·별명이 감');
      ok((await logOf(mp)).some(x => x.t === 'rpc' && x.name === 'tutor_status'), 'tutor_status 안 부름');
      await shot(mp, '390_34_AI튜터_Supabase모드');
      await M.ctx.close();
    });
    await test('V-02', '서버가 꺼짐(BUDGET)이라고 하면 쉬운 안내 + 버튼 회색, Edge Function 은 부르지 않음', async () => {
      const { M, mp } = await mockToItem(Object.assign({}, BASE_DATA, { tutor: { reason: 'BUDGET' } }));
      await mp.waitForSelector('#tutor[data-state=off][data-reason=BUDGET]');
      ok((await mp.textContent('#tutor-off')).includes('이번 달 AI 튜터 사용량이 다 찼어요'));
      ok(!(await logOf(mp)).some(x => x.t === 'invoke'), 'invoke 부름');
      await M.ctx.close();
    });
    await test('V-03', '질문 중 서버가 거절(NOT_PRACTICE 등) → 서버 안내 한 줄 표시', async () => {
      const { M, mp } = await mockToItem(Object.assign({}, BASE_DATA, { tutor: { enabled: true, error: 'NOT_PRACTICE', message: 'AI 튜터는 연습 문제에서만 쓸 수 있어요.' } }));
      await mp.waitForSelector('#tutor[data-state=on]');
      await ask(mp, '물어봐요');
      ok((await mp.textContent('#tutor-msg')).includes('연습 문제에서만'), await mp.textContent('#tutor').catch(() => ''));
      await M.ctx.close();
    });
    await test('V-04', '서버에 AI 튜터가 아직 없으면(SQL 적용 전) 버튼을 조용히 숨김 — 문제 풀이는 그대로', async () => {
      const { M, mp, ans } = await mockToItem(BASE_DATA);
      await mp.waitForFunction(() => !document.querySelector('#tutor'));
      ok(!(await mp.$('#tutor-btn')));
      await mp.click(`.choice[data-orig="${ans}"]`); await mp.click('[data-act=submit]'); await mp.waitForSelector('#verdict');
      ok(!mp._errors.length, mp._errors.join(' / '));
      await M.ctx.close();
    });

    console.log('■ 진짜 라이브러리(vendor) + 가짜 HTTP — Edge Function 요청 모양');
    await test('V-05', '진짜 supabase-js: POST /functions/v1/ai-tutor, 학생 로그인 토큰(Bearer)·공개 열쇠(apikey), Anthropic 직접 요청 0건', async () => {
      const ctx2 = await browser.newContext();
      const seen = [];
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: '00000000-0000-4000-8000-000000000001', role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, is_anonymous: true, session_id: 'fake' }) + '.fakesig';
      const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      const anth = [];
      await ctx2.route(/anthropic\.com/, r => { anth.push(r.request().url()); return r.abort(); });
      await ctx2.route(/supabase\.co/, async r => {
        const req = r.request(), u = new URL(req.url());
        seen.push({ method: req.method(), path: u.pathname, body: req.postData(), apikey: req.headers()['apikey'], auth: req.headers()['authorization'] });
        const json = o => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
        if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        if (u.pathname === '/auth/v1/signup') return json({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'fake-refresh', user });
        if (u.pathname === '/auth/v1/user') return json(user);
        if (u.pathname === '/rest/v1/rpc/claim_code') return json({ ok: true, student: { code: 'TEST23', nickname: '하늘별', xp: 0, diagDone: true, diagAnswered: 12 } });
        if (u.pathname === '/rest/v1/rpc/today_summary') return json({ day: '2026-11-02', reviews: [], newDone: 0, newTarget: 5, xp: 0, xpToday: 0, weekXp: 0, weekSolved: 0, counts: {} });
        if (u.pathname === '/rest/v1/rpc/my_team_summary') return json({ inTeam: false, teamOff: false });
        if (u.pathname === '/rest/v1/students') return json([{ code: 'TEST23', nickname: '하늘별', xp: 0, diag_done: true }]);
        if (u.pathname === '/rest/v1/diag_answers') return json([]);
        if (u.pathname === '/rest/v1/questions') return json([{ id: 'L01-Q1', part: 1, lecture: 1, difficulty: 1, type: 'mcq', question: '가짜 문항', choices: ['가', '나', '다', '라'], source_section: '01강' }]);
        if (u.pathname === '/rest/v1/question_keys') return json([{ question_id: 'L01-Q1', answer_index: 0, explanation: '가짜 해설', common_wrong_index: 1, common_wrong_reason: null }]);
        if (u.pathname === '/rest/v1/hints') return json([]);
        if (u.pathname === '/rest/v1/rpc/next_practice') return json({ qid: 'L01-Q1', conceptCard: false });
        if (u.pathname === '/rest/v1/rpc/tutor_status') return json({ enabled: true, reason: null, dayLimit: 5, dayLeft: 5, monthLeft: 60, left: 5 });
        if (u.pathname === '/functions/v1/ai-tutor') return json({ ok: true, kind: 'ok', reply: '가짜 함수 답이에요. 어느 낱말이 헷갈리나요?', enabled: true, reason: null, dayLimit: 5, dayLeft: 4, monthLeft: 59, left: 4 });
        return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not in test"}' });
      });
      const p3 = await ctx2.newPage(); const errs = []; p3.on('pageerror', e => errs.push(e.message));
      await p3.goto(BASE + 'index.html?mode=supabase'); await p3.waitForSelector(settled);
      await p3.fill('#code', 'TEST23'); await p3.click('[data-act=login]'); await p3.waitForSelector('[data-screen=home]');
      await p3.click('[data-act=start]'); await p3.waitForSelector('[data-screen=item] .choice');
      await p3.click('.choice[data-orig="2"]'); await p3.click('[data-act=submit]'); await p3.waitForSelector('#tutor[data-state=on]');
      await ask(p3, '왜 틀렸는지 궁금해요');
      ok((await p3.textContent('.tutor-a')).includes('가짜 함수 답') && (await p3.textContent('#tutor-left')).trim() === '오늘 4번 남음');
      const inv = seen.find(x => x.path === '/functions/v1/ai-tutor' && x.method === 'POST');
      ok(inv && inv.auth === 'Bearer ' + jwt && inv.apikey === KEY_, JSON.stringify(inv && { auth: inv.auth && inv.auth.slice(0, 20), apikey: inv.apikey }));
      ok(JSON.stringify(JSON.parse(inv.body)) === JSON.stringify({ qid: 'L01-Q1', level: 0, tried: [2], question: '왜 틀렸는지 궁금해요' }), inv.body);
      ok(!anth.length, 'Anthropic 직접 요청 ' + anth.join(','));
      ok(!errs.length, errs.join(' / '));
      await ctx2.close();
    });

    console.log('■ 배포 폴더 검사');
    await test('V-06', '화면 파일(public/js)에 Anthropic 키 모양·주소 없음, Edge Function 폴더는 화면(public/) 밖', async () => {
      const js = fs.readdirSync(path.join(PUBLIC, 'js')).map(f => fs.readFileSync(path.join(PUBLIC, 'js', f), 'utf8')).join('\n');
      ok(!/sk-ant-/.test(js) && !js.includes('api.anthropic.com') && !js.includes('ANTHROPIC_API_KEY'), '화면 코드에 키·주소');
      ok(!fs.existsSync(path.join(PUBLIC, 'functions')) && fs.existsSync(path.join(APP, 'supabase/functions/ai-tutor/index.ts')));
    });
  } finally {
    await browser.close(); server.kill();
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_tutor_results.json'), JSON.stringify(results, null, 1));
  console.log(`\nAI 튜터 화면 테스트: 통과 ${pass} · 실패 ${fail}  ※ 가짜 AI·가짜 서버 (실제 호출 미검증)`);
  process.exit(fail ? 1 : 0);
})();
