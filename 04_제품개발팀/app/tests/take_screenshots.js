// 390px 주요 화면 스크린샷 찍기
// 실행: node "04_제품개발팀/app/tests/take_screenshots.js"
// 결과: 04_제품개발팀/app/screenshots/390_번호_화면.png
// 컴퓨터 안에서만 열리는 임시 서버(127.0.0.1)를 잠깐 띄웠다가 끕니다.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'screenshots');
const PORT = 9300 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}/index.html`;
const SRC = Object.fromEntries(JSON.parse(fs.readFileSync(path.resolve(APP, '../../03_교육기획팀/문항은행/questions_part1-3.json'), 'utf8')).map(q => [q.id, q]));
const TEAM = 'L11-Q1,L12-Q1,L12-Q2,L11-Q4,L13-Q5,X99-Q9';

function serve() {
  return new Promise(res => {
    const p = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', path.join(APP, 'public')], { stdio: 'ignore' });
    (function w() { http.get(BASE, r => { r.resume(); res(p); }).on('error', () => setTimeout(w, 150)); })();
  });
}
async function posOf(page, orig) {
  const id = (await page.textContent('#qid')).trim();
  const want = SRC[id].choices[orig];
  return page.$$eval('.choice', (els, want) => els.find(e => (e.querySelector('.txt').textContent.trim() === want) || (e.querySelector('.num').textContent.trim() === want)).dataset.pos, want);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.route(/cdn\.jsdelivr\.net/, r => r.abort());   // 인터넷 글꼴 대신 기본 글꼴
  const page = await ctx.newPage();
  const shot = async (name, full) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, `390_${name}.png`), fullPage: !!full }); console.log('  찍음', name); };

  // 01 첫 화면
  await page.goto(BASE); await page.waitForSelector('#code');
  await page.fill('#code', 'k7m2px');
  await shot('01_첫화면');
  // 02 세트 고르기
  await page.click('[data-act=start]');
  await page.click('[data-act=pick-set][data-id="PRACTICE-P3"]');
  await shot('02_세트고르기');
  // 03 문제 — 보기 고른 상태 (객관식이 나올 때까지)
  await page.click('[data-act=start-set]'); await page.waitForSelector('#qid');
  for (let k = 0; k < 3; k++) {
    const id = (await page.textContent('#qid')).trim();
    if (SRC[id].type === 'mcq') break;
    await page.click(`.choice[data-pos="${await posOf(page, SRC[id].answer_index)}"]`); await page.click('[data-act=confirm]');
    await page.evaluate(() => { S.lockUntil = 0; }); await page.click('[data-act=next]');
  }
  const id = (await page.textContent('#qid')).trim();
  await page.click(`.choice[data-pos="${await posOf(page, SRC[id].common_wrong_index)}"]`);
  await shot('03_문제_보기고름');
  // 04 해설 — 자주 고르는 오답
  await page.click('[data-act=confirm]');
  await page.waitForTimeout(500);   // 앱이 채점 알림 쪽으로 화면을 내려 줌 (사용자가 보는 그대로)
  await shot('04_해설_오답');
  // 05 결과 — 남은 문항은 정답 위주로
  for (let k = 0; ; k++) {
    await page.evaluate(() => { S.lockUntil = 0; });
    const last = (await page.textContent('[data-act=next]')).includes('결과');
    await page.click('[data-act=next]');
    if (last) break;
    const qid = (await page.textContent('#qid')).trim();
    const orig = k === 3 ? (SRC[qid].answer_index + 1) % SRC[qid].choices.length : SRC[qid].answer_index;
    await page.click(`.choice[data-pos="${await posOf(page, orig)}"]`); await page.click('[data-act=confirm]');
  }
  await page.waitForSelector('#score');
  await shot('05_결과', true);
  // 06 교수님 지정 링크 — 문제 (없는 문항 안내)
  await page.goto(BASE + '?ids=' + TEAM); await page.waitForSelector('#code');
  await page.fill('#code', 'K7M2PX'); await page.click('[data-act=start]'); await page.waitForSelector('#qid');
  await shot('06_지정링크_문제');

  await browser.close(); server.kill();
})();
