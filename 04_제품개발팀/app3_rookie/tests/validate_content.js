// 강 내용 파일 검사기 — 강을 저장할 때마다 자동으로 글 길이·구조를 셉니다 (사람이 세지 않음)
// 실행: node 04_제품개발팀/app3_rookie/tests/validate_content.js [lecture01.json ...]
// 기준: 디자인 규격 1-3 (말풍선 16자 x 2줄, 팀장 답 18자, 질문 줄 20자, 카드 줄 22자),
//       결재2 확정 (업무 2~5개, 평가 3문제 중 새 사례 1개 이상, 업무마다 대본 근거 줄, 수첩 가르치기 1번 이상)
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'content');
const PARTS = ['sort', 'match', 'order', 'spot', 'pick', 'fill', 'reply', 'swipe', 'give', 'build'];
const AUX = ['talk', 'say', 'show', 'add', 'inbox', 'study', 'draft', 'log', 'wait', 'branch', 'apply', 'go'];
const NAME = '루키';

function check(file) {
  const L = JSON.parse(fs.readFileSync(file, 'utf8'));
  const errors = [], warns = [];
  const len = s => [...String(s).replace(/\{name\}/g, NAME).replace(/\*/g, '')].length;
  const bubble = (s, where) => {
    if (!s) return;
    const t = typeof s === 'string' ? s : s.t;
    if (!t) return;
    const lines = String(t).split('|');
    if (lines.length > 2) errors.push(`${where}: 말풍선 ${lines.length}줄 (최대 2줄) — "${t}"`);
    lines.forEach(x => { if (len(x) > 16) errors.push(`${where}: 말풍선 한 줄 ${len(x)}자 (최대 16자) — "${x}"`); });
    if (typeof s === 'object' && s.m && !['normal', 'happy', 'confused', 'think'].includes(s.m)) errors.push(`${where}: 표정 이름 "${s.m}" 없음`);
  };
  const short = (s, max, what, where) => { if (s && len(String(s).replace(/\|/g, '')) > max) errors.push(`${where}: ${what} ${len(s)}자 (최대 ${max}자) — "${s}"`); };
  const ids = new Set();
  const types = {};
  let teach = 0;
  const noteKs = {}, branches = [];
  function walk(step, where) {
    if (!step || typeof step !== 'object') return;
    if (Array.isArray(step)) { step.forEach((s, i) => walk(s, where + '[' + i + ']')); return; }
    if (step.type) {
      types[step.type] = (types[step.type] || 0) + 1;
      if (![...PARTS, ...AUX].includes(step.type)) errors.push(`${where}: 모르는 장면 종류 "${step.type}"`);
      if (step.id && PARTS.includes(step.type)) { if (ids.has(step.id)) errors.push(`${where}: id 중복 ${step.id}`); ids.add(step.id); }
      ['say', 'okSay', 'fixSay', 'doneSay', 'then'].forEach(k => bubble(step[k], where + '.' + k));
      ['hint2', 'nopeSay', 'fbDefault', 'okSay', 'moreSay', 'fbWrong'].forEach(k => typeof step[k] === 'string' && bubble(step[k], where + '.' + k));
      if (step.prompt) short(step.prompt, 20, '질문 줄', where);
      if (step.type === 'talk') step.lines.forEach((l, i) => { bubble(l, where + '.lines[' + i + ']'); short(l.r, 18, '팀장 답 버튼', where + '.lines[' + i + ']'); });
      if (step.type === 'say') bubble(step, where);
      if (step.opts) {
        step.opts.forEach((o, i) => { bubble(o.fb, where + '.opts[' + i + '].fb'); bubble(o.then, where + '.opts[' + i + '].then'); if (o.r) short(o.r, 18, '팀장 답 버튼', where + '.opts[' + i + ']'); });
        if (step.mode !== 'teach' && step.type !== 'reply' && !step.opts.some(o => o.ok)) errors.push(`${where}: 정답 보기(ok)가 없음`);
      }
      if (step.mode === 'teach' || (step.type === 'give' && step.note)) {
        teach++;
        const list = step.opts || step.items;
        const oks = list.filter(o => o.ok).length;
        if (oks !== 1) errors.push(`${where}: 수첩 가르치기는 맞는 규칙이 정확히 1개여야 함 (지금 ${oks})`);
        if (!list.some(o => !o.ok && !o.reject)) errors.push(`${where}: 틀리게 가르칠 수 있는 보기가 없음 (루키 규칙 수첩 효과가 안 생김)`);
        if (!step.note) errors.push(`${where}: note(수첩 칸 이름) 없음`);
        // 2강부터: 보기 3개 이상 (다시 가르칠 때 도움 2·3단계가 의미 있게)
        if (L.lecture >= 2 && list.filter(o => !o.reject).length < 3) errors.push(`${where}: 수첩 보기 ${list.length}개 (2강부터 3개 이상)`);
        noteKs[step.note] = new Set([...(noteKs[step.note] || []), ...list.filter(o => !o.reject).map(o => o.k)]);
      }
      if (step.type === 'branch' && step.cases) branches.push({ where, note: step.note, cases: step.cases, ok: step.ok, bad: step.bad });
      if (step.type === 'apply' && !step.reteach) errors.push(`${where}: apply 에 reteach 없음`);
      if (step.fbByBin) Object.entries(step.fbByBin).forEach(([k, v]) => bubble(v, where + '.fbByBin.' + k));
      if (step.items && step.type === 'give') step.items.forEach((o, i) => { bubble(o.fb, where + '.items[' + i + '].fb'); bubble(o.then, where + '.items[' + i + '].then'); });
      if (step.cards) step.cards.forEach((c, i) => { if (c.quiz) walk(Object.assign({ type: 'pick' }, c.quiz), where + '.cards[' + i + '].quiz'); });
    }
    Object.entries(step).forEach(([k, v]) => { if (v && typeof v === 'object' && !['opts', 'items', 'cards'].includes(k)) walk(v, where + '.' + k); });
  }
  walk(L.intro, 'intro');
  if (!Array.isArray(L.tasks) || L.tasks.length < 2 || L.tasks.length > 5) errors.push(`업무 수 ${L.tasks && L.tasks.length} (2~5개)`);
  (L.tasks || []).forEach((t, i) => {
    if (!t.src) errors.push(`업무 ${i + 1} (${t.id}): 대본 근거 줄(src) 없음`);
    if (!t.card || !(L.cards || []).some(c => c.id === t.card)) errors.push(`업무 ${i + 1}: 능력 카드 ${t.card} 없음`);
    walk(t.steps, 'tasks[' + i + ']');
  });
  // 눈높이 갈림길: 2번 틀리면 쉬운 예시(easy), 첫 시도에 다 맞히면 도전 업무(hard) — 강마다 최소 1곳씩
  let easyN = 0, hardN = 0;
  (L.tasks || []).forEach((t, i) => {
    const w = '업무 ' + (i + 1) + ' (' + t.id + ')';
    if (t.easy) {
      easyN++; const E = t.easy;
      if (!E.title) errors.push(`${w}.easy: 제목(title) 없음`); else short(E.title, 14, '쉬운 예시 제목', w + '.easy');
      if (!Array.isArray(E.lines) || E.lines.length < 2 || E.lines.length > 4) errors.push(`${w}.easy: 줄 수 ${E.lines && E.lines.length} (2~4줄)`);
      (E.lines || []).forEach((l, k) => short(l, 26, '쉬운 예시 줄', w + '.easy.lines[' + k + ']'));
      bubble(E.say, w + '.easy.say');
      if (!E.src) errors.push(`${w}.easy: 대본 근거 줄(src) 없음 (없으면 "(미확인)")`);
    }
    if (t.hard) {
      hardN++; const H = t.hard;
      if (!H.q) errors.push(`${w}.hard: 문제(q) 없음`); else short(H.q, 50, '도전 문제', w + '.hard');
      if (!Array.isArray(H.opts) || H.opts.length < 2 || H.opts.length > 4) errors.push(`${w}.hard: 보기 ${H.opts && H.opts.length}개 (2~4개)`);
      else if (H.opts.filter(o => o.ok).length !== 1) errors.push(`${w}.hard: 정답 보기는 정확히 1개`);
      (H.opts || []).forEach((o, k) => { short(o.t, 22, '도전 보기', w + '.hard.opts[' + k + ']'); bubble(o.fb, w + '.hard.opts[' + k + '].fb'); });
      if (!H.e) errors.push(`${w}.hard: 해설(e) 없음`); else short(H.e, 70, '도전 해설', w + '.hard');
      if (!H.src) errors.push(`${w}.hard: 대본 근거 줄(src) 없음 (없으면 "(미확인)")`);
    }
  });
  if (!easyN) errors.push('눈높이 갈림길: 쉬운 예시(easy)가 있는 업무가 없음 (최소 1곳)');
  if (!hardN) errors.push('눈높이 갈림길: 도전 업무(hard)가 있는 업무가 없음 (최소 1곳)');
  // 기억 다지기: 장면 없이 혼자 읽히는 평가 문항 2개 이상 (순서·보기를 섞어 다시 물음)
  const revPool = (L.exam || []).filter(q => !q.scene && !q.after).length;
  if (revPool < 2) errors.push(`기억 다지기용 평가 문항(장면 없음) ${revPool}개 (2개 이상)`);
  (L.cards || []).forEach(c => { (c.pts || []).forEach(p => short(p, 22, '카드 줄', c.id)); if (!c.src) warns.push(`${c.id}: 카드 근거 줄 없음`); });
  if (!Array.isArray(L.exam) || L.exam.length !== 3) errors.push(`평가 문제 ${L.exam && L.exam.length}개 (3개)`);
  if (!(L.exam || []).some(q => q.newCase)) errors.push('평가 3문제 중 새 사례 문제(newCase) 없음');
  (L.exam || []).forEach((q, i) => {
    if (!(q.a >= 0 && q.a < q.c.length)) errors.push(`평가 ${i + 1}: 정답 번호 이상`);
    if (!q.src) errors.push(`평가 ${i + 1}: 근거(src) 없음`);
    walk(q.scene, 'exam[' + i + '].scene'); walk(q.after, 'exam[' + i + '].after');
  });
  (L.examSay || []).forEach((s, i) => bubble(s, 'examSay[' + i + ']'));
  Object.entries(L.examResult || {}).forEach(([k, s]) => bubble(s, 'examResult.' + k));
  if (!teach) errors.push('수첩에 가르치는 장면(teach)이 없음');
  // 갈래(cases)가 수첩 보기를 빠짐없이 다루는지 (빠지면 루키가 아무 일도 안 함)
  branches.forEach(b => { (noteKs[b.note] ? [...noteKs[b.note]] : []).forEach(k => { if (!b.cases[k] && !(b.ok && b.bad)) errors.push(`${b.where}: 갈래에 수첩 보기 "${k}" 경우가 없음`); }); if (!noteKs[b.note]) errors.push(`${b.where}: 가르친 적 없는 수첩 칸 ${b.note}`); });
  const kinds = PARTS.filter(p => types[p]);
  if (kinds.length < 3) errors.push(`부품 종류 ${kinds.length}가지 (최소 3가지)`);
  return { file: path.basename(file), errors, warns, partsUsed: kinds, teach, tasks: (L.tasks || []).length, easy: easyN, hard: hardN, revPool };
}

const files = process.argv.slice(2).length ? process.argv.slice(2).map(f => path.resolve(f)) : fs.readdirSync(DIR).filter(f => /^lecture\d+\.json$/.test(f)).map(f => path.join(DIR, f));
let bad = 0;
const out = files.map(check);
out.forEach(r => {
  console.log(`[${r.errors.length ? '실패' : '통과'}] ${r.file} — 업무 ${r.tasks}개, 부품 ${r.partsUsed.join('·')}, 수첩 가르치기 ${r.teach}번, 쉬운 예시 ${r.easy}곳·도전 업무 ${r.hard}곳, 기억 다지기 문항 ${r.revPool}개`);
  r.errors.forEach(e => console.log('   ✗ ' + e));
  r.warns.forEach(e => console.log('   △ ' + e));
  bad += r.errors.length;
});
if (require.main === module) process.exitCode = bad ? 1 : 0;
module.exports = { check };
