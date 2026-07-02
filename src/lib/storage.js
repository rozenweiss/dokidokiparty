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

export async function storageSet(key, value, shared) {
  try {
    assertConfigured();
    // Apps Script와의 CORS 프리플라이트를 피하려고 text/plain으로 보냅니다 (Apps Script 쪽에서 JSON.parse로 읽음).
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "set", key, value: JSON.stringify(value), shared: !!shared, token: API_TOKEN }),
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
