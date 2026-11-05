// [80] 세션 복구(지워진 익명 계정) + [강의 보기] 자동 테스트 (Playwright + node)
// 실행: node 04_제품개발팀/app2/tests/run_e2e_lectures.js
// - md 변환 도구(tools/build_lectures.py) 안전성 · 로컬 모드 화면 · Supabase 모드(가짜 서버 tests/mock_supabase.js, 진짜 라이브러리 + 가짜 HTTP)
//   · 배포 폴더 · SQL 파일 검사 · 임시 PostgreSQL 시험(있으면)
// - 진짜 Supabase 에는 한 번도 접속하지 않습니다(실DB 미검증). 컴퓨터 안의 임시 서버(127.0.0.1)만 씁니다.
// - 강의 노트는 tests/fake_lectures/ 의 가짜 md 로 시험 (진짜 강의 내용 아님). 결과: tests/e2e_lectures_results.json, 스크린샷 screenshots/
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const load = require('./load_practice');

const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const SHOTS = path.join(APP, 'screenshots');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const SQL80 = fs.readFileSync(path.join(APP, 'supabase/80_session_fix.sql'), 'utf8');
const BUILD = path.join(APP, 'tools/build_lectures.py');
const FAKE_MD = path.join(__dirname, 'fake_lectures');
const PRACTICE = load('practice.js', 'LU_PRACTICE');
const DIAGQ = load('diagnostic.js', 'LU_DIAG');
const DKEY = load('dev_diag_key.js', 'LU_DEV_DIAG_KEY');
const DIAG = DIAGQ.map(q => Object.assign({}, q, DKEY[q.id]));
const PORT = 11000 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
const URL_ = 'https://ebquzmmvkknknpmiqnyk.supabase.co';
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lu2_lec_'));

const results = [];
let browser;
function ok(c, m) { if (!c) throw new Error(m); }
async function test(id, name, fn) {
  const t0 = Date.now();
  try { const note = await fn(); results.push({ id, name, status: 'pass', note: note || '', ms: Date.now() - t0 }); console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ id, name, status: 'fail', note: String(e && e.message || e), ms: Date.now() - t0 }); console.log(`  [실패] ${id} ${name} — ${e && e.message}`); }
}
function build(src, tag) {
  const js = path.join(TMP, tag + '.js'), seed = path.join(TMP, tag + '.json');
  const r = spawnSync('python3', [BUILD, '--src', src, '--js', js, '--seed', seed], { encoding: 'utf8' });
  return { r, js, seed, jsText: fs.existsSync(js) ? fs.readFileSync(js, 'utf8') : '', seedObj: fs.existsSync(seed) ? JSON.parse(fs.readFileSync(seed, 'utf8')) : null };
}
const settled = '.screen:not([data-screen=loading])';
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
const txt = async (p, sel) => ((await p.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const scr = p => p.$eval('.screen', e => e.dataset.screen);
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
const LOCAL_DB = (diagDone) => ({ v: 1, students: { TEST23: { code: 'TEST23', nickname: '하늘별', theta: 0, n: 0, xp: 0, created: '2026-11-02' } }, items: {}, attempts: [],
  diag: { TEST23: diagDone ? { answers: DIAG.slice(0, 12).map(q => ({ qid: q.id, choice: 0 })), done: true, doneDay: '2026-11-02' } : { answers: [], done: false } }, review: {} });
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 } });
  if (opts.localDb) await ctx.addInitScript(db => {
    if (!localStorage.getItem('lu2_local_db_v1')) { localStorage.setItem('lu2_local_db_v1', JSON.stringify(db)); localStorage.setItem('lu2_local_session', 'TEST23'); }
  }, opts.localDb);
  if (opts.lecturesJs !== undefined) await ctx.route('**/data/lectures.js', r => opts.lecturesJs === null ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ body: opts.lecturesJs, contentType: 'application/javascript' }));
  if (opts.config) await ctx.route('**/js/config.js', r => r.fulfill({ body: opts.config, contentType: 'application/javascript' }));
  if (opts.mock) {
    await ctx.addInitScript(([d, pre]) => {
      window.__MOCK_DATA = d;
      if (pre) for (const k of Object.keys(pre)) if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(pre[k]));
    }, [opts.mock, opts.preLs || null]);
    await ctx.route('**/vendor/supabase.js', r => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  }
  if (!opts.realLib) await ctx.route(/supabase\.co/, r => r.abort());   // 진짜 서버로 나가면 끊음
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', e => page._errors.push(e.message));
  return { ctx, page };
}
const logOf = p => p.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]'));
const clearLog = p => p.evaluate(() => localStorage.removeItem('mock_log'));
const rpcs = l => l.filter(x => x.t === 'rpc');
// 지금 문제 화면의 정답을 골라 내고(정답 = 화면 문항의 answer_index) → 해설 화면까지
async function solveRight(page, Q) {
  await page.waitForSelector('[data-screen=item] #qid');
  const id = await page.$eval('#qid', e => e.dataset.id);
  const q = Q[id]; ok(q, '모르는 문항 ' + id);
  await page.click(`.choice[data-orig="${q.answer_index}"]`); await page.click('[data-act=submit]');
  await page.waitForSelector('#verdict');
  return id;
}
const QBY = {}; PRACTICE.forEach(q => { QBY[q.id] = q; });
const LEC1 = PRACTICE.filter(q => q.lecture === 1).sort((a, b) => a.difficulty - b.difficulty || (a.id < b.id ? -1 : 1)).map(q => q.id);

(async () => {
  console.log('■ md 변환 도구 (tools/build_lectures.py) — 가짜 md');
  const B = build(FAKE_MD, 'fake');
  const FAKE_LECS = B.seedObj ? B.seedObj.lectures : [];
  await test('L-01', '가짜 md 5개: 정상 3강(01·02·05) 변환 · HTML 태그 든 03강, 첫 줄 번호가 다른 04강은 건너뜀(이유 출력·종료 코드 1) · 없는 강은 건너뜀', async () => {
    ok(B.r.status === 1, '종료 코드 ' + B.r.status + ' ' + B.r.stderr);
    ok(/03강: HTML 태그/.test(B.r.stdout) && /04강: 파일 이름\(04강\)과 첫 줄 강 번호\(07강\)가 달라요/.test(B.r.stdout), B.r.stdout);
    ok(JSON.stringify(FAKE_LECS.map(x => x.lecture)) === '[1,2,5]', JSON.stringify(FAKE_LECS.map(x => x.lecture)));
    ok(/3강 변환 \(검토 끝 1\) · 아직 없음 25강 · 건너뜀 2강/.test(B.r.stdout), B.r.stdout.split('\n')[0]);
    return B.r.stdout.split('\n')[0];
  });
  await test('L-02', '변환 결과 모양: 제목(“01강” 뗌)·읽는 시간·상태(> 상태: 검토 완료 → reviewed)·제목·굵게·표(머리·줄)·인용(2줄)·번호 목록·“꼭 기억할 3가지” 표시', async () => {
    const [a, b, c] = FAKE_LECS;
    ok(a.title === '가짜 강의 하나: AI의 출발' && a.minutes === 5 && a.status === 'draft' && b.status === 'reviewed' && b.minutes === 4 && c.minutes === 6, JSON.stringify([a.title, a.minutes, a.status, b.status]));
    const t = a.body_json.map(k => k.t).join(',');
    ok(t === 'h,p,table,h,quote,ol,h,ul,h,p', t);
    ok(JSON.stringify(a.body_json[1].text) === JSON.stringify([['가짜 강의 첫 문단이에요. ', 0], ['굵은 글자', 1], ['와 보통 글자가 섞여 있어요. 같은 문단의 둘째 줄이에요.', 0]]), JSON.stringify(a.body_json[1]));
    const tb = a.body_json[2]; ok(tb.head.length === 2 && tb.rows.length === 2 && JSON.stringify(tb.rows[0][1]) === JSON.stringify([['사람이 ', 0], ['규칙', 1], ['을 넣어요', 0]]), JSON.stringify(tb));
    ok(a.body_json[4].lines.length === 2 && a.body_json[7].key === 1 && a.body_json[7].items.length === 3 && !a.body_json[5].key, '인용·기억 목록');
    ok(c.body_json.some(k => k.t === 'h' && k.lv === 3), '### 작은 제목');
    ok(JSON.stringify(c.body_json.find(k => k.t === 'ul').items[0]) === JSON.stringify([['목록 하나', 0], [' ', 0], ['이어지는 줄', 0]]), '이어지는 목록 줄');
    ok(/^window\.LU_LECTURES = \{"lectures":\{"1":/.test(B.jsText.split('\n')[2]) && B.jsText.includes('"status":"reviewed"'), 'lectures.js 모양');
  });
  await test('L-03', 'md 변환 안전성: 태그·주석·&글자코드 12가지는 모두 건너뜀 / "a < b"·"3<5"·[링크](javascript:…)·짝 없는 ** 는 글자 그대로(HTML 없음) / 결과 어디에도 꺾쇠 태그 없음', async () => {
    const bad = ['<script>alert(1)</script>', '<SCRIPT >x', '</p>', '<img src=x onerror=alert(1)>', '<a href="javascript:x">t</a>', '<!-- 주석 -->', '<!doctype html>',
                 '&lt;script&gt;', '&#60;script&#62;', '&nbsp;', '<iframe', '<svg/onload=alert(1)>'];
    const dir = path.join(TMP, 'bad'); fs.mkdirSync(dir, { recursive: true });
    bad.forEach((b, i) => fs.writeFileSync(path.join(dir, String(i + 1).padStart(2, '0') + '강.md'), `# ${String(i + 1).padStart(2, '0')}강 나쁜 예\n> 읽는 시간: 약 5분\n\n## 핵심 개념\n글 ${b} 끝\n`));
    fs.writeFileSync(path.join(dir, '20강.md'), '# 20강 괜찮은 예\n\n## 핵심 개념\n크기 a < b, 3<5, c > d, ** 짝 없음, [링크](javascript:alert(1))\n');
    fs.writeFileSync(path.join(dir, '21강.md'), '그냥 글 (첫 줄이 제목이 아님)\n');
    fs.writeFileSync(path.join(dir, '22강.md'), '');
    const R = build(dir, 'bad');
    const got = R.seedObj.lectures.map(x => x.lecture);
    ok(JSON.stringify(got) === '[20]', '변환된 강: ' + JSON.stringify(got) + '\n' + R.r.stdout);
    ok((R.r.stdout.match(/\[건너뜀\]/g) || []).length === bad.length + 2, R.r.stdout);
    const p = R.seedObj.lectures[0].body_json[1].text;
    ok(p.length === 1 && p[0][0] === '크기 a < b, 3<5, c > d, ** 짝 없음, [링크](javascript:alert(1))' && p[0][1] === 0, JSON.stringify(p));
    ok(!/<\/?[A-Za-z]/.test(R.jsText + JSON.stringify(R.seedObj.lectures)), '꺾쇠 태그 모양이 남음');
    ok(!/<\/?[A-Za-z]/.test(B.jsText), '가짜 md 결과에 태그');
    return '나쁜 예 ' + bad.length + '가지 + 모양 틀림 2';
  });
  await test('L-04', 'seed.json: 원래 칸(questions·keys·hints·cards)은 그대로 두고 "lectures"만 채움 · build_seed.py 는 "lectures"를 지우지 않음(소스 확인) · 진짜 강의 폴더도 건너뜀 0', async () => {
    const real = path.join(APP, 'supabase/seed/seed.json');
    const tmpSeed = path.join(TMP, 'copy_seed.json'); fs.copyFileSync(real, tmpSeed);
    const before = JSON.parse(fs.readFileSync(tmpSeed, 'utf8'));
    const r = spawnSync('python3', [BUILD, '--src', FAKE_MD, '--js', path.join(TMP, 'x.js'), '--seed', tmpSeed], { encoding: 'utf8' });
    const after = JSON.parse(fs.readFileSync(tmpSeed, 'utf8'));
    ok(['questions', 'keys', 'hints', 'cards'].every(k => JSON.stringify(before[k]) === JSON.stringify(after[k])) && after.lectures.length === 3, 'seed 다른 칸이 바뀜 ' + r.stdout);
    const bs = fs.readFileSync(path.join(APP, 'tools/build_seed.py'), 'utf8');
    ok(/"lectures": lectures/.test(bs) && /get\("lectures", \[\]\)/.test(bs), 'build_seed.py 가 lectures 를 지킴');
    const src = path.resolve(APP, '../../03_교육기획팀/강의콘텐츠');
    if (!fs.existsSync(src)) return '진짜 강의 폴더 아직 없음';
    const R = build(src, 'real');
    ok(R.r.status === 0, '진짜 강의 md 중 건너뛴 강: ' + R.r.stdout);
    return R.r.stdout.split('\n')[0].trim();
  });

  const server = await startServer(PUBLIC, PORT);
  browser = await chromium.launch();
  try {
    console.log('■ 로컬 모드 — 강의 보기');
    const L = await newPage({ viewport: { width: 390, height: 844 }, localDb: LOCAL_DB(true), lecturesJs: B.jsText }); const lp = L.page;
    await test('L-10', '홈 [강의 보기] → 1~30강 목록: 01·02·05강 제목·읽는 시간, 03·04강(건너뛴 강)·나머지는 "준비 중" · 검토 전 강은 "(검토 전 · 개발용)"', async () => {
      await lp.goto(BASE + 'index.html'); await lp.waitForSelector('[data-screen=home]');
      ok((await txt(lp, '#lec-entry')).includes('강의 보기'), '홈 카드');
      await lp.click('[data-act=lectures]'); await lp.waitForSelector('[data-screen=lectures] #lec-list');
      const rows = await lp.$$eval('#lec-list .lec-row', e => e.map(x => ({ n: x.dataset.n, btn: x.tagName === 'BUTTON', t: x.textContent.replace(/\s+/g, ' ').trim() })));
      ok(rows.length === 30, '줄 수 ' + rows.length);
      ok(rows[0].btn && rows[0].t.includes('가짜 강의 하나') && rows[0].t.includes('약 5분') && rows[0].t.includes('검토 전'), JSON.stringify(rows[0]));
      ok(rows[1].btn && !rows[1].t.includes('검토 전') && rows[4].btn, JSON.stringify([rows[1], rows[4]]));
      ok(!rows[2].btn && rows[2].t.includes('준비 중') && !rows[3].btn && !rows[29].btn, JSON.stringify([rows[2], rows[3]]));
      ok(!(await lp.$('#lec-locked')), '30강 모두 열림인데 잠김 안내');
      await shot(lp, '390_60_강의목록');
      return rows.filter(r => r.btn).length + '강 읽기 가능';
    });
    await test('L-11', '01강 페이지: 제목·읽는 시간·큰 제목·굵게·표·인용·번호 목록·“꼭 기억할 3가지”(번호 동그라미) · 맨 아래 [이 강 연습 문제 풀기][홈으로] · 읽기만 해서는 기록·XP 0', async () => {
      const xp0 = await lp.evaluate(() => window.STORE._debug().me.xp), at0 = await lp.evaluate(() => window.STORE._debug().db.attempts.length);
      await lp.click('.lec-row[data-n="1"]'); await lp.waitForSelector('[data-screen=lecture] #lec-body');
      ok((await txt(lp, '#lec-title')) === '가짜 강의 하나: AI의 출발' && (await txt(lp, '#lec-min')).includes('약 5분'), '제목');
      ok(await lp.$eval('#lec-body', e => e.querySelectorAll('h3').length === 4 && e.querySelectorAll('table th').length === 2 && e.querySelectorAll('tbody tr').length === 2 &&
        e.querySelector('p b').textContent === '굵은 글자' && e.querySelectorAll('blockquote p').length === 2 && e.querySelectorAll('ol li').length === 2 &&
        e.querySelectorAll('ul.lec-key li').length === 3), '본문 모양');
      ok(await lp.$('#lec-draft'), '검토 전 표시');
      const btns = await lp.$$eval('#lec-actions button', e => e.map(x => x.textContent.trim()));
      ok(btns[0] === '이 강 연습 문제 풀기' && btns[1] === '홈으로', btns.join(','));
      ok(await lp.evaluate(() => { const a = document.querySelector('#lec-actions').getBoundingClientRect(), b = document.querySelector('#lec-body').getBoundingClientRect(); return a.top >= b.bottom; }), '버튼이 본문 아래가 아님');
      ok(await lp.evaluate(() => window.STORE._debug().me.xp) === xp0 && await lp.evaluate(() => window.STORE._debug().db.attempts.length) === at0, '읽기로 기록이 바뀜');
      await shot(lp, '390_61_강의페이지_01강');
    });
    await test('L-12', '05강(까다로운 글자): "a < b"·[링크](javascript:…)는 글자 그대로, 링크·그림·스크립트 요소 0 · 02강(검토 끝)은 검토 전 표시 없음', async () => {
      await lp.click('[data-act=lectures]'); await lp.waitForSelector('#lec-list');
      await lp.click('.lec-row[data-n="5"]'); await lp.waitForSelector('[data-screen=lecture][data-screen] #lec-body');
      const t = await txt(lp, '#lec-body');
      ok(t.includes('크기 비교 a < b 와 c > d') && t.includes('[링크](javascript:alert(1))') && t.includes('코드 표시는 글자만'), t.slice(0, 200));
      ok(await lp.$eval('#lec-body', e => e.querySelectorAll('a,img,script,iframe,svg,style').length === 0), '위험한 요소');
      await lp.click('[data-act=lectures]'); await lp.waitForSelector('#lec-list');
      await lp.click('.lec-row[data-n="2"]'); await lp.waitForSelector('#lec-body');
      ok(!(await lp.$('#lec-draft')), '검토 끝인데 검토 전 표시');
      await lp.click('#lec-actions [data-act=home]'); await lp.waitForSelector('[data-screen=home]');
    });
    await test('L-13', '[이 강 연습 문제 풀기] → 01강 안 푼 문항(쉬운 것부터) · 처음 푼 문항 +10 XP(규칙 그대로) · next_practice 안 씀 · 3문항 다 풀면 "01강 연습 끝!"+다 풀었다는 안내 · 다시 누르면 "이미 다 풀었어요"', async () => {
      const picks0 = await lp.evaluate(() => window.STORE._debug().picks.length);
      await lp.click('[data-act=lectures]'); await lp.waitForSelector('#lec-list');
      await lp.click('.lec-row[data-n="1"]'); await lp.waitForSelector('#lec-body');
      await lp.click('[data-act=lecture-practice]');
      const seen = [], xps = [];
      for (let i = 0; i < LEC1.length; i++) {
        seen.push(await solveRight(lp, QBY));
        ok((await txt(lp, '.qhead .tag')) === '01강', '강 표시');
        xps.push(await txt(lp, '#xp-gain'));
        if (i === 0) await shot(lp, '390_62_강의연습_해설');
        await lp.click('[data-act=next]');
      }
      await lp.waitForSelector('[data-screen=done]');
      ok(JSON.stringify(seen) === JSON.stringify(LEC1), '고른 순서 ' + seen.join(',') + ' / ' + LEC1.join(','));
      ok(xps.every(x => x === '+10 XP'), xps.join(','));
      ok((await txt(lp, 'h2')) === '01강 연습 끝!' && (await txt(lp, '#no-more')).includes('다 풀었어요'), await txt(lp, '.content'));
      ok(await lp.evaluate(() => window.STORE._debug().picks.length) === picks0, 'next_practice(맞춤 고르기)를 부름');
      const at = await lp.evaluate(() => window.STORE._debug().db.attempts.map(a => a.mode + ':' + a.qid + ':' + a.xp));
      ok(at.length === 3 && at.every(a => a.startsWith('PRACTICE:L01-') && a.endsWith(':10')), at.join(','));
      await lp.click('[data-screen=done] [data-act=lecture]'); await lp.waitForSelector('[data-screen=lecture] #lec-body');
      await lp.click('[data-act=lecture-practice]'); await lp.waitForSelector('#lec-msg');
      ok((await txt(lp, '#lec-msg')).includes('이미 다 풀었어요') && await scr(lp) === 'lecture', await txt(lp, '#lec-msg'));
      ok(lp._errors.length === 0, lp._errors.join(' | '));
      return seen.join(' → ');
    });
    await test('L-14', '휴대폰 360·390px: 강 페이지 가로로 넘치지 않음 · 본문 글자 17px 이상 · 표는 상자 안에서만 밀기 · 버튼 손가락 크기(44px 이상)', async () => {
      const out = [];
      for (const w of [360, 390]) {
        await lp.setViewportSize({ width: w, height: 780 });
        await lp.click('[data-act=lectures]').catch(() => {}); await lp.waitForSelector('#lec-list');
        await lp.click('.lec-row[data-n="1"]'); await lp.waitForSelector('#lec-body');
        const m = await lp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
          fs: parseFloat(getComputedStyle(document.querySelector('#lec-body p')).fontSize),
          bh: Math.min.apply(null, Array.from(document.querySelectorAll('#lec-actions .btn')).map(b => b.getBoundingClientRect().height)),
          tb: getComputedStyle(document.querySelector('.lec-table')).overflowX }));
        ok(m.sw <= m.iw && m.fs >= 17 && m.bh >= 44 && m.tb === 'auto', w + 'px ' + JSON.stringify(m));
        out.push(w + 'px 글자 ' + m.fs + 'px');
        await shot(lp, w + '_63_강의페이지_휴대폰');
        await lp.click('#lec-actions [data-act=home]'); await lp.waitForSelector('[data-screen=home]');
      }
      await lp.setViewportSize({ width: 360, height: 780 });
      await lp.click('[data-act=lectures]'); await lp.waitForSelector('#lec-list');
      ok(await lp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '목록이 넘침');
      await shot(lp, '360_64_강의목록');
      return out.join(' · ');
    });
    await L.ctx.close();

    const cfg = fs.readFileSync(path.join(PUBLIC, 'js/config.js'), 'utf8').replace(/OPEN_UP_TO_LECTURE:\s*\d+/, 'OPEN_UP_TO_LECTURE: 2');
    const L2 = await newPage({ viewport: { width: 390, height: 844 }, localDb: LOCAL_DB(false), lecturesJs: B.jsText, config: cfg }); const l2 = L2.page;
    await test('L-15', '열린 강 2강까지(open_up_to): 목록 2줄 + "03강부터는 교수님이 열면" · 5강 직접 열기 null · 진단 전이면 [이 강 연습 문제 풀기] → 진단 화면', async () => {
      await l2.goto(BASE + 'index.html'); await l2.waitForSelector('[data-screen=diag]');
      await l2.click('[data-act=diag-later]'); await l2.waitForSelector('[data-screen=home] #diag-first');
      await l2.click('[data-act=lectures]'); await l2.waitForSelector('#lec-list');
      ok(await l2.$$eval('#lec-list .lec-row', e => e.length) === 2 && (await txt(l2, '#lec-locked')).includes('03강부터는 교수님이 열면'), '잠김');
      ok(await l2.evaluate(() => window.STORE.lecture(5)) === null, '안 열린 강이 열림');
      const r = await l2.evaluate(async () => { try { await window.STORE.lecturePractice(5, []); return '통과'; } catch (e) { return e.message; } });
      ok(r.includes('아직 열리지 않았어요'), r);
      await l2.click('.lec-row[data-n="1"]'); await l2.waitForSelector('#lec-body');
      await l2.click('[data-act=lecture-practice]'); await l2.waitForSelector('[data-screen=diag]');
    });
    await L2.ctx.close();
    const L3 = await newPage({ viewport: { width: 390, height: 844 }, localDb: LOCAL_DB(true), lecturesJs: null }); const l3 = L3.page;
    await test('L-16', 'data/lectures.js 가 없어도(아직 안 만듦) 목록은 30줄 모두 "준비 중", 오류 없음', async () => {
      await l3.goto(BASE + 'index.html'); await l3.waitForSelector('[data-screen=home]');
      await l3.click('[data-act=lectures]'); await l3.waitForSelector('#lec-list');
      ok(await l3.$$eval('#lec-list .lec-row.soon', e => e.length) === 30 && !(await l3.$('#err')) && l3._errors.length === 0, '준비 중');
    });
    await L3.ctx.close();

    console.log('■ Supabase 모드(가짜 서버) — 세션 복구 (캡틴 체험판 오류: student_devices foreign key)');
    const MOCK_BASE = { practice: PRACTICE, diag: DIAG, reviewedHints: {}, codes: ['TEST23', 'TEST45'] };
    const GONE = { mock_session: { uid: 'anon-gone-1', access_token: 'fake' }, mock_gone_users: ['anon-gone-1'] };
    async function loginCase(id, name, mockExtra, preLs, check) {
      const { ctx, page } = await newPage({ mock: Object.assign({}, MOCK_BASE, mockExtra), preLs });
      await test(id, name, async () => {
        await page.goto(BASE + 'index.html?mode=supabase'); await page.waitForSelector('[data-screen=login]');
        await clearLog(page);
        await page.fill('#code', 'TEST23'); await page.click('[data-act=login]');
        await page.waitForSelector('[data-screen=nickname], #code-error');
        const l = await logOf(page);
        return check(page, l);
      });
      await ctx.close();
    }
    const sum = l => l.filter(x => ['getUser', 'signOut', 'signInAnonymously'].includes(x.t) || x.t === 'rpc').map(x => x.t === 'rpc' ? x.name : x.t + (x.scope ? '(' + x.scope + ')' : '')).join(' → ');
    await loginCase('L-20', '[버그 재현→고침] 브라우저에 지워진 계정의 로그인이 남음 → getUser 403 → 이 기기 로그인만 지우고 새 임시 계정 → claim_code 1번에 성공(별명 화면). 오류 글 없음',
      {}, GONE, async (page, l) => {
        ok(await scr(page) === 'nickname', '화면 ' + await scr(page) + ' ' + (await page.textContent('#app')).slice(0, 200));
        ok(sum(l) === 'getUser → signOut(local) → signInAnonymously → claim_code', sum(l));
        ok(rpcs(l)[0].args.p_code === 'TEST23', '코드');
        await shot(page, '390_65_세션복구_별명');
        return sum(l);
      });
    await loginCase('L-21', 'getUser 는 통과했는데 claim_code 가 FK 오류(23503, 80번 SQL 적용 전 서버) → 새 임시 계정으로 딱 한 번 다시 시도 → 성공',
      {}, Object.assign({ mock_gone_after_get: true }, GONE), async (page, l) => {
        ok(await scr(page) === 'nickname', await scr(page));
        ok(sum(l) === 'getUser → claim_code → signOut(local) → signInAnonymously → claim_code', sum(l));
        return sum(l);
      });
    await loginCase('L-22', '80번 SQL 적용 후 서버: claim_code 가 {ok:false, error:NO_AUTH} → 새 임시 계정으로 한 번 다시 → 성공',
      { fix80: true }, Object.assign({ mock_gone_after_get: true }, GONE), async (page, l) => {
        ok(await scr(page) === 'nickname', await scr(page));
        ok(sum(l) === 'getUser → claim_code → signOut(local) → signInAnonymously → claim_code', sum(l));
        return sum(l);
      });
    await loginCase('L-23', '새 계정으로도 또 막히면 더 돌지 않음(claim_code 최대 2번) → 쉬운 안내 한 줄(영어 오류 글·foreign key 없음)',
      {}, Object.assign({ mock_gone_all: true, mock_gone_after_get: true }, GONE), async (page, l) => {
        const m = await txt(page, '#code-error');
        ok(m.includes('로그인 정보를 새로 만들었는데도') && !/foreign|violates|student_devices/i.test(m), m);
        ok(rpcs(l).filter(x => x.name === 'claim_code').length === 2 && l.filter(x => x.t === 'signInAnonymously').length === 1, sum(l));
        await shot(page, '390_66_세션복구_실패안내');
        return m;
      });
    await loginCase('L-24', '멀쩡한 로그인(계정 있음): getUser 만 확인하고 그대로 씀 — 로그아웃·새 계정 0 (예전 S-05 와 같음)',
      {}, { mock_session: { uid: 'anon-alive-1', access_token: 'fake' } }, async (page, l) => {
        ok(await scr(page) === 'nickname' && sum(l) === 'getUser → claim_code', sum(l));
      });
    await loginCase('L-25', 'getUser 가 인터넷 오류면 멀쩡한 로그인을 지우지 않음(로그아웃·새 계정 0) → claim_code 그대로',
      {}, { mock_session: { uid: 'anon-alive-2', access_token: 'fake' }, mock_getuser_fail: true }, async (page, l) => {
        ok(await scr(page) === 'nickname' && sum(l) === 'getUser → claim_code', sum(l));
      });
    await loginCase('L-26', '세션이 없으면(처음 온 기기) 예전처럼 새 임시 계정 1번 → claim_code (getUser 안 물음)',
      {}, null, async (page, l) => {
        ok(await scr(page) === 'nickname' && sum(l) === 'signInAnonymously → claim_code', sum(l));
      });
    {
      const { ctx, page } = await newPage({ mock: MOCK_BASE });
      await test('L-27', '다른 곳에서 FK 오류 글이 와도 화면에는 쉬운 말(영어 오류 원문 없음) · 화면을 열기만 해서는 getUser·새 계정 0', async () => {
        await page.goto(BASE + 'index.html?mode=supabase'); await page.waitForSelector('[data-screen=login]');
        const l = await logOf(page);
        ok(!l.some(x => x.t === 'getUser' || x.t === 'signInAnonymously'), JSON.stringify(l.map(x => x.t)));
        const m = await page.evaluate(() => window.STORE.explainError({ code: '23503', message: 'insert or update on table "student_devices" violates foreign key constraint "student_devices_auth_uid_fkey"' }));
        ok(m.includes('로그인 정보가 오래됐어요') && !/foreign/i.test(m), m);
        return m;
      });
      await ctx.close();
    }

    console.log('■ Supabase 모드(가짜 서버) — 강의 보기');
    const SLECS = FAKE_LECS.map(x => Object.assign({}, x, { status: x.lecture === 5 ? 'draft' : 'reviewed' }));
    SLECS.push({ lecture: 3, title: '가짜 위험 글 <img src=x onerror=window.__pwned=1>', minutes: 3, status: 'reviewed',
                 body_json: [{ t: 'p', text: [['<script>window.__pwned=2</script>', 0], ['<b onclick=x>굵게?</b>', 1]] }, { t: 'html', html: '<img src=x onerror=window.__pwned=3>' }, { t: 'h', lv: 9, text: '문자열 제목' }] });
    const S = await newPage({ mock: Object.assign({}, MOCK_BASE, { lectures: SLECS, openUpTo: 20 }),
      preLs: { mock_db: { students: { TEST23: { code: 'TEST23', nickname: '하늘별', xp: 0, diag_done: true } }, devices: {}, tries: {}, attempts: [], diag: {} } } });
    const sp = S.page;
    await test('L-30', '목록: 열린 강 = app_settings.open_up_to(20) → 20줄 + "21강부터" · 검토 끝난 강(01·02·03)만 제목, 검토 전 05강은 "준비 중" · 목록은 제목·시간만 받음(status·본문 안 읽음)', async () => {
      await sp.goto(BASE + 'index.html?mode=supabase'); await sp.waitForSelector('[data-screen=login]');
      await sp.fill('#code', 'TEST23'); await sp.click('[data-act=login]'); await sp.waitForSelector('[data-screen=home]');
      await clearLog(sp);
      await sp.click('[data-act=lectures]'); await sp.waitForSelector('#lec-list');
      const rows = await sp.$$eval('#lec-list .lec-row', e => e.map(x => x.tagName + ':' + x.dataset.n));
      ok(rows.length === 20 && (await txt(sp, '#lec-locked')).includes('21강부터'), rows.length + '');
      ok(JSON.stringify(rows.filter(r => r.startsWith('BUTTON'))) === JSON.stringify(['BUTTON:1', 'BUTTON:2', 'BUTTON:3']), rows.join(','));
      const f = (await logOf(sp)).filter(x => x.t === 'from');
      ok(f.some(x => x.table === 'lectures' && x.cols === 'lecture,title,minutes') && f.some(x => x.table === 'app_settings' && x.cols === 'open_up_to'), JSON.stringify(f));
      ok(!(await sp.textContent('#lec-list')).includes('검토 전'), '서버 모드에 개발용 표시');
    });
    await test('L-31', '위험한 글이 서버에 들어 있어도(태그·모르는 덩어리) 글자로만 보임: 실행 0 · img/script 요소 0 · 모르는 덩어리(html)는 버림', async () => {
      await sp.click('.lec-row[data-n="3"]'); await sp.waitForSelector('#lec-body');
      ok(await sp.evaluate(() => window.__pwned === undefined), '스크립트 실행됨');
      ok(await sp.$eval('#lecture', e => e.querySelectorAll('img,script,a,iframe').length === 0), '위험 요소');
      ok((await txt(sp, '#lec-title')).includes('<img src=x') && (await txt(sp, '#lec-body')).includes('<script>window.__pwned=2</script>'), '글자 그대로 아님');
      ok(await sp.$eval('#lec-body', e => e.querySelector('p b').textContent === '<b onclick=x>굵게?</b>' && e.querySelector('h3').textContent === '문자열 제목' && e.children.length === 2), '덩어리');
      await sp.waitForTimeout(200); ok(await sp.evaluate(() => window.__pwned === undefined), '늦게 실행됨');
    });
    await test('L-32', '01강 페이지 → [이 강 연습 문제 풀기]: 강 본문은 eq(lecture,1)로 · 내 풀이 기록(attempts)으로 안 푼 문항 → close_item(PRACTICE) +10 XP · next_practice 부르지 않음', async () => {
      await sp.click('[data-act=lectures]'); await sp.waitForSelector('#lec-list');
      await clearLog(sp);
      await sp.click('.lec-row[data-n="1"]'); await sp.waitForSelector('#lec-body');
      ok((await txt(sp, '#lec-title')) === '가짜 강의 하나: AI의 출발' && !(await sp.$('#lec-draft')), '제목');
      await sp.click('[data-act=lecture-practice]');
      const a = await solveRight(sp, QBY);
      ok(a === LEC1[0] && (await txt(sp, '#xp-gain')) === '+10 XP', a + ' ' + await txt(sp, '#xp-gain'));
      await sp.click('[data-act=next]'); const b = await solveRight(sp, QBY); ok(b === LEC1[1], b);
      const l = await logOf(sp);
      ok(l.some(x => x.t === 'from' && x.table === 'lectures' && x.cols === 'lecture,title,minutes,body_json' && JSON.stringify(x.eq) === '[["lecture",1]]'), '본문 읽기');
      ok(l.some(x => x.t === 'from' && x.table === 'attempts' && x.cols === 'question_id'), '풀이 기록 읽기');
      const r = rpcs(l).map(x => x.name);
      ok(!r.includes('next_practice') && r.filter(x => x === 'close_item').length === 2, r.join(','));
      ok(rpcs(l).filter(x => x.name === 'close_item').every(x => x.args.p_mode === 'PRACTICE'), 'PRACTICE');
      ok(sp._errors.length === 0, sp._errors.join(' | '));
      await shot(sp, '390_67_강의연습_Supabase모드');
      return r.join(' → ');
    });
    await test('L-33', '목록에 없는(검토 전) 05강·안 열린 25강은 STORE.lecture → null (본문 요청도 안 함)', async () => {
      await clearLog(sp);
      ok(await sp.evaluate(() => window.STORE.lecture(5)) === null && await sp.evaluate(() => window.STORE.lecture(25)) === null, 'null 아님');
      ok(!(await logOf(sp)).some(x => x.t === 'from' && x.table === 'lectures' && x.cols.includes('body_json')), '본문 요청함');
    });
    await S.ctx.close();
    {
      const { ctx, page } = await newPage({ mock: MOCK_BASE,
        preLs: { mock_db: { students: { TEST23: { code: 'TEST23', nickname: '하늘별', xp: 0, diag_done: true } }, devices: {}, tries: {}, attempts: [], diag: {} } } });
      await test('L-34', '서버에 lectures 표가 아직 없음(80번 SQL 적용 전): 목록 30줄 모두 "준비 중", 오류 글 없음', async () => {
        await page.goto(BASE + 'index.html?mode=supabase'); await page.waitForSelector('[data-screen=login]');
        await page.fill('#code', 'TEST23'); await page.click('[data-act=login]'); await page.waitForSelector('[data-screen=home]');
        await page.click('[data-act=lectures]'); await page.waitForSelector('#lec-list');
        ok(await page.$$eval('#lec-list .lec-row.soon', e => e.length) === 30 && !(await page.$('#err')), '준비 중');
      });
      await ctx.close();
    }

    console.log('■ 진짜 라이브러리(vendor) + 가짜 HTTP — 지워진 계정 복구');
    await test('L-35', '진짜 supabase-js: 남은 로그인 → GET /auth/v1/user 403(user_not_found) → 로그아웃(이 기기) → POST /auth/v1/signup(새 임시 계정) → claim_code 는 새 토큰으로 1번', async () => {
      const ctx2 = await browser.newContext();
      const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const mk = sub => b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, is_anonymous: true, session_id: 's-' + sub.slice(-1) }) + '.fakesig';
      const OLD = '00000000-0000-4000-8000-00000000000a', NEW = '00000000-0000-4000-8000-00000000000b';
      const oldJwt = mk(OLD), newJwt = mk(NEW);
      const user = id => ({ id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
      await ctx2.addInitScript(([tok, u]) => {
        if (!localStorage.getItem('lu2_sb_auth')) localStorage.setItem('lu2_sb_auth', JSON.stringify({ access_token: tok, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'old-refresh', user: u }));
      }, [oldJwt, user(OLD)]);
      const seen = [];
      await ctx2.route(/supabase\.co/, async r => {
        const req = r.request(), u = new URL(req.url()), auth = req.headers()['authorization'] || '';
        const who = auth.includes(newJwt) ? 'new' : auth.includes(oldJwt) ? 'old' : 'anon';
        if (req.method() !== 'OPTIONS') seen.push(req.method() + ' ' + u.pathname + ' ' + who);
        const json = (o, st) => r.fulfill({ status: st || 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
        if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
        if (u.pathname === '/auth/v1/user') return who === 'new' ? json(user(NEW)) : json({ code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }, 403);
        if (u.pathname === '/auth/v1/logout') return json({ code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }, 403);
        if (u.pathname === '/auth/v1/signup') return json({ access_token: newJwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'new-refresh', user: user(NEW) });
        if (u.pathname === '/auth/v1/token') return json({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, 400);
        if (u.pathname === '/rest/v1/rpc/claim_code') return who === 'new'
          ? json({ ok: true, student: { code: 'TEST23', nickname: '', xp: 0, diagDone: false, diagAnswered: 0 } })
          : json({ code: '23503', details: 'Key (auth_uid)=(' + OLD + ') is not present in table "users".', hint: null, message: 'insert or update on table "student_devices" violates foreign key constraint "student_devices_auth_uid_fkey"' }, 409);
        if (u.pathname === '/rest/v1/students') return json([]);
        if (u.pathname === '/rest/v1/diag_answers') return json([]);
        return r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not in test"}' });
      });
      const p3 = await ctx2.newPage(); const errs = []; p3.on('pageerror', e => errs.push(e.message));
      await p3.goto(BASE + 'index.html?mode=supabase'); await p3.waitForSelector('[data-screen=login]');
      await p3.fill('#code', 'TEST23'); await p3.click('[data-act=login]');
      await p3.waitForSelector('[data-screen=nickname], #code-error');
      const s = await scr(p3), err = (await p3.$('#code-error')) ? await txt(p3, '#code-error') : '';
      ok(s === 'nickname', '화면 ' + s + ' ' + err + ' / ' + seen.join(' | '));
      const claims = seen.filter(x => x.includes('/rpc/claim_code'));
      ok(claims.length === 1 && claims[0].endsWith(' new'), claims.join(','));
      ok(seen.some(x => x === 'GET /auth/v1/user old') && seen.some(x => x === 'POST /auth/v1/signup anon'), seen.join(' | '));
      const stored = await p3.evaluate(() => JSON.parse(localStorage.getItem('lu2_sb_auth') || 'null'));
      ok(stored && stored.access_token === newJwt, '새 로그인이 저장되지 않음');
      ok(!errs.length, errs.join(' / '));
      await ctx2.close();
      return seen.filter(x => !x.includes('/rest/v1/students') && !x.includes('/rest/v1/diag')).join(' → ');
    });

    console.log('■ 배포 폴더 · SQL 파일');
    await test('L-40', 'make_deploy.py: 배포 폴더에 data/(lectures.js 포함) 없음 · SHOW_DRAFT_LECTURES false · 자체 검사 통과', async () => {
      const out = path.join(TMP, 'deploy');
      const r = spawnSync('python3', [path.join(APP, 'tools/make_deploy.py'), out], { encoding: 'utf8' });
      ok(r.status === 0, r.stdout + r.stderr);
      ok(!fs.existsSync(path.join(out, 'data')), 'data/ 있음');
      const c = fs.readFileSync(path.join(out, 'js/config.js'), 'utf8');
      ok(/SHOW_DRAFT_LECTURES: false/.test(c) && /MODE: "supabase"/.test(c), 'config');
      return r.stdout.trim();
    });
    await test('L-41', '80번 SQL: claim_code 에 auth.users 확인 → NO_AUTH(json) · lectures 표 RLS·reviewed 읽기 규칙·칸 허용(status 제외) · 표·데이터 drop/delete/truncate 없음 · 비밀 열쇠 없음 · store.js 가 읽는 칸 = 허용 칸', async () => {
      const code = SQL80.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
      ok(/if not exists \(select 1 from auth\.users u where u\.id = auth\.uid\(\)\) then\s+return json_build_object\('ok', false, 'error', 'NO_AUTH'\);/.test(code), 'NO_AUTH');
      ok(code.indexOf("'NO_AUTH');") < code.indexOf('insert into code_attempts'), '횟수 기록보다 먼저 확인');
      ok(/alter table lectures enable row level security/.test(code) && /grant select \(lecture, title, minutes, body_json\) on lectures to authenticated/.test(code) &&
         /create policy lectures_reviewed on lectures for select to authenticated using \(status = 'reviewed'\)/.test(code), 'lectures 규칙');
      const drops = code.match(/\bdrop\b[^;]*/gi) || [];
      ok(!/\btruncate\b|\bdelete\s+from\b/i.test(code) && drops.length === 1 && drops[0].trim() === 'drop policy if exists lectures_reviewed on lectures', drops.join(' | '));
      ok(!/sk-ant-|sb_secret_|eyJhbGci/.test(SQL80), '비밀 열쇠');
      const st = fs.readFileSync(path.join(PUBLIC, 'js/store.js'), 'utf8');
      ok(st.includes('select("lecture,title,minutes")') && st.includes('select("lecture,title,minutes,body_json")') && !/from\("lectures"\)\.select\("[^"]*status/.test(st), 'store.js 칸');
    });
    await test('L-42', '임시 PostgreSQL 시험(있으면): supabase/local_test/run_session_fix_local.sh 실패 0 (고치기 전 FK 오류 재현 포함)', async () => {
      if (!fs.existsSync('/usr/lib/postgresql/16/bin/initdb') && !process.env.PG_BIN) return '건너뜀 — 이 컴퓨터에 PostgreSQL 16 없음';
      const r = spawnSync('bash', [path.join(APP, 'supabase/local_test/run_session_fix_local.sh')], { encoding: 'utf8', timeout: 180000 });
      const last = (r.stdout || '').trim().split('\n').slice(-1)[0];
      ok(r.status === 0, last + ' / ' + (r.stdout || '').split('\n').filter(x => x.startsWith('FAIL')).join(' | ') + (r.stderr || '').slice(0, 300));
      return last;
    });
  } finally {
    await browser.close(); server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_lectures_results.json'), JSON.stringify(results, null, 1));
  console.log(`\n세션 복구 · 강의 보기 테스트: 통과 ${pass} · 실패 ${fail}  ※ 가짜 서버 (실DB 미검증)`);
  process.exit(fail ? 1 : 0);
})();
