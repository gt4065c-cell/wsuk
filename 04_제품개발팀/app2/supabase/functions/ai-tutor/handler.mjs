// =====================================================================
// AI 튜터 요청 처리 순서 (handler.mjs)
//   ① 학생 로그인 토큰 확인(Supabase Auth) → ② DB 함수 tutor_begin(상한·연습 문항·힌트 단계 확인 + 예약)
//   → ③ Anthropic 호출 → ④ 범위 밖 / 정답 노출 검사 → ⑤ DB 함수 tutor_finish(토큰 수 기록) → ⑥ 화면에 답
//
// 바깥 세상(환경값·인터넷)은 createHandler 에 넣어 줍니다 → Deno(index.ts)에서도, node 시험에서도 같은 코드가 돎.
//   env(name)  : 환경값 읽기. 실제로는 Deno.env.get — ANTHROPIC_API_KEY 는 Supabase Secrets 에만 있음
//   fetch      : 인터넷 요청 (시험에서는 가짜 Anthropic·가짜 DB)
// 학생 코드·별명·번호는 Anthropic 에 보내지 않습니다. 학생 질문 글·AI 답 글은 어디에도 저장하지 않습니다.
// =====================================================================
import { MESSAGES, SAFE_REPLY, parseBody, buildRequestBody, readAnthropic, isRefusal, refusalReply, findLeak } from "./guard.mjs";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";
const AI_TIMEOUT_MS = 25000;

const CORS = {
  "Access-Control-Allow-Origin": "*",   // 쿠키를 쓰지 않고 로그인 토큰(헤더)으로만 확인하므로 주소 제한 없이도 안전
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}
function refuse(error, state, status = 200) {
  const o = { ok: false, error, message: MESSAGES[error] || MESSAGES.SERVER };
  if (state) Object.assign(o, pickState(state));
  return reply(status, o);
}
function pickState(s) {
  return { enabled: !!s.enabled, reason: s.reason || null, left: Number(s.left) || 0, dayLeft: Number(s.dayLeft) || 0,
           monthLeft: Number(s.monthLeft) || 0, dayLimit: Number(s.dayLimit) || 0 };
}

export function createHandler({ env, fetch: doFetch, log = () => {} }) {
  const get = (k) => (env(k) || "").trim();

  // DB 서버 함수 부르기 — service_role(서버 비밀 열쇠)로. 이 열쇠는 Supabase 가 Edge Function 에 자동으로 넣어 줌
  async function rpc(name, args) {
    const url = get("SUPABASE_URL"), key = get("SUPABASE_SERVICE_ROLE_KEY");
    const headers = { apikey: key, "Content-Type": "application/json" };
    if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;   // 옛 JWT 모양 열쇠일 때만 (새 sb_secret_ 열쇠는 apikey 만 — 확인 필요)
    const r = await doFetch(url + "/rest/v1/rpc/" + name, { method: "POST", headers, body: JSON.stringify(args) });
    const t = await r.text();
    if (!r.ok) throw new Error("DB " + name + " " + r.status + " " + t.slice(0, 200));
    return t ? JSON.parse(t) : null;
  }

  // 학생 로그인 토큰 → 계정 번호 (Supabase Auth 에 직접 물어봄. 토큰 내용을 믿고 풀어 쓰지 않음)
  async function whoIs(token) {
    const r = await doFetch(get("SUPABASE_URL") + "/auth/v1/user", {
      headers: { apikey: get("SUPABASE_ANON_KEY"), Authorization: "Bearer " + token } });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    return u && typeof u.id === "string" ? u.id : null;
  }

  async function finish(usageId, status, inTok, outTok) {
    try { return await rpc("tutor_finish", { p_usage_id: usageId, p_status: status, p_input: inTok, p_output: outTok }); }
    catch (e) { log("tutor_finish 실패: " + (e && e.message)); return null; }
  }

  return async function handle(req) {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method !== "POST") return refuse("BAD_INPUT", null, 405);
    if (!get("SUPABASE_URL") || !get("SUPABASE_SERVICE_ROLE_KEY") || !get("SUPABASE_ANON_KEY")) return refuse("SERVER", null, 500);

    // ① 로그인 확인
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") || "");
    if (!m) return refuse("NO_AUTH", null, 401);
    let uid;
    try { uid = await whoIs(m[1].trim()); } catch (e) { return refuse("SERVER", null, 502); }
    if (!uid) return refuse("NO_AUTH", null, 401);

    // 요청 모양 확인 (질문 300자, 전화번호·이메일 가림)
    let body;
    try { body = await req.json(); } catch (e) { return refuse("BAD_INPUT", null, 400); }
    const p = parseBody(body);
    if (!p.ok) return refuse(p.error, null, 400);

    // ② 상한·문항 확인 + 예약 (키가 없으면 DB에 묻기 전에 멈춤 → 횟수도 안 씀)
    const apiKey = get("ANTHROPIC_API_KEY");
    if (!apiKey) return refuse("NOT_CONFIGURED");
    let begin;
    try { begin = await rpc("tutor_begin", { p_auth_uid: uid, p_qid: p.qid, p_level: p.level, p_tried: p.tried }); }
    catch (e) { log("tutor_begin 실패: " + (e && e.message)); return refuse("SERVER", null, 500); }
    if (!begin || !begin.ok) return refuse((begin && begin.error) || "SERVER", begin && begin.state);
    const ctx = begin.context, usageId = begin.usageId;

    // ③ Anthropic 호출 (키는 이 요청 헤더에만. 화면·로그·DB 어디에도 남기지 않음)
    let ai, httpStatus = 0;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), AI_TIMEOUT_MS);
    try {
      const r = await doFetch(ANTHROPIC_URL, {
        method: "POST", signal: ctl.signal,
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body: JSON.stringify(buildRequestBody(ctx, p.question)),
      });
      httpStatus = r.status;
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error("Anthropic " + r.status + " " + (j && j.error && j.error.type || ""));
      ai = readAnthropic(j);
      if (!ai.text) throw new Error("빈 답");
    } catch (e) {
      clearTimeout(timer);
      log("AI 호출 실패: " + (e && e.message) + " (HTTP " + httpStatus + ")");
      const st = await finish(usageId, "error", (ai && ai.inputTokens) || 0, (ai && ai.outputTokens) || 0);
      return refuse("AI_ERROR", st || begin.state);
    }
    clearTimeout(timer);

    // ④ 범위 밖 거절(횟수 X) → 정답 노출 검사(버리고 안전 문구, 횟수 X) → 통과
    let kind = "ok", text = ai.text;
    if (isRefusal(text)) { kind = "refused"; text = refusalReply(text, ctx); }
    else if (findLeak(text, ctx)) { kind = "blocked"; text = SAFE_REPLY; }
    else if (ai.truncated) text = text + " …";

    // ⑤ 토큰 수 기록 (금액은 DB가 계산). 기록이 실패해도 답은 보여 줌(예약 줄은 2분 뒤 횟수에서 빠짐)
    const st = (await finish(usageId, kind, ai.inputTokens, ai.outputTokens)) || begin.state;
    return reply(200, { ok: true, kind, reply: text, ...pickState(st) });
  };
}
