/**
 * window.storage(Claude 아티팩트 전용 API)를 대체하는 저장소 어댑터입니다.
 * 구글 시트에 배포한 Apps Script 웹앱을 key-value 저장소처럼 호출합니다.
 *
 * 함수 시그니처는 기존 아티팩트 코드의 storageGet/storageSet/storageDelete/storageListKeys와
 * 동일하게 맞춰서, 컴포넌트 쪽 코드는 거의 그대로 재사용할 수 있게 했습니다.
 */

const API_URL = import.meta.env.VITE_STORAGE_API_URL;
const API_TOKEN = import.meta.env.VITE_STORAGE_API_TOKEN;

function assertConfigured() {
  if (!API_URL || !API_TOKEN) {
    throw new Error(
      "VITE_STORAGE_API_URL / VITE_STORAGE_API_TOKEN 환경변수가 설정되지 않았습니다. " +
      ".env 파일(또는 Vercel 프로젝트 환경변수)에 값을 채워주세요."
    );
  }
}

export async function storageGet(key, shared) {
  try {
    assertConfigured();
    const url = `${API_URL}?action=get&key=${encodeURIComponent(key)}&shared=${!!shared}&token=${encodeURIComponent(API_TOKEN)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) { console.error("storageGet error:", data.error); return null; }
    return data.value ?? null;
  } catch (e) {
    console.error("storageGet failed:", e);
    return null;
  }
}

/**
 * storageGet과 달리 "값이 원래 없음"과 "요청 자체가 실패함"을 구분해서 알려줍니다.
 * 최초 시드값을 잘못 덮어쓰면 안 되는 곳(예: guild-config 최초 로드)에서만 사용하세요.
 * 일반 storageGet은 이 둘을 구분하지 않고 둘 다 null로 반환하므로, 그 결과만 보고
 * "요청이 실패했을 뿐인데 값이 원래 없다"고 잘못 판단해 기본값으로 덮어쓰는 사고가
 * 날 수 있습니다 (실제로 발생했던 문제).
 */
export async function storageGetSafe(key, shared) {
  try {
    assertConfigured();
    const url = `${API_URL}?action=get&key=${encodeURIComponent(key)}&shared=${!!shared}&token=${encodeURIComponent(API_TOKEN)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) { console.error("storageGetSafe error:", data.error); return { failed: true, value: null }; }
    return { failed: false, value: data.value ?? null };
  } catch (e) {
    console.error("storageGetSafe failed:", e);
    return { failed: true, value: null };
  }
}

export async function storageSet(key, value, shared, opts) {
  try {
    assertConfigured();
    // Apps Script와의 CORS 프리플라이트를 피하려고 text/plain으로 보냅니다 (Apps Script 쪽에서 JSON.parse로 읽음).
    const body = { action: "set", key, value: JSON.stringify(value), shared: !!shared, token: API_TOKEN };
    if (opts?.skipMirror) body.skipMirror = true;
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) { console.error("storageSet error:", data.error); return false; }
    return true;
  } catch (e) {
    console.error("storageSet failed:", e);
    return false;
  }
}

export async function storageDelete(key, shared) {
  try {
    assertConfigured();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "delete", key, shared: !!shared, token: API_TOKEN }),
    });
    const data = await res.json();
    if (data.error) { console.error("storageDelete error:", data.error); return false; }
    return true;
  } catch (e) {
    console.error("storageDelete failed:", e);
    return false;
  }
}

/**
 * storageListKeys + storageGet을 여러 번 반복하는 대신, prefix에 맞는 모든
 * 행의 key/value를 한 번의 요청으로 가져옵니다. rep:* 처럼 개수가 많은
 * 키를 다룰 때, 요청 수만큼 느려지거나 응답이 멈추는 문제를 피하기 위해 씁니다.
 */
export async function storageListKeys(prefix, shared) {
  try {
    assertConfigured();
    const url = `${API_URL}?action=list&prefix=${encodeURIComponent(prefix)}&shared=${!!shared}&token=${encodeURIComponent(API_TOKEN)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) { console.error("storageListKeys error:", data.error); return []; }
    return data.keys || [];
  } catch (e) {
    console.error("storageListKeys failed:", e);
    return [];
  }
}

/**
 * storageListKeys + storageGet을 여러 번 반복하는 대신, prefix에 맞는 모든
 * 행의 key/value를 한 번의 요청으로 가져옵니다. rep:* 처럼 개수가 많은
 * 키를 다룰 때, 요청 수만큼 느려지거나 응답이 멈추는 문제를 피하기 위해 씁니다.
 */
export async function storageListWithValues(prefix, shared) {
  try {
    assertConfigured();
    const url = `${API_URL}?action=listWithValues&prefix=${encodeURIComponent(prefix)}&shared=${!!shared}&token=${encodeURIComponent(API_TOKEN)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) { console.error("storageListWithValues error:", data.error); return []; }
    return data.rows || [];
  } catch (e) {
    console.error("storageListWithValues failed:", e);
    return [];
  }
}

/**
 * 구글 시트의 jobs/contents/characters/applications 탭에서 사람이 직접 고친
 * 내용을 읽어서, kv의 guild-config / rep:* 항목에 덮어씁니다.
 * [Unverified] 이 함수를 호출한 뒤 실제로 화면에 반영되는지는 매번 실제
 * 환경에서 확인이 필요합니다 — 여기서는 요청이 성공했는지만 알려줍니다.
 */
export async function pullFromSheets() {
  try {
    assertConfigured();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "pullFromSheets", token: API_TOKEN }),
    });
    const data = await res.json();
    if (data.error) { console.error("pullFromSheets error:", data.error); return false; }
    return true;
  } catch (e) {
    console.error("pullFromSheets failed:", e);
    return false;
  }
}

/**
 * kv 탭 전체를 타임스탬프가 붙은 새 탭으로 복제해 백업을 만듭니다.
 * 일괄 작업처럼 되돌리기 어려운 변경을 하기 전에 호출합니다.
 */
export async function backupKv() {
  try {
    assertConfigured();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "backupKv", token: API_TOKEN }),
    });
    const data = await res.json();
    if (data.error) { console.error("backupKv error:", data.error); return { ok: false }; }
    return { ok: true, name: data.name };
  } catch (e) {
    console.error("backupKv failed:", e);
    return { ok: false };
  }
}

/**
 * 여러 키를 한 번의 요청으로 upsert합니다. rep마다 storageSet을 반복 호출하는
 * 대신 이걸 쓰면 왕복 횟수를 크게 줄일 수 있습니다 (미러링 지연 동기화 성능개선).
 * items: [{ key, value, shared }, ...] — value는 JS 객체로 넘기면 내부에서 stringify합니다.
 * opts?.skipMirror가 true면 이 요청 안에서는 미러 탭 갱신을 건너뜁니다 — 그 경우
 * 호출부가 나중에 syncMirror()를 직접 불러줘야 합니다.
 */
export async function storageSetMany(items, opts) {
  if (!items || items.length === 0) return true;
  try {
    assertConfigured();
    const body = {
      action: "setMany",
      items: items.map((it) => ({ key: it.key, value: JSON.stringify(it.value), shared: !!it.shared })),
      token: API_TOKEN,
    };
    if (opts?.skipMirror) body.skipMirror = true;
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) { console.error("storageSetMany error:", data.error); return false; }
    return true;
  } catch (e) {
    console.error("storageSetMany failed:", e);
    return false;
  }
}

/**
 * characters/applications 미러 탭을 kv 기준으로 다시 맞춥니다. skipMirror로
 * 미룬 미러링을 연산이 다 끝난 뒤 한 번만 실행할 때 씁니다.
 */
export async function syncMirror() {
  try {
    assertConfigured();
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "syncMirror", token: API_TOKEN }),
    });
    const data = await res.json();
    if (data.error) { console.error("syncMirror error:", data.error); return false; }
    return true;
  } catch (e) {
    console.error("syncMirror failed:", e);
    return false;
  }
}
