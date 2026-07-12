/* ============================================================
   matchEngine.legacy1.js — 두두파1.0 파티 분배 로직 이식 (세 번째 매칭 엔진, "1.0 재현형")

   두두파1_0_파티매칭_로직_이식_요청_프롬프트.md(2026-07-13) 요청에 따라, 사용자가 업로드한
   1.0 원본 index.ts(Express 백엔드, /api/matching/run 라우트, 553~1553행)의 파티 분배
   알고리즘을 최대한 그대로 이식합니다. 목적은 "더 나은 결과"가 아니라 "1.0을 충실히
   재현"하는 것입니다 — 안정형(matchEngine.js)/균형최적화형(matchEngine.experimental.js)과
   나란히 비교하기 위한 세 번째 옵션입니다.

   React, lucide-react, storage 어느 것도 import하지 않습니다 (기존 두 엔진과 동일한
   순수성 요구사항 — Node에서 단독 실행 가능해야 함, 매칭엔진 모듈분리 요청 4절).

   ---- 2.0 데이터 → 1.0 캐릭터 모델 매핑 (요청 문서 2절, 사용자가 직접 확정) ----
   - userId = 대표 캐릭터명(rep)
   - isParticipating = 그 캐릭터가 이 콘텐츠에 신청(어떤 유형이든)이 하나라도 있으면 true
   - selectedTimes = 그 캐릭터의 이 콘텐츠 신청들에 있는 times를 전부 합친 것(중복 제거)
   - isSupportAvailable = 신청 중 하나라도 type이 "support" 또는 "both"면 true, 전부
     "normal"이면 false
   - power(→convertedPower) = 1.0의 제련도·보정값·K 공식은 쓰지 않고, utils.js의
     charFinalPower(char, content)(2026-07-10 지수형 저항-압력 공식 + 패널티)로 완전히 대체
   - className→역할 = classToRole 딕셔너리·하드코딩 이름 목록은 쓰지 않고, 2.0의 role을
     아래 대응표로 직접 변환: support(서포터)→"힐러", tank(탱커)→"브익", dealer(딜러)→"딜러"

   ---- 확정된 세부 규칙 (요청 문서 2.2절) ----
   - 동일 대표 동일 시간 제약: 1.0 원본(userOccupiedSlots) 로직 그대로 유지 — 2.0 확정
     규칙과 결과적으로 동일.
   - 지원 반복 배정 횟수: 무제한 (1.0 원본 그대로, while(true) 루프, 명시적 상한 없음).
     2.0에서 확정한 "지원 최대 3회" 상한은 이 엔진에는 적용하지 않음.
   - 2.0의 순수 "지원"(normal 없는 support 타입) 신청은 isSupportAvailable=true로
     매핑되므로, 1차 정규 배치(RESCUE 포함)도 시도되고 반복 배정도 가능함 — 2.0 원래
     의미(순수 지원은 정규 배치 후보가 아님)와 다른, 의도된 차이.
   - "일반 신청 정확히 1회 필수"(2.0의 목적함수 절대 우선순위)는 이식하지 않음. 1.0의
     RESCUE 결과(성공할 수도, 실패해 미배정으로 남을 수도 있음) 그대로 둠.
   - 파티 인원 구조: 힐러(=서포터)만 사실상 필수 슬롯(없으면 정원이 1 줄어듦), 브익(=탱커)은
     파티당 상한(maxBreakersPerParty)만 있고 필수 예약 슬롯이 아님 — 탱커 없는 파티가
     정상적으로 나올 수 있음. 2.0의 [탱커1+서포터1+딜러N] 고정 슬롯 템플릿을 강제하지 않고,
     실제 배정된 인원만으로 slots를 동적으로 구성함(2026-07-13 사용자 확정) — 부족 표기도
     역할별이 아니라 "정원 M/N명"으로 표시됨. 결과 화면에 탱커 없는 파티가 나와도 이
     엔진에서는 버그가 아니라 원본 로직 그대로의 결과입니다.
   - maxPowerDiff: 1.0 원본에서 선언만 되고 알고리즘 어디서도 쓰이지 않아 이식하지 않음.
   - maxPartySize: 1.0의 고정 설정값 대신 2.0의 content.partySize를 그대로 사용.
   - 계층 구조 버그도 그대로 포트함: 후처리 루프가 `if (changed) continue`라서, RESCUE
     단계가 조금이라도 성공하면 그 반복에서 BALANCING 단계로 넘어가지 않음. 오늘
     균형최적화형에서 고친 "Swap 통합" 수정은 이 엔진에 적용하지 않음 — 원본 재현이
     목적이므로 이 한계도 그대로 가져감.
   - [Inference] 원본의 슬롯 배분 로직에는, 파티에 힐러/브익을 먼저 배정하는 while 루프가
     배열을 shift()로 비우기 때문에, 그 직후 "슬롯 목표 평균(slotTargetAvg)"을 계산할 때
     이미 배정된 힐러·브익은 빠지고 실질적으로 "이제 배치할 딜러 풀의 평균"만 반영되는
     것으로 보입니다. 의도된 동작인지 원본의 부수효과(side effect)인지는 원본 코드만으로는
     확정할 수 없지만("그대로 이식한다"는 요청 취지에 따라) 이 부수효과도 그대로 포트합니다.

   [Inference] 위 매핑·이식 규칙은 요청 문서와 사용자가 업로드한 1.0 원본 코드를 직접
   대조해 확인한 것이나, 실제 게임 서비스 운영 결과와의 일치 여부는 검증되지 않았습니다.
   ============================================================ */

import { timeSlots, charFinalPower } from "./utils";

const ROLE_TO_LEGACY = { support: "힐러", tank: "브익", dealer: "딜러" };
const LEGACY_TO_ROLE = { 힐러: "support", 브익: "tank", 딜러: "dealer" };

/* 1.0 원본은 classToRole 딕셔너리 + 하드코딩 이름 목록으로 className에서 역할을 판정했지만
   (요청 문서 2절 — "쓰지 않는다"), 이 이식본은 캐릭터 데이터 변환 단계(buildLegacyChars)에서
   이미 2.0의 role을 "힐러"/"브익"/"딜러" 문자열로 바꿔 넣으므로, 여기서는 그 문자열을
   그대로 반환하는 항등 함수입니다 — 원본과 호출부 구조를 동일하게 유지하기 위해 함수
   형태는 남겨둡니다. */
const getRole = (className) => className;

const charKey = (repName, char) => `${repName}:${char.id}`;

/* 2.0의 rep:{대표} 데이터(subs, applications)를 1.0 스타일 캐릭터 모델(userId, className,
   convertedPower, isParticipating, selectedTimes, isSupportAvailable)로 변환합니다
   (요청 문서 2절 매핑 규칙). */
function buildLegacyChars(content, reps) {
  const map = new Map();
  Object.entries(reps).forEach(([repName, data]) => {
    (data.applications || []).forEach((app) => {
      if (app.contentId !== content.id || app.status === "cancelled") return;
      (app.characterIds || []).forEach((cid) => {
        const char = (data.subs || []).find((s) => s.id === cid);
        if (!char || char.active === false) return;
        const key = charKey(repName, char);
        if (!map.has(key)) {
          map.set(key, {
            key,
            userId: repName,
            char,
            className: ROLE_TO_LEGACY[char.role] || "딜러",
            convertedPower: charFinalPower(char, content),
            selectedTimesSet: new Set(),
            isSupportAvailable: false,
          });
        }
        const entry = map.get(key);
        (app.times || []).forEach((t) => entry.selectedTimesSet.add(t));
        if (app.type === "support" || app.type === "both") entry.isSupportAvailable = true;
      });
    });
  });
  return [...map.values()]
    .map((e) => ({ ...e, selectedTimes: [...e.selectedTimesSet] }))
    .filter((e) => e.selectedTimes.length > 0);
}

/**
 * 두두파1.0 파티 분배 알고리즘의 이식본 (index.ts 553~1553행을 최대한 그대로 옮김).
 * [Unverified] 실제 게임 데이터로 검증되지 않았으며, "더 나은 결과"가 아니라 1.0 원본
 * 동작(구조적 한계·버그 포함)을 충실히 재현하는 것이 목표입니다.
 *
 * opts는 다른 두 엔진과의 호출 시그니처 통일을 위해 받지만 사용하지 않습니다 — 1.0
 * 원본에는 aggressive(적극적 재매칭) 개념이 없습니다(요청 문서 2.2절).
 */
function runAutoMatch(content, reps, _opts) {
  const allParticipatingChars = buildLegacyChars(content, reps);

  if (allParticipatingChars.length === 0) {
    return { parties: [], unassigned: [], generatedAt: Date.now(), published: false };
  }

  const maxPartySize = content.partySize; // 요청 문서 2.2절 — 1.0 설정값 대신 content.partySize 사용
  const globalAvgPower = allParticipatingChars.reduce((sum, c) => sum + c.convertedPower, 0) / allParticipatingChars.length;
  const allTimes = timeSlots(content.startTime, content.endTime, content.interval);

  const placedCharKeys = new Set();
  const userOccupiedSlots = {}; // userId -> Set(그 유저가 이미 점유한 시간)

  const userCharsCount = {};
  const userSlotsCount = {}; // [Inference] 1.0 원본 그대로: 같은 유저의 여러 캐릭터를 순회하며 덮어써서, 마지막으로 처리된 캐릭터의 selectedTimes.length만 남는 원본의 부수효과를 그대로 재현합니다.
  allParticipatingChars.forEach((c) => {
    userCharsCount[c.userId] = (userCharsCount[c.userId] || 0) + 1;
    userSlotsCount[c.userId] = c.selectedTimes.length;
  });

  const partiesByTime = {}; // time -> party[][] (party = entry[])
  allTimes.forEach((t) => (partiesByTime[t] = []));

  /* ---- 메인 패스: 시간대 순서대로 캐릭터 배치 (요청 문서 3절 1~2단계) ---- */
  allTimes.forEach((time, timeIdx) => {
    const remainingSlots = allTimes.slice(timeIdx);

    const candidates = allParticipatingChars.filter(
      (c) =>
        !placedCharKeys.has(c.key) &&
        c.selectedTimes.includes(time) &&
        (!userOccupiedSlots[c.userId] || !userOccupiedSlots[c.userId].has(time))
    );
    if (candidates.length === 0) return;

    const priorityCandidates = [];
    const normalCandidates = [];
    candidates.forEach((c) => {
      const userCharsLeft = allParticipatingChars.filter((pc) => pc.userId === c.userId && !placedCharKeys.has(pc.key)).length;
      const userRemainingSlotsCount = remainingSlots.filter((t) => c.selectedTimes.includes(t)).length;
      if (userRemainingSlotsCount <= userCharsLeft) priorityCandidates.push(c);
      else normalCandidates.push(c);
    });

    const slotPool = [...priorityCandidates, ...normalCandidates];
    const priorityUsers = new Set(priorityCandidates.map((c) => c.userId));

    const userToChars = {};
    slotPool.forEach((c) => {
      if (!userToChars[c.userId]) userToChars[c.userId] = [];
      userToChars[c.userId].push(c);
    });

    const availableHealers = [];
    const availableBreakers = [];
    const availableDealers = [];
    Object.values(userToChars).forEach((chars) => {
      chars.forEach((c) => {
        const role = getRole(c.className);
        if (role === "힐러") availableHealers.push(c);
        else if (role === "브익") availableBreakers.push(c);
        else availableDealers.push(c);
      });
    });

    const currentNumUsers = Object.keys(userToChars).length;
    let numParties = Math.ceil(currentNumUsers / maxPartySize);

    while (numParties > 0 && numParties < currentNumUsers) {
      const healersCount = availableHealers.length;
      const maxHealersPerPartyTmp = maxPartySize >= 8 ? 2 : 1;
      const assignedHealersCount = Math.min(healersCount, numParties * maxHealersPerPartyTmp);
      const partiesWithHealers = Math.min(numParties, assignedHealersCount);
      const partiesWithoutHealers = numParties - partiesWithHealers;
      const totalCapacity = partiesWithHealers * maxPartySize + partiesWithoutHealers * (maxPartySize - 1);
      if (totalCapacity >= currentNumUsers) break;
      numParties++;
    }

    while (numParties > 1 && currentNumUsers / numParties < maxPartySize / 2 + 0.5) numParties--;

    const priorityUsersCount = priorityUsers.size;
    while (numParties > 0 && numParties * (maxPartySize - 1) < priorityUsersCount) numParties++;

    const selectedCharByUser = {};
    const assignChar = (char) => { selectedCharByUser[char.userId] = char; };

    const maxHealersPerParty = maxPartySize >= 8 ? 2 : 1;
    const maxHealers = numParties * maxHealersPerParty;
    const maxBreakersPerParty = maxPartySize >= 8 ? 2 : 1;
    const maxBreakers = numParties * maxBreakersPerParty;

    availableHealers.sort((a, b) => {
      const aPrio = priorityUsers.has(a.userId) ? 1 : 0;
      const bPrio = priorityUsers.has(b.userId) ? 1 : 0;
      if (aPrio !== bPrio) return bPrio - aPrio;
      return b.convertedPower - a.convertedPower;
    });
    let healersAssigned = 0;
    for (const h of availableHealers) {
      if (healersAssigned >= maxHealers) {
        const userChars = userToChars[h.userId];
        const onlyHasHealers = userChars.every((c) => getRole(c.className) === "힐러");
        if (priorityUsers.has(h.userId) && onlyHasHealers && !selectedCharByUser[h.userId]) {
          assignChar(h);
          healersAssigned++;
        }
        continue;
      }
      if (!selectedCharByUser[h.userId]) { assignChar(h); healersAssigned++; }
    }

    availableBreakers.sort((a, b) => {
      const aPrio = priorityUsers.has(a.userId) ? 1 : 0;
      const bPrio = priorityUsers.has(b.userId) ? 1 : 0;
      if (aPrio !== bPrio) return bPrio - aPrio;
      return b.convertedPower - a.convertedPower;
    });
    let breakersAssigned = 0;
    for (const b of availableBreakers) {
      if (breakersAssigned >= maxBreakers) {
        const userChars = userToChars[b.userId];
        const onlyHasHealerBreaker = userChars.every((c) => getRole(c.className) === "힐러" || getRole(c.className) === "브익");
        if (priorityUsers.has(b.userId) && onlyHasHealerBreaker && !selectedCharByUser[b.userId]) {
          assignChar(b);
          breakersAssigned++;
        }
        continue;
      }
      if (!selectedCharByUser[b.userId]) { assignChar(b); breakersAssigned++; }
    }

    Object.keys(userToChars).forEach((uid) => {
      if (!selectedCharByUser[uid]) {
        const userChars = userToChars[uid];
        userChars.sort((a, b) => {
          const roleA = getRole(a.className), roleB = getRole(b.className);
          const weightA = roleA === "힐러" ? 1 : roleA === "브익" ? 2 : 3;
          const weightB = roleB === "힐러" ? 1 : roleB === "브익" ? 2 : 3;
          if (weightA !== weightB) return weightB - weightA;
          return b.convertedPower - a.convertedPower;
        });
        assignChar(userChars[0]);
      }
    });

    const uniqueSlotPool = Object.values(selectedCharByUser);
    if (uniqueSlotPool.length === 0) return;

    const parties = Array.from({ length: numParties }, () => []);

    let healers = uniqueSlotPool.filter((c) => getRole(c.className) === "힐러").sort((a, b) => b.convertedPower - a.convertedPower);
    let breakers = uniqueSlotPool.filter((c) => getRole(c.className) === "브익").sort((a, b) => b.convertedPower - a.convertedPower);
    let dealers = uniqueSlotPool.filter((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익").sort((a, b) => b.convertedPower - a.convertedPower);

    let assignedHealers = healers.slice(0, maxHealers);
    let leftoverHealers = healers.slice(maxHealers);

    for (let i = 0; i < leftoverHealers.length; i++) {
      const lh = leftoverHealers[i];
      if (!lh) continue;
      const isPriority = priorityUsers.has(lh.userId);
      const hasDealer = userToChars[lh.userId].some((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익");
      if (isPriority && !hasDealer) {
        const swapIdx = assignedHealers.findIndex((ah) =>
          userToChars[ah.userId].some((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익")
        );
        if (swapIdx !== -1) {
          const ah = assignedHealers[swapIdx];
          assignedHealers[swapIdx] = lh;
          leftoverHealers[i] = ah;
          const ahDealer = userToChars[ah.userId].find((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익");
          if (ahDealer) {
            leftoverHealers[i] = null;
            dealers.push(ahDealer);
            selectedCharByUser[ah.userId] = ahDealer;
            selectedCharByUser[lh.userId] = lh;
          }
        }
      }
    }
    leftoverHealers = leftoverHealers.filter((h) => h !== null);

    leftoverHealers = leftoverHealers.filter((lh) => {
      if (priorityUsers.has(lh.userId)) return true;
      const userChars = userToChars[lh.userId];
      const onlySpecial = userChars.every((c) => getRole(c.className) === "힐러" || getRole(c.className) === "브익");
      const hasOtherSlots = lh.selectedTimes.some((t) => t !== time && (!userOccupiedSlots[lh.userId] || !userOccupiedSlots[lh.userId].has(t)));
      if (onlySpecial && hasOtherSlots) {
        delete selectedCharByUser[lh.userId];
        return false;
      }
      return true;
    });

    let assignedBreakers = breakers.slice(0, maxBreakers);
    let leftoverBreakers = breakers.slice(maxBreakers);

    for (let i = 0; i < leftoverBreakers.length; i++) {
      const lb = leftoverBreakers[i];
      if (!lb) continue;
      const isPriority = priorityUsers.has(lb.userId);
      const hasDealer = userToChars[lb.userId].some((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익");
      if (isPriority && !hasDealer) {
        const swapIdx = assignedBreakers.findIndex((ab) =>
          userToChars[ab.userId].some((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익")
        );
        if (swapIdx !== -1) {
          const ab = assignedBreakers[swapIdx];
          assignedBreakers[swapIdx] = lb;
          leftoverBreakers[i] = ab;
          const abDealer = userToChars[ab.userId].find((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익");
          if (abDealer) {
            leftoverBreakers[i] = null;
            dealers.push(abDealer);
            selectedCharByUser[ab.userId] = abDealer;
            selectedCharByUser[lb.userId] = lb;
          }
        }
      }
    }
    leftoverBreakers = leftoverBreakers.filter((b) => b !== null);

    leftoverBreakers = leftoverBreakers.filter((lb) => {
      if (priorityUsers.has(lb.userId)) return true;
      const userChars = userToChars[lb.userId];
      const onlySpecial = userChars.every((c) => getRole(c.className) === "힐러" || getRole(c.className) === "브익");
      const hasOtherSlots = lb.selectedTimes.some((t) => t !== time && (!userOccupiedSlots[lb.userId] || !userOccupiedSlots[lb.userId].has(t)));
      if (onlySpecial && hasOtherSlots) {
        delete selectedCharByUser[lb.userId];
        return false;
      }
      return true;
    });

    dealers.push(...leftoverHealers, ...leftoverBreakers);
    dealers.sort((a, b) => b.convertedPower - a.convertedPower);

    const getPartySum = (party) => party.reduce((sum, c) => sum + (c.convertedPower || 0), 0);
    const getPartyCapacity = (party) => (party.some((c) => getRole(c.className) === "힐러") ? maxPartySize : maxPartySize - 1);
    const getPartyDeficit = (party) => getPartyCapacity(party) * globalAvgPower - getPartySum(party);

    while (assignedHealers.length > 0) {
      const h = assignedHealers.shift();
      if (h) {
        const targetParty = parties.reduce((prev, curr) => {
          const prevHealers = prev.filter((c) => getRole(c.className) === "힐러").length;
          const currHealers = curr.filter((c) => getRole(c.className) === "힐러").length;
          if (prevHealers !== currHealers) return prevHealers <= currHealers ? prev : curr;
          return getPartyDeficit(prev) >= getPartyDeficit(curr) ? prev : curr;
        });
        targetParty.push(h);
      }
    }

    while (assignedBreakers.length > 0) {
      const b = assignedBreakers.shift();
      if (b) {
        const targetParty = parties.reduce((prev, curr) => {
          const prevBreakers = prev.filter((c) => getRole(c.className) === "브익").length;
          const currBreakers = curr.filter((c) => getRole(c.className) === "브익").length;
          if (prevBreakers !== currBreakers) return prevBreakers <= currBreakers ? prev : curr;
          return getPartyDeficit(prev) >= getPartyDeficit(curr) ? prev : curr;
        });
        targetParty.push(b);
      }
    }

    // [Inference] 원본 그대로: assignedHealers/assignedBreakers는 위 while에서 이미 shift()로
    // 비워졌으므로, 아래 slotTargetAvg는 사실상 dealers 풀만의 평균이 됩니다(원본의 부수효과,
    // 상단 파일 설명 참고) — 의도적으로 "고치지" 않고 그대로 재현합니다.
    const allSlotChars = [...assignedHealers, ...assignedBreakers, ...dealers].filter((c) => c !== null && c !== undefined);
    const totalSlotPower = allSlotChars.reduce((sum, c) => sum + (c.convertedPower || 0), 0);
    const slotTargetAvg = allSlotChars.length > 0 ? totalSlotPower / allSlotChars.length : globalAvgPower;

    for (let i = dealers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dealers[i], dealers[j]] = [dealers[j], dealers[i]];
    }

    for (let i = 0; i < parties.length; i++) {
      if (dealers.length > 0 && parties[i].length < getPartyCapacity(parties[i])) {
        parties[i].push(dealers.shift());
      }
    }

    dealers.sort((a, b) => b.convertedPower - a.convertedPower);

    dealers.forEach((d) => {
      const availableParties = parties.filter((p) => p.length < getPartyCapacity(p));
      if (availableParties.length > 0) {
        let bestParty = availableParties[0];
        let minDiff = Infinity;
        for (const p of availableParties) {
          const currentSum = p.reduce((sum, c) => sum + (c.convertedPower || 0), 0);
          const newAvg = (currentSum + d.convertedPower) / (p.length + 1);
          const diff = Math.abs(newAvg - slotTargetAvg);
          if (diff < minDiff || (diff === minDiff && p.length < bestParty.length)) {
            minDiff = diff;
            bestParty = p;
          }
        }
        bestParty.push(d);
      }
    });

    // Condition 8: 정원의 50% 이하인 소규모 파티는, 우선순위(priority) 멤버가 하나도 없으면
    // 해산합니다 — [Inference] 원본 그대로: userSlotsLeft>userCharsLeft 여부와 무관하게 두
    // 분기 모두 false를 반환해 실질적으로 항상 전원 해산되는 원본의 (의도와 다를 수 있는)
    // 동작을 그대로 재현합니다. 해산된 멤버는 아직 placedCharKeys에 등록되지 않았으므로
    // 이후 RESCUE 단계의 미배치자 후보로 자연스럽게 다시 들어갑니다.
    for (let i = 0; i < parties.length; i++) {
      if (parties[i].length > 0 && parties[i].length <= maxPartySize / 2) {
        const hasPriorityMember = parties[i].some((char) => {
          const userSlotsLeft = remainingSlots.filter((t) => char.selectedTimes.includes(t)).length;
          const userCharsLeft = allParticipatingChars.filter((pc) => pc.userId === char.userId && !placedCharKeys.has(pc.key)).length;
          return userSlotsLeft <= userCharsLeft;
        });
        if (!hasPriorityMember) {
          parties[i] = parties[i].filter(() => false);
        }
      }
    }

    parties.forEach((party) => {
      party.forEach((char) => {
        placedCharKeys.add(char.key);
        if (!userOccupiedSlots[char.userId]) userOccupiedSlots[char.userId] = new Set();
        userOccupiedSlots[char.userId].add(time);
      });
    });

    partiesByTime[time] = parties.filter((p) => p.length > 0);
  });

  /* ---- 후처리 루프: RESCUE(미배치자 구제) → BALANCING(전투력 균형) (요청 문서 3절 3단계) ----
     계층 구조 버그를 그대로 포트합니다: RESCUE가 조금이라도 성공하면(`changed=true`) 그
     반복은 거기서 끝나고(`continue`) BALANCING으로 넘어가지 않습니다. */
  const getPartyAvg = (party) => (party.length === 0 ? 0 : party.reduce((sum, c) => sum + (c.convertedPower || 0), 0) / party.length);

  const allParties = [];
  allTimes.forEach((time) => {
    (partiesByTime[time] || []).forEach((party) => allParties.push({ time, party }));
  });

  if (allParties.length > 0) {
    let changed = true;
    let iterations = 0;
    const maxIterations = 1000;

    const canAddCharToSlot = (char, targetTime, removedChars) => {
      if (!char.selectedTimes.includes(targetTime)) return false;
      for (const pObj of allParties) {
        if (pObj.time !== targetTime) continue;
        for (const c of pObj.party) {
          if (c.userId === char.userId) {
            if (removedChars.some((rc) => rc.key === c.key)) continue;
            return false;
          }
        }
      }
      return true;
    };

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // --- STEP 1: RESCUE ---
      const unmatchedChars = allParticipatingChars
        .filter((c) => !placedCharKeys.has(c.key))
        .sort((a, b) => {
          const roleA = getRole(a.className), roleB = getRole(b.className);
          const weightA = roleA === "힐러" ? 1 : roleA === "브익" ? 2 : 3;
          const weightB = roleB === "힐러" ? 1 : roleB === "브익" ? 2 : 3;
          if (weightA !== weightB) return weightA - weightB;
          const slotsA = a.selectedTimes.filter((t) => !userOccupiedSlots[a.userId]?.has(t)).length;
          const slotsB = b.selectedTimes.filter((t) => !userOccupiedSlots[b.userId]?.has(t)).length;
          if (slotsA !== slotsB) return slotsA - slotsB;
          return b.convertedPower - a.convertedPower;
        });

      for (const uC of unmatchedChars) {
        let canPlaceUser = true;
        const uCUserPlacedCount = [...placedCharKeys].filter((k) => {
          const char = allParticipatingChars.find((c) => c.key === k);
          return char && char.userId === uC.userId;
        }).length;
        const requiredCount = Math.min(userCharsCount[uC.userId], userSlotsCount[uC.userId]);
        if (uCUserPlacedCount >= requiredCount) canPlaceUser = false;
        if (!canPlaceUser) continue;

        // STEP 1.1: 빈 자리 채우기
        for (let i = 0; i < allParties.length; i++) {
          const partyObjA = allParties[i];
          const partyA = partyObjA.party;
          const hasHealer = partyA.some((c) => getRole(c.className) === "힐러");
          const capacity = hasHealer ? maxPartySize : maxPartySize - 1;
          if (partyA.length >= capacity) continue;
          if (canAddCharToSlot(uC, partyObjA.time, [])) {
            partyA.push(uC);
            placedCharKeys.add(uC.key);
            if (!userOccupiedSlots[uC.userId]) userOccupiedSlots[uC.userId] = new Set();
            userOccupiedSlots[uC.userId].add(partyObjA.time);
            changed = true;
            break;
          }
        }
        if (changed) break;

        // STEP 1.2: 우선순위 스왑
        const uCPriority = userCharsCount[uC.userId] >= userSlotsCount[uC.userId] ? 3 : 2;
        for (let i = 0; i < allParties.length; i++) {
          const partyObjA = allParties[i];
          const partyA = partyObjA.party;
          if (!uC.selectedTimes.includes(partyObjA.time)) continue;
          if (userOccupiedSlots[uC.userId]?.has(partyObjA.time)) continue;

          for (let j = 0; j < partyA.length; j++) {
            const targetChar = partyA[j];
            let targetPriority;
            if (targetChar.isDuplicate) targetPriority = 1;
            else targetPriority = userCharsCount[targetChar.userId] >= userSlotsCount[targetChar.userId] ? 3 : 2;

            if (uCPriority > targetPriority) {
              const removedChars = [targetChar];
              if (canAddCharToSlot(uC, partyObjA.time, removedChars)) {
                partyA[j] = uC;
                placedCharKeys.delete(targetChar.key);
                placedCharKeys.add(uC.key);
                userOccupiedSlots[targetChar.userId].delete(partyObjA.time);
                if (!userOccupiedSlots[uC.userId]) userOccupiedSlots[uC.userId] = new Set();
                userOccupiedSlots[uC.userId].add(partyObjA.time);
                changed = true;
                break;
              }
            }
          }
          if (changed) break;
        }
        if (changed) break;
      }
      if (changed) continue; // 계층 구조 버그 원본 그대로: RESCUE 성공 시 BALANCING 건너뜀

      // --- STEP 2: BALANCING ---
      let totalPlacedPower = 0;
      let totalPlacedCount = 0;
      allParties.forEach((pObj) => {
        totalPlacedPower += pObj.party.reduce((sum, c) => sum + (c.convertedPower || 0), 0);
        totalPlacedCount += pObj.party.length;
      });
      const targetAvg = totalPlacedCount > 0 ? totalPlacedPower / totalPlacedCount : globalAvgPower;

      let bestSwap = null;
      let bestImprovement = 0;
      const unmatchedForBalance = allParticipatingChars.filter((c) => !placedCharKeys.has(c.key));

      for (let i = 0; i < allParties.length; i++) {
        for (let j = i + 1; j < allParties.length; j++) {
          const partyObjA = allParties[i], partyObjB = allParties[j];
          const partyA = partyObjA.party, partyB = partyObjB.party;
          const avgA = getPartyAvg(partyA), avgB = getPartyAvg(partyB);
          const currentError = Math.pow(avgA - targetAvg, 2) + Math.pow(avgB - targetAvg, 2);
          const dealersA = partyA.filter((c) => !c.isDuplicate && getRole(c.className) !== "힐러" && getRole(c.className) !== "브익");
          const dealersB = partyB.filter((c) => !c.isDuplicate && getRole(c.className) !== "힐러" && getRole(c.className) !== "브익");

          for (const dA of dealersA) {
            for (const dB of dealersB) {
              const removedChars = [dA, dB];
              const canMoveDAToB = canAddCharToSlot(dA, partyObjB.time, removedChars);
              const canMoveDBToA = canAddCharToSlot(dB, partyObjA.time, removedChars);
              if (canMoveDAToB && canMoveDBToA) {
                const partyAWithoutDA = partyA.filter((c) => c.key !== dA.key);
                const partyBWithoutDB = partyB.filter((c) => c.key !== dB.key);
                const newAvgA = (partyAWithoutDA.reduce((sum, c) => sum + (c.convertedPower || 0), 0) + dB.convertedPower) / partyA.length;
                const newAvgB = (partyBWithoutDB.reduce((sum, c) => sum + (c.convertedPower || 0), 0) + dA.convertedPower) / partyB.length;
                const newError = Math.pow(newAvgA - targetAvg, 2) + Math.pow(newAvgB - targetAvg, 2);
                if (newError < currentError) {
                  const improvement = currentError - newError;
                  if (improvement > bestImprovement) {
                    bestImprovement = improvement;
                    bestSwap = { type: "swap", partyAIdx: i, partyBIdx: j, dA, dB };
                  }
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < allParties.length; i++) {
        const partyObjA = allParties[i];
        const partyA = partyObjA.party;
        const avgA = getPartyAvg(partyA);
        const currentError = Math.pow(avgA - targetAvg, 2);
        const dealersA = partyA.filter((c) => !c.isDuplicate && getRole(c.className) !== "힐러" && getRole(c.className) !== "브익");

        for (const dA of dealersA) {
          for (const uC of unmatchedForBalance) {
            const removedChars = [dA];
            const canMoveUCToA = canAddCharToSlot(uC, partyObjA.time, removedChars);
            let canSwapUserLimits = true;
            if (uC.userId !== dA.userId) {
              const uCUserPlacedCount = [...placedCharKeys].filter((k) => {
                const char = allParticipatingChars.find((c) => c.key === k);
                return char && char.userId === uC.userId;
              }).length;
              const uCUserMaxSlots = uC.selectedTimes.length;
              if (uCUserPlacedCount >= uCUserMaxSlots) canSwapUserLimits = false;
            }
            if (canMoveUCToA && canSwapUserLimits) {
              const partyAWithoutDA = partyA.filter((c) => c.key !== dA.key);
              const newAvgA = (partyAWithoutDA.reduce((sum, c) => sum + (c.convertedPower || 0), 0) + uC.convertedPower) / partyA.length;
              const newError = Math.pow(newAvgA - targetAvg, 2);
              if (newError < currentError) {
                const improvement = currentError - newError;
                if (improvement > bestImprovement) {
                  bestImprovement = improvement;
                  bestSwap = { type: "replace", partyAIdx: i, dA, uD: uC };
                }
              }
            }
          }
        }
      }

      if (bestSwap) {
        if (bestSwap.type === "swap") {
          const { partyAIdx, partyBIdx, dA, dB } = bestSwap;
          const partyA = allParties[partyAIdx].party;
          const partyB = allParties[partyBIdx].party;
          const idxA = partyA.findIndex((c) => c.key === dA.key && !c.isDuplicate);
          const idxB = partyB.findIndex((c) => c.key === dB.key && !c.isDuplicate);
          partyA[idxA] = dB;
          partyB[idxB] = dA;
          if (allParties[partyAIdx].time !== allParties[partyBIdx].time) {
            userOccupiedSlots[dA.userId].delete(allParties[partyAIdx].time);
            userOccupiedSlots[dA.userId].add(allParties[partyBIdx].time);
            userOccupiedSlots[dB.userId].delete(allParties[partyBIdx].time);
            userOccupiedSlots[dB.userId].add(allParties[partyAIdx].time);
          }
        } else if (bestSwap.type === "replace") {
          const { partyAIdx, dA, uD } = bestSwap;
          const partyA = allParties[partyAIdx].party;
          const idxA = partyA.findIndex((c) => c.key === dA.key && !c.isDuplicate);
          partyA[idxA] = uD;
          placedCharKeys.delete(dA.key);
          placedCharKeys.add(uD.key);
          userOccupiedSlots[dA.userId].delete(allParties[partyAIdx].time);
          if (!userOccupiedSlots[uD.userId]) userOccupiedSlots[uD.userId] = new Set();
          userOccupiedSlots[uD.userId].add(allParties[partyAIdx].time);
        }
        changed = true;
      }
    }
  }

  // 지원 중복 채우기 전, userOccupiedSlots를 파티 실제 구성 기준으로 재계산 (원본 1337~1349행)
  const accurateUserOccupiedSlots = {};
  allTimes.forEach((time) => {
    (partiesByTime[time] || []).forEach((party) => {
      party.forEach((char) => {
        if (!accurateUserOccupiedSlots[char.userId]) accurateUserOccupiedSlots[char.userId] = new Set();
        accurateUserOccupiedSlots[char.userId].add(time);
      });
    });
  });

  /* ---- 지원 중복 채우기 (요청 문서 3절 4단계, 원본 1351~1426행) ----
     반복 상한 없음 — 2.0의 "지원 최대 3회" 규칙은 이 엔진에 적용하지 않습니다(요청 문서
     2.2절). */
  allTimes.forEach((time) => {
    const parties = partiesByTime[time];
    if (!parties) return;
    parties.forEach((party) => {
      while (true) {
        const healersCount = party.filter((c) => getRole(c.className) === "힐러").length;
        const hasRealHealer = healersCount > 0;
        const capacity = hasRealHealer ? maxPartySize : maxPartySize - 1;
        if (party.length >= maxPartySize) break;
        const needsHealerOnly = !hasRealHealer && party.length >= capacity;

        const supportChars = allParticipatingChars.filter(
          (c) =>
            c.isSupportAvailable &&
            c.selectedTimes.includes(time) &&
            (!accurateUserOccupiedSlots[c.userId] || !accurateUserOccupiedSlots[c.userId].has(time)) &&
            placedCharKeys.has(c.key)
        );
        if (supportChars.length === 0) break;

        const filteredSupportChars = supportChars.filter((sc) => !party.some((pc) => pc.userId === sc.userId));
        if (filteredSupportChars.length === 0) break;

        const healers = filteredSupportChars.filter((c) => getRole(c.className) === "힐러").sort((a, b) => b.convertedPower - a.convertedPower);
        const breakers = filteredSupportChars.filter((c) => getRole(c.className) === "브익").sort((a, b) => b.convertedPower - a.convertedPower);
        const dealers = filteredSupportChars
          .filter((c) => getRole(c.className) !== "힐러" && getRole(c.className) !== "브익")
          .sort((a, b) => b.convertedPower - a.convertedPower);

        const breakersCount = party.filter((c) => getRole(c.className) === "브익").length;
        const maxHealersPerParty = maxPartySize >= 8 ? 2 : 1;
        const maxBreakersPerParty = maxPartySize >= 8 ? 2 : 1;

        let picked = null;
        if (!hasRealHealer && healers.length > 0) {
          picked = healers[0];
        } else if (!needsHealerOnly) {
          if (breakersCount < maxBreakersPerParty && breakers.length > 0) picked = breakers[0];
          else if (healersCount < maxHealersPerParty && healers.length > 0) picked = healers[0];
          else if (dealers.length > 0) picked = dealers[0];
          else if (breakers.length > 0) picked = breakers[0];
        }

        if (picked) {
          party.push({ ...picked, isDuplicate: true });
          if (!accurateUserOccupiedSlots[picked.userId]) accurateUserOccupiedSlots[picked.userId] = new Set();
          accurateUserOccupiedSlots[picked.userId].add(time);
        } else {
          break;
        }
      }
    });
  });

  /* ---- 결과 조립 ----
     2.0의 [탱커1+서포터1+딜러N] 고정 슬롯 템플릿을 강제하지 않고, 실제 배정된 인원만으로
     slots를 동적으로 구성합니다(2026-07-13 사용자 확정). 부족 표기는 역할별 문구 대신
     "정원 M/N명"으로 표시합니다. */
  const parties = [];
  allTimes.forEach((time) => {
    (partiesByTime[time] || []).forEach((party, pIdx) => {
      if (party.length === 0) return;
      const capacity = party.some((c) => getRole(c.className) === "힐러") ? maxPartySize : maxPartySize - 1;
      const slots = party.map((c) => ({
        role: LEGACY_TO_ROLE[c.className] || "dealer",
        nickname: c.char.nickname + (c.isDuplicate ? " (지원)" : ""),
        repName: c.userId,
        characterId: c.char.id,
        type: c.isDuplicate ? "support" : "normal",
      }));
      parties.push({
        time,
        partyNumber: pIdx + 1,
        slots,
        shortage: party.length < capacity ? `정원 ${party.length}/${capacity}명` : null,
      });
    });
  });
  parties.sort((a, b) => (a.time === b.time ? a.partyNumber - b.partyNumber : a.time < b.time ? -1 : 1));

  const unassigned = allParticipatingChars
    .filter((c) => !placedCharKeys.has(c.key))
    .map((c) => {
      const userOccupiedCount = userOccupiedSlots[c.userId]?.size || 0;
      let reason;
      if (c.selectedTimes.length === 0) reason = "선택된 시간대 없음";
      else if (userOccupiedCount >= c.selectedTimes.length) reason = "선택한 모든 시간대에 이미 다른 캐릭터가 배치됨";
      else reason = "파티 정원 초과 또는 직군 밸런스 문제";
      return {
        repName: c.userId,
        char: c.char,
        allowedTimes: c.selectedTimes,
        time: c.selectedTimes[0] || null,
        type: c.isSupportAvailable ? "both" : "normal",
        reason,
      };
    });

  return { parties, unassigned, generatedAt: Date.now(), published: false };
}

export { runAutoMatch, buildLegacyChars, getRole };
