/* ============================================================
   matchEngine.experimental.js — 반복 개선(local search) 재설계 엔진

   매칭알고리즘_반복개선_재설계안.md (2026-07-10, 기획자 재확인 반영판) 구현체입니다.

   원래 matchEngine.js(순차 패치 파이프라인)는 그대로 두고, 이 파일을 나란히 둔 채
   GuildPartyMatcherAdmin.jsx에서 둘 다 import해 UI 드롭다운("안정형"/"균형최적화형")으로
   골라 쓰는 방식입니다(매칭로직_선택드롭다운_요청_프롬프트, 2026-07-10 — 파일명을
   바꿔치기하는 방식은 배포 시 에러가 잦아 폐기되었습니다). 파일명·경로를 손댈 필요가
   없습니다.

   [Inference] 이 파일은 설계 제안을 코드로 옮긴 것으로, 실제 라이브 데이터(구글시트)로
   재검증되지 않았습니다. 관리자 화면에서 "균형최적화형"을 선택해 matchEngine.js(안정형)와
   같은 데이터로 결과(미배정 수·사용 파티 수·전투력 표준편차·실행시간)를 비교해 주세요.

   [수정된 1절 확정] "딜러 0 시간대는 탱커 인원과 무관하게 파티를 생성하지 않는다"를
   따릅니다 (문서 5절 4항의 구버전 잔여 문구는 1절/6절/9-5절과 상충해 반영하지 않았습니다
   — 임땡님께 이미 이 판단 근거를 안내했습니다).
   ============================================================ */

import { timeSlots, charFinalPower, buildCandidates, appliesNormal, appliesSupport } from "./matchEngine";

/* matchEngine.js는 groupCandidatesByChar/stdev를 export하지 않고, 재설계안 0절이
   "기존 matchEngine.js는 건드리지 않는다"고 명시하므로, 이 두 개의 작고 범용적인
   순수 헬퍼만 이 파일에 그대로 복제합니다 (원본과 동일 로직, 수식이 아닌 집계 함수라
   두 파일 간 드리프트 위험이 낮다고 판단했습니다 `[Inference — 재량]`). */
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

const ck = (repName, char) => `${repName}:${char.id}`;

/**
 * 자동 매칭 알고리즘 — 반복 개선(local search) 버전.
 * 처리 순서 (재설계안 5~8절):
 *   1) 초기해 생성 (5절) — 딜러 집중 배치로 빠른 시작점 구성
 *   2) 이웃 탐색 반복 개선 (6~7절) — TimeMove/Swap/RoleCrossMove/PartyMerge를
 *      목적함수(4절: 미배정 수 → 사용 파티 수 → 전투력 표준편차) 기준으로 반복 적용
 *   3) 지원 채우기 (8절, 8.1 단순화 채택)
 *
 * [Inference/Unverified] 최적해를 보장하지 않는 휴리스틱이며, 힐클라이밍 + 소수 회
 * random restart로 구현했습니다(11절 "확정 필요" 항목 — 임의 기본값이며 실측 후
 * 조정이 필요합니다). 반복 상한·재시작 횟수는 아래 상수로, 실측 전까지는 추정치입니다.
 */
function runAutoMatch(content, reps, opts) {
  const aggressive = !!(opts && opts.aggressive);
  const dealerSlots = Math.max(content.partySize - 2, 0);
  const slotOrder = ["tank", "support", ...Array(dealerSlots).fill("dealer")];
  const allTimes = timeSlots(content.startTime, content.endTime, content.interval);

  const candidatesRaw = buildCandidates(content, reps);
  const normalChars = groupCandidatesByChar(candidatesRaw.filter((c) => appliesNormal(c.type)));
  const supportCandidatesRaw = candidatesRaw.filter((c) => appliesSupport(c.type));

  // 전체 캐릭터(일반+지원 통틀어) repName 조회용 — 지원 채우기 단계에서 필요.
  const charLookup = new Map();
  candidatesRaw.forEach((c) => {
    const key = ck(c.repName, c.char);
    if (!charLookup.has(key)) charLookup.set(key, { repName: c.repName, char: c.char });
  });

  // 검색 대상(일반+both) 캐릭터 정보 — key -> {repName, char, times, types}
  const charInfo = new Map();
  normalChars.forEach((c) => charInfo.set(ck(c.repName, c.char), c));

  const byPowerDesc = (a, b) => charFinalPower(b.char, content) - charFinalPower(a.char, content);

  /* [Inference — 11절 "확정 필요", 임의 기본값. 재시작다양성_및_횟수증가_요청_프롬프트
     2.2절 확정: RESTARTS 3->10. aggressive는 변경 없이 유지(재량, 확인 필요 시 조정)] */
  const MAX_ITER = aggressive ? 2000 : 1000;
  const RESTARTS = aggressive ? 5 : 10;

  /* ---------------- 상태 도우미 ---------------- */
  function cloneState(s) {
    return {
      parties: s.parties.map((p) => ({ ...p, slots: p.slots.map((sl) => ({ ...sl })) })),
      placement: { ...s.placement },
    };
  }

  function partyPower(p) {
    let sum = 0, count = 0;
    p.slots.forEach((sl) => {
      if (sl.charKey) { sum += charFinalPower(charLookup.get(sl.charKey).char, content); count++; }
    });
    return { sum, count };
  }

  function objectiveOf(state) {
    let unassignedCount = 0;
    charInfo.forEach((info, key) => { if (!state.placement[key]) unassignedCount++; });
    const used = state.parties.filter((p) => p.slots.some((sl) => sl.charKey));
    const avgs = used.map((p) => { const { sum, count } = partyPower(p); return count ? sum / count : 0; });
    return [unassignedCount, used.length, stdev(avgs)];
  }

  function better(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i] - 1e-9) return true;
      if (a[i] > b[i] + 1e-9) return false;
    }
    return false;
  }

  function repTimeConflict(state, repName, time, excludeKey) {
    for (const [key, loc] of Object.entries(state.placement)) {
      if (!loc || key === excludeKey) continue;
      if (loc.time !== time) continue;
      const info = charInfo.get(key);
      if (info && info.repName === repName) return true;
    }
    return false;
  }

  function nextPartyNumber(state, time) {
    const nums = state.parties.filter((p) => p.time === time).map((p) => p.partyNumber);
    return nums.length ? Math.max(...nums) + 1 : 1;
  }

  function createParty(state, time) {
    const partyNumber = nextPartyNumber(state, time);
    const p = {
      id: `${time}#${partyNumber}`, time, partyNumber,
      slots: slotOrder.map((role) => ({ slotRole: role, role, charKey: null, type: null })),
    };
    state.parties.push(p);
    return p;
  }

  function removeEmptyParty(state, partyIdVal) {
    const idx = state.parties.findIndex((p) => p.id === partyIdVal);
    if (idx !== -1 && !state.parties[idx].slots.some((sl) => sl.charKey)) {
      state.parties.splice(idx, 1);
    }
  }

  function vacate(state, key) {
    const loc = state.placement[key];
    if (!loc) return;
    const p = state.parties.find((pp) => pp.id === loc.partyId);
    if (p) {
      const sl = p.slots[loc.slotIndex];
      sl.charKey = null; sl.type = null; sl.role = sl.slotRole;
      removeEmptyParty(state, p.id);
    }
    delete state.placement[key];
  }

  function occupy(state, key, party, slotIndex, roleDisplay, typeLabel) {
    const sl = party.slots[slotIndex];
    sl.charKey = key; sl.role = roleDisplay; sl.type = typeLabel;
    state.placement[key] = { time: party.time, partyId: party.id, slotIndex };
  }

  /* 특정 시간대의 빈 slotRole 자리 중, 전투력 합계가 가장 낮은 파티를 고른다 (균형 배치). */
  function findBestEmptySlot(state, time, slotRole) {
    let best = null, bestSum = Infinity;
    state.parties.filter((p) => p.time === time).forEach((p) => {
      const idx = p.slots.findIndex((sl) => sl.slotRole === slotRole && !sl.charKey);
      if (idx === -1) return;
      const { sum } = partyPower(p);
      if (sum < bestSum) { bestSum = sum; best = { party: p, idx }; }
    });
    return best;
  }

  function hasDealerAt(state, time) {
    return state.parties.some((p) => p.time === time && p.slots.some((sl) => sl.slotRole === "dealer" && sl.charKey));
  }

  /* ---------------- 5절: 초기해 생성 ---------------- */
  function buildInitialState(shuffleSeed) {
    const state = { parties: [], placement: {} };
    const repTimeUsed = {};
    const roleCountAtTime = {};
    allTimes.forEach((t) => (roleCountAtTime[t] = { tank: 0, support: 0, dealer: 0 }));

    function pickTime(entry, compareFn) {
      const { repName, times } = entry;
      if (!repTimeUsed[repName]) repTimeUsed[repName] = new Set();
      const avail = times.filter((t) => !repTimeUsed[repName].has(t));
      if (avail.length === 0) return null;
      avail.sort(compareFn);
      const t = avail[0];
      repTimeUsed[repName].add(t);
      roleCountAtTime[t][entry.char.role]++;
      return t;
    }

    const dealerEntries = normalChars.filter((c) => c.char.role === "dealer");
    const otherEntries = normalChars.filter((c) => c.char.role !== "dealer");

    /* 딜러 집중 배치 (기존 로직과 동일한 3단계 tier: 부분 파티 있는 시간 > 딜러 있는 시간 > 신규). */
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
      return roleCountAtTime[t1].dealer - roleCountAtTime[t2].dealer;
    }

    /* 재시작 다양성 개선 (재시작다양성_및_횟수증가_요청_프롬프트, 2.1절 확정):
       shuffleSeed가 거짓(첫 시도)이면 기존처럼 "신청 시간 개수 오름차순" 결정적 정렬을
       그대로 쓴다 — 딜러 집중 배치 등 검증된 출발점이므로 유지. shuffleSeed가 참인
       재시작부터는 "동률일 때만 Math.random()"이 아니라, 매 재시작마다 배열 전체에
       실질적인 무작위성을 주입한다: 각 엔트리에 Math.random()을 주된 키로 부여하고
       times.length는 아주 낮은 가중치로만 반영해, 신청 시간 개수가 다른 캐릭터끼리도
       재시작마다 순서가 뒤바뀔 수 있게 한다 (완전히 랜덤이 아니라 낮은 가중치를 남긴
       이유: 딜러 집중 배치의 "시간 적은 캐릭터 우선"이라는 원래 취지를 아예 버리지는
       않기 위함 — `[Inference — 재량, 가중치 0.05는 실측 전 임의값]`). */
    function randomizedOrder(entries) {
      if (!shuffleSeed) return [...entries].sort((a, b) => a.times.length - b.times.length);
      const TIME_LENGTH_WEIGHT = 0.05;
      return entries
        .map((e) => ({ e, key: Math.random() + e.times.length * TIME_LENGTH_WEIGHT }))
        .sort((a, b) => a.key - b.key)
        .map((x) => x.e);
    }

    const dealerOrder = randomizedOrder(dealerEntries);
    const desiredTime = new Map();
    dealerOrder.forEach((e) => desiredTime.set(ck(e.repName, e.char), pickTime(e, dealerTimeCompare)));

    const timesWithDealer = new Set([...desiredTime.entries()].filter(([, t]) => t).map(([, t]) => t));

    function tankSupportCompare(char) {
      return (t1, t2) => {
        const pri = (timesWithDealer.has(t2) ? 1 : 0) - (timesWithDealer.has(t1) ? 1 : 0);
        if (pri !== 0) return pri;
        return roleCountAtTime[t1][char.role] - roleCountAtTime[t2][char.role];
      };
    }
    const otherOrder = randomizedOrder(otherEntries);
    otherOrder.forEach((e) => desiredTime.set(ck(e.repName, e.char), pickTime(e, tankSupportCompare(e.char))));

    /* 딜러 0 시간대는 파티를 생성하지 않는다 (1절/6절/9-5절 확정판 — 탱커 인원과 무관). */
    allTimes.forEach((t) => {
      const dealerCount = [...desiredTime.entries()].filter(([k, tt]) => tt === t && charInfo.get(k).char.role === "dealer").length;
      const partyCount = dealerCount > 0 ? Math.ceil(dealerCount / Math.max(dealerSlots, 1)) : 0;
      for (let i = 0; i < partyCount; i++) createParty(state, t);
    });

    /* 슬롯 배치: 서포터 → 탱커(초과분은 빈 딜러 슬롯 교차) → 딜러. 서포터 초과분은 절대 교차하지 않음. */
    allTimes.forEach((t) => {
      const atTime = [...desiredTime.entries()].filter(([, tt]) => tt === t).map(([k]) => charInfo.get(k));
      const supportsHere = atTime.filter((e) => e.char.role === "support").sort(byPowerDesc);
      const tanksHere = atTime.filter((e) => e.char.role === "tank").sort(byPowerDesc);
      const dealersHere = atTime.filter((e) => e.char.role === "dealer").sort(byPowerDesc);

      supportsHere.forEach((e) => {
        const slot = findBestEmptySlot(state, t, "support");
        if (slot) occupy(state, ck(e.repName, e.char), slot.party, slot.idx, "support", "normal");
      });
      const tankLeftover = [];
      tanksHere.forEach((e) => {
        const slot = findBestEmptySlot(state, t, "tank");
        if (slot) occupy(state, ck(e.repName, e.char), slot.party, slot.idx, "tank", "normal");
        else tankLeftover.push(e);
      });
      dealersHere.forEach((e) => {
        const slot = findBestEmptySlot(state, t, "dealer");
        if (slot) occupy(state, ck(e.repName, e.char), slot.party, slot.idx, "dealer", "normal");
      });
      tankLeftover.forEach((e) => {
        const slot = findBestEmptySlot(state, t, "dealer");
        if (slot) occupy(state, ck(e.repName, e.char), slot.party, slot.idx, "tank", "normal");
      });
    });

    return state;
  }

  /* ---------------- 6절: 이웃 탐색 연산자 ---------------- */

  /* TimeMove: key를 newTime(자신이 신청한 시간)으로 옮긴다. 딜러가 아닌 역할은 그 시간에
     이미 딜러가 있는(=파티가 존재하는) 곳으로만 이동 가능 — 딜러 0 시간대 신규 파티 금지. */
  function tryTimeMove(state, key, newTime) {
    const info = charInfo.get(key);
    const role = info.char.role;
    if (!info.times.includes(newTime)) return null;
    if (repTimeConflict(state, info.repName, newTime, key)) return null;
    const next = cloneState(state);
    vacate(next, key);
    let slot = findBestEmptySlot(next, newTime, role);
    if (!slot && role === "dealer") {
      createParty(next, newTime);
      slot = findBestEmptySlot(next, newTime, "dealer");
    }
    if (!slot) return null;
    occupy(next, key, slot.party, slot.idx, role, "normal");
    return next;
  }

  /* RoleCrossMove: 탱커 잉여를 같은 시간의 빈 딜러 슬롯으로 (표시 역할은 tank 유지). 서포터는 교차 불가. */
  function tryRoleCross(state, key) {
    const info = charInfo.get(key);
    if (info.char.role !== "tank") return null;
    const loc = state.placement[key];
    const time = loc ? loc.time : null;
    const candidateTimes = time ? [time] : info.times.filter((t) => hasDealerAt(state, t));
    for (const t of candidateTimes) {
      if (!hasDealerAt(state, t)) continue;
      const next = cloneState(state);
      vacate(next, key);
      const slot = findBestEmptySlot(next, t, "dealer");
      if (!slot) continue;
      occupy(next, key, slot.party, slot.idx, "tank", "normal");
      return next;
    }
    return null;
  }

  /* 신규 파티 생성 (딜러 잉여 전용 — 딜러 본인이 그 시간의 첫 딜러가 되므로 하드 제약 위반 아님). */
  function tryCreateDealerParty(state, key) {
    const info = charInfo.get(key);
    if (info.char.role !== "dealer") return null;
    for (const t of info.times) {
      if (repTimeConflict(state, info.repName, t, key)) continue;
      const next = cloneState(state);
      const party = createParty(next, t);
      occupy(next, key, party, party.slots.findIndex((s) => s.slotRole === "dealer"), "dealer", "normal");
      return next;
    }
    return null;
  }

  /* 대표 재배치(구제): key가 시간 t에 못 들어가는 이유가 "같은 대표의 다른 캐릭터 X가 t를
     점유"하고 있기 때문이면, X를 X 자신의 다른 신청 시간으로 옮겨 t를 비운 뒤 key를 채운다.
     (재설계안 9-1 "서포터 시간확보" 사례가 이 연산의 특수 사례) */
  function tryRepReshuffle(state, key) {
    const info = charInfo.get(key);
    for (const t of info.times) {
      const blocker = [...charInfo.entries()].find(([k, bi]) => {
        if (k === key) return false;
        const loc = state.placement[k];
        return loc && loc.time === t && bi.repName === info.repName;
      });
      if (!blocker) continue;
      const [bKey, bInfo] = blocker;
      for (const bt of bInfo.times) {
        if (bt === t) continue;
        if (repTimeConflict(state, bInfo.repName, bt, bKey)) continue;
        const moved = tryTimeMove(state, bKey, bt);
        if (!moved) continue;
        // X를 옮긴 뒤(연쇄 없이) key를 t에 배치 시도
        const slot = findBestEmptySlot(moved, t, info.char.role);
        if (slot) {
          occupy(moved, key, slot.party, slot.idx, info.char.role, "normal");
          return moved;
        }
        if (info.char.role === "tank" && hasDealerAt(moved, t)) {
          const s2 = findBestEmptySlot(moved, t, "dealer");
          if (s2) { occupy(moved, key, s2.party, s2.idx, "tank", "normal"); return moved; }
        }
      }
    }
    return null;
  }

  /* Swap: 같은 역할의 두 배정된 캐릭터가 서로의 시간을 맞바꾼다 (균형 개선용, 각자 신청 범위 안). */
  function trySwap(state, keyA, keyB) {
    const infoA = charInfo.get(keyA), infoB = charInfo.get(keyB);
    if (infoA.char.role !== infoB.char.role) return null;
    const locA = state.placement[keyA], locB = state.placement[keyB];
    if (!locA || !locB || locA.time === locB.time) return null;
    if (!infoA.times.includes(locB.time) || !infoB.times.includes(locA.time)) return null;
    if (repTimeConflict(state, infoA.repName, locB.time, keyA)) return null;
    if (repTimeConflict(state, infoB.repName, locA.time, keyB)) return null;
    const next = cloneState(state);
    const partyA = next.parties.find((p) => p.id === locA.partyId);
    const partyB = next.parties.find((p) => p.id === locB.partyId);
    const slotA = partyA.slots[locA.slotIndex], slotB = partyB.slots[locB.slotIndex];
    const roleA = slotA.role, roleB = slotB.role, typeA = slotA.type, typeB = slotB.type;
    slotA.charKey = keyB; slotA.role = roleB; slotA.type = typeB;
    slotB.charKey = keyA; slotB.role = roleA; slotB.type = typeA;
    next.placement[keyA] = { time: partyB.time, partyId: partyB.id, slotIndex: locB.slotIndex };
    next.placement[keyB] = { time: partyA.time, partyId: partyA.id, slotIndex: locA.slotIndex };
    return next;
  }

  /* PartyMerge: 같은 시간의 두 파티 중 하나(B)의 인원 전부가 다른 하나(A)의 빈 슬롯에
     들어갈 수 있으면 합쳐서 파티 수를 줄인다 (2순위 목적). */
  function tryMerge(state) {
    for (const t of allTimes) {
      const atTime = state.parties.filter((p) => p.time === t && p.slots.some((sl) => sl.charKey));
      for (let i = 0; i < atTime.length; i++) {
        for (let j = 0; j < atTime.length; j++) {
          if (i === j) continue;
          const A = atTime[i], B = atTime[j];
          const occupantsB = B.slots.filter((sl) => sl.charKey);
          const fits = occupantsB.every((sl) => A.slots.some((as) => as.slotRole === sl.slotRole && !as.charKey && as !== sl));
          if (!fits) continue;
          const next = cloneState(state);
          const nA = next.parties.find((p) => p.id === A.id);
          const nB = next.parties.find((p) => p.id === B.id);
          const usedIdx = new Set();
          let ok = true;
          nB.slots.forEach((sl) => {
            if (!sl.charKey) return;
            const idx = nA.slots.findIndex((as, ii) => as.slotRole === sl.slotRole && !as.charKey && !usedIdx.has(ii));
            if (idx === -1) { ok = false; return; }
            usedIdx.add(idx);
            nA.slots[idx] = { ...sl };
            next.placement[sl.charKey] = { time: nA.time, partyId: nA.id, slotIndex: idx };
          });
          if (!ok) continue;
          nB.slots.forEach((sl) => { sl.charKey = null; sl.role = sl.slotRole; sl.type = null; });
          removeEmptyParty(next, nB.id);
          return next;
        }
      }
    }
    return null;
  }

  /* ---------------- 7절: 반복 개선 루프 ---------------- */
  function localSearch(initialState) {
    let state = initialState;
    let obj = objectiveOf(state);
    let noImprove = 0;
    for (let iter = 0; iter < MAX_ITER && noImprove < 1; iter++) {
      let bestNext = null, bestObj = obj;

      const unassignedKeys = [...charInfo.keys()].filter((k) => !state.placement[k]);
      for (const key of unassignedKeys) {
        const info = charInfo.get(key);
        const candidates = [];
        info.times.forEach((t) => { const m = tryTimeMove(state, key, t); if (m) candidates.push(m); });
        const rc = tryRoleCross(state, key); if (rc) candidates.push(rc);
        const rr = tryRepReshuffle(state, key); if (rr) candidates.push(rr);
        if (info.char.role === "dealer") { const np = tryCreateDealerParty(state, key); if (np) candidates.push(np); }
        candidates.forEach((cand) => {
          const co = objectiveOf(cand);
          if (better(co, bestObj)) { bestObj = co; bestNext = cand; }
        });
      }

      if (!bestNext) {
        const merged = tryMerge(state);
        if (merged) { const mo = objectiveOf(merged); if (better(mo, bestObj)) { bestObj = mo; bestNext = merged; } }
      }

      if (!bestNext) {
        const placedKeys = [...charInfo.keys()].filter((k) => state.placement[k]);
        outer:
        for (let i = 0; i < placedKeys.length; i++) {
          for (let j = i + 1; j < placedKeys.length; j++) {
            const sw = trySwap(state, placedKeys[i], placedKeys[j]);
            if (!sw) continue;
            const so = objectiveOf(sw);
            if (better(so, bestObj)) { bestObj = so; bestNext = sw; break outer; }
          }
        }
      }

      if (bestNext) { state = bestNext; obj = bestObj; noImprove = 0; } else { noImprove++; }
    }
    return state;
  }

  /* random-restart (11절 — 임의 기본값, 실측 필요): 여러 초기해 중 최종 목적함수가 가장 좋은 것을 채택 */
  let finalState = null, finalObj = null;
  for (let r = 0; r < RESTARTS; r++) {
    const init = buildInitialState(r > 0);
    const solved = localSearch(init);
    const o = objectiveOf(solved);
    if (!finalState || better(o, finalObj)) { finalState = solved; finalObj = o; }
  }
  const state = finalState;

  /* ---------------- 8절: 지원 채우기 (8.1 단순화 채택 + 전역 균형 회귀 수정, 2026-07-10) ----------------
     지원 후보를 (캐릭터, 신청 시간 목록) 단위로 묶어, 콘텐츠 전체 파티 평균(target)에 가장
     가까워지는 자리를 그 캐릭터가 신청한 모든 시간에 걸쳐 찾는다 — 안정형의 findBestSlotFor와
     동등한 방식(지원채우기_전역균형_및_3회제한_요청_프롬프트, 2026-07-10 확정). 기존에는
     entry.time 하나에 속한 파티들 중에서만 찾아 시간 단위 지역 최적으로 회귀하는 문제가
     있었다. */
  function isRepTimeTakenGlobal(time, repName, exceptKey) {
    for (const p of state.parties) {
      if (p.time !== time) continue;
      for (const sl of p.slots) {
        if (sl.charKey && sl.charKey !== exceptKey && charLookup.get(sl.charKey).repName === repName) return true;
      }
    }
    return false;
  }

  function overallTarget() {
    const used = state.parties.filter((p) => p.slots.some((sl) => sl.charKey));
    if (used.length === 0) return 0;
    const avgs = used.map((p) => { const { sum, count } = partyPower(p); return count ? sum / count : 0; });
    return avgs.reduce((a, b) => a + b, 0) / avgs.length;
  }

  /* 역할 우선 2단계(본래 역할 0순위, 교차 1순위 — 서포터 슬롯은 지원 서포터만) + 그 안에서
     전체 평균(target)에 가장 가까워지는 자리. sc.times에 포함된 모든 시간의 빈 슬롯이 대상. */
  function findBestSlotForGlobal(sc) {
    const target = overallTarget();
    const power = charFinalPower(sc.char, content);
    let best = null, bestScore = Infinity, bestTier = Infinity;
    sc.times.forEach((t) => {
      if (isRepTimeTakenGlobal(t, sc.repName, null)) return;
      state.parties.filter((p) => p.time === t).forEach((p) => {
        p.slots.forEach((sl, idx) => {
          if (sl.charKey) return;
          if (sl.slotRole === "support" && sc.char.role !== "support") return; // 서포터 슬롯은 지원 서포터만
          const tier = sl.slotRole === sc.char.role ? 0 : 1;
          const { sum, count } = partyPower(p);
          const newAvg = (sum + power) / (count + 1);
          const score = Math.abs(newAvg - target);
          if (tier < bestTier || (tier === bestTier && score < bestScore)) { bestTier = tier; bestScore = score; best = { party: p, idx }; }
        });
      });
    });
    return best;
  }

  // both 캐릭터가 일반 배정에 최종 실패했으면 지원 후보에서도 완전히 제외 (재설계안 1절 확정).
  const bothFailedKeys = new Set(
    [...charInfo.entries()].filter(([k, info]) => info.types.includes("both") && !state.placement[k]).map(([k]) => k)
  );
  const supportCharsPool = groupCandidatesByChar(
    supportCandidatesRaw.filter((c) => !bothFailedKeys.has(ck(c.repName, c.char)))
  );
  const supportSortedDesc = [...supportCharsPool].sort(byPowerDesc);

  /* 지원 신청 최대 3회 제한 (양쪽 엔진 동일 적용, 2026-07-10 확정). both의 일반 배정 1회는
     포함하지 않는다 — 여기는 지원 배정만 센다. */
  const MAX_SUPPORT_ASSIGN = 3;
  const supportAssignCount = new Map(); // ck(repName,char) -> count

  function assignSupportGlobal(sc, slot) {
    const key = ck(sc.repName, sc.char);
    occupy(state, key, slot.party, slot.idx, sc.char.role, sc.types.includes("both") ? "both" : "support");
    supportAssignCount.set(key, (supportAssignCount.get(key) || 0) + 1);
  }

  // 패스 1: 미배정 지원자 전원을 전투력 내림차순으로 1회씩 시도
  for (const sc of supportSortedDesc) {
    if ((supportAssignCount.get(ck(sc.repName, sc.char)) || 0) >= MAX_SUPPORT_ASSIGN) continue;
    const slot = findBestSlotForGlobal(sc);
    if (slot) assignSupportGlobal(sc, slot);
  }

  // 패스 2 이상: 빈자리가 남아있는 동안(그리고 아직 3회 미만인 후보가 있는 동안) 반복 배정
  let guard = 0;
  let progressed = true;
  while (progressed && guard < 2000) {
    guard++;
    progressed = false;
    for (const sc of supportSortedDesc) {
      if ((supportAssignCount.get(ck(sc.repName, sc.char)) || 0) >= MAX_SUPPORT_ASSIGN) continue;
      const slot = findBestSlotForGlobal(sc);
      if (slot) { assignSupportGlobal(sc, slot); progressed = true; }
    }
  }

  /* ---------------- 결과 정리 ---------------- */
  const unassigned = [];
  charInfo.forEach((info, key) => {
    if (state.placement[key]) return;
    const anyRepBlocked = info.times.every((t) => repTimeConflict(state, info.repName, t, key));
    const anyPartyExists = info.times.some((t) => state.parties.some((p) => p.time === t));
    let reason;
    if (anyRepBlocked) reason = "동일 대표 캐릭터가 신청한 시간에 모두 이미 배정됨";
    else if (!anyPartyExists) reason = "선택 시간에 적합한 파티가 없습니다.";
    else reason = "배정 가능한 역할 자리가 없습니다.";
    unassigned.push({
      repName: info.repName, char: info.char, role: info.char.role,
      time: info.times[0], allowedTimes: info.times,
      type: info.types.includes("both") ? "both" : "normal",
      reason,
    });
  });

  const parties = state.parties
    .map((p) => {
      const missing = {};
      p.slots.forEach((s) => { if (!s.charKey) missing[s.slotRole] = (missing[s.slotRole] || 0) + 1; });
      const parts = [];
      if (missing.tank) parts.push(`탱커 ${missing.tank}명 부족`);
      if (missing.support) parts.push(`서포터 ${missing.support}명 부족`);
      if (missing.dealer) parts.push(`딜러 ${missing.dealer}명 부족`);
      const slots = p.slots.map((s) => {
        if (!s.charKey) return { role: s.slotRole, nickname: null, repName: null, characterId: null, type: null };
        const info = charLookup.get(s.charKey);
        return { role: s.role, nickname: info.char.nickname, repName: info.repName, characterId: info.char.id, type: s.type };
      });
      return { time: p.time, partyNumber: p.partyNumber, slots, shortage: parts.length ? parts.join(" · ") : null };
    })
    .sort((a, b) => (a.time === b.time ? a.partyNumber - b.partyNumber : a.time < b.time ? -1 : 1));

  return { parties, unassigned, aggressiveResolved: [], generatedAt: Date.now(), published: false };
}

export { runAutoMatch };
