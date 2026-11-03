// 2단계 M2 1차 자동 테스트 — 팀 카드(학생 홈) + 교수 화면(admin.html) (Playwright)
// 실행: node 04_제품개발팀/app2/tests/run_e2e_m2.js
// - 로컬 모드(가짜 팀원·가짜 통계) + Supabase 모드(가짜 서버 tests/mock_supabase.js, 진짜 라이브러리 + 가짜 HTTP 응답)
// - 진짜 Supabase에는 한 번도 접속하지 않습니다(실DB 미검증). 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)만 씁니다.
// - 이 컴퓨터에 PostgreSQL 16이 있으면 supabase/local_test/run_m2_local.sh 로 새 SQL도 시험합니다.
// - 결과: tests/e2e_m2_results.json, 스크린샷 screenshots/ (가짜 학생·가짜 이메일(example.com)만 사용)
const { chromium } = require('playwright');
const { spawn, execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const load = require('./load_practice');
const LU = require('../public/js/logic.js');

const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const SHOTS = path.join(APP, 'screenshots');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const CFG_SRC = fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8');
const KEY_ = CFG_SRC.match(/SUPABASE_ANON_KEY:\s*"([^"]*)"/)[1];
const PRACTICE = load('practice.js', 'LU_PRACTICE');
const DIAGQ = load('diagnostic.js', 'LU_DIAG');
const DKEY = load('dev_diag_key.js', 'LU_DEV_DIAG_KEY');
const DIAG = DIAGQ.map(q => Object.assign({}, q, DKEY[q.id]));
const PORT = 9900 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
const PORT2 = PORT + 1;
const BASE2 = `http://127.0.0.1:${PORT2}/`;
const DEPLOY_DIR = path.join(os.tmpdir(), 'lu2_deploy_m2_' + process.pid);
fs.mkdirSync(SHOTS, { recursive: true });

// 가짜 서버 데이터 (가짜 학생·가짜 이메일만)
const STATS = { students: 50, linked: 48, diagDone: 45, activeWeek: 30, minN: 3,
  items: [
    { qid: PRACTICE[3].id, pool: 'practice', lecture: PRACTICE[3].lecture, question: PRACTICE[3].question, n: 12, wrong: 9, unknown: 0, hinted: 4, wrongRate: 0.75, topWrongText: PRACTICE[3].choices[1], topWrongIndex: 1, answerText: PRACTICE[3].choices[PRACTICE[3].answer_index] },
    { qid: DIAG[0].id, pool: 'diagnostic', lecture: DIAG[0].lecture, question: DIAG[0].question, n: 45, wrong: 27, unknown: 6, hinted: 0, wrongRate: 0.6, topWrongText: DIAG[0].choices[2], topWrongIndex: 2, answerText: DIAG[0].choices[DIAG[0].answer_index] },
    { qid: PRACTICE[0].id, pool: 'practice', lecture: PRACTICE[0].lecture, question: PRACTICE[0].question, n: 20, wrong: 5, unknown: 0, hinted: 2, wrongRate: 0.25, topWrongText: null, topWrongIndex: null, answerText: PRACTICE[0].choices[PRACTICE[0].answer_index] }],
  lectures: [{ lecture: 1, n: 120, correctRate: 0.71 }, { lecture: 2, n: 80, correctRate: 0.55 }] };
const TEAMS = { achievedCount: 1, unassigned: 2, resting: 1, teams: [
  { name: '2팀', cohort: '2027-1', goalPerMember: 15, activeMembers: 3, progress: 45, goal: 45, achieved: true, members: [{ nickname: '가람', resting: false, activeWeek: true }, { nickname: '나래', resting: false, activeWeek: true }, { nickname: '다솜', resting: false, activeWeek: true }] },
  { name: '5팀', cohort: '2027-1', goalPerMember: 15, activeMembers: 3, progress: 21, goal: 45, achieved: false, members: [{ nickname: '라온', resting: false, activeWeek: true }, { nickname: '마루', resting: true, activeWeek: false }, { nickname: '바람', resting: false, activeWeek: false }, { nickname: '사슴', resting: false, activeWeek: true }] }] };
const TEAM = { name: '3팀', goalPerMember: 15, mates: [{ nickname: '바다', count: 15 }, { nickname: '소나무', count: 4 }, { nickname: '구름', count: 0, resting: true }], achievedOthers: ['2팀'] };
const DATA = { practice: PRACTICE, diag: DIAG, codes: ['TEST23', 'TEST45'], reviewedHints: {}, team: TEAM,
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
    await ctx.addInitScript(([d, pre]) => {
      window.__MOCK_DATA = d;
      if (pre && !localStorage.getItem('mock_db')) localStorage.setItem('mock_db', JSON.stringify(pre));
    }, [opts.mock, opts.preDb || null]);
    await ctx.route('**/vendor/supabase.js', r => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  }
  if (!opts.realHttp) await ctx.route(/supabase\.co/, r => r.abort());   // 진짜 서버로 나가면 끊음
  const page = await ctx.newPage();
  page._errors = []; page._requests = []; page._warn = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') page._warn.push(m.text()); });
  page.on('request', r => page._requests.push(r.url()));
  return { ctx, page };
}
const settled = '.screen:not([data-screen=loading])';
async function screenOf(page, root = '#app') { return page.getAttribute(root + ' .screen', 'data-screen'); }
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
async function logOf(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]')); }
async function clearLog(page) { await page.evaluate(() => localStorage.removeItem('mock_log')); }
const rpcs = l => l.filter(x => x.t === 'rpc');
async function solveRight(page, local) {
  const id = await page.getAttribute('#qid', 'data-id');
  const ans = local ? await page.evaluate(id => window.LU_PRACTICE.questions.find(q => q.id === id).answer_index, id) : PRACTICE.find(q => q.id === id).answer_index;
  await page.click(`.choice[data-orig="${ans}"]`); await page.click('[data-act=submit]');
  await page.waitForSelector('#verdict');
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
const PRE_DB = { students: { TEST23: { code: 'TEST23', nickname: '하늘별', xp: 0, diag_done: true } }, devices: {}, tries: {}, attempts: [], diag: {} };

(async () => {
  console.log('■ 규칙 계산 (logic.js — 서버 lu_team_week 와 같은 규칙)');
  await test('N-01', '팀 참여 목표: 진행 = Σ min(문항 수, 1인 목표), 쉼 제외, 활동 0명이면 미달성', async () => {
    const a = LU.teamWeek([{ count: 20 }, { count: 15 }, { count: 5 }], 15);
    ok(a.progress === 35 && a.goal === 45 && !a.achieved && a.activeMembers === 3, JSON.stringify(a));
    const b = LU.teamWeek([{ count: 15 }, { count: 30 }, { count: 0, resting: true }], 15);
    ok(b.progress === 30 && b.goal === 30 && b.achieved, JSON.stringify(b));
    const c = LU.teamWeek([{ count: 99, resting: true }], 15);
    ok(c.goal === 0 && !c.achieved, JSON.stringify(c));
    const d = LU.teamWeek([{ count: 45 }, { count: 0 }, { count: 0 }], 15);
    ok(d.progress === 15 && !d.achieved, '한 명이 혼자 다 채움 ' + JSON.stringify(d));
    ok(LU.C.TEAM_GOAL_PER_MEMBER === 15, '기본 1인 목표');
  });
  await test('N-02', '이번 주 문항 수: 월~일 · 경험치 받은 기록만(XP 0 다시 풀기 제외)', async () => {
    const at = [{ day: '2026-11-02', xp: 10 }, { day: '2026-11-08', xp: 15 }, { day: '2026-11-01', xp: 10 }, { day: '2026-11-03', xp: 0 }, { day: '2026-11-09', xp: 10 }];
    ok(LU.weekCount(at, '2026-11-04') === 2, String(LU.weekCount(at, '2026-11-04')));
    ok(LU.weekCount(at, '2026-11-08') === 2 && LU.weekCount(at, '2026-11-09') === 1, '주 경계');
  });

  const server = await startServer(PUBLIC, PORT);
  browser = await chromium.launch();
  let server2 = null;
  try {
    console.log('■ 로컬 모드 — 학생 홈 팀 카드 (가짜 팀원 바다·소나무)');
    const L = await newPage();
    const lp = L.page;
    await test('N-03', '홈 팀 카드: 7팀 · 별명 가나다순(나 표시) · 이번 주 30 / 45 · 도전 중 · 달성 팀 목록 · 가짜 팀원 표시', async () => {
      await lp.goto(BASE + 'index.html'); await lp.waitForSelector('#app ' + settled);
      await lp.fill('#code', 'TEST23'); await lp.click('[data-act=login]');
      await lp.waitForSelector('[data-screen=nickname]'); await lp.fill('#nick', '하늘별'); await lp.click('[data-act=save-nick]');
      await lp.waitForSelector('[data-screen=diag]');
      for (let i = 0; i < 12; i++) {
        const id = await lp.getAttribute('#qid', 'data-id');
        await lp.click('[data-act=diag-unknown]');
        if (i < 11) await lp.waitForFunction(p => document.querySelector('#qid') && document.querySelector('#qid').dataset.id !== p, id);
      }
      await lp.waitForSelector('[data-screen=diagResult]'); await lp.click('[data-act=home]');
      await lp.waitForSelector('#team-card');
      ok(await lp.getAttribute('#team-card', 'data-state') === 'trying', '상태');
      ok((await lp.textContent('#team-name')).trim() === '7팀', '팀 이름');
      const mates = (await lp.textContent('#team-mates')).replace(/\s+/g, ' ').trim();
      ok(mates === '바다 · 소나무 · 하늘별 (나)', mates);
      ok((await lp.textContent('#team-progress')).trim() === '30 / 45', await lp.textContent('#team-progress'));
      ok((await lp.textContent('#team-mine')).trim() === '0', '내 문항 수');
      ok((await lp.textContent('#team-achieved')).includes('2팀 · 5팀'), '달성 팀');
      ok((await lp.textContent('#team-card')).includes('가짜 팀원(개발용)'), '가짜 표시');
      await shot(lp, '390_20_홈_팀카드');
    });
    await test('N-04', '팀원 개인 숫자 비공개: 팀 카드에 XP·개인 문항 수 없음, 창구가 돌려주는 팀원 칸은 별명·나·쉼 3개뿐', async () => {
      const card = await lp.textContent('#team-card');
      ok(!/XP/.test(card), 'XP 글자: ' + card);
      ok(!card.includes('15 /') && !/바다[^·]*\d/.test(card), '팀원 숫자');
      const t = await lp.evaluate(() => window.STORE.myTeam());
      ok(t.members.every(m => Object.keys(m).sort().join() === 'me,nickname,resting'), JSON.stringify(t.members));
      ok(!JSON.stringify(t).includes('"count"') && !JSON.stringify(t).includes('"xp"'), JSON.stringify(t));
    });
    await test('N-05', '문제 1개를 끝까지 풀면 팀 진행 31 / 45, 내 이번 주 1문항', async () => {
      await lp.click('[data-act=start]'); await lp.waitForSelector('[data-screen=item] .choice');
      await solveRight(lp, true);
      await lp.reload(); await lp.waitForSelector('#team-card');
      ok((await lp.textContent('#team-progress')).trim() === '31 / 45', await lp.textContent('#team-progress'));
      ok((await lp.textContent('#team-mine')).trim() === '1', '내 수');
    });
    await test('N-06', '팀 활동 쉬기: 확인 안내 → [네, 쉴게요] → "팀 활동 쉼" + 목표에서 빠짐(30/30) → [다시 하기] → 31/45', async () => {
      await lp.click('[data-act=team-off]'); await lp.waitForSelector('#team-confirm');
      ok((await lp.textContent('#team-confirm')).includes('개인 학습과 경험치는 그대로'), '안내');
      await lp.click('[data-act=team-off-no]'); ok(!(await lp.$('#team-confirm')), '취소');
      await lp.click('[data-act=team-off]'); await lp.click('[data-act=team-off-yes]');
      await lp.waitForSelector('#team-card[data-state=off]');
      ok((await lp.textContent('#team-mates')).includes('하늘별 (나) · 팀 활동 쉼'), await lp.textContent('#team-mates'));
      ok((await lp.textContent('#team-progress')).trim() === '30 / 30', await lp.textContent('#team-progress'));
      await shot(lp, '390_21_홈_팀활동쉼');
      await lp.reload(); await lp.waitForSelector('#team-card[data-state=off]');   // 새로고침해도 유지
      await lp.click('[data-act=team-on]'); await lp.waitForSelector('#team-card[data-state=trying]');
      ok((await lp.textContent('#team-progress')).trim() === '31 / 45', '다시 켬');
    });
    await test('N-07', '내가 이번 주 15문항을 채우면 "이번 주 팀 참여 목표 달성" + 달성 팀 목록에 7팀', async () => {
      await lp.evaluate(() => {
        const db = JSON.parse(localStorage.getItem('lu2_local_db_v1')); const day = window.STORE._debug().today;
        for (let i = 0; i < 14; i++) db.attempts.push({ code: 'TEST23', qid: 'FAKE-' + i, mode: 'PRACTICE', outcome: '혼자 맞힘', level: 0, submits: [0], xp: 10, day, at: Date.now() });
        localStorage.setItem('lu2_local_db_v1', JSON.stringify(db));
      });
      await lp.reload(); await lp.waitForSelector('#team-card[data-state=achieved]');
      ok((await lp.textContent('#team-status')).includes('이번 주 팀 참여 목표 달성'), await lp.textContent('#team-status'));
      ok((await lp.textContent('#team-achieved')).includes('2팀 · 5팀 · 7팀'), await lp.textContent('#team-achieved'));
      ok((await lp.textContent('#team-progress')).trim() === '45 / 45', '진행');
      await shot(lp, '390_22_홈_팀목표달성');
      ok(!lp._errors.length, lp._errors.join('|'));
    });
    await L.ctx.close();

    console.log('■ 로컬 모드 — 교수 화면 (가짜 교수 prof@example.com · 가짜 학생 50명)');
    const AL = await newPage({ viewport: { width: 1024, height: 900 } });
    const ap = AL.page;
    await test('N-08', '교수 화면 로컬: 로컬 띠, 등록 안 된 이메일 거절, 가짜 교수 이메일로 바로 들어감', async () => {
      await ap.goto(BASE + 'admin.html'); await ap.waitForSelector('#admin ' + settled);
      ok(await screenOf(ap, '#admin') === 'login', await screenOf(ap, '#admin'));
      ok(!(await ap.$eval('#devbar', e => e.hidden)), '로컬 띠');
      await ap.fill('#email', '이메일아님'); await ap.click('[data-act=send]');
      ok((await ap.textContent('#err')).includes('이메일 주소 모양'), '모양');
      await ap.fill('#email', 'nobody@example.com'); await ap.click('[data-act=send]');
      await ap.waitForFunction(() => document.querySelector('#err') && document.querySelector('#err').textContent.includes('등록되지 않은'));
      await ap.fill('#email', 'PROF@example.com'); await ap.click('[data-act=send]');
      await ap.waitForSelector('[data-screen=dash]');
    });
    await test('N-09', '대시보드: 숫자 4칸 · 많이 틀린 문항 10개(오답률 높은 순) · 강별 정답률 · 팀 13개 · 가짜 표시 · 학생 코드 없음', async () => {
      ok(await ap.$('#fake-note'), '가짜 표시');
      ok(await ap.$$eval('#totals li', e => e.length) === 4, '숫자 칸');
      const rates = await ap.$$eval('#top-items tbody tr .rate', e => e.map(x => parseInt(x.textContent, 10)));
      ok(rates.length === 10, '문항 수 ' + rates.length);
      ok(rates.every((r, i) => i === 0 || rates[i - 1] >= r), '정렬 ' + rates.join(','));
      ok(await ap.$$eval('#lectures .lec-row', e => e.length) >= 1, '강별');
      ok(await ap.$$eval('#team-list [data-team]', e => e.length) === 13, '팀 수');
      const txt = await ap.textContent('#admin');
      ok(!/TEST23|TEST45|PLAY89/.test(txt), '코드가 보임');
      ok(!ap._requests.some(u => u.includes('vendor/') || u.includes('dev_diag_key')), '로컬 모드가 vendor/진단 정답 파일을 읽음');
      await shot(ap, '1024_30_교수화면_로컬');
    });
    await test('N-10', '지난주로 바꾸면 주 시작일이 7일 앞, 로그아웃하면 로그인 화면', async () => {
      const before = (await ap.textContent('#team-summary')).slice(0, 10);
      await ap.selectOption('#week', '1'); await ap.waitForFunction(b => !document.querySelector('#team-summary').textContent.startsWith(b), before);
      const after = (await ap.textContent('#team-summary')).slice(0, 10);
      ok(new Date(before) - new Date(after) === 7 * 86400000, before + ' → ' + after);
      ok((await ap.textContent('#admin')).includes('팀별 지난주 참여 목표'), '제목');
      await ap.click('[data-act=logout]'); await ap.waitForSelector('[data-screen=login]');
      ok(!ap._errors.length, ap._errors.join('|'));
    });
    await AL.ctx.close();
    const AM = await newPage();   // 휴대폰 너비에서도 깨지지 않는지
    await test('N-11', '교수 화면 390px 너비: 가로 넘침 없음', async () => {
      await AM.page.goto(BASE + 'admin.html'); await AM.page.waitForSelector('#admin ' + settled);
      await AM.page.fill('#email', 'prof@example.com'); await AM.page.click('[data-act=send]'); await AM.page.waitForSelector('[data-screen=dash]');
      const over = await AM.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 1, '가로 넘침 ' + over + 'px');
      await shot(AM.page, '390_31_교수화면_로컬');
    });
    await AM.ctx.close();

    console.log('■ Supabase 모드(가짜 서버) — 학생 팀 카드 (my_team_summary · set_team_off)');
    const S = await newPage({ mock: DATA, preDb: PRE_DB });
    const sp = S.page;
    await test('N-12', '홈: my_team_summary() 1번 → 3팀 · 구름(쉼)·바다·소나무·하늘별(나) · 19 / 45(쉼 제외 3명)', async () => {
      await sp.goto(BASE + 'index.html?mode=supabase'); await sp.waitForSelector('#app ' + settled);
      await sp.fill('#code', 'TEST23'); await sp.click('[data-act=login]');
      await sp.waitForSelector('#team-card');
      const r = rpcs(await logOf(sp)).filter(x => x.name === 'my_team_summary');
      ok(r.length === 1 && JSON.stringify(r[0].args) === '{}', JSON.stringify(r));
      const mates = (await sp.textContent('#team-mates')).replace(/\s+/g, ' ').trim();
      ok(mates === '구름 · 팀 활동 쉼 · 바다 · 소나무 · 하늘별 (나)', mates);
      ok((await sp.textContent('#team-progress')).trim() === '19 / 45', await sp.textContent('#team-progress'));
      ok((await sp.textContent('#team-achieved')).includes('2팀'), '달성 팀');
      ok(!(await sp.textContent('#team-card')).includes('가짜 팀원'), 'Supabase 모드에 가짜 표시');
    });
    await test('N-13', '문제 1개 끝까지 → 새로고침 → 서버 값 20 / 45, 내 1문항', async () => {
      await sp.click('[data-act=start]'); await sp.waitForSelector('[data-screen=item] .choice');
      await solveRight(sp, false);
      await sp.reload(); await sp.waitForSelector('#team-card');
      ok((await sp.textContent('#team-progress')).trim() === '20 / 45', await sp.textContent('#team-progress'));
      ok((await sp.textContent('#team-mine')).trim() === '1', '내 수');
    });
    await test('N-14', '팀 활동 쉬기 → set_team_off({p_off:true}) → 다시 하기 → set_team_off({p_off:false})', async () => {
      await clearLog(sp);
      await sp.click('[data-act=team-off]'); await sp.click('[data-act=team-off-yes]'); await sp.waitForSelector('#team-card[data-state=off]');
      await sp.click('[data-act=team-on]'); await sp.waitForSelector('#team-card[data-state=trying]');
      const r = rpcs(await logOf(sp)).filter(x => x.name === 'set_team_off').map(x => JSON.stringify(x.args));
      ok(r.join('|') === '{"p_off":true}|{"p_off":false}', r.join('|'));
    });
    await test('N-15', '서버에 팀 함수가 아직 없어도(적용 전) 홈은 그대로 열림: 팀 카드만 숨김, 오류 띠 없음', async () => {
      await sp.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ my_team_summary: 'Could not find the function public.my_team_summary without parameters in the schema cache' })));
      await sp.reload(); await sp.waitForSelector('[data-screen=home]');
      ok(!(await sp.$('#team-card')), '팀 카드');
      ok(!(await sp.$('#err')), '오류 띠');
      ok(sp._warn.some(w => w.includes('팀 정보를 불러오지 못했어요')), '콘솔 경고');
      await sp.evaluate(() => localStorage.removeItem('mock_fail'));
      ok(!sp._errors.length, sp._errors.join('|'));
      ok(!sp._requests.some(u => /supabase\.co/.test(u) && !u.includes('vendor')), '진짜 서버 요청');
    });
    await S.ctx.close();
    const S2 = await newPage({ mock: Object.assign({}, DATA, { team: null }), preDb: PRE_DB });
    await test('N-16', '아직 팀이 없는 학생: "2주차부터 교수님이 정해 드려요" + [팀 활동 안 하기]', async () => {
      await S2.page.goto(BASE + 'index.html?mode=supabase'); await S2.page.waitForSelector('#app ' + settled);
      await S2.page.fill('#code', 'TEST23'); await S2.page.click('[data-act=login]');
      await S2.page.waitForSelector('#team-card[data-state=none]');
      ok((await S2.page.textContent('#team-status')).includes('2주차부터'), await S2.page.textContent('#team-status'));
      await S2.page.click('[data-act=team-off]'); await S2.page.click('[data-act=team-off-yes]');
      await S2.page.waitForFunction(() => document.querySelector('#team-status').textContent.includes('하지 않기로'));
      ok(await S2.page.$('[data-act=team-on]'), '다시 하기 버튼');
    });
    await S2.ctx.close();

    console.log('■ Supabase 모드(가짜 서버) — 교수 화면 (이메일 매직링크 · admin_whoami · admin_item_stats · admin_team_week)');
    const P = await newPage({ mock: DATA, viewport: { width: 1024, height: 900 } });
    const pp = P.page;
    const ADMIN_URL = BASE + 'admin.html?mode=supabase';
    await test('N-17', '첫 화면: 교수용 로그인 칸(lu2_sb_admin)·주소 속 로그인 읽기 켬, 서버 함수·익명 로그인 0, 로컬 띠 없음, data/ 안 읽음', async () => {
      await pp.goto(ADMIN_URL); await pp.waitForSelector('#admin ' + settled);
      ok(await screenOf(pp, '#admin') === 'login', '화면');
      const l = await logOf(pp); const c = l.find(x => x.t === 'createClient');
      ok(c && c.storageKey === 'lu2_sb_admin' && c.detectSessionInUrl === true && c.key === KEY_, JSON.stringify(c));
      ok(!rpcs(l).length && !l.some(x => x.t === 'signInAnonymously'), JSON.stringify(l));
      ok(await pp.$eval('#devbar', e => e.hidden), '로컬 띠');
      ok(!(await pp.textContent('#admin')).includes('[개발용]'), '개발용 안내');
      ok(!pp._requests.some(u => u.includes('/data/')), 'data/ 요청');
    });
    await test('N-18', '등록 안 된 이메일: signInWithOtp(새 계정 만들지 않음, 돌아올 주소 = 이 화면) → "등록되지 않은 이메일"', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'nobody@example.com'); await pp.click('[data-act=send]');
      await pp.waitForSelector('#err');
      ok((await pp.textContent('#err')).includes('등록되지 않은'), await pp.textContent('#err'));
      const o = (await logOf(pp)).find(x => x.t === 'signInWithOtp');
      ok(o && o.email === 'nobody@example.com' && o.options.shouldCreateUser === false && o.options.emailRedirectTo === ADMIN_URL, JSON.stringify(o));
    });
    await test('N-19', '교수 이메일 → "메일을 보냈어요" → 틀린 숫자 거절 → 123456 → 대시보드 (서버 함수 3개, 인자 확인)', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'prof@example.com'); await pp.click('[data-act=send]');
      await pp.waitForSelector('#sent');
      await pp.fill('#otp', '000000'); await pp.click('[data-act=verify]');
      await pp.waitForFunction(() => document.querySelector('#err') && document.querySelector('#err').textContent.includes('시간이 지났어요'));
      await pp.fill('#otp', '123456'); await pp.click('[data-act=verify]');
      await pp.waitForSelector('[data-screen=dash]');
      const r = rpcs(await logOf(pp));
      const w = r.find(x => x.name === 'admin_whoami'), it = r.find(x => x.name === 'admin_item_stats'), tw = r.find(x => x.name === 'admin_team_week');
      ok(w && it && tw, r.map(x => x.name).join());
      ok(JSON.stringify(it.args) === '{"p_cohort":"2027-1","p_min_n":3,"p_limit":10}', JSON.stringify(it.args));
      ok(tw.args.p_cohort === '2027-1' && /^\d{4}-\d{2}-\d{2}$/.test(tw.args.p_week) && new Date(tw.args.p_week + 'T00:00:00Z').getUTCDay() === 1, JSON.stringify(tw.args));
      ok(await pp.$$eval('#top-items tbody tr', e => e.length) === 3, '문항 줄');
      ok((await pp.textContent('#top-items')).includes('75%') && (await pp.textContent('#top-items')).includes('진단'), '오답률·종류');
      ok(await pp.$$eval('#team-list [data-team]', e => e.length) === 2 && await pp.$eval('[data-team="2팀"]', e => e.dataset.achieved) === '1', '팀');
      ok((await pp.textContent('[data-team="5팀"]')).includes('마루 (쉼)'), '쉼 표시');
      ok((await pp.textContent('#who')).includes('prof@example.com'), '로그인 표시');
      ok(!(await pp.$('#fake-note')), 'Supabase 모드에 가짜 표시');
      await shot(pp, '1024_32_교수화면_가짜서버');
    });
    await test('N-20', '기수·주 바꾸기 → admin_item_stats(p_cohort 2026-9) · admin_team_week(p_week 7일 앞)', async () => {
      const w0 = rpcs(await logOf(pp)).find(x => x.name === 'admin_team_week').args.p_week;
      await clearLog(pp);
      await pp.selectOption('#cohort', '2026-9'); await pp.waitForFunction(() => document.querySelector('[data-screen=dash]') && !document.querySelector('#cohort').disabled);
      await pp.selectOption('#week', '1'); await pp.waitForFunction(() => document.querySelector('#admin').textContent.includes('팀별 지난주'));
      const r = rpcs(await logOf(pp));
      ok(r.some(x => x.name === 'admin_item_stats' && x.args.p_cohort === '2026-9'), '기수');
      const last = r.filter(x => x.name === 'admin_team_week').slice(-1)[0];
      ok(last.args.p_cohort === '2026-9' && new Date(w0) - new Date(last.args.p_week) === 7 * 86400000, JSON.stringify(last.args) + ' / ' + w0);
    });
    await test('N-21', '새로고침: 저장된 교수 로그인 재사용(메일 다시 안 보냄) · 같은 브라우저의 학생 화면은 학생 로그인과 섞이지 않음', async () => {
      await clearLog(pp);
      await pp.reload(); await pp.waitForSelector('[data-screen=dash]');
      ok(!(await logOf(pp)).some(x => x.t === 'signInWithOtp' || x.t === 'verifyOtp'), '메일 다시 보냄');
      const st = await P.ctx.newPage();
      await st.goto(BASE + 'index.html?mode=supabase'); await st.waitForSelector('#app ' + settled);
      ok(await screenOf(st) === 'login', '학생 화면이 교수 로그인으로 열림: ' + await screenOf(st));
      await st.close();
    });
    await test('N-22', '로그아웃 → signOut(이 기기만) → 로그인 화면', async () => {
      await clearLog(pp);
      await pp.click('[data-act=logout]'); await pp.waitForSelector('[data-screen=login]');
      const so = (await logOf(pp)).find(x => x.t === 'signOut'); ok(so && so.scope === 'local', JSON.stringify(so));
      ok(!pp._errors.length, pp._errors.join('|'));
    });
    await test('N-23', '등록은 됐지만 교수가 아닌 이메일: admin_whoami=false → "교수 계정이 아니에요", 통계 함수는 부르지 않음', async () => {
      await clearLog(pp);
      await pp.fill('#email', 'other@example.com'); await pp.click('[data-act=send]'); await pp.waitForSelector('#sent');
      await pp.fill('#otp', '123456'); await pp.click('[data-act=verify]');
      await pp.waitForSelector('[data-screen=notAdmin]');
      ok((await pp.textContent('#not-admin')).includes('other@example.com'), '안내');
      ok(!rpcs(await logOf(pp)).some(x => x.name === 'admin_item_stats' || x.name === 'admin_team_week'), '통계 요청');
      await pp.click('[data-act=logout]'); await pp.waitForSelector('[data-screen=login]');
    });
    await test('N-24', '메일 링크가 만료돼 돌아오면(#error_code=otp_expired) 쉬운 안내 + 주소의 # 부분 지움', async () => {
      await pp.goto('about:blank');   // 메일에서 링크를 누르면 새로 열리므로, 같은 주소의 # 만 바꾸는 이동(새로고침 없음)을 피함
      await pp.goto(ADMIN_URL + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
      await pp.waitForSelector('#err');
      ok((await pp.textContent('#err')).includes('시간이 지났어요'), await pp.textContent('#err'));
      ok(!(await pp.evaluate(() => location.hash)), '주소 # 남음');
    });
    await test('N-25', '서버에 교수 함수가 아직 없으면(적용 전) "아직 설치되지 않았어요" + [다시 시도]', async () => {
      await pp.fill('#email', 'prof@example.com'); await pp.click('[data-act=send]'); await pp.waitForSelector('#sent');
      await pp.fill('#otp', '123456');
      await pp.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ admin_whoami: 'Could not find the function public.admin_whoami without parameters in the schema cache' })));
      await pp.click('[data-act=verify]');
      await pp.waitForFunction(() => document.querySelector('#err') && document.querySelector('#err').textContent.includes('아직 설치되지 않았어요'));
      await pp.reload(); await pp.waitForSelector('[data-screen=error]');
      await pp.evaluate(() => localStorage.removeItem('mock_fail'));
      await pp.click('[data-act=retry]'); await pp.waitForSelector('[data-screen=dash]');
    });
    await test('N-26', '서버가 NOT_ADMIN 을 돌려주면(권한이 중간에 빠짐) 쉬운 안내', async () => {
      await pp.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ admin_item_stats: 'NOT_ADMIN' })));
      await pp.click('[data-act=refresh]');
      await pp.waitForFunction(() => document.querySelector('#err') && document.querySelector('#err').textContent.includes('교수 계정이 아니라서'));
      await pp.evaluate(() => localStorage.removeItem('mock_fail'));
      ok(!pp._errors.length, pp._errors.join('|'));
      ok(!pp._requests.some(u => /supabase\.co/.test(u)), '진짜 서버 요청');
    });
    await P.ctx.close();

    console.log('■ 진짜 라이브러리(vendor) + 가짜 HTTP 응답 — 매직링크 요청이 실제로 어떤 모양인지');
    await test('N-27', '진짜 supabase-js: POST /auth/v1/otp(create_user=false, redirect_to=교수 화면) → /auth/v1/verify → rpc admin_* 에 교수 토큰, 학생 로그인 칸은 비어 있음', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } });
      const seen = [];
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const uid = '00000000-0000-4000-8000-0000000000aa';
      const jwt = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'prof@example.com', is_anonymous: false, session_id: 'fake' }) + '.fakesig';
      const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'prof@example.com', is_anonymous: false, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
      await ctx.route(/supabase\.co/, async r => {
        const req = r.request(), u = new URL(req.url());
        seen.push({ method: req.method(), path: u.pathname, search: u.search, body: req.postData(), apikey: req.headers()['apikey'], auth: req.headers()['authorization'] });
        const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
        if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        if (u.pathname === '/auth/v1/otp') return json({});
        if (u.pathname === '/auth/v1/verify') return json({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'fake-refresh', user });
        if (u.pathname === '/auth/v1/user') return json(user);
        if (u.pathname === '/rest/v1/rpc/admin_whoami') return json({ admin: true, email: 'prof@example.com', today: '2026-11-02', weekStart: '2026-11-02', cohorts: ['2027-1'] });
        if (u.pathname === '/rest/v1/rpc/admin_item_stats') return json(STATS);
        if (u.pathname === '/rest/v1/rpc/admin_team_week') return json(Object.assign({ weekStart: '2026-11-02' }, TEAMS));
        return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not in test"}' });
      });
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(ADMIN_URL); await p.waitForSelector('#admin ' + settled);
      ok(!seen.length, '열기만 했는데 요청 ' + JSON.stringify(seen));
      await p.fill('#email', 'prof@example.com'); await p.click('[data-act=send]'); await p.waitForSelector('#sent');
      const otp = seen.find(x => x.path === '/auth/v1/otp');
      ok(otp && otp.method === 'POST' && otp.apikey === KEY_, JSON.stringify(otp));
      const ob = JSON.parse(otp.body);
      ok(ob.email === 'prof@example.com' && ob.create_user === false, otp.body);
      ok(new URLSearchParams(otp.search).get('redirect_to') === ADMIN_URL, otp.search);
      await p.fill('#otp', '123456'); await p.click('[data-act=verify]'); await p.waitForSelector('[data-screen=dash]');
      const ver = seen.find(x => x.path === '/auth/v1/verify'); const vb = JSON.parse(ver.body);
      ok(vb.email === 'prof@example.com' && vb.token === '123456' && vb.type === 'email', ver.body);
      // [M2 3차] 교수 화면이 ④·⑤(admin_tutor_usage·admin_weekly_stats)도 부름 → 처음 3개가 있고 모두 같은 교수 토큰인지
      const calls = seen.filter(x => x.path.startsWith('/rest/v1/rpc/admin_'));
      ok(['admin_whoami', 'admin_item_stats', 'admin_team_week'].every(n => calls.some(x => x.path.endsWith(n))) && calls.every(x => x.auth === 'Bearer ' + jwt), calls.map(x => x.path + ' ' + (x.auth || '').slice(0, 20)).join(' | '));
      ok(JSON.parse(calls.find(x => x.path.endsWith('admin_item_stats')).body).p_limit === 10, '인자');
      const keys = await p.evaluate(() => Object.keys(localStorage));
      ok(keys.includes('lu2_sb_admin') && !keys.includes('lu2_sb_auth'), keys.join());
      ok(!seen.some(x => x.path === '/auth/v1/signup'), '익명 계정을 만듦');
      ok(!errs.length, errs.join('|'));
      await ctx.close();
      return '요청 ' + seen.length + '건';
    });

    console.log('■ 배포용 폴더 (tools/make_deploy.py) — 교수 화면 포함');
    await test('N-28', '배포용 폴더: admin.html·js/admin.js 포함, 가짜 교수 이메일 지움, noindex, data/ 없음, ?mode 없이 Supabase 모드 교수 로그인 화면', async () => {
      const out = execFileSync('python3', [path.join(APP, 'tools/make_deploy.py'), DEPLOY_DIR], { encoding: 'utf8' });
      ok(fs.existsSync(path.join(DEPLOY_DIR, 'admin.html')) && fs.existsSync(path.join(DEPLOY_DIR, 'js/admin.js')), '교수 화면 파일');
      ok(!fs.existsSync(path.join(DEPLOY_DIR, 'data')), 'data/');
      const cfg = fs.readFileSync(path.join(DEPLOY_DIR, 'js/config.js'), 'utf8');
      ok(cfg.includes('DEV_ADMIN_EMAILS: []') && !cfg.includes('prof@example.com') && cfg.includes('MODE: "supabase"'), '설정');
      ok(fs.readFileSync(path.join(DEPLOY_DIR, 'admin.html'), 'utf8').includes('noindex'), 'noindex');
      ok(fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8').includes('DEV_ADMIN_EMAILS: ["prof@example.com"]'), '원본 설정이 바뀜');
      server2 = await startServer(DEPLOY_DIR, PORT2);
      const v = await newPage({ mock: DATA });
      await v.page.goto(BASE2 + 'admin.html'); await v.page.waitForSelector('#admin ' + settled);
      ok(await screenOf(v.page, '#admin') === 'login' && await v.page.$eval('#devbar', e => e.hidden), '화면');
      ok(!(await v.page.textContent('#admin')).includes('[개발용]'), '개발용 안내');
      ok((await logOf(v.page)).some(x => x.t === 'createClient' && x.storageKey === 'lu2_sb_admin'), 'Supabase 모드');
      ok(!v.page._requests.some(u => u.includes('/data/')), 'data/ 요청');
      ok(!v.page._errors.length, v.page._errors.join('|'));
      await v.ctx.close();
      return out.trim().replace(DEPLOY_DIR, '(임시 폴더)');
    });

    console.log('■ 서버 SQL (30_m2_teams_admin.sql)');
    await test('N-29', 'schema.sql 은 next_practice(O/X 수정)만 바뀜 = 40_ox_fix.sql 과 본문 같음, 30번 파일은 next_practice·close_item 을 다시 만들지 않음, 새 함수는 모두 anon 에서 회수', async () => {
      const fnOf = t => { const i = t.indexOf('create or replace function next_practice'); return i < 0 ? '' : t.slice(i, t.indexOf('end $$;', i) + 7); };
      const cut = t => { const f = fnOf(t); return t.replace(f, '').replace(/^-- F3 [\s\S]*?(?=\n\n)/m, ''); };
      const now = fs.readFileSync(path.join(APP, 'supabase/schema.sql'), 'utf8');
      const r = spawnSync('git', ['show', 'HEAD:./supabase/schema.sql'], { cwd: APP, encoding: 'utf8' });
      if (r.status === 0) ok(cut(r.stdout).replace(/^--.*\n/gm, '') === cut(now).replace(/^--.*\n/gm, ''), 'schema.sql 에서 next_practice 밖이 바뀜');
      const fix = fs.readFileSync(path.join(APP, 'supabase/40_ox_fix.sql'), 'utf8');
      ok(fnOf(now) && fnOf(fix) === fnOf(now), '40_ox_fix.sql 의 next_practice 가 schema.sql 과 다름');
      ok([...fix.matchAll(/create or replace function\s+(\w+)/gi)].length === 1, '40번 파일에 다른 함수');
      ok(/revoke execute on function next_practice\(jsonb, text\[\]\) from public, anon;/.test(fix) && /grant execute on function next_practice\(jsonb, text\[\]\) to authenticated;/.test(fix), '40번 권한');
      ok(fnOf(now).includes('lu_p(me.theta, q.b, 0.25)') && /v_ox_used < 2/.test(fnOf(now)), 'O/X 수정 내용');
      const sql = fs.readFileSync(path.join(APP, 'supabase/30_m2_teams_admin.sql'), 'utf8');
      ok(!/function\s+(next_practice|close_item|claim_code|today_summary|diag_finish)\s*\(/i.test(sql), 'M1 함수 재정의');
      const fns = [...sql.matchAll(/create or replace function\s+(\w+)\s*\(/gi)].map(m => m[1]);
      const revokeAnon = (sql.match(/revoke execute on function([\s\S]*?)from public, anon;/i) || [])[1] || '';
      const missing = fns.filter(f => !new RegExp('\\b' + f + '\\(').test(revokeAnon));
      ok(fns.length === 11 && !missing.length, '회수 빠짐: ' + missing.join(','));
      ok(/alter table teams enable row level security/i.test(sql) && /revoke all on teams from public, anon, authenticated/i.test(sql), 'teams RLS·권한');
      return '새 함수 ' + fns.length + '개';
    });
    await test('N-30', '임시 PostgreSQL 시험(있으면): supabase/local_test/run_m2_local.sh 실패 0', async () => {
      if (!fs.existsSync('/usr/lib/postgresql/16/bin/initdb') && !process.env.PG_BIN) return '건너뜀 — 이 컴퓨터에 PostgreSQL 16 없음';
      const r = spawnSync('bash', [path.join(APP, 'supabase/local_test/run_m2_local.sh')], { encoding: 'utf8', timeout: 120000 });
      const last = (r.stdout || '').trim().split('\n').slice(-1)[0];
      ok(r.status === 0, last + ' / ' + (r.stdout || '').split('\n').filter(x => x.startsWith('FAIL')).join(' | ') + (r.stderr || '').slice(0, 300));
      return last;
    });
  } finally {
    await browser.close(); server.kill(); if (server2) server2.kill();
    fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_m2_results.json'), JSON.stringify(results, null, 1));
  console.log(`\nM2 1차(팀·교수 화면) 테스트: 통과 ${pass} · 실패 ${fail}  ※ 실DB 미검증`);
  process.exit(fail ? 1 : 0);
})();
