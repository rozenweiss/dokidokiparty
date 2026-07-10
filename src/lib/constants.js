/* ============================================================
   constants.js — 앱 전역 데이터 상수 (순수 JS, React/lucide/storage 미사용)
   React·lucide-react 의존성이 없어야 하는 파일(matchEngine.js 등)도 안전하게 import 가능.
   ============================================================ */

/* 기본 직업 목록 (시드 데이터 — 길드 설정 미존재 시 사용) */
export const DEFAULT_JOBS = [
  { id: "j1", name: "전사", role: "tank", keywords: "warrior 방패 근접", order: 1, active: true },
  { id: "j2", name: "대검전사", role: "tank", keywords: "greatsword 대검", order: 2, active: true },
  { id: "j3", name: "힐러", role: "support", keywords: "heal priest 사제", order: 3, active: true },
  { id: "j4", name: "음유시인", role: "support", keywords: "bard 버프 지원", order: 4, active: true },
  { id: "j5", name: "궁수", role: "dealer", keywords: "archer bow 활", order: 5, active: true },
  { id: "j6", name: "마법사", role: "dealer", keywords: "mage 마법", order: 6, active: true },
  { id: "j7", name: "격투가", role: "dealer", keywords: "fighter 격투 근접딜", order: 7, active: true },
  { id: "j8", name: "도적", role: "dealer", keywords: "rogue 단검 은신", order: 8, active: true },
];

/* 기본 콘텐츠 목록 (시드 데이터 — 길드 설정 미존재 시 사용)
   GuildPartyMatcher.jsx 기준(더 완전한 목록)으로 통합. */
export const DEFAULT_CONTENTS = [
  { id: "c1", name: "협곡의 결전", pressure: 0, requiredResist: 0, partySize: 4, interval: 30, startTime: "20:00", endTime: "23:30", active: true },
  { id: "c2", name: "심연의 제단", pressure: 120, requiredResist: 1600, partySize: 4, interval: 30, startTime: "20:00", endTime: "23:00", active: true },
  { id: "c3", name: "폐허의 감시탑", pressure: 0, requiredResist: 0, partySize: 6, interval: 60, startTime: "21:00", endTime: "23:00", active: false },
];

/* 역할 한국어 라벨 (JSX 없음 — 매칭 엔진도 안전하게 import 가능) */
export const ROLE_LABEL = { tank: "탱커", support: "서포터", dealer: "딜러" };

/* 신청 유형 라벨 — 두 화면의 표기가 다르므로 각 UI 파일에서 별도 정의.
   (GuildPartyMatcher:      "일반 신청" / "지원 신청" / "일반 신청 + 지원 신청"
    GuildPartyMatcherAdmin: "일반"      / "지원"      / "일반+지원") */
