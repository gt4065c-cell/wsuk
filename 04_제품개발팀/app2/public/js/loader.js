/* =========================================================
   파일 불러오기 (loader.js)
   config.js 의 MODE 를 보고 필요한 파일만 "적힌 순서대로" 불러옵니다.
     - 로컬 모드    : 연습 문항·진단 문항·힌트 데이터(data/) + 규칙 + 저장 창구 + 화면
     - Supabase 모드: 규칙 + 저장 창구 + 화면 (문항·정답·힌트는 서버에서 받으므로 data/ 는 안 읽음)
   Supabase 라이브러리(vendor/supabase.js)는 store.js 가 Supabase 모드일 때만 따로 불러옵니다.
   ========================================================= */
(function () {
  "use strict";
  var local = (window.LU_CONFIG || {}).MODE !== "supabase";
  var files = (local ? ["data/practice.js", "data/diagnostic.js", "data/hints.js", "data/concepts.js"] : [])
    .concat(["js/logic.js", "js/store.js", "js/app.js"]);
  files.forEach(function (f) {
    var s = document.createElement("script");
    s.src = f;
    s.async = false;   // 끼워 넣은 순서대로 실행
    s.onerror = function () {
      var app = document.getElementById("app");
      if (app) app.innerHTML = '<div class="content"><div class="note" role="alert"><div class="note-title">문제가 생겼어요</div>' +
        '앱 파일(' + f + ')을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.</div></div>';
    };
    document.body.appendChild(s);
  });
})();
