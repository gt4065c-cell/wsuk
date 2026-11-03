// 2단계 M2 3차 자동 테스트 — 주간 공통 점검 · 팀 해설 당번 · 교수 화면 ④ AI 튜터 사용량 ⑤ 공통 점검 정답률 (Playwright)
// 실행: node 04_제품개발팀/app2/tests/run_e2e_m2_3.js
// - 로컬 모드(흉내) + Supabase 모드(가짜 서버 tests/mock_supabase.js) + 배포 폴더 + SQL 파일 검사
// - 진짜 Supabase 에는 한 번도 접속하지 않습니다(실DB 미검증). 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)만 씁니다.
// - 이 컴퓨터에 PostgreSQL 16 이 있으면 supabase/local_test/run_weekly_local.sh 로 새 SQL 도 시험합니다.
// - 결과: tests/e2e_m2_3_results.json, 스크린샷 screenshots/ (가짜 학생·가짜 이메일(example.com)만 사용)
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
const BANK = path.resolve(APP, '../../03_교육기획팀/문항은행');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const PRACTICE = load('practice.js', 'LU_PRACTICE');
const DIAGQ = load('diagnostic.js', 'LU_DIAG');
const DKEY = load('dev_diag_key.js', 'LU_DEV_DIAG_KEY');
const DIAG = DIAGQ.map(q => Object.assign({}, q, DKEY[q.id]));
const PORT = 10300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
const PORT2 = PORT + 1;
const BASE2 = `http://127.0.0.1:${PORT2}/`;
const DEPLOY_DIR = path.join(os.tmpdir(), 'lu2_deploy_m23_' + process.pid);
fs.mkdirSync(SHOTS, { recursive: true });

// 가짜 서버 데이터 (가짜 학생·가짜 이메일만). 공통 점검 문항은 연습 문항 글을 빌린 가짜(정답 포함 — 가짜 서버만 앎)
const MCQ = PRACTICE.filter(q => q.type === 'mcq');
const WITEMS = MCQ.slice(10, 18).map((q, i) => ({ id: 'W3-Q' + (i + 1), lecture: q.lecture, type: 'mcq', question: '[가짜 점검] ' + q.question, choices: q.choices, answer_index: q.answer_index }));
const TEAM = { name: '3팀', goalPerMember: 15, mates: [{ nickname: '바다', count: 15 }, { nickname: '소나무', count: 4 }, { nickname: '구름', count: 0 }], achievedOthers: [] };
const EXPL_ITEM = { qid: PRACTICE[2].id, lecture: PRACTICE[2].lecture, question: PRACTICE[2].question, sourceSection: PRACTICE[2].source_section || '' };
const ADMIN_TUTOR = { enabled: true, budgetUsd: 6.4, todayCalls: 12, todayOk: 10, monthCalls: 140, monthStudents: 21, monthBlocked: 2, monthCostUsd: 1.6, monthCostKrw: 2240 };
const ADMIN_WEEKLY = { cohortStart: '2027-03-01', currentWeek: 3, maxWeek: 8, minN: 3, takers: 24,
  items: WITEMS.map((q, i) => ({ qid: q.id, lecture: q.lecture, question: q.question, n: i === 7 ? 2 : 24, correctRate: i === 7 ? null : 0.5 + i * 0.05, unknown: i === 7 ? null : 1, answerText: q.choices[q.answer_index] })),
  teams: [{ name: '1팀', active: 4, taken: 3 }, { name: '3팀', active: 4, taken: 1 }] };
const DATA = { practice: PRACTICE, diag: DIAG, codes: ['TEST23', 'TEST45'], reviewedHints: {}, team: TEAM,
  weekly: { week: 3, reason: null, cohortStart: '2027-03-01', items: WITEMS, teamActive: 4, teamTaken: 1 },
  explainer: { duty: 'me', item: EXPL_ITEM, body: null },
  adminUsers: ['prof@example.com'], adminEmails: ['prof@example.com'], adminStats: { students: 50, linked: 48, diagDone: 45, activeWeek: 30, minN: 3, items: [], lectures: [] },
  adminTeams: { achievedCount: 0, unassigned: 0, resting: 0, teams: [] }, adminTutor: ADMIN_TUTOR, adminWeekly: ADMIN_WEEKLY };
const PRE_DB = { students: { TEST23: { code: 'TEST23', nickname: '하늘별', xp: 0, diag_done: true } }, devices: {}, tries: {}, attempts: [], diag: {} };

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
  await ctx.route(/supabase\.co/, r => r.abort());   // 진짜 서버로 나가면 끊음
  const page = await ctx.newPage();
  page._errors = []; page._requests = []; page._warn = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') page._warn.push(m.text()); });
  page.on('request', r => page._requests.push(r.url()));
  return { ctx, page };
}
const settled = '.screen:not([data-screen=loading])';
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
async function logOf(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]')); }
async function clearLog(page) { await page.evaluate(() => localStorage.removeItem('mock_log')); }
const rpcs = l => l.filter(x => x.t === 'rpc');
const txt = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
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
// 점검 8문항: 앞 4개는 정답, 5번째는 "아직 모르겠어요", 나머지는 오답 → 다시 볼 강 = 5~8번 문항의 강
async function takeWeekly(page, keyOf) {
  const lectures = new Set();
  for (let i = 0; i < 8; i++) {
    await page.waitForFunction(n => { const c = document.querySelector('#count'); return c && c.textContent.startsWith('공통 점검 ' + n + ' /'); }, i + 1);
    const id = await page.getAttribute('#qid', 'data-id'), k = await keyOf(id);
    if (i === 4) { lectures.add(k.lecture); await page.click('[data-act=weekly-unknown]'); continue; }
    const pick = i < 4 ? k.answer : (k.answer + 1) % k.n;
    if (i >= 4) lectures.add(k.lecture);
    await page.click(`.choice[data-orig="${pick}"]`);
    if (i === 1) {   // 이전 문항으로 갔다가 다시: 고른 답이 남아 있음
      await page.click('[data-act=weekly-next]'); await page.waitForFunction(() => document.querySelector('#count').textContent.startsWith('공통 점검 3 /'));
      await page.click('[data-act=weekly-prev]'); await page.waitForFunction(() => document.querySelector('#count').textContent.startsWith('공통 점검 2 /'));
      ok(await page.$(`.choice.selected[data-orig="${pick}"]`), '이전 문항에 고른 답이 남지 않음');
    }
    if (i === 7) { ok(await page.$('#weekly-last'), '마지막 문항 안내'); ok((await txt(page, '[data-act=weekly-next]')) === '제출하기', '제출 버튼'); await shot(page, '390_41_공통점검_마지막문항'); }
    await page.click('[data-act=weekly-next]');
  }
  await page.waitForSelector('[data-screen=weeklyDone]');
  return [...lectures].sort((a, b) => a - b);
}
const lecName = n => (n < 10 ? '0' : '') + n + '강';

(async () => {
  console.log('■ 규칙 (logic.js — 서버 60번 SQL 과 같은 규칙) · 문항 파일');
  await test('Q-01', '공통 점검 주 번호: 기수 시작 월요일 = 1주차, +7일 = 2주차, 시작 전·시작일 없음 = null', async () => {
    ok(LU.checkWeek('2027-03-01', '2027-03-01') === 1 && LU.checkWeek('2027-03-01', '2027-03-07') === 1, '1주차');
    ok(LU.checkWeek('2027-03-01', '2027-03-08') === 2 && LU.checkWeek('2027-03-01', '2027-04-25') === 8, '2·8주차');
    ok(LU.checkWeek('2027-03-01', '2027-02-28') === null && LU.checkWeek(null, '2027-03-01') === null, 'null');
  });
  await test('Q-02', '해설 글 검사(10~200자 · 이메일·전화번호 거절 · 앞뒤 빈칸 정리) · 다시 볼 강(틀림·모르겠어요, 겹침 없이 작은 순)', async () => {
    ok(LU.checkExplain('  짧아요  ') === 'TOO_SHORT' && LU.checkExplain('가'.repeat(201)) === 'TOO_LONG' && LU.checkExplain('가'.repeat(200)) === null, '길이');
    ok(LU.checkExplain('질문은 me@example.com 으로 주세요') === 'PRIVATE_INFO' && LU.checkExplain('연락은 010 1234 5678 로 주세요') === 'PRIVATE_INFO', '개인정보');
    ok(LU.cleanExplain('  가나\r\n다  ') === '가나\n다', '정리');
    const items = [{ id: 'a', lecture: 5 }, { id: 'b', lecture: 3 }, { id: 'c', lecture: 5 }, { id: 'd', lecture: 1 }];
    ok(JSON.stringify(LU.reviewLectures(items, { a: 0, b: 2, c: null, d: 1 }, () => 1)) === '[3,5]', JSON.stringify(LU.reviewLectures(items, { a: 0, b: 2, c: null, d: 1 }, () => 1)));
    ok(JSON.stringify(LU.reviewLectures(items, { a: 0, b: 2, c: null, d: 0 }, () => 1)) === '[1,3,5]', '정답 키 1, d 오답');
    ok(JSON.stringify(LU.reviewLectures(items, { a: 1, b: 1, c: 1, d: 1 }, () => 1)) === '[]', '모두 맞음');
  });
  await test('Q-03', '주간 문항 64개 = 8주 × 8, 번호 W{주}-Q{번호} 가 week 칸과 같음(60번 SQL 의 주 번호 채우기 규칙) · seed.json 에 64개 모두 평가(assessment) · 로컬 데이터 파일에 점검 문항 없음', async () => {
    const W = JSON.parse(fs.readFileSync(path.join(BANK, 'questions_weekly.json'), 'utf8'));
    ok(W.length === 64, '개수 ' + W.length);
    const bad = W.filter(q => { const m = /^W([0-9]+)-Q[0-9]+$/.exec(q.id); return !m || Number(m[1]) !== q.week || q.pool !== 'assessment'; });
    ok(!bad.length, '규칙과 다름: ' + bad.map(q => q.id).join(','));
    const per = {}; W.forEach(q => { per[q.week] = (per[q.week] || 0) + 1; });
    ok(Object.keys(per).length === 8 && Object.values(per).every(n => n === 8), JSON.stringify(per));
    const seed = JSON.parse(fs.readFileSync(path.join(APP, 'supabase/seed/seed.json'), 'utf8'));
    const ws = seed.questions.filter(q => /^W[0-9]+-Q[0-9]+$/.test(q.id));
    ok(ws.length === 64 && ws.every(q => q.pool === 'assessment'), 'seed ' + ws.length);
    const dataTxt = fs.readdirSync(path.join(PUBLIC, 'data')).map(f => fs.readFileSync(path.join(PUBLIC, 'data', f), 'utf8')).join('\n');
    ok(!/"W[0-9]+-Q[0-9]+"/.test(dataTxt), '로컬 데이터 파일에 공통 점검 문항 번호가 있음');
    return '8주 × 8';
  });

  const server = await startServer(PUBLIC, PORT);
  browser = await chromium.launch();
  let server2 = null;
  try {
    console.log('■ 로컬 모드 — 공통 점검(연습 문항으로 흉내) · 해설 당번(내가 당번)');
    const L = await newPage();
    const lp = L.page;
    const localKey = id => lp.evaluate(id => { const q = window.LU_PRACTICE.questions.find(x => x.id === id); return { answer: q.answer_index, n: q.choices.length, lecture: q.lecture }; }, id);
    await test('Q-04', '홈: "1주차 공통 점검" 카드(흉내 표시·시작 버튼·점수 안 보여 줌 안내) · 팀 카드에 "팀원 1/3명 응시" · 해설 당번 카드(나, 문항 아직 없음)', async () => {
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
      await lp.waitForSelector('#weekly-card');
      ok(await lp.getAttribute('#weekly-card', 'data-state') === 'open', '상태');
      ok((await txt(lp, '#weekly-title')) === '1주차 공통 점검', await txt(lp, '#weekly-title'));
      const card = await txt(lp, '#weekly-card');
      ok(card.includes('연습 문항으로 흉내(개발용)') && card.includes('힌트·AI 튜터 없음') && card.includes('점수는 나에게도 보여 주지 않아요'), card);
      ok((await txt(lp, '#team-weekly')) === '이번 주 공통 점검: 팀원 1/3명 응시', await txt(lp, '#team-weekly'));
      ok(await lp.getAttribute('#expl-card', 'data-state') === 'duty-wait', await lp.getAttribute('#expl-card', 'data-state'));
      ok((await txt(lp, '#expl-status')).includes('이번 주 해설 당번은 나예요'), '당번');
      await shot(lp, '390_40_홈_공통점검_해설당번');
    });
    let expectLec;
    await test('Q-05', '공통 점검 8문항: 힌트·AI 튜터 칸 없음 · 이전 문항 · "아직 모르겠어요" · 마지막에 "다시 못 풀어요" → 응시 완료 + 다시 볼 강만 (점수·정오답 없음)', async () => {
      await lp.click('[data-act=weekly-start]'); await lp.waitForSelector('[data-screen=weekly]');
      ok(await lp.$('#weekly-intro') && (await txt(lp, '#weekly-intro')).includes('힌트·AI 튜터는 없어요'), '안내');
      ok(!(await lp.$('#hints')) && !(await lp.$('#tutor')) && !(await lp.$('#tutor-pre')) && !(await lp.$('[data-act=hint]')), '힌트·AI 튜터 칸이 보임');
      await shot(lp, '390_41_공통점검_문제');
      expectLec = await takeWeekly(lp, id => localKey(id));
      const done = await txt(lp, '[data-screen=weeklyDone]');
      ok(done.includes('1주차 공통 점검 응시 완료') && done.includes('점수는 보여 주지 않아요'), done);
      const shown = (await lp.$$eval('#weekly-review .tag', e => e.map(x => x.textContent)));
      ok(JSON.stringify(shown) === JSON.stringify(expectLec.map(lecName)), shown.join() + ' / ' + expectLec.map(lecName).join());
      ok(!/\d+\s*\/\s*8|\d+\s*점|맞힌|정답률|\d+%|정답:/.test(done), '점수처럼 보이는 글: ' + done);
      await shot(lp, '390_42_공통점검_응시완료');
    });
    await test('Q-06', '홈: 응시 완료 · 다시 볼 강 · 팀원 2/3명 응시 · 시작 버튼 없음 · 같은 주 다시 받기/제출 거절(WEEKLY_DONE)', async () => {
      await lp.click('[data-act=home]'); await lp.waitForSelector('#weekly-card[data-state=done]');
      ok((await txt(lp, '#weekly-status')) === '응시 완료', await txt(lp, '#weekly-status'));
      ok(!(await lp.$('[data-act=weekly-start]')), '시작 버튼');
      ok((await txt(lp, '#team-weekly')) === '이번 주 공통 점검: 팀원 2/3명 응시', await txt(lp, '#team-weekly'));
      const r = await lp.evaluate(async () => { const out = []; for (const f of [() => window.STORE.weeklyItems(), () => window.STORE.submitWeekly({})]) { try { await f(); out.push('통과됨'); } catch (e) { out.push(e.message); } } return out; });
      ok(r.every(m => m.includes('이미 응시했어요')), r.join(' | '));
      await lp.reload(); await lp.waitForSelector('#weekly-card[data-state=done]');   // 새로고침해도 유지
    });
    await test('Q-07', '창구가 돌려주는 점검 문항에 정답 칸 없음 · 상태에 점수 칸 없음', async () => {
      const r = await lp.evaluate(async () => {
        const db = JSON.parse(localStorage.getItem('lu2_local_db_v1')); const keep = JSON.stringify(db);
        delete db.weekly; localStorage.setItem('lu2_local_db_v1', JSON.stringify(db));
        const it = await window.STORE.weeklyItems(); const st = await window.STORE.weeklyStatus();
        localStorage.setItem('lu2_local_db_v1', keep);
        return { keys: [...new Set(it.items.flatMap(q => Object.keys(q)))].sort().join(), n: it.items.length, st: Object.keys(st).sort().join() };
      });
      ok(r.keys === 'choices,id,lecture,question,type' && r.n === 8, JSON.stringify(r));
      ok(r.st === 'cohortStart,done,fake,nItems,open,reason,reviewLectures,team,week', r.st);
    });
    await test('Q-08', '해설 당번(나): 팀이 틀린 연습 문항이 생기면 문항+정답 → 짧음·이메일 거절 → 올리기 → 고치기', async () => {
      const q = MCQ[5];
      await lp.evaluate(q => {
        const db = JSON.parse(localStorage.getItem('lu2_local_db_v1')); const day = window.STORE._debug().today;
        db.attempts.push({ code: 'TEST23', qid: q.id, mode: 'PRACTICE', outcome: '정답 보고 이해', level: 4, submits: [(q.answer_index + 1) % q.choices.length], xp: 10, day, at: Date.now() });
        localStorage.setItem('lu2_local_db_v1', JSON.stringify(db));
      }, q);
      await lp.reload(); await lp.waitForSelector('#expl-card[data-state=duty]');
      ok(await lp.getAttribute('#expl-q', 'data-id') === q.id, '문항');
      ok((await txt(lp, '#expl-answer')) === '정답: ' + q.choices[q.answer_index], await txt(lp, '#expl-answer'));
      await lp.click('[data-act=expl-edit]'); await lp.waitForSelector('#expl-body');
      ok(await lp.getAttribute('#expl-body', 'maxlength') === '200', 'maxlength');
      await lp.fill('#expl-body', '짧아요'); await lp.click('[data-act=expl-save]');
      ok((await txt(lp, '#expl-msg')).includes('10글자 이상'), await txt(lp, '#expl-msg'));
      await lp.fill('#expl-body', '궁금하면 me@example.com 으로 물어봐 주세요'); await lp.click('[data-act=expl-save]');
      ok((await txt(lp, '#expl-msg')).includes('이메일·전화번호는 쓰지 마세요'), await txt(lp, '#expl-msg'));
      ok((await txt(lp, '#expl-count')).startsWith(String('궁금하면 me@example.com 으로 물어봐 주세요'.length)), '글자 수');
      const body = '정답이 맞는 이유는 이 낱말이 그 일을 하기 때문이에요.\n헷갈린 보기는 이름만 비슷해요.';
      await lp.fill('#expl-body', body); await shot(lp, '390_43_홈_해설당번_쓰기');
      await lp.click('[data-act=expl-save]'); await lp.waitForSelector('#expl-card[data-state=duty-done]');
      ok((await lp.textContent('#expl-text')) === body, await lp.textContent('#expl-text'));
      ok((await txt(lp, '#expl-msg')).includes('해설을 올렸어요'), '안내');
      await lp.click('[data-act=expl-edit]');
      ok((await lp.inputValue('#expl-body')) === body, '고치기에 원래 글');
      await lp.fill('#expl-body', body + ' 업무에서는 먼저 확인해요.'); await lp.click('[data-act=expl-save]');
      await lp.waitForSelector('#expl-card[data-state=duty-done]');
      ok((await lp.textContent('#expl-text')).endsWith('먼저 확인해요.'), '고친 글');
      ok(!lp._errors.length, lp._errors.join('|'));
    });
    await test('Q-09', '[개발용] 팀원이 당번일 때: "이번 주 해설 당번: 바다 님" + 해설 읽기, 정답·쓰기 칸 없음', async () => {
      await lp.evaluate(() => localStorage.setItem('lu2_dev_duty', 'mate'));
      await lp.reload(); await lp.waitForSelector('#expl-card[data-state=read]');
      ok((await txt(lp, '#expl-status')) === '이번 주 해설 당번: 바다 님', await txt(lp, '#expl-status'));
      ok((await txt(lp, '#expl-text')).includes('가짜 해설'), '해설');
      ok(!(await lp.$('#expl-answer')) && !(await lp.$('[data-act=expl-edit]')) && !(await lp.$('#expl-body')), '당번 전용 칸이 보임');
      await shot(lp, '390_44_홈_해설당번_팀원');
      await lp.evaluate(() => localStorage.removeItem('lu2_dev_duty'));
    });
    await test('Q-10', '팀 활동 쉬기 → 팀 응시 인원에서 빠짐(1/2) · 당번이 다른 팀원으로 · 다시 하기 → 원래대로', async () => {
      await lp.reload(); await lp.waitForSelector('#team-card');
      await lp.click('[data-act=team-off]'); await lp.click('[data-act=team-off-yes]');
      await lp.waitForSelector('#team-card[data-state=off]');
      ok((await txt(lp, '#team-weekly')) === '이번 주 공통 점검: 팀원 1/2명 응시', await txt(lp, '#team-weekly'));
      ok((await txt(lp, '#expl-status')).includes('바다 님'), await txt(lp, '#expl-status'));
      await lp.click('[data-act=team-on]'); await lp.waitForSelector('#team-card[data-state=trying],#team-card[data-state=achieved]');
      ok((await txt(lp, '#team-weekly')) === '이번 주 공통 점검: 팀원 2/3명 응시', '다시 켬');
      ok(await lp.getAttribute('#expl-card', 'data-state') === 'duty-done', '내 해설 그대로');
    });
    await test('Q-11', '다음 주(개발용 날짜 +7일): "2주차 공통 점검"이 다시 열림 · 해설 당번은 새 주', async () => {
      await lp.evaluate(() => localStorage.setItem('lu2_dev_day_offset', '7'));
      await lp.reload(); await lp.waitForSelector('#weekly-card[data-state=open]');
      ok((await txt(lp, '#weekly-title')) === '2주차 공통 점검', await txt(lp, '#weekly-title'));
      ok(await lp.getAttribute('#expl-card', 'data-state') === 'duty-wait', '새 주 당번 ' + await lp.getAttribute('#expl-card', 'data-state'));
      await lp.evaluate(() => localStorage.setItem('lu2_dev_day_offset', '0'));
      ok(!lp._errors.length, lp._errors.join('|'));
    });
    await L.ctx.close();

    console.log('■ Supabase 모드(가짜 서버) — weekly_check_* · my_team_explainer · write_team_explainer');
    const S = await newPage({ mock: DATA, preDb: PRE_DB });
    const sp = S.page;
    const mockKey = id => { const q = WITEMS.find(x => x.id === id); return { answer: q.answer_index, n: q.choices.length, lecture: q.lecture }; };
    await test('Q-12', '홈: weekly_check_status()·my_team_explainer() 각 1번(인자 없음) → 3주차 카드 · 팀원 1/4명 응시 · 당번(나) 문항+정답 · 가짜 표시 없음', async () => {
      await sp.goto(BASE + 'index.html?mode=supabase'); await sp.waitForSelector('#app ' + settled);
      await sp.fill('#code', 'TEST23'); await sp.click('[data-act=login]');
      await sp.waitForSelector('#weekly-card[data-state=open]');
      const r = rpcs(await logOf(sp));
      const ws = r.filter(x => x.name === 'weekly_check_status'), ex = r.filter(x => x.name === 'my_team_explainer');
      ok(ws.length === 1 && ex.length === 1 && JSON.stringify(ws[0].args) === '{}' && JSON.stringify(ex[0].args) === '{}', JSON.stringify(r.map(x => x.name)));
      ok((await txt(sp, '#weekly-title')) === '3주차 공통 점검', await txt(sp, '#weekly-title'));
      ok((await txt(sp, '#team-weekly')) === '이번 주 공통 점검: 팀원 1/4명 응시', await txt(sp, '#team-weekly'));
      ok(await sp.getAttribute('#expl-q', 'data-id') === EXPL_ITEM.qid && (await txt(sp, '#expl-answer')) === '정답: ' + PRACTICE[2].choices[PRACTICE[2].answer_index], '당번 문항');
      ok(!(await txt(sp, '#app')).includes('개발용'), '개발용 표시');
      ok(!sp._requests.some(u => u.includes('/data/')), 'data/ 요청');
    });
    await test('Q-13', '점검: weekly_check_items() → 8문항 풀기 → weekly_check_submit({p_answers: 8칸, 모르겠어요 = null}) 1번 → 응시 완료 + 다시 볼 강 · 팀원 2/4명', async () => {
      await clearLog(sp);
      await sp.click('[data-act=weekly-start]'); await sp.waitForSelector('[data-screen=weekly]');
      ok(!(await sp.$('.storage-note')), '로컬 흉내 안내가 보임');
      const lec = await takeWeekly(sp, mockKey);
      const r = rpcs(await logOf(sp));
      ok(r.filter(x => x.name === 'weekly_check_items').length === 1, '문항 요청');
      const sub = r.filter(x => x.name === 'weekly_check_submit');
      ok(sub.length === 1, '제출 ' + sub.length);
      const a = sub[0].args.p_answers;
      ok(Object.keys(sub[0].args).join() === 'p_answers' && Object.keys(a).sort().join() === WITEMS.map(q => q.id).sort().join(), JSON.stringify(sub[0].args));
      ok(Object.values(a).filter(v => v === null).length === 1 && WITEMS.slice(0, 4).every(q => a[q.id] === q.answer_index), JSON.stringify(a));
      const shown = await sp.$$eval('#weekly-review .tag', e => e.map(x => x.textContent));
      ok(JSON.stringify(shown) === JSON.stringify(lec.map(lecName)), shown.join());
      await sp.click('[data-act=home]'); await sp.waitForSelector('#weekly-card[data-state=done]');
      ok((await txt(sp, '#team-weekly')) === '이번 주 공통 점검: 팀원 2/4명 응시', await txt(sp, '#team-weekly'));
      ok(!r.some(x => x.t === 'from' && x.table === 'question_keys' && JSON.stringify(x.eq).includes('W3')), '정답 표 요청');
    });
    await test('Q-14', '같은 주 다시: 시작 버튼 없음 · 창구로 직접 불러도 "이미 응시했어요" · 서버가 점수 칸을 더 보내도 화면 창구는 버림', async () => {
      ok(!(await sp.$('[data-act=weekly-start]')), '시작 버튼');
      const m = await sp.evaluate(async () => { try { await window.STORE.weeklyItems(); return '통과됨'; } catch (e) { return e.message; } });
      ok(m.includes('이미 응시했어요'), m);
      const keys = await sp.evaluate(async () => Object.keys(await window.STORE.weeklyStatus()).sort().join());
      ok(keys === 'cohortStart,done,fake,nItems,open,reason,reviewLectures,team,week', keys);
    });
    await test('Q-15', '해설 쓰기 → write_team_explainer({p_qid, p_body}) → 올린 해설 · 서버가 ITEM_CHANGED 면 안내 + 쓴 글 그대로 + 당번 정보 다시 받음', async () => {
      await clearLog(sp);
      await sp.click('[data-act=expl-edit]'); await sp.fill('#expl-body', '  가짜 서버로 올리는 해설이에요. 정답은 이 낱말 때문이에요.  ');
      await sp.click('[data-act=expl-save]'); await sp.waitForSelector('#expl-card[data-state=duty-done]');
      const w = rpcs(await logOf(sp)).filter(x => x.name === 'write_team_explainer');
      ok(w.length === 1 && JSON.stringify(w[0].args) === JSON.stringify({ p_qid: EXPL_ITEM.qid, p_body: '가짜 서버로 올리는 해설이에요. 정답은 이 낱말 때문이에요.' }), JSON.stringify(w));
      ok((await sp.textContent('#expl-text')) === '가짜 서버로 올리는 해설이에요. 정답은 이 낱말 때문이에요.', '보임');
      await sp.reload(); await sp.waitForSelector('#expl-card[data-state=duty-done]');   // 서버에 남음
      await sp.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ write_team_explainer: 'ITEM_CHANGED' })));
      await clearLog(sp);
      await sp.click('[data-act=expl-edit]'); await sp.fill('#expl-body', '고쳐 쓰는 해설인데 그사이 문항이 바뀐 경우예요.'); await sp.click('[data-act=expl-save]');
      await sp.waitForFunction(() => document.querySelector('#expl-msg') && document.querySelector('#expl-msg').textContent.includes('문항이 바뀌었어요'));
      ok((await sp.inputValue('#expl-body')) === '고쳐 쓰는 해설인데 그사이 문항이 바뀐 경우예요.', '쓴 글이 사라짐');
      ok(rpcs(await logOf(sp)).some(x => x.name === 'my_team_explainer'), '다시 받지 않음');
      await sp.evaluate(() => localStorage.removeItem('mock_fail'));
      ok(!sp._errors.length, sp._errors.join('|'));
      ok(!sp._requests.some(u => /supabase\.co/.test(u)), '진짜 서버 요청');
    });
    await S.ctx.close();
    const S2 = await newPage({ mock: Object.assign({}, DATA, { explainer: { duty: '바다', item: EXPL_ITEM, body: '바다 님이 쓴 가짜 해설이에요. 이유를 짧게 적었어요.' } }), preDb: PRE_DB });
    await test('Q-16', '팀원이 당번: "이번 주 해설 당번: 바다 님" + 해설 읽기 (정답·쓰기 칸 없음) · 연습 정답을 따로 불러오지 않음', async () => {
      const p = S2.page;
      await p.goto(BASE + 'index.html?mode=supabase'); await p.waitForSelector('#app ' + settled);
      await p.fill('#code', 'TEST23'); await p.click('[data-act=login]');
      await p.waitForSelector('#expl-card[data-state=read]');
      ok((await txt(p, '#expl-status')) === '이번 주 해설 당번: 바다 님' && (await txt(p, '#expl-text')).startsWith('바다 님이 쓴'), await txt(p, '#expl-card'));
      ok(!(await p.$('#expl-answer')) && !(await p.$('[data-act=expl-edit]')), '당번 전용 칸');
      ok(!(await logOf(p)).some(x => x.t === 'from' && x.table === 'question_keys'), '홈에서 정답 표를 읽음');
    });
    await S2.ctx.close();
    const S3 = await newPage({ mock: Object.assign({}, DATA, { weekly: null, explainer: null }), preDb: PRE_DB });
    await test('Q-17', '서버에 60번 SQL 적용 전(함수 없음): 홈은 그대로 · 점검·당번 카드만 숨김 · 오류 띠 없음 · 팀 카드 그대로', async () => {
      const p = S3.page;
      await p.goto(BASE + 'index.html?mode=supabase'); await p.waitForSelector('#app ' + settled);
      await p.fill('#code', 'TEST23'); await p.click('[data-act=login]');
      await p.waitForSelector('#team-card');
      ok(!(await p.$('#weekly-card')) && !(await p.$('#expl-card')) && !(await p.$('#team-weekly')), '카드가 보임');
      ok(!(await p.$('#err')), '오류 띠');
      ok(p._warn.some(w => w.includes('공통 점검 정보를 불러오지 못했어요')) && p._warn.some(w => w.includes('해설 당번 정보를 불러오지 못했어요')), '콘솔 경고');
      ok(!p._errors.length, p._errors.join('|'));
    });
    await S3.ctx.close();
    const S4 = await newPage({ mock: Object.assign({}, DATA, { weekly: Object.assign({}, DATA.weekly, { reason: 'NOT_STARTED' }) }), preDb: PRE_DB });
    await test('Q-18', '기수 시작 전(NOT_STARTED): 카드에 "기수가 시작되면 매주 열려요 (시작 날짜)" · 시작 버튼·팀 응시 줄 없음 / 꺼짐(OFF): 카드 없음', async () => {
      const p = S4.page;
      await p.goto(BASE + 'index.html?mode=supabase'); await p.waitForSelector('#app ' + settled);
      await p.fill('#code', 'TEST23'); await p.click('[data-act=login]');
      await p.waitForSelector('#weekly-card[data-state=closed]');
      ok((await txt(p, '#weekly-status')).includes('기수가 시작되면 매주 열려요') && (await txt(p, '#weekly-status')).includes('2027-03-01'), await txt(p, '#weekly-status'));
      ok(!(await p.$('[data-act=weekly-start]')) && !(await p.$('#team-weekly')), '시작 버튼·팀 줄');
      await p.evaluate(() => { window.__MOCK_DATA.weekly.reason = 'OFF'; });
      await p.evaluate(() => window.STORE.weeklyStatus()).then(w => ok(w.reason === 'OFF' && w.week === null, JSON.stringify(w)));
    });
    await S4.ctx.close();
    const S5 = await newPage({ mock: Object.assign({}, DATA, { weekly: Object.assign({}, DATA.weekly, { reason: 'OFF' }) }), preDb: PRE_DB });
    await test('Q-19', '꺼짐(OFF, 기수 시작일 없음): 공통 점검 카드가 아예 안 보임', async () => {
      const p = S5.page;
      await p.goto(BASE + 'index.html?mode=supabase'); await p.waitForSelector('#app ' + settled);
      await p.fill('#code', 'TEST23'); await p.click('[data-act=login]');
      await p.waitForSelector('#team-card');
      ok(!(await p.$('#weekly-card')) && !(await p.$('#team-weekly')), '카드');
    });
    await S5.ctx.close();

    console.log('■ 교수 화면 — ④ AI 튜터 사용량 · ⑤ 공통 점검 문항별 정답률');
    const AL = await newPage({ viewport: { width: 1024, height: 900 } });
    const ap = AL.page;
    await test('Q-20', '로컬(가짜): ④ 스위치·호출 수·추정 비용/예산 · ⑤ 3주차 8문항(응시 3명 미만 문항은 "3명 미만") · 2주차로 바꾸면 모두 숫자', async () => {
      await ap.goto(BASE + 'admin.html'); await ap.waitForSelector('#admin ' + settled);
      await ap.fill('#email', 'prof@example.com'); await ap.click('[data-act=send]'); await ap.waitForSelector('[data-screen=dash]');
      ok((await txt(ap, '#tutor-switch')).startsWith('스위치: 꺼짐') && (await txt(ap, '#tutor-cost')) === '$0.41', await txt(ap, '#tutor-section'));
      ok(await ap.$$eval('#tutor-usage li', e => e.length) === 4, '숫자 칸');
      ok(await ap.$$eval('#weekly-items tbody tr', e => e.length) === 8, '문항 줄');
      ok((await txt(ap, '#weekly-items')).includes('3명 미만'), '3명 미만 표시');
      ok((await ap.$eval('#wk-week', e => e.value)) === '3' && (await txt(ap, '#wk-week')).includes('3주차 (이번 주)'), '주 선택');
      await shot(ap, '1024_40_교수화면_튜터사용량_공통점검');
      await ap.selectOption('#wk-week', '2'); await ap.waitForFunction(() => document.querySelector('#weekly-summary') && document.querySelector('#weekly-summary').textContent.startsWith('2주차'));
      ok(!(await txt(ap, '#weekly-items')).includes('3명 미만'), '지난 주는 모두 숫자');
      ok(!/TEST23|TEST45|PLAY89/.test(await txt(ap, '#admin')), '학생 코드');
      ok(!ap._errors.length, ap._errors.join('|'));
    });
    await AL.ctx.close();
    const AM = await newPage();
    await test('Q-21', '교수 화면 390px: ④·⑤ 칸이 가로로 넘치지 않음', async () => {
      await AM.page.goto(BASE + 'admin.html'); await AM.page.waitForSelector('#admin ' + settled);
      await AM.page.fill('#email', 'prof@example.com'); await AM.page.click('[data-act=send]'); await AM.page.waitForSelector('#weekly-section');
      const over = await AM.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(over <= 1, '가로 넘침 ' + over + 'px');
      await shot(AM.page, '390_45_교수화면_공통점검');
    });
    await AM.ctx.close();
    const P = await newPage({ mock: DATA, viewport: { width: 1024, height: 900 } });
    const pp = P.page;
    await test('Q-22', '가짜 서버: admin_tutor_usage({}) · admin_weekly_stats({p_cohort:"2027-1", p_week:null}) → ④ $1.60 / $6.40 (25%) · ⑤ 문항 8줄 · 팀별 응시 · 주 바꾸면 p_week 2', async () => {
      await pp.goto(BASE + 'admin.html?mode=supabase'); await pp.waitForSelector('#admin ' + settled);
      await pp.fill('#email', 'prof@example.com'); await pp.click('[data-act=send]'); await pp.waitForSelector('#sent');
      await pp.fill('#otp', '123456'); await pp.click('[data-act=verify]'); await pp.waitForSelector('[data-screen=dash]');
      const r = rpcs(await logOf(pp));
      const tu = r.find(x => x.name === 'admin_tutor_usage'), wk = r.find(x => x.name === 'admin_weekly_stats');
      ok(tu && JSON.stringify(tu.args) === '{}' && wk && JSON.stringify(wk.args) === '{"p_cohort":"2027-1","p_week":null}', JSON.stringify(r.map(x => [x.name, x.args])));
      ok((await txt(pp, '#tutor-cost')) === '$1.60' && (await txt(pp, '#tutor-section')).includes('25%') && (await txt(pp, '#tutor-switch')).startsWith('스위치: 켜짐'), await txt(pp, '#tutor-section'));
      ok((await txt(pp, '#tutor-section')).includes('약 ₩2,240'), '원화');
      ok(await pp.$$eval('#weekly-items tbody tr', e => e.length) === 8 && (await txt(pp, '#weekly-teams')) === '팀별 응시: 1팀 3/4명 · 3팀 1/4명', await txt(pp, '#weekly-section'));
      await clearLog(pp);
      await pp.selectOption('#wk-week', '2'); await pp.waitForFunction(() => document.querySelector('#weekly-summary') && document.querySelector('#weekly-summary').textContent.startsWith('2주차'));
      const w2 = rpcs(await logOf(pp)).filter(x => x.name === 'admin_weekly_stats').slice(-1)[0];
      ok(w2 && w2.args.p_week === 2 && w2.args.p_cohort === '2027-1', JSON.stringify(w2));
      ok(!pp._errors.length, pp._errors.join('|'));
    });
    await P.ctx.close();
    const P2 = await newPage({ mock: Object.assign({}, DATA, { adminTutor: null, adminWeekly: null }), viewport: { width: 1024, height: 900 } });
    await test('Q-23', '가짜 서버에 ④·⑤ 함수가 아직 없으면: 대시보드는 열리고 그 칸만 "아직 설치되지 않았어요(…sql 적용 전)"', async () => {
      const p = P2.page;
      await p.goto(BASE + 'admin.html?mode=supabase'); await p.waitForSelector('#admin ' + settled);
      await p.fill('#email', 'prof@example.com'); await p.click('[data-act=send]'); await p.waitForSelector('#sent');
      await p.fill('#otp', '123456'); await p.click('[data-act=verify]'); await p.waitForSelector('[data-screen=dash]');
      ok((await txt(p, '#tutor-usage-missing')).includes('50_ai_tutor.sql 적용 전') && (await txt(p, '#weekly-missing')).includes('60_m2_weekly_explainer.sql 적용 전'), await txt(p, '#tutor-section') + ' / ' + await txt(p, '#weekly-section'));
      ok(!(await p.$('#err')), '오류 띠');
    });
    await P2.ctx.close();
    const P3 = await newPage({ mock: Object.assign({}, DATA, { adminWeekly: Object.assign({}, ADMIN_WEEKLY, { cohortStart: null, currentWeek: null }) }), viewport: { width: 1024, height: 900 } });
    await test('Q-24', '공통 점검이 꺼져 있으면(cohort_start 없음) ⑤에 "꺼져 있어요" + 켜는 SQL 한 줄', async () => {
      const p = P3.page;
      await p.goto(BASE + 'admin.html?mode=supabase'); await p.waitForSelector('#admin ' + settled);
      await p.fill('#email', 'prof@example.com'); await p.click('[data-act=send]'); await p.waitForSelector('#sent');
      await p.fill('#otp', '123456'); await p.click('[data-act=verify]'); await p.waitForSelector('[data-screen=dash]');
      ok((await txt(p, '#weekly-off')).includes("update app_settings set cohort_start = '2027-03-01' where id = 1;"), await txt(p, '#weekly-off'));
    });
    await P3.ctx.close();

    console.log('■ 배포용 폴더 (tools/make_deploy.py)');
    await test('Q-25', '배포용 폴더: 새 화면 코드 포함 · data/ 없음 · ?mode 없이 Supabase 모드로 점검 카드·당번 카드가 열림', async () => {
      const out = execFileSync('python3', [path.join(APP, 'tools/make_deploy.py'), DEPLOY_DIR], { encoding: 'utf8' });
      ok(!fs.existsSync(path.join(DEPLOY_DIR, 'data')), 'data/');
      ok(fs.readFileSync(path.join(DEPLOY_DIR, 'js/store.js'), 'utf8').includes('weekly_check_submit') && fs.readFileSync(path.join(DEPLOY_DIR, 'js/admin.js'), 'utf8').includes('admin_weekly_stats'), '새 코드');
      server2 = await startServer(DEPLOY_DIR, PORT2);
      const v = await newPage({ mock: DATA, preDb: PRE_DB });
      await v.page.goto(BASE2 + 'index.html'); await v.page.waitForSelector('#app ' + settled);
      await v.page.fill('#code', 'TEST23'); await v.page.click('[data-act=login]');
      await v.page.waitForSelector('#weekly-card'); await v.page.waitForSelector('#expl-card');
      ok(!v.page._requests.some(u => u.includes('/data/')), 'data/ 요청');
      ok(!v.page._errors.length, v.page._errors.join('|'));
      await v.ctx.close();
      return out.trim().replace(DEPLOY_DIR, '(임시 폴더)');
    });

    console.log('■ 서버 SQL (60_m2_weekly_explainer.sql)');
    await test('Q-26', '60번 파일: 기존 함수 재정의 없음 · 지우기(drop/delete/truncate) 없음 · 새 함수 8개 모두 public·anon 회수 · 도우미 2개는 authenticated 도 회수 · 새 표 3개 RLS·권한 회수 · 비밀 열쇠 없음', async () => {
      const sql = fs.readFileSync(path.join(APP, 'supabase/60_m2_weekly_explainer.sql'), 'utf8');
      const code = sql.replace(/--.*$/gm, '');
      const fns = [...code.matchAll(/create or replace function\s+(\w+)\s*\(/gi)].map(m => m[1]);
      const before = ['schema.sql', '30_m2_teams_admin.sql', '40_ox_fix.sql', '50_ai_tutor.sql'].map(f => fs.readFileSync(path.join(APP, 'supabase', f), 'utf8')).join('\n');
      const old = new Set([...before.matchAll(/create or replace function\s+(\w+)\s*\(/gi)].map(m => m[1]));
      ok(fns.length === 8 && !fns.some(f => old.has(f)), '재정의: ' + fns.filter(f => old.has(f)).join(',') + ' / ' + fns.join(','));
      ok(!/\b(drop|truncate)\b|\bdelete\s+from\b/i.test(code), '지우는 문장');
      const revokeAnon = (code.match(/revoke execute on function([\s\S]*?)from public, anon;/i) || [])[1] || '';
      const missing = fns.filter(f => !new RegExp('\\b' + f + '\\(').test(revokeAnon));
      ok(!missing.length, '회수 빠짐: ' + missing.join(','));
      ok(/revoke execute on function lu_check_week\(\), lu_explainer_pick\(uuid, date\) from authenticated;/.test(code), '도우미 회수');
      const grant = (code.match(/grant execute on function([\s\S]*?)to authenticated;/i) || [])[1] || '';
      ok(!/lu_check_week|lu_explainer_pick/.test(grant) && ['weekly_check_status', 'weekly_check_items', 'weekly_check_submit', 'my_team_explainer', 'write_team_explainer', 'admin_weekly_stats'].every(f => grant.includes(f + '(')), '허용 목록 ' + grant);
      ['weekly_checks', 'weekly_answers', 'team_explainers'].forEach(t => ok(new RegExp('alter table ' + t + '\\s+enable row level security', 'i').test(code), t + ' RLS'));
      ok(/revoke all on weekly_checks, weekly_answers, team_explainers from public, anon, authenticated;/.test(code), '표 권한 회수');
      ok(!/create policy/i.test(code), '학생 읽기 규칙(policy)을 만듦');
      ok(!/sk-ant-|sb_secret_|eyJhbGci|service_role/.test(code), '비밀 열쇠·service_role');
      ok(/update questions\s+set week = substring\(id from '\^W\(\[0-9\]\+\)-Q\[0-9\]\+\$'\)::int/.test(code), '주 번호 채우기 SQL');
      return '새 함수 ' + fns.length + '개 · 새 표 3개';
    });
    await test('Q-27', '임시 PostgreSQL 시험(있으면): supabase/local_test/run_weekly_local.sh 실패 0', async () => {
      if (!fs.existsSync('/usr/lib/postgresql/16/bin/initdb') && !process.env.PG_BIN) return '건너뜀 — 이 컴퓨터에 PostgreSQL 16 없음';
      const r = spawnSync('bash', [path.join(APP, 'supabase/local_test/run_weekly_local.sh')], { encoding: 'utf8', timeout: 180000 });
      const last = (r.stdout || '').trim().split('\n').slice(-1)[0];
      ok(r.status === 0, last + ' / ' + (r.stdout || '').split('\n').filter(x => x.startsWith('FAIL')).join(' | ') + (r.stderr || '').slice(0, 300));
      return last;
    });
  } finally {
    await browser.close(); server.kill(); if (server2) server2.kill();
    fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_m2_3_results.json'), JSON.stringify(results, null, 1));
  console.log(`\nM2 3차(공통 점검·해설 당번·교수 ④⑤) 테스트: 통과 ${pass} · 실패 ${fail}  ※ 실DB 미검증`);
  process.exit(fail ? 1 : 0);
})();
