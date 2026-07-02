/**
 * 길드 파티 매칭 툴 — 구글 시트 기반 저장소 API (Google Apps Script)
 *
 * 이 스크립트는 하나의 시트를 key-value 저장소처럼 사용합니다.
 * 앱의 storage.js가 이 스크립트를 웹앱(Web App)으로 호출합니다.
 *
 * ------------------------------------------------------------
 * 설치 방법
 * ------------------------------------------------------------
 * 1. 구글 시트를 새로 만듭니다.
 * 2. 시트 하단에 "kv"라는 이름의 탭을 만들고, 1행에 헤더를 입력합니다:
 *    key | shared | value
 * 3. 메뉴 확장 프로그램 > Apps Script 를 열고, 기본 코드를 지운 뒤
 *    이 파일 내용 전체를 붙여넣습니다.
 * 4. 왼쪽 톱니바퀴(프로젝트 설정) > 스크립트 속성(Script Properties)에
 *    ACCESS_TOKEN 이라는 이름으로 원하는 임의의 문자열(비밀 토큰)을 추가합니다.
 *    (예: ACCESS_TOKEN = my-guild-secret-2026)
 * 5. 배포 > 새 배포 > 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: 전체(Anyone)
 *    를 선택하고 배포합니다. 배포 후 나오는 웹앱 URL을 복사해둡니다.
 * 6. 프론트엔드의 .env 파일에 다음을 채웁니다:
 *    VITE_STORAGE_API_URL=위에서 복사한 웹앱 URL
 *    VITE_STORAGE_API_TOKEN=위에서 설정한 ACCESS_TOKEN과 동일한 값
 *
 * ------------------------------------------------------------
 * 보안에 대한 중요한 안내
 * ------------------------------------------------------------
 * ACCESS_TOKEN은 브라우저(클라이언트) 코드에 그대로 포함되기 때문에,
 * 이 방식은 "완전한 보안"이 아니라 "아무나 URL만 알면 바로 쓰지 못하게 막는
 * 최소한의 잠금장치" 수준입니다. 브라우저 개발자 도구로 토큰을 확인할 수 있는
 * 사람은 우회할 수 있습니다. 길드원 정도의 소규모 내부 도구에는 적합하지만,
 * 민감한 데이터를 다루거나 더 강한 보안이 필요하다면 별도의 인증이 있는
 * 정식 백엔드(예: Vercel Serverless Functions + 데이터베이스)를 권장합니다.
 */

var SHEET_NAME = "kv";

/**
 * 편집기에서 "실행" 버튼으로 바로 테스트하고 싶다면 doGet/doPost가 아니라
 * 이 함수를 실행하세요. doGet/doPost는 실제 웹 요청이 들어올 때만 e가
 * 채워지기 때문에, 편집기에서 직접 실행하면 항상
 * "Cannot read properties of undefined (reading 'parameter')" 에러가 납니다.
 * (버그가 아니라 테스트 방법의 문제입니다.)
 */
function testDoGet() {
  var token = PropertiesService.getScriptProperties().getProperty("ACCESS_TOKEN");
  var fakeEvent = { parameter: { action: "list", prefix: "", shared: "true", token: token } };
  var result = doGet(fakeEvent);
  Logger.log(result.getContent());
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["key", "shared", "value"]);
  }
  return sheet;
}

function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty("ACCESS_TOKEN");
  return expected && token === expected;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- 내부 조회 헬퍼 ---------------- */
function findRow_(sheet, key, shared) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var rowKey = data[i][0];
    var rowShared = String(data[i][1]) === "true";
    if (rowKey === key && rowShared === !!shared) return i + 1; // 1-indexed 시트 행 번호
  }
  return -1;
}

/* ---------------- GET: get / list ---------------- */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var token = params.token || "";
  if (!checkToken_(token)) return jsonOut_({ error: "unauthorized" });

  var sheet = getSheet_();
  var action = params.action;

  if (action === "get") {
    var shared = params.shared === "true";
    var row = findRow_(sheet, params.key, shared);
    if (row === -1) return jsonOut_({ value: null });
    var value = sheet.getRange(row, 3).getValue();
    return jsonOut_({ value: String(value) });
  }

  if (action === "list") {
    var prefix = params.prefix || "";
    var sharedList = params.shared === "true";
    var data = sheet.getDataRange().getValues();
    var keys = [];
    for (var i = 1; i < data.length; i++) {
      var k = data[i][0];
      var s = String(data[i][1]) === "true";
      if (s === sharedList && String(k).indexOf(prefix) === 0) keys.push(k);
    }
    return jsonOut_({ keys: keys });
  }

  return jsonOut_({ error: "unknown action" });
}

/* ---------------- POST: set / delete ---------------- */
function doPost(e) {
  if (!e || !e.postData) return jsonOut_({ error: "no request body (are you testing this from the editor's Run button? that won't work — see comments at top of file)" });
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return jsonOut_({ error: "invalid body" }); }

  if (!checkToken_(body.token)) return jsonOut_({ error: "unauthorized" });

  var sheet = getSheet_();
  var shared = !!body.shared;

  if (body.action === "set") {
    var row = findRow_(sheet, body.key, shared);
    if (row === -1) {
      sheet.appendRow([body.key, shared ? "true" : "false", body.value]);
    } else {
      sheet.getRange(row, 3).setValue(body.value);
    }
    return jsonOut_({ ok: true });
  }

  if (body.action === "delete") {
    var row2 = findRow_(sheet, body.key, shared);
    if (row2 !== -1) sheet.deleteRow(row2);
    return jsonOut_({ ok: true });
  }

  return jsonOut_({ error: "unknown action" });
}
