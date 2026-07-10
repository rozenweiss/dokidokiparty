/* ============================================================
   matchEngine.js — 자동 매칭 알고리즘 (순수 로직 모듈)

   이 파일은 GuildPartyMatcherAdmin.jsx에서 매칭 알고리즘 관련 함수들을
   분리한 것입니다 (매칭엔진_모듈분리_요청_프롬프트.md, 2026-07-10 반영).
   React, lucide-react, storage(storageGet 등) 어느 것도 import하지
   않는 순수 JS 로직입니다 — Node.js 등 단독 환경에서도 import 가능합니다.

   대안 알고리즘을 실험하려면 이 파일을 복사해
   matchEngine.experimental.js 같은 이름으로 수정한 뒤, admin 파일의
   import 경로 한 줄만 바꾸면 됩니다.
   ============================================================ */

const appliesNormal = (type) => type === "normal" || type === "both";
const appliesSupport = (type) => type === "support" || type === "both";
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
// 압력이 0인 콘텐츠에도 적용합니다 (게임 문서 근거, 11.2절) — 예전의 "압력 0이면 그냥 기본값 반환" 조기 반환은 폐기.
function finalPower(basePower, pressure, resist) {
  const diff = (resist || 0) - (pressure || 0);
  const rate = Math.max(-RESIST_PRESSURE_CAP, Math.min(RESIST_PRESSURE_CAP, RESIST_PRESSURE_RATIO * diff));
  return Math.round(basePower * (1 + rate));
}
/**
 * 캐릭터의 "최종 전투력"을 화면 전체에서 일관되게 계산하는 단일 함수입니다.
 * - content가 주어지면: 저항-압력 보정(11.2절) 후 패널티 차감 (콘텐츠 맥락이 있는 화면: 신청 현황, 자동 매칭)
 * - content가 없으면: 보정 없이 패널티만 차감 (콘텐츠 맥락이 없는 화면: 전체 캐릭터 목록, 8.3/11.2절 근거)
 * 두 경우 모두 결과는 0 미만으로 내려가지 않습니다(0 클램프).
 * [Unverified] RESIST_PRESSURE_RATIO는 사용자가 스스로 "추정한다"고 밝힌 값이며 확정된 게임 데이터가 아닙니다.
 */
function charFinalPower(char, content) {
  const base = content ? finalPower(char.power, content.pressure, char.resist) : char.power;
  const penalty = char.penalty || 0;
  return Math.max(0, base - penalty);
}
/* 신청서로부터 (캐릭터×시간) 매칭 후보 목록 생성 */
function buildCandidates(content, reps) {
  const out = [];
  Object.entries(reps).forEach(([repName, data]) => {
    (data.applications || []).forEach((app) => {
      if (app.contentId !== content.id || app.status === "cancelled") return;
      (app.characterIds || []).forEach((cid) => {
        const char = (data.subs || []).find((s) => s.id === cid);
        if (!char || char.active === false) return;
        (app.times || []).forEach((t) => {
          out.push({ repName, char, type: app.type, time: t, appId: app.id });
        });
      });
    });
  });
  return out;
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
/**
 * 자동 매칭 알고리즘 (일반 신청 파티 배분 로직 수정안 + 정합화 노트, 2026-07-08 반영)
 *
 * [Inference/Unverified] 이 알고리즘은 최적해를 보장하지 않는 휴리스틱입니다.
 * 길드원 50명 미만 소규모 운영을 기준으로, 정수계획법(ILP)이나 완전탐색 대신
 * "그리디 배치 + 제한된 지역탐색(local search)"을 사용합니다. 아래는 기대되는
 * 동작이며, 모든 신청 조합에서 전역 최적 균형을 보장하지는 않습니다.
 *
 * 처리 순서 (수정안 9절):
 * 1) 일반 신청 캐릭터의 시간 배정 — 딜러 집중 배치 유지, 탱커·서포터는 딜러 있는 시간 우선
 *    (동일 대표 캐릭터는 같은 시간에 1명만 — 신청한 시간 범위 안에서만 배정)
 * 2) 시간대별 파티 수 = ceil(그 시간대 일반 딜러 수 ÷ 딜러 슬롯 수). 딜러가 0명인 시간대는
 *    파티를 생성하지 않음 (기존 "탱커 2명 이상이면 파티 생성" 규칙은 폐기됨 — 정합화 노트 2.2).
 * 3) 각 시간대 안에서 서포터 → 탱커 → 딜러 순으로 "전투력 합계가 가장 낮은 파티부터 채우는"
 *    그리디 배치. 서포터·탱커는 자기 역할 슬롯에만 배치(교차 없음), 딜러 배치 후 남는 탱커만
 *    빈 딜러 슬롯에 교차 배치를 검토합니다. 서포터 초과분은 교차 배치하지 않습니다.
 * 4) 3단계에서 역할 자리 부족 등으로 밀린 일반(및 both) 캐릭터는 바로 미배정 처리하지 않고,
 *    본인이 신청한 다른 시간대의 빈 슬롯에 일반으로 재시도합니다(동일 대표 동일 시간 제약과
 *    해당 시간대의 슬롯 규칙을 그대로 적용). 재시도까지 실패한 뒤에만 사유와 함께 미배정됩니다.
 * 5) 그래도 남는 딜러 잉여는 신규 파티 생성을 검토합니다 — 지원 서포터를 구할 수 있으면
 *    지원 서포터를 포함해, 구할 수 없으면 서포터 빈 슬롯으로 생성합니다. 이때도 배치할 수
 *    없는 딜러만 최종 미배정 처리됩니다. (탱커·서포터 잉여만으로는 신규 파티를 만들지 않음)
 * 6) 같은 역할·서로 다른 시간 사이에서, 각 캐릭터가 실제로 신청한 시간 범위 안에서만
 *    스왑을 시도해 파티 평균 전투력의 표준편차가 줄어들면 교환 (신규 파티 포함, 제한된 횟수)
 * 7) 지원 신청자로 남은 빈자리를 채웁니다. both 캐릭터는 일반 배정(재시도·신규 파티 포함)이
 *    최종 실패하면 지원 후보에서도 완전히 제외됩니다(정합화 노트 2.4 — "일반 실패 시 지원도
 *    실패"). 성공한 both 캐릭터는 최종 배정된 시간만 지원 후보에서 제외됩니다.
 */
function runAutoMatch(content, reps, opts) {
  const aggressive = !!(opts && opts.aggressive);
  const dealerSlots = Math.max(content.partySize - 2, 0);
  const slotOrder = ["tank", "support", ...Array(dealerSlots).fill("dealer")];
  const allTimes = timeSlots(content.startTime, content.endTime, content.interval);
  const candidates = buildCandidates(content, reps);
  const unassigned = [];

  const normalChars = groupCandidatesByChar(candidates.filter((c) => appliesNormal(c.type)));
  const supportCandidatesRaw = candidates.filter((c) => appliesSupport(c.type));

  const byPowerDesc = (a, b) => charFinalPower(b.char, content) - charFinalPower(a.char, content);
  const charKey = (repName, char) => `${repName}:${char.id}`;

  /* ---- 1단계: 일반 신청 캐릭터의 시간 배정 (기존 로직 유지 — 딜러 집중 배치, 탱커·서포터는
     딜러 있는 시간 우선) ---- */
  const roleCountAtTime = {};
  allTimes.forEach((t) => (roleCountAtTime[t] = { tank: 0, support: 0, dealer: 0 }));
  const repTimeUsed = {}; // repName -> Set(이미 배정된 시간) — 재시도/신규 파티/구제 재배치에서도 계속 갱신됨
  const placedNormal = []; // {repName, char, role, time, allowedTimes, type} — .time은 최종 배정 시간으로 갱신될 수 있음
  // 1단계에서 즉시 배정 실패한 항목은 바로 unassigned에 넣지 않고 별도 보관합니다 — 아래
  // 구제 재배치 패스의 대상에도 포함시키기 위해서입니다(미배정_구제재배치_요청_프롬프트,
  // 2026-07-09: "미배정된 모든 일반(및 both) 역할에 동일 적용").
  const step1Failed = [];

  function placeNormalTime({ repName, char, times, types }, compareFn) {
    const appType = types.includes("both") ? "both" : "normal";
    if (!repTimeUsed[repName]) repTimeUsed[repName] = new Set();
    const candidateTimes = times.filter((t) => !repTimeUsed[repName].has(t));
    if (candidateTimes.length === 0) {
      step1Failed.push({ repName, char, role: char.role, time: times[0], allowedTimes: times, type: appType, reason: "동일 대표 캐릭터가 신청한 시간에 모두 이미 배정됨" });
      return;
    }
    candidateTimes.sort(compareFn);
    const time = candidateTimes[0];
    roleCountAtTime[time][char.role]++;
    repTimeUsed[repName].add(time);
    placedNormal.push({ repName, char, role: char.role, time, allowedTimes: times, type: appType });
  }

  const dealerNormals = normalChars.filter((c) => c.char.role === "dealer");
  const otherNormals = normalChars.filter((c) => c.char.role !== "dealer");

  /* 딜러 집중 배치 (지원강캐우선_딜러집중배치 통합 요청, 요청②) — 변경 금지 범위, 그대로 유지:
     새 시간대를 만들기보다 이미 딜러가 있고 파티가 덜 찬 시간대의 빈 딜러 슬롯을 먼저 채웁니다.
     우선순위: 1) 부분 파티가 있는 시간(딜러 수 % 딜러슬롯 !== 0, 잔여 슬롯 적은 순)
     2) 이미 딜러가 있는 시간(파티는 꽉 참) 3) 딜러가 아예 없는 시간(기존 부하 분산 유지). */
  function dealerTimeCompare(t1, t2) {
    if (dealerSlots === 0) return roleCountAtTime[t1].dealer - roleCountAtTime[t2].dealer;
    const tierOf = (t) => {
      const c = roleCountAtTime[t].dealer;
      const r = c % dealerSlots;
      if (c > 0 && r !== 0) return 1;
      if (c > 0 && r === 0) return 2;
      return 3;
    };
    const tier1 = tierOf(t1), tier2 = tierOf(t2);
    if (tier1 !== tier2) return tier1 - tier2;
    if (tier1 === 1) {
      const remain1 = dealerSlots - (roleCountAtTime[t1].dealer % dealerSlots);
      const remain2 = dealerSlots - (roleCountAtTime[t2].dealer % dealerSlots);
      if (remain1 !== remain2) return remain1 - remain2;
    }
    return roleCountAtTime[t1].dealer - roleCountAtTime[t2].dealer;
  }

  [...dealerNormals].sort((a, b) => a.times.length - b.times.length).forEach((c) => placeNormalTime(c, dealerTimeCompare));

  const timesWithDealer = new Set(placedNormal.filter((p) => p.role === "dealer").map((p) => p.time));

  function tankSupportTimeCompare(char) {
    return (t1, t2) => {
      const pri = (timesWithDealer.has(t2) ? 1 : 0) - (timesWithDealer.has(t1) ? 1 : 0);
      if (pri !== 0) return pri;
      return roleCountAtTime[t1][char.role] - roleCountAtTime[t2][char.role];
    };
  }

  [...otherNormals].sort((a, b) => a.times.length - b.times.length).forEach((c) => placeNormalTime(c, tankSupportTimeCompare(c.char)));

  /* ---- 2단계: 딜러 신청 수 기준 시간대별 파티 수 산정 ----
     딜러가 0명인 시간대는 파티를 생성하지 않습니다. 기존에 있던 "탱커 2명 이상이면 탱커를
     딜러 자리에도 채용해 파티를 생성" 규칙은 폐기되었습니다(정합화 노트 2.2 — 2026-07-08 확정).
     그 시간대에만 배정 가능한 일반 탱커·서포터는 아래 재시도 단계로 넘어가 다른 신청 시간에서
     빈 슬롯을 찾고, 그마저 실패하면 사유와 함께 미배정됩니다. */
  const partyCountAtTime = {};
  allTimes.forEach((t) => {
    const dealerCount = placedNormal.filter((p) => p.time === t && p.role === "dealer").length;
    partyCountAtTime[t] = dealerCount > 0 ? Math.ceil(dealerCount / Math.max(dealerSlots, 1)) : 0;
  });

  const partiesByKey = {}; // `${time}:${partyNumber}` -> party
  const placedSlotOf = {}; // `${repName}:${characterId}` -> {time, partyNumber, slotIndex} — 지역탐색 스왑 대상(일반/both만)

  /* 파티의 빈 슬롯 중 role이 일치하는 자리를, 전투력 합계가 가장 낮은 파티부터 채우는 공용 배치 함수.
     parties 배열 범위 안에서만 후보를 찾으므로, 같은 시간대 안에서도 / 여러 시간대에 걸쳐서도 재사용됩니다.
     registerNormal=false인 경우(지원 신청으로 채우는 경우) 지역탐색 스왑 대상(placedSlotOf)에는 등록하지
     않습니다 — 기존에도 지원 배치는 스왑 이후 단계였던 것과 동일하게, 일반 배정자만 스왑 후보로 남깁니다. */
  function place(entry, slotRole, parties, opts) {
    const slotType = (opts && opts.slotType) || "normal";
    const registerNormal = !opts || opts.registerNormal !== false;
    let best = null, bestSum = Infinity;
    parties.forEach((p) => {
      const idx = p.slots.findIndex((s) => !s.nickname && s.role === slotRole);
      if (idx === -1) return;
      if (p._powerSum < bestSum) { bestSum = p._powerSum; best = p; }
    });
    if (!best) return null;
    const idx = best.slots.findIndex((s) => !s.nickname && s.role === slotRole);
    const power = charFinalPower(entry.char, content);
    best.slots[idx] = { role: entry.role || slotRole, nickname: entry.char.nickname, repName: entry.repName, characterId: entry.char.id, type: slotType };
    best._powerSum += power; best._filledCount++;
    if (registerNormal) placedSlotOf[charKey(entry.repName, entry.char)] = { time: best.time, partyNumber: best.partyNumber, slotIndex: idx };
    if (!repTimeUsed[entry.repName]) repTimeUsed[entry.repName] = new Set();
    repTimeUsed[entry.repName].add(best.time);
    return best;
  }

  /* ---- 3단계: 시간대별 서포터 → 탱커 → 딜러 순 배치 (수정안 3절) ----
     - 서포터: 파티당 1명, 서포터 슬롯 전용, 전투력 균형(합계 낮은 파티부터). 초과분은 교차
       배치하지 않고 재시도 대상으로 넘어갑니다(4.1절).
     - 탱커: 서포터 배치 후 파티 누적 전투력 기준으로 균형 배치, 파티당 1명. 초과분은 같은
       시간대의 빈 딜러 슬롯에 교차 배치를 먼저 시도합니다(4.2절 1항).
     - 딜러: 파티 전체 전투력 합계 기준 균형 배치. */
  const tankSurplus = [];
  const supportSurplus = [];
  const dealerSurplus = [];

  allTimes.forEach((t) => {
    const partyCount = partyCountAtTime[t];
    const atTime = placedNormal.filter((p) => p.time === t);

    if (partyCount === 0) {
      /* 딜러 신청이 없는 시간대는 파티를 만들지 않습니다. 이 시간대에 배정된 일반 탱커·서포터가
         조용히 사라지지 않도록 재시도 대상(다른 신청 시간)으로 보냅니다. */
      atTime.forEach((entry) => {
        if (entry.role === "tank") tankSurplus.push(entry);
        else if (entry.role === "support") supportSurplus.push(entry);
        // 이 시간대엔 딜러가 없으므로(파티 수 0의 정의) 딜러 역할 entry는 존재하지 않습니다.
      });
      return;
    }

    const parties = Array.from({ length: partyCount }, (_, i) => ({
      time: t, partyNumber: i + 1,
      slots: slotOrder.map((role) => ({ role, nickname: null, repName: null, characterId: null, type: null })),
      _powerSum: 0, _filledCount: 0,
    }));
    parties.forEach((p) => (partiesByKey[`${t}:${p.partyNumber}`] = p));

    const tanksHere = atTime.filter((p) => p.role === "tank");
    const supportsHere = atTime.filter((p) => p.role === "support");
    const dealersHere = atTime.filter((p) => p.role === "dealer");

    [...supportsHere].sort(byPowerDesc).forEach((entry) => {
      if (!place(entry, "support", parties)) supportSurplus.push(entry);
    });

    const tankLeftoverHere = [];
    [...tanksHere].sort(byPowerDesc).forEach((entry) => {
      if (!place(entry, "tank", parties)) tankLeftoverHere.push(entry);
    });

    [...dealersHere].sort(byPowerDesc).forEach((entry) => {
      if (!place(entry, "dealer", parties)) dealerSurplus.push(entry);
    });

    /* 탱커 잉여 1차 처리: 같은 시간대의 빈 딜러 슬롯에 교차 배치 검토 (실제 역할 표시는 "tank" 유지) */
    tankLeftoverHere.sort(byPowerDesc).forEach((entry) => {
      if (!place(entry, "dealer", parties)) tankSurplus.push(entry);
    });
  });

  /* ---- 일반 재시도 (정합화 노트 2.3 — 2026-07-08 확정) ----
     3단계에서 밀린 일반(및 both) 캐릭터를, 본인이 신청한 다른 시간대의 빈 슬롯에 배치
     시도합니다. 빈 슬롯에만 배정하며(연쇄 방지), 동일 대표 동일 시간 제약과 해당
     시간대의 슬롯 규칙(서포터 교차 금지 등)을 그대로 따릅니다.
     [Inference] 여러 후보 시간이 있으면 전투력 합계가 가장 낮은 파티(균형 우선)를 고릅니다 —
     명세에 시간 간 우선순위가 별도로 없어 기존 배치 함수의 균형 기준을 그대로 적용했습니다. */
  function retryOtherTime(entry, tryRoles) {
    if (!repTimeUsed[entry.repName]) repTimeUsed[entry.repName] = new Set();
    const otherTimes = entry.allowedTimes.filter(
      (t) => t !== entry.time && !repTimeUsed[entry.repName].has(t) && partyCountAtTime[t] > 0
    );
    if (otherTimes.length === 0) return false;
    const poolParties = Object.values(partiesByKey).filter((p) => otherTimes.includes(p.time));
    for (const slotRole of tryRoles) {
      const landed = place(entry, slotRole, poolParties);
      if (landed) {
        const idx = placedNormal.findIndex((p) => p.repName === entry.repName && p.char.id === entry.char.id);
        if (idx !== -1) placedNormal[idx] = { ...placedNormal[idx], time: landed.time };
        return true;
      }
    }
    return false;
  }

  let supportStillUnplaced = [];
  supportSurplus.forEach((entry) => {
    if (!retryOtherTime(entry, ["support"])) supportStillUnplaced.push(entry);
  });

  let tankStillUnplaced = [];
  tankSurplus.forEach((entry) => {
    if (!retryOtherTime(entry, ["tank", "dealer"])) tankStillUnplaced.push(entry);
  });

  let dealerStillUnplaced = [];
  dealerSurplus.forEach((entry) => {
    if (!retryOtherTime(entry, ["dealer"])) dealerStillUnplaced.push(entry);
  });

  /* ---- 미배정 구제 재배치 (신설, 미배정_구제재배치_요청_프롬프트 2026-07-09 확정) ----
     같은 대표의 다른 캐릭터 X가 시간 T를 이미 점유하고 있어서(슬롯 자체는 비어 있는데도
     "동일 대표 동일 시간 1명" 제약 때문에) 배정되지 못한 미배정 후보에 대해, X를 X 자신의
     다른 신청 시간으로 1-스텝만 이동시켜 T를 비우고 그 자리를 대신 채웁니다. 연쇄 이동은
     하지 않으며(X를 옮기기 위해 또 다른 캐릭터를 옮기지 않음), X의 원래 자리는 빈 슬롯으로만
     남기고 파티를 삭제·축소하지 않으므로 기존 배치자를 밀어내는 경우가 구조적으로 발생하지
     않습니다 [Inference — 안전한 단순화: 원 문서는 "파티 축소로 밀려나면 포기"를 요구하는데,
     파티를 절대 축소·삭제하지 않는 방식으로 구현해 그 위험 자체를 없앴습니다]. 전역 균형
     스왑·지원 채우기보다 먼저 실행합니다. 후보 시간이 여럿이면 [Inference] 앞에서부터 순서대로
     첫 성공을 채택합니다(균형 점수로 "최선"을 고르지는 않음 — 드문 예외 경로라 단순화). */
  function findEmptySlotFor(role, t) {
    const partiesAtT = Object.values(partiesByKey).filter((p) => p.time === t);
    const tryRole = (slotRole) => {
      for (const p of partiesAtT) {
        const idx = p.slots.findIndex((s) => !s.nickname && s.role === slotRole);
        if (idx !== -1) return { party: p, idx };
      }
      return null;
    };
    if (role === "support") return tryRole("support");
    if (role === "tank") return tryRole("tank") || tryRole("dealer");
    return tryRole("dealer");
  }

  function placeRescued(entry, party, idx) {
    const power = charFinalPower(entry.char, content);
    party.slots[idx] = { role: entry.char.role, nickname: entry.char.nickname, repName: entry.repName, characterId: entry.char.id, type: "normal" };
    party._powerSum += power; party._filledCount++;
    placedSlotOf[charKey(entry.repName, entry.char)] = { time: party.time, partyNumber: party.partyNumber, slotIndex: idx };
    if (!repTimeUsed[entry.repName]) repTimeUsed[entry.repName] = new Set();
    repTimeUsed[entry.repName].add(party.time);
    const pnIdx = placedNormal.findIndex((p) => p.repName === entry.repName && p.char.id === entry.char.id);
    if (pnIdx !== -1) {
      placedNormal[pnIdx] = { ...placedNormal[pnIdx], time: party.time };
    } else {
      // step1Failed 출신(1단계에서 즉시 배정 실패해 placedNormal에 등록된 적 없는 항목)은
      // 여기서 새로 push해야 합니다. 그렇지 않으면 placedSlotOf에는 등록되었지만
      // placedNormal에는 없는 상태로 남아, 이후 스왑 단계의 placedNormal 조회에서
      // undefined가 되어 크래시가 발생합니다 (버그 ① 수정).
      placedNormal.push({
        repName: entry.repName,
        char: entry.char,
        role: entry.char.role,
        time: party.time,
        allowedTimes: entry.allowedTimes,
        type: entry.type,
      });
    }
  }

  function vacate(repName, char) {
    const key = charKey(repName, char);
    const loc = placedSlotOf[key];
    if (!loc) return;
    const party = partiesByKey[`${loc.time}:${loc.partyNumber}`];
    const power = charFinalPower(char, content);
    party.slots[loc.slotIndex] = { role: party.slots[loc.slotIndex].role, nickname: null, repName: null, characterId: null, type: null };
    party._powerSum -= power; party._filledCount--;
    delete placedSlotOf[key];
  }

  function tryRescue(u) {
    if (!u.allowedTimes) return false;
    for (const t of u.allowedTimes) {
      if (!Object.values(partiesByKey).some((p) => p.time === t)) continue; // 이 시간대엔 파티 자체가 없음
      const slot = findEmptySlotFor(u.char.role, t);
      if (!slot) continue;
      // t가 자기 자신의 원래 신청 시간인 경우도 다시 확인합니다 — 다른 캐릭터의 구제 재배치
      // 과정에서 새 파티가 생기거나 자리가 비었을 수 있기 때문입니다(자기 자신은 id 비교로
      // 제외되므로 자기 자신과 충돌로 오판하지 않습니다).
      const xEntry = placedNormal.find((p) => p.repName === u.repName && p.time === t && p.char.id !== u.char.id);
      if (!xEntry) {
        // 아무도 막고 있지 않음 — 자리가 비었으니 바로 배정합니다.
        if (!repTimeUsed[u.repName]) repTimeUsed[u.repName] = new Set();
        repTimeUsed[u.repName].add(t);
        placeRescued(u, slot.party, slot.idx);
        return true;
      }

      const candidateU = xEntry.allowedTimes.filter(
        (ut) => ut !== t && !(repTimeUsed[xEntry.repName] && repTimeUsed[xEntry.repName].has(ut))
      );
      let moved = false;
      for (const ut of candidateU) {
        let slotX = findEmptySlotFor(xEntry.role, ut);
        if (!slotX && xEntry.role === "dealer" && dealerSlots > 0) {
          // 딜러는 빈 딜러 슬롯이 전혀 없으면(=이미 가득 참) 새 파티를 하나 만들어 이동시킵니다.
          // 딜러 기준 ceil 공식상 딜러 +1은 항상 파티 하나를 정당화하므로(가득 찬 상태에서
          // 하나 늘면 ceil이 반드시 한 단계 올라감) 별도 조건 계산 없이 바로 생성해도 공식과
          // 어긋나지 않습니다 [Inference — 수학적으로 자명].
          const newP = createNewParty(ut);
          const idx = newP.slots.findIndex((s) => s.role === "dealer");
          if (idx !== -1) slotX = { party: newP, idx };
        }
        if (!slotX) continue;
        vacate(xEntry.repName, xEntry.char);
        if (repTimeUsed[xEntry.repName]) repTimeUsed[xEntry.repName].delete(t);
        placeRescued(xEntry, slotX.party, slotX.idx);
        moved = true;
        break;
      }
      if (!moved) continue;

      if (!repTimeUsed[u.repName]) repTimeUsed[u.repName] = new Set();
      repTimeUsed[u.repName].add(t);
      placeRescued(u, slot.party, slot.idx);
      return true;
    }
    return false;
  }

  const step1FailedStillUnplaced = step1Failed.filter((entry) => !tryRescue(entry));
  step1FailedStillUnplaced.forEach((entry) => unassigned.push(entry));

  supportStillUnplaced = supportStillUnplaced.filter((entry) => !tryRescue(entry));
  tankStillUnplaced = tankStillUnplaced.filter((entry) => !tryRescue(entry));
  dealerStillUnplaced = dealerStillUnplaced.filter((entry) => !tryRescue(entry));

  /* 서포터 잉여: 구제 재배치까지 실패하면 교차 배치 없이 바로 미배정 처리 (수정안 4.1절) */
  supportStillUnplaced.forEach((entry) => unassigned.push({ ...entry, reason: "배정 가능한 서포터 자리가 없습니다." }));

  /* 탱커 잉여는 재시도까지 실패해도 즉시 미배정하지 않고, 아래 딜러 잉여 신규 파티 생성의
     "탱커 잉여 검토"(6.3절 3항)에 마지막으로 한 번 더 쓰일 수 있습니다. 신규 파티에서도
     쓰이지 못한 나머지만 이후 최종 미배정 처리합니다. */
  let tankPoolForNewParty = [...tankStillUnplaced];

  /* ---- 지원 신청 후보 풀 구성 ----
     both 캐릭터는 일반 배정(재시도 포함)이 최종 성공하면 그 시간만 지원 후보에서 제외되고,
     최종 실패(unassigned에 both/normal로 기록됨)하면 지원 후보에서 완전히 제외됩니다
     (정합화 노트 2.4 — "일반 배정이 실패하면 지원도 실패한다". 기존 "1단계 실패 시 전체
     시간을 지원 후보로 유지" 규칙은 폐기되었습니다). 딜러 잉여의 최종 성패는 아래 신규 파티
     생성 단계 이후에만 확정되므로, 이 함수는 신규 파티 생성 전/후 두 번 호출해 각각의
     시점에서 유효한 풀을 만듭니다. */
  const supportCharsBase = groupCandidatesByChar(supportCandidatesRaw);
  function buildSupportChars() {
    return supportCharsBase
      .map((sc) => {
        // sc.types는 "지원" 관점(support/both)에서 수집된 신청 유형 집합입니다. both가 없다면
        // 애초에 일반 배정을 시도한 적 없는 순수 지원 신청이므로 항상 그대로 유지합니다.
        if (!sc.types.includes("both")) return sc;
        const key = charKey(sc.repName, sc.char);
        // 1단계에서 즉시 배정 실패한 both 캐릭터는 placedNormal에 아예 등록되지 않으므로,
        // placedNormal 조회 대신 placedSlotOf(최종 성공)와 unassigned(최종 실패) 상태를 직접
        // 확인합니다 — 그래야 1단계 즉시 실패 케이스도 정확히 "지원 후보 제외"로 처리됩니다.
        const loc = placedSlotOf[key];
        if (loc) return { ...sc, times: sc.times.filter((t) => t !== loc.time) }; // 일반 배정 성공 — 그 시간만 제외
        const failed = unassigned.some((u) => u.repName === sc.repName && u.char.id === sc.char.id);
        if (failed) return null; // 일반 배정 최종 실패(1단계 즉시 실패 포함) — 지원 후보에서도 완전히 제외
        return sc; // 아직 최종 결과가 확정되지 않은 딜러 잉여 신규 파티 대기 상태 — 원래 시간 유지(pending)
      })
      .filter((sc) => sc && sc.times.length > 0);
  }

  /* ---- 딜러 잉여 신규 파티 생성 (수정안 5~8절) ---- */
  let remainingDealers = [...dealerStillUnplaced];

  function pickUsableDealersForTime(pool, t) {
    // 서로 다른 대표 캐릭터당 1명만, 해당 시간에 이미 배정된 대표는 제외 (6.4절)
    const usedReps = new Set();
    const usable = [];
    pool.forEach((d) => {
      if (!d.allowedTimes.includes(t)) return;
      if (repTimeUsed[d.repName] && repTimeUsed[d.repName].has(t)) return;
      if (usedReps.has(d.repName)) return;
      usedReps.add(d.repName);
      usable.push(d);
    });
    return usable;
  }

  function nextPartyNumber(t) {
    const nums = Object.values(partiesByKey).filter((p) => p.time === t).map((p) => p.partyNumber);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  }

  function createNewParty(t) {
    const partyNumber = nextPartyNumber(t);
    const p = {
      time: t, partyNumber,
      slots: slotOrder.map((role) => ({ role, nickname: null, repName: null, characterId: null, type: null })),
      _powerSum: 0, _filledCount: 0,
    };
    partiesByKey[`${t}:${partyNumber}`] = p;
    return p;
  }

  function placeDirect(entry, slotRole, party, slotType, registerNormal) {
    const idx = party.slots.findIndex((s) => !s.nickname && s.role === slotRole);
    if (idx === -1) return false;
    const power = charFinalPower(entry.char, content);
    party.slots[idx] = { role: entry.role || slotRole, nickname: entry.char.nickname, repName: entry.repName, characterId: entry.char.id, type: slotType };
    party._powerSum += power; party._filledCount++;
    if (registerNormal) placedSlotOf[charKey(entry.repName, entry.char)] = { time: party.time, partyNumber: party.partyNumber, slotIndex: idx };
    if (!repTimeUsed[entry.repName]) repTimeUsed[entry.repName] = new Set();
    repTimeUsed[entry.repName].add(party.time);
    return true;
  }

  function fillTankSurplusIfAny(party, t, usedReps) {
    const idx = tankPoolForNewParty.findIndex(
      (cand) => cand.allowedTimes.includes(t) && !usedReps.has(cand.repName) && !(repTimeUsed[cand.repName] && repTimeUsed[cand.repName].has(t))
    );
    if (idx === -1) return;
    const cand = tankPoolForNewParty[idx];
    if (placeDirect(cand, "tank", party, "normal", true)) {
      const pnIdx = placedNormal.findIndex((p) => p.repName === cand.repName && p.char.id === cand.char.id);
      if (pnIdx !== -1) placedNormal[pnIdx] = { ...placedNormal[pnIdx], time: party.time };
      tankPoolForNewParty.splice(idx, 1);
    }
  }

  if (dealerSlots > 0) {
    /* 6절: 지원 서포터를 포함한 신규 파티 생성. 지원 서포터를 구할 수 있는 동안 반복합니다.
       [Inference] 시간 선택 기준은 6.2절의 1)배정 가능 딜러 수 2)서로 다른 대표 수를 핵심
       criteria로 사용했습니다(균형·잔여 활용성은 부차 기준으로, 별도 점수화하지 않았습니다 —
       이 경로는 정합화 노트 2.1에 따라 실사용에서는 드물게만 발동할 것으로 예상됩니다). */
    function tryCreatePartyWithSupport(supportPool) {
      const timeCandidates = new Set();
      remainingDealers.forEach((d) => d.allowedTimes.forEach((t) => timeCandidates.add(t)));
      let best = null;
      timeCandidates.forEach((t) => {
        const usableDealers = pickUsableDealersForTime(remainingDealers, t);
        if (usableDealers.length === 0) return;
        const dealerRepsAtTime = new Set(usableDealers.map((d) => d.repName));
        const usableSupports = supportPool.filter(
          (sc) => sc.times.includes(t) && !(repTimeUsed[sc.repName] && repTimeUsed[sc.repName].has(t)) && !dealerRepsAtTime.has(sc.repName)
        );
        if (usableSupports.length === 0) return;
        const dealerCount = Math.min(usableDealers.length, dealerSlots);
        const distinctReps = new Set(usableDealers.slice(0, dealerSlots).map((d) => d.repName)).size;
        if (!best || dealerCount > best.dealerCount || (dealerCount === best.dealerCount && distinctReps > best.distinctReps)) {
          best = { time: t, dealerCount, distinctReps, usableDealers, usableSupports };
        }
      });
      if (!best) return false;

      const party = createNewParty(best.time);
      const support = [...best.usableSupports].sort(byPowerDesc)[0];
      placeDirect(support, "support", party, "support", false);
      const dealersToPlace = [...best.usableDealers].sort(byPowerDesc).slice(0, dealerSlots);
      dealersToPlace.forEach((d) => {
        placeDirect(d, "dealer", party, "normal", true);
        remainingDealers = remainingDealers.filter((x) => x !== d);
      });
      const usedReps = new Set([support.repName, ...dealersToPlace.map((d) => d.repName)]);
      fillTankSurplusIfAny(party, best.time, usedReps);
      return true;
    }

    let supportPoolForNewParty = buildSupportChars().filter((sc) => sc.char.role === "support");
    let guardA = 0;
    while (remainingDealers.length > 0 && guardA < 500) {
      guardA++;
      if (!tryCreatePartyWithSupport(supportPoolForNewParty)) break;
      // 지원 후보 풀은 신규 파티가 생길 때마다 repTimeUsed 변화를 반영해 다시 계산합니다.
      supportPoolForNewParty = buildSupportChars().filter((sc) => sc.char.role === "support");
    }

    /* 7절: 지원 서포터를 찾을 수 없으면 딜러만으로 신규 파티 생성 (서포터 자리는 빈 슬롯 유지) */
    function tryCreatePartyWithoutSupport() {
      const timeCandidates = new Set();
      remainingDealers.forEach((d) => d.allowedTimes.forEach((t) => timeCandidates.add(t)));
      let best = null;
      timeCandidates.forEach((t) => {
        const usableDealers = pickUsableDealersForTime(remainingDealers, t);
        if (usableDealers.length === 0) return;
        const dealerCount = Math.min(usableDealers.length, dealerSlots);
        const distinctReps = new Set(usableDealers.slice(0, dealerSlots).map((d) => d.repName)).size;
        if (!best || dealerCount > best.dealerCount || (dealerCount === best.dealerCount && distinctReps > best.distinctReps)) {
          best = { time: t, dealerCount, distinctReps, usableDealers };
        }
      });
      if (!best) return false;

      const party = createNewParty(best.time);
      const dealersToPlace = [...best.usableDealers].sort(byPowerDesc).slice(0, dealerSlots);
      dealersToPlace.forEach((d) => {
        placeDirect(d, "dealer", party, "normal", true);
        remainingDealers = remainingDealers.filter((x) => x !== d);
      });
      const usedReps = new Set(dealersToPlace.map((d) => d.repName));
      fillTankSurplusIfAny(party, best.time, usedReps);
      return true;
    }

    let guardB = 0;
    while (remainingDealers.length > 0 && guardB < 500) {
      guardB++;
      if (!tryCreatePartyWithoutSupport()) break;
    }
  }

  /* 8절: 그래도 배치할 수 없는 딜러 / 신규 파티에도 쓰이지 못한 탱커 잉여는 사유와 함께 미배정 */
  remainingDealers.forEach((entry) => {
    if (!repTimeUsed[entry.repName]) repTimeUsed[entry.repName] = new Set();
    // entry.time(1단계에서 이미 배정된 자기 자신의 시간)은 "동일 대표 충돌"이 아니라 단순히 그
    // 시간에 자리가 없었던 것이므로 제외하고, 그 외 신청 시간이 전부 같은 대표의 다른 캐릭터로
    // 막혀 있는 경우에만 "동일 대표 충돌" 사유를 사용합니다.
    const otherAllowed = entry.allowedTimes.filter((t) => t !== entry.time);
    const blocked = otherAllowed.length > 0 && otherAllowed.every((t) => repTimeUsed[entry.repName].has(t));
    const reason = blocked
      ? "동일 대표 캐릭터의 다른 캐릭터가 해당 시간에 이미 배정되어 있습니다."
      : "신청한 시간에 배정 가능한 신규 파티를 생성할 수 없습니다.";
    unassigned.push({ ...entry, reason });
  });
  tankPoolForNewParty.forEach((entry) => unassigned.push({ ...entry, reason: "배정 가능한 탱커 또는 딜러 자리가 없습니다." }));

  /* ---- 신규 파티 생성 이후 미배정 일반(및 both) 재구제 패스 (신설, "일반 우선" 원칙 수정,
     재매칭_크래시_일반우선_수정_요청_프롬프트 2026-07-09 확정, 버그 ②) ----
     여기까지 온 unassigned 항목(1단계 실패/서포터·탱커·딜러 잉여)은 각자 재시도를 시도한
     시점에는 존재하지 않았던 빈 슬롯 — 특히 위 딜러 잉여 신규 파티 생성 단계에서 지원
     서포터를 구하지 못해 서포터 자리가 빈 채로 남은 새 파티 — 을 다시 받아보지 못한 채
     미배정으로 확정되어 있었습니다. 그 결과 아래 "잔여 지원 신청 배치"(9.10절) 단계에서
     지원 신청자가 먼저 그 빈 자리를 채워버려, "일반 배정이 지원보다 우선"이라는 원칙이
     깨지는 문제가 있었습니다. 지원 채우기보다 먼저, 현재 unassigned 전원을 대상으로
     기존 구제 로직(tryRescue)을 한 번 더 시도해 이 문제를 해결합니다. */
  const secondRescuePassCandidates = unassigned.splice(0, unassigned.length);
  secondRescuePassCandidates.forEach((entry) => {
    if (!tryRescue(entry)) unassigned.push(entry);
  });

  /* ---- 균형 조정: 같은 역할·서로 다른 시간 사이의 지역 탐색 (신규 파티 포함, 9.9절) ----
     신청한 시간 범위 안에서만 스왑을 시도합니다. 지원 배치(placeDirect의 registerNormal=false)로
     채운 자리는 스왑 후보에서 제외되지만, 파티 전투력 합계 계산에는 포함됩니다. */
  function partyAverages() {
    return Object.values(partiesByKey).filter((p) => p._filledCount > 0).map((p) => p._powerSum / p._filledCount);
  }
  function objective() { return stdev(partyAverages()); }

  const placedList = Object.entries(placedSlotOf)
    .map(([key, loc]) => {
      const [repName, characterId] = key.split(":");
      const info = placedNormal.find((p) => p.repName === repName && p.char.id === characterId);
      // [Inference] 방어적 가드: 근본 수정(placeRescued의 placedNormal 등록)으로 이 경로가
      // 정상적으로는 발생하지 않아야 하지만, 예기치 못한 경로로 placedSlotOf에만 등록되고
      // placedNormal에는 없는 상태가 생기더라도 크래시 대신 해당 항목만 스왑 후보에서 조용히
      // 제외합니다 (버그 ① 방어 가드).
      if (!info) return null;
      return { repName, characterId, role: info.char.role, loc, allowedTimes: info.allowedTimes, char: info.char };
    })
    .filter(Boolean);

  const MAX_SWAP_ITER = 300;
  let improved = true, iter = 0;
  while (improved && iter < MAX_SWAP_ITER) {
    improved = false;
    iter++;
    outer:
    for (let i = 0; i < placedList.length; i++) {
      for (let j = i + 1; j < placedList.length; j++) {
        const a = placedList[i], b = placedList[j];
        // 스왑 호환성은 캐릭터 역할이 아닌 원래 슬롯 타입(slotOrder 기준)으로 판단합니다.
        // 탱커가 딜러 슬롯에 교차배치된 경우 a.role="tank"이지만 slotOrder 인덱스는 딜러
        // 구간에 속하므로, 동일 딜러 슬롯의 일반 딜러(a.role="dealer")와 스왑이 허용됩니다.
        const slotTypeA = slotOrder[a.loc.slotIndex];
        const slotTypeB = slotOrder[b.loc.slotIndex];
        if (slotTypeA !== slotTypeB || a.loc.time === b.loc.time) continue;
        if (!a.allowedTimes.includes(b.loc.time) || !b.allowedTimes.includes(a.loc.time)) continue;
        const collideA = placedList.some((x) => x !== a && x.repName === a.repName && x.loc.time === b.loc.time);
        const collideB = placedList.some((x) => x !== b && x.repName === b.repName && x.loc.time === a.loc.time);
        if (collideA || collideB) continue;

        const partyA = partiesByKey[`${a.loc.time}:${a.loc.partyNumber}`];
        const partyB = partiesByKey[`${b.loc.time}:${b.loc.partyNumber}`];
        const slotA = partyA.slots[a.loc.slotIndex];
        const slotB = partyB.slots[b.loc.slotIndex];
        // 슬롯 타입이 동일함은 위에서 slotOrder 기준으로 확인했습니다.
        // 교차배정으로 slotA.role ≠ slotB.role일 수 있으나(예: "tank" vs "dealer"),
        // 두 슬롯 모두 원래 딜러 슬롯이므로 맞교환이 유효합니다.
        const powerA = charFinalPower(a.char, content), powerB = charFinalPower(b.char, content);

        const before = objective();
        partyA.slots[a.loc.slotIndex] = slotB;
        partyB.slots[b.loc.slotIndex] = slotA;
        partyA._powerSum += powerB - powerA;
        partyB._powerSum += powerA - powerB;
        const after = objective();

        if (after < before - 1e-9) {
          const tmp = a.loc; a.loc = b.loc; b.loc = tmp;
          improved = true;
          break outer;
        } else {
          partyA.slots[a.loc.slotIndex] = slotA;
          partyB.slots[b.loc.slotIndex] = slotB;
          partyA._powerSum += powerA - powerB;
          partyB._powerSum += powerB - powerA;
        }
      }
    }
  }

  /* ---- 잔여 지원 신청 배치 (9.10절, 지원강캐우선_딜러집중배치 통합 요청 요청①과 동일 방식) ----
     전투력 높은 지원자부터 순서대로, 전체 평균에 가장 가까워지는 자리를 채웁니다. 신규 파티의
     빈 슬롯도 이 단계의 대상에 포함됩니다. both 캐릭터의 일반 배정이 신규 파티 생성 단계에서
     최종적으로 확정되었으므로, 여기서 지원 후보 풀을 다시 계산해 최종 실패한 both 캐릭터를
     완전히 제외합니다(정합화 노트 2.4). */
  const supportChars = buildSupportChars();

  const repTimeOccupied = {}; // `${repName}:${time}` -> true
  Object.values(partiesByKey).forEach((p) => {
    p.slots.forEach((s) => { if (s.repName) repTimeOccupied[`${s.repName}:${p.time}`] = true; });
  });

  const emptySlots = [];
  Object.values(partiesByKey).forEach((p) => {
    p.slots.forEach((s, si) => { if (!s.nickname) emptySlots.push({ party: p, slotIndex: si, role: s.role }); });
  });

  const supportSortedDesc = [...supportChars].sort((a, b) => charFinalPower(b.char, content) - charFinalPower(a.char, content));

  function findBestSlotFor(sc) {
    const avgs = partyAverages();
    const target = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0;
    // 역할 우선 2단계 (지원채우기_역할우선_수정_요청_프롬프트, 2026-07-08 확정):
    // 1순위 = 본래 역할과 같은 빈 슬롯, 2순위 = 그런 슬롯이 전혀 없을 때만 교차 슬롯.
    // 같은 순위 등급 안에서는 기존과 동일하게 균형 점수(채웠을 때 파티 평균이 전체 평균에
    // 가장 가까워지는 자리)로 고릅니다. 서포터 슬롯은 여전히 서포터 후보만 채울 수 있습니다
    // (1.2절, 변경 금지 범위).
    let bestIdx = -1, bestScore = Infinity, bestTier = Infinity;
    emptySlots.forEach((es, idx) => {
      if (es.party.slots[es.slotIndex].nickname) return;
      if (es.role === "support" && sc.char.role !== "support") return;
      if (!sc.times.includes(es.party.time)) return;
      if (repTimeOccupied[`${sc.repName}:${es.party.time}`]) return;
      const tier = es.role === sc.char.role ? 0 : 1;
      const power = charFinalPower(sc.char, content);
      const newAvg = (es.party._powerSum + power) / (es.party._filledCount + 1);
      const score = Math.abs(newAvg - target);
      if (tier < bestTier || (tier === bestTier && score < bestScore)) { bestTier = tier; bestScore = score; bestIdx = idx; }
    });
    return bestIdx === -1 ? null : bestIdx;
  }

  function assignSupport(sc, slotArrIdx) {
    const es = emptySlots[slotArrIdx];
    const power = charFinalPower(sc.char, content);
    es.party.slots[es.slotIndex] = { role: sc.char.role, nickname: sc.char.nickname, repName: sc.repName, characterId: sc.char.id, type: "support" };
    es.party._powerSum += power; es.party._filledCount++;
    repTimeOccupied[`${sc.repName}:${es.party.time}`] = true;
    emptySlots.splice(slotArrIdx, 1);
  }

  // 패스 1: 미배정 지원자 전원을 전투력 내림차순으로 1회씩 시도
  for (const sc of supportSortedDesc) {
    if (emptySlots.length === 0) break;
    const idx = findBestSlotFor(sc);
    if (idx !== null) assignSupport(sc, idx);
  }

  // 패스 2 이상: 빈자리가 남아있는 동안, 전투력 내림차순 순서를 유지하며 반복 배정
  let guard = 0;
  while (emptySlots.length > 0 && guard < 2000) {
    guard++;
    let anyPlaced = false;
    for (const sc of supportSortedDesc) {
      if (emptySlots.length === 0) break;
      const idx = findBestSlotFor(sc);
      if (idx !== null) { assignSupport(sc, idx); anyPlaced = true; }
    }
    if (!anyPlaced) break;
  }

  /* ---- 같은 시간대 파티 병합 (신설, 2026-07-09) ----
     여기까지의 단계들(구제 재배치·딜러 잉여 신규 파티 생성 등)은 기존 파티에 빈 슬롯이
     남아있어도 그걸 확인하지 않고 새 파티부터 만드는 경로가 있어, 같은 시간대에 인원이
     나뉘어도 될 필요가 없는 파티가 2개 이상 생길 수 있었습니다(예: 23:00에 파티1이 딜러
     슬롯 하나를 비운 채 남아있는데, 뒤늦게 구제된 다른 딜러가 새 파티2로 배정되는 경우).
     이 단계는 최종적으로 그런 경우를 정리합니다: 같은 시간대에서 인원이 가장 적은 파티부터,
     그 인원 전원을 같은 시간대의 다른 파티의 빈 슬롯(동일 대표 캐릭터 충돌 없음)으로 옮길
     수 있으면 옮기고 비워진 파티는 삭제합니다. 전원을 옮기지 못하면(빈 슬롯 부족 등) 그
     파티는 그대로 둡니다 — 부분적으로만 합치면 오히려 배정을 되돌리는 셈이라 전원 이동
     가능한 경우에만 실행합니다. */
  function mergePartiesAtSameTime() {
    const byTime = {};
    Object.values(partiesByKey).forEach((p) => {
      (byTime[p.time] = byTime[p.time] || []).push(p);
    });
    Object.values(byTime).forEach((partiesAtTime) => {
      let changed = true;
      while (changed && partiesAtTime.length > 1) {
        changed = false;
        const sorted = [...partiesAtTime].sort((a, b) => a._filledCount - b._filledCount);
        for (const source of sorted) {
          if (source._filledCount === 0) continue;
          const targets = partiesAtTime.filter((p) => p !== source);
          if (targets.length === 0) continue;
          const members = source.slots
            .map((s, idx) => ({ slot: s, idx }))
            .filter((x) => x.slot.nickname);
          const reservedByTarget = new Map();
          const moves = [];
          let feasible = true;
          for (const m of members) {
            let placed = false;
            for (const target of targets) {
              if (target.slots.some((ts) => ts.repName === m.slot.repName)) continue; // 동일 대표 충돌
              const reserved = reservedByTarget.get(target) || new Set();
              const emptyIdx = target.slots.findIndex(
                (ts, tsi) => !ts.nickname && ts.role === m.slot.role && !reserved.has(tsi)
              );
              if (emptyIdx === -1) continue;
              reserved.add(emptyIdx);
              reservedByTarget.set(target, reserved);
              moves.push({ member: m, target, slotIdx: emptyIdx });
              placed = true;
              break;
            }
            if (!placed) { feasible = false; break; }
          }
          if (!feasible || moves.length !== members.length) continue; // 전원 이동 가능할 때만 병합

          moves.forEach(({ member, target, slotIdx }) => {
            const charObj = (reps[member.slot.repName] && (reps[member.slot.repName].subs || [])
              .find((s) => s.id === member.slot.characterId)) || null;
            const power = charObj ? charFinalPower(charObj, content) : 0;
            target.slots[slotIdx] = { ...member.slot };
            target._powerSum += power; target._filledCount++;
            source.slots[member.idx] = { role: member.slot.role, nickname: null, repName: null, characterId: null, type: null };
            source._powerSum -= power; source._filledCount--;
            const key = `${member.slot.repName}:${member.slot.characterId}`;
            if (placedSlotOf[key]) {
              placedSlotOf[key] = { time: target.time, partyNumber: target.partyNumber, slotIndex: slotIdx };
            }
          });

          delete partiesByKey[`${source.time}:${source.partyNumber}`];
          const removeIdx = partiesAtTime.indexOf(source);
          if (removeIdx !== -1) partiesAtTime.splice(removeIdx, 1);
          changed = true;
          break;
        }
      }
    });
  }
  mergePartiesAtSameTime();

  /* ---- aggressive 모드: 미배정 복구 패스 (Pass 0 → A → B) ----
   * Pass 0: Rep 충돌 해소 — 빈 슬롯은 있는데 같은 대표 캐릭터가 막고 있을 때,
   *   그 캐릭터를 다른 시간대 빈 슬롯으로 옮기고 U를 배정.
   * Pass A: 지원 슬롯 교체 — U의 시간대에 지원 타입 슬롯이 있으면,
   *   그 지원자를 다른 시간으로 옮기고 U를 배정.
   * Pass B: 일반 배정자 교환 — 같은 역할의 일반 배정자를
   *   다른 시간으로 옮기고 U를 배정.
   * 모두 1-스텝만, 연쇄 이동 없음. [Inference] 휴리스틱, 최적해 비보장.
   */
  let aggressiveResolved = 0;
  if (aggressive && unassigned.length > 0) {
    const initialCount = unassigned.length;

    function findEmptySlotGlobal(role, time, excludeRepName) {
      for (const p of Object.values(partiesByKey).filter((p2) => p2.time === time)) {
        if (excludeRepName && p.slots.some((s) => s.repName === excludeRepName && s.nickname)) continue;
        const idx = p.slots.findIndex((s) => !s.nickname && s.role === role);
        if (idx !== -1) return { party: p, idx };
      }
      return null;
    }

    function writeSlotAgg(party, slotIdx, repName, char, slotType) {
      party.slots[slotIdx] = { role: char.role, nickname: char.nickname, repName, characterId: char.id, type: slotType };
      party._powerSum += charFinalPower(char, content);
      party._filledCount++;
      if (!repTimeUsed[repName]) repTimeUsed[repName] = new Set();
      repTimeUsed[repName].add(party.time);
    }

    function clearSlotAgg(party, slotIdx) {
      const s = party.slots[slotIdx];
      if (!s.nickname) return;
      const ch = s.characterId ? (reps[s.repName]?.subs || []).find((c) => c.id === s.characterId) : null;
      party._powerSum -= ch ? charFinalPower(ch, content) : 0;
      party._filledCount--;
      if (repTimeUsed[s.repName]) repTimeUsed[s.repName].delete(party.time);
      party.slots[slotIdx] = { role: s.role, nickname: null, repName: null, characterId: null, type: null };
    }

    function getAllowedTimesAgg(repName, characterId) {
      const times = new Set();
      (reps[repName]?.applications || []).forEach((app) => {
        if (app.contentId !== content.id || app.status === "cancelled") return;
        if ((app.characterIds || []).includes(characterId)) (app.times || []).forEach((t) => times.add(t));
      });
      return [...times];
    }

    const afterPass0 = [];
    for (const u of unassigned) {
      if (!u.char.id) { afterPass0.push(u); continue; }
      const uChar = (reps[u.repName]?.subs || []).find((s) => s.id === u.char.id);
      if (!uChar) { afterPass0.push(u); continue; }
      const uTimes = u.allowedTimes && u.allowedTimes.length ? u.allowedTimes : [u.time];
      let placed = false;
      outer0: for (const t of uTimes) {
        for (const party of Object.values(partiesByKey).filter((p) => p.time === t)) {
          const emptyIdx = party.slots.findIndex((s) => !s.nickname && s.role === u.char.role);
          if (emptyIdx === -1) continue;
          const blockerIdx = party.slots.findIndex((s) => s.repName === u.repName && s.nickname && s.characterId);
          if (blockerIdx === -1) continue;
          const bl = party.slots[blockerIdx];
          const blChar = (reps[bl.repName]?.subs || []).find((c) => c.id === bl.characterId);
          if (!blChar) continue;
          const blTimes = getAllowedTimesAgg(bl.repName, bl.characterId);
          let moved = false;
          for (const bt of blTimes) {
            if (bt === t) continue;
            if (repTimeUsed[bl.repName] && repTimeUsed[bl.repName].has(bt)) continue;
            const dest = findEmptySlotGlobal(blChar.role, bt, bl.repName);
            if (!dest) continue;
            clearSlotAgg(party, blockerIdx);
            writeSlotAgg(dest.party, dest.idx, bl.repName, blChar, bl.type || "normal");
            moved = true;
            break;
          }
          if (!moved) continue;
          writeSlotAgg(party, emptyIdx, u.repName, uChar, u.type || "normal");
          placed = true;
          break outer0;
        }
      }
      if (!placed) afterPass0.push(u);
    }

    const afterPassA = [];
    for (const u of afterPass0) {
      if (!u.char.id) { afterPassA.push(u); continue; }
      const uChar = (reps[u.repName]?.subs || []).find((s) => s.id === u.char.id);
      if (!uChar) { afterPassA.push(u); continue; }
      const uTimes = u.allowedTimes && u.allowedTimes.length ? u.allowedTimes : [u.time];
      let placed = false;
      outerA: for (const t of uTimes) {
        for (const party of Object.values(partiesByKey).filter((p) => p.time === t)) {
          if (party.slots.some((s) => s.repName === u.repName && s.nickname)) continue;
          const supIdx = party.slots.findIndex(
            (s) => s.nickname && s.role === u.char.role && s.type === "support" && s.repName !== u.repName && s.characterId
          );
          if (supIdx === -1) continue;
          const sv = party.slots[supIdx];
          const svChar = (reps[sv.repName]?.subs || []).find((c) => c.id === sv.characterId);
          if (!svChar) continue;
          const svTimes = getAllowedTimesAgg(sv.repName, sv.characterId);
          let moved = false;
          for (const svT of svTimes) {
            if (svT === t) continue;
            if (repTimeUsed[sv.repName] && repTimeUsed[sv.repName].has(svT)) continue;
            const dest = findEmptySlotGlobal(svChar.role, svT, sv.repName);
            if (!dest) continue;
            clearSlotAgg(party, supIdx);
            writeSlotAgg(dest.party, dest.idx, sv.repName, svChar, "support");
            moved = true;
            break;
          }
          if (!moved) continue;
          writeSlotAgg(party, supIdx, u.repName, uChar, u.type || "normal");
          placed = true;
          break outerA;
        }
      }
      if (!placed) afterPassA.push(u);
    }

    const finalUnassigned = [];
    for (const u of afterPassA) {
      if (!u.char.id) { finalUnassigned.push(u); continue; }
      const uChar = (reps[u.repName]?.subs || []).find((s) => s.id === u.char.id);
      if (!uChar) { finalUnassigned.push(u); continue; }
      const uTimes = u.allowedTimes && u.allowedTimes.length ? u.allowedTimes : [u.time];
      let placed = false;
      outerB: for (const t of uTimes) {
        for (const party of Object.values(partiesByKey).filter((p) => p.time === t)) {
          if (party.slots.some((s) => s.repName === u.repName && s.nickname)) continue;
          const nvList = party.slots.filter(
            (s) => s.nickname && s.role === u.char.role && s.repName !== u.repName && s.characterId && s.type !== "support"
          );
          for (const nv of nvList) {
            const nvChar = (reps[nv.repName]?.subs || []).find((c) => c.id === nv.characterId);
            if (!nvChar) continue;
            const nvSlotIdx = party.slots.indexOf(nv);
            const nvTimes = getAllowedTimesAgg(nv.repName, nv.characterId);
            let moved = false;
            for (const nvT of nvTimes) {
              if (nvT === t) continue;
              if (repTimeUsed[nv.repName] && repTimeUsed[nv.repName].has(nvT)) continue;
              const dest = findEmptySlotGlobal(nvChar.role, nvT, nv.repName);
              if (!dest) continue;
              clearSlotAgg(party, nvSlotIdx);
              writeSlotAgg(dest.party, dest.idx, nv.repName, nvChar, "normal");
              moved = true;
              break;
            }
            if (!moved) continue;
            writeSlotAgg(party, nvSlotIdx, u.repName, uChar, u.type || "normal");
            placed = true;
            break outerB;
          }
        }
      }
      if (!placed) finalUnassigned.push(u);
    }

    aggressiveResolved = initialCount - finalUnassigned.length;
    unassigned.length = 0;
    finalUnassigned.forEach((u) => unassigned.push(u));
  }

  /* ---- 동일 시간대 파티 간 균형 재배치 (신설, "22:50 파티 간 전투력 편차" 요청 반영) ----
     여기까지(구제 재배치·신규 파티 생성·스왑·지원 채우기·파티 병합·aggressive 복구)로 모든
     인원 배정이 끝난 뒤, 마지막으로 같은 시간대에 파티가 2개 이상 있으면 그 사이에서만
     "자리"를 맞바꿔 파티 평균 전투력의 표준편차를 줄입니다.

     시간 자체를 옮기는 게 아니라 같은 시간대 안에서 소속 파티만 바꾸는 것이므로:
     - 신청 시간(allowedTimes) 제약을 새로 확인할 필요가 없습니다 — 두 사람 모두 원래
       신청해서 배정된 바로 그 시간에 계속 남기 때문입니다.
     - "동일 대표 동일 시간 1명" 제약도 위반될 수 없습니다 — 대표 1명당 시간 1개에 캐릭터
       1명만 배정된다는 불변 조건은 이 시점까지 이미 전 과정에서 유지되어 왔고, 같은 시간대
       안에서 파티만 바꾸는 것은 그 불변 조건에 아무 영향도 주지 않습니다.
     - 지원으로 채워진 자리도 대상에 포함합니다(시간이 바뀌지 않으므로 지원 신청 시간과
       무관합니다). 다만 채워진 자리끼리만 맞바꾸고 빈 자리로 옮기지는 않습니다 — 그래야
       각 파티의 인원수·부족 현황이 그대로 유지됩니다. */
  function charFromSlot(slot) {
    if (!slot.characterId) return null;
    return (reps[slot.repName]?.subs || []).find((c) => c.id === slot.characterId) || null;
  }

  function rebalanceSameTime() {
    const timeGroups = {};
    Object.values(partiesByKey).forEach((p) => {
      (timeGroups[p.time] = timeGroups[p.time] || []).push(p);
    });
    Object.values(timeGroups).forEach((partiesAtT) => {
      if (partiesAtT.length < 2) return;
      const MAX_ITER = 300;
      let improved = true, iter = 0;
      while (improved && iter < MAX_ITER) {
        improved = false;
        iter++;
        outer:
        for (let i = 0; i < partiesAtT.length; i++) {
          for (let j = i + 1; j < partiesAtT.length; j++) {
            const partyA = partiesAtT[i], partyB = partiesAtT[j];
            for (let si = 0; si < partyA.slots.length; si++) {
              const slotA = partyA.slots[si];
              if (!slotA.nickname) continue;
              for (let sj = 0; sj < partyB.slots.length; sj++) {
                const slotB = partyB.slots[sj];
                if (!slotB.nickname) continue;
                // 슬롯 타입을 slotOrder 원본 기준으로 비교합니다. 탱커가 딜러 슬롯에
                // 교차배치된 경우 slotA.role="tank"/slotB.role="dealer"가 되어 이전에는
                // 스왑이 차단됐지만, 두 슬롯 모두 딜러 슬롯이면 맞교환이 유효합니다.
                if (slotOrder[si] !== slotOrder[sj]) continue;
                if (slotA.repName === slotB.repName) continue; // 안전 가드 — 이론상 발생하지 않음(동일 대표 동일 시간 1명 불변 조건)

                const charA = charFromSlot(slotA), charB = charFromSlot(slotB);
                const powerA = charA ? charFinalPower(charA, content) : 0;
                const powerB = charB ? charFinalPower(charB, content) : 0;

                const before = objective();
                partyA.slots[si] = slotB; partyB.slots[sj] = slotA;
                partyA._powerSum += powerB - powerA; partyB._powerSum += powerA - powerB;
                const after = objective();

                if (after < before - 1e-9) {
                  improved = true;
                  break outer;
                } else {
                  partyA.slots[si] = slotA; partyB.slots[sj] = slotB;
                  partyA._powerSum += powerA - powerB; partyB._powerSum += powerB - powerA;
                }
              }
            }
          }
        }
      }
    });
  }
  rebalanceSameTime();

  /* ---- 결과 정리 ---- */
  const parties = Object.values(partiesByKey)
    .map((p) => {
      const missing = {};
      p.slots.forEach((s) => { if (!s.nickname) missing[s.role] = (missing[s.role] || 0) + 1; });
      const parts = [];
      if (missing.tank) parts.push(`탱커 ${missing.tank}명 부족`);
      if (missing.support) parts.push(`서포터 ${missing.support}명 부족`);
      if (missing.dealer) parts.push(`딜러 ${missing.dealer}명 부족`);
      return { time: p.time, partyNumber: p.partyNumber, slots: p.slots, shortage: parts.length ? parts.join(" · ") : null };
    })
    .sort((a, b) => (a.time === b.time ? a.partyNumber - b.partyNumber : a.time < b.time ? -1 : 1));

  return { parties, unassigned, aggressiveResolved, generatedAt: Date.now(), published: false };
}

export { runAutoMatch, charFinalPower, timeSlots, buildCandidates, appliesNormal, appliesSupport };
