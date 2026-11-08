# 루키 키우기 앱 (app3_rookie) — M1 첫 조각: 스테이지 엔진 + 1강

> 한 줄 요약: 엔진(js/)은 그대로 두고 `content/lectureNN.json` 하나를 넣으면 강이 하나 늘어납니다. 서버는 없고, 기록은 휴대폰 브라우저 안(localStorage)에만 남습니다.

## 폴더
| 파일 | 하는 일 |
|---|---|
| `index.html`, `css/app.css` | 화면 틀 (디자인 규격 2026-11-05, 360~430px) |
| `js/core.js` | 저장, 말풍선, 도움 3단계, 끌기(누르고-누르기도 됨), **루키 규칙 수첩** |
| `js/rookie.js` | 루키 그림(SVG 1벌, 표정 4종, 장식 7단계), 직급 이름 |
| `js/parts.js` | 조작 부품 10종 + 보조 장면(대화·문의함·작동 기록·갈래 `branch`·수첩 적용 `apply`) |
| `js/engine.js` | 한 강 실행(입구 → 도입 → 업무 → 평가 3문제 → LEVEL UP → 결과·30강 지도), 이어 하기 |
| `content/course.json` | 30강 틀(층·직급·승진 강), 열린 강 번호 `ready` |
| `content/lecture01.json` | 1강 내용 (대본 줄 번호 `src` 포함) |
| `tests/` | 내용 검사기, 360px 자동 시험, 시험용 가짜 강(`fixtures/lecture99.json`) |

## 직접 열어 보기 (내 컴퓨터에서만, 인터넷 공개 아님)
1. 터미널에서 `cd 04_제품개발팀/app3_rookie` 후 `python3 -m http.server 8080 --bind 127.0.0.1`
2. 브라우저에서 `http://127.0.0.1:8080` 열기 (개발자 도구에서 휴대폰 360px 보기 권장)
3. 처음부터 다시 하려면 첫 화면 맨 아래 "이 휴대폰의 기록 지우기"
- 파일을 두 번 눌러 직접 열면(file://) 내용 파일을 못 읽습니다. 반드시 1번처럼 엽니다.

## 시험
- `node tests/validate_content.js` — 말풍선 16자×2줄, 업무 2~5개, 평가 3문제 중 새 사례 1개, 근거 줄, 수첩 가르치기 유무
- `node tests/run_e2e.js` — 가짜 학생 2명(맞게/틀리게 가르침) 360px 끝까지, 이어 하기, 부품 4종 → `tests/e2e_results.json`, `tests/screenshots/`

## 새 강 넣기
1. `content/lecture01.json`을 본떠 `lecture02.json` 작성 (장면 종류는 `js/parts.js` 맨 위 설명)
2. `node tests/validate_content.js` 통과
3. `content/course.json`의 `ready`에 2 추가

## 루키 규칙 수첩 (AI 없이 규칙 + 갈래)
- `pick`의 `"mode":"teach"`(또는 `give`의 `note`)로 고른 규칙이 맞든 틀리든 수첩에 그대로 적힙니다.
- `apply` 장면이 그 규칙으로 실제 일을 시키고, 틀린 규칙이면 결과(엉뚱한 답장·게시판 댓글·점수 변경)를 보여 준 뒤 다시 가르치게 합니다(도움 3단계).
- 1강: 수첩 1번 → 업무 2 문의함, 2번 → 업무 3 게시판, 3번 → 평가 3번(새 사례)에서 루키 행동이 바뀝니다.
