/* =========================================================
   설정 (config.js) — 캡틴이 고칠 수 있는 곳은 이 파일뿐입니다.

   MODE
     "local"    : 지금. 서버 없이 이 브라우저 안에만 저장 + 가짜 사용자 코드.
     "supabase" : 나중에. Supabase 연결 후 (README 5장 순서대로).

   ⚠️ 여기에 넣어도 되는 것: Supabase 주소, "공개용 열쇠(anon / publishable key)"
      — 원래 공개해도 되는 열쇠이고, 실제 보호는 DB의 RLS 규칙(줄 단위 출입 규칙)이 합니다.
   ⛔ 절대 넣으면 안 되는 것: service_role 키(관리자 열쇠), Anthropic 키, 비밀번호.
   ========================================================= */
window.LU_CONFIG = {
  MODE: "local",

  // Supabase 모드에서만 사용 (지금은 비워 둠)
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // 교수님이 열어 둔 강의: 이 번호 강까지만 연습 문제로 나옴 (가짜 기수 기준)
  OPEN_UP_TO_LECTURE: 15,

  // [로컬 모드 전용 · 개발용] 가짜 참가자 코드. 실제 학생 코드가 아닙니다.
  // (Supabase 모드에서는 코드 목록이 Supabase 안에만 있고 이 줄은 쓰이지 않음)
  DEV_CODES: ["TEST23", "TEST45", "TEST67", "PLAY89"]
};
