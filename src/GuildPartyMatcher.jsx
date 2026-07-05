import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Shield, Swords, HeartPulse } from "lucide-react";
import { storageGet, storageSet, storageGetSafe } from "./lib/storage";

/* ============================================================
   길드 파티 매칭 툴 — 사용자 화면 프로토타입
   기획서 1장(사용자 화면) 전체 흐름을 구현한 인터랙티브 프로토타입입니다.
   - 관리자 화면은 아직 없으므로 직업/콘텐츠 목록은 예시 데이터로 시드합니다.
   - 데이터는 window.storage(shared)에 저장되어 같은 길드원끼리 공유됩니다.
   ============================================================ */

/* ---------------- 디자인 토큰 ---------------- */
const GlobalStyle = () => (
  <style>{`
    .gpm-root {
      --bg: #F7F5F0;
      --bg-elev: #FFFFFF;
      --surface: #FFFFFF;
      --surface-2: #F0ECE3;
      --border: #E4DFD3;
      --border-soft: #ECE7DB;
      --text: #2B2822;
      --text-dim: #6E6A5E;
      --text-faint: #A19C8C;
      --gold: #C15F3C;
      --gold-soft: #D97757;
      --tank: #4C7196;
      --support: #4F7A5B;
      --dealer: #A85A38;
      --danger: #C0392B;
      --success: #4F7A5B;
      --font-display: 'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      --font-body: 'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      --font-mono: 'JetBrains Mono', 'Consolas', monospace;

      all: initial;
      *, *::before, *::after { box-sizing: border-box; }
      display: block;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-body);
      min-height: 100%;
      width: 100%;
      position: relative;
      line-height: 1.5;
      background-image:
        radial-gradient(ellipse 900px 500px at 15% -10%, rgba(193,95,60,0.08), transparent 60%),
        radial-gradient(ellipse 700px 500px at 100% 0%, rgba(76,113,150,0.06), transparent 60%);
    }
    .gpm-root h1, .gpm-root h2, .gpm-root h3, .gpm-root h4 { font-family: var(--font-display); margin: 0; color: var(--text); letter-spacing: 0.01em; }
    .gpm-root p { margin: 0; }
    .gpm-root button { font-family: var(--font-body); cursor: pointer; }
    .gpm-root input, .gpm-root select { font-family: var(--font-body); }
    .gpm-root ::selection { background: rgba(193,95,60,0.35); }

    .gpm-scroll { min-height: 100vh; padding: 28px 18px 80px; display: flex; flex-direction: column; align-items: center; }
    .gpm-frame { width: 100%; max-width: 720px; }

    /* --- 공통: 상단 브랜드 --- */
    .gpm-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; }
    .gpm-emblem { flex-shrink: 0; }
    .gpm-brand-text { display: flex; flex-direction: column; }
    .gpm-brand-title { font-family: var(--font-display); font-size: 15px; color: var(--gold-soft); letter-spacing: 0.08em; }
    .gpm-brand-sub { font-size: 11px; color: var(--text-faint); letter-spacing: 0.05em; }

    /* --- 카드 --- */
    .gpm-card { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 14px; padding: 26px; box-shadow: 0 1px 2px rgba(43,40,34,0.04), 0 12px 28px -20px rgba(43,40,34,0.12); }
    .gpm-card + .gpm-card { margin-top: 14px; }

    /* --- 게이트(입장/대표캐릭터) 화면 --- */
    .gpm-gate-wrap { min-height: 92vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; }
    .gpm-gate-card { width: 100%; max-width: 420px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 18px; padding: 40px 32px; box-shadow: 0 1px 2px rgba(43,40,34,0.04), 0 20px 44px -24px rgba(43,40,34,0.16); position: relative; overflow: hidden; }
    .gpm-gate-card::before { content: ''; position: absolute; top: -60px; right: -60px; width: 180px; height: 180px; border-radius: 50%; background: radial-gradient(circle, rgba(193,95,60,0.18), transparent 70%); pointer-events: none; z-index: 0; }
    .gpm-gate-card > * { position: relative; z-index: 1; }
    .gpm-gate-emblem { display: flex; justify-content: center; margin-bottom: 18px; }
    .gpm-gate-title { text-align: center; font-size: 22px; color: var(--gold-soft); margin-bottom: 6px; }
    .gpm-gate-desc { text-align: center; font-size: 12.5px; color: var(--text-dim); margin-bottom: 26px; line-height: 1.6; }
    .gpm-steps { display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 22px; }
    .gpm-step-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); transition: all .2s; }
    .gpm-step-dot.active { background: var(--gold); width: 18px; border-radius: 3px; }

    .gpm-field { margin-bottom: 16px; }
    .gpm-label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 7px; letter-spacing: 0.02em; }
    .gpm-input { width: 100%; background: var(--bg-elev); border: 1px solid var(--border); color: var(--text); padding: 12px 14px; border-radius: 9px; font-size: 14.5px; outline: none; transition: border-color .15s, box-shadow .15s; }
    .gpm-input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(193,95,60,0.15); }
    .gpm-input::placeholder { color: var(--text-faint); }
    .gpm-input.error { border-color: var(--danger); }
    .gpm-error-text { color: var(--danger); font-size: 11.5px; margin-top: 6px; }
    .gpm-hint-text { color: var(--text-faint); font-size: 11.5px; margin-top: 6px; }

    .gpm-btn { border: none; border-radius: 9px; padding: 12px 18px; font-size: 14px; font-weight: 600; transition: transform .12s, filter .12s, background .12s; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .gpm-btn:active { transform: translateY(1px); }
    .gpm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .gpm-btn-primary { background: linear-gradient(180deg, var(--gold-soft), var(--gold)); color: #FFFFFF; width: 100%; }
    .gpm-btn-primary:not(:disabled):hover { filter: brightness(1.06); }
    .gpm-btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text-dim); }
    .gpm-btn-ghost:not(:disabled):hover { border-color: var(--gold); color: var(--gold-soft); }
    .gpm-btn-block { width: 100%; }
    .gpm-btn-danger { background: rgba(192,57,43,0.1); color: var(--danger); border: 1px solid rgba(192,57,43,0.3); }
    .gpm-btn-danger:hover { background: rgba(192,57,43,0.2); }
    .gpm-btn-sm { padding: 8px 12px; font-size: 12.5px; border-radius: 7px; }

    .gpm-row { display: flex; gap: 10px; }
    .gpm-recents { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .gpm-recent-chip { font-size: 11.5px; color: var(--text-dim); background: var(--bg-elev); border: 1px solid var(--border-soft); padding: 5px 10px; border-radius: 20px; }
    .gpm-recent-chip:hover { border-color: var(--gold); color: var(--gold-soft); }

    /* --- 앱 셸 --- */
    .gpm-shell-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; gap: 12px; flex-wrap: wrap; }
    .gpm-rep-badge { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border-soft); padding: 7px 12px 7px 8px; border-radius: 30px; }
    .gpm-rep-avatar { width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, var(--gold-soft), var(--gold)); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #FFFFFF; }
    .gpm-rep-name { font-size: 13px; color: var(--text); font-weight: 600; }
    .gpm-rep-tag { font-size: 10px; color: var(--text-faint); }

    .gpm-nav { display: flex; gap: 4px; background: var(--surface); border: 1px solid var(--border-soft); border-radius: 12px; padding: 4px; margin-bottom: 20px; overflow-x: auto; }
    .gpm-nav-item { flex: 1; white-space: nowrap; text-align: center; padding: 9px 10px; border-radius: 9px; font-size: 12.5px; color: var(--text-dim); background: transparent; border: none; font-weight: 600; }
    .gpm-nav-item.active { background: var(--surface-2); color: var(--gold-soft); }
    .gpm-nav-item:hover:not(.active) { color: var(--text); }

    .gpm-section-title { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; gap: 10px; flex-wrap: wrap; }
    .gpm-section-title h2 { font-size: 18px; }
    .gpm-section-desc { font-size: 12px; color: var(--text-faint); margin-top: 3px; }

    .gpm-divider { height: 1px; background: var(--border-soft); margin: 18px 0; }

    /* --- 빈 상태 --- */
    .gpm-empty { text-align: center; padding: 46px 20px; color: var(--text-faint); }
    .gpm-empty-icon { font-size: 26px; margin-bottom: 10px; opacity: 0.6; }
    .gpm-empty-title { color: var(--text-dim); font-size: 13.5px; margin-bottom: 4px; }
    .gpm-empty-desc { font-size: 12px; }

    /* --- 캐릭터 카드 --- */
    .gpm-char-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px,1fr)); gap: 12px; }
    .gpm-char-card { background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 12px; padding: 16px; position: relative; }
    .gpm-char-card.inactive { opacity: 0.45; }
    .gpm-char-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .gpm-char-name { font-size: 14.5px; font-weight: 700; color: var(--text); }
    .gpm-role-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; font-weight: 700; padding: 4px 10px; border-radius: 20px; letter-spacing: 0.02em; }
    .gpm-role-badge.tank { background: rgba(76,113,150,0.12); color: var(--tank); }
    .gpm-role-badge.support { background: rgba(79,122,91,0.12); color: var(--support); }
    .gpm-role-badge.dealer { background: rgba(168,90,56,0.12); color: var(--dealer); }
    .gpm-char-job { font-size: 12px; color: var(--text-dim); margin-bottom: 10px; }
    .gpm-char-stats { display: flex; gap: 14px; margin-bottom: 12px; }
    .gpm-stat { display: flex; flex-direction: column; gap: 2px; }
    .gpm-stat-label { font-size: 10px; color: var(--text-faint); }
    .gpm-stat-value { font-family: var(--font-mono); font-size: 13px; color: var(--text); }
    .gpm-char-actions { display: flex; gap: 6px; }

    .gpm-fab-add { border: 1px dashed var(--border); background: transparent; border-radius: 12px; min-height: 120px; display: flex; align-items: center; justify-content: center; color: var(--text-faint); font-size: 13px; gap: 6px; }
    .gpm-fab-add:hover { border-color: var(--gold); color: var(--gold-soft); }

    /* --- 콘텐츠 카드 --- */
    .gpm-content-card { background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
    .gpm-content-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
    .gpm-content-name { font-family: var(--font-display); font-size: 16px; }
    .gpm-status-pill { font-size: 10.5px; padding: 4px 10px; border-radius: 20px; font-weight: 700; white-space: nowrap; }
    .gpm-status-pill.open { background: rgba(79,122,91,0.15); color: var(--success); }
    .gpm-status-pill.closed { background: rgba(143,138,126,0.2); color: var(--text-faint); }
    .gpm-content-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px,1fr)); gap: 10px; }
    .gpm-meta-item { display: flex; flex-direction: column; gap: 2px; }
    .gpm-meta-label { font-size: 10.5px; color: var(--text-faint); }
    .gpm-meta-value { font-size: 13px; color: var(--text); font-family: var(--font-mono); }

    /* --- 신청 화면 --- */
    .gpm-select-list { display: flex; flex-direction: column; gap: 8px; }
    .gpm-select-row { display: flex; align-items: center; gap: 12px; background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 10px; padding: 12px 14px; transition: border-color .12s; }
    .gpm-select-row.checked { border-color: var(--gold); background: rgba(193,95,60,0.06); }
    .gpm-select-row.disabled { opacity: 0.5; }
    .gpm-checkbox { width: 18px; height: 18px; flex-shrink: 0; border-radius: 5px; border: 1.5px solid var(--border); background: var(--surface); display: flex; align-items: center; justify-content: center; }
    .gpm-checkbox.checked { background: var(--gold); border-color: var(--gold); }
    .gpm-select-info { flex: 1; min-width: 0; }
    .gpm-select-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; flex-wrap: wrap; }
    .gpm-select-name { font-size: 13.5px; font-weight: 700; }
    .gpm-select-sub { font-size: 11.5px; color: var(--text-dim); }
    .gpm-select-warn { font-size: 11px; color: var(--danger); margin-top: 3px; }
    .gpm-select-power { text-align: right; font-family: var(--font-mono); font-size: 13px; color: var(--gold-soft); white-space: nowrap; }
    .gpm-select-power-label { font-size: 9.5px; color: var(--text-faint); display: block; text-align: right; }

    .gpm-time-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .gpm-time-chip { padding: 9px 16px; border-radius: 9px; border: 1px solid var(--border); background: var(--bg-elev); color: var(--text-dim); font-size: 13px; font-family: var(--font-mono); font-weight: 600; }
    .gpm-time-chip.checked { border-color: var(--gold); background: rgba(193,95,60,0.14); color: var(--gold-soft); }

    .gpm-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .gpm-type-card { border: 1px solid var(--border); background: var(--bg-elev); border-radius: 12px; padding: 16px; text-align: left; }
    .gpm-type-card.checked { border-color: var(--gold); background: rgba(193,95,60,0.08); }
    .gpm-type-card:disabled { opacity: 0.45; cursor: not-allowed; }
    .gpm-type-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 7px; }
    .gpm-type-desc { font-size: 11.5px; color: var(--text-dim); line-height: 1.6; }

    .gpm-notice { display: flex; gap: 10px; background: rgba(193,95,60,0.07); border: 1px solid rgba(193,95,60,0.22); border-radius: 10px; padding: 12px 14px; font-size: 12px; color: var(--gold-soft); line-height: 1.6; }

    .gpm-summary-bar { position: sticky; bottom: 16px; margin-top: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: 0 1px 2px rgba(43,40,34,0.04), 0 14px 28px -18px rgba(43,40,34,0.14); flex-wrap: wrap; }
    .gpm-summary-info { font-size: 12px; color: var(--text-dim); }
    .gpm-summary-info b { color: var(--gold-soft); font-weight: 700; }

    /* --- 확인/완료 화면 --- */
    .gpm-review-block { margin-bottom: 16px; }
    .gpm-review-label { font-size: 11px; color: var(--text-faint); margin-bottom: 6px; letter-spacing: 0.03em; }
    .gpm-review-value { font-size: 14px; color: var(--text); }
    .gpm-review-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .gpm-chip { font-size: 12px; background: var(--bg-elev); border: 1px solid var(--border-soft); padding: 5px 10px; border-radius: 7px; color: var(--text); }

    .gpm-done-wrap { text-align: center; padding: 30px 10px 6px; }
    .gpm-done-icon { width: 60px; height: 60px; margin: 0 auto 18px; border-radius: 50%; background: rgba(79,122,91,0.15); display: flex; align-items: center; justify-content: center; }
    .gpm-done-title { font-size: 19px; margin-bottom: 8px; }
    .gpm-done-desc { font-size: 13px; color: var(--text-dim); margin-bottom: 24px; line-height: 1.6; }
    .gpm-done-stats { display: flex; justify-content: center; gap: 22px; margin-bottom: 26px; flex-wrap: wrap; }
    .gpm-done-stat-num { font-family: var(--font-mono); font-size: 20px; color: var(--gold-soft); }
    .gpm-done-stat-label { font-size: 11px; color: var(--text-faint); margin-top: 2px; }

    /* --- 신청 내역 --- */
    .gpm-app-card { background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 12px; padding: 16px 18px; }
    .gpm-app-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
    .gpm-app-content { font-size: 14.5px; font-weight: 700; font-family: var(--font-display); }
    .gpm-app-meta { font-size: 11.5px; color: var(--text-faint); margin-top: 3px; }
    .gpm-status-tag { font-size: 10.5px; padding: 4px 10px; border-radius: 20px; font-weight: 700; white-space: nowrap; }
    .gpm-status-tag.applied { background: rgba(76,113,150,0.15); color: var(--tank); }
    .gpm-status-tag.waiting { background: rgba(193,95,60,0.15); color: var(--gold-soft); }
    .gpm-status-tag.matched { background: rgba(79,122,91,0.15); color: var(--success); }
    .gpm-status-tag.revealed { background: rgba(79,122,91,0.22); color: var(--success); }

    /* --- 매칭 결과 --- */
    .gpm-result-group-title { display: flex; align-items: center; gap: 10px; margin: 22px 0 12px; }
    .gpm-result-group-title h3 { font-size: 15px; color: var(--gold-soft); }
    .gpm-result-group-line { flex: 1; height: 1px; background: var(--border-soft); }
    .gpm-party-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px,1fr)); gap: 12px; }
    .gpm-party-card { background: var(--bg-elev); border: 1px solid var(--border-soft); border-radius: 12px; padding: 16px; }
    .gpm-party-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .gpm-party-num { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }
    .gpm-party-slot { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 12.5px; }
    .gpm-party-slot-role { width: 24px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .gpm-party-slot-role.tank { color: var(--tank); } .gpm-party-slot-role.support { color: var(--support); } .gpm-party-slot-role.dealer { color: var(--dealer); }
    .gpm-party-slot-name { color: var(--text); }
    .gpm-party-slot-empty { color: var(--text-faint); font-style: italic; }
    .gpm-party-short { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-soft); font-size: 11px; color: var(--danger); }

    /* --- 모달 --- */
    .gpm-modal-overlay { position: fixed; inset: 0; background: rgba(6,7,12,0.72); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 100; }
    .gpm-modal { width: 100%; max-width: 440px; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 26px; max-height: 88vh; overflow-y: auto; }
    .gpm-modal-title { font-size: 16px; margin-bottom: 18px; }
    .gpm-modal-actions { display: flex; gap: 10px; margin-top: 20px; }

    /* --- 콤보박스(직업 검색) --- */
    .gpm-combo { position: relative; }
    .gpm-combo-list { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 10px; max-height: 220px; overflow-y: auto; z-index: 10; box-shadow: 0 1px 2px rgba(43,40,34,0.04), 0 14px 28px -16px rgba(43,40,34,0.14); }
    .gpm-combo-opt { padding: 10px 14px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; }
    .gpm-combo-opt:hover { background: var(--surface-2); }
    .gpm-combo-empty { padding: 14px; font-size: 12px; color: var(--text-faint); text-align: center; }

    /* --- 토스트 --- */
    .gpm-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 12px 20px; border-radius: 30px; font-size: 13px; box-shadow: 0 4px 16px -6px rgba(43,40,34,0.22); z-index: 200; }

    @media (max-width: 480px) {
      .gpm-type-grid { grid-template-columns: 1fr; }
      .gpm-char-grid { grid-template-columns: 1fr; }
    }
  `}</style>
);

/* ---------------- 시드 데이터 ---------------- */
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
const ROLE_ICON = { tank: Shield, support: HeartPulse, dealer: Swords };
// 신청 유형: "normal" | "support" | "both" (일반+지원, 12.4절). 기존 데이터는 normal/support만 가짐(하위 호환).
const APP_TYPE_LABEL = { normal: "일반 신청", support: "지원 신청", both: "일반 신청 + 지원 신청" };
const appliesNormal = (type) => type === "normal" || type === "both";
const appliesSupport = (type) => type === "support" || type === "both";

/* ---------------- 유틸 ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function timeSlots(start, end, interval) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let cur = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const out = [];
  while (cur <= endMin) {
    const h = String(Math.floor(cur / 60) % 24).padStart(2, "0");
    const m = String(cur % 60).padStart(2, "0");
    out.push(`${h}:${m}`);
    cur += interval;
  }
  return out;
}

// [추정치 — 11.1절] 마도저항이 마도압력을 초과하는 1포인트당 약 0.015% 최종 전투력 증가(반대 방향도 동일)로
// 추정한 값입니다. 확정된 게임 데이터가 아니므로, 실제 수치가 확인되면 이 상수만 바꾸면 됩니다.
const RESIST_PRESSURE_RATIO = 0.00015;
const RESIST_PRESSURE_CAP = 0.40; // ±40% 한도, 증폭·감소 양방향 동일

// 11.2절 공식: diff = 저항 - 압력, 보정률 = clamp(0.00015×diff, -40%, +40%). 압력 0인 콘텐츠에도 적용합니다.
function finalPower(basePower, pressure, resist) {
  const diff = (resist || 0) - (pressure || 0);
  const rate = Math.max(-RESIST_PRESSURE_CAP, Math.min(RESIST_PRESSURE_CAP, RESIST_PRESSURE_RATIO * diff));
  return Math.round(basePower * (1 + rate));
}

// 저항-압력 보정 후 패널티를 차감한, 화면 전체에서 일관되게 쓰는 최종 전투력 계산입니다.
// (관리자 화면의 charFinalPower와 동일한 규칙 — 결과는 0 미만으로 내려가지 않습니다.)
// [Unverified] RESIST_PRESSURE_RATIO는 사용자가 스스로 "추정한다"고 밝힌 값이며 확정된 게임 데이터가 아닙니다.
function charFinalPower(char, content) {
  const base = content ? finalPower(char.power, content.pressure, char.resist) : char.power;
  const penalty = char.penalty || 0;
  return Math.max(0, base - penalty);
}


/* ---------------- 작은 컴포넌트 ---------------- */
const Emblem = ({ size = 34 }) => (
  <img
    src="/guild-emblem.png"
    alt="길드 엠블럼"
    width={size}
    height={size}
    className="gpm-emblem"
    style={{ objectFit: "contain" }}
  />
);

const RoleBadge = ({ role }) => (
  <span className={`gpm-role-badge ${role}`}>{ROLE_LABEL[role] || role}</span>
);

function Toast({ message }) {
  if (!message) return null;
  return <div className="gpm-toast">{message}</div>;
}

function Checkbox({ checked }) {
  return <div className={`gpm-checkbox ${checked ? "checked" : ""}`}>{checked ? "✓" : ""}</div>;
}

/* ---------------- 직업 검색 콤보박스 ---------------- */
function JobCombo({ jobs, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const selected = jobs.find((j) => j.id === value);

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = jobs.filter((j) => j.active !== false && (j.name.includes(query) || (j.keywords || "").toLowerCase().includes(query.toLowerCase())));

  return (
    <div className="gpm-combo" ref={ref}>
      <input
        className="gpm-input"
        placeholder="직업을 검색하세요"
        value={open ? query : selected ? selected.name : ""}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className="gpm-combo-list">
          {filtered.length === 0 && <div className="gpm-combo-empty">일치하는 직업이 없습니다</div>}
          {filtered.map((j) => (
            <div key={j.id} className="gpm-combo-opt" onMouseDown={() => { onChange(j.id); setOpen(false); }}>
              <span>{j.name}</span>
              <RoleBadge role={j.role} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   1.3 + 1.4 — 길드 입장 & 대표 캐릭터 입력 (게이트)
   ============================================================ */
function GateFlow({ config, onEnter }) {
  const alreadyAuthed = (() => {
    try { return sessionStorage.getItem("gpm-guild-authed") === "true"; } catch (e) { return false; }
  })();
  const [step, setStep] = useState(alreadyAuthed ? 2 : 1); // 1: 길드 비번, 2: 대표 캐릭터
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [repInput, setRepInput] = useState("");
  const [recents, setRecents] = useState([]);
  const [lookupState, setLookupState] = useState(null); // null | 'not_found'
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await storageGet("recent-rep-names", false);
      if (r) setRecents(JSON.parse(r));
    })();
  }, []);

  function submitPw() {
    if (pw === config.password) {
      try { sessionStorage.setItem("gpm-guild-authed", "true"); } catch (e) { /* 세션 저장이 안 되면 그냥 이번 새로고침까지만 유지됩니다 */ }
      setStep(2);
      setPwError("");
    } else {
      setPwError("비밀번호가 올바르지 않습니다. 관리자에게 공유받은 길드 비밀번호를 확인해주세요.");
    }
  }

  async function submitRep(name) {
    const target = (name ?? repInput).trim();
    if (!target) return;
    setBusy(true);
    const existing = await storageGet(`rep:${target}`, true);
    setBusy(false);
    if (existing) {
      const recentsNext = [target, ...recents.filter((r) => r !== target)].slice(0, 5);
      setRecents(recentsNext);
      storageSet("recent-rep-names", recentsNext, false);
      onEnter(target, JSON.parse(existing));
    } else {
      setLookupState("not_found");
    }
  }

  async function createRep() {
    const target = repInput.trim();
    if (!target) return;
    const fresh = { subs: [], applications: [] };
    await storageSet(`rep:${target}`, fresh, true);
    const recentsNext = [target, ...recents.filter((r) => r !== target)].slice(0, 5);
    setRecents(recentsNext);
    storageSet("recent-rep-names", recentsNext, false);
    onEnter(target, fresh);
  }

  return (
    <div className="gpm-gate-wrap">
      <div className="gpm-gate-card">
        <div className="gpm-gate-emblem"><Emblem size={44} /></div>
        <div className="gpm-steps">
          <div className={`gpm-step-dot ${step >= 1 ? "active" : ""}`} />
          <div className={`gpm-step-dot ${step >= 2 ? "active" : ""}`} />
        </div>

        {step === 1 && (
          <div>
            <h1 className="gpm-gate-title">길드 파티 매칭</h1>
            <p className="gpm-gate-desc">길드원만 입장할 수 있습니다.<br />관리자에게 공유받은 길드 공용 비밀번호를 입력해주세요.</p>
            <div className="gpm-field">
              <label className="gpm-label">길드 공용 비밀번호</label>
              <input
                type="password"
                className={`gpm-input ${pwError ? "error" : ""}`}
                value={pw}
                onChange={(e) => { setPw(e.target.value); setPwError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") submitPw(); }}
                placeholder="비밀번호 입력"
                autoFocus
              />
              {pwError && <div className="gpm-error-text">{pwError}</div>}
              <div className="gpm-hint-text">프로토타입 기본 비밀번호: {config.password}</div>
            </div>
            <button type="button" className="gpm-btn gpm-btn-primary gpm-btn-block" onClick={submitPw}>입장하기</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="gpm-gate-title">대표 캐릭터</h1>
            <p className="gpm-gate-desc">대표 캐릭터명은 사용자 계정처럼 사용됩니다.<br />실제 파티에 참여할 캐릭터는 다음 화면에서 등록합니다.</p>
            <div className="gpm-field">
              <label className="gpm-label">대표 캐릭터명</label>
              <input
                className="gpm-input"
                value={repInput}
                onChange={(e) => { setRepInput(e.target.value); setLookupState(null); }}
                placeholder="대표 캐릭터명 입력"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && submitRep()}
              />
              {recents.length > 0 && (
                <div className="gpm-recents">
                  {recents.map((r) => (
                    <button key={r} className="gpm-recent-chip" onClick={() => { setRepInput(r); submitRep(r); }}>{r}</button>
                  ))}
                </div>
              )}
            </div>

            {lookupState === "not_found" ? (
              <div>
                <div className="gpm-notice" style={{ marginBottom: 14 }}>
                  '{repInput}'(으)로 등록된 정보가 없습니다. 신규 대표 캐릭터로 등록할까요?
                </div>
                <div className="gpm-row">
                  <button className="gpm-btn gpm-btn-ghost" style={{ flex: 1 }} onClick={() => setLookupState(null)}>다시 입력</button>
                  <button className="gpm-btn gpm-btn-primary" style={{ flex: 1 }} onClick={createRep}>신규 등록</button>
                </div>
              </div>
            ) : (
              <button className="gpm-btn gpm-btn-primary gpm-btn-block" disabled={!repInput.trim() || busy} onClick={() => submitRep()}>
                {busy ? "조회 중..." : "조회하기"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   1.6 / 1.7 — 하위 캐릭터 등록 · 수정 모달
   ============================================================ */
function CharacterModal({ jobs, initial, onClose, onSave, onDelete }) {
  const [nickname, setNickname] = useState(initial?.nickname || "");
  const [jobId, setJobId] = useState(initial?.jobId || "");
  const [power, setPower] = useState(initial?.power ?? "");
  const [resist, setResist] = useState(initial?.resist ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [errors, setErrors] = useState({});
  const isEdit = !!initial;

  function validate() {
    const e = {};
    if (!nickname.trim()) e.nickname = "캐릭터 닉네임을 입력해주세요.";
    if (!jobId) e.jobId = "직업을 선택해주세요.";
    if (power === "" || Number(power) < 0 || isNaN(Number(power))) e.power = "0 이상의 숫자를 입력해주세요.";
    if (resist === "" || Number(resist) < 0 || isNaN(Number(resist))) e.resist = "0 이상의 숫자를 입력해주세요.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function save() {
    if (!validate()) return;
    const job = jobs.find((j) => j.id === jobId);
    onSave({
      id: initial?.id || uid(),
      nickname: nickname.trim(),
      jobId,
      jobName: job?.name,
      role: job?.role,
      power: Number(power),
      resist: Number(resist),
      active,
      penalty: initial?.penalty ?? 0, // 패널티는 관리자만 수정 — 사용자 편집 시 기존 값을 그대로 유지
      updatedAt: Date.now(),
    });
  }

  return (
    <div className="gpm-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gpm-modal">
        <h3 className="gpm-modal-title">{isEdit ? "캐릭터 정보 수정" : "캐릭터 등록"}</h3>

        <div className="gpm-field">
          <label className="gpm-label">캐릭터 닉네임</label>
          <input className={`gpm-input ${errors.nickname ? "error" : ""}`} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="예: 달빛여행자" />
          {errors.nickname && <div className="gpm-error-text">{errors.nickname}</div>}
        </div>

        <div className="gpm-field">
          <label className="gpm-label">직업 {jobId && <span style={{ marginLeft: 6 }}><RoleBadge role={jobs.find((j) => j.id === jobId)?.role} /></span>}</label>
          <JobCombo jobs={jobs} value={jobId} onChange={setJobId} />
          {errors.jobId && <div className="gpm-error-text">{errors.jobId}</div>}
          <div className="gpm-hint-text">직업은 목록에서만 선택할 수 있습니다. 역할은 자동으로 지정됩니다.</div>
        </div>

        <div className="gpm-row">
          <div className="gpm-field" style={{ flex: 1 }}>
            <label className="gpm-label">기본 전투력</label>
            <input className={`gpm-input ${errors.power ? "error" : ""}`} type="number" min="0" value={power} onChange={(e) => setPower(e.target.value)} placeholder="0" />
            {errors.power && <div className="gpm-error-text">{errors.power}</div>}
          </div>
          <div className="gpm-field" style={{ flex: 1 }}>
            <label className="gpm-label">마도 저항</label>
            <input className={`gpm-input ${errors.resist ? "error" : ""}`} type="number" min="0" value={resist} onChange={(e) => setResist(e.target.value)} placeholder="0" />
            {errors.resist && <div className="gpm-error-text">{errors.resist}</div>}
          </div>
        </div>

        {isEdit && (
          <div className="gpm-field" style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => setActive(!active)}>
            <Checkbox checked={active} />
            <span style={{ fontSize: 13 }}>활성화 상태 (비활성화 시 파티 신청에서 제외됩니다)</span>
          </div>
        )}

        <div className="gpm-modal-actions">
          {isEdit && (
            <button className="gpm-btn gpm-btn-danger" onClick={() => onDelete(initial.id)}>삭제</button>
          )}
          <button className="gpm-btn gpm-btn-ghost" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className="gpm-btn gpm-btn-primary" style={{ flex: 1 }} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   1.5 — 하위 캐릭터 목록
   ============================================================ */
function CharactersView({ jobs, subs, onAdd, onUpdate, onDelete }) {
  const [modal, setModal] = useState(null); // null | 'new' | char object

  return (
    <div>
      <div className="gpm-section-title">
        <div>
          <h2>내 캐릭터</h2>
          <div className="gpm-section-desc">파티 신청에 사용할 캐릭터를 관리합니다.</div>
        </div>
        <button className="gpm-btn gpm-btn-primary gpm-btn-sm" onClick={() => setModal("new")}>+ 캐릭터 추가</button>
      </div>

      {subs.length === 0 ? (
        <div className="gpm-card">
          <div className="gpm-empty">
            <div className="gpm-empty-icon">⌗</div>
            <div className="gpm-empty-title">등록된 캐릭터가 없습니다.</div>
            <div className="gpm-empty-desc">파티 신청에 사용할 캐릭터를 먼저 등록해주세요.</div>
            <button className="gpm-btn gpm-btn-primary gpm-btn-sm" style={{ marginTop: 16 }} onClick={() => setModal("new")}>캐릭터 등록하기</button>
          </div>
        </div>
      ) : (
        <div className="gpm-char-grid">
          {subs.map((c) => (
            <div key={c.id} className={`gpm-char-card ${c.active === false ? "inactive" : ""}`}>
              <div className="gpm-char-top">
                <span className="gpm-char-name">{c.nickname}</span>
                <RoleBadge role={c.role} />
              </div>
              <div className="gpm-char-job">{c.jobName}{c.active === false ? " · 비활성" : ""}</div>
              <div className="gpm-char-stats">
                <div className="gpm-stat"><span className="gpm-stat-label">전투력</span><span className="gpm-stat-value">{c.power.toLocaleString()}</span></div>
                <div className="gpm-stat"><span className="gpm-stat-label">마도 저항</span><span className="gpm-stat-value">{c.resist.toLocaleString()}</span></div>
              </div>
              <div className="gpm-char-actions">
                <button className="gpm-btn gpm-btn-ghost gpm-btn-sm" style={{ flex: 1 }} onClick={() => setModal(c)}>수정</button>
              </div>
            </div>
          ))}
          <button className="gpm-fab-add" onClick={() => setModal("new")}>+ 캐릭터 추가</button>
        </div>
      )}

      {modal && (
        <CharacterModal
          jobs={jobs}
          initial={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={(c) => { modal === "new" ? onAdd(c) : onUpdate(c); setModal(null); }}
          onDelete={(id) => { onDelete(id); setModal(null); }}
        />
      )}
    </div>
  );
}

/* ============================================================
   1.8 — 콘텐츠 목록
   ============================================================ */
function ContentsView({ contents, applications, onApply }) {
  return (
    <div>
      <div className="gpm-section-title">
        <div>
          <h2>콘텐츠</h2>
          <div className="gpm-section-desc">현재 신청 가능한 콘텐츠입니다.</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {contents.map((c) => {
          const applied = applications.some((a) => a.contentId === c.id && a.status !== "cancelled");
          return (
            <div key={c.id} className="gpm-content-card">
              <div className="gpm-content-top">
                <div>
                  <div className="gpm-content-name">{c.name}</div>
                  <div className="gpm-section-desc" style={{ marginTop: 4 }}>
                    파티 {c.partySize}인 · 탱커 1 · 서포터 1 · 딜러 {c.partySize - 2}
                  </div>
                </div>
                <span className={`gpm-status-pill ${c.active ? "open" : "closed"}`}>{c.active ? "신청 가능" : "신청 마감"}</span>
              </div>
              <div className="gpm-content-meta">
                <div className="gpm-meta-item"><span className="gpm-meta-label">필요 마도 저항</span><span className="gpm-meta-value">{c.requiredResist > 0 ? c.requiredResist.toLocaleString() : "제한 없음"}</span></div>
                <div className="gpm-meta-item"><span className="gpm-meta-label">마도 압력</span><span className="gpm-meta-value">{c.pressure > 0 ? c.pressure.toLocaleString() : "-"}</span></div>
                <div className="gpm-meta-item"><span className="gpm-meta-label">신청 가능 시간</span><span className="gpm-meta-value" style={{ fontSize: 12 }}>{c.startTime} ~ {c.endTime}</span></div>
                <div className="gpm-meta-item"><span className="gpm-meta-label">시간 간격</span><span className="gpm-meta-value">{c.interval}분</span></div>
              </div>
              <button className="gpm-btn gpm-btn-primary gpm-btn-sm" disabled={!c.active} onClick={() => onApply(c.id)}>
                {applied ? "추가 신청하기" : "신청하기"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   1.9 / 1.10 / 1.11 — 파티 신청 · 신청 확인 · 신청 완료
   ============================================================ */
function ApplyView({ contents, subs, initialContentId, editingApp, onCancel, onSubmit }) {
  const [phase, setPhase] = useState("form"); // form | confirm | done
  const [contentId, setContentId] = useState(initialContentId || editingApp?.contentId || contents[0]?.id || "");
  const [selectedChars, setSelectedChars] = useState(new Set(editingApp?.characterIds || []));
  const [selectedTimes, setSelectedTimes] = useState(new Set(editingApp?.times || []));
  const [wantNormal, setWantNormal] = useState(appliesNormal(editingApp?.type || "normal"));
  const [wantSupport, setWantSupport] = useState(appliesSupport(editingApp?.type || ""));
  const [comboBlockedMsg, setComboBlockedMsg] = useState("");

  const content = contents.find((c) => c.id === contentId);
  const slots = useMemo(() => (content ? timeSlots(content.startTime, content.endTime, content.interval) : []), [content]);
  const activeChars = subs.filter((c) => c.active !== false);
  // "일반+지원" 동시 선택 조건 (12.2절): 신청 시간 수가 신청 캐릭터 수보다 많아야 함
  const comboAllowed = selectedTimes.size > selectedChars.size;

  function toggleChar(id, disabled) {
    if (disabled) return;
    const next = new Set(selectedChars);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedChars(next);
  }
  function toggleTime(t) {
    const next = new Set(selectedTimes);
    next.has(t) ? next.delete(t) : next.add(t);
    setSelectedTimes(next);
  }
  function selectAllChars() {
    const selectable = activeChars.filter((c) => !(content.requiredResist > 0 && c.resist < content.requiredResist));
    setSelectedChars(new Set(selectable.map((c) => c.id)));
  }
  function toggleNormal() {
    setComboBlockedMsg("");
    if (!wantNormal && wantSupport && !comboAllowed) { setComboBlockedMsg("일반+지원을 함께 선택하려면 신청 시간 수가 신청 캐릭터 수보다 많아야 합니다."); return; }
    setWantNormal(!wantNormal);
  }
  function toggleSupport() {
    setComboBlockedMsg("");
    if (!wantSupport && wantNormal && !comboAllowed) { setComboBlockedMsg("일반+지원을 함께 선택하려면 신청 시간 수가 신청 캐릭터 수보다 많아야 합니다."); return; }
    setWantSupport(!wantSupport);
  }

  const canSubmit = content && selectedChars.size > 0 && selectedTimes.size > 0 && (wantNormal || wantSupport);

  if (!content) {
    return <div className="gpm-card"><div className="gpm-empty"><div className="gpm-empty-title">신청 가능한 콘텐츠가 없습니다.</div></div></div>;
  }

  if (phase === "confirm") {
    const chosenChars = subs.filter((c) => selectedChars.has(c.id));
    return (
      <div>
        <div className="gpm-section-title"><h2>신청 확인</h2></div>
        <div className="gpm-card">
          <div className="gpm-review-block">
            <div className="gpm-review-label">콘텐츠</div>
            <div className="gpm-review-value">{content.name}</div>
          </div>
          <div className="gpm-review-block">
            <div className="gpm-review-label">신청 유형</div>
            <div className="gpm-review-value">{APP_TYPE_LABEL[wantNormal && wantSupport ? "both" : wantNormal ? "normal" : "support"]}</div>
          </div>
          <div className="gpm-review-block">
            <div className="gpm-review-label">선택 캐릭터 ({chosenChars.length}명)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
              {chosenChars.map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-elev)", padding: "8px 12px", borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{c.nickname}</span>
                    <RoleBadge role={c.role} />
                    <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>{c.jobName}</span>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--gold-soft)" }}>
                    최종 {charFinalPower(c, content).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="gpm-review-block">
            <div className="gpm-review-label">선택 시작 시각 ({selectedTimes.size}개)</div>
            <div className="gpm-review-chips">
              {[...selectedTimes].sort().map((t) => <span key={t} className="gpm-chip">{t}</span>)}
            </div>
          </div>
          <div className="gpm-notice">
            선택한 모든 캐릭터는 선택한 모든 시간의 매칭 후보로 등록됩니다.<br />
            동일 대표 캐릭터는 같은 시간에 한 캐릭터만 배정됩니다.
          </div>
        </div>
        <div className="gpm-row" style={{ marginTop: 16 }}>
          <button className="gpm-btn gpm-btn-ghost" style={{ flex: 1 }} onClick={() => setPhase("form")}>이전으로 돌아가기</button>
          <button className="gpm-btn gpm-btn-primary" style={{ flex: 1 }} onClick={() => {
            onSubmit({
              id: editingApp?.id || uid(),
              contentId,
              contentName: content.name,
              type: wantNormal && wantSupport ? "both" : wantNormal ? "normal" : "support",
              characterIds: [...selectedChars],
              times: [...selectedTimes],
              status: editingApp?.status || "applied",
              appliedAt: editingApp?.appliedAt || Date.now(),
            });
          }}>신청 완료</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="gpm-section-title">
        <div>
          <h2>{editingApp ? "신청 수정" : "파티 신청"}</h2>
          <div className="gpm-section-desc">참여할 캐릭터와 시간을 선택해주세요.</div>
        </div>
        <button className="gpm-btn gpm-btn-ghost gpm-btn-sm" onClick={onCancel}>닫기</button>
      </div>

      <div className="gpm-card">
        <div className="gpm-field">
          <label className="gpm-label">콘텐츠</label>
          <select className="gpm-input" value={contentId} onChange={(e) => { setContentId(e.target.value); setSelectedTimes(new Set()); }} disabled={!!editingApp}>
            {contents.filter((c) => c.active || c.id === contentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="gpm-content-meta" style={{ marginTop: 4 }}>
          <div className="gpm-meta-item"><span className="gpm-meta-label">파티 인원</span><span className="gpm-meta-value">{content.partySize}인 (탱1·서폿1·딜{content.partySize - 2})</span></div>
          <div className="gpm-meta-item"><span className="gpm-meta-label">필요 마도 저항</span><span className="gpm-meta-value">{content.requiredResist > 0 ? content.requiredResist.toLocaleString() : "제한 없음"}</span></div>
          <div className="gpm-meta-item"><span className="gpm-meta-label">마도 압력</span><span className="gpm-meta-value">{content.pressure > 0 ? content.pressure.toLocaleString() : "-"}</span></div>
        </div>
      </div>

      <div className="gpm-card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div className="gpm-label" style={{ marginBottom: 0 }}>참여 캐릭터 선택</div>
          {activeChars.length > 0 && (
            <button type="button" className="gpm-btn gpm-btn-ghost gpm-btn-sm" onClick={selectAllChars}>내 캐릭터 전체 선택</button>
          )}
        </div>
        {activeChars.length === 0 ? (
          <div className="gpm-empty"><div className="gpm-empty-desc">활성화된 캐릭터가 없습니다. 먼저 캐릭터를 등록해주세요.</div></div>
        ) : (
          <div className="gpm-select-list">
            {activeChars.map((c) => {
              const short = content.requiredResist > 0 && c.resist < content.requiredResist;
              const checked = selectedChars.has(c.id);
              return (
                <div key={c.id} className={`gpm-select-row ${checked ? "checked" : ""} ${short ? "disabled" : ""}`} onClick={() => toggleChar(c.id, short)}>
                  <Checkbox checked={checked} />
                  <div className="gpm-select-info">
                    <div className="gpm-select-name-row">
                      <span className="gpm-select-name">{c.nickname}</span>
                      <RoleBadge role={c.role} />
                      <span className="gpm-select-sub">{c.jobName}</span>
                    </div>
                    {short && (
                      <div className="gpm-select-warn">
                        마도 저항 부족 · 필요 {content.requiredResist.toLocaleString()} / 현재 {c.resist.toLocaleString()} / {(content.requiredResist - c.resist).toLocaleString()} 부족
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="gpm-select-power">{charFinalPower(c, content).toLocaleString()}</span>
                    <span className="gpm-select-power-label">최종 전투력</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="gpm-card">
        <div className="gpm-label" style={{ marginBottom: 12 }}>참여 가능 시작 시각 (복수 선택)</div>
        <div className="gpm-time-grid">
          {slots.map((t) => (
            <button key={t} className={`gpm-time-chip ${selectedTimes.has(t) ? "checked" : ""}`} onClick={() => toggleTime(t)}>{t}</button>
          ))}
        </div>
        <div className="gpm-hint-text" style={{ marginTop: 10 }}>선택한 시간은 선택한 모든 캐릭터에 동일하게 적용됩니다.</div>
      </div>

      <div className="gpm-card">
        <div className="gpm-label" style={{ marginBottom: 12 }}>신청 유형 (동시 선택 가능)</div>
        <div className="gpm-type-grid">
          <button type="button" className={`gpm-type-card ${wantNormal ? "checked" : ""}`} onClick={toggleNormal} disabled={wantSupport && !wantNormal && !comboAllowed}>
            <div className="gpm-type-title"><Checkbox checked={wantNormal} /> 일반 신청</div>
            <div className="gpm-type-desc">선택한 각 캐릭터는 최대 한 번만 배정됩니다.<br />동일 대표 캐릭터는 같은 시간에 한 캐릭터만 배정됩니다.</div>
          </button>
          <button type="button" className={`gpm-type-card ${wantSupport ? "checked" : ""}`} onClick={toggleSupport} disabled={wantNormal && !wantSupport && !comboAllowed}>
            <div className="gpm-type-title"><Checkbox checked={wantSupport} /> 지원 신청</div>
            <div className="gpm-type-desc">부족한 역할과 빈자리 보완에 사용됩니다.<br />서로 다른 시간에는 같은 캐릭터가 반복 배정될 수 있습니다 (0회~여러 번).</div>
          </button>
        </div>
        {wantNormal && wantSupport && (
          <div className="gpm-hint" style={{ marginTop: 10 }}>일반+지원 조합: 신청 시간 중 1개는 일반으로 필수 배정되고, 나머지 시간에는 지원으로 0회~여러 번 배정될 수 있습니다.</div>
        )}
        {comboBlockedMsg && <div className="gpm-error-text" style={{ marginTop: 10 }}>{comboBlockedMsg}</div>}
        {!comboAllowed && !(wantNormal && wantSupport) && (
          <div className="gpm-hint" style={{ marginTop: 10 }}>일반+지원을 함께 선택하려면 신청 시간 수가 신청 캐릭터 수보다 많아야 합니다. (현재 캐릭터 {selectedChars.size}명 · 시간 {selectedTimes.size}개)</div>
        )}
      </div>

      <div className="gpm-summary-bar">
        <div className="gpm-summary-info">캐릭터 <b>{selectedChars.size}</b>명 · 시간 <b>{selectedTimes.size}</b>개 선택됨</div>
        <button className="gpm-btn gpm-btn-primary" disabled={!canSubmit} onClick={() => setPhase("confirm")}>신청 내용 확인</button>
      </div>
    </div>
  );
}

function ApplyDoneView({ app, onGoHistory, onGoContents }) {
  return (
    <div className="gpm-card">
      <div className="gpm-done-wrap">
        <div className="gpm-done-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 12.5L9.5 18L20 6" stroke="#4F7A5B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <h2 className="gpm-done-title">파티 매칭 신청이 완료되었습니다.</h2>
        <p className="gpm-done-desc">관리자가 자동 매칭을 실행한 후 결과를 확인할 수 있습니다.</p>
        <div className="gpm-done-stats">
          <div><div className="gpm-done-stat-num">{app.contentName}</div><div className="gpm-done-stat-label">콘텐츠</div></div>
          <div><div className="gpm-done-stat-num">{app.characterIds.length}</div><div className="gpm-done-stat-label">신청 캐릭터 수</div></div>
          <div><div className="gpm-done-stat-num">{app.times.length}</div><div className="gpm-done-stat-label">신청 시간 수</div></div>
          <div><div className="gpm-done-stat-num">{app.type === "both" ? "일반+지원" : app.type === "normal" ? "일반" : "지원"}</div><div className="gpm-done-stat-label">신청 유형</div></div>
        </div>
        <div className="gpm-row">
          <button className="gpm-btn gpm-btn-ghost" style={{ flex: 1 }} onClick={onGoContents}>콘텐츠 목록으로</button>
          <button className="gpm-btn gpm-btn-primary" style={{ flex: 1 }} onClick={onGoHistory}>신청 내역 확인</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   1.12 — 신청 내역
   ============================================================ */
const STATUS_LABEL = { applied: "신청 완료", waiting: "매칭 대기", matched: "매칭 완료", revealed: "결과 공개" };

function HistoryView({ applications, contents, subs, onEdit, onCancel }) {
  if (applications.length === 0) {
    return (
      <div>
        <div className="gpm-section-title"><h2>신청 내역</h2></div>
        <div className="gpm-card">
          <div className="gpm-empty">
            <div className="gpm-empty-icon">☰</div>
            <div className="gpm-empty-title">현재 신청한 내역이 없습니다.</div>
            <div className="gpm-empty-desc">콘텐츠 목록에서 파티 신청을 진행해주세요.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="gpm-section-title"><h2>신청 내역</h2><div className="gpm-section-desc">현재 유효한 신청 내용을 확인하고 수정하거나 취소할 수 있습니다.</div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {applications.map((a) => {
          const chars = subs.filter((c) => a.characterIds.includes(c.id));
          const locked = a.status === "matched" || a.status === "revealed";
          return (
            <div key={a.id} className="gpm-app-card">
              <div className="gpm-app-top">
                <div>
                  <div className="gpm-app-content">{a.contentName}</div>
                  <div className="gpm-app-meta">{APP_TYPE_LABEL[a.type] || a.type} · {new Date(a.appliedAt).toLocaleString("ko-KR")}</div>
                </div>
                <span className={`gpm-status-tag ${a.status}`}>{STATUS_LABEL[a.status] || a.status}</span>
              </div>
              <div className="gpm-review-chips" style={{ marginBottom: 8 }}>
                {chars.map((c) => <span key={c.id} className="gpm-chip">{c.nickname} · {ROLE_LABEL[c.role]}</span>)}
              </div>
              <div className="gpm-review-chips">
                {a.times.sort().map((t) => <span key={t} className="gpm-chip" style={{ fontFamily: "var(--font-mono)" }}>{t}</span>)}
              </div>
              {locked && <div className="gpm-hint-text" style={{ marginTop: 10, color: "var(--danger)" }}>관리자가 이미 자동 매칭을 실행했습니다. 수정 또는 취소 시 기존 결과가 무효화될 수 있습니다.</div>}
              <div className="gpm-row" style={{ marginTop: 12 }}>
                <button className="gpm-btn gpm-btn-ghost gpm-btn-sm" style={{ flex: 1 }} onClick={() => onEdit(a)}>신청 수정</button>
                <button className="gpm-btn gpm-btn-danger gpm-btn-sm" style={{ flex: 1 }} onClick={() => onCancel(a.id)}>신청 취소</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   1.13 — 매칭 결과
   ============================================================ */
function ResultsView({ contents }) {
  const [results, setResults] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = [];
      for (const c of contents) {
        const raw = await storageGet(`results:${c.id}`, true);
        if (!raw) continue;
        let data;
        try { data = JSON.parse(raw); } catch (e) { continue; }
        if (!data || !data.published || !Array.isArray(data.parties)) continue;
        for (const p of data.parties) {
          out.push({
            contentName: c.name,
            time: p.time,
            partyNumber: p.partyNumber,
            // 공개 정보만 전달: 캐릭터 닉네임, 역할, 빈자리/부족 인원
            slots: (p.slots || []).map((s) => ({ role: s.role, nickname: s.nickname || null })),
            shortage: p.shortage || null,
          });
        }
      }
      if (!cancelled) { setResults(out); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [contents]);

  const groups = useMemo(() => {
    const byContentTime = {};
    for (const r of results) {
      const key = `${r.contentName} · ${r.time}`;
      if (!byContentTime[key]) byContentTime[key] = [];
      byContentTime[key].push(r);
    }
    return byContentTime;
  }, [results]);

  if (!loaded) {
    return (
      <div>
        <div className="gpm-section-title"><h2>매칭 결과</h2></div>
        <div className="gpm-card"><div style={{ color: "var(--text-faint)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>불러오는 중...</div></div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div>
        <div className="gpm-section-title"><h2>매칭 결과</h2></div>
        <div className="gpm-card">
          <div className="gpm-empty">
            <div className="gpm-empty-icon">◈</div>
            <div className="gpm-empty-title">아직 공개된 매칭 결과가 없습니다.</div>
            <div className="gpm-empty-desc">관리자가 자동 매칭을 실행하고 결과를 공개하면 여기에 표시됩니다.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="gpm-section-title"><h2>매칭 결과</h2></div>
      {Object.entries(groups).map(([key, parties]) => (
        <div key={key}>
          <div className="gpm-result-group-title"><h3>{key}</h3><div className="gpm-result-group-line" /></div>
          <div className="gpm-party-grid">
            {parties.map((p) => (
              <div key={p.partyNumber} className="gpm-party-card">
                <div className="gpm-party-top"><span className="gpm-party-num">파티 {p.partyNumber}</span></div>
                {p.slots.map((s, i) => (
                  <div key={i} className="gpm-party-slot">
                    <span className={`gpm-party-slot-role ${s.role}`} title={ROLE_LABEL[s.role]} aria-label={ROLE_LABEL[s.role]}>
                      {ROLE_ICON[s.role] && React.createElement(ROLE_ICON[s.role], { size: 15, strokeWidth: 2.3 })}
                    </span>
                    {s.nickname ? <span className="gpm-party-slot-name">{s.nickname}</span> : <span className="gpm-party-slot-empty">모집 중</span>}
                  </div>
                ))}
                {p.shortage && <div className="gpm-party-short">부족 인원: {p.shortage}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   앱 셸
   ============================================================ */
const NAV_ITEMS = [
  { key: "characters", label: "내 캐릭터" },
  { key: "contents", label: "콘텐츠" },
  { key: "history", label: "신청 내역" },
  { key: "results", label: "매칭 결과" },
];

function AppShell({ repName, repData, setRepData, config }) {
  const [view, setView] = useState("contents");
  const [applyCtx, setApplyCtx] = useState(null); // { contentId } | { editingApp }
  const [doneApp, setDoneApp] = useState(null);
  const [toast, setToast] = useState("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }, []);

  const persist = useCallback(async (next) => {
    setRepData(next);
    await storageSet(`rep:${repName}`, next, true);
  }, [repName, setRepData]);

  function addChar(c) {
    const next = { ...repData, subs: [...repData.subs, c] };
    persist(next);
    showToast("캐릭터가 등록되었습니다.");
  }
  function updateChar(c) {
    const next = { ...repData, subs: repData.subs.map((s) => (s.id === c.id ? c : s)) };
    persist(next);
    showToast("캐릭터 정보가 수정되었습니다.");
  }
  function deleteChar(id) {
    const next = { ...repData, subs: repData.subs.filter((s) => s.id !== id) };
    persist(next);
    showToast("캐릭터가 삭제되었습니다.");
  }

  function startApply(contentId) {
    setApplyCtx({ contentId, editingApp: null });
    setView("apply");
  }
  function startEditApp(app) {
    setApplyCtx({ contentId: app.contentId, editingApp: app });
    setView("apply");
  }
  function submitApplication(app) {
    const exists = repData.applications.some((a) => a.id === app.id);
    const nextApps = exists ? repData.applications.map((a) => (a.id === app.id ? app : a)) : [...repData.applications, app];
    const next = { ...repData, applications: nextApps };
    persist(next);
    setDoneApp(app);
    setView("done");
  }
  function cancelApplication(id) {
    const next = { ...repData, applications: repData.applications.filter((a) => a.id !== id) };
    persist(next);
    showToast("신청이 취소되었습니다.");
  }

  const activeSubs = repData.subs;

  return (
    <div className="gpm-frame">
      <div className="gpm-shell-header">
        <div className="gpm-brand">
          <Emblem />
          <div className="gpm-brand-text">
            <span className="gpm-brand-title">길드 파티 매칭</span>
            <span className="gpm-brand-sub">GUILD PARTY MATCHING LEDGER</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/admin.html" className="gpm-btn gpm-btn-ghost gpm-btn-sm" style={{ textDecoration: "none" }}>관리자 화면 →</a>
          <div className="gpm-rep-badge">
            <div className="gpm-rep-avatar">{repName.slice(0, 1)}</div>
            <div>
              <div className="gpm-rep-name">{repName}</div>
              <div className="gpm-rep-tag">대표 캐릭터</div>
            </div>
          </div>
        </div>
      </div>

      {view !== "apply" && view !== "done" && (
        <div className="gpm-nav">
          {NAV_ITEMS.map((n) => (
            <button key={n.key} className={`gpm-nav-item ${view === n.key ? "active" : ""}`} onClick={() => setView(n.key)}>{n.label}</button>
          ))}
        </div>
      )}

      {view === "characters" && (
        <CharactersView jobs={config.jobs} subs={activeSubs} onAdd={addChar} onUpdate={updateChar} onDelete={deleteChar} />
      )}

      {view === "contents" && (
        <ContentsView contents={config.contents} applications={repData.applications} onApply={startApply} />
      )}

      {view === "apply" && applyCtx && (
        activeSubs.length === 0 ? (
          <div className="gpm-card">
            <div className="gpm-empty">
              <div className="gpm-empty-title">등록된 캐릭터가 없습니다.</div>
              <div className="gpm-empty-desc">파티 신청 전에 캐릭터를 먼저 등록해주세요.</div>
              <button className="gpm-btn gpm-btn-primary gpm-btn-sm" style={{ marginTop: 16 }} onClick={() => { setApplyCtx(null); setView("characters"); }}>캐릭터 등록하러 가기</button>
            </div>
          </div>
        ) : (
          <ApplyView
            contents={config.contents}
            subs={activeSubs}
            initialContentId={applyCtx.contentId}
            editingApp={applyCtx.editingApp}
            onCancel={() => { setApplyCtx(null); setView("contents"); }}
            onSubmit={submitApplication}
          />
        )
      )}

      {view === "done" && doneApp && (
        <ApplyDoneView app={doneApp} onGoContents={() => { setApplyCtx(null); setDoneApp(null); setView("contents"); }} onGoHistory={() => { setApplyCtx(null); setDoneApp(null); setView("history"); }} />
      )}

      {view === "history" && (
        <HistoryView applications={repData.applications} contents={config.contents} subs={repData.subs} onEdit={startEditApp} onCancel={cancelApplication} />
      )}

      {view === "results" && (
        <ResultsView contents={config.contents} />
      )}

      <Toast message={toast} />
    </div>
  );
}

/* ============================================================
   루트
   ============================================================ */
export default function GuildPartyMatcher() {
  const [config, setConfig] = useState(null);
  const [rep, setRep] = useState(null); // { name, data }
  const [loading, setLoading] = useState(true);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fallback = setTimeout(() => {
      // 4초 안에 응답이 없으면 스피너만 해제하고, 늦게 도착하는 진짜 결과는
      // 아래 (async () => {...})()가 나중에 덮어씁니다 — 조용히 버리지 않습니다.
      if (!cancelled) {
        setConfig((prev) => prev || { password: "1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS, _loadFailed: true });
        setLoading(false);
      }
    }, 4000);
    (async () => {
      const result = await storageGetSafe("guild-config", true);
      let cfg;
      if (result.failed) {
        // 조회 자체가 실패한 경우입니다 — 값이 원래 없는 것인지 알 수 없으므로 절대 덮어쓰지 않습니다.
        // [Unverified] 아래는 화면을 막기 위한 임시값이며, 저장(overwrite)은 하지 않습니다.
        cfg = { password: "1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS, _loadFailed: true };
      } else if (result.value === null) {
        // 진짜로 처음 만드는 경우에만 기본값을 시드로 저장합니다.
        cfg = { password: "1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS };
        await storageSet("guild-config", cfg, true);
      } else {
        try { cfg = JSON.parse(result.value); } catch (e) { cfg = { password: "1234", jobs: DEFAULT_JOBS, contents: DEFAULT_CONTENTS, _loadFailed: true }; }
      }
      if (!cancelled) {
        clearTimeout(fallback);
        setConfig(cfg);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; clearTimeout(fallback); };
  }, [retryTick]);

  if (loading || !config) {
    return (
      <div className="gpm-root">
        <GlobalStyle />
        <div className="gpm-gate-wrap"><div style={{ color: "var(--text-dim)", fontSize: 13 }}>불러오는 중...</div></div>
      </div>
    );
  }

  if (config._loadFailed) {
    // 실제 설정을 못 받아온 상태입니다. 이대로 진행하면 임시 기본값(직업/콘텐츠 목록 등)을
    // 보게 되므로, 혼란을 막기 위해 여기서 화면을 막습니다.
    return (
      <div className="gpm-root">
        <GlobalStyle />
        <div className="gpm-gate-wrap">
          <div className="gpm-gate-card" style={{ textAlign: "center" }}>
            <h1 className="gpm-gate-title">불러오지 못했습니다</h1>
            <p className="gpm-gate-desc">길드 설정을 정상적으로 불러오지 못했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.</p>
            <button type="button" className="gpm-btn gpm-btn-primary gpm-btn-block" onClick={() => { setConfig(null); setLoading(true); setRetryTick((x) => x + 1); }}>다시 시도</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="gpm-root">
      <GlobalStyle />
      {!rep ? (
        <GateFlow config={config} onEnter={(name, data) => setRep({ name, data })} />
      ) : (
        <div className="gpm-scroll">
          <AppShell
            repName={rep.name}
            repData={rep.data}
            setRepData={(d) => setRep({ name: rep.name, data: d })}
            config={config}
          />
        </div>
      )}
    </div>
  );
}
