// 계산 규칙 단위 테스트 (브라우저 없이 node로 바로 실행)
// 실행: node 04_제품개발팀/app2/tests/unit_logic.js
const path = require('path');
const fs = require('fs');
const LU = require(path.join(__dirname, '..', 'public', 'js', 'logic.js'));
const O = LU.OUTCOME;

const results = [];
function near(a, b, eps = 1e-4) { return Math.abs(a - b) < eps; }
function ok(c, m) { if (!c) throw new Error(m); }
function t(id, name, fn) {
  try { const note = fn(); results.push({ id, name, status: 'pass', note: note || '' }); console.log(`  [통과] ${id} ${name}${note ? ' — ' + note : ''}`); }
  catch (e) { results.push({ id, name, status: 'fail', note: e.message }); console.log(`  [실패] ${id} ${name} — ${e.message}`); }
}
const mcq = (id, lecture, difficulty) => ({ id, lecture, difficulty, type: 'mcq', choices: ['a', 'b', 'c', 'd'] });
const ox = (id, lecture, difficulty) => ({ id, lecture, difficulty, type: 'ox', choices: ['O', 'X'] });

console.log('■ Elo 공식');
t('U-01', '맞힐 확률 P: θ=b면 4지선다 0.625, OX 0.75', () => {
  ok(near(LU.pCorrect(0, 0, 0.25), 0.625), 'mcq'); ok(near(LU.pCorrect(1, 1, 0.5), 0.75), 'ox');
});
t('U-02', '맞힐 확률 P: θ=0, 쉬움(b=−1) 4지선다 = 0.7983', () => {
  const p = LU.pCorrect(0, -1, 0.25); ok(near(p, 0.25 + 0.75 / (1 + Math.exp(-1))), 'P=' + p); return 'P=' + p.toFixed(4);
});
t('U-03', '난이도 매핑 1→−1, 2→0, 3→+1 / 찍기 확률 1÷보기 수', () => {
  ok(LU.initialB(mcq('a', 1, 1)) === -1 && LU.initialB(mcq('a', 1, 2)) === 0 && LU.initialB(mcq('a', 1, 3)) === 1, 'b');
  ok(LU.guessRate(mcq('a', 1, 1)) === 0.25 && LU.guessRate(ox('a', 1, 1)) === 0.5, 'c');
});
t('U-04', 'K = 0.8/(1+0.05×n): n=0 → 0.8, n=20 → 0.4', () => {
  ok(near(LU.kLearner(0), 0.8) && near(LU.kLearner(20), 0.4), 'K');
});
t('U-05', 'θ 고치기: θ=0, n=0, 맞힘(R=1), P=0.625 → 0.3', () => {
  ok(near(LU.updateTheta(0, 0, 1, 0.625), 0.3), String(LU.updateTheta(0, 0, 1, 0.625)));
  ok(near(LU.updateTheta(0, 0, 0.5, 0.625), -0.1), '힌트로 해결 R=0.5');
  ok(near(LU.updateTheta(0, 0, 0, 0.625), -0.5), '정답 보고 이해 R=0');
});
t('U-06', 'θ는 −3~+3, b는 −2.5~+2.5 안에서만', () => {
  ok(LU.updateTheta(2.95, 0, 1, 0.1) === 3 && LU.updateTheta(-2.95, 0, 0, 0.9) === -3, 'θ');
  ok(LU.updateB(-2.45, 50, 1, 0) === -2.5 && LU.updateB(2.45, 50, 0, 1) === 2.5, 'b');
});
t('U-07', '문항 난이도 b는 응답 10개 전까지 고정, 10개부터 b ← b − K(R−P)', () => {
  ok(LU.updateB(0, 9, 1, 0.5) === 0, '9개');
  const K = 0.8 / 1.5; ok(near(LU.updateB(0, 10, 1, 0.5), -K * 0.5), '10개');
});
t('U-08', '설계서 계산 확인: θ≈0.7부터 보통, θ≈1.7부터 어려움이 0.75 구간에 들어옴', () => {
  ok(LU.pCorrect(0, 0, 0.25) < 0.75 && LU.pCorrect(0.7, 0, 0.25) >= 0.75, '보통');
  ok(LU.pCorrect(1.6, 1, 0.25) < 0.75 && LU.pCorrect(1.7, 1, 0.25) >= 0.75, '어려움');
});
t('U-09', 'applyElo: θ·n·b 함께 고침(문항 응답 9개면 b 그대로)', () => {
  const e = LU.applyElo({ theta: 0, n: 0 }, { b: 0, n: 9 }, mcq('a', 1, 2), 1);
  ok(near(e.theta, 0.3) && e.n === 1 && e.b === 0 && e.itemN === 10, JSON.stringify(e));
});

console.log('■ 진단');
const DQ = [1, 2, 3].flatMap(d => [1, 2, 3, 4].map(k => mcq(`D${d}${k}`, d * 4 + k, d)));
const keyAll = Object.fromEntries(DQ.map(q => [q.id, { answer_index: 0 }]));
t('U-10', '진단 12문항 모두 맞힘 → θ 양수, 모두 "모르겠어요" → θ 음수, n=12', () => {
  const a = LU.scoreDiagnostic(DQ, DQ.map(q => ({ qid: q.id, choice: 0 })), keyAll);
  const b = LU.scoreDiagnostic(DQ, DQ.map(q => ({ qid: q.id, choice: null })), keyAll);
  ok(a.theta > 1 && b.theta < -1 && a.n === 12, `${a.theta} / ${b.theta}`);
  return `θ 모두 맞힘 ${a.theta.toFixed(2)} · 모두 모름 ${b.theta.toFixed(2)}`;
});
t('U-11', '진단 결과: 강한 강의 2 = 맞힌 것 중 어려운 순, 먼저 볼 강의 2 = 틀린 것 중 쉬운 순', () => {
  const ans = DQ.map(q => ({ qid: q.id, choice: q.difficulty >= 2 && q.id !== 'D21' ? 0 : 1 }));
  const r = LU.scoreDiagnostic(DQ, ans, keyAll);
  ok(r.strong.length === 2 && r.strong.every(l => l >= 13), '강한 ' + r.strong);
  ok(r.weak.length === 2 && r.weak.every(l => l <= 8), '약한 ' + r.weak);
});

console.log('■ 다음 문제 고르기');
const BANK = [];
for (let L = 1; L <= 15; L++) for (let k = 1; k <= 2; k++) BANK.push(mcq(`L${L}-Q${k}`, L, ((L + k) % 3) + 1));
const base = (o = {}) => Object.assign({ theta: 0, questions: BANK, items: {}, history: [], reviewIds: [], today: '2026-12-10', openUpTo: 15, recent: [], exclude: [], rand: () => 0 }, o);
t('U-12', 'E2: θ=0이면 P 0.75~0.90인 쉬움(b=−1) 문항을 고름', () => {
  const r = LU.pickNext(base()); const q = BANK.find(x => x.id === r.qid);
  ok(r.rule === 'E2' && q.difficulty === 1 && r.P >= 0.75 && r.P <= 0.9, JSON.stringify(r));
});
t('U-13', 'E1: 복습 상자·최근 7일·안 열린 강·이번에 푼 문항은 빼기', () => {
  const easy = BANK.filter(q => q.difficulty === 1).map(q => q.id);
  const history = easy.slice(0, 3).map(qid => ({ qid, day: '2026-12-05', outcome: O.SOLO }));
  const r = LU.pickNext(base({ history, reviewIds: [easy[3]], exclude: [easy[4]], openUpTo: 15 }));
  ok(!easy.slice(0, 5).includes(r.qid), r.qid);
  const r2 = LU.pickNext(base({ openUpTo: 3 })); ok(BANK.find(x => x.id === r2.qid).lecture <= 3, '열린 강');
  const r3 = LU.pickNext(base({ history: [{ qid: easy[0], day: '2026-12-02', outcome: O.SOLO }], questions: BANK.filter(q => q.id === easy[0]) }));
  ok(r3 && r3.qid === easy[0], '8일 지난 혼자 맞힘 문항은 다시 후보(E6)');
});
t('U-14', 'E3: 구간 안 문항이 없으면 P 0.82에 가장 가까운 문항', () => {
  const r = LU.pickNext(base({ theta: -2 }));
  ok(r.rule === 'E3' && BANK.find(x => x.id === r.qid).difficulty === 1, JSON.stringify(r));
});
t('U-15', 'E4: 바로 전 2문항 연속 R=0 → P 가장 높은 문항 + 개념 정리 카드', () => {
  const r = LU.pickNext(base({ theta: 1, recent: [{ qid: 'x', lecture: 1, R: 0 }, { qid: 'y', lecture: 2, R: 0 }] }));
  ok(r.rule === 'E4' && r.conceptCard && BANK.find(x => x.id === r.qid).difficulty === 1, JSON.stringify(r));
});
t('U-16', 'E5: 같은 강 3연속이면 4번째는 다른 강', () => {
  const qs = [mcq('A1', 1, 1), mcq('A2', 1, 1), mcq('B1', 2, 3)];
  const r = LU.pickNext(base({ questions: qs, recent: [1, 1, 1].map((L, i) => ({ qid: 'z' + i, lecture: L, R: 1 })) }));
  ok(r.qid === 'B1', r.qid);
});
t('U-17', '후보 0개면 null (화면: "새 문제를 다 풀었어요")', () => {
  ok(LU.pickNext(base({ exclude: BANK.map(q => q.id) })) === null, 'null 아님');
});

// 가짜 학생 시뮬레이션: PRD F3 완료 기준 "배정 문항의 예측 P가 0.75~0.90 안 95% 이상"
// (가) 규칙 자체 확인: 가짜 문항 120개(강마다 쉬움3·보통3·어려움2) / (나) 실제 연습 31문항 — 하루 5문항 × 5일
const REAL = require(path.join(__dirname, 'load_practice.js'))();
function seeded(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }  // mulberry32
function bigBank() { const qs = []; let i = 0; for (let L = 1; L <= 15; L++) for (const d of [1, 1, 1, 2, 2, 2, 3, 3]) qs.push(mcq('X' + (i++), L, d)); return qs; }
function simulate(bank, trueTheta, seed) {
  const rand = seeded(seed);
  let st = { theta: trueTheta + (rand() - 0.5) * 0.6, n: 12 };   // 진단 12문항 뒤 출발 θ ≈ 진짜 실력 ± 0.3
  const items = {}, history = [], reviewIds = new Set(); let inBand = 0, total = 0;
  for (let d = 0; d < 5; d++) {
    const today = LU.addDays('2026-12-01', d), recent = [], seen = [];
    for (let k = 0; k < 5; k++) {
      const p = LU.pickNext({ theta: st.theta, questions: bank, items, history, reviewIds: [...reviewIds], today, openUpTo: 15, recent, exclude: seen, rand });
      if (!p) break;
      const q = bank.find(x => x.id === p.qid); seen.push(q.id);
      const it = items[q.id] || { b: LU.initialB(q), n: 0 };
      const P = LU.pCorrect(st.theta, it.b, LU.guessRate(q));
      if (p.rule !== 'E4') { total++; if (P >= 0.75 && P <= 0.9) inBand++; }   // E4는 일부러 쉬운 문항을 내는 규칙이라 제외
      const truth = LU.pCorrect(trueTheta, LU.initialB(q), LU.guessRate(q));
      const outcome = rand() < truth ? O.SOLO : (rand() < 0.5 ? O.HINT : O.SHOWN);
      const e = LU.applyElo(st, it, q, LU.R_OF[outcome]); st = { theta: e.theta, n: e.n };
      history.push({ qid: q.id, day: today, outcome }); recent.push({ qid: q.id, lecture: q.lecture, R: LU.R_OF[outcome] });
      if (outcome !== O.SOLO) reviewIds.add(q.id);
    }
  }
  return { inBand, total };
}
function simGroups(bank) {
  const groups = [[-1.5, 'θ −1.5'], [-0.5, 'θ −0.5'], [0.3, 'θ 0.3'], [1.0, 'θ 1.0'], [1.8, 'θ 1.8']];
  const out = {}; let mid = [0, 0];
  for (const [th, label] of groups) {
    let a = 0, n = 0;
    for (let s = 1; s <= 40; s++) { const r = simulate(bank, th, s * 13); a += r.inBand; n += r.total; }
    out[label] = +(a / n * 100).toFixed(1);
    if (th >= 0.3) { mid[0] += a; mid[1] += n; }
  }
  out['θ≥0.3 합계'] = +(mid[0] / mid[1] * 100).toFixed(1);
  return out;
}
const SIM = {};
t('U-18', '가짜 학생 40명×5구간 시뮬레이션 (가) 문항이 충분하면(120개) θ≥0.3 학생의 95% 이상이 "맞힐 확률 75~90%" 문항을 받음', () => {
  SIM.big = simGroups(bigBank());
  ok(SIM.big['θ≥0.3 합계'] >= 95, JSON.stringify(SIM.big));
  return Object.entries(SIM.big).map(([k, v]) => `${k} ${v}%`).join(' / ');
});
t('U-18b', '(나) [참고·판정 안 함] 실제 연습 31문항으로는 같은 비율이 얼마인가', () => {
  SIM.real = simGroups(REAL);
  fs.writeFileSync(path.join(__dirname, 'sim_result.json'), JSON.stringify(SIM, null, 1));
  return Object.entries(SIM.real).map(([k, v]) => `${k} ${v}%`).join(' / ') + ' — 문항 수 부족(2~3일째 소진)·아주 쉬운 문항 없음';
});

console.log('■ 힌트 사다리 · 제출');
t('U-19', 'L1은 바로, L2는 10초 뒤, 건너뛰기 없음', () => {
  const s = LU.newItemState('PRACTICE');
  ok(LU.openHint(s, 1000, '', true).ok && s.level === 1, 'L1');
  const w = LU.openHint(s, 1000 + 9999, '', true); ok(!w.ok && w.reason === 'wait', 'L2 9.999초');
  ok(LU.openHint(s, 1000 + 10000, '', true).ok && s.level === 2, 'L2 10초');
});
t('U-20', 'L3는 "내 생각 한 줄"(공백만은 안 됨), L4는 답 1번 낸 뒤', () => {
  const s = LU.newItemState('PRACTICE'); LU.openHint(s, 0, '', true); LU.openHint(s, 10000, '', true);
  ok(LU.openHint(s, 20000, '   ', true).reason === 'thought', 'L3 공백');
  ok(LU.openHint(s, 20000, '권한 같아요', true).ok && s.level === 3, 'L3');
  ok(LU.openHint(s, 30000, '음', true).reason === 'submit-first', 'L4 제출 전');
  LU.submit(s, false);
  ok(LU.openHint(s, 30000, '음', true).ok && s.level === 4 && s.closed && s.outcome === O.SHOWN, 'L4');
});
t('U-21', '진단(DIAG)·평가(EVAL) 모드에서는 힌트가 꺼짐 / 힌트 없는 문항은 "준비 중"', () => {
  ok(LU.openHint(LU.newItemState('DIAG'), 0, 'x', true).reason === 'off', 'DIAG');
  ok(LU.openHint(LU.newItemState('EVAL'), 0, 'x', true).reason === 'off', 'EVAL');
  ok(LU.openHint(LU.newItemState('PRACTICE'), 0, 'x', false).reason === 'not-ready', '준비 중');
});
t('U-22', '결과 이름 4가지 (설계 ③ 표)', () => {
  let s = LU.newItemState('PRACTICE'); LU.submit(s, true); ok(s.outcome === O.SOLO, '혼자 맞힘');
  s = LU.newItemState('PRACTICE'); LU.openHint(s, 0, '', true); LU.submit(s, true); ok(s.outcome === O.HINT, '힌트로 해결');
  s = LU.newItemState('PRACTICE'); LU.submit(s, false); LU.submit(s, true); ok(s.outcome === O.SECOND, '두 번째에 맞힘');
  s = LU.newItemState('PRACTICE'); LU.submit(s, false); LU.openHint(s, 0, '', true); LU.submit(s, true); ok(s.outcome === O.HINT, '오답→힌트→정답 = 힌트로 해결');
  s = LU.newItemState('PRACTICE'); LU.submit(s, false); LU.submit(s, false); ok(s.closed && s.outcome === O.SHOWN, '2번 오답 = 정답 보고 이해');
  ok(LU.submit(s, true).ignored, '마감 뒤 제출은 무시');
  ok(LU.R_OF[O.SOLO] === 1 && LU.R_OF[O.HINT] === 0.5 && LU.R_OF[O.SECOND] === 0.5 && LU.R_OF[O.SHOWN] === 0, 'R값');
});

console.log('■ 경험치 (결재2 확정: 문항 완료 10, 복습 혼자 맞힘 +5)');
t('U-23', '연습: 결과와 상관없이 모두 10 XP', () => {
  for (const o of Object.values(O)) ok(LU.xpFor('PRACTICE', o, 0) === 10, o);
});
t('U-24', '복습: 혼자 맞힘 15(10+5), 그 밖 10', () => {
  ok(LU.xpFor('REVIEW', O.SOLO, 0) === 15, 'solo');
  ok(LU.xpFor('REVIEW', O.HINT, 0) === 10 && LU.xpFor('REVIEW', O.SHOWN, 0) === 10, 'other');
});
t('U-25', '하루 상한 200 XP (195까지 받았으면 5만), 빼는 일 없음', () => {
  ok(LU.xpFor('PRACTICE', O.SOLO, 195) === 5 && LU.xpFor('REVIEW', O.SOLO, 200) === 0 && LU.xpFor('PRACTICE', O.SOLO, 250) === 0, 'cap');
});

console.log('■ 복습 상자 · 연속 학습일');
t('U-26', '복습 상자: 연습 혼자 맞힘 아님 → 상자1(+1일) / 복습 혼자 맞힘 → 2(+3)·3(+7)·4(+14)·졸업 / 아니면 상자1', () => {
  ok(LU.reviewAfterPractice(O.SOLO, '2026-12-01') === null, 'solo 안 넣음');
  ok(JSON.stringify(LU.reviewAfterPractice(O.HINT, '2026-12-01')) === JSON.stringify({ box: 1, due: '2026-12-02' }), '상자1');
  ok(LU.reviewAfterReview({ box: 1 }, O.SOLO, '2026-12-02').due === '2026-12-05', '상자2 +3');
  ok(LU.reviewAfterReview({ box: 2 }, O.SOLO, '2026-12-05').due === '2026-12-12', '상자3 +7');
  ok(LU.reviewAfterReview({ box: 3 }, O.SOLO, '2026-12-12').due === '2026-12-26', '상자4 +14');
  ok(LU.reviewAfterReview({ box: 4 }, O.SOLO, '2026-12-26').done, '졸업');
  const back = LU.reviewAfterReview({ box: 3 }, O.HINT, '2026-12-12'); ok(back.box === 1 && back.due === '2026-12-13', '상자1로');
});
t('U-27', '오늘 복습: 오래 밀린 순 최대 5개, 같은 강 최대 2개, 미래 날짜 제외', () => {
  const es = [['a', 1, '2026-12-01'], ['b', 1, '2026-12-02'], ['c', 1, '2026-12-03'], ['d', 2, '2026-12-04'], ['e', 3, '2026-12-05'], ['f', 4, '2026-12-06'], ['g', 5, '2026-12-07'], ['h', 6, '2026-12-30']]
    .map(([qid, L, due]) => ({ qid, L, due, box: 1 }));
  const lec = id => es.find(e => e.qid === id).L;
  const r = LU.pickReviews(es, lec, '2026-12-10');
  ok(JSON.stringify(r) === JSON.stringify(['a', 'b', 'd', 'e', 'f']), JSON.stringify(r));
});
t('U-28', '연속 학습일: 3문항 이상 = 학습한 날, 주 2일 보호, 오늘 미완료는 안 끊김, 최장 기록 유지', () => {
  // 2026-12-07(월)~
  let s = LU.streak({ '2026-12-07': 3, '2026-12-08': 5, '2026-12-09': 3 }, '2026-12-09'); ok(s.current === 3 && s.studied === 3, JSON.stringify(s));
  s = LU.streak({ '2026-12-07': 3, '2026-12-08': 2 }, '2026-12-08'); ok(s.current === 1, '2문항 날은 학습일 아님(오늘 진행 중)');
  s = LU.streak({ '2026-12-07': 3, '2026-12-09': 3 }, '2026-12-09'); ok(s.current === 3 && s.protectedDays === 1, '하루 보호 ' + JSON.stringify(s));
  s = LU.streak({ '2026-12-07': 3 }, '2026-12-11'); ok(s.current === 0 && s.longest === 3, '3일 빠짐 → 끊김, 최장 3 ' + JSON.stringify(s));
  s = LU.streak({ '2026-12-07': 3 }, '2026-12-08'); ok(s.current === 1, '오늘 아직');
});
t('U-29', '참가자 코드: 6자리·대문자+숫자, 0·O·1·I 거절, 소문자·빈칸은 고쳐 받음', () => {
  ok(LU.isValidCodeShape(LU.normalizeCode(' test23 ')), 'test23');
  ok(!LU.isValidCodeShape('DEMO23'), 'DEMO23은 O가 있어 거절');
  ok(!LU.isValidCodeShape('DEMO2') && !LU.isValidCodeShape('DEMO20') && !LU.isValidCodeShape('DEMOO2') && !LU.isValidCodeShape('DEM1I2'), '거절');
});

const pass = results.filter(r => r.status === 'pass').length, fail = results.length - pass;
fs.writeFileSync(path.join(__dirname, 'unit_results.json'), JSON.stringify(results, null, 1));
console.log(`\n단위 테스트: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
