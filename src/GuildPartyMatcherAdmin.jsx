import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { storageGet, storageSet, storageDelete, storageListWithValues, pullFromSheets, backupKv } from "./lib/storage";

/* ============================================================
   길드 파티 매칭 툴 — 관리자 화면 프로토타입
   기획서 2장(관리자 화면) 중 핵심 흐름을 구현합니다.
   사용자 화면과 동일한 window.storage(shared) 데이터를 공유합니다.
   - guild-config: { password, adminPassword, jobs, contents }
   - rep:{대표캐릭터명}: { subs, applications }
   - results:{콘텐츠id}: { published, generatedAt, parties, unassigned }

   범위 안내(간소화한 부분):
   - 진짜 드래그앤드롭 대신 슬롯 클릭 → 선택 방식으로 파티원을 이동/교체합니다.
   - 48시간 자동 삭제 타이머는 구현하지 않고, 수동 삭제 버튼만 제공합니다.
   - 자동 매칭 알고리즘은 기획서에 정확한 배정/균형 공식이 없어 다음 규칙의
     단순 휴리스틱으로 구현했습니다: 일반 신청 우선 → 동일 대표는 같은 시간 1명만 →
     일반 신청 캐릭터는 전체 기간 중 최대 1회 배정 → 지원 신청은 시간마다 반복 가능.
     실제 서비스 적용 전 알고리즘 검증이 필요합니다.
   ============================================================ */

const GlobalStyle = () => (
  <style>{`
    .gpa-root {
      --bg: #F7F5F0; --bg-elev: #FFFFFF; --surface: #FFFFFF; --surface-2: #F0ECE3;
      --border: #E4DFD3; --border-soft: #ECE7DB;
      --text: #2B2822; --text-dim: #6E6A5E; --text-faint: #A19C8C;
      --accent: #C15F3C; --accent-soft: #D97757;
      --tank: #4C7196; --support: #4F7A5B; --dealer: #A85A38;
      --danger: #C0392B; --success: #4F7A5B; --warn: #B8823A;
      --font-display: 'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      --font-body: 'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      --font-mono: 'JetBrains Mono', 'Consolas', monospace;
      all: initial; *, *::before, *::after { box-sizing: border-box; }
      display: block; background: var(--bg); color: var(--text); font-family: var(--font-body);
      min-height: 100%; width: 100%; position: relative; line-height: 1.5;
      background-image: radial-gradient(ellipse 900px 500px at 85% -10%, rgba(193,95,60,0.08), transparent 60%);
    }
    .gpa-root h1, .gpa-root h2, .gpa-root h3, .gpa-root h4 { font-family: var(--font-display); margin: 0; color: var(--text); }
    .gpa-root p { margin: 0; }
    .gpa-root button { font-family: var(--font-body); cursor: pointer; }
    .gpa-root input, .gpa-root select, .gpa-root textarea { font-family: var(--font-body); }

    .gpa-scroll { min-height: 100vh; padding: 26px 16px 80px; display: flex; flex-direction: column; align-items: center; }
    .gpa-frame { width: 100%; max-width: 920px; }

    .gpa-gate-wrap { min-height: 92vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .gpa-gate-card { width: 100%; max-width: 400px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 18px; padding: 38px 30px; box-shadow: 0 1px 2px rgba(43,40,34,0.04), 0 20px 44px -24px rgba(43,40,34,0.16); }
    .gpa-gate-title { text-align: center; font-size: 20px; color: var(--accent-soft); margin-bottom: 8px; }
    .gpa-gate-desc { text-align: center; font-size: 12.5px; color: var(--text-dim); margin-bottom: 24px; line-height: 1.6; }

    .gpa-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; gap: 10px; }
    .gpa-brand { display: flex; align-items: center; gap: 10px; }
    .gpa-brand-badge { font-size: 10px; font-weight: 700; color: #FFFFFF; background: linear-gradient(180deg, var(--accent-soft), var(--accent)); padding: 3px 9px; border-radius: 20px; letter-spacing: 0.04em; }
    .gpa-brand-title { font-size: 15px; color: var(--text); font-weight: 700; }

    .gpa-nav { display: flex; gap: 4px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 12px; padding: 4px; margin-bottom: 20px; overflow-x: auto; }
    .gpa-nav-item { flex: 1; white-space: nowrap; text-align: center; padding: 9px 12px; border-radius: 9px; font-size: 12.5px; color: var(--text-dim); background: transparent; border: none; font-weight: 600; }
    .gpa-nav-item.active { background: var(--surface-2); color: var(--accent-soft); }

    .gpa-card { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 14px; padding: 22px; box-shadow: 0 1px 2px rgba(43,40,34,0.04), 0 12px 28px -20px rgba(43,40,34,0.12); }
    .gpa-card + .gpa-card { margin-top: 14px; }
    .gpa-section-title { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
    .gpa-section-title h2 { font-size: 17px; }
    .gpa-section-desc { font-size: 12px; color: var(--text-faint); margin-top: 3px; }

    .gpa-btn { border: none; border-radius: 9px; padding: 10px 16px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
    .gpa-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .gpa-btn-primary { background: linear-gradient(180deg, var(--accent-soft), var(--accent)); color: #FFFFFF; }
    .gpa-btn-primary:hover { filter: brightness(1.05); }
    .gpa-btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-dim); }
    .gpa-btn-ghost:hover { color: var(--text); border-color: var(--accent); }
    .gpa-btn-danger { background: rgba(192,57,43,0.1); color: var(--danger); border: 1px solid rgba(192,57,43,0.3); }
    .gpa-btn-danger:hover { background: rgba(192,57,43,0.18); }
    .gpa-btn-sm { padding: 7px 11px; font-size: 12px; border-radius: 7px; }

    .gpa-field { margin-bottom: 14px; }
    .gpa-label { display: block; font-size: 11.5px; color: var(--text-dim); margin-bottom: 6px; }
    .gpa-input { width: 100%; background: var(--bg-elev); border: 1px solid var(--border); color: var(--text); padding: 10px 12px; border-radius: 8px; font-size: 13.5px; outline: none; }
    .gpa-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(193,95,60,0.15); }
    .gpa-row { display: flex; gap: 10px; }
    .gpa-hint { font-size: 11px; color: var(--text-faint); margin-top: 5px; }
    .gpa-error { font-size: 11px; color: var(--danger); margin-top: 5px; }

    .gpa-dash-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: 10px; }
    .gpa-stat-card { background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 12px; padding: 14px 16px; }
    .gpa-stat-num { font-family: var(--font-mono); font-size: 22px; color: var(--accent-soft); }
    .gpa-stat-label { font-size: 11px; color: var(--text-faint); margin-top: 3px; }

    .gpa-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .gpa-table th { text-align: left; color: var(--text-faint); font-weight: 600; font-size: 11px; padding: 8px 10px; border-bottom: 1px solid var(--border-soft); white-space: nowrap; }
    .gpa-table td { padding: 9px 10px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
    .gpa-table tr:last-child td { border-bottom: none; }
    .gpa-table-wrap { overflow-x: auto; }

    .gpa-badge { font-size: 10.5px; padding: 3px 8px; border-radius: 6px; font-weight: 700; display: inline-block; }
    .gpa-badge.tank { background: rgba(76,113,150,0.16); color: var(--tank); }
    .gpa-badge.support { background: rgba(79,122,91,0.16); color: var(--support); }
    .gpa-badge.dealer { background: rgba(168,90,56,0.16); color: var(--dealer); }
    .gpa-badge.on { background: rgba(79,122,91,0.15); color: var(--success); }
    .gpa-badge.off { background: rgba(143,138,126,0.2); color: var(--text-faint); }
    .gpa-badge.normal { background: rgba(76,113,150,0.15); color: var(--tank); }
    .gpa-badge.supportApp { background: rgba(181,140,74,0.15); color: var(--warn); }

    .gpa-empty { text-align: center; padding: 40px 16px; color: var(--text-faint); font-size: 13px; }

    .gpa-party-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px,1fr)); gap: 12px; }
    .gpa-party-card { background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 12px; padding: 14px; }
    .gpa-party-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 12px; color: var(--text-faint); font-family: var(--font-mono); }
    .gpa-slot { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 7px; font-size: 12px; cursor: pointer; border: 1px dashed transparent; }
    .gpa-slot:hover { border-color: var(--accent); background: rgba(193,95,60,0.06); }
    .gpa-slot.dragging { opacity: 0.4; }
    .gpa-slot.dragover { border-color: var(--accent-soft); background: rgba(193,95,60,0.16); }
    .gpa-slot.drag-reject { border-color: var(--danger); }
    .gpa-slot-role { width: 42px; flex-shrink: 0; font-size: 10px; font-weight: 700; }
    .gpa-slot-role.tank { color: var(--tank); } .gpa-slot-role.support { color: var(--support); } .gpa-slot-role.dealer { color: var(--dealer); }
    .gpa-slot-name { flex: 1; color: var(--text); }
    .gpa-slot-empty { flex: 1; color: var(--text-faint); font-style: italic; }
    .gpa-slot-tag { font-size: 9px; color: var(--text-faint); }
    .gpa-party-short { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-soft); font-size: 10.5px; color: var(--danger); }
    .gpa-time-block + .gpa-time-block { margin-top: 20px; }
    .gpa-time-title { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 13.5px; color: var(--accent-soft); font-weight: 700; }

    .gpa-unassigned-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .gpa-unassigned-row { display: flex; align-items: center; gap: 8px; background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 8px; padding: 8px 10px; font-size: 12px; cursor: grab; }
    .gpa-unassigned-row.dragging { opacity: 0.4; }

    .gpa-modal-overlay { position: fixed; inset: 0; background: rgba(6,7,12,0.72); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 100; }
    .gpa-modal { width: 100%; max-width: 420px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 24px; max-height: 88vh; overflow-y: auto; box-shadow: 0 1px 2px rgba(43,40,34,0.04), 0 24px 48px -20px rgba(43,40,34,0.22); }
    .gpa-modal-title { font-size: 15px; margin-bottom: 16px; }
    .gpa-modal-actions { display: flex; gap: 10px; margin-top: 18px; }
    .gpa-pick-btn { width: 100%; text-align: left; background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: var(--text); margin-bottom: 6px; display: flex; justify-content: space-between; }
    .gpa-pick-btn:hover { border-color: var(--accent); }

    .gpa-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 12px 20px; border-radius: 30px; font-size: 13px; z-index: 200; box-shadow: 0 4px 16px -6px rgba(43,40,34,0.22); }
    .gpa-content-pick { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .gpa-content-chip { padding: 8px 14px; border-radius: 20px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text-dim); font-size: 12.5px; }
    .gpa-content-chip.active { border-color: var(--accent); color: var(--accent-soft); background: rgba(193,95,60,0.1); }
  `}</style>
);

/* ---------------- 시드/유틸 (사용자 화면과 동일 규칙) ---------------- */
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
const DEFAULT_CONTENTS = [
  { id: "c1", name: "협곡의 결전", pressure: 0, requiredResist: 0, partySize: 4, interval: 30, startTime: "20:00", endTime: "23:30", active: true },
  { id: "c2", name: "심연의 제단", pressure: 120, requiredResist: 1600, partySize: 4, interval: 30, startTime: "20:00", endTime: "23:00", active: true },
  { id: "c3", name: "폐허의 감시탑", pressure: 0, requiredResist: 0, partySize: 6, interval: 60, startTime: "21:00", endTime: "23:00", active: false },
];
const ROLE_LABEL = { tank: "탱커", support: "서포터", dealer: "딜러" };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

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
function finalPower(basePower, pressure) {
  if (!pressure || pressure <= 0) return basePower;
  return Math.round(basePower * (1 + pressure / 1000));
}

/**
 * 캐릭터의 "최종 전투력"을 화면 전체에서 일관되게 계산하는 단일 함수입니다.
 * - content가 주어지면: 압력 보정 후 패널티 차감 (콘텐츠 맥락이 있는 화면: 신청 현황, 자동 매칭)
 * - content가 없으면: 압력 보정 없이 패널티만 차감 (콘텐츠 맥락이 없는 화면: 전체 캐릭터 목록)
 * 두 경우 모두 결과는 0 미만으로 내려가지 않습니다(음수 없음).
 * [Inference] 향후 저항-압력 기반 공식으로 finalPower가 재설계되어도, 패널티는
 * "보정이 끝난 값에서 마지막에 차감 후 0 클램프"라는 위치를 유지하는 것이 사용자가
 * 정한 "보정 후 차감" 규칙과 맞습니다 — 이 함수 안쪽만 바꾸면 됩니다.
 */
function charFinalPower(char, content) {
  const base = content ? finalPower(char.power, content.pressure) : char.power;
  const penalty = char.penalty || 0;
  return Math.max(0, base - penalty);
}


async function loadGuildConfig() {
  let cfg = await storageGet("guild-config", true);
  if (!cfg) {
    cfg = { password: "1234", adminPassword: "admin1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS };
    await storageSet("guild-config", cfg, true);
  } else {
    try { cfg = JSON.parse(cfg); } catch (e) { cfg = { password: "1234", adminPassword: "admin1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS }; }
  }
  if (!cfg.adminPassword) cfg.adminPassword = "admin1234";
  return cfg;
}

async function loadAllReps() {
  const rows = await storageListWithValues("rep:", true);
  const reps = {};
  for (const row of rows) {
    const name = row.key.slice("rep:".length);
    if (!row.value) continue;
    try { reps[name] = JSON.parse(row.value); } catch (e) { /* skip */ }
  }
  return reps;
}

/* ---------------- 데이터 보관/삭제 (2.20) ---------------- */
const RETENTION_MS = 48 * 60 * 60 * 1000; // 자동 매칭 실행 후 48시간

function formatDateTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function formatRemaining(ms) {
  if (ms <= 0) return "삭제 대상";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}시간 ${m}분 남음` : `${m}분 남음`;
}

/* 콘텐츠 하나의 신청/매칭 데이터를 정리 (수동 삭제·자동 삭제 공용) */
async function purgeContentData(content) {
  const rows = await storageListWithValues("rep:", true);
  for (const row of rows) {
    if (!row.value) continue;
    let data;
    try { data = JSON.parse(row.value); } catch (e) { continue; }
    const apps = (data.applications || []).filter((a) => a.contentId !== content.id);
    if (apps.length !== (data.applications || []).length) await storageSet(row.key, { ...data, applications: apps }, true);
  }
  await storageDelete(`results:${content.id}`, true);
}

async function loadResultsMeta(contents) {
  const meta = {};
  for (const c of contents) {
    const raw = await storageGet(`results:${c.id}`, true);
    if (!raw) continue;
    try {
      const d = JSON.parse(raw);
      meta[c.id] = { generatedAt: d.generatedAt, published: d.published };
    } catch (e) { /* skip */ }
  }
  return meta;
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

/* 단순 휴리스틱 자동 매칭 (파일 상단 주석 참고) */
function runAutoMatch(content, reps) {
  const dealerSlots = Math.max(content.partySize - 2, 0);
  const slotOrder = ["tank", "support", ...Array(dealerSlots).fill("dealer")];
  const allTimes = timeSlots(content.startTime, content.endTime, content.interval);
  const candidates = buildCandidates(content, reps);
  const usedNormal = new Set();
  const parties = [];
  const unassigned = [];

  allTimes.forEach((t) => {
    const pool = candidates.filter((c) => c.time === t && !(c.type === "normal" && usedNormal.has(c.char.id)));
    if (pool.length === 0) return;
    const byRep = {};
    pool.forEach((c) => {
      const cur = byRep[c.repName];
      if (!cur) { byRep[c.repName] = c; return; }
      const score = (x) => (x.type === "normal" ? 1000000 : 0) + charFinalPower(x.char, content);
      if (score(c) > score(cur)) byRep[c.repName] = c;
    });
    const picked = Object.values(byRep);
    const byRole = (role) => picked.filter((c) => c.char.role === role).sort((a, b) => charFinalPower(b.char, content) - charFinalPower(a.char, content));
    const tanks = byRole("tank"), supports = byRole("support"), dealers = byRole("dealer");

    const partiesCount = Math.max(
      tanks.length, supports.length,
      dealerSlots > 0 ? Math.ceil(dealers.length / dealerSlots) : 0,
      (tanks.length + supports.length + dealers.length) > 0 ? 1 : 0
    );
    if (partiesCount === 0) return;

    const timeParties = Array.from({ length: partiesCount }, (_, i) => ({
      time: t, partyNumber: i + 1,
      slots: slotOrder.map((role) => ({ role, nickname: null, repName: null, characterId: null, type: null })),
    }));

    tanks.slice(0, partiesCount).forEach((c, i) => { timeParties[i].slots[0] = { role: "tank", nickname: c.char.nickname, repName: c.repName, characterId: c.char.id, type: c.type }; });
    tanks.slice(partiesCount).forEach((c) => unassigned.push({ ...c, reason: "역할 자리 부족" }));
    supports.slice(0, partiesCount).forEach((c, i) => { timeParties[i].slots[1] = { role: "support", nickname: c.char.nickname, repName: c.repName, characterId: c.char.id, type: c.type }; });
    supports.slice(partiesCount).forEach((c) => unassigned.push({ ...c, reason: "역할 자리 부족" }));

    // 딜러는 파티0→1→2→...→2→1→0 순서(스네이크 드래프트)로 한 자리씩 배분해
    // 특정 파티에 고전투력 딜러가 몰리지 않도록 합니다. (dealers는 이미 전투력 내림차순 정렬됨)
    let di = 0;
    for (let s = 2; s < slotOrder.length && di < dealers.length; s++) {
      const forward = (s - 2) % 2 === 0;
      const order = forward ? [...Array(partiesCount).keys()] : [...Array(partiesCount).keys()].reverse();
      for (const p of order) {
        if (di >= dealers.length) break;
        const c = dealers[di++];
        timeParties[p].slots[s] = { role: "dealer", nickname: c.char.nickname, repName: c.repName, characterId: c.char.id, type: c.type };
      }
    }
    for (; di < dealers.length; di++) unassigned.push({ ...dealers[di], reason: "역할 자리 부족" });

    timeParties.forEach((tp) => {
      const missing = {};
      tp.slots.forEach((s) => {
        if (!s.nickname) missing[s.role] = (missing[s.role] || 0) + 1;
        else if (s.type === "normal") usedNormal.add(s.characterId);
      });
      const parts = [];
      if (missing.tank) parts.push(`탱커 ${missing.tank}명 부족`);
      if (missing.support) parts.push(`서포터 ${missing.support}명 부족`);
      if (missing.dealer) parts.push(`딜러 ${missing.dealer}명 부족`);
      tp.shortage = parts.length ? parts.join(" · ") : null;
      parties.push(tp);
    });
  });

  return { parties, unassigned, generatedAt: Date.now(), published: false };
}

/* ---------------- 작은 컴포넌트 ---------------- */
function Toast({ message }) {
  if (!message) return null;
  return <div className="gpa-toast">{message}</div>;
}
const RoleBadge = ({ role }) => <span className={`gpa-badge ${role}`}>{ROLE_LABEL[role] || role}</span>;

function ConfirmModal({ title, message, confirmLabel = "확인", cancelLabel = "취소", danger, onConfirm, onCancel }) {
  return (
    <div className="gpa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="gpa-modal" style={{ maxWidth: 380 }}>
        {title && <h3 className="gpa-modal-title">{title}</h3>}
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6, whiteSpace: "pre-line" }}>{message}</div>
        <div className="gpa-modal-actions">
          <button className="gpa-btn gpa-btn-ghost" style={{ flex: 1 }} onClick={onCancel}>{cancelLabel}</button>
          <button className={`gpa-btn ${danger ? "gpa-btn-danger" : "gpa-btn-primary"}`} style={{ flex: 1 }} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   관리자 로그인
   ============================================================ */
function AdminGate({ config, onEnter }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  function submit() {
    if (pw === config.adminPassword) {
      try { sessionStorage.setItem("gpa-admin-authed", "true"); } catch (e) { /* 세션 저장이 안 되면 그냥 이번 새로고침까지만 유지됩니다 */ }
      onEnter();
    } else {
      setError("관리자 비밀번호가 올바르지 않습니다.");
    }
  }
  return (
    <div className="gpa-gate-wrap">
      <div className="gpa-gate-card">
        <h1 className="gpa-gate-title">관리자 로그인</h1>
        <p className="gpa-gate-desc">일반 사용자 인증과 분리된 관리자 전용 화면입니다.</p>
        <div className="gpa-field">
          <label className="gpa-label">관리자 비밀번호</label>
          <input type="password" className="gpa-input" value={pw}
            onChange={(e) => { setPw(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="비밀번호 입력" autoFocus />
          {error && <div className="gpa-error">{error}</div>}
          <div className="gpa-hint">프로토타입 기본 비밀번호: {config.adminPassword}</div>
        </div>
        <button type="button" className="gpa-btn gpa-btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit}>로그인</button>
      </div>
    </div>
  );
}

/* ============================================================
   대시보드
   ============================================================ */
function Dashboard({ config, reps, resultsMeta, onRefresh, refreshing }) {
  const stats = useMemo(() => {
    const repNames = Object.keys(reps);
    let subCount = 0, appCount = 0, normalCount = 0, supportCount = 0;
    repNames.forEach((n) => {
      subCount += (reps[n].subs || []).length;
      (reps[n].applications || []).forEach((a) => {
        if (a.status === "cancelled") return;
        appCount++;
        if (a.type === "normal") normalCount++; else supportCount++;
      });
    });
    return { repCount: repNames.length, subCount, appCount, normalCount, supportCount };
  }, [reps]);

  const perContent = config.contents.map((c) => {
    let appCount = 0;
    Object.values(reps).forEach((r) => (r.applications || []).forEach((a) => { if (a.contentId === c.id && a.status !== "cancelled") appCount++; }));
    return { content: c, appCount };
  });

  return (
    <div>
      <div className="gpa-section-title">
        <div><h2>대시보드</h2><div className="gpa-section-desc">서비스 운영 현황 요약</div></div>
        <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={onRefresh} disabled={refreshing}>{refreshing ? "새로고침 중..." : "새로고침"}</button>
      </div>
      <div className="gpa-dash-grid">
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.repCount}</div><div className="gpa-stat-label">등록된 대표 캐릭터</div></div>
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.subCount}</div><div className="gpa-stat-label">등록된 하위 캐릭터</div></div>
        <div className="gpa-stat-card"><div className="gpa-stat-num">{config.contents.filter((c) => c.active).length}</div><div className="gpa-stat-label">활성 콘텐츠</div></div>
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.appCount}</div><div className="gpa-stat-label">전체 신청 건수</div></div>
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.normalCount}</div><div className="gpa-stat-label">일반 신청</div></div>
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.supportCount}</div><div className="gpa-stat-label">지원 신청</div></div>
      </div>

      <div className="gpa-card" style={{ marginTop: 14 }}>
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>콘텐츠별 현황</h2></div>
        <div className="gpa-table-wrap">
          <table className="gpa-table">
            <thead><tr><th>콘텐츠</th><th>상태</th><th>신청 건수</th><th>자동 삭제까지</th></tr></thead>
            <tbody>
              {perContent.map(({ content, appCount }) => {
                const meta = resultsMeta[content.id];
                const deleteAt = meta ? meta.generatedAt + RETENTION_MS : null;
                return (
                  <tr key={content.id}>
                    <td>{content.name}</td>
                    <td><span className={`gpa-badge ${content.active ? "on" : "off"}`}>{content.active ? "신청 가능" : "신청 마감"}</span></td>
                    <td>{appCount}건</td>
                    <td>{deleteAt ? formatRemaining(deleteAt - Date.now()) : <span style={{ color: "var(--text-faint)" }}>매칭 전</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   직업 및 역할 관리
   ============================================================ */
function JobModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [role, setRole] = useState(initial?.role || "dealer");
  const [keywords, setKeywords] = useState(initial?.keywords || "");
  const [order, setOrder] = useState(initial?.order ?? 1);
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState("");

  function save() {
    if (!name.trim()) { setError("직업명을 입력해주세요."); return; }
    onSave({ id: initial?.id || uid(), name: name.trim(), role, keywords: keywords.trim(), order: Number(order) || 1, active });
  }

  return (
    <div className="gpa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gpa-modal">
        <h3 className="gpa-modal-title">{initial ? "직업 수정" : "직업 등록"}</h3>
        <div className="gpa-field">
          <label className="gpa-label">직업명</label>
          <input className="gpa-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 창술사" />
          {error && <div className="gpa-error">{error}</div>}
        </div>
        <div className="gpa-field">
          <label className="gpa-label">역할</label>
          <select className="gpa-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="tank">탱커</option><option value="support">서포터</option><option value="dealer">딜러</option>
          </select>
        </div>
        <div className="gpa-field">
          <label className="gpa-label">검색용 키워드</label>
          <input className="gpa-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="공백으로 구분" />
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}>
            <label className="gpa-label">표시 순서</label>
            <input className="gpa-input" type="number" value={order} onChange={(e) => setOrder(e.target.value)} />
          </div>
          <div className="gpa-field" style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }} onClick={() => setActive(!active)}>
              <input type="checkbox" checked={active} readOnly /> 활성화
            </label>
          </div>
        </div>
        <div className="gpa-modal-actions">
          <button className="gpa-btn gpa-btn-ghost" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className="gpa-btn gpa-btn-primary" style={{ flex: 1 }} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

function JobsView({ jobs, onChange }) {
  const [modal, setModal] = useState(null);
  const sorted = [...jobs].sort((a, b) => a.order - b.order);

  function saveJob(job) {
    const exists = jobs.some((j) => j.id === job.id);
    onChange(exists ? jobs.map((j) => (j.id === job.id ? job : j)) : [...jobs, job]);
    setModal(null);
  }
  function toggleActive(job) { onChange(jobs.map((j) => (j.id === job.id ? { ...j, active: !j.active } : j))); }

  return (
    <div>
      <div className="gpa-section-title">
        <div><h2>직업 및 역할 관리</h2><div className="gpa-section-desc">사용자 캐릭터 등록 화면의 직업 선택지를 관리합니다.</div></div>
        <button className="gpa-btn gpa-btn-primary gpa-btn-sm" onClick={() => setModal("new")}>+ 직업 추가</button>
      </div>
      <div className="gpa-card">
        <div className="gpa-table-wrap">
          <table className="gpa-table">
            <thead><tr><th>순서</th><th>직업명</th><th>역할</th><th>키워드</th><th>상태</th><th></th></tr></thead>
            <tbody>
              {sorted.map((j) => (
                <tr key={j.id}>
                  <td>{j.order}</td>
                  <td>{j.name}</td>
                  <td><RoleBadge role={j.role} /></td>
                  <td style={{ color: "var(--text-faint)" }}>{j.keywords}</td>
                  <td><span className={`gpa-badge ${j.active ? "on" : "off"}`}>{j.active ? "활성" : "비활성"}</span></td>
                  <td>
                    <div className="gpa-row">
                      <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={() => setModal(j)}>수정</button>
                      <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={() => toggleActive(j)}>{j.active ? "비활성화" : "활성화"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="gpa-hint" style={{ marginTop: 10 }}>기존 캐릭터가 사용 중인 직업은 완전 삭제 대신 비활성화를 권장합니다. 비활성화된 직업은 신규 캐릭터 등록 목록에서만 숨겨집니다.</div>
      </div>
      {modal && <JobModal initial={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={saveJob} />}
    </div>
  );
}

/* ============================================================
   콘텐츠 관리
   ============================================================ */
function ContentModal({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [pressure, setPressure] = useState(initial?.pressure ?? 0);
  const [requiredResist, setRequiredResist] = useState(initial?.requiredResist ?? 0);
  const [partySize, setPartySize] = useState(initial?.partySize ?? 4);
  const [interval, setIntervalVal] = useState(initial?.interval ?? 30);
  const [startTime, setStartTime] = useState(initial?.startTime || "20:00");
  const [endTime, setEndTime] = useState(initial?.endTime || "23:00");
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState("");

  function save() {
    if (!name.trim()) { setError("콘텐츠명을 입력해주세요."); return; }
    if (Number(partySize) < 2) { setError("파티 인원은 2명 이상이어야 합니다."); return; }
    onSave({
      id: initial?.id || uid(), name: name.trim(),
      pressure: Number(pressure) || 0, requiredResist: Number(requiredResist) || 0,
      partySize: Number(partySize), interval: Number(interval) || 30,
      startTime, endTime, active,
    });
  }

  return (
    <div className="gpa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gpa-modal">
        <h3 className="gpa-modal-title">{initial ? "콘텐츠 수정" : "콘텐츠 등록"}</h3>
        <div className="gpa-field">
          <label className="gpa-label">콘텐츠명</label>
          <input className="gpa-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 협곡의 결전" />
          {error && <div className="gpa-error">{error}</div>}
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}><label className="gpa-label">마도 압력 (0=미적용)</label><input className="gpa-input" type="number" min="0" value={pressure} onChange={(e) => setPressure(e.target.value)} /></div>
          <div className="gpa-field" style={{ flex: 1 }}><label className="gpa-label">필요 마도 저항 (0=제한없음)</label><input className="gpa-input" type="number" min="0" value={requiredResist} onChange={(e) => setRequiredResist(e.target.value)} /></div>
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}><label className="gpa-label">파티 인원</label><input className="gpa-input" type="number" min="2" value={partySize} onChange={(e) => setPartySize(e.target.value)} /></div>
          <div className="gpa-field" style={{ flex: 1 }}><label className="gpa-label">시간 간격(분)</label><input className="gpa-input" type="number" min="5" value={interval} onChange={(e) => setIntervalVal(e.target.value)} /></div>
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}><label className="gpa-label">시작 시각</label><input className="gpa-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div className="gpa-field" style={{ flex: 1 }}><label className="gpa-label">종료 시각</label><input className="gpa-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 8 }} onClick={() => setActive(!active)}>
          <input type="checkbox" checked={active} readOnly /> 신청 가능(활성화)
        </label>
        <div className="gpa-modal-actions">
          <button className="gpa-btn gpa-btn-ghost" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className="gpa-btn gpa-btn-primary" style={{ flex: 1 }} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

function ContentsView({ contents, onChange, onToast, onAfterDelete }) {
  const [modal, setModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function saveContent(c) {
    const exists = contents.some((x) => x.id === c.id);
    onChange(exists ? contents.map((x) => (x.id === c.id ? c : x)) : [...contents, c]);
    setModal(null);
  }
  function toggleActive(c) { onChange(contents.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x))); }

  async function doDelete(content) {
    setDeleting(true);
    await purgeContentData(content); // 이 콘텐츠에 딸린 신청 내역·매칭 결과도 함께 정리합니다.
    onChange(contents.filter((x) => x.id !== content.id));
    setDeleting(false);
    onToast(`'${content.name}' 콘텐츠를 삭제했습니다. (관련 신청 내역·매칭 결과도 함께 삭제됨)`);
    if (onAfterDelete) onAfterDelete();
  }

  return (
    <div>
      <div className="gpa-section-title">
        <div><h2>콘텐츠 관리</h2><div className="gpa-section-desc">파티 신청과 매칭에 사용되는 콘텐츠 기준을 관리합니다.</div></div>
        <button className="gpa-btn gpa-btn-primary gpa-btn-sm" onClick={() => setModal("new")}>+ 콘텐츠 추가</button>
      </div>
      <div className="gpa-card">
        <div className="gpa-table-wrap">
          <table className="gpa-table">
            <thead><tr><th>콘텐츠명</th><th>파티인원</th><th>마도압력</th><th>필요저항</th><th>시간</th><th>간격</th><th>상태</th><th></th></tr></thead>
            <tbody>
              {contents.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.partySize}인</td>
                  <td>{c.pressure > 0 ? c.pressure.toLocaleString() : "-"}</td>
                  <td>{c.requiredResist > 0 ? c.requiredResist.toLocaleString() : "제한없음"}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{c.startTime}~{c.endTime}</td>
                  <td>{c.interval}분</td>
                  <td><span className={`gpa-badge ${c.active ? "on" : "off"}`}>{c.active ? "신청가능" : "마감"}</span></td>
                  <td>
                    <div className="gpa-row" style={{ flexWrap: "wrap" }}>
                      <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={() => setModal(c)}>수정</button>
                      <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={() => toggleActive(c)}>{c.active ? "마감" : "재개"}</button>
                      <button className="gpa-btn gpa-btn-danger gpa-btn-sm" disabled={deleting} onClick={() => setConfirmDelete(c)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {modal && <ContentModal initial={modal === "new" ? null : modal} onClose={() => setModal(null)} onSave={saveContent} />}
      {confirmDelete && (
        <ConfirmModal
          title="콘텐츠 삭제"
          message={`'${confirmDelete.name}' 콘텐츠를 삭제하시겠습니까?\n이 콘텐츠에 신청된 내역과 매칭 결과도 함께 삭제됩니다.\n삭제된 정보는 복구할 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={async () => { const c = confirmDelete; setConfirmDelete(null); await doDelete(c); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

const APP_STATUS_LABEL = { applied: "신청 완료", waiting: "매칭 대기", matched: "매칭 완료", revealed: "결과 공개", cancelled: "제외됨" };

function ApplicationsView({ contents, reps, onExcludeCharacter }) {
  const [contentId, setContentId] = useState(contents[0]?.id || "");
  const content = contents.find((c) => c.id === contentId);
  const [typeFilter, setTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [resistFilter, setResistFilter] = useState("all");

  const timeOptions = useMemo(() => (content ? timeSlots(content.startTime, content.endTime, content.interval) : []), [content]);

  // 캐릭터별 표시 정보(2.8) 기준으로 신청 하나당 캐릭터 단위로 행을 펼칩니다.
  const allRows = useMemo(() => {
    const out = [];
    Object.entries(reps).forEach(([repName, data]) => {
      (data.applications || []).forEach((a) => {
        if (a.contentId !== contentId || a.status === "cancelled") return;
        (a.characterIds || []).forEach((cid) => {
          const char = (data.subs || []).find((s) => s.id === cid);
          if (!char) return;
          out.push({ repName, app: a, char });
        });
      });
    });
    return out;
  }, [reps, contentId]);

  const rows = useMemo(() => {
    return allRows.filter((r) => {
      if (typeFilter !== "all" && r.app.type !== typeFilter) return false;
      if (roleFilter !== "all" && r.char.role !== roleFilter) return false;
      if (timeFilter !== "all" && !r.app.times.includes(timeFilter)) return false;
      if (resistFilter !== "all" && content) {
        const short = content.requiredResist > 0 && r.char.resist < content.requiredResist;
        if (resistFilter === "short" && !short) return false;
        if (resistFilter === "ok" && short) return false;
      }
      return true;
    });
  }, [allRows, typeFilter, roleFilter, timeFilter, resistFilter, content]);

  const counts = useMemo(() => ({
    total: allRows.length,
    normal: allRows.filter((r) => r.app.type === "normal").length,
    support: allRows.filter((r) => r.app.type === "support").length,
  }), [allRows]);

  return (
    <div>
      <div className="gpa-section-title"><div><h2>신청 현황</h2><div className="gpa-section-desc">콘텐츠별 신청 데이터를 캐릭터 단위로 확인합니다. (전체 {counts.total}건 · 일반 {counts.normal} · 지원 {counts.support})</div></div></div>
      <div className="gpa-content-pick">
        {contents.map((c) => (
          <button key={c.id} className={`gpa-content-chip ${c.id === contentId ? "active" : ""}`} onClick={() => { setContentId(c.id); setTimeFilter("all"); }}>{c.name}</button>
        ))}
      </div>

      <div className="gpa-card" style={{ marginBottom: 14 }}>
        <div className="gpa-row" style={{ flexWrap: "wrap", gap: 12 }}>
          <div style={{ minWidth: 120 }}>
            <label className="gpa-label">신청 유형</label>
            <select className="gpa-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">전체</option><option value="normal">일반</option><option value="support">지원</option>
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="gpa-label">역할</label>
            <select className="gpa-input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">전체</option><option value="tank">탱커</option><option value="support">서포터</option><option value="dealer">딜러</option>
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label className="gpa-label">시작 시각</label>
            <select className="gpa-input" value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}>
              <option value="all">전체</option>
              {timeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label className="gpa-label">마도 저항</label>
            <select className="gpa-input" value={resistFilter} onChange={(e) => setResistFilter(e.target.value)}>
              <option value="all">전체</option><option value="ok">충족</option><option value="short">미달</option>
            </select>
          </div>
        </div>
      </div>

      <div className="gpa-card">
        {rows.length === 0 ? (
          <div className="gpa-empty">{allRows.length === 0 ? "이 콘텐츠에 신청한 내역이 없습니다." : "조건에 맞는 신청 내역이 없습니다."}</div>
        ) : (
          <div className="gpa-table-wrap">
            <table className="gpa-table">
              <thead><tr><th>대표 캐릭터</th><th>캐릭터</th><th>역할</th><th>유형</th><th>기본 전투력</th><th>마도 저항</th><th>최종 전투력</th><th>시간</th><th>상태</th><th></th></tr></thead>
              <tbody>
                {rows.map(({ repName, app, char }) => {
                  const short = content && content.requiredResist > 0 && char.resist < content.requiredResist;
                  return (
                    <tr key={`${app.id}:${char.id}`}>
                      <td>{repName}</td>
                      <td>{char.nickname}</td>
                      <td><RoleBadge role={char.role} /></td>
                      <td><span className={`gpa-badge ${app.type === "normal" ? "normal" : "supportApp"}`}>{app.type === "normal" ? "일반" : "지원"}</span></td>
                      <td style={{ fontFamily: "var(--font-mono)" }}>{char.power.toLocaleString()}</td>
                      <td style={{ fontFamily: "var(--font-mono)", color: short ? "var(--danger)" : "var(--text)" }}>{char.resist.toLocaleString()}{short && " (미달)"}</td>
                      <td style={{ fontFamily: "var(--font-mono)" }}>{content ? charFinalPower(char, content).toLocaleString() : "-"}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{app.times.slice().sort().join(", ")}</td>
                      <td>{APP_STATUS_LABEL[app.status] || app.status}</td>
                      <td><button className="gpa-btn gpa-btn-danger gpa-btn-sm" onClick={() => onExcludeCharacter(repName, app.id, char.id)}>캐릭터 제외</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   자동 매칭 + 결과 편집 + 공개
   ============================================================ */
function SlotPickModal({ role, unassigned, onPick, onTemp, onClear, onClose }) {
  const [tempName, setTempName] = useState("");
  const roleCandidates = unassigned.filter((c) => c.char.role === role);
  return (
    <div className="gpa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gpa-modal">
        <h3 className="gpa-modal-title">{ROLE_LABEL[role]} 슬롯 편집</h3>
        <div className="gpa-label" style={{ marginBottom: 8 }}>미배정 후보에서 선택</div>
        {roleCandidates.length === 0 ? (
          <div className="gpa-hint" style={{ marginBottom: 14 }}>이 역할의 미배정 후보가 없습니다.</div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            {roleCandidates.map((c, i) => (
              <button key={i} className="gpa-pick-btn" onClick={() => onPick(c)}>
                <span>{c.char.nickname} <span style={{ color: "var(--text-faint)" }}>({c.repName})</span></span>
                <span style={{ color: "var(--text-faint)" }}>{c.type === "normal" ? "일반" : "지원"}</span>
              </button>
            ))}
          </div>
        )}
        <div className="gpa-field">
          <label className="gpa-label">등록되지 않은 임시 캐릭터로 채우기</label>
          <div className="gpa-row">
            <input className="gpa-input" value={tempName} onChange={(e) => setTempName(e.target.value)} placeholder="닉네임 입력" />
            <button className="gpa-btn gpa-btn-ghost" onClick={() => tempName.trim() && onTemp(tempName.trim())}>추가</button>
          </div>
          <div className="gpa-hint">임시 캐릭터는 평균 전투력 계산에서 제외되고, 닉네임과 역할만 표시됩니다.</div>
        </div>
        <div className="gpa-modal-actions">
          <button className="gpa-btn gpa-btn-danger" style={{ flex: 1 }} onClick={onClear}>빈자리로 비우기</button>
          <button className="gpa-btn gpa-btn-ghost" style={{ flex: 1 }} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function MatchingView({ contents, reps, onToast, onDataChanged }) {
  const [contentId, setContentId] = useState(contents[0]?.id || "");
  const content = contents.find((c) => c.id === contentId);
  const [matchData, setMatchData] = useState(null);
  const [loadingResult, setLoadingResult] = useState(true);
  const [editSlot, setEditSlot] = useState(null); // { timeIdx, partyIdx, slotIdx, role }
  const [showRematchConfirm, setShowRematchConfirm] = useState(false);
  const [dragItem, setDragItem] = useState(null); // { kind:'slot', partyIdx, slotIdx, role } | { kind:'unassigned', candidate, role }
  const [dragOverKey, setDragOverKey] = useState(null);
  const [clockTick, setClockTick] = useState(0);
  const [downloadingImage, setDownloadingImage] = useState(false);
  const resultsRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setClockTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const preview = useMemo(() => {
    if (!content) return null;
    const candidates = buildCandidates(content, reps);
    const repSet = new Set(candidates.map((c) => c.repName));
    const normal = candidates.filter((c) => c.type === "normal").length;
    const support = candidates.filter((c) => c.type === "support").length;
    return { repCount: repSet.size, candidateCount: candidates.length, normal, support };
  }, [content, reps]);

  const loadResult = useCallback(async () => {
    if (!content) return;
    setLoadingResult(true);
    const raw = await storageGet(`results:${content.id}`, true);
    setMatchData(raw ? JSON.parse(raw) : null);
    setLoadingResult(false);
  }, [content]);

  useEffect(() => { loadResult(); }, [loadResult]);

  async function saveResult(next) {
    setMatchData(next);
    await storageSet(`results:${content.id}`, next, true);
    if (onDataChanged) onDataChanged();
  }

  async function setApplicationStatusForContent(status) {
    const rows = await storageListWithValues("rep:", true);
    for (const row of rows) {
      if (!row.value) continue;
      let data;
      try { data = JSON.parse(row.value); } catch (e) { continue; }
      let changed = false;
      const apps = (data.applications || []).map((a) => {
        if (a.contentId === content.id && a.status !== "cancelled") { changed = true; return { ...a, status }; }
        return a;
      });
      if (changed) await storageSet(row.key, { ...data, applications: apps }, true);
    }
  }

  async function doRunMatch() {
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
  }

  async function togglePublish() {
    if (!matchData) return;
    const next = { ...matchData, published: !matchData.published };
    await saveResult(next);
    await setApplicationStatusForContent(next.published ? "revealed" : "matched");
    onToast(next.published ? "결과를 공개했습니다." : "결과를 비공개로 전환했습니다.");
  }

  // 현재 화면에 보이는 "결과 편집" 영역을 그대로 캡처해서 PNG로 다운로드합니다.
  // [Unverified] html2canvas로 DOM을 캡처하는 방식은 대부분의 경우 화면과 비슷하게
  // 나오지만, 드래그 중 상태나 일부 CSS 효과는 캡처 결과에 정확히 반영되지
  // 않을 수 있습니다 — 이는 기대되는 동작이며 모든 환경에서 보장되지는 않습니다.
  async function downloadResultsImage() {
    if (!resultsRef.current) return;
    setDownloadingImage(true);
    try {
      const canvas = await html2canvas(resultsRef.current, {
        backgroundColor: "#F7F5F0",
        scale: 2,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `매칭결과_${content?.name || "콘텐츠"}_${ts}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      onToast("매칭 결과 이미지를 다운로드했습니다.");
    } catch (e) {
      console.error("downloadResultsImage failed:", e);
      onToast("이미지 다운로드에 실패했습니다.");
    } finally {
      setDownloadingImage(false);
    }
  }

  // 슬롯 클릭은 JSX에서 setEditSlot({ partyIdx, slotIdx, role })로 직접 처리합니다.

  // parties grouped by time for rendering, but we also need flat index mapping back into matchData.parties
  const partiesByTime = useMemo(() => {
    if (!matchData) return {};
    const g = {};
    matchData.parties.forEach((p, idx) => {
      if (!g[p.time]) g[p.time] = [];
      g[p.time].push({ ...p, _idx: idx });
    });
    return g;
  }, [matchData]);

  function recomputeShortage(party) {
    const missing = {};
    party.slots.forEach((s) => { if (!s.nickname) missing[s.role] = (missing[s.role] || 0) + 1; });
    const parts = [];
    if (missing.tank) parts.push(`탱커 ${missing.tank}명 부족`);
    if (missing.support) parts.push(`서포터 ${missing.support}명 부족`);
    if (missing.dealer) parts.push(`딜러 ${missing.dealer}명 부족`);
    return parts.length ? parts.join(" · ") : null;
  }

  function assignToSlot(partyIdx, slotIdx, newSlotValue, consumedCandidate) {
    const oldSlot = matchData.parties[partyIdx].slots[slotIdx];
    const parties = matchData.parties.map((p, i) => {
      if (i !== partyIdx) return p;
      const slots = p.slots.map((s, si) => (si === slotIdx ? newSlotValue : s));
      const np = { ...p, slots };
      np.shortage = recomputeShortage(np);
      return np;
    });
    let unassigned = matchData.unassigned || [];
    if (consumedCandidate) unassigned = unassigned.filter((c) => c !== consumedCandidate);
    if (oldSlot && oldSlot.nickname && oldSlot.characterId) {
      // 기존 배정자를 미배정 목록으로 되돌림 (임시 캐릭터는 미배정 목록에 넣지 않음)
      unassigned = [...unassigned, {
        repName: oldSlot.repName, type: oldSlot.type, time: parties[partyIdx].time,
        char: { id: oldSlot.characterId, nickname: oldSlot.nickname, role: oldSlot.role, power: 0, resist: 0 },
        reason: "파티 편집 중 제외됨",
      }];
    }
    saveResult({ ...matchData, parties, unassigned });
  }

  function commitSlotEdit(newSlotValue, consumedCandidate) {
    const { partyIdx, slotIdx } = editSlot;
    assignToSlot(partyIdx, slotIdx, newSlotValue, consumedCandidate);
    setEditSlot(null);
  }

  // 슬롯↔슬롯 드래그: 같은 역할끼리 두 슬롯의 내용을 맞바꿉니다.
  function swapSlots(sourcePartyIdx, sourceSlotIdx, targetPartyIdx, targetSlotIdx) {
    if (sourcePartyIdx === targetPartyIdx && sourceSlotIdx === targetSlotIdx) return;
    const sourceSlot = matchData.parties[sourcePartyIdx].slots[sourceSlotIdx];
    const targetSlot = matchData.parties[targetPartyIdx].slots[targetSlotIdx];
    if (sourceSlot.role !== targetSlot.role) { onToast("같은 역할끼리만 이동할 수 있습니다."); return; }
    const newSource = { ...sourceSlot, nickname: targetSlot.nickname, repName: targetSlot.repName, characterId: targetSlot.characterId, type: targetSlot.type };
    const newTarget = { ...targetSlot, nickname: sourceSlot.nickname, repName: sourceSlot.repName, characterId: sourceSlot.characterId, type: sourceSlot.type };
    const parties = matchData.parties.map((p, i) => {
      const isSource = i === sourcePartyIdx, isTarget = i === targetPartyIdx;
      if (!isSource && !isTarget) return p;
      const slots = p.slots.map((s, si) => {
        if (isSource && si === sourceSlotIdx) return newSource;
        if (isTarget && si === targetSlotIdx) return newTarget;
        return s;
      });
      const np = { ...p, slots };
      np.shortage = recomputeShortage(np);
      return np;
    });
    saveResult({ ...matchData, parties });
  }

  function handleDropOnSlot(targetPartyIdx, targetSlotIdx, targetRole) {
    setDragOverKey(null);
    if (!dragItem) return;
    if (dragItem.role !== targetRole) { onToast("같은 역할끼리만 이동할 수 있습니다."); setDragItem(null); return; }
    if (dragItem.kind === "slot") {
      swapSlots(dragItem.partyIdx, dragItem.slotIdx, targetPartyIdx, targetSlotIdx);
    } else if (dragItem.kind === "unassigned") {
      const cand = dragItem.candidate;
      assignToSlot(targetPartyIdx, targetSlotIdx, { role: targetRole, nickname: cand.char.nickname, repName: cand.repName, characterId: cand.char.id, type: cand.type }, cand);
    }
    setDragItem(null);
  }

  function pickFromUnassigned(cand) {
    const { role } = editSlot;
    commitSlotEdit({ role, nickname: cand.char.nickname, repName: cand.repName, characterId: cand.char.id, type: cand.type }, cand);
  }
  function setTempSlot(name) {
    const { role } = editSlot;
    commitSlotEdit({ role, nickname: name, repName: null, characterId: null, type: "temp" }, null);
  }
  function clearSlot() {
    const { role } = editSlot;
    commitSlotEdit({ role, nickname: null, repName: null, characterId: null, type: null }, null);
  }

  if (!content) return <div className="gpa-empty">등록된 콘텐츠가 없습니다.</div>;

  return (
    <div>
      <div className="gpa-section-title"><div><h2>자동 매칭</h2><div className="gpa-section-desc">콘텐츠를 선택하고 자동 매칭을 실행하세요.</div></div></div>
      <div className="gpa-content-pick">
        {contents.map((c) => (
          <button key={c.id} className={`gpa-content-chip ${c.id === contentId ? "active" : ""}`} onClick={() => setContentId(c.id)}>{c.name}</button>
        ))}
      </div>

      <div className="gpa-card">
        <div className="gpa-dash-grid">
          <div className="gpa-stat-card"><div className="gpa-stat-num">{preview.repCount}</div><div className="gpa-stat-label">신청 대표 캐릭터 수</div></div>
          <div className="gpa-stat-card"><div className="gpa-stat-num">{preview.candidateCount}</div><div className="gpa-stat-label">캐릭터×시간 후보 수</div></div>
          <div className="gpa-stat-card"><div className="gpa-stat-num">{preview.normal}</div><div className="gpa-stat-label">일반 신청 후보</div></div>
          <div className="gpa-stat-card"><div className="gpa-stat-num">{preview.support}</div><div className="gpa-stat-label">지원 신청 후보</div></div>
        </div>
        <div className="gpa-row" style={{ marginTop: 16 }}>
          <button className="gpa-btn gpa-btn-primary" onClick={runMatch} disabled={preview.candidateCount === 0}>{matchData ? "재매칭 실행" : "자동 매칭 실행"}</button>
          {matchData && (
            <button className="gpa-btn gpa-btn-ghost" onClick={togglePublish}>{matchData.published ? "결과 비공개로 전환" : "결과 공개하기"}</button>
          )}
          {matchData && matchData.parties.length > 0 && (
            <button className="gpa-btn gpa-btn-ghost" onClick={downloadResultsImage} disabled={downloadingImage}>{downloadingImage ? "이미지 생성 중..." : "이미지로 다운로드"}</button>
          )}
        </div>
      </div>

      {loadingResult ? (
        <div className="gpa-card"><div className="gpa-empty">불러오는 중...</div></div>
      ) : !matchData || matchData.parties.length === 0 ? (
        <div className="gpa-card"><div className="gpa-empty">아직 실행된 매칭 결과가 없습니다.</div></div>
      ) : (
        <div className="gpa-card" ref={resultsRef}>
          <div className="gpa-section-title">
            <h2 style={{ fontSize: 14 }}>결과 편집 {matchData.published ? <span className="gpa-badge on" style={{ marginLeft: 8 }}>공개됨</span> : <span className="gpa-badge off" style={{ marginLeft: 8 }}>비공개</span>}</h2>
            <div className="gpa-section-desc">슬롯을 드래그해서 옮기거나, 클릭해서 임시 캐릭터 입력·비우기를 할 수 있습니다. (같은 역할 슬롯끼리만 이동 가능)</div>
          </div>
          <div className="gpa-hint" style={{ marginBottom: 16 }}>
            자동 매칭 실행: {formatDateTime(matchData.generatedAt)} · 자동 삭제 예정: {formatDateTime(matchData.generatedAt + RETENTION_MS)} ·{" "}
            <span style={{ color: matchData.generatedAt + RETENTION_MS - Date.now() <= 0 ? "var(--danger)" : "var(--accent-soft)" }}>
              {formatRemaining(matchData.generatedAt + RETENTION_MS - Date.now())}
            </span>
          </div>
          {Object.entries(partiesByTime).map(([time, parties]) => (
            <div key={time} className="gpa-time-block">
              <div className="gpa-time-title">{time}</div>
              <div className="gpa-party-grid">
                {parties.map((p) => (
                  <div key={p.partyNumber} className="gpa-party-card">
                    <div className="gpa-party-top"><span>파티 {p.partyNumber}</span></div>
                    {p.slots.map((s, si) => {
                      const key = `${p._idx}-${si}`;
                      const cls = ["gpa-slot"];
                      if (dragItem && dragItem.kind === "slot" && dragItem.partyIdx === p._idx && dragItem.slotIdx === si) cls.push("dragging");
                      if (dragOverKey === key) cls.push(dragItem && dragItem.role === s.role ? "dragover" : "drag-reject");
                      return (
                        <div
                          key={si}
                          className={cls.join(" ")}
                          draggable={!!s.nickname}
                          onClick={() => setEditSlot({ partyIdx: p._idx, slotIdx: si, role: s.role })}
                          onDragStart={(e) => { if (!s.nickname) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); setDragItem({ kind: "slot", partyIdx: p._idx, slotIdx: si, role: s.role }); }}
                          onDragEnd={() => { setDragItem(null); setDragOverKey(null); }}
                          onDragOver={(e) => { if (!dragItem) return; e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key); }}
                          onDragLeave={() => { if (dragOverKey === key) setDragOverKey(null); }}
                          onDrop={(e) => { e.preventDefault(); handleDropOnSlot(p._idx, si, s.role); }}
                        >
                          <span className={`gpa-slot-role ${s.role}`}>{ROLE_LABEL[s.role]}</span>
                          {s.nickname ? <span className="gpa-slot-name">{s.nickname}{s.type === "temp" && <span className="gpa-slot-tag"> · 임시</span>}</span> : <span className="gpa-slot-empty">빈자리</span>}
                        </div>
                      );
                    })}
                    {p.shortage && <div className="gpa-party-short">부족 인원: {p.shortage}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {matchData.unassigned && matchData.unassigned.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="gpa-time-title">미배정 신청자 ({matchData.unassigned.length}명)</div>
              <div className="gpa-hint" style={{ marginBottom: 8 }}>카드를 파티 슬롯으로 드래그하면 바로 배정됩니다. (같은 역할 슬롯에만 놓을 수 있어요)</div>
              <div className="gpa-unassigned-list">
                {matchData.unassigned.map((u, i) => (
                  <div
                    key={i}
                    className={`gpa-unassigned-row ${dragItem && dragItem.kind === "unassigned" && dragItem.candidate === u ? "dragging" : ""}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", `unassigned-${i}`); setDragItem({ kind: "unassigned", candidate: u, role: u.char.role }); }}
                    onDragEnd={() => { setDragItem(null); setDragOverKey(null); }}
                  >
                    <RoleBadge role={u.char.role} />
                    <span>{u.char.nickname} ({u.repName})</span>
                    <span style={{ color: "var(--text-faint)" }}>{u.time}</span>
                    <span style={{ marginLeft: "auto", color: "var(--text-faint)" }}>{u.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {editSlot && matchData && (
        <SlotPickModal
          role={editSlot.role}
          unassigned={matchData.unassigned || []}
          onPick={pickFromUnassigned}
          onTemp={setTempSlot}
          onClear={clearSlot}
          onClose={() => setEditSlot(null)}
        />
      )}

      {showRematchConfirm && (
        <ConfirmModal
          title="재매칭 확인"
          message={"기존 매칭 결과와 관리자가 수정한 내용이 모두 삭제됩니다.\n최신 신청 데이터를 기준으로 다시 매칭하시겠습니까?"}
          confirmLabel="재매칭 실행"
          danger
          onConfirm={async () => { setShowRematchConfirm(false); await doRunMatch(); }}
          onCancel={() => setShowRematchConfirm(false)}
        />
      )}
    </div>
  );
}

/**
 * 테스트용 일괄 신청 데이터를 만듭니다.
 * - 이미 등록된 모든 캐릭터가 대상 (새 캐릭터를 만들지 않음)
 * - 활성화된 모든 콘텐츠에 각각 신청
 * - 콘텐츠의 필요 마도 저항을 충족하는 캐릭터만 포함 (실제 신청 화면과 동일한 규칙)
 * - 신청 유형은 캐릭터×콘텐츠 조합마다 일반/지원 중 무작위
 * - 신청 시간은 콘텐츠의 가능한 시간대 중 2~3개를 무작위로 선택
 * 반환값: { [repName]: 그 대표 캐릭터에 새로 추가할 신청 배열 }
 */
function pickRandomTimes(slots, min, max) {
  if (slots.length === 0) return [];
  const count = Math.min(slots.length, min + Math.floor(Math.random() * (max - min + 1)));
  const pool = [...slots];
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function buildBulkTestApplications(reps, contents) {
  const activeContents = contents.filter((c) => c.active);
  const byRep = {};
  let totalApps = 0;

  Object.entries(reps).forEach(([repName, data]) => {
    (data.subs || []).forEach((char) => {
      if (char.active === false) return;
      activeContents.forEach((content) => {
        const qualifies = (content.requiredResist || 0) <= 0 || char.resist >= content.requiredResist;
        if (!qualifies) return;
        const slots = timeSlots(content.startTime, content.endTime, content.interval);
        const times = pickRandomTimes(slots, 2, 3);
        if (times.length === 0) return;
        const type = Math.random() < 0.5 ? "normal" : "support";
        const app = {
          id: uid(), contentId: content.id, contentName: content.name,
          type, characterIds: [char.id], times, status: "applied", appliedAt: Date.now(),
        };
        if (!byRep[repName]) byRep[repName] = [];
        byRep[repName].push(app);
        totalApps++;
      });
    });
  });

  return { byRep, totalApps };
}

/* ============================================================
   전체 캐릭터 목록 (데이터 관리 하위)
   ============================================================ */
function AllCharactersSection({ reps, jobs, onUpdateCharacter, onDeleteCharacter }) {
  const [editingKey, setEditingKey] = useState(null); // `${repName}:${char.id}`
  const [draft, setDraft] = useState(null);
  const [rowError, setRowError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // { repName, char }

  const rows = useMemo(() => {
    const out = [];
    Object.entries(reps).forEach(([repName, data]) => {
      (data.subs || []).forEach((c) => out.push({ repName, char: c }));
    });
    return out.sort((a, b) => (b.char.updatedAt || 0) - (a.char.updatedAt || 0));
  }, [reps]);

  function startEdit(repName, char) {
    setEditingKey(`${repName}:${char.id}`);
    setRowError("");
    setDraft({
      nickname: char.nickname,
      jobId: char.jobId || "",
      power: char.power,
      resist: char.resist,
      penalty: char.penalty || 0,
      active: char.active !== false,
    });
  }
  function cancelEdit() {
    setEditingKey(null);
    setDraft(null);
    setRowError("");
  }
  function saveEdit(repName, char) {
    if (!draft.nickname.trim()) { setRowError("캐릭터 닉네임을 입력해주세요."); return; }
    if (!draft.jobId) { setRowError("직업을 선택해주세요."); return; }
    if (Number(draft.power) < 0 || Number(draft.resist) < 0 || Number(draft.penalty) < 0) { setRowError("숫자 값은 0 이상이어야 합니다."); return; }
    const job = jobs.find((j) => j.id === draft.jobId);
    onUpdateCharacter(repName, {
      ...char,
      nickname: draft.nickname.trim(),
      jobId: draft.jobId,
      jobName: job?.name,
      role: job?.role,
      power: Number(draft.power),
      resist: Number(draft.resist),
      penalty: Number(draft.penalty),
      active: draft.active,
      updatedAt: Date.now(),
    });
    setEditingKey(null);
    setDraft(null);
    setRowError("");
  }

  return (
    <div className="gpa-card">
      <div className="gpa-section-title">
        <div>
          <h2 style={{ fontSize: 14 }}>전체 캐릭터 목록</h2>
          <div className="gpa-section-desc">지금까지 등록된 적이 있는 모든 캐릭터입니다. "수정"을 누르면 이 자리에서 바로 값을 고칠 수 있습니다.</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="gpa-empty">등록된 캐릭터가 없습니다.</div>
      ) : (
        <div className="gpa-table-wrap">
          <table className="gpa-table">
            <thead>
              <tr>
                <th>대표캐릭터</th><th>캐릭터</th><th>역할</th><th>기본전투력</th><th>마도저항</th><th>패널티</th><th>활성화</th><th>업데이트 일자</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ repName, char }) => {
                const key = `${repName}:${char.id}`;
                const isEditing = editingKey === key;

                if (isEditing) {
                  return (
                    <tr key={key}>
                      <td>{repName}</td>
                      <td><input className="gpa-input" style={{ minWidth: 100 }} value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} /></td>
                      <td>
                        <select className="gpa-input" style={{ minWidth: 100 }} value={draft.jobId} onChange={(e) => setDraft({ ...draft, jobId: e.target.value })}>
                          <option value="">직업 선택</option>
                          {jobs.filter((j) => j.active !== false || j.id === draft.jobId).map((j) => <option key={j.id} value={j.id}>{j.name} ({ROLE_LABEL[j.role]})</option>)}
                        </select>
                      </td>
                      <td><input className="gpa-input" style={{ width: 90 }} type="number" min="0" value={draft.power} onChange={(e) => setDraft({ ...draft, power: e.target.value })} /></td>
                      <td><input className="gpa-input" style={{ width: 90 }} type="number" min="0" value={draft.resist} onChange={(e) => setDraft({ ...draft, resist: e.target.value })} /></td>
                      <td><input className="gpa-input" style={{ width: 80 }} type="number" min="0" value={draft.penalty} onChange={(e) => setDraft({ ...draft, penalty: e.target.value })} /></td>
                      <td>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => setDraft({ ...draft, active: !draft.active })}>
                          <input type="checkbox" checked={draft.active} readOnly />
                        </label>
                      </td>
                      <td style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{char.updatedAt ? formatDateTime(char.updatedAt) : "-"}</td>
                      <td>
                        <div className="gpa-row" style={{ flexWrap: "wrap" }}>
                          <button className="gpa-btn gpa-btn-primary gpa-btn-sm" onClick={() => saveEdit(repName, char)}>수정 완료</button>
                          <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={cancelEdit}>취소</button>
                        </div>
                        {rowError && <div className="gpa-error" style={{ marginTop: 6 }}>{rowError}</div>}
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={key}>
                    <td>{repName}</td>
                    <td>{char.nickname}</td>
                    <td><RoleBadge role={char.role} /></td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{char.power.toLocaleString()}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{char.resist.toLocaleString()}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{(char.penalty || 0) > 0 ? char.penalty.toLocaleString() : "-"}</td>
                    <td><span className={`gpa-badge ${char.active !== false ? "on" : "off"}`}>{char.active !== false ? "활성" : "비활성"}</span></td>
                    <td style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{char.updatedAt ? formatDateTime(char.updatedAt) : "-"}</td>
                    <td>
                      <div className="gpa-row">
                        <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={() => startEdit(repName, char)}>수정</button>
                        <button className="gpa-btn gpa-btn-danger gpa-btn-sm" onClick={() => setConfirmDelete({ repName, char })}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="캐릭터 삭제"
          message={`'${confirmDelete.repName}'의 캐릭터 '${confirmDelete.char.nickname}'을(를) 삭제하시겠습니까?\n이 캐릭터가 포함된 신청 내역은 함께 정리되지 않으니, 필요하면 신청 현황에서 별도로 확인해주세요.\n삭제된 정보는 복구할 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => { onDeleteCharacter(confirmDelete.repName, confirmDelete.char.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/* ============================================================
   비밀번호 관리
   ============================================================ */
function PasswordView({ config, onChange, onToast }) {
  const [guildPw, setGuildPw] = useState(config.password || "");
  const [adminPw, setAdminPw] = useState(config.adminPassword || "");
  const [guildError, setGuildError] = useState("");
  const [adminError, setAdminError] = useState("");
  const [confirmSave, setConfirmSave] = useState(null); // 'guild' | 'admin' | null

  function saveGuildPw() {
    if (!guildPw.trim()) { setGuildError("빈 값으로는 저장할 수 없습니다."); return; }
    setGuildError("");
    setConfirmSave("guild");
  }
  function saveAdminPw() {
    if (!adminPw.trim()) { setAdminError("빈 값으로는 저장할 수 없습니다."); return; }
    setAdminError("");
    setConfirmSave("admin");
  }
  function doSave() {
    if (confirmSave === "guild") {
      onChange({ password: guildPw.trim() });
      onToast("길드 공용 비밀번호를 변경했습니다.");
    } else if (confirmSave === "admin") {
      onChange({ adminPassword: adminPw.trim() });
      onToast("관리자 비밀번호를 변경했습니다.");
    }
    setConfirmSave(null);
  }

  return (
    <div>
      <div className="gpa-section-title"><div><h2>비밀번호 관리</h2><div className="gpa-section-desc">길드 입장 비밀번호와 관리자 비밀번호를 확인하고 변경합니다.</div></div></div>

      <div className="gpa-card">
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>길드 공용 비밀번호</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 12 }}>사용자 화면의 길드 입장 화면에서 길드원이 입력하는 비밀번호입니다.</div>
        <div className="gpa-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <input className="gpa-input" value={guildPw} onChange={(e) => { setGuildPw(e.target.value); setGuildError(""); }} placeholder="길드 공용 비밀번호" />
            {guildError && <div className="gpa-error">{guildError}</div>}
          </div>
          <button className="gpa-btn gpa-btn-primary gpa-btn-sm" onClick={saveGuildPw} disabled={guildPw === config.password}>저장</button>
        </div>
      </div>

      <div className="gpa-card">
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>관리자 비밀번호</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 12 }}>
          이 관리자 화면 로그인에 쓰이는 비밀번호입니다. 변경해도 지금 로그인된 세션은 유지되지만, 이후 새로 로그인하는 관리자는 새 비밀번호를 입력해야 합니다.
        </div>
        <div className="gpa-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <input className="gpa-input" value={adminPw} onChange={(e) => { setAdminPw(e.target.value); setAdminError(""); }} placeholder="관리자 비밀번호" />
            {adminError && <div className="gpa-error">{adminError}</div>}
          </div>
          <button className="gpa-btn gpa-btn-primary gpa-btn-sm" onClick={saveAdminPw} disabled={adminPw === config.adminPassword}>저장</button>
        </div>
      </div>

      <div className="gpa-hint" style={{ marginTop: 4 }}>
        이 비밀번호들은 강력한 보안 수단이 아니라 최소한의 잠금장치입니다. 값은 배포된 코드/네트워크 요청을 통해 확인 가능한 형태로 저장되므로, 민감한 용도로는 적합하지 않습니다.
      </div>

      {confirmSave && (
        <ConfirmModal
          title={confirmSave === "guild" ? "길드 비밀번호 변경" : "관리자 비밀번호 변경"}
          message={
            confirmSave === "guild"
              ? "길드 공용 비밀번호를 변경하시겠습니까?\n변경 후에는 길드원들에게 새 비밀번호를 다시 공유해주셔야 합니다."
              : "관리자 비밀번호를 변경하시겠습니까?\n변경 후에는 다른 관리자에게 새 비밀번호를 다시 공유해주셔야 합니다."
          }
          confirmLabel="변경"
          onConfirm={doSave}
          onCancel={() => setConfirmSave(null)}
        />
      )}
    </div>
  );
}

/* ============================================================
   데이터 관리
   ============================================================ */
function DataView({ contents, jobs, reps, onUpdateCharacter, onDeleteCharacter, resultsMeta, onToast, onAfterDelete }) {
  const [busyId, setBusyId] = useState(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [confirmDeleteContent, setConfirmDeleteContent] = useState(null);
  const [confirmBulkApply, setConfirmBulkApply] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);

  async function doDeleteContentData(content) {
    setBusyId(content.id);
    await purgeContentData(content);
    setBusyId(null);
    onToast(`'${content.name}'의 신청/매칭 데이터를 삭제했습니다.`);
    onAfterDelete();
  }

  async function doBulkTestApply() {
    setBulkApplying(true);

    const backup = await backupKv();
    if (!backup.ok) {
      setBulkApplying(false);
      onToast("구글 시트 백업에 실패해서 일괄 신청을 진행하지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    const { byRep, totalApps } = buildBulkTestApplications(reps, contents);
    const repNames = Object.keys(byRep);
    if (repNames.length === 0) {
      setBulkApplying(false);
      onToast(`백업(${backup.name})은 만들었지만, 신청 가능한 활성 콘텐츠나 조건에 맞는 캐릭터가 없어 신청은 생성되지 않았습니다.`);
      return;
    }

    for (const repName of repNames) {
      const data = reps[repName];
      const next = { ...data, applications: [...(data.applications || []), ...byRep[repName]] };
      await storageSet(`rep:${repName}`, next, true);
    }

    setBulkApplying(false);
    onToast(`백업(${backup.name})을 만든 뒤, 대표 캐릭터 ${repNames.length}명에 걸쳐 총 ${totalApps}건의 테스트 신청을 생성했습니다.`);
    onAfterDelete();
  }

  async function doPullFromSheets() {
    setPulling(true);
    const ok = await pullFromSheets();
    setPulling(false);
    if (ok) {
      onToast("구글 시트 내용을 불러왔습니다. 형식이 어긋난 값이 있으면 일부 필드가 다르게 반영될 수 있으니 직업/콘텐츠/캐릭터 목록을 확인해주세요.");
    } else {
      onToast("구글 시트 불러오기에 실패했습니다. 잠시 후 다시 시도해주세요.");
    }
    onAfterDelete();
  }

  return (
    <div>
      <div className="gpa-section-title"><div><h2>데이터 관리</h2><div className="gpa-section-desc">콘텐츠별 신청 및 매칭 데이터를 수동으로 삭제할 수 있습니다. 자동 매칭 실행 후 48시간이 지나면 자동으로 삭제됩니다.</div></div></div>

      <div className="gpa-card">
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>구글 시트 연동</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 14 }}>
          직업/콘텐츠/캐릭터/신청 데이터는 앱에서 저장할 때마다 구글 시트의 "jobs" · "contents" · "characters" · "applications" 탭에 자동으로 복사됩니다.
          시트에서 직접 값을 고쳤다면, 아래 버튼을 눌러야 이 앱에 반영됩니다 (자동으로는 반영되지 않습니다).
        </div>
        <button className="gpa-btn gpa-btn-primary gpa-btn-sm" disabled={pulling} onClick={() => setConfirmPull(true)}>{pulling ? "불러오는 중..." : "구글 시트에서 다시 불러오기"}</button>
      </div>

      <AllCharactersSection reps={reps} jobs={jobs} onUpdateCharacter={onUpdateCharacter} onDeleteCharacter={onDeleteCharacter} />

      <div className="gpa-card">
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>테스트용 일괄 신청</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 14 }}>
          현재 등록된 전체 캐릭터가, 활성화된 모든 콘텐츠에 각각 신청합니다. 캐릭터×콘텐츠 조합마다 신청 유형(일반/지원)은 무작위, 신청 시간은 해당 콘텐츠의 가능한 시간대 중 2~3개를 무작위로 선택합니다.
          필요 마도 저항을 충족하지 못하는 조합은 제외됩니다. 실행 전에 구글 시트의 kv 탭을 자동으로 백업합니다.
        </div>
        <button className="gpa-btn gpa-btn-primary gpa-btn-sm" disabled={bulkApplying} onClick={() => setConfirmBulkApply(true)}>{bulkApplying ? "처리 중..." : "테스트용 일괄 신청 실행"}</button>
      </div>

      <div className="gpa-card">
        <div className="gpa-hint" style={{ marginBottom: 14 }}>대표 캐릭터, 하위 캐릭터, 직업 목록, 콘텐츠 설정은 삭제되지 않습니다. 이 화면은 신청 내역과 매칭 결과만 삭제합니다.</div>
        <div className="gpa-table-wrap">
          <table className="gpa-table">
            <thead><tr><th>콘텐츠</th><th>자동 매칭 실행</th><th>자동 삭제 예정</th><th>남은 시간</th><th></th></tr></thead>
            <tbody>
              {contents.map((c) => {
                const meta = resultsMeta[c.id];
                const deleteAt = meta ? meta.generatedAt + RETENTION_MS : null;
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{meta ? formatDateTime(meta.generatedAt) : "-"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{deleteAt ? formatDateTime(deleteAt) : "-"}</td>
                    <td>{deleteAt ? <span className={`gpa-badge ${deleteAt - Date.now() <= 0 ? "off" : "on"}`}>{formatRemaining(deleteAt - Date.now())}</span> : <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                    <td><button className="gpa-btn gpa-btn-danger gpa-btn-sm" disabled={busyId === c.id} onClick={() => setConfirmDeleteContent(c)}>{busyId === c.id ? "삭제 중..." : "지금 삭제"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {confirmPull && (
        <ConfirmModal
          title="구글 시트에서 다시 불러오기"
          message={"구글 시트의 jobs / contents / characters / applications 탭 내용으로 이 앱의 직업, 콘텐츠, 캐릭터, 신청 데이터를 덮어씁니다.\n앱에서 마지막으로 저장한 이후 시트에서 직접 고친 내용이 있다면 반영되고, 이 앱에서만 있던 최신 변경사항은 시트에 없다면 사라질 수 있습니다.\n계속할까요?"}
          confirmLabel="불러오기"
          onConfirm={async () => { setConfirmPull(false); await doPullFromSheets(); }}
          onCancel={() => setConfirmPull(false)}
        />
      )}

      {confirmBulkApply && (
        <ConfirmModal
          title="테스트용 일괄 신청 실행"
          message={"등록된 모든 캐릭터가 활성화된 모든 콘텐츠에 무작위 유형·무작위 시간으로 신청합니다.\n실행 전 구글 시트 kv 탭을 자동으로 백업합니다 (kv_backup_날짜시간 탭 생성).\n계속할까요?"}
          confirmLabel="실행"
          onConfirm={async () => { setConfirmBulkApply(false); await doBulkTestApply(); }}
          onCancel={() => setConfirmBulkApply(false)}
        />
      )}

      {confirmDeleteContent && (
        <ConfirmModal
          title="데이터 삭제 확인"
          message={`'${confirmDeleteContent.name}'의 현재 신청 정보와 매칭 결과를 모두 삭제하시겠습니까?\n삭제된 정보는 복구할 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={async () => { const c = confirmDeleteContent; setConfirmDeleteContent(null); await doDeleteContentData(c); }}
          onCancel={() => setConfirmDeleteContent(null)}
        />
      )}
    </div>
  );
}

/* ============================================================
   관리자 셸 + 루트
   ============================================================ */
const NAV_ITEMS = [
  { key: "dashboard", label: "대시보드" },
  { key: "jobs", label: "직업 관리" },
  { key: "contents", label: "콘텐츠 관리" },
  { key: "applications", label: "신청 현황" },
  { key: "matching", label: "자동 매칭" },
  { key: "data", label: "데이터 관리" },
  { key: "password", label: "비밀번호 관리" },
];

function AdminShell({ config, setConfig }) {
  const [view, setView] = useState("dashboard");
  const [reps, setReps] = useState({});
  const [resultsMeta, setResultsMeta] = useState({});
  const [refreshing, setRefreshing] = useState(true);
  const [toast, setToast] = useState("");

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(""), 2400); }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [r, meta] = await Promise.all([loadAllReps(), loadResultsMeta(config.contents)]);
    setReps(r);
    setResultsMeta(meta);
    setRefreshing(false);
  }, [config.contents]);

  useEffect(() => { refresh(); }, [refresh]);

  // 48시간 자동 삭제: 앱이 열려 있는 동안 주기적으로 만료 여부를 확인합니다.
  useEffect(() => {
    const t = setInterval(async () => {
      const now = Date.now();
      const expired = config.contents.filter((c) => {
        const meta = resultsMeta[c.id];
        return meta && now - meta.generatedAt >= RETENTION_MS;
      });
      if (expired.length === 0) return;
      for (const c of expired) await purgeContentData(c);
      showToast(`자동 매칭 후 48시간이 지나 ${expired.map((c) => c.name).join(", ")}의 신청/매칭 데이터가 자동 삭제되었습니다.`);
      await refresh();
    }, 60000);
    return () => clearInterval(t);
  }, [config.contents, resultsMeta, refresh, showToast]);

  function updateConfig(patch) {
    const next = { ...config, ...patch };
    setConfig(next);
    storageSet("guild-config", next, true);
  }
  function excludeCharacter(repName, appId, characterId) {
    const data = reps[repName];
    if (!data) return;
    const apps = data.applications.map((a) => {
      if (a.id !== appId) return a;
      const nextIds = a.characterIds.filter((id) => id !== characterId);
      return nextIds.length === 0 ? { ...a, characterIds: nextIds, status: "cancelled" } : { ...a, characterIds: nextIds };
    });
    const next = { ...data, applications: apps };
    setReps({ ...reps, [repName]: next });
    storageSet(`rep:${repName}`, next, true);
    showToast("캐릭터를 신청에서 제외했습니다.");
  }

  function updateCharacterAdmin(repName, updatedChar) {
    const data = reps[repName];
    if (!data) return;
    const next = { ...data, subs: (data.subs || []).map((c) => (c.id === updatedChar.id ? updatedChar : c)) };
    setReps({ ...reps, [repName]: next });
    storageSet(`rep:${repName}`, next, true);
    showToast("캐릭터 정보를 수정했습니다.");
  }

  function deleteCharacterAdmin(repName, characterId) {
    const data = reps[repName];
    if (!data) return;
    const next = { ...data, subs: (data.subs || []).filter((c) => c.id !== characterId) };
    setReps({ ...reps, [repName]: next });
    storageSet(`rep:${repName}`, next, true);
    showToast("캐릭터를 삭제했습니다.");
  }

  return (
    <div className="gpa-frame">
      <div className="gpa-header">
        <div className="gpa-brand">
          <span className="gpa-brand-badge">ADMIN</span>
          <span className="gpa-brand-title">길드 파티 매칭 · 관리자</span>
        </div>
        <a href="/" className="gpa-btn gpa-btn-ghost gpa-btn-sm" style={{ textDecoration: "none" }}>← 사용자 화면</a>
      </div>
      <div className="gpa-nav">
        {NAV_ITEMS.map((n) => <button key={n.key} className={`gpa-nav-item ${view === n.key ? "active" : ""}`} onClick={() => setView(n.key)}>{n.label}</button>)}
      </div>

      {view === "dashboard" && <Dashboard config={config} reps={reps} resultsMeta={resultsMeta} onRefresh={refresh} refreshing={refreshing} />}
      {view === "jobs" && <JobsView jobs={config.jobs} onChange={(jobs) => updateConfig({ jobs })} />}
      {view === "contents" && <ContentsView contents={config.contents} onChange={(contents) => updateConfig({ contents })} onToast={showToast} onAfterDelete={refresh} />}
      {view === "applications" && <ApplicationsView contents={config.contents} reps={reps} onExcludeCharacter={excludeCharacter} />}
      {view === "matching" && <MatchingView contents={config.contents} reps={reps} onToast={showToast} onDataChanged={refresh} />}
      {view === "data" && <DataView contents={config.contents} jobs={config.jobs} resultsMeta={resultsMeta} reps={reps} onUpdateCharacter={updateCharacterAdmin} onDeleteCharacter={deleteCharacterAdmin} onToast={showToast} onAfterDelete={refresh} />}
      {view === "password" && <PasswordView config={config} onChange={updateConfig} onToast={showToast} />}

      <Toast message={toast} />
    </div>
  );
}

export default function GuildPartyMatcherAdmin() {
  const [config, setConfig] = useState(null);
  const [authed, setAuthed] = useState(() => {
    try { return sessionStorage.getItem("gpa-admin-authed") === "true"; } catch (e) { return false; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let done = false;
    const fallback = setTimeout(() => {
      if (!done) { done = true; setConfig({ password: "1234", adminPassword: "admin1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS }); setLoading(false); }
    }, 4000);
    (async () => {
      const cfg = await loadGuildConfig();
      if (!done) { done = true; clearTimeout(fallback); setConfig(cfg); setLoading(false); }
    })();
    return () => clearTimeout(fallback);
  }, []);

  if (loading || !config) {
    return <div className="gpa-root"><GlobalStyle /><div className="gpa-gate-wrap"><div style={{ color: "var(--text-dim)", fontSize: 13 }}>불러오는 중...</div></div></div>;
  }

  return (
    <div className="gpa-root">
      <GlobalStyle />
      {!authed ? (
        <AdminGate config={config} onEnter={() => setAuthed(true)} />
      ) : (
        <div className="gpa-scroll"><AdminShell config={config} setConfig={setConfig} /></div>
      )}
    </div>
  );
}
