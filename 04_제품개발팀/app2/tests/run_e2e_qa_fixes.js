// 결재3 전 QA "낮음" 수정(#5~#11) 자동 테스트 (Playwright + node)
// 실행: node 04_제품개발팀/app2/tests/run_e2e_qa_fixes.js
// - 규칙(logic.js) · 로컬 모드 화면 · Supabase 모드(가짜 서버 tests/mock_supabase.js) · SQL 파일 검사 · 임시 PostgreSQL 시험(있으면)
// - 진짜 Supabase 에는 한 번도 접속하지 않습니다(실DB 미검증). 컴퓨터 안의 임시 서버(127.0.0.1)만 씁니다.
// - 결과: tests/e2e_qa_fixes_results.json, 스크린샷 screenshots/ (가짜 학생만)
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const load = require('./load_practice');
const LU = require('../public/js/logic.js');

const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const SHOTS = path.join(APP, 'screenshots');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock_supabase.js'), 'utf8');
const SQL70 = fs.readFileSync(path.join(APP, 'supabase/70_qa_fixes.sql'), 'utf8');
const STORE_SRC = fs.readFileSync(path.join(PUBLIC, 'js/store.js'), 'utf8');
const PRACTICE = load('practice.js', 'LU_PRACTICE');
const DIAGQ = load('diagnostic.js', 'LU_DIAG');
const DKEY = load('dev_diag_key.js', 'LU_DEV_DIAG_KEY');
const DIAG = DIAGQ.map(q => Object.assign({}, q, DKEY[q.id]));
const PORT = 10700 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/`;
fs.mkdirSync(SHOTS, { recursive: true });

const MCQ = PRACTICE.filter(q => q.type === 'mcq');
const OX = PRACTICE.filter(q => q.type === 'ox');
const WITEMS = MCQ.slice(10, 18).map((q, i) => ({ id: 'W3-Q' + (i + 1), lecture: q.lecture, type: 'mcq', question: '[가짜 점검] ' + q.question, choices: q.choices, answer_index: q.answer_index }));
const TEAM = { name: '3팀', goalPerMember: 15, mates: [{ nickname: '바다', count: 15 }], achievedOthers: [] };
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
  page._errors = [];
  page.on('pageerror', e => page._errors.push(e.message));
  return { ctx, page };
}
const settled = '.screen:not([data-screen=loading])';
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
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
// 한국 날짜 기준 오늘부터 다음 일요일까지 며칠 (오늘이 일요일이면 0)
function daysToSunday() { const d = new Date(Date.now() + 9 * 3600e3); return (7 - d.getUTCDay()) % 7; }

(async () => {
  console.log('■ 규칙 (logic.js = 서버 70_qa_fixes.sql) · SQL 파일');
  await test('F-01', '별명 검사: 빈칸 정리 · 2~12글자 · 전화번호(일부)·이메일·숫자 7개 이상 거절 · "별빛2027"은 통과 (SQL 시험 Q-10~Q-20 과 같은 예)', async () => {
    const cases = [['   가  ', 'NICK_LENGTH'], ['      ', 'NICK_LENGTH'], ['가나다라마바사아자차카타파', 'NICK_LENGTH'], ['홍길동 010-1234', 'NICK_PRIVATE'],
      ['01012345678', 'NICK_PRIVATE'], ['010.1234.567', 'NICK_PRIVATE'], ['a@b.co', 'NICK_PRIVATE'], ['학번20231234', 'NICK_PRIVATE'], ['별빛2027', null], ['하늘별', null]];
    for (const [v, want] of cases) ok(LU.checkNickname(v) === want, JSON.stringify(v) + ' → ' + LU.checkNickname(v));
    ok(LU.cleanNickname('  하늘 \t  별  ') === '하늘 별', '정리: ' + JSON.stringify(LU.cleanNickname('  하늘 \t  별  ')));
    return cases.length + '가지';
  });
  await test('F-02', '같은 규칙이 SQL 에도: 이메일·전화번호 정규식 + 숫자 7개 이상 + 2~12글자 / 화면 안내 글(NOT_OPEN)이 Edge Function 글과 같음', async () => {
    ok(SQL70.includes("v ~ '[^[:space:]@]+@[^[:space:]@]+\\.[A-Za-z]{2,}'") && SQL70.includes("v ~ '01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}'") &&
       SQL70.includes("regexp_replace(v, '[-. ]', '', 'g') ~ '[0-9]{7,}'") && SQL70.includes('char_length(v) < 2 or char_length(v) > 12'), 'SQL 규칙');
    const G = await import('../supabase/functions/ai-tutor/guard.mjs');
    const m = /NOT_OPEN: "([^"]+)"/.exec(STORE_SRC);
    ok(m && G.MESSAGES.NOT_OPEN === m[1], '화면 ' + (m && m[1]) + ' / 서버 ' + G.MESSAGES.NOT_OPEN);
  });
  await test('F-03', '일요일 판정: 그 주(월~일) 마지막 날만 true', async () => {
    ok(LU.isWeekLastDay('2026-11-08') && !LU.isWeekLastDay('2026-11-09') && !LU.isWeekLastDay('2026-11-07') && LU.isWeekLastDay('2027-03-07'), '판정');
  });
  await test('F-04', '70번 SQL: 표·데이터 drop·truncate 없음(규칙 다시 만들기 1줄만) · delete 는 원래 close_item 의 복습 졸업 1줄뿐 · 비밀 열쇠 없음 · questions 칸 허용 = store.js 가 읽는 칸 + pool · b·n_resp·week 는 허용 안 함', async () => {
    const code = SQL70.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
    const dels = code.match(/\bdelete\s+from\s+[^;]+/gi) || [];
    const drops = code.match(/\bdrop\b[^;]*/gi) || [];
    ok(!/\btruncate\b/i.test(code) && drops.length === 1 && drops[0].trim() === 'drop policy if exists cards_reviewed on concept_cards', 'drop·truncate 문장(다시 실행용 규칙 지우고 만들기 1줄만 허용): ' + drops.join(' | '));
    ok(dels.length === 1 && /^delete from review_box where student_id = me\.id and question_id = q\.id$/.test(dels[0].trim()), '지우기 문장(원래 close_item 의 복습 졸업 1줄만 허용): ' + dels.join(' | '));
    ok(!/sk-ant-|sb_secret_|eyJhbGci/.test(SQL70), '비밀 열쇠');
    const g = /grant select \(([^)]+)\) on questions to authenticated/.exec(code); ok(g, '칸 허용 줄 없음');
    const cols = g[1].split(',').map(s => s.trim()).sort();
    const q = /var QCOLS = "([^"]+)"/.exec(STORE_SRC)[1].split(',').concat(['diag_order', 'pool']).sort();
    ok(JSON.stringify(cols) === JSON.stringify(q), cols.join() + ' / ' + q.join());
    ok(!cols.includes('b') && !cols.includes('n_resp') && !cols.includes('week'), '숨길 칸');
    return cols.length + '칸';
  });

  const CARDS_SRC = JSON.parse(fs.readFileSync(path.resolve(APP, '../../03_교육기획팀/문항은행/concept_cards.json'), 'utf8'));
  await test('F-15', '개념 카드: 로컬 파일 concepts.js = 원본의 검토 끝난 카드(강 번호·제목·3줄) · seed.json "cards" = 원본 30장 · 70번 SQL 에 표·RLS·reviewed 읽기 규칙', async () => {
    const C = load('concepts.js', 'LU_CONCEPTS').cards;
    const rev = CARDS_SRC.filter(c => c.status === 'reviewed');
    ok(Object.keys(C).length === rev.length && rev.every(c => JSON.stringify(C[String(c.lecture)]) === JSON.stringify({ title: c.title, lines: c.lines })), 'concepts.js 내용');
    const seed = JSON.parse(fs.readFileSync(path.join(APP, 'supabase/seed/seed.json'), 'utf8'));
    ok(Array.isArray(seed.cards) && seed.cards.length === CARDS_SRC.length && seed.cards.every((c, i) => c.lecture === CARDS_SRC[i].lecture && JSON.stringify(c.lines) === JSON.stringify(CARDS_SRC[i].lines) && c.status === CARDS_SRC[i].status), 'seed cards');
    ok(/create table if not exists concept_cards/.test(SQL70) && /alter table concept_cards enable row level security/.test(SQL70) &&
       /grant select \(lecture, title, lines\) on concept_cards to authenticated/.test(SQL70) && /using \(status = 'reviewed'\)/.test(SQL70), 'SQL');
    return '카드 ' + Object.keys(C).length + '장';
  });

  const server = await startServer(PUBLIC, PORT);
  browser = await chromium.launch();
  try {
    console.log('■ 로컬 모드 — 별명 · 진단 먼저 · 일요일 안내 · 다시 마감');
    const L = await newPage({ viewport: { width: 360, height: 780 } }); const lp = L.page;
    await test('F-05', '별명 "홍길동 010-1234" → 칸 아래 안내(서버와 같은 말), 저장 안 됨 · "  하늘   별 " → "하늘 별"로 저장', async () => {
      await lp.goto(BASE + 'index.html'); await lp.waitForSelector('#app ' + settled);
      await lp.fill('#code', 'TEST23'); await lp.click('[data-act=login]');
      await lp.waitForSelector('[data-screen=nickname]');
      ok((await txt(lp, '.note')).includes('숫자 7개 이상'), '안내 글');
      await lp.fill('#nick', '홍길동 010-1234'); await lp.click('[data-act=save-nick]');
      await lp.waitForSelector('[data-screen=nickname] .field.err');
      const t = await txt(lp, '[data-screen=nickname]');
      ok(t.includes('전화번호·이메일·학번처럼 보이는 글은 별명에 쓸 수 없어요'), t);
      ok(!(await lp.evaluate(() => window.STORE._debug().me.nickname)), '저장됨');
      await shot(lp, '360_50_별명_전화번호거절');
      await lp.fill('#nick', '  하늘   별 '); await lp.click('[data-act=save-nick]');
      await lp.waitForSelector('[data-screen=diag]');
      const nick = await lp.evaluate(() => window.STORE._debug().me.nickname);
      ok(nick === '하늘 별', nick);
      const r = await lp.evaluate(async () => { try { await window.STORE.setNickname('a@b.co'); return '통과됨'; } catch (e) { return e.message; } });
      ok(r.includes('별명에 쓸 수 없어요'), '창구 직접: ' + r);
    });
    await test('F-06', '진단 1문항 뒤 홈: 공통 점검 카드 "진단을 10문항 이상 마치면…"(시작 버튼 없음) · 해설 당번 카드 닫힘 · 창구로 불러도 NEED_DIAG · 진단 보기 99 → 거절', async () => {
      await lp.click('[data-act=diag-unknown]');
      await lp.waitForFunction(() => document.querySelector('#count') && /진단 2/.test(document.querySelector('#count').textContent));
      await lp.click('[data-act=diag-later]'); await lp.waitForSelector('[data-screen=home]');
      ok(await lp.$('#diag-first'), '진단 먼저 안내');
      ok(await lp.getAttribute('#weekly-card', 'data-state') === 'closed', '점검 카드 상태');
      ok((await txt(lp, '#weekly-status')).includes('진단을 10문항 이상 마치면 공통 점검이 열려요'), await txt(lp, '#weekly-status'));
      ok(!(await lp.$('[data-act=weekly-start]')), '시작 버튼이 있음');
      ok(await lp.getAttribute('#expl-card', 'data-state') === 'need-diag', '당번 카드 ' + await lp.getAttribute('#expl-card', 'data-state'));
      ok(!(await lp.$('#expl-q')) && !(await lp.$('[data-act=expl-edit]')), '당번 문항·쓰기 버튼');
      await shot(lp, '360_51_진단전_홈_점검당번닫힘');
      const r = await lp.evaluate(async () => {
        const out = [];
        for (const f of [() => window.STORE.weeklyItems(), () => window.STORE.submitWeekly({}), () => window.STORE.writeExplainer('x', '열 글자가 넘는 해설이에요 정말로')]) {
          try { await f(); out.push('통과됨'); } catch (e) { out.push(e.message); }
        }
        const q = window.LU_DIAG.questions[3].id;
        try { await window.STORE.answerDiagnostic(q, 99); out.push('통과됨'); } catch (e) { out.push(e.message); }
        return out;
      });
      ok(r.slice(0, 3).every(m => m.includes('진단을 10문항 이상')), r.join(' | '));
      ok(r[3].includes('고른 보기가 서버 규칙과 맞지 않아'), r[3]);
    });
    await test('F-07', '진단을 마치면 공통 점검 열림 · 해설 당번 카드 열림', async () => {
      await lp.click('[data-act=diag-resume]'); await lp.waitForSelector('[data-screen=diag]');
      for (let i = 0; i < 11; i++) {
        const id = await lp.getAttribute('#qid', 'data-id');
        await lp.click('[data-act=diag-unknown]');
        if (i < 10) await lp.waitForFunction(p => document.querySelector('#qid') && document.querySelector('#qid').dataset.id !== p, id);
      }
      await lp.waitForSelector('[data-screen=diagResult]'); await lp.click('[data-act=home]');
      await lp.waitForSelector('#weekly-card');
      ok(await lp.getAttribute('#weekly-card', 'data-state') === 'open' && await lp.$('[data-act=weekly-start]'), '점검 열림');
      ok(await lp.getAttribute('#expl-card', 'data-state') !== 'need-diag', '당번 카드');
    });
    await test('F-08', '일요일(개발용 날짜)에 점검 시작 → "월요일 새벽 3시 전까지 제출" 안내 · 월요일에는 안내 없음', async () => {
      const off = daysToSunday();
      await lp.evaluate(n => localStorage.setItem('lu2_dev_day_offset', String(n)), off);
      await lp.reload(); await lp.waitForSelector('[data-act=weekly-start]');
      await lp.click('[data-act=weekly-start]'); await lp.waitForSelector('[data-screen=weekly]');
      ok(await lp.$('#weekly-sunday'), '일요일 안내 없음');
      ok((await txt(lp, '#weekly-sunday')).includes('월요일 새벽 3시 전까지 제출'), await txt(lp, '#weekly-sunday'));
      await shot(lp, '360_52_공통점검_일요일안내');
      await lp.click('[data-act=weekly-later]'); await lp.waitForSelector('[data-screen=home]');
      await lp.evaluate(n => localStorage.setItem('lu2_dev_day_offset', String(n)), off + 1);
      await lp.reload(); await lp.waitForSelector('[data-act=weekly-start]');
      await lp.click('[data-act=weekly-start]'); await lp.waitForSelector('[data-screen=weekly]');
      ok(!(await lp.$('#weekly-sunday')), '월요일에도 안내');
      await lp.click('[data-act=weekly-later]'); await lp.waitForSelector('[data-screen=home]');
      await lp.evaluate(() => localStorage.removeItem('lu2_dev_day_offset'));
      return '일요일까지 +' + off + '일';
    });
    await test('F-09', '로컬 창구: 같은 문항을 다시 마감하면 XP 0 · θ 그대로 (서버 70번 close_item 과 같음)', async () => {
      const r = await lp.evaluate(async () => {
        const q = window.LU_PRACTICE.questions.find(x => x.type === 'mcq' && x.lecture === 2);
        const a = await window.STORE.closeItem({ qid: q.id, mode: 'PRACTICE', outcome: '혼자 맞힘', level: 0, submits: [q.answer_index] });
        const t1 = window.STORE._debug().me.theta, n1 = window.STORE._debug().me.n;
        const w = (q.answer_index + 1) % 4;
        const b = await window.STORE.closeItem({ qid: q.id, mode: 'PRACTICE', outcome: '정답 보고 이해', level: 4, submits: [w] });
        const d = window.STORE._debug().me;
        return { a: a.xp, b: b.xp, same: d.theta === t1 && d.n === n1 };
      });
      ok(r.a === 10 && r.b === 0 && r.same, JSON.stringify(r));
    });
    ok(L.page._errors.length === 0, 'JS 오류: ' + L.page._errors.join(' | '));
    await L.ctx.close();

    console.log('■ Supabase 모드(가짜 서버) — O/X 안내 · 자정 넘김 · 진단 먼저 · 오류 문장');
    const OXH = {}; OXH[OX[0].id] = { l1: '힌트1', l2: '힌트2', l3: '힌트3' };
    await test('F-10', 'O/X 문제(검토 끝난 힌트 있음): 답 내기 전 "힌트 3단계까지 보고도 막히면 AI 튜터…" 안내 한 줄 / 힌트 없는 O/X 는 안내 없음', async () => {
      const M = await newPage({ mock: { practice: OX, diag: DIAG, codes: ['TEST23'], reviewedHints: OXH, tutor: { enabled: true, used: 0 } }, preDb: PRE_DB });
      const mp = M.page;
      await mp.goto(BASE + 'index.html?mode=supabase'); await mp.waitForSelector(settled);
      await mp.fill('#code', 'TEST23'); await mp.click('[data-act=login]'); await mp.waitForSelector('[data-screen=home]');
      await mp.click('[data-act=start]'); await mp.waitForSelector('[data-screen=item] .choice');
      ok((await mp.getAttribute('#qid', 'data-id')) === OX[0].id, '첫 문항');
      ok(await mp.$('#tutor-pre'), '안내 없음');
      ok((await txt(mp, '#tutor-pre')).includes('힌트 3단계까지 보고도 막히면 AI 튜터에게 물어볼 수 있어요'), await txt(mp, '#tutor-pre'));
      await shot(mp, '390_53_OX_AI튜터_안내');
      await M.ctx.close();
      const N = await newPage({ mock: { practice: OX, diag: DIAG, codes: ['TEST23'], reviewedHints: {}, tutor: { enabled: true, used: 0 } }, preDb: PRE_DB });
      const np = N.page;
      await np.goto(BASE + 'index.html?mode=supabase'); await np.waitForSelector(settled);
      await np.fill('#code', 'TEST23'); await np.click('[data-act=login]'); await np.waitForSelector('[data-screen=home]');
      await np.click('[data-act=start]'); await np.waitForSelector('[data-screen=item] .choice');
      ok(!(await np.$('#tutor-pre')), '힌트 없는 O/X 에 안내가 나옴(한 번 틀리면 끝나 튜터가 열리지 않음)');
      await N.ctx.close();
    });
    const WDATA = { practice: PRACTICE, diag: DIAG, codes: ['TEST23', 'TEST45'], reviewedHints: {}, team: TEAM,
      weekly: { week: 3, reason: null, cohortStart: '2027-03-01', items: WITEMS, teamActive: 2, teamTaken: 0 },
      explainer: { duty: 'me', item: null, body: null } };
    await test('F-11', '점검 8문항을 풀고 제출했는데 서버가 WEEK_CHANGED(자정 지남) → 홈으로 + "고른 답은 제출되지 않았어요 · 이번 주 점검을 새로 시작" 안내 · 시작 버튼 다시 보임', async () => {
      const M = await newPage({ mock: WDATA, preDb: PRE_DB }); const mp = M.page;
      await mp.goto(BASE + 'index.html?mode=supabase'); await mp.waitForSelector(settled);
      await mp.fill('#code', 'TEST23'); await mp.click('[data-act=login]'); await mp.waitForSelector('[data-act=weekly-start]');
      await mp.click('[data-act=weekly-start]'); await mp.waitForSelector('[data-screen=weekly]');
      for (let i = 0; i < 8; i++) {
        await mp.waitForFunction(n => document.querySelector('#count').textContent.startsWith('공통 점검 ' + n + ' /'), i + 1);
        if (i === 7) await mp.evaluate(() => localStorage.setItem('mock_fail', JSON.stringify({ weekly_check_submit: 'WEEK_CHANGED' })));
        await mp.click('[data-act=weekly-unknown]');
      }
      await mp.waitForSelector('[data-screen=home] #err');
      const e = await txt(mp, '#err');
      ok(e.includes('지난주 공통 점검이 닫혔어요') && e.includes('이번 주 점검을 새로 시작'), e);
      ok(await mp.$('[data-act=weekly-start]'), '시작 버튼');
      await shot(mp, '390_54_공통점검_자정지남_안내');
      ok(mp._errors.length === 0, mp._errors.join(' | '));
      await M.ctx.close();
    });
    await test('F-12', '서버가 NEED_DIAG 를 보내면 점검 카드 "진단을 10문항 이상…"(시작 버튼 없음) · 오류 이름 NEED_DIAG → 쉬운 말', async () => {
      const M = await newPage({ mock: Object.assign({}, WDATA, { weekly: Object.assign({}, WDATA.weekly, { reason: 'NEED_DIAG' }) }), preDb: PRE_DB }); const mp = M.page;
      await mp.goto(BASE + 'index.html?mode=supabase'); await mp.waitForSelector(settled);
      await mp.fill('#code', 'TEST23'); await mp.click('[data-act=login]'); await mp.waitForSelector('#weekly-card');
      ok(await mp.getAttribute('#weekly-card', 'data-state') === 'closed' && (await txt(mp, '#weekly-status')).includes('진단을 10문항 이상 마치면'), await txt(mp, '#weekly-status'));
      ok(!(await mp.$('[data-act=weekly-start]')), '시작 버튼');
      const n = await mp.evaluate(() => window.STORE.explainError({ message: 'NEED_DIAG' }));
      ok(n.includes('진단을 10문항 이상'), n);
      await M.ctx.close();
    });
    await test('F-13', 'Supabase 창구: 별명은 정리해서 보냄(set_nickname p_name "하늘 별") · 서버 오류 이름 → 쉬운 말(NICK_PRIVATE·NICK_LENGTH·BAD_CHOICE·NOT_OPEN·WEEK_CHANGED)', async () => {
      const M = await newPage({ mock: WDATA }); const mp = M.page;
      await mp.goto(BASE + 'index.html?mode=supabase'); await mp.waitForSelector(settled);
      await mp.fill('#code', 'TEST45'); await mp.click('[data-act=login]'); await mp.waitForSelector('[data-screen=nickname]');
      await mp.fill('#nick', 'a@b.co'); await mp.click('[data-act=save-nick]'); await mp.waitForSelector('.field.err');
      let log = await mp.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]'));
      ok(!log.some(x => x.name === 'set_nickname'), '거절할 별명을 서버로 보냄');
      await mp.fill('#nick', '  하늘   별 '); await mp.click('[data-act=save-nick]'); await mp.waitForSelector('[data-screen=diag]');
      log = await mp.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]'));
      const call = log.filter(x => x.name === 'set_nickname');
      ok(call.length === 1 && call[0].args.p_name === '하늘 별', JSON.stringify(call));
      const m = await mp.evaluate(() => ['NICK_PRIVATE', 'NICK_LENGTH', 'BAD_CHOICE', 'NOT_OPEN', 'WEEK_CHANGED'].map(k => window.STORE.explainError({ message: k })));
      ok(!m.some(x => x.startsWith('서버에서 문제가 생겼어요')), m.join(' | '));
      await M.ctx.close();
    });

    console.log('■ 개념 정리 카드 (E4: 2문항 연속 오답 뒤 다음 문제)');
    const card = CARDS_SRC.find(c => c.lecture === MCQ[5].lecture);
    async function mockConcept(data, qid) {
      const M = await newPage({ mock: data, preDb: PRE_DB }); const mp = M.page;
      await mp.goto(BASE + 'index.html?mode=supabase'); await mp.waitForSelector(settled);
      await mp.fill('#code', 'TEST23'); await mp.click('[data-act=login]'); await mp.waitForSelector('[data-screen=home]');
      await mp.evaluate(q => localStorage.setItem('mock_next', JSON.stringify({ qid: q, conceptCard: true })), qid);
      await mp.click('[data-act=start]'); await mp.waitForSelector('[data-screen=item] #concept');
      return M;
    }
    await test('F-16', 'Supabase 모드: E4 카드 자리에 그 강 카드 — 제목 "NN강 핵심 정리" + 3줄 (concept_cards 에서 lecture·title·lines 만 읽음)', async () => {
      const M = await mockConcept({ practice: MCQ, diag: DIAG, codes: ['TEST23'], reviewedHints: {}, cards: CARDS_SRC }, MCQ[5].id); const mp = M.page;
      const nn = (card.lecture < 10 ? '0' : '') + card.lecture;
      ok((await txt(mp, '#concept-title')) === nn + '강 핵심 정리', await txt(mp, '#concept-title'));
      const lines = await mp.$$eval('#concept .concept-lines li', e => e.map(x => x.textContent));
      ok(JSON.stringify(lines) === JSON.stringify(card.lines), lines.join(' / '));
      const log = await mp.evaluate(() => JSON.parse(localStorage.getItem('mock_log') || '[]'));
      const f = log.filter(x => x.t === 'from' && x.table === 'concept_cards');
      ok(f.length === 1 && f[0].cols === 'lecture,title,lines', JSON.stringify(f));
      await shot(mp, '390_55_개념정리카드');
      ok(mp._errors.length === 0, mp._errors.join(' | '));
      await M.ctx.close();
      return nn + '강';
    });
    await test('F-17', '카드가 없으면 예전처럼(강 이름 한 줄): 그 강 카드가 검토 전 / 서버에 표가 아직 없음(70번 적용 전) — 오류 띠 없음', async () => {
      const draft = CARDS_SRC.map(c => c.lecture === card.lecture ? Object.assign({}, c, { status: 'draft' }) : c);
      for (const d of [{ cards: draft }, {}]) {
        const M = await mockConcept(Object.assign({ practice: MCQ, diag: DIAG, codes: ['TEST23'], reviewedHints: {} }, d), MCQ[5].id); const mp = M.page;
        const t = await txt(mp, '#concept');
        ok(t.includes('이 개념을 한 번 정리하고 갈게요') && !(await mp.$('#concept-title')), t);
        ok(!(await mp.$('#err')) && mp._errors.length === 0, '오류 띠/JS 오류');
        await M.ctx.close();
      }
    });
    await test('F-18', '로컬 모드: 2문항 연속 틀림(정답 보고 이해) → 다음 문제 위에 그 강 카드 3줄', async () => {
      const L2 = await newPage(); const p2 = L2.page;
      await p2.goto(BASE + 'index.html'); await p2.waitForSelector('#app ' + settled);
      await p2.fill('#code', 'TEST23'); await p2.click('[data-act=login]');
      await p2.waitForSelector('[data-screen=nickname]'); await p2.fill('#nick', '하늘별'); await p2.click('[data-act=save-nick]');
      await p2.waitForSelector('[data-screen=diag]');
      for (let i = 0; i < 12; i++) {
        const id = await p2.getAttribute('#qid', 'data-id'); await p2.click('[data-act=diag-unknown]');
        if (i < 11) await p2.waitForFunction(p => document.querySelector('#qid') && document.querySelector('#qid').dataset.id !== p, id);
      }
      await p2.waitForSelector('[data-screen=diagResult]'); await p2.click('[data-act=home]');
      await p2.click('[data-act=start]');
      for (let k = 0; k < 2; k++) {
        await p2.waitForSelector('[data-screen=item] .choice');
        const id = await p2.getAttribute('#qid', 'data-id');
        const q = await p2.evaluate(id => { const x = window.LU_PRACTICE.questions.find(z => z.id === id); return { a: x.answer_index, n: x.choices.length, type: x.type }; }, id);
        const tries = q.type === 'ox' ? 1 : 2;
        for (let j = 1; j <= tries; j++) {
          await p2.click(`.choice[data-orig="${(q.a + j) % q.n}"]`); await p2.click('[data-act=submit]');
          if (j < tries) await p2.waitForSelector('#msg');
        }
        await p2.waitForSelector('[data-act=next]'); await p2.click('[data-act=next]');
      }
      await p2.waitForSelector('[data-screen=item] #concept');
      const lec = await p2.evaluate(() => { const id = document.querySelector('#qid').dataset.id; return window.LU_PRACTICE.questions.find(z => z.id === id).lecture; });
      const want = CARDS_SRC.find(c => c.lecture === lec);
      const lines = await p2.$$eval('#concept .concept-lines li', e => e.map(x => x.textContent));
      ok(want && JSON.stringify(lines) === JSON.stringify(want.lines), lec + '강: ' + lines.join(' / '));
      ok(p2._errors.length === 0, p2._errors.join(' | '));
      await shot(p2, '390_56_개념정리카드_로컬');
      await L2.ctx.close();
      return lec + '강 카드';
    });

    console.log('■ 임시 PostgreSQL');
    await test('F-14', '임시 PostgreSQL 시험(있으면): supabase/local_test/run_qa_fixes_local.sh 실패 0', async () => {
      if (!fs.existsSync('/usr/lib/postgresql/16/bin/initdb') && !process.env.PG_BIN) return '건너뜀 — 이 컴퓨터에 PostgreSQL 16 없음';
      const r = spawnSync('bash', [path.join(APP, 'supabase/local_test/run_qa_fixes_local.sh')], { encoding: 'utf8', timeout: 180000 });
      const last = (r.stdout || '').trim().split('\n').slice(-1)[0];
      ok(r.status === 0, last + ' / ' + (r.stdout || '').split('\n').filter(x => x.startsWith('FAIL')).join(' | ') + (r.stderr || '').slice(0, 300));
      return last;
    });
  } finally {
    await browser.close(); server.kill();
  }
  const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
  fs.writeFileSync(path.join(__dirname, 'e2e_qa_fixes_results.json'), JSON.stringify(results, null, 1));
  console.log(`\nQA 낮음 수정 테스트: 통과 ${pass} · 실패 ${fail}  ※ 실DB 미검증`);
  process.exit(fail ? 1 : 0);
})();
