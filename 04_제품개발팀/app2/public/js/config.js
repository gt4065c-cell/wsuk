/* =========================================================
   설정 (config.js) — 캡틴이 고칠 수 있는 곳은 이 파일뿐입니다.

   MODE
     "local"    : 기본값. 서버 없이 이 브라우저 안에만 저장 + 가짜 사용자 코드.
     "supabase" : 실제 Supabase(edu-gamify)에 저장. 진짜 코드 카드가 있어야 들어갈 수 있음.
     주소 뒤에 ?mode=supabase 를 붙이면 이 파일을 고치지 않아도 그 창에서만 Supabase 모드로 열림.
     (예: http://127.0.0.1:8010/?mode=supabase — 새로고침해도 주소에 붙어 있으면 유지)

   ⚠️ 여기에 넣어도 되는 것: Supabase 주소, "공개용 열쇠(anon / publishable key)"
      — 원래 공개해도 되는 열쇠이고, 실제 보호는 DB의 RLS 규칙(줄 단위 출입 규칙)이 합니다.
   ⛔ 절대 넣으면 안 되는 것: service_role 키(관리자 열쇠), Anthropic 키, 비밀번호.
   ========================================================= */
window.LU_CONFIG = {
  MODE: "local",

  // Supabase 모드에서만 사용. 둘 다 "공개해도 되는 값"(주소 + publishable key)
  SUPABASE_URL: "https://ebquzmmvkknknpmiqnyk.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_daID88tVdfivXFQFF5GyoQ_YTlFdYMm",

  // 교수님이 열어 둔 강의: 이 번호 강까지만 연습 문제로 나옴 (캡틴 체험용으로 30강 전부 열어 둠)
  OPEN_UP_TO_LECTURE: 30,

  // [로컬 모드 전용 · 개발용] 교수 검토 전 힌트도 '검토 전' 표시를 달고 보여 줌 (캡틴이 힌트를 직접 보며 검토하도록)
  // Supabase 모드에서는 이 설정과 상관없이 검토 끝난 힌트만 나옴 (DB 규칙 hints_reviewed)
  SHOW_DRAFT_HINTS: true,

  // [로컬 모드 전용 · 개발용] 가짜 참가자 코드. 실제 학생 코드가 아닙니다.
  // (Supabase 모드에서는 코드 목록이 Supabase 안에만 있고 이 줄은 쓰이지 않음)
  DEV_CODES: ["TEST23", "TEST45", "TEST67", "PLAY89"]
};

/* 주소에 ?mode=supabase 가 있으면 그 창에서만 Supabase 모드로.
   (반대로 ?mode=local 은 받지 않음 — 배포본을 주소만 바꿔 개발용 로컬 모드로 여는 일을 막기 위해) */
(function () {
  try {
    if (new URLSearchParams(window.location.search).get("mode") === "supabase") window.LU_CONFIG.MODE = "supabase";
  } catch (e) { /* 아주 오래된 브라우저: 설정 파일 값 그대로 */ }
})();
