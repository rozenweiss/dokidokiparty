const fs = require('fs');
let code = fs.readFileSync('src/GuildPartyMatcherAdmin.jsx', 'utf8');

// Normalize line endings for search
const normalizedCode = code.replace(/\r\n/g, '\n');

const oldStart = `  /* ---- aggressive 모드: 미배정 복구 패스 (Pass A → Pass B) ----`;
const oldEndRegex = /finalUnassigned\.forEach\(\(u\) => unassigned\.push\(u\)\);\n  \}/;

const startIndex = normalizedCode.indexOf(oldStart);
const oldEndMatch = normalizedCode.match(oldEndRegex);

if (startIndex === -1 || !oldEndMatch) {
    console.error("Could not find the block to replace.");
    process.exit(1);
}

const endIndex = oldEndMatch.index + oldEndMatch[0].length;

const newBlock = `  /* ---- aggressive 모드: 미배정 복구 패스 (Pass 0 → A → B) ----
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
  }`;

// Apply the block replacement
let newCode = normalizedCode.slice(0, startIndex) + newBlock + normalizedCode.slice(endIndex);

// Replace return statement
const oldReturn = `return { parties, unassigned, generatedAt: Date.now(), published: false };`;
const newReturn = `return { parties, unassigned, aggressiveResolved, generatedAt: Date.now(), published: false };`;
newCode = newCode.replace(oldReturn, newReturn);

const oldDoRunMatch = `  async function doRunMatch() {
    const result = runAutoMatch(content, reps);
    await saveResult(result);
    await setApplicationStatusForContent("matched");
    onToast("자동 매칭을 실행했습니다.");
  }

  async function runMatch() {
    if (matchData && matchData.parties && matchData.parties.length > 0) {
      setShowRematchConfirm(true);
      return;
    }
    await doRunMatch();
  }`;

const newDoRunMatch = `  async function doRunMatch(aggressive = false) {
    const result = runAutoMatch(content, reps, aggressive ? { aggressive: true } : undefined);
    await saveResult(result);
    await setApplicationStatusForContent("matched");
    onToast(aggressive ? \`적극적 재매칭을 실행했습니다. (추가 \${result.aggressiveResolved || 0}명 배정)\` : "자동 매칭을 실행했습니다.");
  }

  async function runMatch() {
    if (matchData && matchData.parties && matchData.parties.length > 0) {
      setShowRematchConfirm(true);
      return;
    }
    await doRunMatch(false);
  }`;
newCode = newCode.replace(oldDoRunMatch, newDoRunMatch);

const oldModal = `      {showRematchConfirm && (
        <ConfirmModal
          title="재매칭 확인"
          message={"기존 매칭 결과와 관리자가 수정한 내용이 모두 삭제됩니다.\\n최신 신청 데이터를 기준으로 다시 매칭하시겠습니까?"}
          confirmLabel="재매칭 실행"
          danger
          onConfirm={async () => { setShowRematchConfirm(false); await doRunMatch(); }}
          onCancel={() => setShowRematchConfirm(false)}
        />
      )}`;

const newModal = `      {showRematchConfirm && (
        <ConfirmModal
          title="재매칭 확인"
          message={"미배정자 추가 배정을 시도하는 적극적 재매칭을 실행합니다.\\n기존 배정 결과와 관리자가 수정한 내용은 모두 초기화됩니다.\\n(Pass 0: 충돌 해소 → Pass A: 지원 교체 → Pass B: 일반 교환)"}
          confirmLabel="재매칭 실행"
          danger
          onConfirm={async () => { setShowRematchConfirm(false); await doRunMatch(true); }}
          onCancel={() => setShowRematchConfirm(false)}
        />
      )}`;
newCode = newCode.replace(oldModal, newModal);

fs.writeFileSync('src/GuildPartyMatcherAdmin.jsx', newCode, 'utf8');
console.log("Success");
