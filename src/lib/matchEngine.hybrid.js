/* ============================================================
   matchEngine.hybrid.js — 유연구조형(4번째 엔진): 탱커·딜러 유연 슬롯 통합
     + 딜러 기준 파티 수 최소화 아이디어 결합

   유연구조형_딜러탱커통합_신규엔진_요청_프롬프트.md (2026-07-13 확정) 구현체입니다.

   배경: 1.0 재현형(matchEngine.legacy1.js)을 실제 데이터로 돌려본 결과, "서포터만
   필수, 탱커는 유연" 구조 자체는 탱커↔딜러 교차 배정 코드를 없앨 수 있는 유효한
   아이디어였지만, 1.0에는 균형최적화형의 "딜러 기준 파티 수 최소화(딜러 집중 배치)"가
   없어서 파티 27개 중 10개(약 37%)가 미완성으로 나오는 부작용이 확인됨. 이 엔진은 두
   아이디어를 합쳐, 교차 배정 복잡도는 줄이면서 파티 수 폭증(미완성 파티 급증)을
   재현하지 않는 조합을 검증하기 위한 것 (요청 문서 0·8절 — "완전히 새로운 시도"이며
   다른 세 엔진처럼 이미 검증된 상태가 아님).

   베이스: matchEngine.experimental.js(균형최적화형)를 그대로 복제한 뒤, 요청 문서
   2·3절에 명시된 부분만 바꿨습니다. matchEngine.js(안정형)·matchEngine.legacy1.js(1.0
   재현형)는 손대지 않았고, 이 파일도 독립 파일로 나란히 추가된 것입니다(요청 문서 1절).

   [파티 구조 재정의 — 요청 문서 2절]
   기존 세 엔진의 템플릿(탱커 1 고정 + 서포터 1 고정 + 딜러 나머지)을 버리고,
   "서포터 1(고정 예약) + 유연 슬롯(partySize−1)개"로 바꿨습니다. 유연 슬롯은 원래
   역할이 탱커든 딜러든 구분 없이 채웁니다 — 애초에 "탱커 슬롯"이라는 별도 개념이
   없어졌으므로, 기존 엔진들의 "탱커 초과분→딜러 슬롯 교차" 류의 역할 교차 규칙 자체가
   성립하지 않습니다. 이 파일에서 slotRole 값은 "support" 또는 "flex" 둘뿐입니다.
   (실제 화면에 보여줄 역할 아이콘은 각 슬롯의 표시용 role 필드에 캐릭터 본래
   역할(tank/support/dealer)을 그대로 담아 기존 UI 렌더링과 100% 호환됩니다 — 빈
   유연 슬롯은 슬롯 자체에 표시용 아이콘이 없고("빈자리" 처리), 채워진 유연 슬롯은
   원래 역할 아이콘이 그대로 나옵니다.)

   [파티 수 산정 및 집중 배치 일반화 — 요청 문서 3절]
   - 시간대별 파티 수 = ceil((그 시간대 딜러 수 + 탱커 수) / (partySize−1))
   - 집중 배치(부분 파티 있는 시간 우선)도 딜러+탱커를 하나의 "유연 역할 풀"로 합쳐
     동일하게 적용 — 딜러/탱커를 구분해서 따로 처리하지 않습니다.
   - 유연 인원이 0명인 시간대는 파티를 생성하지 않습니다(기존 "딜러 0 시간대
     미생성"의 일반화).
   - 서포터 시간확보(대표 내 재배치) 메커니즘도 "같은 대표의 배치된 유연 인원(딜러 또는
     탱커) 아무나"를 재배치 대상으로 삼도록 일반화했습니다.

   [유지한 것 — 요청 문서 4절]
   신청 유형 3종(일반 필수 1회/지원 최대 3회/both) 및 both 연동 실패 규칙, 동일 대표
   동일 시간 제약, 신청 시간 범위 제약, 서포터 슬롯은 서포터 역할만(유일한 고정 예약
   슬롯), 지원 채우기(서포터는 own-role만, 유연 슬롯은 지원자 역할 무관하게 채움 —
   애초에 탱커·딜러 구분이 없어졌으므로 자동으로 단순해짐), 강캐우선 + 미배정 지원자
   우선, 목적함수 [미배정 수, 이론적 최소 파티 수 대비 초과분(옵션 A, 3절 기준
   재계산), 표준편차], 이웃 탐색 연산자(TimeMove/RepReshuffle/CreateFlexParty/Merge/
   Swap/Replace), 재시작 10회, 저항-압력 지수형 공식(charFinalPower).

   [RoleCross 관련 — 요청 문서 7절 "탱커·딜러 교차 배정 관련 코드 감소" 확인 사항]
   기존 균형최적화형의 tryRoleCross(탱커 잉여를 같은 시간의 빈 딜러 슬롯으로 옮기는
   특수 연산)는 이 엔진에서 완전히 제거했습니다. 유연 슬롯 구조에서는 탱커든 딜러든
   똑같이 "flex" slotRole로 매칭되므로, tryTimeMove 하나가 이동과 신규 파티 생성을
   모두 커버해 RoleCross가 하던 일이 통째로 불필요해졌습니다(요청 문서는 "구조상
   남겨둬도 무방 — 구현자 재량"이라 했으나, 실제로 대체 가능하고 남겨두면 죽은 코드가
   되므로 제거를 선택했습니다. hasDealerAt 헬퍼도 RoleCross·RepReshuffle의 옛
   탱커 전용 폴백에서만 쓰였는데 두 곳 다 제거/일반화되어 함께 제거했습니다).
   trySwap의 "같은 역할끼리만 스왑" 제약(infoA.char.role !== infoB.char.role)은
   의도적으로 그대로 두었습니다 — 유연 슬롯 구조상 탱커↔딜러 스왑도 허용하는 확장이
   자연스러워 보이지만, 요청 문서 4절이 "Swap(오늘 통합 수정 적용) — 그 외는
   균형최적화형과 동일하게 유지"라고만 명시했을 뿐 스왑 자체의 역할 매칭 규칙 확장을
   요청하지는 않아, 범위 밖 임의 변경을 피하기 위해 보수적으로 유지했습니다
   [추론 — 필요하면 별도로 확장 요청해 주세요].

   [shortage(부족 인원) 표시 문구 — 문서에 명시되지 않아 임의로 정한 부분]
   기존 세 엔진은 "탱커/서포터/딜러 N명 부족"처럼 역할별 문구를 썼지만, 유연 슬롯은
   특정 역할에 대응하지 않으므로 "인원 N명 부족"이라는 일반 문구를 썼습니다
   [미확인 — UI 표현이 마음에 안 들면 알려주세요, 바꾸기 쉽습니다].

   [Inference/Unverified] 이 엔진은 아직 실제 데이터로 검증되지 않았습니다. 요청 문서
   7절의 완료 기준(미완성 파티 비율이 1.0재현형의 약 37%보다 뚜렷이 낮은지, 미배정
   수·파티 수·표준편차가 기존 세 엔진과 비교해 어떤지)은 실측 후 별도로 보고해야
   합니다.
   ============================================================ */

import { timeSlots, charFinalPower, buildCandidates, appliesNormal, appliesSupport } from "./matchEngine";
import { groupCandidatesByChar, stdev } from "./utils";

const ck = (repName, char) => `${repName}:${char.id}`;

/**
 * 자동 매칭 알고리즘 — 유연구조형(4번째 엔진).
 * matchEngine.experimental.js와 동일한 반복 개선(local search) 골격이되, 파티 구조가
 * "서포터 1 고정 + 유연 슬롯(partySize−1)개"로 바뀌었고, 파티 수 산정·집중 배치가
 * 딜러+탱커 합산 기준으로 일반화되어 있습니다.
 */
function runAutoMatch(content, reps, opts) {
  const aggressive = !!(opts && opts.aggressive);
  const flexSlots = Math.max(content.partySize - 1, 0);
  const slotOrder = ["support", ...Array(flexSlots).fill("flex")];
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

  /* [Inference — 균형최적화형과 동일한 임의 기본값을 그대로 가져왔습니다. 재시작다양성_및
     _횟수증가_요청_프롬프트 2.2절 확정치를 그대로 따름] */
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

  /* 이론적 최소 파티 수 (목적함수_파티수초과분_재정의_요청_프롬프트 2.1절의 정밀한 버전을
     요청 문서 3절 기준(딜러+탱커 합산)으로 재계산): 현재 상태에서 시간대별로 배정된
     "유연 역할(탱커 또는 딜러)" 인원 수를 세어 ceil(그 시간 유연 인원 수 / flexSlots)를
     시간별로 합산합니다. */
  function theoreticalMinParties(state) {
    const flexCountByTime = {};
    state.parties.forEach((p) => {
      p.slots.forEach((sl) => {
        if (!sl.charKey) return;
        const info = charLookup.get(sl.charKey);
        if (info && info.char.role !== "support") {
          flexCountByTime[p.time] = (flexCountByTime[p.time] || 0) + 1;
        }
      });
    });
    let total = 0;
    Object.values(flexCountByTime).forEach((n) => { total += Math.ceil(n / Math.max(flexSlots, 1)); });
    return total;
  }

  function objectiveOf(state) {
    let unassignedCount = 0;
    charInfo.forEach((info, key) => { if (!state.placement[key]) unassignedCount++; });
    const used = state.parties.filter((p) => p.slots.some((sl) => sl.charKey));
    const avgs = used.map((p) => { const { sum, count } = partyPower(p); return count ? sum / count : 0; });
    const minParties = theoreticalMinParties(state);
    const excessParties = Math.max(0, used.length - minParties);
    return [unassignedCount, excessParties, stdev(avgs)];
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

  // slotRole 매칭용 버킷: 서포터는 "support", 탱커·딜러는 모두 "flex".
  const slotRoleFor = (role) => (role === "support" ? "support" : "flex");

  /* ---------------- 5절: 초기해 생성 (요청 문서 3절 일반화 반영) ---------------- */
  function buildInitialState(shuffleSeed) {
    const state = { parties: [], placement: {} };
    const repTimeUsed = {};
    const roleCountAtTime = {};
    allTimes.forEach((t) => (roleCountAtTime[t] = { flex: 0, support: 0 }));

    function pickTime(entry, compareFn) {
      const { repName, times } = entry;
      if (!repTimeUsed[repName]) repTimeUsed[repName] = new Set();
      const avail = times.filter((t) => !repTimeUsed[repName].has(t));
      if (avail.length === 0) return null;
      avail.sort(compareFn);
      const t = avail[0];
      repTimeUsed[repName].add(t);
      roleCountAtTime[t][slotRoleFor(entry.char.role)]++;
      return t;
    }

    // 탱커+딜러를 하나의 "유연 역할 풀"로 합산 (요청 문서 3절).
    const flexEntries = normalChars.filter((c) => c.char.role !== "support");
    const supportEntries = normalChars.filter((c) => c.char.role === "support");

    /* 유연 역할 집중 배치 (기존 딜러 집중 배치와 동일한 3단계 tier를 유연 인원 합산
       기준으로 적용: 부분 파티 있는 시간 > 유연 인원 있는 시간 > 신규). */
    function flexTimeCompare(t1, t2) {
      if (flexSlots === 0) return roleCountAtTime[t1].flex - roleCountAtTime[t2].flex;
      const tierOf = (t) => {
        const c = roleCountAtTime[t].flex;
        const r = c % flexSlots;
        if (c > 0 && r !== 0) return 1;
        if (c > 0 && r === 0) return 2;
        return 3;
      };
      const tier1 = tierOf(t1), tier2 = tierOf(t2);
      if (tier1 !== tier2) return tier1 - tier2;
      return roleCountAtTime[t1].flex - roleCountAtTime[t2].flex;
    }

    /* 재시작 다양성 (균형최적화형과 동일한 방식 그대로 유지). */
    function randomizedOrder(entries) {
      if (!shuffleSeed) return [...entries].sort((a, b) => a.times.length - b.times.length);
      const TIME_LENGTH_WEIGHT = 0.05;
      return entries
        .map((e) => ({ e, key: Math.random() + e.times.length * TIME_LENGTH_WEIGHT }))
        .sort((a, b) => a.key - b.key)
        .map((x) => x.e);
    }

    const flexOrder = randomizedOrder(flexEntries);
    const desiredTime = new Map();
    flexOrder.forEach((e) => desiredTime.set(ck(e.repName, e.char), pickTime(e, flexTimeCompare)));

    const timesWithFlex = new Set([...desiredTime.entries()].filter(([, t]) => t).map(([, t]) => t));

    /* 서포터 시간확보: "유연 인원이 있는 시간" 우선 배치 (기존 탱커/서포터 공통 로직을
       서포터 전용으로 좁힌 것 — 탱커가 유연 풀로 이동했으므로). */
    function supportTimeCompare(t1, t2) {
      const pri = (timesWithFlex.has(t2) ? 1 : 0) - (timesWithFlex.has(t1) ? 1 : 0);
      if (pri !== 0) return pri;
      return roleCountAtTime[t1].support - roleCountAtTime[t2].support;
    }
    const supportOrder = randomizedOrder(supportEntries);
    supportOrder.forEach((e) => desiredTime.set(ck(e.repName, e.char), pickTime(e, supportTimeCompare)));

    /* 유연 인원이 0명인 시간대는 파티를 생성하지 않는다 (요청 문서 3절 — 기존 "딜러 0
       시간대 미생성"의 일반화). */
    allTimes.forEach((t) => {
      const flexCount = [...desiredTime.entries()].filter(([k, tt]) => tt === t && charInfo.get(k).char.role !== "support").length;
      const partyCount = flexCount > 0 ? Math.ceil(flexCount / Math.max(flexSlots, 1)) : 0;
      for (let i = 0; i < partyCount; i++) createParty(state, t);
    });

    /* 슬롯 배치: 서포터 → 유연(탱커+딜러, 역할 구분 없이 전투력 내림차순). 교차 배정
       개념 자체가 없어져 기존의 "탱커 초과분→딜러 슬롯" 같은 leftover 처리가 필요 없다
       (요청 문서 2절 핵심 — 이 부분이 제거된 복잡도). */
    allTimes.forEach((t) => {
      const atTime = [...desiredTime.entries()].filter(([, tt]) => tt === t).map(([k]) => charInfo.get(k));
      const supportsHere = atTime.filter((e) => e.char.role === "support").sort(byPowerDesc);
      const flexHere = atTime.filter((e) => e.char.role !== "support").sort(byPowerDesc);

      supportsHere.forEach((e) => {
        const slot = findBestEmptySlot(state, t, "support");
        if (slot) occupy(state, ck(e.repName, e.char), slot.party, slot.idx, "support", "normal");
      });
      flexHere.forEach((e) => {
        const slot = findBestEmptySlot(state, t, "flex");
        if (slot) occupy(state, ck(e.repName, e.char), slot.party, slot.idx, e.char.role, "normal");
      });
    });

    return state;
  }

  /* ---------------- 6절: 이웃 탐색 연산자 ---------------- */

  /* TimeMove: key를 newTime(자신이 신청한 시간)으로 옮긴다. 서포터가 아닌(=유연) 역할은
     그 시간에 이미 유연 인원이 있는(=파티가 존재하는) 곳으로 이동하거나, 없으면 스스로
     새 파티를 만든다(자신이 그 시간의 첫 유연 인원이 되므로 하드 제약 위반 아님).
     서포터는 새 파티를 만들 수 없다(요청 문서 3절 — 유연 인원 0명 시간대 미생성). */
  function tryTimeMove(state, key, newTime) {
    const info = charInfo.get(key);
    const role = info.char.role;
    if (!info.times.includes(newTime)) return null;
    if (repTimeConflict(state, info.repName, newTime, key)) return null;
    const next = cloneState(state);
    vacate(next, key);
    let slot = findBestEmptySlot(next, newTime, slotRoleFor(role));
    if (!slot && role !== "support") {
      createParty(next, newTime);
      slot = findBestEmptySlot(next, newTime, "flex");
    }
    if (!slot) return null;
    occupy(next, key, slot.party, slot.idx, role, "normal");
    return next;
  }

  /* 신규 파티 생성 (유연 인원 잉여 전용 — tryTimeMove의 신규 파티 생성 분기와 동일한
     조건이지만, 미배정자 탐색 루프에서 "이 캐릭터가 신청한 모든 시간"을 훑어 첫 성공을
     반환하는 별도 진입점으로 남겨둡니다. 옛 tryCreateDealerParty를 딜러 전용에서 유연
     역할(탱커 포함) 전용으로 일반화한 것 — 요청 문서 4절 "CreateDealerParty(유연 인원
     기준으로 일반화)"). */
  function tryCreateFlexParty(state, key) {
    const info = charInfo.get(key);
    if (info.char.role === "support") return null;
    for (const t of info.times) {
      if (repTimeConflict(state, info.repName, t, key)) continue;
      const next = cloneState(state);
      const party = createParty(next, t);
      occupy(next, key, party, party.slots.findIndex((s) => s.slotRole === "flex"), info.char.role, "normal");
      return next;
    }
    return null;
  }

  /* 대표 재배치(구제): key가 시간 t에 못 들어가는 이유가 "같은 대표의 다른 캐릭터 X가 t를
     점유"하고 있기 때문이면, X를 X 자신의 다른 신청 시간으로 옮겨 t를 비운 뒤 key를 채운다.
     요청 문서 3절 일반화: X는 이제 "같은 대표의 배치된 유연 인원(딜러 또는 탱커) 아무나"도
     대상이 된다 — blocker 탐색 자체는 역할을 가리지 않으므로 원본 그대로이며, key를
     채우는 슬롯 탐색만 slotRoleFor로 일반화했습니다(옛 "탱커→딜러 슬롯" 폴백은 flex
     탐색 하나로 이미 커버되어 제거). */
  function tryRepReshuffle(state, key) {
    const info = charInfo.get(key);
    const slotRoleForKey = slotRoleFor(info.char.role);
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
        const slot = findBestEmptySlot(moved, t, slotRoleForKey);
        if (slot) {
          occupy(moved, key, slot.party, slot.idx, info.char.role, "normal");
          return moved;
        }
      }
    }
    return null;
  }

  /* Swap: 같은 역할의 두 배정된 캐릭터가 서로의 시간을 맞바꾼다. 유연 슬롯 구조에서는
     탱커↔딜러 스왑도 허용하는 확장이 자연스러워 보이지만, 요청 문서가 명시적으로
     요청한 범위가 아니라서(4절 "Swap은 균형최적화형과 동일하게 유지") 보수적으로 원본
     그대로(정확히 같은 role끼리만) 두었습니다 — 파일 상단 주석 참고. */
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
     들어갈 수 있으면 합쳐서 파티 수를 줄인다 (2순위 목적). slotRole 비교만으로 이미
     "support"/"flex" 양쪽 다 동작하므로 원본 그대로입니다. */
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
  /* Replace: 미배정 U를, U가 신청한 시간의 파티에서 역할 호환 슬롯을 차지한 배치된
     캐릭터 P와 맞바꾼다 — P는 빼서 미배정으로 되돌리고 그 자리에 U를 넣는다. 서포터
     슬롯은 서포터만(slot.slotRole === "support" 조건)이라는 원본 제약이 이미
     "flex" 슬롯은 아무 역할이나 받는다"는 요청 문서 4절 규칙을 자동으로 만족하므로
     원본 그대로입니다. */
  function tryReplace(state, unassignedKey, placedKey) {
    const uInfo = charInfo.get(unassignedKey);
    const pLoc = state.placement[placedKey];
    if (!pLoc) return null;
    const t = pLoc.time;
    if (!uInfo.times.includes(t)) return null;
    const party = state.parties.find((p) => p.id === pLoc.partyId);
    if (!party) return null;
    const slot = party.slots[pLoc.slotIndex];
    if (slot.slotRole === "support" && uInfo.char.role !== "support") return null; // 서포터 슬롯은 서포터만
    if (repTimeConflict(state, uInfo.repName, t, placedKey)) return null;
    const next = cloneState(state);
    delete next.placement[placedKey];
    const nParty = next.parties.find((p) => p.id === pLoc.partyId);
    const nSlot = nParty.slots[pLoc.slotIndex];
    nSlot.charKey = null; nSlot.role = nSlot.slotRole; nSlot.type = null;
    occupy(next, unassignedKey, nParty, pLoc.slotIndex, uInfo.char.role, "normal");
    return next;
  }

  function localSearch(initialState) {
    let state = initialState;
    let obj = objectiveOf(state);
    let noImprove = 0;
    for (let iter = 0; iter < MAX_ITER && noImprove < 1; iter++) {
      let bestNext = null, bestObj = obj;
      const consider = (cand) => {
        if (!cand) return;
        const co = objectiveOf(cand);
        if (better(co, bestObj)) { bestObj = co; bestNext = cand; }
      };

      const unassignedKeys = [...charInfo.keys()].filter((k) => !state.placement[k]);
      for (const key of unassignedKeys) {
        const info = charInfo.get(key);
        info.times.forEach((t) => consider(tryTimeMove(state, key, t)));
        consider(tryRepReshuffle(state, key));
        if (info.char.role !== "support") consider(tryCreateFlexParty(state, key));

        // Replace: U가 신청한 시간의 파티들에서, 역할 호환되는 슬롯을 차지한 배치된
        // 캐릭터 P를 찾아 각각 시도.
        info.times.forEach((t) => {
          state.parties.filter((p) => p.time === t).forEach((p) => {
            p.slots.forEach((sl) => {
              if (sl.charKey) consider(tryReplace(state, key, sl.charKey));
            });
          });
        });
      }

      consider(tryMerge(state));

      const placedKeys = [...charInfo.keys()].filter((k) => state.placement[k]);
      for (let i = 0; i < placedKeys.length; i++) {
        for (let j = i + 1; j < placedKeys.length; j++) {
          consider(trySwap(state, placedKeys[i], placedKeys[j]));
        }
      }

      if (bestNext) { state = bestNext; obj = bestObj; noImprove = 0; } else { noImprove++; }
    }
    return state;
  }

  /* random-restart: 여러 초기해 중 최종 목적함수가 가장 좋은 것을 채택 (균형최적화형과 동일). */
  let finalState = null, finalObj = null;
  for (let r = 0; r < RESTARTS; r++) {
    const init = buildInitialState(r > 0);
    const solved = localSearch(init);
    const o = objectiveOf(solved);
    if (!finalState || better(o, finalObj)) { finalState = solved; finalObj = o; }
  }
  const state = finalState;

  /* ---------------- 8절: 지원 채우기 ----------------
     역할 우선 2단계(본래 역할 0순위, 교차 1순위 — 서포터 슬롯은 지원 서포터만) 로직은
     slotRole 비교("support" vs 그 외)로 이미 동작하므로 원본 그대로입니다. 유연 슬롯은
     slotRole이 "flex"라서 sc.char.role(tank/support/dealer)과 결코 문자열이 일치하지
     않아 항상 tier 1이 되는데, 이는 "유연 슬롯은 지원자 역할 무관"이라는 요청 문서 4절
     규칙과 정확히 일치하는 동작입니다(의도치 않은 부작용이 아님). */
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

  // both 캐릭터가 일반 배정에 최종 실패했으면 지원 후보에서도 완전히 제외.
  const bothFailedKeys = new Set(
    [...charInfo.entries()].filter(([k, info]) => info.types.includes("both") && !state.placement[k]).map(([k]) => k)
  );
  const supportCharsPool = groupCandidatesByChar(
    supportCandidatesRaw.filter((c) => !bothFailedKeys.has(ck(c.repName, c.char)))
  );
  const supportSortedDesc = [...supportCharsPool].sort(byPowerDesc);

  const MAX_SUPPORT_ASSIGN = 3;
  const supportAssignCount = new Map();

  function assignSupportGlobal(sc, slot) {
    const key = ck(sc.repName, sc.char);
    occupy(state, key, slot.party, slot.idx, sc.char.role, sc.types.includes("both") ? "both" : "support");
    supportAssignCount.set(key, (supportAssignCount.get(key) || 0) + 1);
  }

  for (const sc of supportSortedDesc) {
    if ((supportAssignCount.get(ck(sc.repName, sc.char)) || 0) >= MAX_SUPPORT_ASSIGN) continue;
    const slot = findBestSlotForGlobal(sc);
    if (slot) assignSupportGlobal(sc, slot);
  }

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
      // 유연 슬롯은 특정 역할에 대응하지 않아 "인원 N명 부족"이라는 일반 문구를 씁니다
      // (파일 상단 주석 참고 — 문서에 명시되지 않아 임의로 정한 부분, [미확인]).
      const parts = [];
      if (missing.support) parts.push(`서포터 ${missing.support}명 부족`);
      if (missing.flex) parts.push(`인원 ${missing.flex}명 부족`);
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
