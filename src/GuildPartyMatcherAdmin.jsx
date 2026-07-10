import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { Shield, Swords, HeartPulse, Bird } from "lucide-react";
import { storageGet, storageSet, storageDelete, storageListWithValues, storageGetSafe, pullFromSheets, backupKv, storageSetMany, syncMirror } from "./lib/storage";
import { runAutoMatch as runAutoMatchStable, buildCandidates, appliesNormal, appliesSupport } from "./lib/matchEngine";
import { runAutoMatch as runAutoMatchOptimized } from "./lib/matchEngine.experimental";
import { DEFAULT_JOBS, DEFAULT_CONTENTS, ROLE_LABEL } from "./lib/constants";
import { timeSlots, charFinalPower } from "./lib/utils";
import "./GuildPartyMatcherAdmin.css";

/* ============================================================
   길드 파티 매칭 툴 — 관리자 화면 프로토타입
   기획서 2장(관리자 화면) 중 핵심 흐름을 구현합니다.
   사용자 화면과 동일한 window.storage(shared) 데이터를 공유합니다.
   - guild-config: { password, adminPassword, jobs, contents }
   - rep:{대표캐릭터명}: { subs, applications }
   - results:{콘텐츠id}: { published, generatedAt, parties, unassigned }

   범위 안내(간소화한 부분):
   - 진짜 드래그앤드롭 대신 슬롯 클릭 → 선택 방식으로 파티원을 이동/교체합니다.
   - 48시간 자동 삭제는 프론트가 아니라 Apps Script 시간 트리거(cleanExpiredResults)가
     담당합니다. 프론트에는 수동 삭제 버튼만 있습니다(자동삭제 루프 제거, 2026-07-08).
   - 자동 매칭 알고리즘은 기획서에 정확한 배정/균형 공식이 없어 다음 규칙의
     단순 휴리스틱으로 구현했습니다: 일반 신청 우선 → 동일 대표는 같은 시간 1명만 →
     일반 신청 캐릭터는 전체 기간 중 최대 1회 배정 → 지원 신청은 시간마다 반복 가능.
     실제 서비스 적용 전 알고리즘 검증이 필요합니다.
   ============================================================ */

/* ---------------- 디자인 토큰 (GuildPartyMatcherAdmin.css로 분리, 포니테일 2-1-4) ---------------- */
/* GlobalStyle 컴포넌트는 CSS import로 대체되어 삭제됨. */


/* ---------------- 시드/유틸 (constants.js / utils.js에서 import) ---------------- */
// DEFAULT_JOBS, DEFAULT_CONTENTS, ROLE_LABEL → src/lib/constants.js
// timeSlots, charFinalPower → src/lib/utils.js

const ROLE_ICON = { tank: Shield, support: HeartPulse, dealer: Swords };
// 신청 유형: "normal" | "support" | "both" (일반+지원, 12.4절). 기존 데이터는 normal/support만 가짐(하위 호환).
const APP_TYPE_LABEL = { normal: "일반", support: "지원", both: "일반+지원" };


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


/* ---------------- 작은 컴포넌트 ---------------- */
function Toast({ message }) {
  if (!message) return null;
  return <div className="gpa-toast">{message}</div>;
}
const RoleBadge = ({ role }) => <span className={`gpa-badge ${role}`}>{ROLE_LABEL[role] || role}</span>;

// 매칭 결과 화면의 미배정 목록 전용 아이콘 배지입니다. RoleBadge는 직업 관리·캐릭터 관리·
// 신청 현황 표에서도 공용으로 쓰이므로 그대로 두고, 이 컴포넌트를 새로 추가해 미배정
// 목록에만 적용합니다 (매칭결과_역할아이콘_교체 요청).
const RoleIconBadge = ({ role }) => {
  const RoleIcon = ROLE_ICON[role];
  return (
    <span className={`gpa-badge-icon ${role}`} title={ROLE_LABEL[role] || role} aria-label={ROLE_LABEL[role] || role}>
      {RoleIcon && <RoleIcon size={13} strokeWidth={2.3} />}
    </span>
  );
};

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
          <label htmlFor="admin-pw" className="gpa-label">관리자 비밀번호</label>
          <input id="admin-pw" type="password" className="gpa-input" value={pw}
            onChange={(e) => { setPw(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="비밀번호 입력" autoFocus 
            aria-invalid={!!error} aria-describedby={error ? "admin-pw-error" : "admin-pw-hint"} />
          {error && <div id="admin-pw-error" className="gpa-error" role="alert">{error}</div>}
          <div id="admin-pw-hint" className="gpa-hint">프로토타입 기본 비밀번호: {config.adminPassword}</div>
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
    <div className="gpa-view">
      <div className="gpa-section-title">
        <div><h2>대시보드</h2><div className="gpa-section-desc">서비스 운영 현황 요약</div></div>
        <button className="gpa-btn gpa-btn-ghost gpa-btn-sm" onClick={onRefresh} disabled={refreshing}>{refreshing ? "새로고침 중..." : "새로고침"}</button>
      </div>
      <div className="gpa-dash-grid cols-3">
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
    onSave({ id: initial?.id || crypto.randomUUID(), name: name.trim(), role, keywords: keywords.trim(), order: Number(order) || 1, active });
  }

  return (
    <div className="gpa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gpa-modal">
        <h3 className="gpa-modal-title">{initial ? "직업 수정" : "직업 등록"}</h3>
        <div className="gpa-field">
          <label htmlFor="job-name" className="gpa-label">직업명</label>
          <input id="job-name" className="gpa-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 창술사" aria-invalid={!!error} aria-errormessage={error ? "job-error" : undefined} />
          {error && <div id="job-error" className="gpa-error" role="alert">{error}</div>}
        </div>
        <div className="gpa-field">
          <label htmlFor="job-role" className="gpa-label">역할</label>
          <select id="job-role" className="gpa-input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="tank">탱커</option><option value="support">서포터</option><option value="dealer">딜러</option>
          </select>
        </div>
        <div className="gpa-field">
          <label htmlFor="job-keywords" className="gpa-label">검색용 키워드</label>
          <input id="job-keywords" className="gpa-input" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="공백으로 구분" />
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}>
            <label htmlFor="job-order" className="gpa-label">표시 순서</label>
            <input id="job-order" className="gpa-input" type="number" value={order} onChange={(e) => setOrder(e.target.value)} />
          </div>
          <div className="gpa-field" style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
            <label htmlFor="job-active" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input id="job-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> 활성화
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
    <div className="gpa-view">
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
      id: initial?.id || crypto.randomUUID(), name: name.trim(),
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
          <label htmlFor="content-name" className="gpa-label">콘텐츠명</label>
          <input id="content-name" className="gpa-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="어비스" aria-invalid={!!error} aria-errormessage={error ? "content-error" : undefined} />
          {error && <div id="content-error" className="gpa-error" role="alert">{error}</div>}
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}><label htmlFor="content-pressure" className="gpa-label">마도 압력 (0=미적용)</label><input id="content-pressure" className="gpa-input" type="number" min="0" value={pressure} onChange={(e) => setPressure(e.target.value)} /></div>
          <div className="gpa-field" style={{ flex: 1 }}><label htmlFor="content-resist" className="gpa-label">필요 마도 저항 (0=제한없음)</label><input id="content-resist" className="gpa-input" type="number" min="0" value={requiredResist} onChange={(e) => setRequiredResist(e.target.value)} /></div>
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}><label htmlFor="content-party-size" className="gpa-label">파티 인원</label><input id="content-party-size" className="gpa-input" type="number" min="2" value={partySize} onChange={(e) => setPartySize(e.target.value)} /></div>
          <div className="gpa-field" style={{ flex: 1 }}><label htmlFor="content-interval" className="gpa-label">시간 간격(분)</label><input id="content-interval" className="gpa-input" type="number" min="5" value={interval} onChange={(e) => setIntervalVal(e.target.value)} /></div>
        </div>
        <div className="gpa-row">
          <div className="gpa-field" style={{ flex: 1 }}><label htmlFor="content-start-time" className="gpa-label">시작 시각</label><input id="content-start-time" className="gpa-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div className="gpa-field" style={{ flex: 1 }}><label htmlFor="content-end-time" className="gpa-label">종료 시각</label><input id="content-end-time" className="gpa-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        <label htmlFor="content-active" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 8 }}>
          <input id="content-active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> 신청 가능(활성화)
        </label>
        <div className="gpa-modal-actions">
          <button className="gpa-btn gpa-btn-ghost" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className="gpa-btn gpa-btn-primary" style={{ flex: 1 }} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

function ContentsView({ contents, onChange, onToast, onAfterDelete, resultsMeta }) {
  const [modal, setModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [busyId, setBusyId] = useState(null);
  const [confirmDeleteContentData, setConfirmDeleteContentData] = useState(null);

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

  async function doDeleteContentData(content) {
    setBusyId(content.id);
    await purgeContentData(content);
    setBusyId(null);
    onToast(`'${content.name}'의 신청/매칭 데이터를 삭제했습니다.`);
    if (onAfterDelete) onAfterDelete();
  }

  return (
    <div className="gpa-view">
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

      <div className="gpa-card" style={{ marginTop: 14 }}>
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>콘텐츠 신청 초기화</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 14 }}>대표 캐릭터, 하위 캐릭터, 직업 목록, 콘텐츠 설정은 삭제되지 않습니다. 이 기능은 선택한 콘텐츠의 신청 내역과 매칭 결과만 삭제합니다. 자동 매칭 실행 후 48시간이 지나면 자동으로 삭제됩니다.</div>
        <div className="gpa-table-wrap">
          <table className="gpa-table">
            <thead><tr><th>콘텐츠</th><th>자동 매칭 실행</th><th>자동 삭제 예정</th><th>남은 시간</th><th></th></tr></thead>
            <tbody>
              {contents.map((c) => {
                const meta = resultsMeta && resultsMeta[c.id];
                const deleteAt = meta ? meta.generatedAt + RETENTION_MS : null;
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{meta ? formatDateTime(meta.generatedAt) : "-"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{deleteAt ? formatDateTime(deleteAt) : "-"}</td>
                    <td>{deleteAt ? <span className={`gpa-badge ${deleteAt - Date.now() <= 0 ? "off" : "on"}`}>{formatRemaining(deleteAt - Date.now())}</span> : <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                    <td><button className="gpa-btn gpa-btn-danger gpa-btn-sm" disabled={busyId === c.id} onClick={() => setConfirmDeleteContentData(c)}>{busyId === c.id ? "삭제 중..." : "지금 삭제"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDeleteContentData && (
        <ConfirmModal
          title="데이터 삭제 확인"
          message={`'${confirmDeleteContentData.name}'의 현재 신청 정보와 매칭 결과를 모두 삭제하시겠습니까?\n삭제된 정보는 복구할 수 없습니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={async () => { const c = confirmDeleteContentData; setConfirmDeleteContentData(null); await doDeleteContentData(c); }}
          onCancel={() => setConfirmDeleteContentData(null)}
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
    <div className="gpa-view">
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
                      <td style={{ whiteSpace: "nowrap" }}>{APP_STATUS_LABEL[app.status] || app.status}</td>
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
function SlotPickModal({ role, unassigned, relocatable, supportCandidates, onPick, onRelocate, onPickSupport, onTemp, onClear, onClose }) {
  const [tempName, setTempName] = useState("");
  const [supportOpen, setSupportOpen] = useState(false);
  const roleCandidates = unassigned.filter((c) => c.char.role === role);
  const relocatableCandidates = relocatable || [];
  const supCands = supportCandidates || [];
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
                <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
                  {c.allowedTimes && c.allowedTimes.length ? c.allowedTimes.join(", ") : c.time}
                </span>
              </button>
            ))}
          </div>
        )}
        {relocatableCandidates.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="gpa-label" style={{ marginBottom: 8 }}>
              다른 시간에 이미 배정됐지만, 이 시간·역할에도 신청한 캐릭터
            </div>
            <div className="gpa-hint" style={{ marginBottom: 8 }}>
              옮기면 원래 있던 자리는 빈 슬롯이 됩니다 — 그 자리도 채울 수 있는지는 옮긴 뒤에 이어서 확인해주세요.
            </div>
            {relocatableCandidates.map((c, i) => (
              <button key={i} className="gpa-pick-btn" onClick={() => onRelocate(c)}>
                <span>{c.char.nickname} <span style={{ color: "var(--text-faint)" }}>({c.repName})</span></span>
                <span style={{ color: "var(--text-faint)", fontSize: 12 }}>현재: {c.currentLoc.time}</span>
              </button>
            ))}
          </div>
        )}
        {/* 지원 가능한 지원자 드롭다운 */}
        {supCands.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <button
              style={{
                width: "100%", background: "var(--bg-elev)", border: "1px solid var(--border-soft)",
                borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center",
                justifyContent: "space-between", cursor: "pointer", color: "var(--text-dim)", fontSize: 13.5
              }}
              onClick={() => setSupportOpen((v) => !v)}
            >
              <span>지원 가능한 지원자 <span style={{ color: "var(--warn)", fontWeight: 700 }}>({supCands.length}명)</span></span>
              <span style={{ fontSize: 11, transition: "transform .2s", display: "inline-block", transform: supportOpen ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
            </button>
            {supportOpen && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {supCands.map((c, i) => (
                  <button key={i} className="gpa-pick-btn" style={{ borderColor: "color-mix(in oklch,  %, transparent)" }} onClick={() => onPickSupport(c)}>
                    <span>
                      {c.char.nickname}
                      <span style={{ color: "var(--text-faint)" }}> ({c.repName})</span>
                      {c.char.role !== role && (
                        <span style={{ fontSize: 11, color: "var(--warn)", marginLeft: 6 }}>역할: {ROLE_LABEL[c.char.role]}</span>
                      )}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                      {c.power !== null && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--accent-soft)" }}>{c.power.toLocaleString()}</span>
                      )}
                      <span style={{ color: "var(--text-faint)", fontSize: 11 }}>지원 신청</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
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
  const [showCreateParty, setShowCreateParty] = useState(false);
  const [createPartyTime, setCreatePartyTime] = useState("");
  const [confirmDeleteParty, setConfirmDeleteParty] = useState(null); // party index or null
  const [engineChoice, setEngineChoice] = useState("stable"); // "stable" | "optimized" — 콘텐츠별로 공유 스토리지(engine-choice:{contentId})에 저장, 다른 관리자도 같은 선택을 봅니다.
  const resultsRef = useRef(null);
  const publicPreviewRef = useRef(null);

  useEffect(() => {
    if (!content) return;
    let cancelled = false;
    (async () => {
      const result = await storageGetSafe(`engine-choice:${content.id}`, true);
      if (cancelled) return;
      if (!result.failed && result.value) {
        try { setEngineChoice(JSON.parse(result.value).engine === "optimized" ? "optimized" : "stable"); }
        catch (e) { setEngineChoice("stable"); }
      } else {
        setEngineChoice("stable");
      }
    })();
    return () => { cancelled = true; };
  }, [content?.id]);

  async function handleEngineChange(v) {
    setEngineChoice(v);
    if (content) await storageSet(`engine-choice:${content.id}`, { engine: v }, true);
  }

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

  const availableTimes = useMemo(() => (content ? timeSlots(content.startTime, content.endTime, content.interval) : []), [content]);

  // 지원 신청자 목록: type이 "support" 또는 "both"인 신청자를 캐릭터 단위로 펼칩니다.
  // matchData가 있으면 파티에 배정된 지원자는 "(배정됨)" 표시합니다.
  const supportApplicants = useMemo(() => {
    if (!content) return [];
    const out = [];
    Object.entries(reps).forEach(([repName, data]) => {
      (data.applications || []).forEach((app) => {
        if (app.contentId !== content.id || app.status === "cancelled") return;
        if (!appliesSupport(app.type)) return;
        (app.characterIds || []).forEach((cid) => {
          const char = (data.subs || []).find((s) => s.id === cid);
          if (!char || char.active === false) return;
          out.push({ repName, char, times: app.times || [], appType: app.type });
        });
      });
    });
    // 중복 제거: 같은 (repName, characterId) 조합은 하나만 유지하고 시간을 합칩니다.
    const map = new Map();
    out.forEach(({ repName, char, times, appType }) => {
      const key = `${repName}:${char.id}`;
      if (!map.has(key)) {
        map.set(key, { repName, char, times: new Set(times), appType });
      } else {
        times.forEach((t) => map.get(key).times.add(t));
      }
    });
    return [...map.values()].map((v) => ({ ...v, times: [...v.times].sort() }));
  }, [content, reps]);

  // 파티에 이미 배정된 (repName, characterId) 조합을 빠르게 찾기 위한 Set
  const assignedKeys = useMemo(() => {
    if (!matchData) return new Set();
    const s = new Set();
    matchData.parties.forEach((p) => {
      p.slots.forEach((slot) => {
        if (slot.repName && slot.characterId) s.add(`${slot.repName}:${slot.characterId}`);
      });
    });
    return s;
  }, [matchData]);

  // repName + characterId로 reps에서 실제 캐릭터를 찾아 최종 전투력을 반환합니다.
  // 임시 캐릭터(characterId 없음)나 데이터 누락 시 null을 반환합니다.
  const getCharFinalPower = useCallback((repName, characterId) => {
    if (!characterId || !content) return null;
    const data = reps[repName];
    if (!data) return null;
    const char = (data.subs || []).find((s) => s.id === characterId);
    if (!char) return null;
    return charFinalPower(char, content);
  }, [reps, content]);

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

  async function doRunMatch(aggressive = false) {
    const engineFn = engineChoice === "optimized" ? runAutoMatchOptimized : runAutoMatchStable;
    const result = engineFn(content, reps, aggressive ? { aggressive: true } : undefined);
    await saveResult({ ...result, engineUsed: engineChoice });
    await setApplicationStatusForContent("matched");
    onToast(aggressive ? "적극적 재매칭을 실행했습니다. (미배정자 추가 배정 시도 포함)" : "자동 매칭을 실행했습니다.");
  }

  async function runMatch() {
    if (matchData && matchData.parties && matchData.parties.length > 0) {
      setShowRematchConfirm(true);
      return;
    }
    await doRunMatch(false);
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
    if (!publicPreviewRef.current) return;
    setDownloadingImage(true);
    try {
      const canvas = await html2canvas(publicPreviewRef.current, {
        backgroundColor: null, // Transparent to let the container background show
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

  // 사용자 화면(ResultsView)이 실제로 공개하는 정보와 동일하게, 역할·닉네임·부족인원만
  // 남기고 나머지(대표캐릭터명, 신청유형, 임시 여부 등)는 제외합니다. 이미지 다운로드가
  // 관리자 편집 화면이 아니라 "사용자에게 보이는 화면"을 담도록 만들기 위한 것입니다.
  const publicResultGroups = useMemo(() => {
    if (!matchData || !content) return {};
    const g = {};
    matchData.parties.forEach((p) => {
      const key = p.time;
      if (!g[key]) g[key] = [];
      g[key].push({
        partyNumber: p.partyNumber,
        slots: (p.slots || []).map((s) => ({ role: s.role, nickname: s.nickname || null, type: s.type || null })),
        shortage: p.shortage || null,
      });
    });
    return g;
  }, [matchData, content]);

  function recomputeShortage(party) {
    const missing = {};
    party.slots.forEach((s) => { if (!s.nickname) missing[s.role] = (missing[s.role] || 0) + 1; });
    const parts = [];
    if (missing.tank) parts.push(`탱커 ${missing.tank}명 부족`);
    if (missing.support) parts.push(`서포터 ${missing.support}명 부족`);
    if (missing.dealer) parts.push(`딜러 ${missing.dealer}명 부족`);
    return parts.length ? parts.join(" · ") : null;
  }

  function createEmptyParty(time) {
    if (!time || !content) return;
    const dealerSlotCount = Math.max(content.partySize - 2, 0);
    const newSlotOrder = ["tank", "support", ...Array(dealerSlotCount).fill("dealer")];
    const base = matchData || { parties: [], unassigned: [], generatedAt: Date.now(), published: false };
    const existingAtTime = base.parties.filter((p) => p.time === time);
    const nextNumber = existingAtTime.length > 0 ? Math.max(...existingAtTime.map((p) => p.partyNumber)) + 1 : 1;
    const newParty = {
      time, partyNumber: nextNumber,
      slots: newSlotOrder.map((role) => ({ role, nickname: null, repName: null, characterId: null, type: null })),
      shortage: null,
    };
    saveResult({ ...base, parties: [...base.parties, newParty] });
    setShowCreateParty(false);
    onToast(`${time} 시간대에 빈 파티를 생성했습니다.`);
  }

  function getAppliedTimesFor(repName, characterId) {
    const data = reps[repName];
    if (!data) return [];
    const times = new Set();
    (data.applications || []).forEach((app) => {
      if (!content || app.contentId !== content.id || app.status === "cancelled") return;
      if ((app.characterIds || []).includes(characterId)) {
        (app.times || []).forEach((t) => times.add(t));
      }
    });
    return [...times];
  }

  /**
   * 미배정 신청자별로 "이렇게 바꾸면 배정 가능" 힌트를 계산합니다.
   * - Type 1(rep 충돌 해소): 빈 슬롯은 있지만 같은 대표 캐릭터가 막고 있을 때,
   *   그 캐릭터를 다른 시간대의 빈 슬롯으로 옮기면 가능.
   * - Type 2(교환 가능): 역할 슬롯이 꽉 찼지만, 그 슬롯 중 하나가
   *   미배정자의 다른 신청 시간에 빈 슬롯이 있어 서로 교환 가능.
   * [Inference] 단순 1-스텝 연산만 검토하며, 연쇄 이동은 고려하지 않습니다.
   */
  const swapHints = useMemo(() => {
    if (!matchData || !content) return {};
    const result = {};

    // 역할별로 빈 슬롯이 있는 파티를 빠르게 조회하기 위한 보조 함수
    function hasEmptyRoleSlot(partyList, role, excludeRepName) {
      return partyList.some((p) => {
        if (excludeRepName && p.slots.some((s) => s.repName === excludeRepName && s.nickname)) return false;
        return p.slots.some((s) => !s.nickname && s.role === role);
      });
    }

    matchData.unassigned.forEach((u, i) => {
      const hints = [];
      const uTimes = u.allowedTimes && u.allowedTimes.length ? u.allowedTimes : [u.time];

      for (const t of uTimes) {
        if (hints.length >= 2) break;
        const partiesAtT = matchData.parties.filter((p) => p.time === t);
        if (partiesAtT.length === 0) continue;

        for (const party of partiesAtT) {
          if (hints.length >= 2) break;

          // --- Type 1: 빈 슬롯은 있지만 같은 대표 캐릭터가 막고 있는 경우 ---
          const emptySlot = party.slots.find((s) => !s.nickname && s.role === u.char.role);
          if (emptySlot) {
            const blocker = party.slots.find((s) => s.repName === u.repName && s.nickname && s.characterId);
            if (blocker) {
              // blocker를 다른 시간의 빈 슬롯으로 옮길 수 있는지 확인
              const blockerTimes = getAppliedTimesFor(blocker.repName, blocker.characterId);
              const otherTimes = blockerTimes.filter((bt) => bt !== t);
              const blockerChar = (reps[blocker.repName]?.subs || []).find((s) => s.id === blocker.characterId);
              if (blockerChar) {
                const canMove = otherTimes.some((bt) => {
                  const partiesAtBt = matchData.parties.filter((p) => p.time === bt);
                  return hasEmptyRoleSlot(partiesAtBt, blockerChar.role, blocker.repName);
                });
                if (canMove) {
                  hints.push({ kind: "rep-conflict", text: `${t} 파티${party.partyNumber}: ${blocker.nickname}을(를) 다른 시간으로 옮기면 배정 가능` });
                }
              }
            }
          }

          // --- Type 2: 역할 슬롯이 모두 찬 경우, 교환 가능한 상대 탐색 ---
          if (!emptySlot) {
            const sameRoleSlots = party.slots.filter(
              (s) => s.nickname && s.role === u.char.role && s.repName !== u.repName && s.characterId
            );
            for (const slot of sameRoleSlots) {
              if (hints.length >= 2) break;
              // 같은 대표 충돌 확인
              const uConflict = party.slots.some((s) => s.repName === u.repName && s.nickname);
              if (uConflict) continue;
              // slot의 캐릭터가 u의 다른 신청 시간 중 어딘가로 옮길 수 있는지 확인
              const slotTimes = getAppliedTimesFor(slot.repName, slot.characterId);
              const slotChar = (reps[slot.repName]?.subs || []).find((s) => s.id === slot.characterId);
              if (!slotChar) continue;
              const swappableTo = slotTimes.find((st) => {
                if (st === t) return false;
                const partiesAtSt = matchData.parties.filter((p) => p.time === st);
                return hasEmptyRoleSlot(partiesAtSt, slotChar.role, slot.repName);
              });
              if (swappableTo) {
                const typeTag = slot.type === "support" ? "(지원) " : "";
                hints.push({ kind: "swap", text: `${t} 파티${party.partyNumber}: ${slot.nickname}${typeTag}을(를) ${swappableTo}로 옮기면 이 자리에 배정 가능` });
              }
            }
          }
        }
      }

      if (hints.length > 0) result[i] = hints;
    });

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchData, reps, content]);

  function deleteParty(partyIdx) {
    const party = matchData.parties[partyIdx];
    // 이 파티에 배정되어 있던 인원은 삭제하지 않고 미배정 목록으로 돌려보냅니다.
    const returned = party.slots
      .filter((s) => s.nickname && s.characterId) // 임시 캐릭터(characterId 없음)는 미배정 목록으로 보내지 않음
      .map((s) => {
        const allowedTimes = getAppliedTimesFor(s.repName, s.characterId);
        return {
          repName: s.repName, type: s.type, time: party.time,
          char: { id: s.characterId, nickname: s.nickname, role: s.role, power: 0, resist: 0 },
          allowedTimes: allowedTimes.length ? allowedTimes : [party.time],
          reason: "파티 삭제로 제외됨",
        };
      });
    const parties = matchData.parties.filter((_, i) => i !== partyIdx);
    saveResult({ ...matchData, parties, unassigned: [...matchData.unassigned, ...returned] });
    onToast(`파티 ${party.partyNumber}을(를) 삭제했습니다.`);
  }

  function assignToSlot(partyIdx, slotIdx, newSlotValue, consumedCandidate) {
    // 같은 대표 캐릭터가 이미 이 파티의 다른 자리에 있으면 배정을 막습니다 (드래그드롭 중복배정 방지 요청).
    if (newSlotValue.repName) {
      const targetParty = matchData.parties[partyIdx];
      const conflict = matchData.parties.some((p, pIdx) => {
        if (p.time !== targetParty.time) return false;
        return p.slots.some((s, si) => {
          if (pIdx === partyIdx && si === slotIdx) return false;
          return s.repName === newSlotValue.repName;
        });
      });
      if (conflict) { onToast("해당 대표 캐릭터가 이미 동시간대의 파티에 배정되어 있어 중복 배정할 수 없습니다."); return; }
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
      // 기존 배정자를 미배정 목록으로 되돌림 (임시 캐릭터는 미배정 목록에 넣지 않음). 신청한 시간
      // 전체를 다시 조회해서 되돌아간 사람의 "신청:" 표시가 지금 이 슬롯의 시간 하나로 좁아지지
      // 않도록 합니다(교환_되돌림_신청시간_누락_요청, 2026-07-09).
      const allowedTimes = getAppliedTimesFor(oldSlot.repName, oldSlot.characterId);
      unassigned = [...unassigned, {
        repName: oldSlot.repName, type: oldSlot.type, time: parties[partyIdx].time,
        char: { id: oldSlot.characterId, nickname: oldSlot.nickname, role: oldSlot.role, power: 0, resist: 0 },
        allowedTimes: allowedTimes.length ? allowedTimes : [parties[partyIdx].time],
        reason: "파티 편집 중 제외됨",
      }];
    }
    saveResult({ ...matchData, parties, unassigned });
  }

  // 슬롯 시간에 지원 신청한 사람 중, 미배정 목록·다른시간배정 목록에 이미 노출된 사람은 제외합니다.
  function getAvailableSupportCandidates(slotRole, time) {
    if (!matchData || !content || !reps) return [];
    // 이미 위 섹션에 보이는 사람 키 집합 (repName:characterId)
    const shownKeys = new Set();
    (matchData.unassigned || []).forEach((u) => shownKeys.add(`${u.repName}:${u.char.id}`));
    getRelocatableCandidates(slotRole, time).forEach((c) => shownKeys.add(`${c.repName}:${c.char.id}`));
    // 현재 시간대의 모든 파티에 이미 있는 대표명 수집
    const timeRepNames = new Set();
    matchData.parties.forEach((p, pIdx) => {
      if (p.time === time) {
        p.slots.forEach((s, sIdx) => {
          if (editSlot && editSlot.partyIdx === pIdx && editSlot.slotIdx === sIdx) return;
          if (s.repName) timeRepNames.add(s.repName);
        });
      }
    });

    const result = [];
    Object.entries(reps).forEach(([repName, data]) => {
      (data.applications || []).forEach((app) => {
        if (!content || app.contentId !== content.id || app.status === "cancelled") return;
        if (!(app.type === "support" || app.type === "both")) return; // 지원 신청만
        if (!(app.times || []).includes(time)) return;               // 이 시간 신청만
        (app.characterIds || []).forEach((cid) => {
          const char = (data.subs || []).find((s) => s.id === cid);
          if (!char || char.active === false) return;
          const key = `${repName}:${cid}`;
          if (shownKeys.has(key)) return;      // 이미 위 섹션에 노출
          if (timeRepNames.has(repName)) return; // 이미 동시간대 파티에 있는 대표
          const power = content ? charFinalPower(char, content) : null;
          result.push({ repName, char, appType: app.type, times: app.times || [], power });
        });
      });
    });
    // 전투력 내림차순 정렬
    result.sort((a, b) => (b.power || 0) - (a.power || 0));
    // 중복 제거 (같은 repName:charId가 여러 신청에 걸쳐 올 수 있음)
    const seen = new Set();
    return result.filter(({ repName, char }) => {
      const k = `${repName}:${char.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function getRelocatableCandidates(role, time) {
    if (!matchData || !content) return [];
    const found = [];
    const seen = new Set();
    Object.entries(reps).forEach(([repName, data]) => {
      (data.applications || []).forEach((app) => {
        if (app.contentId !== content.id || app.status === "cancelled") return;
        if (!(app.times || []).includes(time)) return;
        (app.characterIds || []).forEach((cid) => {
          const char = (data.subs || []).find((s) => s.id === cid);
          if (!char || char.active === false || char.role !== role) return;
          const key = `${repName}:${cid}`;
          if (seen.has(key)) return;
          let currentLoc = null;
          let conflictAtTime = false;
          matchData.parties.forEach((p, pIdx) => {
            if (p.time === time) {
              p.slots.forEach((s, sIdx) => {
                if (editSlot && editSlot.partyIdx === pIdx && editSlot.slotIdx === sIdx) return;
                if (s.repName === repName) conflictAtTime = true;
              });
            }
            p.slots.forEach((s, sIdx) => {
              if (s.characterId === cid && s.repName === repName) {
                currentLoc = { partyIdx: pIdx, slotIdx: sIdx, time: p.time, slotType: s.type };
              }
            });
          });
          if (!currentLoc || currentLoc.time === time || conflictAtTime) return; // 미배정 목록에 이미 있거나, 이미 이 시간에 배정됨, 혹은 동시간대 동일대표 있음
          seen.add(key);
          found.push({ repName, char, currentLoc });
        });
      });
    });
    return found;
  }

  // "이동 후보"(다른 시간에 이미 배정된 캐릭터)를 이 슬롯으로 옮깁니다. 원래 있던 자리는 빈 슬롯으로
  // 남습니다 — 그 자리가 다시 부족 인원으로 표시되니, 그 자리도 채울 수 있는지는 관리자가 이어서
  // 판단하시면 됩니다.
  function relocateExistingToSlot(cand) {
    if (!editSlot) return;
    const { partyIdx, slotIdx } = editSlot;
    const { partyIdx: fromPartyIdx, slotIdx: fromSlotIdx, slotType } = cand.currentLoc;
    if (fromPartyIdx === partyIdx && fromSlotIdx === slotIdx) { setEditSlot(null); return; }
    const targetParty = matchData.parties[partyIdx];
    const newSlotValue = { role: cand.char.role, nickname: cand.char.nickname, repName: cand.repName, characterId: cand.char.id, type: slotType };
    const conflict = matchData.parties.some((p, pIdx) => {
      if (p.time !== targetParty.time) return false;
      return p.slots.some((s, si) => {
        if (pIdx === partyIdx && si === slotIdx) return false;
        return s.repName === cand.repName;
      });
    });
    if (conflict) { onToast("해당 대표 캐릭터가 이미 동시간대의 다른 파티에 배정되어 있어 중복 배정할 수 없습니다."); return; }
    const parties = matchData.parties.map((p, i) => {
      const isTarget = i === partyIdx, isSource = i === fromPartyIdx;
      if (!isTarget && !isSource) return p;
      const slots = p.slots.map((s, si) => {
        if (isTarget && si === slotIdx) return newSlotValue;
        if (isSource && si === fromSlotIdx) return { role: s.role, nickname: null, repName: null, characterId: null, type: null };
        return s;
      });
      const np = { ...p, slots };
      np.shortage = recomputeShortage(np);
      return np;
    });
    saveResult({ ...matchData, parties });
    setEditSlot(null);
    onToast(`${cand.char.nickname}을(를) 이 자리로 옮겼습니다. 원래 있던 자리는 빈 슬롯이 되었습니다.`);
  }


  function commitSlotEdit(newSlotValue, consumedCandidate) {
    const { partyIdx, slotIdx } = editSlot;
    assignToSlot(partyIdx, slotIdx, newSlotValue, consumedCandidate);
    setEditSlot(null);
  }

  // 슬롯↔슬롯 드래그: 역할 제한 없이 두 슬롯의 내용을 맞바꿉니다 (관리자가 파티 구성을 임의로 변경 가능).
  function swapSlots(sourcePartyIdx, sourceSlotIdx, targetPartyIdx, targetSlotIdx) {
    if (sourcePartyIdx === targetPartyIdx && sourceSlotIdx === targetSlotIdx) return;
    const sourceSlot = matchData.parties[sourcePartyIdx].slots[sourceSlotIdx];
    const targetSlot = matchData.parties[targetPartyIdx].slots[targetSlotIdx];
    // 역할 제한 없이 관리자가 임의로 파티 구성을 바꿀 수 있도록, 같은 역할끼리만 이동 가능하다는
    // 제약을 없앴습니다. 슬롯 내용(역할 포함)을 통째로 맞바꿔서, role 필드가 계속
    // "지금 이 자리에 실제로 있는 캐릭터의 역할"을 반영하도록 유지합니다.
    if (sourcePartyIdx !== targetPartyIdx) {
      const targetParty = matchData.parties[targetPartyIdx];
      const sourceParty = matchData.parties[sourcePartyIdx];
      const conflictAtTarget = sourceSlot.repName && matchData.parties.some((p, pIdx) => p.time === targetParty.time && p.slots.some((s, si) => !(pIdx === targetPartyIdx && si === targetSlotIdx) && !(pIdx === sourcePartyIdx && si === sourceSlotIdx) && s.repName === sourceSlot.repName));
      const conflictAtSource = targetSlot.repName && matchData.parties.some((p, pIdx) => p.time === sourceParty.time && p.slots.some((s, si) => !(pIdx === sourcePartyIdx && si === sourceSlotIdx) && !(pIdx === targetPartyIdx && si === targetSlotIdx) && s.repName === targetSlot.repName));
      if (conflictAtTarget || conflictAtSource) { onToast("해당 대표 캐릭터가 이미 그 시간대의 파티에 있어 맞바꿀 수 없습니다."); return; }
    }
    const newSource = { ...targetSlot };
    const newTarget = { ...sourceSlot };
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
    if (dragItem.kind === "slot") {
      swapSlots(dragItem.partyIdx, dragItem.slotIdx, targetPartyIdx, targetSlotIdx);
    } else if (dragItem.kind === "unassigned") {
      const cand = dragItem.candidate;
      // role은 슬롯의 기존 자리 종류(targetRole)가 아니라, 실제로 배정되는 캐릭터의 역할을 따릅니다.
      assignToSlot(targetPartyIdx, targetSlotIdx, { role: cand.char.role, nickname: cand.char.nickname, repName: cand.repName, characterId: cand.char.id, type: cand.type }, cand);
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
    <div className="gpa-view">
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
        <div className="gpa-action-bar">
          {/* 주 액션 행: 매칭 실행 + 공개/비공개 */}
          <div className="gpa-action-row">
            <select
              className="gpa-input"
              style={{ width: 132, flex: "0 0 auto" }}
              value={engineChoice}
              onChange={(e) => handleEngineChange(e.target.value)}
              title="자동 매칭에 사용할 로직을 선택합니다."
            >
              <option value="stable">안정형</option>
              <option value="optimized">균형최적화형</option>
            </select>
            <button className="gpa-btn gpa-btn-primary" onClick={runMatch} disabled={preview.candidateCount === 0}>
              {matchData ? "재매칭 실행" : "자동 매칭 실행"}
            </button>
            {matchData && (
              <button className="gpa-btn gpa-btn-ghost" onClick={togglePublish}>
                {matchData.published ? "결과 비공개로" : "결과 공개하기"}
              </button>
            )}
          </div>
          {/* 보조 액션 행: 이미지·새로고침·파티생성 */}
          <div className="gpa-action-row">
            {matchData && matchData.parties.length > 0 && (
              <button className="gpa-btn gpa-btn-ghost" onClick={downloadResultsImage} disabled={downloadingImage}>
                {downloadingImage ? "생성 중..." : "🖼 이미지 저장"}
              </button>
            )}
            <button
              className="gpa-btn gpa-btn-ghost"
              disabled={loadingResult}
              onClick={async () => { await loadResult(); if (onDataChanged) await onDataChanged(); onToast("새로고침했습니다."); }}
            >
              {loadingResult ? "새로고침 중..." : "↻ 새로고침"}
            </button>
            <button
              className="gpa-btn gpa-btn-ghost"
              onClick={() => { setCreatePartyTime(availableTimes[0] || ""); setShowCreateParty(true); }}
              disabled={availableTimes.length === 0}
            >
              + 파티 생성
            </button>
          </div>
        </div>
      </div>

      {showCreateParty && (
        <div className="gpa-modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setShowCreateParty(false)}>
          <div className="gpa-modal">
            <h3 className="gpa-modal-title">빈 파티 생성</h3>
            <div className="gpa-field">
              <label className="gpa-label">시작 시각</label>
              <select className="gpa-input" value={createPartyTime} onChange={(e) => setCreatePartyTime(e.target.value)}>
                {availableTimes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <div className="gpa-hint">아무도 배정되지 않은 빈 파티가 이 시간대에 추가됩니다.</div>
            </div>
            <div className="gpa-modal-actions">
              <button className="gpa-btn gpa-btn-ghost" style={{ flex: 1 }} onClick={() => setShowCreateParty(false)}>취소</button>
              <button className="gpa-btn gpa-btn-primary" style={{ flex: 1 }} onClick={() => createEmptyParty(createPartyTime)}>생성</button>
            </div>
          </div>
        </div>
      )}

      {loadingResult ? (
        <div className="gpa-card"><div className="gpa-empty">불러오는 중...</div></div>
      ) : !matchData || matchData.parties.length === 0 ? (
        <div className="gpa-card"><div className="gpa-empty">아직 실행된 매칭 결과가 없습니다.</div></div>
      ) : (
        <div className="gpa-card" ref={resultsRef}>
          <div className="gpa-section-title">
            <h2 style={{ fontSize: 14 }}>결과 편집 {matchData.published ? <span className="gpa-badge on" style={{ marginLeft: 8 }}>공개됨</span> : <span className="gpa-badge off" style={{ marginLeft: 8 }}>비공개</span>}</h2>
            <div className="gpa-section-desc">슬롯을 드래그해서 옮기거나, 클릭해서 임시 캐릭터 입력·비우기를 할 수 있습니다. (역할 제한 없이 자유롭게 이동 가능)</div>
          </div>
          <div className="gpa-hint" style={{ marginBottom: 16 }}>
            자동 매칭 실행: {formatDateTime(matchData.generatedAt)} ·{" "}
            {matchData.engineUsed === "optimized" ? "균형최적화형" : matchData.engineUsed === "stable" ? "안정형" : "(로직 기록 없음 — 이 기능 도입 이전 결과)"} ·{" "}
            자동 삭제 예정: {formatDateTime(matchData.generatedAt + RETENTION_MS)} ·{" "}
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
                    <div className="gpa-party-top">
                      <span>파티 {p.partyNumber}</span>
                      {(() => {
                        const powers = p.slots
                          .filter((s) => s.nickname && s.characterId)
                          .map((s) => getCharFinalPower(s.repName, s.characterId))
                          .filter((v) => v !== null);
                        const avg = powers.length > 0 ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : null;
                        return avg !== null ? (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-faint)" }}>평균 {avg.toLocaleString()}</span>
                        ) : null;
                      })()}
                      <button
                        type="button"
                        className="gpa-party-delete-btn"
                        title="파티 삭제"
                        aria-label="파티 삭제"
                        onClick={() => setConfirmDeleteParty(p._idx)}
                      >
                        ×
                      </button>
                    </div>
                    {p.slots.map((s, si) => {
                      const key = `${p._idx}-${si}`;
                      const cls = ["gpa-slot", s.nickname ? s.role : "empty"];
                      if (dragItem && dragItem.kind === "slot" && dragItem.partyIdx === p._idx && dragItem.slotIdx === si) cls.push("dragging");
                      if (dragOverKey === key) cls.push("dragover");
                      const slotPower = s.characterId ? getCharFinalPower(s.repName, s.characterId) : null;
                      return (
                        <div
                          key={si}
                          className={cls.join(" ")}
                          draggable={!!s.nickname}
                          role="button"
                          tabIndex={0}
                          onClick={() => setEditSlot({ partyIdx: p._idx, slotIdx: si, role: s.role })}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditSlot({ partyIdx: p._idx, slotIdx: si, role: s.role }); } }}
                          onDragStart={(e) => { if (!s.nickname) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", key); setDragItem({ kind: "slot", partyIdx: p._idx, slotIdx: si, role: s.role }); }}
                          onDragEnd={() => { setDragItem(null); setDragOverKey(null); }}
                          onDragOver={(e) => { if (!dragItem) return; e.preventDefault(); if (dragOverKey !== key) setDragOverKey(key); }}
                          onDragLeave={() => { if (dragOverKey === key) setDragOverKey(null); }}
                          onDrop={(e) => { e.preventDefault(); handleDropOnSlot(p._idx, si, s.role); }}
                        >
                          <span className={`gpa-slot-role ${s.role}`} title={ROLE_LABEL[s.role]} aria-label={ROLE_LABEL[s.role]}>
                            {ROLE_ICON[s.role] && React.createElement(ROLE_ICON[s.role], { size: 14, strokeWidth: 2.3 })}
                          </span>
                          {s.nickname ? (
                            <span className="gpa-slot-name">
                              {s.nickname}
                              {s.type === "temp" && <span className="gpa-slot-tag"> · 임시</span>}
                              {s.type === "support" && <span className="gpa-slot-tag gpa-slot-tag-support"> · 지원</span>}
                            </span>
                          ) : <span className="gpa-slot-empty">빈자리</span>}
                          {slotPower !== null && (
                            <span className="gpa-slot-tag" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent-soft)", marginLeft: "auto" }}>
                              {slotPower.toLocaleString()}
                            </span>
                          )}
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
              <div className="gpa-hint" style={{ marginBottom: 8 }}>카드를 파티 슬롯으로 드래그하면 바로 배정됩니다. (역할 제한 없이 아무 슬롯에나 놓을 수 있어요)</div>
              <div className="gpa-unassigned-list">
                {matchData.unassigned.map((u, i) => {
                  const uPower = getCharFinalPower(u.repName, u.char.id);
                  const uHints = swapHints[i] || [];
                  return (
                    <div
                      key={i}
                      className={`gpa-unassigned-row ${dragItem && dragItem.kind === "unassigned" && dragItem.candidate === u ? "dragging" : ""}`}
                      style={{ flexWrap: "wrap", alignItems: "flex-start", gap: 6 }}
                      draggable
                      role="listitem"
                      tabIndex={0}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", `unassigned-${i}`); setDragItem({ kind: "unassigned", candidate: u, role: u.char.role }); }}
                      onDragEnd={() => { setDragItem(null); setDragOverKey(null); }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                        <RoleIconBadge role={u.char.role} />
                        <span>{u.char.nickname} ({u.repName})</span>
                        {uPower !== null && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent-soft)" }}>{uPower.toLocaleString()}</span>
                        )}
                        <span style={{ color: "var(--text-faint)" }}>
                          신청: {u.allowedTimes && u.allowedTimes.length ? u.allowedTimes.join(", ") : u.time}
                        </span>
                        <span style={{ marginLeft: "auto", color: "var(--text-faint)" }}>{u.reason}</span>
                      </div>
                      {uHints.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingLeft: 30 }}>
                          {uHints.map((h, hi) => (
                            <span
                              key={hi}
                              style={{
                                fontSize: 11.5,
                                padding: "2px 8px",
                                borderRadius: 8,
                                background: h.kind === "rep-conflict" ? "color-mix(in oklch,  %, transparent)" : "color-mix(in oklch,  %, transparent)",
                                color: h.kind === "rep-conflict" ? "var(--warn)" : "var(--tank)",
                                border: `1px solid ${h.kind === "rep-conflict" ? "color-mix(in oklch,  %, transparent)" : "color-mix(in oklch,  %, transparent)"}`,
                                lineHeight: 1.5,
                              }}
                            >
                              💡 {h.text}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {supportApplicants.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <div className="gpa-time-title" style={{ color: "var(--warn)" }}>지원 신청자 ({supportApplicants.length}명)</div>
              <div className="gpa-hint" style={{ marginBottom: 8 }}>지원 신청자는 자동 매칭 시 빈 슬롯을 채우는 후보 풀입니다. 이미 파티에 배정된 경우 <span style={{ color: "var(--success)", fontWeight: 700 }}>배정됨</span>으로 표시됩니다.</div>
              <div className="gpa-unassigned-list">
                {supportApplicants.map((sc, i) => {
                  const isAssigned = assignedKeys.has(`${sc.repName}:${sc.char.id}`);
                  const scPower = content ? charFinalPower(sc.char, content) : null;
                  return (
                    <div
                      key={i}
                      className="gpa-unassigned-row"
                      style={{ opacity: isAssigned ? 0.55 : 1, cursor: "default" }}
                    >
                      <RoleIconBadge role={sc.char.role} />
                      <span>{sc.char.nickname} <span style={{ color: "var(--text-faint)" }}>({sc.repName})</span></span>
                      <span className={`gpa-badge ${sc.appType === "both" ? "combo" : "supportApp"}`} style={{ fontSize: 11 }}>
                        {APP_TYPE_LABEL[sc.appType] || sc.appType}
                      </span>
                      {scPower !== null && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent-soft)" }}>{scPower.toLocaleString()}</span>
                      )}
                      <span style={{ color: "var(--text-faint)" }}>신청: {sc.times.join(", ")}</span>
                      {isAssigned && (
                        <span style={{ marginLeft: "auto", color: "var(--success)", fontWeight: 700, fontSize: 12 }}>배정됨</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 이미지 다운로드 전용 숨김 렌더링: 사용자 화면(ResultsView)이 실제로 보여주는 정보와
          동일하게(역할·닉네임·부족인원만) 구성합니다. 화면 밖으로 배치해 사람 눈에는 안 보이지만
          html2canvas는 캡처할 수 있습니다. */}
      {matchData && content && (
        <div style={{ position: "fixed", top: 0, left: "-99999px", width: 900 }}>
          <div ref={publicPreviewRef} style={{ background: "var(--bg)", padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-dim)", marginBottom: 16 }}>{content.name}</div>
            {Object.entries(publicResultGroups).map(([time, parties]) => {
              const totalParticipants = parties.reduce((acc, p) => acc + p.slots.filter(s => s.nickname).length, 0);
              return (
                <div key={time} style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 12px" }}>
                    <h3 style={{ fontSize: 20, color: "var(--text)", fontWeight: 800, margin: 0 }}>{time} 출발</h3>
                    <span style={{ fontSize: 13, background: "var(--surface-2)", color: "var(--text-dim)", padding: "4px 10px", borderRadius: 20, fontWeight: 600, marginLeft: 10 }}>총 {totalParticipants}명</span>
                    <div style={{ flex: 1, height: 1, background: "var(--border-soft)", marginLeft: 12 }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px,1fr))", gap: 12 }}>
                    {parties.map((p) => (
                      <div key={p.partyNumber} className="gpa-party-card">
                        <div className="gpa-party-top" style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", fontFamily: "var(--font-display)" }}><span>파티 {p.partyNumber}</span></div>
                        {p.slots.map((s, si) => {
                          const isSupport = s.type === "support" || (s.nickname && s.nickname.includes("(지원)"));
                          const displayName = s.nickname ? s.nickname.replace("(지원)", "").trim() : "";
                          return (
                            <div key={si} className={`gpa-slot ${s.nickname ? s.role : "empty"}`} style={{ cursor: "default" }}>
                              <span className={`gpa-slot-role ${s.role}`} title={ROLE_LABEL[s.role]} aria-label={ROLE_LABEL[s.role]}>
                                {ROLE_ICON[s.role] && React.createElement(ROLE_ICON[s.role], { size: 14, strokeWidth: 2.3 })}
                              </span>
                              {s.nickname ? (
                                <span className="gpa-slot-name">
                                  {displayName}
                                  {isSupport && (
                                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: 6, color: "var(--gold)", background: "color-mix(in oklch,  %, transparent)", borderRadius: "50%", width: 18, height: 18 }} title="지원 신청">
                                      <Bird size={12} strokeWidth={2.2} />
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="gpa-slot-empty">모집 중</span>
                              )}
                            </div>
                          );
                        })}
                        {p.shortage && <div className="gpa-party-short" style={{ marginTop: 10, fontSize: 13, color: "var(--danger)", background: "color-mix(in oklch,  %, transparent)", padding: "8px 10px", borderRadius: 8 }}>부족 인원: {p.shortage}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editSlot && matchData && (() => {
        const slotTime = matchData.parties[editSlot.partyIdx].time;
        const supCands = getAvailableSupportCandidates(editSlot.role, slotTime);
        return (
          <SlotPickModal
            role={editSlot.role}
            unassigned={matchData.unassigned || []}
            relocatable={getRelocatableCandidates(editSlot.role, slotTime)}
            supportCandidates={supCands}
            onPick={pickFromUnassigned}
            onRelocate={relocateExistingToSlot}
            onPickSupport={(c) => {
              const { partyIdx, slotIdx } = editSlot;
              assignToSlot(partyIdx, slotIdx, { role: c.char.role, nickname: c.char.nickname, repName: c.repName, characterId: c.char.id, type: "support" }, null);
              setEditSlot(null);
            }}
            onTemp={setTempSlot}
            onClear={clearSlot}
            onClose={() => setEditSlot(null)}
          />
        );
      })()}

      {showRematchConfirm && (
        <ConfirmModal
          title="재매칭 확인"
          message={"미배정자 추가 배정을 시도하는 적극적 재매칭을 실행합니다.\n기존 배정 결과와 관리자가 수정한 내용은 모두 초기화됩니다.\n(Pass A: 지원 슬롯 교체 → Pass B: 일반 배정자와 교환)"}
          confirmLabel="재매칭 실행"
          danger
          onConfirm={async () => { setShowRematchConfirm(false); await doRunMatch(true); }}
          onCancel={() => setShowRematchConfirm(false)}
        />
      )}

      {confirmDeleteParty !== null && matchData && matchData.parties[confirmDeleteParty] && (
        <ConfirmModal
          title="파티 삭제"
          message={`'${matchData.parties[confirmDeleteParty].time} · 파티 ${matchData.parties[confirmDeleteParty].partyNumber}'을(를) 삭제하시겠습니까?\n배정되어 있던 캐릭터는 미배정 목록으로 돌아갑니다 (임시 캐릭터는 그냥 사라집니다).`}
          confirmLabel="삭제"
          danger
          onConfirm={() => { const idx = confirmDeleteParty; setConfirmDeleteParty(null); deleteParty(idx); }}
          onCancel={() => setConfirmDeleteParty(null)}
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
          id: crypto.randomUUID(), contentId: content.id, contentName: content.name,
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
                      <td><input className="gpa-input" style={{ minWidth: 100 }} value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} aria-label="캐릭터 닉네임" /></td>
                      <td>
                        <select className="gpa-input" style={{ minWidth: 100 }} value={draft.jobId} onChange={(e) => setDraft({ ...draft, jobId: e.target.value })} aria-label="직업 선택">
                          <option value="">직업 선택</option>
                          {jobs.filter((j) => j.active !== false || j.id === draft.jobId).map((j) => <option key={j.id} value={j.id}>{j.name} ({ROLE_LABEL[j.role]})</option>)}
                        </select>
                      </td>
                      <td><input className="gpa-input" style={{ width: 90 }} type="number" min="0" value={draft.power} onChange={(e) => setDraft({ ...draft, power: e.target.value })} aria-label="기본전투력" /></td>
                      <td><input className="gpa-input" style={{ width: 90 }} type="number" min="0" value={draft.resist} onChange={(e) => setDraft({ ...draft, resist: e.target.value })} aria-label="마도저항" /></td>
                      <td><input className="gpa-input" style={{ width: 80 }} type="number" min="0" value={draft.penalty} onChange={(e) => setDraft({ ...draft, penalty: e.target.value })} aria-label="패널티" /></td>
                      <td>
                        <label htmlFor={`char-active-${char.id}`} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                          <input id={`char-active-${char.id}`} type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
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
   관리자 메뉴 (비밀번호 + 시스템 연동)
   ============================================================ */
function PasswordView({ config, onChange, onToast, reps, contents, onAfterDelete }) {
  const [guildPw, setGuildPw] = useState(config.password || "");
  const [adminPw, setAdminPw] = useState(config.adminPassword || "");
  const [guildError, setGuildError] = useState("");
  const [adminError, setAdminError] = useState("");
  const [confirmSave, setConfirmSave] = useState(null); // 'guild' | 'admin' | null

  const [bulkApplying, setBulkApplying] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [confirmBulkApply, setConfirmBulkApply] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);

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

    const items = [];
    for (const repName of repNames) {
      const data = reps[repName];
      const next = { ...data, applications: [...(data.applications || []), ...byRep[repName]] };
      items.push({ key: `rep:${repName}`, value: next, shared: true });
    }
    await storageSetMany(items, { skipMirror: true });
    await syncMirror();

    setBulkApplying(false);
    onToast(`백업(${backup.name})을 만든 뒤, 대표 캐릭터 ${repNames.length}명에 걸쳐 총 ${totalApps}건의 테스트 신청을 생성했습니다.`);
    if (onAfterDelete) onAfterDelete();
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
    if (onAfterDelete) onAfterDelete();
  }

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
    <div className="gpa-view">
      <div className="gpa-section-title"><div><h2>관리자 메뉴</h2><div className="gpa-section-desc">길드 파티 매칭의 시스템 설정과 비밀번호를 관리합니다.</div></div></div>

      <div className="gpa-card">
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>길드 공용 비밀번호</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 12 }}>사용자 화면의 길드 입장 화면에서 길드원이 입력하는 비밀번호입니다.</div>
        <div className="gpa-row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <input id="guild-pw" className="gpa-input" value={guildPw} onChange={(e) => { setGuildPw(e.target.value); setGuildError(""); }} placeholder="길드 공용 비밀번호" aria-label="길드 공용 비밀번호" aria-invalid={!!guildError} aria-errormessage={guildError ? "guild-pw-error" : undefined} />
            {guildError && <div id="guild-pw-error" className="gpa-error" role="alert">{guildError}</div>}
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
            <input id="system-admin-pw" className="gpa-input" value={adminPw} onChange={(e) => { setAdminPw(e.target.value); setAdminError(""); }} placeholder="관리자 비밀번호" aria-label="관리자 비밀번호" aria-invalid={!!adminError} aria-errormessage={adminError ? "admin-pw-error-2" : undefined} />
            {adminError && <div id="admin-pw-error-2" className="gpa-error" role="alert">{adminError}</div>}
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

      <div className="gpa-card" style={{ marginTop: 14 }}>
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>구글 시트 연동</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 14 }}>
          직업/콘텐츠/캐릭터/신청 데이터는 앱에서 저장할 때마다 구글 시트의 "jobs" · "contents" · "characters" · "applications" 탭에 자동으로 복사됩니다.
          시트에서 직접 값을 고쳤다면, 아래 버튼을 눌러야 이 앱에 반영됩니다 (자동으로는 반영되지 않습니다).
        </div>
        <button className="gpa-btn gpa-btn-primary gpa-btn-sm" disabled={pulling} onClick={() => setConfirmPull(true)}>{pulling ? "불러오는 중..." : "구글 시트에서 다시 불러오기"}</button>
      </div>

      <div className="gpa-card" style={{ marginTop: 14 }}>
        <div className="gpa-section-title"><h2 style={{ fontSize: 14 }}>테스트용 일괄 신청</h2></div>
        <div className="gpa-hint" style={{ marginBottom: 14 }}>
          현재 등록된 전체 캐릭터가, 활성화된 모든 콘텐츠에 각각 신청합니다. 캐릭터×콘텐츠 조합마다 신청 유형(일반/지원/일반+지원)은 무작위, 신청 시간은 해당 콘텐츠의 가능한 시간대 중 2~3개를 무작위로 선택합니다.
          필요 마도 저항을 충족하지 못하는 조합은 제외됩니다. 실행 전에 구글 시트의 kv 탭을 자동으로 백업합니다.
        </div>
        <button className="gpa-btn gpa-btn-primary gpa-btn-sm" disabled={bulkApplying} onClick={() => setConfirmBulkApply(true)}>{bulkApplying ? "처리 중..." : "테스트용 일괄 신청 실행"}</button>
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
    </div>
  );
}

/* ============================================================
   캐릭터 목록
   ============================================================ */
function DataView({ jobs, reps, onUpdateCharacter, onDeleteCharacter }) {
  return (
    <div>
      <div className="gpa-section-title"><div><h2>캐릭터 목록</h2><div className="gpa-section-desc">등록된 모든 캐릭터 정보를 확인하고 수정할 수 있습니다.</div></div></div>
      <AllCharactersSection reps={reps} jobs={jobs} onUpdateCharacter={onUpdateCharacter} onDeleteCharacter={onDeleteCharacter} />
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
  { key: "data", label: "캐릭터 목록" },
  { key: "password", label: "관리자 메뉴" },
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

  // 48시간 자동 삭제는 Apps Script 시간 트리거(cleanExpiredResults)가 서버에서 단일 경로로
  // 처리합니다. 클라이언트 폴링 루프는 서버 트리거와의 중복 삭제 경쟁(행 번호 밀림) 위험이
  // 있어 제거되었습니다(클라이언트_자동삭제루프_제거_요청_프롬프트, 2026-07-08). 수동
  // "매칭 삭제" 버튼과 purgeContentData는 그대로 유지됩니다.

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
          <span className="gpa-brand-title">두두파 2.0</span>
        </div>
        <a href="/" className="gpa-btn gpa-btn-ghost gpa-btn-sm" style={{ textDecoration: "none" }}>USER PAGE</a>
      </div>
      <div className="gpa-nav">
        {NAV_ITEMS.map((n) => <button key={n.key} className={`gpa-nav-item ${view === n.key ? "active" : ""}`} onClick={() => setView(n.key)}>{n.label}</button>)}
      </div>

      {view === "dashboard" && <Dashboard config={config} reps={reps} resultsMeta={resultsMeta} onRefresh={refresh} refreshing={refreshing} />}
      {view === "jobs" && <JobsView jobs={config.jobs} onChange={(jobs) => updateConfig({ jobs })} />}
      {view === "contents" && <ContentsView contents={config.contents} onChange={(contents) => updateConfig({ contents })} onToast={showToast} onAfterDelete={refresh} resultsMeta={resultsMeta} />}
      {view === "applications" && <ApplicationsView contents={config.contents} reps={reps} onExcludeCharacter={excludeCharacter} />}
      {view === "matching" && <MatchingView contents={config.contents} reps={reps} onToast={showToast} onDataChanged={refresh} />}
      {view === "data" && <DataView jobs={config.jobs} reps={reps} onUpdateCharacter={updateCharacterAdmin} onDeleteCharacter={deleteCharacterAdmin} />}
      {view === "password" && <PasswordView config={config} onChange={updateConfig} onToast={showToast} reps={reps} contents={config.contents} onAfterDelete={refresh} />}

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
    return <div className="gpa-root"><div className="gpa-gate-wrap"><div style={{ color: "var(--text-dim)", fontSize: 13 }}>불러오는 중...</div></div></div>;
  }

  if (config._loadFailed) {
    // 실제 설정을 못 받아온 상태입니다. 여기서 화면을 계속 쓰게 두면, 임시 기본값을
    // 보면서 저장 버튼을 눌러 실제 데이터를 덮어쓸 위험이 있으므로 아예 막습니다.
    return (
      <div className="gpa-root">

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

      {!authed ? (
        <AdminGate config={config} onEnter={() => setAuthed(true)} />
      ) : (
        <div className="gpa-scroll"><AdminShell config={config} setConfig={setConfig} /></div>
      )}
    </div>
  );
}
