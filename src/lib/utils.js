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

// [추정치 — 2026-07-10 갱신] 마도 저항-압력 차이에 따른 최종 전투력 보정 공식.
// 확정된 게임 데이터가 아니므로, 실제 수치가 확인되면 이 함수만 바꾸면 됩니다.
// 저항 부족 시 지수적으로 감소(최대 -40%), 저항 초과 시 지수적으로 증가하며 +40%에
// 점근적으로 수렴(넘지 않음) — 두 방향의 민감도가 다른 비대칭 공식입니다.
// (저항압력공식_지수형교체_요청_프롬프트.md 1절, 기존 11.2절 선형·±40% 대칭 공식을 폐기하고 교체)
const RESIST_DEFICIT_DIVISOR = 1000;
const RESIST_SURPLUS_DIVISOR = 10000;
const RESIST_PRESSURE_FLOOR = 0.6;  // diff<0일 때의 하한 (-40%)
const RESIST_PRESSURE_SURPLUS_MAX = 0.4; // diff>0일 때 점근 상한의 폭 (+40%)

// diff = 저항 - 압력.
// diff<0: 보정률 = max(0.5^(-diff/1000), 0.6)
// diff=0: 보정률 = 1.0
// diff>0: 보정률 = 1.4 - 0.4×0.5^(diff/10000) (= 1 + 0.4×(1 - 0.5^(diff/10000))로 대수적 동치)
// 압력이 0인 콘텐츠에도 적용합니다 (기존 확정 유지 — diff=저항이 대부분 양수이므로 초과 쪽 공식 적용).
function finalPower(basePower, pressure, resist) {
  const diff = (resist || 0) - (pressure || 0);
  let rate;
  if (diff < 0) {
    rate = Math.max(Math.pow(0.5, -diff / RESIST_DEFICIT_DIVISOR), RESIST_PRESSURE_FLOOR);
  } else if (diff === 0) {
    rate = 1.0;
  } else {
    rate = 1 + RESIST_PRESSURE_SURPLUS_MAX * (1 - Math.pow(0.5, diff / RESIST_SURPLUS_DIVISOR));
  }
  return Math.round(basePower * rate);
}

/**
 * 캐릭터의 "최종 전투력"을 화면 전체에서 일관되게 계산하는 단일 함수입니다.
 * - content가 주어지면: 저항-압력 보정(지수형 공식) 후 패널티 차감 (콘텐츠 맥락이 있는 화면)
 * - content가 없으면: 보정 없이 패널티만 차감 (콘텐츠 맥락이 없는 화면)
 * 두 경우 모두 결과는 0 미만으로 내려가지 않습니다(0 클램프).
 * [Unverified] 저항-압력 보정 공식은 확정된 게임 데이터가 아닌 추정치입니다.
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

export { timeSlots, finalPower, charFinalPower, groupCandidatesByChar, stdev };
