/* ============================================================
   constants.js — 공유 데이터 상수

   Swap통합수정_및_포니테일안전항목_통합_요청_프롬프트.md 2-1-1절 반영.

   [주의] DEFAULT_CONTENTS와 APP_TYPE_LABEL은 이 파일에 포함하지 않았습니다 —
   GuildPartyMatcher.jsx와 GuildPartyMatcherAdmin.jsx에서 실제 값이 서로 달랐고
   (DEFAULT_CONTENTS는 예시 콘텐츠 개수, APP_TYPE_LABEL은 "일반 신청" vs "일반"처럼
   표시 문구 길이가 다름), 하나로 합치면 둘 중 한쪽 화면의 문구/기본값이 바뀌게 되어
   "시각적 변화 없음"이라는 완료 기준을 깰 위험이 있었습니다. 두 파일에 그대로
   남겨뒀고, 사용자에게 통합 여부를 확인받아야 합니다.

   DEFAULT_JOBS와 ROLE_LABEL은 두 파일에서 완전히 동일한 값이라 그대로 공유합니다.
   ============================================================ */

const DEFAULT_JOBS = [
  { id: "j1", name: "전사", role: "tank", keywords: "warrior 방패 근접", order: 1, active: true },
  { id: "j2", name: "대검전사", role: "tank", keywords: "greatsword 대검", order: 2, active: true },
  { id: "j3", name: "힐러", role: "support", keywords: "heal priest 사제", order: 3, active: true },
  { id: "j4", name: "음유시인", role: "support", keywords: "bard 버프 지원", order: 4, active: true },
  { id: "j5", name: "궁수", role: "dealer", keywords: "archer bow 활", order: 5, active: true },
  { id: "j6", name: "마법사", role: "dealer", keywords: "mage 마법", order: 6, active: true },
  { id: "j7", name: "격투가", role: "dealer", keywords: "fighter 격투 근접딜", order: 7, active: true },
  { id: "j8", name: "도적", role: "dealer", keywords: "rogue 단검 은신", order: 8, active: true },
];

const ROLE_LABEL = { tank: "탱커", support: "서포터", dealer: "딜러" };

export { DEFAULT_JOBS, ROLE_LABEL };
