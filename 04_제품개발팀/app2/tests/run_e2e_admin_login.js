// 교수 화면 로그인 보강 자동 테스트 — 이메일+비밀번호 로그인(기본) · 메일 링크(보조) · 쉬운 오류 문구 (Playwright)
// 실행: node 04_제품개발팀/app2/tests/run_e2e_admin_login.js
// - 가짜 서버(tests/mock_supabase.js) + 진짜 supabase-js 라이브러리에 가짜 HTTP 응답. 진짜 Supabase에는 접속하지 않음(실DB 미검증)
// - 가짜 이메일(example.com)·가짜 비밀번호만 사용. 결과: tests/e2e_admin_login_results.json
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const SHOTS = path.join(APP, 'screenshots');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const CFG_SRC = fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8');
const KEY_ = CFG_SRC.match(/SUPABASE_ANON_KEY:\s*"([^"]*)"/)[1];
const PORT = 10300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
const ADMIN_URL = BASE + 'admin.html?mode=supabase';
const DEPLOY_DIR = path.join(os.tmpdir(), 'lu2_deploy_login_' + process.pid);
const PW = 'fake-pass-1234';   // 가짜 비밀번호 (mock_supabase.js 기본값)
fs.mkdirSync(SHOTS, { recursive: true });
const STATS = { students: 50, linked: 48, diagDone: 45, activeWeek: 30, minN: 3, items: [], lectures: [] };
const TEAMS = { achievedCount: 0, unassigned: 0, resting: 0, teams: [] };
const DATA = { practice: [], diag: [], codes: [], reviewedHints: {},
  adminUsers: ['prof@example.com', 'other@example.com'], adminEmails: ['prof@example.com'], adminStats: STATS, adminTeams: TEAMS };
const results = [];
let browser;
function ok(c, m) { if (!c) throw new Error(m); }
async function test(id, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, status: 'pass', note: note || '', ms: Date.now() - t0 }); console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ id, name, status: 'fail', note: String(e && e.message || e), ms: Date.now() - t0 }); console.log(`  [실패] ${id} ${name} — ${e && e.message}`); }
}
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 } });
  if (opts.mock) {
    await ctx.addInitScript(d => { window.__MOCK_DATA = d; }, opts.mock);
    await ctx.route('**/vendor/supabase.js', r => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  }
  if (!opts.realHttp) await ctx.route(/supabase\.co/, r => r.abort());
  const page = await ctx.newPage();
  page._errors = []; page._console = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('console', m => page._console.push(m.text()));
  return { ctx, page };
}
const settled = '.screen:not([data-screen=loading])';
async function screenOf(page) { return page.getAttribute('#admin .screen', 'data-screen'); }
async function logOf(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]')); }
async function clearLog(page) { await page.evaluate(() => localStorage.removeItem('mock_log')); }
async function errText(page) { await page.waitForSelector('#err'); return (await page.textContent('#err')).trim(); }
async function storageDump(page) { return page.evaluate(() => JSON.stringify(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])) + JSON.stringify(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])) + document.cookie); }
async function fresh(page) { await page.goto(ADMIN_URL); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await page.reload(); await page.waitForSelector('#admin ' + settled); }
function startServer(dir, port) {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', dir], { stdio: 'ignore' });
    const t0 = Date.now();
    (function wait() {
      http.get(`http://127.0.0.1:${port}/admin.html`, res => { res.resume(); resolve(p); })
        .on('error', () => Date.now() - t0 > 8000 ? reject(new Error('임시 서버 시작 실패')) : setTimeout(wait, 150));
    })();
  });
}
const DEV_WORDS = /README|SQL|supabase|Supabase|over_email|429|invalid_credentials/;

(async () => {
  const server = await startServer(PUBLIC, PORT);
  browser = await chromium.launch();
  try {
    console.log('■ 로컬 모드 — 바뀌지 않음');
    const L = await newPage({ viewport: { width: 1024, height: 900 } });
    await test('P-01', '로컬 모드: 비밀번호 칸 없음, 가짜 교수 이메일 + [들어가기] 로 그대로 들어감', async () => {
      const p = L.page; await p.goto(BASE + 'admin.html'); await p.waitForSelector('#admin ' + settled);
      ok(!(await p.$('#password')) && !(await p.$('[data-act=password]')), '비밀번호 칸');
      ok((await p.textContent('[data-act=send]')).trim() === '들어가기', '버튼');
      await p.fill('#email', 'prof@example.com'); await p.click('[data-act=send]'); await p.waitForSelector('[data-screen=dash]');
    });
    await L.ctx.close();

    console.log('■ Supabase 모드(가짜 서버) — 비밀번호 로그인');
    const P = await newPage({ mock: DATA, viewport: { width: 1024, height: 900 } });
    const pp = P.page;
    await test('P-02', '첫 화면: 이메일 · 비밀번호(type=password, autocomplete=current-password, 값 없음) · [로그인] 먼저, 아래에 [메일로 로그인 링크 받기]', async () => {
      await fresh(pp);
      ok(await screenOf(pp) === 'login', '화면');
      const pw = await pp.$eval('#password', e => ({ type: e.type, ac: e.getAttribute('autocomplete'), v: e.value, attr: e.getAttribute('value') }));
      ok(pw.type === 'password' && pw.ac === 'current-password' && pw.v === '' && pw.attr === null, JSON.stringify(pw));
      ok((await pp.textContent('[data-act=password]')).trim() === '로그인', '로그인 버튼');
      ok((await pp.textContent('[data-act=send]')).trim() === '메일로 로그인 링크 받기', '메일 버튼');
      const order = await pp.evaluate(() => { const a = document.querySelector('[data-act=password]'), b = document.querySelector('[data-act=send]'); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
      ok(order, '비밀번호 로그인이 위에 있어야 함');
      ok(await pp.$eval('[data-act=password]', e => e.className.includes('btn-primary')), '기본 버튼 강조');
      const t = await pp.textContent('#admin');
      ok(!t.includes('비밀번호는 없어요') && !DEV_WORDS.test(t), t);
      await pp.screenshot({ path: path.join(SHOTS, '1024_50_교수로그인_비밀번호.png'), fullPage: true });
    });
    await test('P-03', '빈 비밀번호 → "비밀번호를 넣어 주세요", 서버 요청 없음 · 이메일 모양 틀림도 막음', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'prof@example.com'); await pp.click('[data-act=password]');
      ok((await errText(pp)) .includes('비밀번호를 넣어 주세요'), '빈 칸');
      await pp.fill('#email', '이메일아님'); await pp.fill('#password', 'x'); await pp.click('[data-act=password]');
      ok((await errText(pp)).includes('이메일 주소 모양'), '모양');
      ok(!(await logOf(pp)).some(x => /^signIn/.test(x.t)), '요청이 나감');
    });
    await test('P-04', '틀린 비밀번호 → 쉬운 말 안내(개발 용어 없음) + 비밀번호 칸 비움, 메일은 보내지 않음', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'prof@example.com'); await pp.fill('#password', 'wrong-pass'); await pp.click('[data-act=password]');
      const m = await errText(pp);
      ok(m.includes('이메일이나 비밀번호가 맞지 않아요') && !DEV_WORDS.test(m), m);
      ok((await pp.$eval('#password', e => e.value)) === '', '비밀번호가 칸에 남음');
      const l = await logOf(pp);
      ok(l.some(x => x.t === 'signInWithPassword' && x.email === 'prof@example.com') && !l.some(x => x.t === 'signInWithOtp'), JSON.stringify(l));
      ok(!(await storageDump(pp)).includes('wrong-pass'), '비밀번호가 저장소에 남음');
    });
    await test('P-05', '등록 안 된 이메일 + 비밀번호 → 같은 안내(서버가 구분해 주지 않음)', async () => {
      await pp.fill('#email', 'nobody@example.com'); await pp.fill('#password', PW); await pp.click('[data-act=password]');
      await pp.waitForFunction(() => document.querySelector('#err') && document.querySelector('#err').textContent.includes('비밀번호가 맞지 않아요'));
    });
    await test('P-06', '교수 이메일 + 맞는 비밀번호 → admin_whoami 판정 → 대시보드, 비밀번호는 저장소·화면·콘솔 어디에도 없음', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'PROF@example.com'); await pp.fill('#password', PW); await pp.click('[data-act=password]');
      await pp.waitForSelector('[data-screen=dash]');
      const l = await logOf(pp);
      const s = l.find(x => x.t === 'signInWithPassword');
      ok(s && s.email === 'PROF@example.com' && s.pwLen === PW.length && JSON.stringify(s.keys) === '["email","password"]', JSON.stringify(s));
      const r = l.filter(x => x.t === 'rpc').map(x => x.name);
      ok(r[0] === 'admin_whoami' && r.includes('admin_item_stats'), r.join());
      ok(!l.some(x => x.t === 'signInWithOtp'), '메일을 보냄');
      const dump = await storageDump(pp);
      ok(!dump.includes(PW), '비밀번호가 localStorage/sessionStorage/쿠키에 남음');
      ok(!(await pp.content()).includes(PW), '비밀번호가 화면 HTML 에 남음');
      ok(!pp._console.some(t => t.includes(PW)), '콘솔에 비밀번호');
      ok((await pp.textContent('#who')).includes('prof@example.com'), '로그인 표시');
      await pp.reload(); await pp.waitForSelector('[data-screen=dash]');   // 새로고침해도 로그인 유지
      await pp.click('[data-act=logout]'); await pp.waitForSelector('[data-screen=login]');
      ok((await pp.$eval('#password', e => e.value)) === '', '로그아웃 뒤 비밀번호 칸이 채워져 있음');
    });
    await test('P-07', '등록은 됐지만 admins 표에 없는 계정: 비밀번호 로그인 성공해도 "교수 계정이 아니에요", 통계 함수 안 부름', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'other@example.com'); await pp.fill('#password', PW); await pp.click('[data-act=password]');
      await pp.waitForSelector('[data-screen=notAdmin]');
      ok(!(await logOf(pp)).some(x => x.t === 'rpc' && x.name !== 'admin_whoami'), '통계 요청');
      await pp.click('[data-act=logout]'); await pp.waitForSelector('[data-screen=login]');
    });
    await test('P-08', '엔터키: 이메일 칸에서 엔터 → 비밀번호 칸으로(메일 안 보냄), 비밀번호 칸에서 엔터 → 로그인', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'prof@example.com'); await pp.press('#email', 'Enter');
      ok(await pp.evaluate(() => document.activeElement && document.activeElement.id === 'password'), '포커스');
      ok(!(await logOf(pp)).some(x => /^signIn/.test(x.t)), '엔터로 요청이 나감');
      await pp.keyboard.type(PW); await pp.press('#password', 'Enter');
      await pp.waitForSelector('[data-screen=dash]');
      await pp.click('[data-act=logout]'); await pp.waitForSelector('[data-screen=login]');
    });
    await test('P-09', '비밀번호 로그인을 너무 자주 시도(429) → "몇 분 뒤에 다시"', async () => {
      await pp.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ signInWithPassword: 'Request rate limit reached' })));
      await pp.fill('#email', 'prof@example.com'); await pp.fill('#password', PW); await pp.click('[data-act=password]');
      const m = await errText(pp);
      ok(m.includes('짧은 시간에 너무 여러 번') && !DEV_WORDS.test(m), m);
      await pp.evaluate(() => localStorage.removeItem('mock_fail'));
    });

    console.log('■ 메일 링크(보조) — 쉬운 오류 문구');
    await test('P-10', '메일 한도 초과(429 email rate limit) → "한 시간에 몇 통만 … 비밀번호로 로그인하거나 한 시간쯤 뒤에"', async () => {
      await pp.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ signInWithOtp: 'email rate limit exceeded' })));
      await pp.fill('#email', 'prof@example.com'); await pp.click('[data-act=send]');
      const m = await errText(pp);
      ok(m.includes('로그인 메일은 한 시간에 몇 통만 보낼 수 있어요. 비밀번호로 로그인하거나 한 시간쯤 뒤에 다시 해 주세요.') && !DEV_WORDS.test(m), m);
      ok(await pp.$('#password'), '비밀번호 칸이 그대로 있어야 바로 비밀번호로 시도 가능');
      await pp.evaluate(() => localStorage.removeItem('mock_fail'));
    });
    await test('P-11', '등록 안 된 이메일로 메일 요청 → "교수 계정으로 등록되지 않은 이메일이에요. 비서실장에게 등록을 부탁하세요." (README 없음)', async () => {
      await pp.fill('#email', 'nobody@example.com'); await pp.click('[data-act=send]');
      await pp.waitForFunction(() => document.querySelector('#err') && document.querySelector('#err').textContent.includes('등록되지 않은'));
      const m = await errText(pp);
      ok(m.includes('교수 계정으로 등록되지 않은 이메일이에요. 비서실장에게 등록을 부탁하세요.') && !DEV_WORDS.test(m), m);
    });
    await test('P-12', '메일 링크 흐름은 그대로: 메일 보냄 → 6자리 숫자 → 대시보드, 돌아올 주소 = 지금 페이지 주소', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'prof@example.com'); await pp.click('[data-act=send]'); await pp.waitForSelector('#sent');
      ok(!(await pp.$('#password')), '메일 보낸 뒤에는 숫자 칸만');
      const o = (await logOf(pp)).find(x => x.t === 'signInWithOtp');
      ok(o.options.emailRedirectTo === ADMIN_URL && o.options.shouldCreateUser === false, JSON.stringify(o));
      await pp.fill('#otp', '123456'); await pp.click('[data-act=verify]'); await pp.waitForSelector('[data-screen=dash]');
      await pp.click('[data-act=logout]'); await pp.waitForSelector('[data-screen=login]');
      ok(!pp._errors.length, pp._errors.join('|'));
    });
    await P.ctx.close();

    const N = await newPage({ mock: DATA });
    await test('P-13', '390px 휴대폰 너비: 로그인 화면 가로 넘침 없음, 두 버튼 모두 보임', async () => {
      await N.page.goto(ADMIN_URL); await N.page.waitForSelector('#admin ' + settled);
      const over = await N.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 1, '가로 넘침 ' + over + 'px');
      ok(await N.page.isVisible('[data-act=password]') && await N.page.isVisible('[data-act=send]'), '버튼');
      await N.page.screenshot({ path: path.join(SHOTS, '390_50_교수로그인_비밀번호.png'), fullPage: true });
    });
    await N.ctx.close();

    console.log('■ 진짜 supabase-js + 가짜 HTTP 응답 — 실제 서버 오류 모양');
    await test('P-14', '진짜 라이브러리: POST /auth/v1/token?grant_type=password {email,password} → 400 invalid_credentials 쉬운 안내 → 맞으면 rpc admin_whoami 에 교수 토큰 · /otp 429 over_email_send_rate_limit 쉬운 안내', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
      const seen = [];
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const uid = '00000000-0000-4000-8000-0000000000bb';
      const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'prof@example.com', is_anonymous: false, session_id: 'fake' }) + '.fakesig';
      const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'prof@example.com', is_anonymous: false, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
      await ctx.route(/supabase\.co/, async r => {
        const req = r.request(), u = new URL(req.url());
        seen.push({ method: req.method(), path: u.pathname, search: u.search, body: req.postData(), apikey: req.headers()['apikey'], auth: req.headers()['authorization'] });
        const json = (o, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        if (u.pathname === '/auth/v1/otp') return json({ code: 429, error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' }, 429);
        if (u.pathname === '/auth/v1/token') {
          const b = JSON.parse(req.postData() || '{}');
          if (b.password !== PW) return json({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
          return json({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'fake-refresh', user });
        }
        if (u.pathname === '/auth/v1/user') return json(user);
        if (u.pathname === '/rest/v1/rpc/admin_whoami') return json({ admin: true, email: 'prof@example.com', today: '2026-11-05', weekStart: '2026-11-02', cohorts: ['2027-1'] });
        if (u.pathname === '/rest/v1/rpc/admin_item_stats') return json(STATS);
        if (u.pathname === '/rest/v1/rpc/admin_team_week') return json(Object.assign({ weekStart: '2026-11-02' }, TEAMS));
        return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not in test"}' });
      });
      const p = await ctx.newPage(); const errs = []; const cons = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => cons.push(m.text()));
      await p.goto(ADMIN_URL); await p.waitForSelector('#admin ' + settled);
      await p.fill('#email', 'prof@example.com'); await p.click('[data-act=send]');
      const m1 = await errText(p);
      ok(m1.includes('한 시간에 몇 통만') && m1.includes('비밀번호로 로그인'), m1);
      await p.fill('#password', 'wrong-pass'); await p.click('[data-act=password]');
      await p.waitForFunction(() => document.querySelector('#err') && document.querySelector('#err').textContent.includes('비밀번호가 맞지 않아요'));
      await p.fill('#password', PW); await p.click('[data-act=password]'); await p.waitForSelector('[data-screen=dash]');
      const tok = seen.filter(x => x.path === '/auth/v1/token');
      ok(tok.length === 2 && tok.every(x => x.method === 'POST' && x.apikey === KEY_ && new URLSearchParams(x.search).get('grant_type') === 'password'), JSON.stringify(tok.map(x => x.search)));
      const tb = JSON.parse(tok[1].body); ok(tb.email === 'prof@example.com' && tb.password === PW, '보낸 내용');
      const w = seen.find(x => x.path === '/rest/v1/rpc/admin_whoami'); ok(w && w.auth === 'Bearer ' + jwt, '교수 토큰');
      const dump = await storageDump(p);
      ok(!dump.includes(PW) && !dump.includes('wrong-pass'), '비밀번호가 저장소에 남음');
      ok(!cons.some(t => t.includes(PW) || t.includes('wrong-pass')), '콘솔');
      ok(!errs.length, errs.join('|'));
      await ctx.close();
      return '요청 ' + seen.length + '건';
    });

    console.log('■ 배포용 폴더 (tools/make_deploy.py)');
    await test('P-15', '배포용 복사본 admin.js 에도 비밀번호 로그인·쉬운 문구가 들어감, 로그인 문구에 README 없음', async () => {
      execFileSync('python3', [path.join(APP, 'tools/make_deploy.py'), DEPLOY_DIR], { encoding: 'utf8' });
      const js = fs.readFileSync(path.join(DEPLOY_DIR, 'js/admin.js'), 'utf8');
      ok(js.includes('signInWithPassword') && js.includes('autocomplete="current-password"') && js.includes('비서실장에게 등록을 부탁하세요'), '새 코드');
      const ex = js.slice(js.indexOf('function explain('), js.indexOf('A. 로컬 모드'));
      const lg = js.slice(js.indexOf('function vLogin('), js.indexOf('function vNotAdmin('));
      ok(ex.length > 200 && lg.length > 200 && !/README/.test(ex + lg), '로그인 문구에 README');
    });
  } finally {
    await browser.close(); server.kill();
    fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_admin_login_results.json'), JSON.stringify(results, null, 1));
  console.log(`\n교수 로그인 보강 테스트: 통과 ${pass} · 실패 ${fail}  ※ 실DB 미검증`);
  process.exit(fail ? 1 : 0);
})();
