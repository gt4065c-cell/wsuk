// 시안 스크린샷 + 깨짐 자동 점검 (Playwright)
// 실행: node "/home/user/wsuk/04_제품개발팀/디자인/_스크린샷_촬영.js"
// 결과: 같은 폴더에 스크린샷_<폭>_<안>_<번호>_<화면>.png, 콘솔에 점검 결과
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const FILE = 'file://' + path.join(DIR, '시안_연습앱.html');

const SHOTS = [
  ['start', '01_첫화면'], ['start-err', '02_코드오류'], ['resume', '03_이어풀기'],
  ['sets', '04_세트고르기'], ['q-fresh', '05_문제'], ['q-picked', '06_보기고름'],
  ['q-right', '07_해설_정답'], ['q-wrong', '08_해설_오답'], ['q-ox', '09_해설_OX'],
  ['result', '10_결과'], ['review', '11_다시보기'],
  ['team-start', '12_지정링크_첫화면'], ['team-q', '13_지정링크_문제'], ['team-result', '14_지정링크_결과'],
  ['storage-off', '15_이어풀기꺼짐'],
];
const B_SHOTS = ['start', 'sets', 'q-wrong', 'result', 'team-q'];

(async () => {
  // 0) 진단·평가 문항 미포함 확인
  const html = fs.readFileSync(path.join(DIR, '시안_연습앱.html'), 'utf8');
  const sets = JSON.parse(fs.readFileSync(path.join(DIR, '../../03_교육기획팀/문항은행/quiz_sets.json'), 'utf8'));
  const banned = sets.filter(s => s.purpose !== 'practice').flatMap(s => [s.set_id, ...s.question_ids]);
  const leaks = banned.filter(id => html.includes(id));
  console.log(leaks.length ? `[실패] 진단·평가 흔적: ${leaks.join(', ')}` : '[통과] 진단·평가 문항·세트 0건');

  const browser = await chromium.launch();
  const problems = [];
  for (const width of [390, 360]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => problems.push(`${width}px 스크립트 오류: ${e.message}`));
    await page.goto(FILE);
    for (const plan of ['a', 'b']) {
      await page.click(`[data-tb="plan"][data-v="${plan}"]`);
      for (const [key, name] of SHOTS) {
        if (plan === 'b' && !B_SHOTS.includes(key)) continue;
        await page.selectOption('#jump', key);
        await page.waitForTimeout(150);
        const check = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const out = [];
          if (document.documentElement.scrollWidth > vw + 1) out.push(`가로 넘침 scrollWidth=${document.documentElement.scrollWidth}`);
          document.querySelectorAll('#app *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width && r.right > vw + 1) out.push(`화면 밖: <${el.tagName.toLowerCase()} class="${el.className.baseVal ?? el.className}"> right=${Math.round(r.right)}`);
          });
          document.querySelectorAll('#app button, #app input').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.height && r.height < 44) out.push(`44px 미만: ${el.textContent.trim().slice(0, 20)} (${Math.round(r.height)}px)`);
          });
          document.querySelectorAll('#app *').forEach(el => {
            if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs < 14) out.push(`14px 미만 글자: "${el.textContent.trim().slice(0, 15)}" (${fs}px)`);
          });
          return [...new Set(out)].slice(0, 10);
        });
        check.forEach(c => problems.push(`${width}px ${plan.toUpperCase()}안 ${name}: ${c}`));
        await page.screenshot({ path: path.join(DIR, `스크린샷_${width}_${plan.toUpperCase()}_${name}.png`), fullPage: true });
      }
    }
    // 글자 크기 최대(150%) 흉내 — PRD D-05
    await page.click('[data-tb="plan"][data-v="a"]');
    await page.addStyleTag({ content: 'html{font-size:150%}' });
    await page.selectOption('#jump', 'q-wrong');
    await page.waitForTimeout(150);
    const big = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (big) problems.push(`${width}px 글자 150%: 가로 넘침`);
    await page.screenshot({ path: path.join(DIR, `스크린샷_${width}_A_16_글자크게.png`), fullPage: true });
    await ctx.close();
  }

  // 클릭 흐름 점검: 코드 → 세트 → 끝까지 풀기 → 결과 → 다시 보기 → 다시 풀기
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(FILE);
  await page.fill('#code', 'k7m2px');
  await page.click('button[type=submit]');
  await page.click('[data-act="pick-set"][data-id="PRACTICE-P1"]');
  await page.click('[data-act="pick-amount"][data-v="all"]');
  await page.click('[data-act="start-set"]');
  for (let i = 0; i < 3; i++) {
    const disabled = await page.isDisabled('[data-act="confirm"]');
    if (!disabled) problems.push('흐름: 보기 고르기 전 [답 확정]이 눌림');
    await page.click('[data-act="select"] >> nth=0');
    for (let k = 0; k < 5; k++) await page.click('[data-act="confirm"]', { timeout: 300 }).catch(() => {});
    await page.click('[data-act="next"]');
  }
  const resultText = await page.textContent('#app');
  if (!/K7M2PX님 결과/.test(resultText)) problems.push('흐름: 결과 화면 도달 실패 또는 코드 대문자 변환 실패');
  const rv = await page.$('[data-act="review"]');
  if (rv) { await rv.click(); await page.click('[data-act="back-result"]'); }
  await page.click('[data-act="replay"]');
  if (!(await page.$('[data-act="confirm"]'))) problems.push('흐름: 다시 풀기 실패');
  await ctx.close();
  await browser.close();

  console.log(problems.length ? '[확인 필요]\n- ' + problems.join('\n- ') : '[통과] 넘침·44px·14px·클릭 흐름 문제 없음');
})();
