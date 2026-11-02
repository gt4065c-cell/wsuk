// =====================================================================
// Supabase Edge Function: ai-tutor (Deno)
//   학생 화면 → (로그인 토큰) → 이 함수 → DB 상한 확인 → Claude Haiku 5.5 → 정답 노출 검사 → 학생 화면
//
// ⛔ 이 파일·저장소·화면 어디에도 API 키를 쓰지 않습니다.
//    ANTHROPIC_API_KEY 는 Supabase 관리 화면 → Edge Functions → Secrets 에 캡틴이 직접 넣습니다(README 7장).
//    SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 자동으로 넣어 줍니다(확인 필요: 새 열쇠 체계).
//
// 배포(비서실장, 캡틴 결재 후): supabase functions deploy ai-tutor   — 로그인 토큰 검사(verify_jwt)는 켠 채로 둠
// 실제 처리 순서는 handler.mjs, 검사 규칙은 guard.mjs (둘 다 node 자동 시험으로 확인: tests/unit_tutor.mjs)
// =====================================================================
import { createHandler } from "./handler.mjs";

const handler = createHandler({
  env: (name: string) => {
    if (name === "ANTHROPIC_API_KEY") return Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    return Deno.env.get(name) ?? "";
  },
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  log: (msg: string) => console.warn("[ai-tutor] " + msg),   // 학생 질문 글·답 글·키는 로그에 남기지 않음
});

Deno.serve(handler);
