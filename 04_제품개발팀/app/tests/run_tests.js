// 연습 앱 v0.3 자동 테스트 (PRD 8장 테스트 번호 그대로)
// 실행: node "04_제품개발팀/app/tests/run_tests.js"
// - 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)를 띄워 시험하고, 끝나면 끕니다. 외부 공개 없음.
// - 결과: 화면에 통과/실패, tests/results.json 에 기록
const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const APP = path.resolve(__dirname, '..');
const PUBLIC = path.join(APP, 'public');
const BUILD = path.join(APP, 'tools', 'build_data.py');
const ROOT = path.resolve(APP, '..', '..');
const BANK = path.join(ROOT, '03_교육기획팀', '문항은행');
const SRC_Q = JSON.parse(fs.readFileSync(path.join(BANK, 'questions_part1-3.json'), 'utf8'));
const SRC_S = JSON.parse(fs.readFileSync(path.join(BANK, 'quiz_sets.json'), 'utf8'));
const SRC = Object.fromEntries(SRC_Q.map(q => [q.id, q]));
const BANNED_IDS = SRC_Q.filter(q => q.pool !== 'practice').map(q => q.id);
const PRACTICE_SETS = SRC_S.filter(s => s.purpose === 'practice');
const TEAM_IDS = ['L11-Q1', 'L12-Q1', 'L12-Q2', 'L11-Q4', 'L13-Q5', 'L14-Q1'];
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

const PORT = 8800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
let browser;

// ---------------------------------------------------------------- 작은 도구
function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function test(id, name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ id, name, status: 'pass', note: note || '', ms: Date.now() - t0 });
    console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`);
  } catch (e) {
    results.push({ id, name, status: 'fail', note: String(e && e.message || e), ms: Date.now() - t0 });
    console.log(`  [실패] ${id} ${name} — ${e && e.message}`);
  }
}
function skip(id, name, why) {
  results.push({ id, name, status: 'manual', note: why });
  console.log(`  [수동] ${id} ${name} — ${why}`);
}

async function newPage(opts = {}) {
  const ctx = opts.context || await browser.newContext({
    viewport: opts.viewport || { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  if (opts.blockStorage) {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('막힘', 'SecurityError'); } });
    });
  }
  // 글꼴 CDN은 시험 중 막음(인터넷 없는 상황 = 기본 글꼴로 대체되는지도 함께 확인)
  await ctx.route(/cdn\.jsdelivr\.net/, r => r.abort());
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', e => page._errors.push(e.message));
  page.on('dialog', d => { page._errors.push('dialog:' + d.message()); d.dismiss(); });
  return { ctx, page };
}
async function open(page, query = '') { await page.goto(BASE + 'index.html' + query); await page.waitForSelector('#app .screen'); }
async function enterCode(page, code = 'TEST1') {
  await page.fill('#code', code);
  await page.click('[data-act=start]');
}
async function pickSet(page, setId, amount) {
  await page.click(`[data-act=pick-set][data-id="${setId}"]`);
  await page.click(`[data-act=pick-amount][data-v="${amount}"]`);
  await page.click('[data-act=start-set]');
  await page.waitForSelector('#qid');
}
async function qid(page) { return (await page.textContent('#qid')).trim(); }
async function count(page) { return (await page.textContent('#count')).trim(); }
async function choices(page) {
  return page.$$eval('.choice', els => els.map(e => ({
    pos: +e.dataset.pos,
    text: e.classList.contains('choice') && e.closest('.ox') ? e.querySelector('.num').textContent.trim() : e.querySelector('.txt').textContent.trim(),
  })));
}
// 원본 문항 파일 기준으로 '원래 보기 번호'의 화면 위치 찾기 (앱 내부값이 아니라 글자로 대조)
async function posOfOrig(page, id, orig) {
  const want = SRC[id].choices[orig];
  const cs = await choices(page);
  const hit = cs.filter(c => c.text === want);
  ok(hit.length === 1, `${id}: 보기 "${want}"를 화면에서 정확히 1개 찾지 못함(${hit.length})`);
  return hit[0].pos;
}
async function answer(page, pos) {
  await page.click(`.choice[data-pos="${pos}"]`);
  await page.click('[data-act=confirm]');
  await page.waitForSelector('#verdict');
}
async function next(page) {
  await page.evaluate(() => { S.lockUntil = 0; });   // 시험 속도용: 연타 잠금(0.6초) 기다리지 않음 (B-05·B-07에서 잠금 따로 시험)
  await page.click('[data-act=next]');
}
async function noHScroll(page, label) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  ok(r.sw <= r.w, `${label}: 옆으로 넘침 (${r.sw} > ${r.w})`);
}
async function tapTargets(page, label) {
  const small = await page.$$eval('button, input', els => els.filter(e => e.offsetParent !== null)
    .map(e => ({ t: (e.textContent || e.id).trim().slice(0, 20), h: e.getBoundingClientRect().height }))
    .filter(x => x.h < 44));
  ok(small.length === 0, `${label}: 44px보다 작은 누르는 곳 ${JSON.stringify(small)}`);
}
async function playToEnd(page, chooser) {
  // chooser(id, k) → 원래 보기 번호. 끝까지 풀고 기록 반환
  const log = [];
  for (let k = 0; ; k++) {
    const id = await qid(page);
    const orig = chooser(id, k);
    const pos = await posOfOrig(page, id, orig);
    await answer(page, pos);
    log.push({ id, orig, correct: orig === SRC[id].answer_index });
    const last = (await page.textContent('[data-act=next]')).includes('결과');
    await next(page);
    if (last) break;
  }
  await page.waitForSelector('#score');
  return log;
}
function runBuild(args) {
  const r = spawnSync('python3', [BUILD, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
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

// ---------------------------------------------------------------- 시험
(async () => {
  console.log('E 먼저: 빌드 검사');
  // ===== E-01 =====
  await test('E-01', '원본 그대로 빌드 → 진단·평가 0개', async () => {
    const r = runBuild([]);
    ok(r.code === 0, '빌드 실패: ' + r.out);
    ok(r.out.includes('연습 31문항(P1 10 · P2 10 · P3 11), 세트 3개, 진단·평가 0개'), '요약 문구 다름: ' + r.out);
    const text = fs.readFileSync(path.join(PUBLIC, 'data', 'practice.js'), 'utf8');
    ok(BANNED_IDS.length === 36, '진단·평가 문항 수가 36이 아님: ' + BANNED_IDS.length);
    const leaks = BANNED_IDS.filter(id => text.includes(id)).concat(['DIAG', 'EVAL-'].filter(w => text.includes(w)));
    ok(leaks.length === 0, '찾은 것: ' + leaks.join(','));
    const data = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    ok(data.questions.length === 31 && data.questions.every(q => SRC[q.id].pool === 'practice'), '문항 31개/연습 여부 불일치');
    ok(data.sets.map(s => s.set_id).join() === 'PRACTICE-P1,PRACTICE-P2,PRACTICE-P3', '세트 목록 다름');
    return '36개 id·DIAG·EVAL- 검색 0건, 31문항·세트 3개';
  });

  // ===== E-03 =====
  await test('E-03', '가짜 원본 3종 → 빌드 실패 + 파일 안 만듦', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-build-'));
    const pub = path.join(tmp, 'public'); fs.mkdirSync(pub);
    const cases = {
      '평가 문항 섞기': (q, s) => { s.find(x => x.set_id === 'PRACTICE-P1').question_ids.push('L01-Q2'); },
      'answer_index 범위 밖': (q, s) => { q.find(x => x.id === 'L11-Q1').answer_index = 7; },
      'id 겹침': (q, s) => { const d = JSON.parse(JSON.stringify(q.find(x => x.id === 'L11-Q1'))); q.push(d); },
    };
    const notes = [];
    for (const [name, mut] of Object.entries(cases)) {
      const q = JSON.parse(JSON.stringify(SRC_Q)), s = JSON.parse(JSON.stringify(SRC_S));
      mut(q, s);
      const qp = path.join(tmp, 'q.json'), sp = path.join(tmp, 's.json'), out = path.join(pub, 'data', 'practice.js');
      fs.writeFileSync(qp, JSON.stringify(q)); fs.writeFileSync(sp, JSON.stringify(s));
      const r = runBuild(['--questions', qp, '--sets', sp, '--out', out, '--public', pub]);
      ok(r.code !== 0, `${name}: 빌드가 성공해 버림`);
      ok(!fs.existsSync(out), `${name}: 앱용 파일이 만들어짐`);
      ok(r.out.includes('빌드 실패'), `${name}: 이유 표시 없음`);
      const reason = r.out.split('\n').find(l => l.includes('✕'));
      notes.push(`${name} → ${reason ? reason.trim().slice(2, 50) : '?'}`);
    }
    // ★4: 올릴 폴더에 원본 복사본
    fs.copyFileSync(path.join(BANK, 'quiz_sets.json'), path.join(pub, 'sets_copy.json'));
    const r4 = runBuild(['--out', path.join(pub, 'data', 'practice.js'), '--public', pub]);
    ok(r4.code !== 0 && r4.out.includes('★4'), '★4(올릴 폴더에 원본 복사본) 검사가 실패하지 않음');
    notes.push('추가: public에 원본 복사본 → ★4 실패');
    return notes.join(' / ');
  });

  // ===== E-04 =====
  await test('E-04', '해설에 "2번과 4번은…" → 보기 위치 경고', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-build-'));
    const pub = path.join(tmp, 'public'); fs.mkdirSync(pub);
    const q = JSON.parse(JSON.stringify(SRC_Q));
    q.find(x => x.id === 'L11-Q1').explanation += ' 2번과 4번은 틀린 설명입니다.';
    const qp = path.join(tmp, 'q.json'); fs.writeFileSync(qp, JSON.stringify(q));
    const r = runBuild(['--questions', qp, '--out', path.join(pub, 'data', 'practice.js'), '--public', pub]);
    ok(/경고.*보기 위치 표현.*L11-Q1/.test(r.out), '경고 없음: ' + r.out);
    return '경고 표시(빌드는 성공)';
  });

  const server = await startServer();
  browser = await chromium.launch();
  try {
    console.log('A. 정상 흐름');
    await test('A-01', '코드 k7m2px → K7M2PX 표시, 세트 고르기', async () => {
      const { ctx, page } = await newPage(); await open(page);
      await enterCode(page, 'k7m2px');
      await page.waitForSelector('.setcard');
      ok((await page.textContent('.h-label .mono')) === 'K7M2PX', '대문자 변환 안 됨');
      await ctx.close();
    });
    await test('A-02', '세트 고르기: P1·P2·P3만', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page);
      const ids = await page.$$eval('.setcard', e => e.map(x => x.dataset.id));
      ok(ids.join() === 'PRACTICE-P1,PRACTICE-P2,PRACTICE-P3', '세트: ' + ids);
      const body = await page.textContent('body');
      ok(!/진단|EVAL|DIAG|공통 평가/.test(body.replace('공식 평가는 이 앱에서 하지 않아요', '')), '진단·평가 세트 글자가 보임');
      await ctx.close();
      return ids.join(', ');
    });
    await test('A-03', '세트 전체 10·10·11문항, 중복 없음', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page);
      const got = [];
      for (const s of PRACTICE_SETS) {
        await pickSet(page, s.set_id, 'all');
        const n = +(await count(page)).split('/')[1];
        const steps = await page.$$eval('.step', e => e.length);
        ok(n === s.question_ids.length && steps === n, `${s.set_id}: 표시 ${n}, 칸 ${steps}, 기대 ${s.question_ids.length}`);
        const ids = await page.evaluate(() => S.items.map(i => i.id));
        ok(new Set(ids).size === n && ids.every(i => s.question_ids.includes(i)), `${s.set_id}: 중복 또는 다른 세트 문항`);
        got.push(n);
        await page.evaluate(() => { S.team = false; S.screen = 'sets'; render(); });
      }
      await ctx.close();
      return got.join(' · ');
    });
    await test('A-04', 'P3 8문항(무작위) 3번 → 매번 다른 8문항·순서', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page);
      const P3 = PRACTICE_SETS.find(s => s.set_id === 'PRACTICE-P3').question_ids;
      const runs = [];
      for (let r = 0; r < 3; r++) {
        await pickSet(page, 'PRACTICE-P3', '8');
        ok((await count(page)) === '1 / 8', '진행 표시: ' + await count(page));
        ok((await page.$$eval('.step', e => e.length)) === 8, '진행 칸이 8개가 아님');
        const ids = await page.evaluate(() => S.items.map(i => i.id));
        ok(ids.length === 8 && new Set(ids).size === 8 && ids.every(i => P3.includes(i)), '8문항/중복/범위 오류');
        runs.push(ids.join());
        await page.evaluate(() => { S.screen = 'sets'; render(); });
      }
      ok(new Set(runs).size === 3, '같은 판이 반복됨');
      await ctx.close();
      return '진행 표시 "1 / 8"·칸 8개 일치';
    });

    // A-05~A-07: 3부 세트 전체에서 객관식 하나씩
    async function findMcq(page, needCommonWrongDistinct) {
      for (let k = 0; k < 11; k++) {
        const id = await qid(page);
        const q = SRC[id];
        if (q.type === 'mcq') return id;
        await answer(page, 0); await next(page);
      }
      throw new Error('객관식 못 찾음');
    }
    await test('A-05', '정답 → "정답입니다" + 해설 + 근거', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P3', 'all');
      const id = await findMcq(page);
      await answer(page, await posOfOrig(page, id, SRC[id].answer_index));
      ok((await page.textContent('#verdict')).trim() === '정답입니다', '판정 문구');
      ok((await page.textContent('.explain')).includes(SRC[id].explanation), '해설 없음');
      ok((await page.textContent('.source')).trim() === '근거: ' + SRC[id].source_section, '근거 강의 없음');
      ok((await page.$('.choice.is-correct .mark.ok')) && (await page.textContent('.choice.is-correct')).includes('내 답'), '정답·내 답 표시');
      await ctx.close(); return id;
    });
    await test('A-06', '일반 오답 → "정답은 n번 ○○○" 화면 번호·내용 일치', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P3', 'all');
      const id = await findMcq(page); const q = SRC[id];
      const wrongOrig = [0, 1, 2, 3].find(i => i !== q.answer_index && i !== q.common_wrong_index);
      await answer(page, await posOfOrig(page, id, wrongOrig));
      const cpos = await posOfOrig(page, id, q.answer_index);
      const v = (await page.textContent('#verdict')).trim();
      const want = `아쉬워요, 정답은 ${CIRCLED[cpos]} ${q.choices[q.answer_index]}`;
      ok(v === want, `"${v}" ≠ "${want}"`);
      ok((await page.getAttribute('.choice.is-correct', 'data-pos')) === String(cpos), '정답 표시 위치');
      ok(!(await page.$('#confuse')), '일반 오답인데 헷갈리기 상자가 나옴');
      await ctx.close(); return `${id}: ${v}`;
    });
    await test('A-07', '자주 고르는 오답 → "이렇게 헷갈리기 쉬워요"', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P3', 'all');
      const id = await findMcq(page); const q = SRC[id];
      await answer(page, await posOfOrig(page, id, q.common_wrong_index));
      ok((await page.textContent('#confuse')).includes(q.common_wrong_reason), '이유 문구 없음');
      ok((await page.textContent('.choice.is-wrong .txt')).trim() === q.choices[q.common_wrong_index], '내 답 보기 내용 불일치');
      await ctx.close(); return id + ' (A-08에서 31문항 전부 다시 확인)';
    });

    await test('A-08', '채점 전수 대조: 31문항 × 모든 보기 × 2번 반복(섞기 켬)', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page);
      let checks = 0, mismatches = [], oxChecked = 0;
      const orders = {};
      for (let rep = 0; rep < 2; rep++) {
        for (const s of PRACTICE_SETS) {
          for (let pick = 0; pick < 4; pick++) {   // 판마다 '원래 보기 번호 pick'을 고름 → 4판이면 모든 보기를 한 번씩
            await page.evaluate(() => { S.screen = 'sets'; render(); });
            await pickSet(page, s.set_id, 'all');
            for (;;) {
              const id = await qid(page); const q = SRC[id];
              const cs = await choices(page);
              ok(cs.length === q.choices.length, `${id}: 보기 수 다름`);
              if (q.type === 'ox') { ok(cs[0].text === 'O' && cs[1].text === 'X', `${id}: OX 순서가 바뀜`); oxChecked++; }
              (orders[id] = orders[id] || new Set()).add(cs.map(c => c.text).join('|'));
              const orig = pick % q.choices.length;
              await answer(page, await posOfOrig(page, id, orig));
              const want = orig === q.answer_index;
              const got = (await page.getAttribute('#verdict', 'data-result')) === 'correct';
              const cpos = await posOfOrig(page, id, q.answer_index);
              const markedPos = +(await page.getAttribute('.choice.is-correct', 'data-pos'));
              const confuse = !!(await page.$('#confuse'));
              const wantConfuse = !want && orig === q.common_wrong_index;
              checks++;
              if (got !== want || markedPos !== cpos || confuse !== wantConfuse) mismatches.push(`${id} 보기${orig}: 판정 ${got}/${want}, 정답칸 ${markedPos}/${cpos}, 헷갈림 ${confuse}/${wantConfuse}`);
              const last = (await page.textContent('[data-act=next]')).includes('결과');
              await next(page);
              if (last) break;
            }
            await page.waitForSelector('#score');
          }
        }
      }
      const shuffledMcq = Object.entries(orders).filter(([id, set]) => SRC[id].type === 'mcq' && set.size > 1).length;
      ok(mismatches.length === 0, '불일치: ' + mismatches.slice(0, 5).join('; '));
      ok(Object.keys(orders).length === 31, '확인한 문항 수 ' + Object.keys(orders).length);
      ok(shuffledMcq === 25, `보기가 실제로 섞인 객관식 ${shuffledMcq}/25`);
      ok(page._errors.length === 0, '오류: ' + page._errors.join(';'));
      await ctx.close();
      return `채점 ${checks}번, 불일치 0건, 31문항 전부 확인, 객관식 25개 모두 보기 순서 바뀜 확인, OX 순서 고정 ${oxChecked}번 확인`;
    });

    await test('A-09', '끝까지 → 결과 → 틀린 문항 다시 보기 → 다시 풀기', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page, 'TEST1'); await pickSet(page, 'PRACTICE-P2', '8');
      const firstOrder = await page.evaluate(() => S.items.map(i => i.id).join());
      const log = await playToEnd(page, (id, k) => k % 3 === 1 ? (SRC[id].answer_index + 1) % SRC[id].choices.length : SRC[id].answer_index);
      const c = log.filter(x => x.correct).length;
      ok(+(await page.textContent('#score')) === c, '맞힌 수 불일치');
      ok((await page.textContent('#result-line')).startsWith(`8문항 중 ${c}문항 정답`), '결과 문장');
      ok((await page.textContent('#result-code')) === 'TEST1', '코드 표시');
      ok((await page.$$eval('.feet li', e => e.length)) === 8, '문항 발자국 수');
      await page.click('[data-act=review]');
      const rv = await page.$$eval('article.rv', e => e.map(x => x.dataset.id));
      const wrongIds = log.filter(x => !x.correct).map(x => x.id);
      ok(rv.join() === wrongIds.join(), `다시 보기 ${rv} ≠ 틀린 ${wrongIds}`);
      await page.click('[data-act=back-result]');
      await page.click('[data-act=replay]');
      await page.waitForSelector('#qid');
      ok((await count(page)) === '1 / 8', '다시 풀기 진행 표시');
      const second = await page.evaluate(() => S.items.map(i => i.id).join());
      ok(second !== firstOrder, '다시 풀기가 새로 섞이지 않음');
      await ctx.close(); return `8문항 중 ${c} 정답, 틀린 ${wrongIds.length}개만 다시 보기`;
    });

    skip('A-10', '(F5) 내 기록', '해당 없음 — F5는 선택 기능으로 이번에 만들지 않음');

    await test('A-11', '(F6) 지정 링크 6문항, 기기 3대 같은 순서·보기 순서', async () => {
      const seen = [];
      for (let d = 0; d < 3; d++) {
        const { ctx, page } = await newPage(); await open(page, '?ids=' + TEAM_IDS.join(','));
        ok((await page.textContent('.band')).includes('팀 연습 6문항'), '고정 띠');
        await enterCode(page, 'TEST' + d);
        await page.waitForSelector('#qid');
        ok(!(await page.$('.setcard')), '세트 고르기를 건너뛰지 않음');
        const rows = [];
        for (let k = 0; k < 6; k++) {
          ok((await count(page)) === `${k + 1} / 6`, '진행 표시');
          rows.push((await qid(page)) + ':' + (await choices(page)).map(c => c.text).join('|'));
          await answer(page, 0); await next(page);
        }
        await page.waitForSelector('#score');
        seen.push(rows.join('\n'));
        ok(rows.map(r => r.split(':')[0]).join() === TEAM_IDS.join(), '링크 순서와 다름');
        ok(rows.every(r => { const [id, t] = r.split(':'); return t === SRC[id].choices.join('|'); }), '보기가 섞임');
        await ctx.close();
      }
      ok(new Set(seen).size === 1, '기기마다 다름');
      return '3개 창 모두 같은 6문항·원래 보기 순서';
    });

    console.log('B. 이상 입력·중복 클릭');
    await test('B-01', '빈칸/공백만/1글자/11자 → 안내, 안 넘어감', async () => {
      const { ctx, page } = await newPage(); await open(page);
      for (const v of ['', '    ', 'A', 'ABCDEFGHIJK', 'ABCDEFGHIJ12']) {
        await enterCode(page, v);
        ok(await page.$('#code-err'), `"${v}": 안내 없음`);
        ok(!(await page.$('.setcard')), `"${v}": 넘어감`);
      }
      await enterCode(page, ' k7m2px-n '); await page.waitForSelector('.setcard');
      ok((await page.textContent('.h-label .mono')) === 'K7M2PX-N', '정상 코드(앞뒤 빈칸·-N) 처리');
      await ctx.close(); return '5가지 거절, " k7m2px-n " → K7M2PX-N 통과';
    });
    await test('B-02', '한글 이름·특수문자·이모지 → 안내', async () => {
      const { ctx, page } = await newPage(); await open(page);
      for (const v of ['김교수', 'K7M2PX!', 'AB CD', '😀😀', 'K7_M2', '---', 'ＡＢＣ']) {
        await enterCode(page, v);
        const t = await page.textContent('#code-err').catch(() => '');
        ok(t.includes('카드에 적힌 영문·숫자 코드'), `"${v}": 안내 없음`);
        ok(!(await page.$('.setcard')), `"${v}": 넘어감`);
      }
      await ctx.close(); return '7가지 모두 거절';
    });
    await test('B-03', '코드에 <b>X</b> (글자 검사 우회) → 글자 그대로', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', '8');
      const evil = '<b>X</b><img src=x onerror=alert(1)>';
      await page.evaluate(v => { S.code = v; S.screen = 'result'; render(); }, evil);
      ok((await page.textContent('#result-code')) === evil, '글자 그대로 보이지 않음');
      ok((await page.$$('#result-code *')).length === 0, '태그가 실행됨(요소 생성)');
      await page.evaluate(v => { S.draft = v; S.screen = 'start'; render(); }, evil);
      ok((await page.inputValue('#code')) === evil, '입력칸 값');
      ok(!(await page.$('#app img')), '그림 요소 생김');
      await page.waitForTimeout(200);
      ok(page._errors.length === 0, '실행됨: ' + page._errors.join(';'));
      await ctx.close();
    });
    await test('B-04', '보기 안 고르고 [답 확정] → 안 눌림', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', '8');
      ok(await page.isDisabled('[data-act=confirm]'), '버튼이 켜져 있음');
      ok((await page.textContent('.hint')).includes('보기를 먼저 고르세요'), '안내 글자');
      await page.click('[data-act=confirm]', { force: true });
      ok(!(await page.$('#verdict')), '채점됨');
      await ctx.close();
    });
    await test('B-05', '[답 확정] 빠르게 5번 → 채점 1번, 저절로 안 넘어감', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', '8');
      await page.click('.choice[data-pos="0"]');
      const b = await (await page.$('[data-act=confirm]')).boundingBox();
      for (let i = 0; i < 5; i++) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      ok((await count(page)) === '1 / 8', '넘어감: ' + await count(page));
      ok((await page.evaluate(() => S.answers.filter(Boolean).length)) === 1, '채점 횟수');
      await ctx.close();
    });
    await test('B-06', '확정 후 다른 보기 누르기 → 답 안 바뀜', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', 'all');
      await answer(page, 0);
      const before = await page.evaluate(() => JSON.stringify(S.answers[0]));
      const vb = await page.textContent('#verdict');
      await page.click('.choice[data-pos="1"]', { force: true });   // 잠긴 보기를 억지로 눌러 봄
      ok((await page.evaluate(() => JSON.stringify(S.answers[0]))) === before && (await page.textContent('#verdict')) === vb, '답이 바뀜');
      ok((await page.getAttribute('.choice[data-pos="1"]', 'aria-disabled')) === 'true', '잠김 표시');
      await ctx.close();
    });
    await test('B-07', '[다음 문제] 5번 연타 → 한 문항만 / 뒤로 가기', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', '8');
      await answer(page, 0);
      await page.waitForTimeout(650);
      const b = await (await page.$('[data-act=next]')).boundingBox();
      for (let i = 0; i < 5; i++) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      ok((await count(page)) === '2 / 8', '건너뜀: ' + await count(page));
      ok(!(await page.$('#verdict')), '2번 문항이 저절로 채점됨');
      // 뒤로 가기 → 앞으로 가기: 앱이 다시 열리고 이어 풀기 가능
      await page.goBack(); await page.goForward(); await page.waitForSelector('#app .screen');
      ok(await page.$('[data-act=resume]'), '이어 풀기 안내 없음');
      await page.click('[data-act=resume]');
      ok((await count(page)) === '2 / 8', '이어 풀기 위치');
      ok(page._errors.length === 0, '오류: ' + page._errors.join(';'));
      await ctx.close(); return '연타 5번 → 2/8, 뒤로 가기 후 돌아오면 이어 풀기로 2번부터';
    });
    await test('B-08', '(F6) 링크에 없는 번호·평가 번호·이상한 글자', async () => {
      const { ctx, page } = await newPage();
      const bad = 'L11-Q1,ZZZ-Q9,L01-Q2,%3Cscript%3Ealert(1)%3C%2Fscript%3E,L12-Q1';
      await open(page, '?ids=' + bad);
      await enterCode(page); await page.waitForSelector('#qid');
      ok((await page.textContent('#missing')).includes('이 링크에 없는 문항이 3개'), '안내 문구');
      ok((await count(page)) === '1 / 2', '있는 문항만 진행: ' + await count(page));
      const html = await page.content();
      ok(!html.includes(SRC['L01-Q2'].question) && !html.includes('L01-Q2'), '평가 문항 내용이 보임');
      ok(page._errors.length === 0, '오류: ' + page._errors.join(';'));
      await ctx.close(); return '안내 "없는 문항 3개", 2문항만 진행';
    });

    console.log('C. 새로고침·끊김');
    await test('C-01', '4번 해설에서 새로고침 → 이어 풀기 → 5번부터, 순서·답 그대로', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P3', 'all');
      for (let k = 0; k < 4; k++) { await answer(page, k % 2); if (k < 3) await next(page); }
      const snap = () => page.evaluate(() => ({ items: S.items.map(i => i.id + ':' + i.order.join('')), picks: S.answers.map(a => a.pickedOrig + '/' + a.correct) }));
      const before = await snap();
      await page.reload(); await page.waitForSelector('[data-act=resume]');
      ok((await page.textContent('[data-act=resume]')).includes('5번부터'), '버튼 문구');
      await page.click('[data-act=resume]');
      ok((await count(page)) === '5 / 11', '위치: ' + await count(page));
      const after = await snap();
      ok(JSON.stringify(after) === JSON.stringify(before), '순서·답이 바뀜');
      ok((await page.$$eval('.step.ok, .step.no', e => e.length)) === 4, '진행 칸 1~4 표시');
      await ctx.close();
    });
    await test('C-02', '브라우저 완전히 닫았다 열기 → [새로 시작] → 메모 지워짐', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-prof-'));
      let ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 390, height: 844 } });
      await ctx.route(/cdn\.jsdelivr\.net/, r => r.abort());
      let page = ctx.pages()[0] || await ctx.newPage();
      await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', '8');
      await answer(page, 0); await next(page); await answer(page, 1);
      await ctx.close();
      ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 390, height: 844 } });
      await ctx.route(/cdn\.jsdelivr\.net/, r => r.abort());
      page = ctx.pages()[0] || await ctx.newPage();
      await open(page);
      ok(await page.$('[data-act=resume]'), '다시 열었을 때 이어 풀기 안내 없음');
      ok((await page.textContent('.screen')).includes('2문항까지 풀었어요'), '요약 문구');
      await page.click('[data-act=new-start]');
      ok(await page.$('#code'), '첫 화면 아님');
      ok((await page.evaluate(() => localStorage.getItem('levelup_practice_run'))) === null, '메모가 남음');
      ok((await page.inputValue('#code')) === 'TEST1', '지난 코드 미리 채우기');
      await page.reload(); ok(!(await page.$('[data-act=resume]')), '새로고침 후 이어 풀기가 다시 뜸');
      await ctx.close();
      return '닫았다 열어도 이어 풀기 유지, 새로 시작 시 메모 삭제, 코드 미리 채움';
    });
    await test('C-03', '첫 화면 뒤 인터넷 끊김(오프라인) → 끝까지 정상', async () => {
      const { ctx, page } = await newPage(); await open(page);
      await ctx.setOffline(true);
      await enterCode(page); await pickSet(page, 'PRACTICE-P1', 'all');
      await playToEnd(page, (id, k) => k === 2 ? SRC[id].common_wrong_index : SRC[id].answer_index);
      ok((await page.textContent('#score')) === '9', '점수');
      await page.click('[data-act=review]'); await page.click('[data-act=back-result]');
      ok(page._errors.length === 0, '오류: ' + page._errors.join(';'));
      await ctx.close(); return '10문항 풀이·해설·결과·다시 보기 정상(9/10)';
    });
    await test('C-04', '결과 화면에서 새로고침 → 멈춤 없음, 이어 풀기 안 뜸', async () => {
      const { ctx, page } = await newPage(); await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', '8');
      await playToEnd(page, id => SRC[id].answer_index);
      await page.reload(); await page.waitForSelector('#app .screen');
      ok(!(await page.$('[data-act=resume]')), '이어 풀기가 다시 뜸');
      ok(await page.$('#code'), '첫 화면 아님');
      ok(page._errors.length === 0, '오류');
      await ctx.close();
    });
    await test('C-05', '풀던 판 메모를 망가뜨리고 새로고침 → 멈춤 없이 첫 화면', async () => {
      const { ctx, page } = await newPage(); await open(page);
      const bads = [
        '{망가진 글자',
        JSON.stringify({ v: 1, code: 'TEST1', team: false, setId: 'PRACTICE-P1', amount: '8', items: [{ id: 'L01-Q2', order: [0, 1, 2, 3] }], picks: [] }),
        JSON.stringify({ v: 1, code: 'TEST1', team: false, setId: 'PRACTICE-P1', amount: '8', items: [{ id: 'L01-Q1', order: [0, 0, 1, 2] }], picks: [] }),
        JSON.stringify({ v: 1, code: 'TEST1', team: false, setId: 'PRACTICE-P1', amount: '8', items: [{ id: 'L01-Q1', order: [0, 1, 2, 3] }], picks: [9] }),
        JSON.stringify({ v: 1, code: '<b>X</b>', team: false, setId: 'PRACTICE-P1', amount: '8', items: [{ id: 'L01-Q1', order: [0, 1, 2, 3] }], picks: [] }),
        JSON.stringify({ v: 1, code: 'TEST1', team: false, setId: 'EVAL-A', amount: 'all', items: [{ id: 'L01-Q1', order: [0, 1, 2, 3] }], picks: [] }),
        'null', '[]', '12345',
      ];
      for (const b of bads) {
        await page.evaluate(v => localStorage.setItem('levelup_practice_run', v), b);
        await page.reload(); await page.waitForSelector('#app .screen');
        ok(await page.$('#code'), `첫 화면 아님: ${b.slice(0, 30)}`);
        ok((await page.evaluate(() => localStorage.getItem('levelup_practice_run'))) === null, `메모를 안 버림: ${b.slice(0, 30)}`);
      }
      ok(page._errors.length === 0, '오류: ' + page._errors.join(';'));
      await ctx.close(); return `망가진 메모 ${bads.length}가지 모두 버리고 첫 화면`;
    });

    console.log('D. 기기 호환·글자 크기 (흉내 내기)');
    skip('D-01', '안드로이드 크롬·삼성 인터넷', '실제 휴대폰 필요 — QA·10대 시연 점검에서 확인');
    skip('D-02', '아이폰 사파리', '실제 휴대폰 필요 — QA·10대 시연 점검에서 확인');
    skip('D-03', '카카오톡 인앱 브라우저', '실제 휴대폰 필요 — 이어 풀기 작동 여부 포함');
    async function screensCheck(page, label) {
      await open(page); await noHScroll(page, label + ' 첫 화면'); await tapTargets(page, label + ' 첫 화면');
      await enterCode(page); await page.waitForSelector('.setcard'); await noHScroll(page, label + ' 세트'); await tapTargets(page, label + ' 세트');
      await pickSet(page, 'PRACTICE-P3', 'all');
      let sawOx = false;
      for (;;) {
        const id = await qid(page); if (SRC[id].type === 'ox') sawOx = true;
        await noHScroll(page, label + ' 문제 ' + id); await tapTargets(page, label + ' 문제');
        await answer(page, await posOfOrig(page, id, SRC[id].common_wrong_index));
        await noHScroll(page, label + ' 해설 ' + id);
        const last = (await page.textContent('[data-act=next]')).includes('결과');
        await next(page); if (last) break;
      }
      await noHScroll(page, label + ' 결과'); await tapTargets(page, label + ' 결과');
      await page.click('[data-act=review]'); await noHScroll(page, label + ' 다시 보기');
      ok(sawOx, 'OX 문항을 못 봄');
    }
    await test('D-04', '노트북 폭(1280px) — 가로 넘침 없음·본문 18px·폭 560px', async () => {
      const { ctx, page } = await newPage({ viewport: { width: 1280, height: 800 } });
      await screensCheck(page, '1280');
      await open(page);
      const r = await page.evaluate(() => ({ fs: getComputedStyle(document.querySelector('.screen')).fontSize, w: document.querySelector('.wrap').getBoundingClientRect().width }));
      ok(r.fs === '18px' && r.w <= 560, JSON.stringify(r));
      await ctx.close(); return '부분 자동 — 프로젝터에서 멀리서 읽히는지는 사람 확인 필요';
    });
    await test('D-05', '글자 크기 최대(뿌리 글자 200%로 흉내) — 넘침·작은 버튼 없음', async () => {
      const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; }); });
      await screensCheck(page, '200%');
      await ctx.close(); return '시뮬레이션 — 실제 휴대폰 설정은 QA 확인';
    });
    await test('D-06', '360px 폭 · 가로 모드(740×360)', async () => {
      for (const vp of [{ width: 360, height: 740 }, { width: 740, height: 360 }]) {
        const { ctx, page } = await newPage({ viewport: vp });
        await screensCheck(page, `${vp.width}x${vp.height}`);
        await ctx.close();
      }
      return '두 크기 모든 화면 가로 넘침 0, 누르는 곳 44px 이상';
    });
    await test('D-07', '저장소 막힘(시크릿 창 흉내) → 풀기·채점 정상 + 안내 1줄', async () => {
      const { ctx, page } = await newPage({ blockStorage: true }); await open(page);
      ok((await page.textContent('.storage-note')).includes('이어 풀기가 꺼져 있어요'), '첫 화면 안내');
      await enterCode(page); await pickSet(page, 'PRACTICE-P2', '8');
      ok((await page.$$('.storage-note')).length === 1, '문제 화면 안내 1줄');
      await playToEnd(page, id => SRC[id].answer_index);
      ok((await page.textContent('#score')) === '8', '점수');
      ok(page._errors.length === 0, '오류: ' + page._errors.join(';'));
      await ctx.close();
    });

    console.log('E. 공개 안전 검사 (브라우저)');
    await test('E-02', '올릴 폴더 목록 + 브라우저가 받은 파일 전체 검사', async () => {
      const files = [];
      (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(path.relative(PUBLIC, p)); } })(PUBLIC);
      ok(!files.some(f => /questions_part|quiz_sets|\.json$/.test(f)), '원본 문항·세트 파일이 있음: ' + files);
      const { ctx, page } = await newPage();
      const bodies = [];
      page.on('response', async r => { if (r.url().startsWith(BASE)) { try { bodies.push([r.url(), await r.text()]); } catch (e) { } } });
      await open(page); await enterCode(page); await pickSet(page, 'PRACTICE-P1', '8');
      await page.waitForTimeout(300);
      for (const [u, b] of bodies) {
        const bad = BANNED_IDS.filter(id => b.includes(id)).concat(['DIAG', 'EVAL-', '"status":', '"review_note":', '"pool":', '"difficulty":'].filter(w => b.includes(w)));
        ok(bad.length === 0, `${u}: ${bad.join(',')}`);
      }
      await ctx.close();
      return `public/ 파일 ${files.length}개(${files.join(', ')}), 받은 파일 ${bodies.length}개 모두 0건`;
    });
    await test('E-05', '한 판 풀며 네트워크 기록 → 첫 화면 뒤 바깥 요청 0건', async () => {
      const { ctx, page } = await newPage();
      const reqs = [];
      page.on('request', r => reqs.push({ url: r.url(), method: r.method(), post: r.postData() || '', phase: page._phase }));
      page._phase = 'load';
      await open(page); await page.waitForTimeout(300);
      page._phase = 'play';
      await enterCode(page, 'NETCHK7'); await pickSet(page, 'PRACTICE-P3', '8');
      await playToEnd(page, id => SRC[id].common_wrong_index);
      await page.click('[data-act=review]'); await page.waitForTimeout(300);
      const play = reqs.filter(r => r.phase === 'play');
      const loadExternal = reqs.filter(r => r.phase === 'load' && !r.url.startsWith(BASE));
      ok(play.length === 0, '풀이 중 요청: ' + play.map(r => r.url).join(', '));
      ok(!reqs.some(r => r.method !== 'GET' || r.url.includes('NETCHK7') || r.post.includes('NETCHK7')), '코드·답 전송');
      ok(loadExternal.every(r => r.url.startsWith('https://cdn.jsdelivr.net/gh/orioncactus/pretendard')), '처음 열 때 글꼴 외 바깥 요청: ' + loadExternal.map(r => r.url));
      await ctx.close();
      return `처음 열 때 바깥 요청은 글꼴(CDN) ${loadExternal.length}건뿐, 풀이 중 요청 0건, 전송(POST) 0건 — 단, 시험에서는 글꼴 CDN을 막아 둠(아래 '알려진 문제' 참고)`;
    });
  } finally {
    await browser.close();
    server.kill();
  }

  const sum = s => results.filter(r => r.status === s).length;
  console.log(`\n합계: 통과 ${sum('pass')} · 실패 ${sum('fail')} · 수동/해당없음 ${sum('manual')} (총 ${results.length})`);
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 1));
  process.exit(sum('fail') ? 1 : 0);
})();
