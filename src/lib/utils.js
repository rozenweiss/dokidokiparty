/* ============================================================
   utils.js — 순수 로직/유틸 함수 공유 모듈

   Swap통합수정_및_포니테일안전항목_통합_요청_프롬프트.md 2-1-1절 반영.
   GuildPartyMatcher.jsx, GuildPartyMatcherAdmin.jsx, matchEngine.js,
   matchEngine.experimental.js 네 파일이 공유하는 순수 함수만 모아둡니다.
   React, lucide-react, storage 어느 것도 import하지 않습니다 — matchEngine.js /
   matchEngine.experimental.js가 "Node에서 단독 실행 가능해야 한다"는 기존 확정
   요구사항(매칭엔진 모듈분리 요청 4절)을 이 파일도 그대로 지켜야 하기 때문입니다.
   ============================================================ */

function timeSlots(start, end, interval) {
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
const RESIST_PRESSURE_RATIO = 0.00015;
const RESIST_PRESSURE_CAP = 0.40; // ±40% 한도 (8.2/11.2절, 증폭·감소 양방향 동일)

// 11.2절 공식: diff = 저항 - 압력, 보정률 = clamp(0.00015×diff, -40%, +40%)
// 압력이 0인 콘텐츠에도 적용합니다 (게임 문서 근거, 11.2절).
function finalPower(basePower, pressure, resist) {
  const diff = (resist || 0) - (pressure || 0);
  const rate = Math.max(-RESIST_PRESSURE_CAP, Math.min(RESIST_PRESSURE_CAP, RESIST_PRESSURE_RATIO * diff));
  return Math.round(basePower * (1 + rate));
}

/**
 * 캐릭터의 "최종 전투력"을 화면 전체에서 일관되게 계산하는 단일 함수입니다.
 * - content가 주어지면: 저항-압력 보정(11.2절) 후 패널티 차감 (콘텐츠 맥락이 있는 화면)
 * - content가 없으면: 보정 없이 패널티만 차감 (콘텐츠 맥락이 없는 화면)
 * 두 경우 모두 결과는 0 미만으로 내려가지 않습니다(0 클램프).
 * [Unverified] RESIST_PRESSURE_RATIO는 확정된 게임 데이터가 아닌 추정치입니다.
 */
function charFinalPower(char, content) {
  const base = content ? finalPower(char.power, content.pressure, char.resist) : char.power;
  const penalty = char.penalty || 0;
  return Math.max(0, base - penalty);
}

/* (repName, 캐릭터) 단위로 후보를 묶어서, 그 캐릭터가 신청한 시간 목록과 신청 유형들을 모읍니다. */
function groupCandidatesByChar(candidates) {
  const map = new Map();
  candidates.forEach((c) => {
    const key = c.repName + ":" + c.char.id;
    if (!map.has(key)) map.set(key, { repName: c.repName, char: c.char, times: new Set(), types: new Set() });
    map.get(key).times.add(c.time);
    map.get(key).types.add(c.type);
  });
  return [...map.values()].map((v) => ({ ...v, times: [...v.times], types: [...v.types] }));
}

function stdev(nums) {
  if (nums.length === 0) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

export { timeSlots, RESIST_PRESSURE_RATIO, RESIST_PRESSURE_CAP, finalPower, charFinalPower, groupCandidatesByChar, stdev };
