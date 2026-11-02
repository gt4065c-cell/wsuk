# 2단계 앱 M1 사용 설명서 (로컬 모드 + Supabase 모드)

> **한 줄 요약**: 코드 6자리로 들어가 → 진단 12문항 → 내 수준에 맞춘 오늘의 문제 5개 → 막히면 힌트 4단계 → 경험치까지, **서버 없이 이 브라우저 안에서 끝까지 동작**하는 시제품입니다. 같은 화면을 **실제 Supabase(edu-gamify)에 연결하는 Supabase 모드**도 들어 있습니다(주소 뒤 `?mode=supabase`).

- 1단계 앱(`04_제품개발팀/app/`)은 건드리지 않았습니다. 디자인(A안)과 꾸미기 파일만 복사해 썼습니다.
- 빌드 도구(설치가 필요한 개발 프로그램) 없이 **HTML·CSS·JS 파일만**으로 만들었습니다(1단계와 같음).
- 기본은 **로컬 모드(개발용)**입니다. 화면 맨 위 노란 띠로 표시되며, 기록은 그 브라우저에만 남습니다(다른 기기와 합쳐지지 않음).
- **Supabase 모드**는 노란 띠가 없고, 기록이 서버에 남아 휴대폰·노트북에서 같은 코드로 이어집니다(5장).

---

## 1. 내 컴퓨터에서 열어 보기 (1-2-3)

1. 터미널을 열고 이 폴더(`04_제품개발팀/app2`)로 이동한 뒤 아래 한 줄을 붙여 넣고 Enter:
   ```
   python3 -m http.server 8010 --bind 127.0.0.1 --directory public
   ```
   (윈도우는 `python3` 대신 `py`. `127.0.0.1` = 이 컴퓨터 안에서만 열림, 인터넷 공개 아님)
2. 크롬 주소창에 **`http://127.0.0.1:8010`** → 가짜 코드 **`TEST23`**(또는 `TEST45`·`TEST67`·`PLAY89`)를 넣고 별명을 정합니다.
   - 진단 12문항 → 결과 → [오늘의 학습으로] → [오늘의 학습 시작]
   - 휴대폰 화면처럼 보려면 F12 → 왼쪽 위 휴대폰 아이콘
3. 다 봤으면 터미널에서 **Ctrl + C**.

> 처음부터 다시 해 보고 싶으면: 크롬 F12 → Application(응용 프로그램) → Local storage → `lu2_`로 시작하는 줄 삭제 → 새로고침.
> 하루 뒤 복습을 미리 보고 싶으면(개발용): F12 → Console에 `localStorage.setItem('lu2_dev_day_offset','1')` → 새로고침. 되돌리려면 `'0'`.

## 2. 화면과 규칙 (무엇을 만들었나)

| 화면 | 하는 일 | 근거 |
|---|---|---|
| 코드 입력 | 영문 대문자+숫자 6자리(0·O·1·I 없음). 모양이 틀리거나 없는 코드는 거절. 다음부터 자동 로그인 | PRD F1 |
| 별명 | 처음 1번, 2~12글자, "실명은 쓰지 마세요" 안내 | PRD F1 |
| 진단 12문항 | 모두 같은 순서, 힌트 없음, 정오답은 끝난 뒤 한꺼번에. "아직 모르겠어요" 버튼. 중간에 나가면 이어 풀기, 10문항 전에는 연습 불가 | 맞춤학습 설계 ⑤ |
| 진단 결과 | 등급·점수 없이 "강한 강의 2 / 먼저 볼 강의 2 / 첫 연습 추천" + 해설 | ⑤ D6 |
| 홈 | 복습 n + 새 문제 0/5, 이번 주 학습량 XP·푼 문항, 연속 학습일(주 2일 쉬는 날 보호, 최장 기록). **레벨·등수·실력 숫자 없음** | 팀게임 설계 1-1·1-2 |
| 문제 | Elo로 고른 "맞힐 확률 75~90%" 문제, 4지선다는 보기 섞기, 제출 최대 2번(O/X는 1번 — 아래 4장) | 설계 ①③ |
| 힌트 4단계 | L1 바로 → L2는 10초 뒤 → L3는 10초 + "내 생각 한 줄" → L4(정답+해설)는 답을 1번 낸 뒤. 건너뛰기 없음 | 설계 ③ |
| 해설·경험치 | 결과 이름 4가지(혼자 맞힘 / 힌트로 해결 / 두 번째에 맞힘 / 정답 보고 이해). **경험치는 결과와 상관없이 10**, 복습에서 혼자 맞히면 **+5**. 하루 상한 200 | 결재2 확정 |
| 복습 상자 | 혼자 못 맞힌 문제 → 다음 날 복습 → 혼자 맞히면 3·7·14일 뒤, 아니면 다시 다음 날 | 설계 ② |

## 3. 파일 지도

| 파일 | 무엇인가요 | 인터넷에 올리나요? |
|---|---|---|
| `public/index.html` · `style.css` | 화면 뼈대 · 꾸미기(1단계 A안 + 2단계 추가) | 올림 |
| `public/js/config.js` | **설정 — 캡틴이 고칠 수 있는 유일한 파일**(모드, Supabase 주소·공개 열쇠, 열린 강, 개발용 코드) | 올림 |
| `public/js/loader.js` | 모드에 맞춰 필요한 파일만 순서대로 불러오기(Supabase 모드는 `data/`를 하나도 안 읽음) | 올림 |
| `public/vendor/supabase.js` | Supabase 연결 라이브러리(남이 만든 공개 부품). **외부 CDN(인터넷 공용 창고)에서 받지 않고 이 폴더에 넣어 둠.** Supabase 모드에서만 읽음 | 올림 |
| `public/js/logic.js` | 규칙 계산(Elo·문제 고르기·힌트·경험치·복습·연속일). 화면·저장과 분리 | 올림 |
| `public/js/store.js` | **데이터 저장 창구.** 로컬 모드(LocalStore)와 Supabase 모드(SupabaseStore)가 같은 모양으로 들어 있음 | 올림 |
| `public/js/app.js` | 화면 그리기와 버튼 동작 | 올림 |
| `public/data/practice.js` · `hints.js` · `diagnostic.js` | 연습 문항(정답 포함) · 힌트(검토 전 포함) · 진단 문항(**정답 없음**) — 자동 생성. **로컬 모드 전용** | **올리지 않음**(Supabase 모드는 서버에서 받음) |
| `public/data/dev_diag_key.js` | **[개발용] 진단 정답.** 로컬 모드에서 진단을 끝낼 때만 읽음 | **절대 올리지 않음** |
| `tools/make_deploy.py` | 배포용 폴더(`deploy_public/`) 만들기: `data/` 통째로 빼고 MODE를 supabase로. 업로드는 안 함 | — |
| `tools/build_data.py` | 교육기획팀 원본 → 위 데이터 파일 만들기. 평가·주간 점검 문항은 넣지 않고, 새면 실패 | — |
| `tests/` | 자동 테스트(4장). `mock_supabase.js` = 시험용 가짜 Supabase | — |
| `supabase/schema.sql` | Supabase 표·보안 규칙·서버 함수 초안 | — |
| `public/admin.html` · `public/js/admin.js` | **[M2] 교수 화면**(교수 이메일 로그인 → 많이 틀린 문항·강별 정답률·팀별 주간 목표) | 올림 |
| `supabase/30_m2_teams_admin.sql` | **[M2] 팀 표·팀 함수·교수 화면 함수** (schema.sql 다음에 실행) | — |
| `supabase/local_test/run_m2_local.sh` | [개발용] 임시 PostgreSQL로 위 SQL 시험 | — |

### 문항·힌트를 고친 뒤 (1-2-3)
1. `03_교육기획팀/문항은행/`의 원본을 고칩니다(앱의 `public/data/`는 직접 고치지 않음).
2. 이 폴더에서 `python3 tools/build_data.py`
3. `[빌드 성공] 연습 106 · 진단 12 · 힌트 31 (검토 끝 0) · 평가 0`처럼 나오면 끝. 새로고침하면 반영됩니다.

> 힌트는 교수님 검토가 끝난 것(`hint_status: reviewed`)만 학생에게 보입니다. **로컬 모드에서는 검토 전 힌트도 "검토 전 힌트(개발용)" 표시를 달고 보여 줍니다**(캡틴이 직접 보며 검토하도록). 끄려면 `config.js`의 `SHOW_DRAFT_HINTS`를 `false`로.

## 4. 자동 테스트 (비서실이 대신 돌림)

이 폴더에서:
```
node tests/unit_logic.js   # 규칙 계산 단위 테스트 (1초)
node tests/run_e2e.js      # 화면 흐름 자동 테스트 (약 1분, Playwright 필요)
node tests/run_e2e_supabase_mock.js   # Supabase 모드 시험 — 가짜 서버로 (진짜 DB에는 접속 안 함)
node tests/run_e2e_m2.js   # [M2 1차] 팀 카드 + 교수 화면 (로컬·가짜 서버·배포 폴더·SQL, PostgreSQL 있으면 SQL 66개 시험도)
bash supabase/local_test/run_m2_local.sh   # [M2 1차] SQL만 따로 시험 (임시 DB를 만들고 끝나면 지움)
```
결과 기록: `04_제품개발팀/테스트보고서/2026-11-02_app2_M1_자체테스트.md`, `2026-11-02_app2_Supabase연결_자체테스트.md`

## 5. Supabase 모드 (실제 서버 연결)

### 5-1. 이미 끝난 것 (비서실장, 2026-11-02)
- Supabase 프로젝트 **edu-gamify**에 `supabase/schema.sql` 적용(보안 점검 반영본), 문항 221·정답 221·힌트 31(모두 검토 전 → 학생에게 안 보임) 입력, 익명 로그인 켬.
- 앱 설정(`public/js/config.js`)에 아래 두 값이 들어 있습니다. **둘 다 원래 공개해도 되는 값**이고, 실제 보호는 DB 규칙(RLS)이 합니다.
  - 주소 `SUPABASE_URL`: `https://ebquzmmvkknknpmiqnyk.supabase.co`
  - 공개용 열쇠 `SUPABASE_ANON_KEY`: `sb_publishable_daID88tVdfivXFQFF5GyoQ_YTlFdYMm`
  - ⛔ `service_role`(관리자) 키·`sb_secret_…` 키·DB 비밀번호는 어떤 파일·채팅에도 넣지 않습니다. 앱은 그 열쇠 없이 동작합니다.
- 연결 라이브러리: **@supabase/supabase-js 2.118.0**의 UMD 파일(`dist/umd/supabase.js`)을 `public/vendor/supabase.js`로 넣음.
  - 출처: npm 공식 저장소 `npm pack @supabase/supabase-js@2.118.0` (묶음 지문 sha1 `a590a3a0b301cb336c771a81c8d37a4bbc2647cf` = npm 공식값과 일치)
  - 파일 지문 sha256 `ee3be8de192b97cb1d73d1e95d6b82bb1f6b658c0f97c4ef757fc331996ed3d3` (자동 시험 S-01이 매번 확인), 크기 약 213KB, MIT 라이선스(`public/vendor/supabase-LICENSE.txt`)
  - 바꿀 때: 위 명령으로 새 버전을 받아 파일을 바꾸고, 이 칸의 버전·지문과 `tests/run_e2e_supabase_mock.js`의 `VENDOR_SHA256`을 함께 고칩니다.

### 5-2. Supabase 모드로 열어 보기 (1-2-3)
1. 1장처럼 임시 서버를 켭니다(`python3 -m http.server 8010 --bind 127.0.0.1 --directory public`).
2. 크롬 주소창에 **`http://127.0.0.1:8010/?mode=supabase`** → 노란 띠가 없으면 Supabase 모드입니다.
   - 설정 파일을 고치지 않아도 이 주소로 연 창에서만 Supabase 모드가 됩니다. 늘 Supabase로 쓰려면 `config.js`의 `MODE: "local"`을 `"supabase"`로.
   - 들어가려면 **Supabase에 등록된 진짜 코드 카드**가 필요합니다(로컬 모드 가짜 코드 `TEST23` 등은 서버에 없으면 "등록되지 않은 코드"). 코드 카드 만들기는 아래 5-4.
3. 다 봤으면 터미널에서 Ctrl + C. (Supabase 모드 기록은 서버에 남습니다 — 시험용 코드로만 해 주세요)

### 5-3. Supabase 모드에서 앱이 하는 일 (개발자 메모)
| 화면 동작 | 부르는 것 | 메모 |
|---|---|---|
| 첫 화면 열기 | `auth.getSession()` | 저장된 로그인이 있으면 다시 씀. **열기만 해서는 계정을 만들지 않음** |
| [들어가기] | `auth.signInAnonymously()`(세션 없을 때만) → `rpc claim_code(p_code)` | 모양이 틀린 코드는 서버에 묻지 않음. 오류 `shape`·`unknown`·`too_many`(10분에 10번) |
| 별명 | `rpc set_nickname(p_name)` | |
| 진단 문항 | `questions` 표 `pool=diagnostic`, `diag_order` 순 | 정답 칸은 요청하지 않음(DB 규칙상 읽을 수도 없음) |
| 진단 답 · 끝내기 | `rpc diag_answer(p_qid, p_choice)` · `rpc diag_finish()` | "모르겠어요" = `p_choice: null`. 채점·해설은 서버가 |
| 연습 문항·정답·해설 | `questions`(`pool=practice`) + `question_keys` | 처음 한 번 받아 두고 다시 씀 |
| 힌트 | `hints` 표 | DB 규칙이 **검토 끝난(reviewed) 연습 문항 힌트만** 돌려줌 → 지금은 0개라 모든 문제가 "힌트 준비 중"(답을 한 번 낸 뒤 [정답과 해설 보기]는 열림) |
| 홈 숫자 | `rpc today_summary()` | 연속 학습일만 화면의 `logic.js streak()`로 계산 |
| 다음 문제 · 마감 | `rpc next_practice(p_recent, p_exclude)` · `rpc close_item(p_qid, p_mode, p_level, p_submits)` | Elo·경험치·복습 상자는 서버 계산 |
| [다른 코드로 들어가기] | `auth.signOut({scope:"local"})` | 이 기기 로그인만 지움. 서버 기록은 그대로 |
- 서버 오류 이름(`NOT_LINKED`, `DIAG_TOO_FEW`, `NOT_DUE`, `BAD_SUBMITS` 등)과 인터넷 끊김은 `store.js`의 `explainError()`가 쉬운 한국어 한 줄로 바꿔 화면에 보여 줍니다.
- Supabase 모드는 `public/data/` 파일을 **하나도 읽지 않습니다**(`dev_diag_key.js` 포함). 자동 시험 E-21·S-08·S-21·S-22가 확인합니다.

### 5-4. 캡틴이 할 일 (필요할 때만)
1. **코드 카드 만들기**(학생에게 나눠 줄 때): Supabase → SQL Editor에서 `select * from admin_make_codes(30, '2027-1');` → 나온 코드 목록은 **교수님 개인 노트에만** 옮깁니다(저장소·채팅·외부 AI에 올리지 않음). 개발자·비서실은 이 함수를 부르지 않습니다.
2. **힌트 공개**: 교수님이 검토를 끝낸 힌트만 `hint_status = 'reviewed'`로 바꾸면 그 문제부터 힌트가 보입니다.

### 5-5. 인터넷에 올릴 파일 고르기 (배포 준비 — 실제 배포는 캡틴 결재 후)
1. 이 폴더에서 `python3 tools/make_deploy.py`
2. `[배포용 폴더 완성] … data/ 없음 · MODE=supabase`가 나오면 `deploy_public/` 폴더가 올릴 파일 전부입니다.
   - `data/` 폴더를 통째로 뺍니다: 진단 정답(`dev_diag_key.js`)은 물론, 검토 전 힌트가 든 `hints.js`도 서버 모드에선 필요 없으므로 함께 뺌.
   - 복사본의 `config.js`만 `MODE: "supabase"`로 바뀝니다(원본 `public/`은 그대로 로컬 모드).
   - 스스로 검사(data/ 없음, 진단 정답 없음, 관리자 열쇠 모양 없음)에서 하나라도 걸리면 "[실패]"로 멈춥니다.
   - [M2] 교수 화면(`admin.html`·`js/admin.js`)도 함께 들어가고, 가짜 교수 이메일(`DEV_ADMIN_EMAILS`)은 비우며, 검색 차단(noindex) 표시와 example.com 이 아닌 이메일 주소가 없는지도 검사합니다.
   - 저장소에 이미 있는 `deploy_public/`(M1 체험판)은 이번에 다시 만들지 않았습니다 — 다시 만들고 올리는 것은 결재 후.
3. `deploy_public/`은 깃에 올라가지 않습니다(`.gitignore`). Vercel 등에 올리는 일은 **결재3 승인 뒤** 비서실장이 진행합니다.

---

## 6. M2 1차 — 팀 + 교수 화면 (2026-11-02, DB 적용 전)

> **한 줄 요약**: 학생 홈에 **팀 카드**(팀원 별명 + 이번 주 팀 합계 + 참여 목표 달성 여부)가 생기고, 교수님 전용 **교수 화면**(`admin.html`)에서 반 전체 많이 틀린 문항과 팀별 주간 달성을 봅니다. AI 튜터·주간 공통 점검은 다음 차수입니다.

### 6-1. 규칙 (이름 = 실제 의미)
| 항목 | 규칙 |
|---|---|
| 팀 | 같은 기수 3~4명. 교수님이 SQL 한 줄로 짜 줌(실력이 고르게 섞이도록 지그재그), 팀 이름은 무작위 번호("7팀") |
| **주간 팀 참여 목표** | 활동 중인 팀원 **모두 이번 주(월~일) 15문항**을 끝까지 풀기. 팀 진행 = 팀원별 min(내 문항 수, 15)의 합 → 한 사람이 혼자 채울 수 없음 |
| 세는 것 | 경험치를 받은 풀이만(같은 문제 다시 풀기·하루 상한 넘은 풀이는 안 셈) |
| 학생이 보는 것 | 팀 이름, 팀원 별명(가나다순)·"팀 활동 쉼", 팀 합계/목표, 달성 여부, **내** 이번 주 문항 수, 같은 기수의 달성 팀 이름 |
| 학생이 못 보는 것 | 팀원 개인의 XP·문항 수·정오답·숨은 실력값, 개인 등수, 달성 못 한 다른 팀 |
| 팀 활동 쉬기 | 홈 카드에서 언제든. 개인 학습·XP 그대로, 팀 목표 계산에서 빠짐 |
| 주의 | 이것은 **"참여 목표"**입니다. 설계 문서의 "학습목표 달성"(주간 공통 점검 점수)은 공통 점검을 만드는 다음 차수에 따로 붙습니다 |

### 6-2. 교수 화면 열어 보기 — 로컬 모드 (1-2-3)
1. 1장처럼 임시 서버를 켭니다: `python3 -m http.server 8010 --bind 127.0.0.1 --directory public`
2. 크롬에서 **`http://127.0.0.1:8010/admin.html`** → 이메일 칸에 가짜 교수 이메일 **`prof@example.com`** → [들어가기]
   - 가짜 학생 50명의 **가짜 통계**가 보입니다(노란 띠 + "가짜" 안내). 학생 홈 팀 카드는 `index.html`에서 `TEST23`으로 들어가면 보입니다(가짜 팀원 바다·소나무).
3. 다 봤으면 터미널에서 Ctrl + C.

### 6-3. Supabase 모드에서 교수 화면을 쓰려면 (DB 적용 후, 비서실장·캡틴)
1. **SQL 적용**(비서실장): `supabase/30_m2_teams_admin.sql`을 실행(schema.sql 다음). 적용 전에도 학생 앱은 그대로 동작합니다(팀 카드만 안 보임).
2. **교수 계정 등록**(캡틴, Supabase 관리 화면):
   - Authentication → Users → **Add user / Invite**로 교수님 이메일 계정을 만듭니다(교수 화면은 새 계정을 만들지 않음).
   - Authentication → URL Configuration → **Redirect URLs**에 교수 화면 주소를 추가합니다(예: `http://127.0.0.1:8010/admin.html?mode=supabase`, 배포 후엔 그 주소의 `/admin.html`).
   - "Confirm email(메일 확인)"은 **켜 둔 채로** 둡니다.
   - SQL Editor에서 `insert into admins (email) values ('교수님 이메일');` — **이메일은 이 저장소·채팅·외부 AI에 쓰지 않습니다**(저장소 공개).
3. **팀 짜기**(학생들이 별명을 정한 뒤, 2주차): SQL Editor에서 `select * from admin_assign_teams('2027-1');`
   - 다시 짜기: `admin_assign_teams('2027-1', true)` · 한 명 옮기기: `select admin_move_student('코드', '3팀');` · 1인 목표 바꾸기: `update teams set goal_per_member = 10 where cohort = '2027-1';`
   - 결과에 나오는 코드는 교수님 화면에서만 봅니다.

교수 화면 로그인: `admin.html?mode=supabase` → 교수 이메일 → 메일의 링크를 **같은 브라우저에서** 누름(메일에 6자리 숫자가 있으면 숫자로도 가능). 서버 함수가 매번 "admins 표의 이메일 + 메일 확인 끝난 계정 + 익명 아님"을 다시 확인하므로, 학생 기기로 열면 "교수 계정이 아니에요"가 나옵니다.

### 6-4. 서버 함수 (30_m2_teams_admin.sql)
| 함수 | 누가 | 하는 일 |
|---|---|---|
| `my_team_summary()` | 학생(로그인 기기) | 내 팀 요약 (6-1의 "학생이 보는 것"만) |
| `set_team_off(p_off)` | 학생 | 팀 활동 쉬기/다시 하기 |
| `admin_whoami()` | 로그인한 누구나 | 교수면 기수 목록, 아니면 `{admin:false}`만 |
| `admin_item_stats(p_cohort, p_min_n=3, p_limit=10)` | 교수만(아니면 NOT_ADMIN) | 많이 틀린 문항(연습=학생마다 첫 풀이, 진단 포함, 응답 3명 미만 제외)·강별 정답률·인원 |
| `admin_team_week(p_cohort, p_week)` | 교수만 | 팀별 주간 진행·달성, 팀원 별명·쉼·그 주 활동 여부(개인 숫자 없음) |
| `admin_assign_teams` · `admin_move_student` | SQL 편집기만 | 팀 짜기·옮기기 |
- 새 표 `teams`: RLS 켬, 학생·익명 권한 0. 새 함수 11개 모두 anon에서 회수, 로그인한 사람에게는 위 5개만 허용.
- `next_practice`·`close_item` 등 M1 함수는 건드리지 않았습니다(자동 시험 M-66·N-29가 확인).
