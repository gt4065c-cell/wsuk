// 테스트 도우미: 앱이 쓰는 연습 문항 파일(public/data/practice.js)을 node에서 읽기
const fs = require('fs');
const path = require('path');
const vm = require('vm');
module.exports = function loadPractice(name = 'practice.js', varName = 'LU_PRACTICE') {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'data', name), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  const v = sandbox.window[varName];
  return v && v.questions ? v.questions : v;
};
