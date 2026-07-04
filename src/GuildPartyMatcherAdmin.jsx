import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { storageGet, storageSet, storageDelete, storageListWithValues, storageGetSafe, pullFromSheets, backupKv, storageSetMany, syncMirror } from "./lib/storage";

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
    .gpa-badge.combo { background: linear-gradient(90deg, rgba(76,113,150,0.18), rgba(181,140,74,0.18)); color: var(--text); }

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
    .gpa-slot-tag-support { color: var(--warn); font-weight: 700; }
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
// 신청 유형: "normal" | "support" | "both" (일반+지원, 12.4절). 기존 데이터는 normal/support만 가짐(하위 호환).
const APP_TYPE_LABEL = { normal: "일반", support: "지원", both: "일반+지원" };
const appliesNormal = (type) => type === "normal" || type === "both";
const appliesSupport = (type) => type === "support" || type === "both";
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


async function loadGuildConfig() {
  const result = await storageGetSafe("guild-config", true);
  const defaults = { password: "1234", adminPassword: "admin1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS };

  if (result.failed) {
    // 조회 자체가 실패한 경우입니다 — 값이 원래 없는 것인지 알 수 없으므로 절대 덮어쓰지 않습니다.
    // [Unverified] 아래는 화면에 임시로 기본값을 보여주는 예상 동작이며, 저장(overwrite)은 하지 않습니다.
    // 실제로 guild-config가 사라진 것인지는 이 결과만으로 확정할 수 없습니다.
    return { ...defaults, _loadFailed: true };
  }

  let cfg;
  if (result.value === null) {
    // 진짜로 처음 만드는 경우에만 기본값을 시드로 저장합니다.
    cfg = { ...defaults };
    await storageSet("guild-config", cfg, true);
  } else {
    try { cfg = JSON.parse(result.value); } catch (e) { cfg = { ...defaults }; }
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
  const items = [];
  for (const row of rows) {
    if (!row.value) continue;
    let data;
    try { data = JSON.parse(row.value); } catch (e) { continue; }
    const apps = (data.applications || []).filter((a) => a.contentId !== content.id);
    if (apps.length !== (data.applications || []).length) items.push({ key: row.key, value: { ...data, applications: apps }, shared: true });
  }
  await storageSetMany(items, { skipMirror: true });
  await storageDelete(`results:${content.id}`, true);
  await syncMirror();
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
 * 자동 매칭 알고리즘 (요청 문서 5·6·10·11절 반영)
 *
 * [Inference/Unverified] 이 알고리즘은 최적해를 보장하지 않는 휴리스틱입니다.
 * 길드원 50명 미만 소규모 운영을 기준으로, 정수계획법(ILP)이나 완전탐색 대신
 * "그리디 배치 + 제한된 지역탐색(local search)"을 사용합니다. 아래는 기대되는
 * 동작이며, 모든 신청 조합에서 전역 최적 균형을 보장하지는 않습니다.
 *
 * 처리 순서:
 * 1) 일반 신청 캐릭터의 시간 배정을 역할별 시간대 부하 분산으로 1차 결정
 *    (동일 대표 캐릭터는 같은 시간에 1명만 — 신청한 시간 범위 안에서만 배정)
 * 2) 시간대별 파티 수 = ceil(그 시간대 일반 딜러 수 ÷ 딜러 슬롯 수) — 딜러 기준으로만 산정
 * 3) 각 시간대 안에서, 전투력이 가장 낮은 파티부터 채우는 그리디 빈 패킹으로 배치
 *    (탱커·서포터·딜러 모두 동일한 방식 적용). 초과 탱커는 딜러 자리로 합류, 초과 서포터는 미배정.
 * 4) 같은 역할·서로 다른 시간 사이에서, 각 캐릭터가 실제로 신청한 시간 범위 안에서만
 *    스왑을 시도해 파티 평균 전투력의 표준편차가 줄어들면 교환 (제한된 횟수)
 * 5) 지원 신청자로 남은 빈자리를, 전체 평균에 가장 가깝게 만드는 자리부터 채움
 */
function runAutoMatch(content, reps) {
  const dealerSlots = Math.max(content.partySize - 2, 0);
  const slotOrder = ["tank", "support", ...Array(dealerSlots).fill("dealer")];
  const allTimes = timeSlots(content.startTime, content.endTime, content.interval);
  const candidates = buildCandidates(content, reps);
  const unassigned = [];

  const normalChars = groupCandidatesByChar(candidates.filter((c) => appliesNormal(c.type)));
  const supportCandidatesRaw = candidates.filter((c) => appliesSupport(c.type));

  /* ---- 1단계: 일반 신청 캐릭터의 시간 배정 (역할별 시간대 부하 분산, 신청한 시간 범위 안에서만) ----
     딜러를 먼저 배치해 "딜러 있는 시간"을 결정한 뒤, 탱커·서포터는 그 시간을 우선 배정
     시도합니다. 딜러 없는 시간에 탱커·서포터가 배정된 채 조용히 사라지는 버그를 막기
     위한 규칙입니다(딜러없는시간대 버그수정 요청, 2.1절). */
  const roleCountAtTime = {};
  allTimes.forEach((t) => (roleCountAtTime[t] = { tank: 0, support: 0, dealer: 0 }));
  const repTimeUsed = {}; // repName -> Set(이미 배정된 시간)
  const placedNormal = []; // {repName, char, role, time, allowedTimes, type}

  function placeNormalTime({ repName, char, times, types }, compareFn) {
    const appType = types.includes("both") ? "both" : "normal";
    if (!repTimeUsed[repName]) repTimeUsed[repName] = new Set();
    const candidateTimes = times.filter((t) => !repTimeUsed[repName].has(t));
    if (candidateTimes.length === 0) {
      unassigned.push({ repName, char, type: appType, time: times[0], reason: "동일 대표 캐릭터가 신청한 시간에 모두 이미 배정됨" });
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

  /* 딜러 집중 배치 (지원강캐우선_딜러집중배치 통합 요청, 요청②): 새 시간대를 만들기보다
     이미 딜러가 있고 파티가 덜 찬 시간대의 빈 딜러 슬롯을 먼저 채웁니다.
     우선순위: 1) 부분 파티가 있는 시간(딜러 수 % 딜러슬롯 !== 0, 잔여 슬롯 적은 순)
     2) 이미 딜러가 있는 시간(파티는 꽉 참) 3) 딜러가 아예 없는 시간(기존 부하 분산 유지).
     dealerSlots가 0인 콘텐츠는 이 로직을 적용하지 않고 기존 방식을 그대로 씁니다. */
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

  /* 일반+지원(both) 캐릭터는 1단계에서 배정된 시간을 제외한 나머지 신청 시간만
     지원 후보로 남습니다 (12.3절). 1단계에서 아예 배정 실패한 both 캐릭터는
     신청한 시간 전체가 지원 후보로 남습니다 — 사용자가 이 처리 방식을 확정했습니다
     (딜러없는시간대 버그수정 요청, 2.3절). */
  const supportChars = groupCandidatesByChar(supportCandidatesRaw)
    .map((sc) => {
      const normalPlacement = placedNormal.find((p) => p.repName === sc.repName && p.char.id === sc.char.id);
      if (normalPlacement) return { ...sc, times: sc.times.filter((t) => t !== normalPlacement.time) };
      return sc;
    })
    .filter((sc) => sc.times.length > 0);

  /* ---- 2단계: 딜러 신청 수 기준 시간대별 파티 수 산정 (10.3.1절) ---- */
  const partyCountAtTime = {};
  allTimes.forEach((t) => {
    const dealerCount = placedNormal.filter((p) => p.time === t && p.role === "dealer").length;
    partyCountAtTime[t] = dealerCount > 0 ? Math.ceil(dealerCount / Math.max(dealerSlots, 1)) : 0;
  });

  /* ---- 3단계: 시간대별 그리디 빈 패킹 배치 ----
     역할 초과분 교차배정 규칙 (초과분_교차배정_재정의 요청, 1.1절 — 사용자 확정):
     - 서포터 슬롯은 서포터만 채울 수 있음
     - 딜러 슬롯은 [딜러 + 초과탱커 + 초과서포터] 전투력 순 혼합 풀로 채움 (역할 우선순위 없음)
     - 빈 탱커 슬롯(탱커 수 < 파티 수)은 남은 [초과딜러 + 초과서포터] 전투력 순 혼합으로 채움
     - 서포터 초과분은 파티를 새로 만들지 않고, 채울 슬롯이 없으면 사유와 함께 미배정 */
  const partiesByKey = {}; // `${time}:${partyNumber}` -> party
  const placedSlotOf = {}; // `${repName}:${characterId}` -> {time, partyNumber, slotIndex}

  function fillPartiesCrossAssign(t, parties, tanksIn, supportsIn, dealersIn) {
    function place(entry, slotRole) {
      let best = -1, bestSum = Infinity;
      parties.forEach((p, i) => {
        const idx = p.slots.findIndex((s) => !s.nickname && s.role === slotRole);
        if (idx === -1) return;
        if (p._powerSum < bestSum) { bestSum = p._powerSum; best = i; }
      });
      if (best === -1) return false;
      const p = parties[best];
      const idx = p.slots.findIndex((s) => !s.nickname && s.role === slotRole);
      const power = charFinalPower(entry.char, content);
      // 슬롯의 role은 이제 "이 자리에 배정된 캐릭터의 실제 역할"을 그대로 반영합니다.
      // 즉 원래 딜러 슬롯이었어도 탱커가 교차배정되면 role이 "tank"로 바뀌어 표시됩니다
      // (예: 딜러3·서포터1·탱커1 구성이 교차배정 후 탱커2·딜러2·서포터1로 보일 수 있음).
      p.slots[idx] = { role: entry.role, nickname: entry.char.nickname, repName: entry.repName, characterId: entry.char.id, type: "normal" };
      p._powerSum += power; p._filledCount++;
      placedSlotOf[`${entry.repName}:${entry.char.id}`] = { time: t, partyNumber: p.partyNumber, slotIndex: idx };
      return true;
    }

    const byPowerDesc = (a, b) => charFinalPower(b.char, content) - charFinalPower(a.char, content);
    const sortedSupports = [...supportsIn].sort(byPowerDesc);
    const sortedTanks = [...tanksIn].sort(byPowerDesc);

    // 서포터: 서포터 슬롯 전용, 파티 수만큼만. 초과분은 딜러 풀로 넘어감(파티는 새로 안 만듦).
    const primarySupports = sortedSupports.slice(0, parties.length);
    const excessSupports = sortedSupports.slice(parties.length);
    primarySupports.forEach((entry) => { if (!place(entry, "support")) excessSupports.push(entry); });

    // 탱커: 탱커 슬롯 전용, 파티 수만큼만. 초과분은 딜러 풀로.
    const primaryTanks = sortedTanks.slice(0, parties.length);
    const excessTanks = sortedTanks.slice(parties.length);
    primaryTanks.forEach((entry) => { if (!place(entry, "tank")) excessTanks.push(entry); });

    // 딜러 슬롯: [딜러 + 초과탱커 + 초과서포터] 전투력 순 혼합 (역할 우선순위 없음)
    const dealerPool = [...dealersIn, ...excessTanks, ...excessSupports].sort(byPowerDesc);
    const leftoverAfterDealer = [];
    dealerPool.forEach((entry) => { if (!place(entry, "dealer")) leftoverAfterDealer.push(entry); });

    // 빈 탱커 슬롯: 남은 [초과딜러 + 초과서포터](leftoverAfterDealer)로 채움
    leftoverAfterDealer.sort(byPowerDesc);
    const stillLeftover = [];
    leftoverAfterDealer.forEach((entry) => { if (!place(entry, "tank")) stillLeftover.push(entry); });

    stillLeftover.forEach((entry) => unassigned.push({ ...entry, reason: "역할 자리 부족" }));
  }

  allTimes.forEach((t) => {
    const partyCount = partyCountAtTime[t];
    const atTime = placedNormal.filter((p) => p.time === t);

    if (partyCount === 0) {
      /* 딜러 0명 시간대 (딜러없는시간대 버그수정 요청, 2.2절 — 사용자 확정 공식).
         탱커 2명 이상이면 탱커를 딜러 자리에도 채용해 파티를 만들고,
         1명 이하면 파티를 만들지 않고 사유와 함께 미배정으로 보냅니다. */
      const tanksHere = atTime.filter((p) => p.role === "tank");
      const supportsHere = atTime.filter((p) => p.role === "support");
      const noDealerReason = "이 시간대에 딜러 신청이 없어 파티가 생성되지 않음";

      // 사용자 확정 공식: min(ceil(탱커 ÷ (1+딜러슬롯)), floor(탱커 ÷ 2))
      const tankPartyCount = tanksHere.length >= 2
        ? Math.min(Math.ceil(tanksHere.length / (1 + dealerSlots)), Math.floor(tanksHere.length / 2))
        : 0;

      if (tankPartyCount === 0) {
        tanksHere.forEach((entry) => unassigned.push({ ...entry, reason: noDealerReason }));
        supportsHere.forEach((entry) => unassigned.push({ ...entry, reason: noDealerReason }));
        return;
      }

      const tParties = Array.from({ length: tankPartyCount }, (_, i) => ({
        time: t, partyNumber: i + 1,
        slots: slotOrder.map((role) => ({ role, nickname: null, repName: null, characterId: null, type: null })),
        _powerSum: 0, _filledCount: 0,
      }));
      tParties.forEach((p) => (partiesByKey[`${t}:${p.partyNumber}`] = p));

      // 이 시간대엔 딜러 신청 자체가 없으므로(파티수 0의 정의), 딜러 풀은 빈 배열로 전달합니다.
      fillPartiesCrossAssign(t, tParties, tanksHere, supportsHere, []);
      return;
    }

    const parties = Array.from({ length: partyCount }, (_, i) => ({
      time: t, partyNumber: i + 1,
      slots: slotOrder.map((role) => ({ role, nickname: null, repName: null, characterId: null, type: null })),
      _powerSum: 0, _filledCount: 0,
    }));
    parties.forEach((p) => (partiesByKey[`${t}:${p.partyNumber}`] = p));

    const tanks = atTime.filter((p) => p.role === "tank");
    const supports = atTime.filter((p) => p.role === "support");
    const dealersRaw = atTime.filter((p) => p.role === "dealer");
    fillPartiesCrossAssign(t, parties, tanks, supports, dealersRaw);
  });

  /* ---- 4단계: 같은 역할·서로 다른 시간 사이의 지역 탐색 (신청한 시간 범위 안에서만 스왑) ---- */
  function partyAverages() {
    return Object.values(partiesByKey).filter((p) => p._filledCount > 0).map((p) => p._powerSum / p._filledCount);
  }
  function objective() { return stdev(partyAverages()); }

  const placedList = Object.entries(placedSlotOf).map(([key, loc]) => {
    const [repName, characterId] = key.split(":");
    const info = placedNormal.find((p) => p.repName === repName && p.char.id === characterId);
    return { repName, characterId, role: info.char.role, loc, allowedTimes: info.allowedTimes, char: info.char };
  });

  const MAX_SWAP_ITER = 300;
  let improved = true, iter = 0;
  while (improved && iter < MAX_SWAP_ITER) {
    improved = false;
    iter++;
    outer:
    for (let i = 0; i < placedList.length; i++) {
      for (let j = i + 1; j < placedList.length; j++) {
        const a = placedList[i], b = placedList[j];
        if (a.role !== b.role || a.loc.time === b.loc.time) continue;
        if (!a.allowedTimes.includes(b.loc.time) || !b.allowedTimes.includes(a.loc.time)) continue;
        const collideA = placedList.some((x) => x !== a && x.repName === a.repName && x.loc.time === b.loc.time);
        const collideB = placedList.some((x) => x !== b && x.repName === b.repName && x.loc.time === a.loc.time);
        if (collideA || collideB) continue;

        const partyA = partiesByKey[`${a.loc.time}:${a.loc.partyNumber}`];
        const partyB = partiesByKey[`${b.loc.time}:${b.loc.partyNumber}`];
        const slotA = partyA.slots[a.loc.slotIndex];
        const slotB = partyB.slots[b.loc.slotIndex];
        // 슬롯의 role은 이제 실제 배정된 캐릭터의 역할을 그대로 반영하므로(교차배정 포함),
        // a.role === b.role(위에서 이미 확인)이면 slotA.role === slotB.role도 항상 성립합니다.
        // 그래서 별도의 자리 종류 일치 검사는 더 이상 필요 없습니다.
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

  /* ---- 5단계: 지원 신청자로 남은 빈자리 채우기 ----
     전투력 높은 지원자부터 순서대로 배정합니다 — "누구를 먼저 배정하나"는 전투력
     내림차순, "어느 자리에 넣나"는 기존과 동일한 균형 점수(전체 평균에 가장
     가까워지는 자리)입니다. 아직 한 번도 배정되지 않은 지원자 전원이 1회씩
     기회를 가진 뒤(패스1)에만 반복 배정(패스2 이상)을 허용합니다.
     (지원강캐우선_딜러집중배치 통합 요청, 요청①) */
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
    let bestIdx = -1, bestScore = Infinity;
    emptySlots.forEach((es, idx) => {
      if (es.party.slots[es.slotIndex].nickname) return;
      // 서포터 슬롯은 서포터만, 탱커·딜러 슬롯은 역할 무관하게 교차 배정 가능 (1.2절, 사용자 확정 — 변경 금지 범위)
      if (es.role === "support" && sc.char.role !== "support") return;
      if (!sc.times.includes(es.party.time)) return;
      if (repTimeOccupied[`${sc.repName}:${es.party.time}`]) return;
      const power = charFinalPower(sc.char, content);
      const newAvg = (es.party._powerSum + power) / (es.party._filledCount + 1);
      const score = Math.abs(newAvg - target);
      if (score < bestScore) { bestScore = score; bestIdx = idx; }
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
    let subCount = 0, appCount = 0, normalCount = 0, supportCount = 0, comboCount = 0;
    repNames.forEach((n) => {
      subCount += (reps[n].subs || []).length;
      (reps[n].applications || []).forEach((a) => {
        if (a.status === "cancelled") return;
        appCount++;
        if (appliesNormal(a.type)) normalCount++;
        if (appliesSupport(a.type)) supportCount++;
        if (a.type === "both") comboCount++;
      });
    });
    return { repCount: repNames.length, subCount, appCount, normalCount, supportCount, comboCount };
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
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.normalCount}</div><div className="gpa-stat-label">일반 신청 (일반+지원 포함)</div></div>
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.supportCount}</div><div className="gpa-stat-label">지원 신청 (일반+지원 포함)</div></div>
        <div className="gpa-stat-card"><div className="gpa-stat-num">{stats.comboCount}</div><div className="gpa-stat-label">일반+지원 조합</div></div>
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
      if (typeFilter === "normal" && !appliesNormal(r.app.type)) return false;
      if (typeFilter === "support" && !appliesSupport(r.app.type)) return false;
      if (typeFilter === "both" && r.app.type !== "both") return false;
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
    normal: allRows.filter((r) => appliesNormal(r.app.type)).length,
    support: allRows.filter((r) => appliesSupport(r.app.type)).length,
    both: allRows.filter((r) => r.app.type === "both").length,
  }), [allRows]);

  return (
    <div>
      <div className="gpa-section-title"><div><h2>신청 현황</h2><div className="gpa-section-desc">콘텐츠별 신청 데이터를 캐릭터 단위로 확인합니다. (전체 {counts.total}건 · 일반 {counts.normal} · 지원 {counts.support} · 일반+지원 {counts.both})</div></div></div>
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
              <option value="all">전체</option><option value="normal">일반 (일반+지원 포함)</option><option value="support">지원 (일반+지원 포함)</option><option value="both">일반+지원만</option>
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
                      <td><span className={`gpa-badge ${app.type === "both" ? "combo" : app.type === "normal" ? "normal" : "supportApp"}`}>{APP_TYPE_LABEL[app.type] || app.type}</span></td>
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
                <span style={{ color: "var(--text-faint)" }}>{APP_TYPE_LABEL[c.type] || c.type}</span>
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
    const normal = candidates.filter((c) => appliesNormal(c.type)).length;
    const support = candidates.filter((c) => appliesSupport(c.type)).length;
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
    const items = [];
    for (const row of rows) {
      if (!row.value) continue;
      let data;
      try { data = JSON.parse(row.value); } catch (e) { continue; }
      let changed = false;
      const apps = (data.applications || []).map((a) => {
        if (a.contentId === content.id && a.status !== "cancelled") { changed = true; return { ...a, status }; }
        return a;
      });
      if (changed) items.push({ key: row.key, value: { ...data, applications: apps }, shared: true });
    }
    await storageSetMany(items, { skipMirror: true });
    await syncMirror();
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
    // 같은 대표 캐릭터가 이미 이 파티의 다른 자리에 있으면 배정을 막습니다 (드래그드롭 중복배정 방지 요청).
    if (newSlotValue.repName) {
      const targetParty = matchData.parties[partyIdx];
      const conflict = targetParty.slots.some((s, si) => si !== slotIdx && s.repName === newSlotValue.repName);
      if (conflict) { onToast("같은 대표 캐릭터의 다른 캐릭터가 이미 이 파티에 있어 배정할 수 없습니다."); return; }
    }
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
    // 같은 대표 캐릭터가 이동 결과로 한 파티에 같이 있게 되면 막습니다 (드래그드롭 중복배정 방지 요청).
    if (sourcePartyIdx !== targetPartyIdx) {
      const targetParty = matchData.parties[targetPartyIdx];
      const sourceParty = matchData.parties[sourcePartyIdx];
      const conflictAtTarget = sourceSlot.repName && targetParty.slots.some((s, si) => si !== targetSlotIdx && s.repName === sourceSlot.repName);
      const conflictAtSource = targetSlot.repName && sourceParty.slots.some((s, si) => si !== sourceSlotIdx && s.repName === targetSlot.repName);
      if (conflictAtTarget || conflictAtSource) { onToast("같은 대표 캐릭터의 다른 캐릭터가 이미 그 파티에 있어 이동할 수 없습니다."); return; }
    }
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
          <div className="gpa-stat-card"><div className="gpa-stat-num">{preview.normal}</div><div className="gpa-stat-label">일반 신청 후보 (일반+지원 포함)</div></div>
          <div className="gpa-stat-card"><div className="gpa-stat-num">{preview.support}</div><div className="gpa-stat-label">지원 신청 후보 (일반+지원 포함)</div></div>
        </div>
        <div className="gpa-row" style={{ marginTop: 16 }}>
          <button className="gpa-btn gpa-btn-primary" onClick={runMatch} disabled={preview.candidateCount === 0}>{matchData ? "재매칭 실행" : "자동 매칭 실행"}</button>
          {matchData && (
            <button className="gpa-btn gpa-btn-ghost" onClick={togglePublish}>{matchData.published ? "결과 비공개로 전환" : "결과 공개하기"}</button>
          )}
          {matchData && matchData.parties.length > 0 && (
            <button className="gpa-btn gpa-btn-ghost" onClick={downloadResultsImage} disabled={downloadingImage}>{downloadingImage ? "이미지 생성 중..." : "이미지로 다운로드"}</button>
          )}
          <button
            className="gpa-btn gpa-btn-ghost"
            disabled={loadingResult}
            onClick={async () => { await loadResult(); if (onDataChanged) await onDataChanged(); onToast("새로고침했습니다."); }}
          >
            {loadingResult ? "새로고침 중..." : "새로고침"}
          </button>
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
                          {s.nickname ? <span className="gpa-slot-name">{s.nickname}{s.type === "temp" && <span className="gpa-slot-tag"> · 임시</span>}{s.type === "support" && <span className="gpa-slot-tag gpa-slot-tag-support"> · 지원</span>}</span> : <span className="gpa-slot-empty">빈자리</span>}
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
        const typeRoll = Math.random();
        const type = typeRoll < 0.34 ? "normal" : typeRoll < 0.67 ? "support" : "both";
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
          현재 등록된 전체 캐릭터가, 활성화된 모든 콘텐츠에 각각 신청합니다. 캐릭터×콘텐츠 조합마다 신청 유형(일반/지원/일반+지원)은 무작위, 신청 시간은 해당 콘텐츠의 가능한 시간대 중 2~3개를 무작위로 선택합니다.
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
    delete next._loadFailed; // 저장용 값에는 내부 상태 표시가 섞이면 안 됩니다.
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
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fallback = setTimeout(() => {
      // 4초 안에 응답이 없으면 일단 화면은 띄우되(스피너만 해제), 실제 결과가 오면
      // 아래 (async () => {...})()가 나중에 도착해서 이 임시값을 덮어씁니다 — 늦게 온
      // 진짜 결과를 조용히 버리지 않습니다.
      if (!cancelled) {
        setConfig((prev) => prev || { password: "1234", adminPassword: "admin1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS, _loadFailed: true });
        setLoading(false);
      }
    }, 4000);
    (async () => {
      const cfg = await loadGuildConfig();
      if (!cancelled) {
        clearTimeout(fallback);
        setConfig(cfg);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(fallback); };
  }, [retryTick]);

  if (loading || !config) {
    return <div className="gpa-root"><GlobalStyle /><div className="gpa-gate-wrap"><div style={{ color: "var(--text-dim)", fontSize: 13 }}>불러오는 중...</div></div></div>;
  }

  if (config._loadFailed) {
    // 실제 설정을 못 받아온 상태입니다. 여기서 화면을 계속 쓰게 두면, 임시 기본값을
    // 보면서 저장 버튼을 눌러 실제 데이터를 덮어쓸 위험이 있으므로 아예 막습니다.
    return (
      <div className="gpa-root">
        <GlobalStyle />
        <div className="gpa-gate-wrap">
          <div className="gpa-gate-card" style={{ textAlign: "center" }}>
            <h1 className="gpa-gate-title">설정을 불러오지 못했습니다</h1>
            <p className="gpa-gate-desc">
              구글 시트 연결이 일시적으로 실패한 것 같습니다. 이 상태로 진행하면 실제 저장된 직업·콘텐츠 설정 대신 임시 기본값이 보일 수 있어 화면을 막아뒀습니다.
            </p>
            <button type="button" className="gpa-btn gpa-btn-primary" style={{ width: "100%" }} onClick={() => { setConfig(null); setLoading(true); setRetryTick((x) => x + 1); }}>다시 시도</button>
          </div>
        </div>
      </div>
    );
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
