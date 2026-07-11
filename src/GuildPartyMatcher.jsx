import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Shield, Swords, HeartPulse, Bird } from "lucide-react";
import { storageGet, storageSet, storageGetSafe } from "./lib/storage";
import { timeSlots, charFinalPower } from "./lib/utils";
import { DEFAULT_JOBS, ROLE_LABEL } from "./lib/constants";
import "./index.css";

/* ============================================================
   길드 파티 매칭 툴 — 사용자 화면 프로토타입
   기획서 1장(사용자 화면) 전체 흐름을 구현한 인터랙티브 프로토타입입니다.
   - 관리자 화면은 아직 없으므로 직업/콘텐츠 목록은 예시 데이터로 시드합니다.
   - 데이터는 window.storage(shared)에 저장되어 같은 길드원끼리 공유됩니다.
   ============================================================ */

/* ---------------- 디자인 토큰 ---------------- */
/* ---------------- 시드 데이터 ---------------- */
/* DEFAULT_JOBS, ROLE_LABEL, timeSlots, charFinalPower(및 관련 상수)는 이제 상단에서
   ./lib/constants, ./lib/utils로부터 import합니다 (포니테일 리뷰 1번, 2026-07-10) —
   matchEngine.js/matchEngine.experimental.js와 동일한 정의를 공유해 드리프트 위험을
   없앴습니다. DEFAULT_CONTENTS는 관리자 화면과 값이 달라 그대로 유지합니다. */
const DEFAULT_CONTENTS = [
  { id: "c1", name: "협곡의 결전", pressure: 0, requiredResist: 0, partySize: 4, interval: 30, startTime: "20:00", endTime: "23:30", active: true },
  { id: "c2", name: "심연의 제단", pressure: 120, requiredResist: 1600, partySize: 4, interval: 30, startTime: "20:00", endTime: "23:00", active: true },
  { id: "c3", name: "폐허의 감시탑", pressure: 0, requiredResist: 0, partySize: 6, interval: 60, startTime: "21:00", endTime: "23:00", active: false },
];

const ROLE_ICON = { tank: Shield, support: HeartPulse, dealer: Swords };
// 신청 유형: "normal" | "support" | "both" (일반+지원, 12.4절). 기존 데이터는 normal/support만 가짐(하위 호환).
const APP_TYPE_LABEL = { normal: "일반 신청", support: "지원 신청", both: "일반 신청 + 지원 신청" };
const appliesNormal = (type) => type === "normal" || type === "both";
const appliesSupport = (type) => type === "support" || type === "both";

/* ---------------- 유틸 ---------------- */
// 커스텀 uid() 삭제하고 crypto.randomUUID()로 교체 (포니테일 리뷰 3번, 2026-07-10 — Vercel HTTPS 배포이므로 보안 컨텍스트 문제 없음)


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
  // 커스텀 div 체크박스 삭제, 네이티브 <input type="checkbox">로 교체 (포니테일 리뷰 4번, 2026-07-10).
  // 실제 토글 동작은 부모 요소의 onClick이 담당하므로(선택 행/카드 전체가 클릭 영역),
  // 이 input은 상태를 보여주는 용도로 readOnly + tabIndex={-1}로 두어 이중 토글을 막습니다.
  return <input type="checkbox" className="gpm-checkbox-native" checked={checked} readOnly tabIndex={-1} />;
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

  async function submit(name) {
    const target = (name ?? repInput).trim();
    if (!target) return;
    if (pw !== config.password) {
      setPwError("비밀번호가 올바르지 않습니다. 관리자에게 공유받은 길드 비밀번호를 확인해주세요.");
      return;
    }
    setPwError("");
    try { sessionStorage.setItem("gpm-guild-authed", "true"); } catch (e) { /* 세션 저장이 안 되면 그냥 이번 새로고침까지만 유지됩니다 */ }
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
    if (pw !== config.password) {
      setPwError("비밀번호가 올바르지 않습니다. 관리자에게 공유받은 길드 비밀번호를 확인해주세요.");
      return;
    }
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
        <h1 className="gpm-gate-title">두근두근 파티 메이커 2.0</h1>
        <p className="gpm-gate-desc">길드원만 입장할 수 있습니다.<br />길드 공용 비밀번호와 대표 캐릭터명을 입력해주세요.</p>

        <div className="gpm-field">
          <label className="gpm-label">길드 공용 비밀번호</label>
          <input
            type="password"
            className={`gpm-input ${pwError ? "error" : ""}`}
            value={pw}
            onChange={(e) => { setPw(e.target.value); setPwError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="비밀번호 입력"
            autoFocus
          />
          {pwError && <div className="gpm-error-text">{pwError}</div>}
          <div className="gpm-hint-text">프로토타입 기본 비밀번호: {config.password}</div>
        </div>

        <div className="gpm-field">
          <label className="gpm-label">대표 캐릭터명</label>
          <input
            className="gpm-input"
            value={repInput}
            onChange={(e) => { setRepInput(e.target.value); setLookupState(null); }}
            placeholder="대표 캐릭터명 입력"
            maxLength={20}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {recents.length > 0 && (
            <div className="gpm-recents">
              {recents.map((r) => (
                <button key={r} className="gpm-recent-chip" onClick={() => { setRepInput(r); setLookupState(null); }}>{r}</button>
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
              <button className="gpm-btn gpm-btn-ghost" style={{ flex: 1 }} onClick={() => setLookupState(null)}>대표 캐릭터 재입력</button>
              <button className="gpm-btn gpm-btn-primary" style={{ flex: 1 }} onClick={createRep}>새 대표 캐릭터 등록</button>
            </div>
          </div>
        ) : (
          <button className="gpm-btn gpm-btn-primary gpm-btn-block" disabled={!repInput.trim() || !pw.trim() || busy} onClick={() => submit()}>
            {busy ? "확인 중..." : "입장하기"}
          </button>
        )}

        <a href="/admin.html" className="gpm-btn gpm-btn-ghost gpm-btn-block" style={{ textDecoration: "none", marginTop: 12 }}>ADMIN PAGE</a>
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
    else if (Number(power) > 999999) e.power = "999,999 이하로 입력해주세요.";
    if (resist === "" || Number(resist) < 0 || isNaN(Number(resist))) e.resist = "0 이상의 숫자를 입력해주세요.";
    else if (Number(resist) > 999999) e.resist = "999,999 이하로 입력해주세요.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function save() {
    if (!validate()) return;
    const job = jobs.find((j) => j.id === jobId);
    onSave({
      id: initial?.id || crypto.randomUUID(),
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
          <input className={`gpm-input ${errors.nickname ? "error" : ""}`} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="예: 달빛여행자" maxLength={20} />
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
            <input className={`gpm-input ${errors.power ? "error" : ""}`} type="number" min="0" max="999999" value={power} onChange={(e) => setPower(e.target.value)} placeholder="0" />
            {errors.power && <div className="gpm-error-text">{errors.power}</div>}
          </div>
          <div className="gpm-field" style={{ flex: 1 }}>
            <label className="gpm-label">마도 저항</label>
            <input className={`gpm-input ${errors.resist ? "error" : ""}`} type="number" min="0" max="999999" value={resist} onChange={(e) => setResist(e.target.value)} placeholder="0" />
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
            <button className="gpm-btn gpm-btn-danger" onClick={() => onDelete(initial.id)}>캐릭터 삭제</button>
          )}
          <button className="gpm-btn gpm-btn-ghost" style={{ flex: 1 }} onClick={onClose}>취소</button>
          <button className="gpm-btn gpm-btn-primary" style={{ flex: 1 }} onClick={save}>변경사항 저장</button>
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
        <button className="gpm-btn gpm-btn-primary gpm-btn-sm" onClick={() => setModal("new")}>+ 내 캐릭터 추가</button>
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
                <button className="gpm-btn gpm-btn-ghost gpm-btn-sm" style={{ flex: 1 }} onClick={() => setModal(c)}>정보 수정</button>
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
          <button className="gpm-btn gpm-btn-primary" style={{ flex: 1 }} onClick={async (e) => {
            e.currentTarget.disabled = true;
            await onSubmit({
              id: editingApp?.id || crypto.randomUUID(),
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
        <button className="gpm-btn gpm-btn-primary" disabled={!canSubmit} onClick={() => setPhase("confirm")}>신청 내용 검토하기</button>
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
            // 공개 정보만 전달: 캐릭터 닉네임, 역할, 빈자리/부족 인원, type
            slots: (p.slots || []).map((s) => ({ role: s.role, nickname: s.nickname || null, type: s.type || null })),
            shortage: p.shortage || null,
          });
        }
      }
      if (!cancelled) { setResults(out); setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [contents]);

  const groupsByContent = useMemo(() => {
    const byContent = {};
    for (const r of results) {
      if (!byContent[r.contentName]) byContent[r.contentName] = {};
      if (!byContent[r.contentName][r.time]) byContent[r.contentName][r.time] = [];
      byContent[r.contentName][r.time].push(r);
    }
    return byContent;
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
      {Object.entries(groupsByContent).map(([contentName, timeGroups]) => (
        <div key={contentName} style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-dim)", marginBottom: 16 }}>{contentName}</div>
          {Object.entries(timeGroups).map(([time, parties]) => {
            const totalParticipants = parties.reduce((acc, p) => acc + p.slots.filter((s) => s.nickname).length, 0);
            return (
              <div key={time} style={{ marginBottom: 24 }}>
                <div className="gpm-result-group-title">
                  <h3 style={{ fontSize: 20, color: "var(--text)", fontWeight: 800, margin: 0 }}>{time} 출발</h3>
                  <span style={{ fontSize: 13, background: "var(--surface-2)", color: "var(--text-dim)", padding: "4px 10px", borderRadius: 20, fontWeight: 600, marginLeft: 10 }}>총 {totalParticipants}명</span>
                  <div className="gpm-result-group-line" style={{ marginLeft: 12 }} />
                </div>
                <div className="gpm-party-grid">
                  {parties.map((p) => (
                    <div key={p.partyNumber} className="gpm-party-card">
                      <div className="gpm-party-top"><span className="gpm-party-num">파티 {p.partyNumber}</span></div>
                      {p.slots.map((s, i) => {
                        const isSupport = s.type === "support" || (s.nickname && s.nickname.includes("(지원)"));
                        const displayName = s.nickname ? s.nickname.replace("(지원)", "").trim() : "";
                        return (
                          <div key={i} className={`gpm-party-slot ${s.nickname ? s.role : "empty"}`}>
                            <span className={`gpm-party-slot-role ${s.role}`} title={ROLE_LABEL[s.role]} aria-label={ROLE_LABEL[s.role]}>
                              {ROLE_ICON[s.role] && React.createElement(ROLE_ICON[s.role], { size: 15, strokeWidth: 2.3 })}
                            </span>
                            {s.nickname ? (
                              <span className="gpm-party-slot-name">
                                {displayName}
                                {isSupport && (
                                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", marginLeft: 6, color: "var(--gold)", background: "rgba(193,95,60,0.1)", borderRadius: "50%", width: 18, height: 18 }} title="지원 신청">
                                    <Bird size={12} strokeWidth={2.2} />
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="gpm-party-slot-empty">모집 중</span>
                            )}
                          </div>
                        );
                      })}
                      {p.shortage && <div className="gpm-party-short">부족 인원: {p.shortage}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
  async function submitApplication(app) {
    const exists = repData.applications.some((a) => a.id === app.id);
    const nextApps = exists ? repData.applications.map((a) => (a.id === app.id ? app : a)) : [...repData.applications, app];
    const next = { ...repData, applications: nextApps };
    await persist(next);
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
    <main className="gpm-frame">
      <header className="gpm-shell-header">
        <div className="gpm-brand">
          <Emblem />
          <div className="gpm-brand-text">
            <span className="gpm-brand-title">두두파 2.0</span>
            <span className="gpm-brand-sub">DOKIDOKI SAINT GUILD PARTY MAKER</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="/admin.html" className="gpm-btn gpm-btn-ghost gpm-btn-sm" style={{ textDecoration: "none" }}>ADMIN PAGE</a>
          <div className="gpm-rep-badge">
            <div className="gpm-rep-avatar">{repName.slice(0, 1)}</div>
            <div>
              <div className="gpm-rep-name">{repName}</div>
              <div className="gpm-rep-tag">대표 캐릭터</div>
            </div>
          </div>
        </div>
      </header>

      {view !== "apply" && view !== "done" && (
        <nav className="gpm-nav">
          {NAV_ITEMS.map((n) => (
            <button key={n.key} className={`gpm-nav-item ${view === n.key ? "active" : ""}`} onClick={() => setView(n.key)}>{n.label}</button>
          ))}
        </nav>
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
    </main>
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
        
        <div className="gpm-gate-wrap"><div style={{ color: "var(--text-dim)", fontSize: 13 }}>불러오는 중...</div></div>
      </div>
    );
  }

  if (config._loadFailed) {
    // 실제 설정을 못 받아온 상태입니다. 이대로 진행하면 임시 기본값(직업/콘텐츠 목록 등)을
    // 보게 되므로, 혼란을 막기 위해 여기서 화면을 막습니다.
    return (
      <div className="gpm-root">
        
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
