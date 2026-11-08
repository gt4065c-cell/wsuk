/* 루키 그림 (SVG 1벌) — 디자인 규격 4장
   - 레벨(Lv) = 수료한 강 수. 겉모습 단계(1~7)는 Lv로 정해짐, 장식 이름은 디자인 규격 4-1
   - 직급 이름은 이야기 지도(수습→사원→주임→튜터→파트너)
   - 표정 4종: normal · happy · confused · think (data-mood), 단계: data-stage="1~7" */
(function (RK) {
  'use strict';
  RK.STAGES = [null,
    { name: '새내기', deco: '안테나 전구', color: '#9AA8BF' },
    { name: '사원증', deco: '가슴 명찰', color: '#7FB3FF' },
    { name: '헤드셋', deco: '헤드셋·마이크', color: '#5B8CFF' },
    { name: '메이커', deco: '노란 펜', color: '#8D84FF' },
    { name: '기억 관리자', deco: '배낭·출입증', color: '#A676FF' },
    { name: '튜터', deco: '학사모', color: '#3FC1C9' },
    { name: '파트너', deco: '도구 벨트·금 별', color: '#FFB547' }
  ];
  // 겉모습이 바뀌는 강(이 강을 수료하면 그 단계): 1강 특별 승진, 이후 부 마지막 강
  RK.STAGE_AT = [[30, 7], [25, 6], [21, 5], [13, 4], [5, 3], [1, 2]];
  RK.stageFor = lv => { for (const [n, s] of RK.STAGE_AT) if (lv >= n) return s; return 1; };
  // 직급 = 지금 일하는 부(다음에 할 강이 속한 부)
  RK.rankFor = lv => {
    const parts = (RK.course && RK.course.parts) || [];
    const next = Math.min(lv + 1, 30);
    const p = parts.find(x => next >= x.a && next <= x.b);
    return p ? p.rank : '수습';
  };
  RK.statusText = lv => 'Lv.' + lv + ' · ' + RK.rankFor(lv) + ' · ' + RK.STAGES[RK.stageFor(lv)].name;

  RK.rookieSVG = (stage, mood) =>
    '<svg class="rk" data-stage="' + (stage || RK.stageFor(RK.state.lv)) + '" data-mood="' + (mood || 'normal') + '" viewBox="0 0 120 124" aria-hidden="true" focusable="false">' +
    // 등 장식(배낭) — 몸 뒤에 먼저
    '<g class="w-pack"><rect x="30" y="80" width="60" height="36" rx="10" fill="#2B3560"/></g>' +
    '<g class="ant"><line x1="60" y1="24" x2="60" y2="12" stroke-width="3" stroke-linecap="round"/><circle class="bulb" cx="60" cy="9" r="5"/></g>' +
    '<rect class="ear" x="11" y="40" width="11" height="22" rx="5"/><rect class="ear" x="98" y="40" width="11" height="22" rx="5"/>' +
    '<rect class="head" x="20" y="22" width="80" height="58" rx="22"/>' +
    '<rect class="screen" x="30" y="33" width="60" height="36" rx="13"/>' +
    '<g class="eyes e-normal"><ellipse cx="47" cy="50" rx="5" ry="6"/><ellipse cx="73" cy="50" rx="5" ry="6"/></g>' +
    '<g class="eyes e-happy"><path d="M41 53 q6 -9 12 0 M67 53 q6 -9 12 0"/></g>' +
    '<g class="eyes e-confused"><ellipse cx="47" cy="50" rx="6" ry="7"/><path d="M67 50 h12"/></g>' +
    '<g class="eyes e-think"><ellipse cx="50" cy="46" rx="4" ry="4.5"/><ellipse cx="76" cy="46" rx="4" ry="4.5"/></g>' +
    '<path class="mouth m-normal" d="M54 60 q6 4 12 0"/>' +
    '<path class="mouth m-happy" d="M50 58 q10 9 20 0"/>' +
    '<path class="mouth m-confused" d="M52 62 q4 -3 8 0 q4 3 8 0"/>' +
    '<path class="mouth m-think" d="M54 61 h12"/>' +
    '<text class="qmark" x="98" y="26">?</text>' +
    '<g class="dots3"><circle cx="100" cy="20" r="2.6"/><circle cx="108" cy="16" r="2.6"/><circle cx="116" cy="12" r="2.6"/></g>' +
    '<circle class="hand" cx="27" cy="96" r="7"/><circle class="hand" cx="93" cy="96" r="7"/>' +
    '<rect class="body" x="34" y="82" width="52" height="34" rx="12"/>' +
    '<g class="w-badge"><rect x="43" y="87" width="34" height="12" rx="3" fill="#fff"/><text x="60" y="96" text-anchor="middle" font-size="7.5" font-weight="800" fill="#1D2540">ROOKIE</text></g>' +
    '<g class="w-pack"><rect x="52" y="100" width="16" height="10" rx="3" fill="#FFD166"/></g>' +
    '<g class="w-pen"><line x1="96" y1="99" x2="107" y2="82" stroke="#FFD166" stroke-width="4" stroke-linecap="round"/><circle cx="107.5" cy="81" r="2" fill="#141A3A"/><path d="M36 64 l2 4 4 1 -3 3 1 4 -4 -2 -4 2 1 -4 -3 -3 4 -1z" fill="#FFD166"/></g>' +
    '<g class="w-belt"><rect x="34" y="106" width="52" height="7" rx="3" fill="#2B3560"/><rect x="56" y="105" width="8" height="9" rx="2" fill="#FFD166"/><path d="M60 86 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5 -2.6 -5 2.6 1 -5.5 -4 -3.9 5.5 -.8z" fill="#FFD166"/></g>' +
    '<g class="w-headset"><path d="M17 50 Q17 13 60 13 Q103 13 103 50" fill="none" stroke="#2B3560" stroke-width="5"/><path d="M103 58 q3 16 -16 17" fill="none" stroke="#2B3560" stroke-width="3"/><circle cx="86" cy="75" r="3.5" fill="#4FE3C1"/></g>' +
    '<g class="w-cap"><path d="M34 21 L60 9 L86 21 L60 32 Z" fill="#1D2540" stroke="#FFD166" stroke-width="2"/><line x1="82" y1="20" x2="84" y2="34" stroke="#FFD166" stroke-width="2"/><circle cx="84" cy="35" r="3" fill="#FFD166"/></g>' +
    '</svg>';

  RK.styleRk = (svg, mood, stage) => {
    if (!svg) return;
    if (mood) svg.setAttribute('data-mood', mood);
    if (stage) svg.setAttribute('data-stage', stage);
  };

  // 친구 루키 얼굴(40px, 머리만)
  RK.miniHead = color =>
    '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><rect x="6" y="9" width="28" height="24" rx="9" fill="' + color + '"/><rect x="10" y="14" width="20" height="13" rx="5" fill="#1D2540"/><path d="M14 21 q2.5 -3 5 0 M21 21 q2.5 -3 5 0" stroke="#7CF7D4" stroke-width="2" fill="none" stroke-linecap="round"/><line x1="20" y1="9" x2="20" y2="4" stroke="' + color + '" stroke-width="2"/><circle cx="20" cy="3.5" r="2.2" fill="#4FE3C1"/></svg>';
})(window.RK);
