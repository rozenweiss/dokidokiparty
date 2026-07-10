/* ============================================================
   utils.js — 순수 함수 유틸리티 (React/lucide/storage 미사용)
   매칭 엔진과 UI 파일이 공통으로 사용하는 순수 헬퍼 함수들.
   Node.js 단독 실행 환경에서도 import 가능합니다.
   ============================================================ */

/* 시간 슬롯 목록 생성 */
export function timeSlots(start, end, interval) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let cur = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const out = [];
  while (cur <= endMin) {
    out.push(`${String(Math.floor(cur / 60) % 24).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`);
    cur += interval;
  }
  return out;
}

// [추정치 — 11.1절] 마도저항이 마도압력을 초과하는 1포인트당 약 0.015% 최종 전투력 증가(반대 방향도 동일)로
// 추정한 값입니다. 확정된 게임 데이터가 아니므로, 실제 수치가 확인되면 이 상수만 바꾸면 됩니다.
export const RESIST_PRESSURE_RATIO = 0.00015;
export const RESIST_PRESSURE_CAP = 0.40; // ±40% 한도 (양방향 동일)

// 11.2절 공식: diff = 저항 - 압력, 보정률 = clamp(0.00015×diff, -40%, +40%)
function finalPower(basePower, pressure, resist) {
  const diff = (resist || 0) - (pressure || 0);
  const rate = Math.max(-RESIST_PRESSURE_CAP, Math.min(RESIST_PRESSURE_CAP, RESIST_PRESSURE_RATIO * diff));
  return Math.round(basePower * (1 + rate));
}

/**
 * 캐릭터의 "최종 전투력"을 화면 전체에서 일관되게 계산하는 단일 함수.
 * [Unverified] RESIST_PRESSURE_RATIO는 추정값이며 확정된 게임 데이터가 아닙니다.
 */
export function charFinalPower(char, content) {
  const base = content ? finalPower(char.power, content.pressure, char.resist) : char.power;
  const penalty = char.penalty || 0;
  return Math.max(0, base - penalty);
}

/* (repName, 캐릭터) 단위로 후보를 묶어서, 신청한 시간 목록과 신청 유형들을 모읍니다. */
export function groupCandidatesByChar(candidates) {
  const map = new Map();
  candidates.forEach((c) => {
    const key = c.repName + ":" + c.char.id;
    if (!map.has(key)) map.set(key, { repName: c.repName, char: c.char, times: new Set(), types: new Set() });
    map.get(key).times.add(c.time);
    map.get(key).types.add(c.type);
  });
  return [...map.values()].map((v) => ({ ...v, times: [...v.times], types: [...v.types] }));
}

/* 표준편차 */
export function stdev(nums) {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/* 신청 유형 필터 헬퍼 */
export const appliesNormal = (type) => type === "normal" || type === "both";
export const appliesSupport = (type) => type === "support" || type === "both";
