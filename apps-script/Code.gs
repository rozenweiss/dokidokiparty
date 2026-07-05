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
 * 구조화된 시트 탭 (직업 관리 / 콘텐츠 관리 / 전체 캐릭터 / 신청 현황)
 * ------------------------------------------------------------
 * kv 탭 외에 "jobs", "contents", "characters", "applications" 탭이
 * 자동으로 생성됩니다. 앱이 데이터를 저장할 때마다 이 탭들에도 자동으로
 * 복사(미러링)되어서, 시트에서 사람이 읽기 편한 표 형태로 볼 수 있습니다.
 * 시트를 직접 손으로 고친 내용을 앱에 반영하려면, 관리자 화면의
 * "구글 시트에서 다시 불러오기" 버튼을 눌러야 합니다 (자동 반영 아님).
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

/* ================================================================
 * 구조화된 시트 탭 (직업 관리 / 콘텐츠 관리 / 전체 캐릭터 / 신청 현황)
 * ================================================================
 * kv 시트는 그대로 key-value 저장소로 남아있고, 아래 4개 탭은
 * "사람이 보기 편한 사본"입니다. kv에 값을 저장(set)할 때마다
 * 자동으로 이 탭들에도 반영됩니다 (mirrorToTables_).
 *
 * 반대 방향(시트를 손으로 고친 내용을 앱에 반영)은 자동으로 되지 않고,
 * 관리자 화면의 "구글 시트에서 다시 불러오기" 버튼을 눌러야 반영됩니다
 * (pullFromSheets_). 자동 양방향 동기화는 동시 편집 시 데이터가 서로
 * 덮어써질 위험이 있어서, 명시적으로 당겨오는 방식을 선택했습니다.
 * [Inference] 이건 설계상의 판단이며, 유일한 정답은 아닙니다.
 */
var TABLES = {
  jobs: ["id", "name", "role", "keywords", "order", "active"],
  contents: ["id", "name", "pressure", "requiredResist", "partySize", "interval", "startTime", "endTime", "active"],
  characters: ["repName", "id", "nickname", "jobId", "jobName", "role", "power", "resist", "penalty", "active", "updatedAt"],
  applications: ["repName", "id", "contentId", "contentName", "type", "characterIds", "times", "status", "appliedAt"]
};

function getTableSheet_(name) {
  var headers = TABLES[name];
  if (!headers) throw new Error("unknown table: " + name);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function writeTable_(name, rows) {
  var headers = TABLES[name];
  var sheet = getTableSheet_(name);
  sheet.clearContents();
  var values = (rows || []).map(function (r) {
    return headers.map(function (h) {
      var v = r[h];
      return v === undefined || v === null ? "" : v;
    });
  });
  // 헤더 + 데이터를 하나의 2차원 배열로 합쳐 쓰기 호출 1회로 줄입니다.
  // 주의: 마지막 인자는 반드시 headers.length (열 개수)여야 합니다 — headers는
  // 문자열 배열이라 headers[0].length를 쓰면 첫 헤더 문자열의 글자 수가 되어
  // 열이 잘리는 실수가 될 수 있습니다.
  var output = [headers].concat(values); // rows가 없으면 [headers]만
  sheet.getRange(1, 1, output.length, headers.length).setValues(output);
}

function readTable_(name) {
  var headers = TABLES[name];
  var sheet = getTableSheet_(name);
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var empty = row.every(function (c) { return c === "" || c === null; });
    if (empty) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    rows.push(obj);
  }
  return rows;
}

/* kv에 값이 저장될 때 관련 구조화 시트에 자동으로 반영(미러링)합니다. */
function mirrorToTables_(key, valueStr) {
  try {
    if (key === "guild-config") {
      var cfg = JSON.parse(valueStr);
      writeTable_("jobs", cfg.jobs || []);
      writeTable_("contents", cfg.contents || []);
    } else if (String(key).indexOf("rep:") === 0) {
      syncCharacterAndApplicationTables_();
    }
  } catch (e) {
    // 미러링이 실패해도 원래 kv 저장 자체는 이미 성공했으므로 막지 않습니다.
  }
}

/* 모든 rep:* kv 항목을 훑어서 characters / applications 탭 전체를 다시 만듭니다. */
function syncCharacterAndApplicationTables_() {
  var sheet = getSheet_();
  var data = sheet.getDataRange().getValues();
  var chars = [];
  var apps = [];
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    var shared = String(data[i][1]) === "true";
    if (!shared || String(key).indexOf("rep:") !== 0) continue;
    var repName = String(key).slice(4);
    var val;
    try { val = JSON.parse(data[i][2]); } catch (e) { continue; }
    (val.subs || []).forEach(function (c) {
      chars.push({
        repName: repName, id: c.id, nickname: c.nickname, jobId: c.jobId, jobName: c.jobName,
        role: c.role, power: c.power, resist: c.resist, penalty: c.penalty || 0,
        active: c.active !== false, updatedAt: c.updatedAt || ""
      });
    });
    (val.applications || []).forEach(function (a) {
      apps.push({
        repName: repName, id: a.id, contentId: a.contentId, contentName: a.contentName || "",
        type: a.type, characterIds: (a.characterIds || []).join(","), times: (a.times || []).join(","),
        status: a.status, appliedAt: a.appliedAt || ""
      });
    });
  }
  writeTable_("characters", chars);
  writeTable_("applications", apps);
}

/* 관리자가 "구글 시트에서 다시 불러오기"를 눌렀을 때 실행됩니다.
 * jobs/contents/characters/applications 탭의 현재 내용을 읽어서
 * kv의 guild-config, rep:* 항목에 덮어씁니다. */
/* 시트의 시간 형식 셀은 문자열이 아니라 Date 객체로 넘어오므로 "HH:mm" 문자열로 변환합니다. */
function coerceTimeStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm");
  }
  return v;
}

/* 일괄 작업 전에 kv 탭 전체를 타임스탬프가 붙은 새 탭으로 복제합니다. */
function backupKv_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kv = getSheet_();
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
  var name = "kv_backup_" + ts;
  var copy = kv.copyTo(ss);
  copy.setName(name);
  return name;
}

function pullFromSheets_() {
  var kvSheet = getSheet_();
  // kv 전체를 여기서 1회만 읽어서, 이후 guild-config/각 rep 행 찾기와
  // "캐릭터/신청이 하나도 없는 기존 대표 캐릭터 보존" 판단에 전부 재사용합니다
  // (시트API_호출최소화 요청, 항목2 — 기존에는 rep마다 findRow_가 매번 다시 읽었음).
  var kvData = kvSheet.getDataRange().getValues();
  var rowIndexByKey = {}; // "key\u0000shared" -> 1-indexed 시트 행 번호
  for (var i = 1; i < kvData.length; i++) {
    var rk = kvData[i][0] + "\u0000" + (String(kvData[i][1]) === "true");
    rowIndexByKey[rk] = i + 1;
  }

  // 갱신은 value(3열)만 모아뒀다가 마지막에 한 번에 씁니다 (항목3, 완화조건 적용).
  // 읽어온 범위(kvData 기준) 밖은 건드리지 않고, key/shared 열은 다시 쓰지 않습니다.
  var dataRowCount = kvData.length - 1;
  var valueColumn = [];
  for (var vi = 1; vi < kvData.length; vi++) valueColumn.push([kvData[vi][2]]);
  function setRowValue(rowNum, value) {
    var idx = rowNum - 2; // 시트 2행 = valueColumn[0]
    if (idx >= 0 && idx < valueColumn.length) valueColumn[idx][0] = value;
  }
  var appendRows = [];

  // 1) jobs, contents -> guild-config
  var jobs = readTable_("jobs").map(function (j) {
    return {
      id: String(j.id), name: j.name, role: j.role, keywords: j.keywords || "",
      order: Number(j.order) || 1,
      active: j.active === true || String(j.active).toLowerCase() === "true"
    };
  });
  var contents = readTable_("contents").map(function (c) {
    return {
      id: String(c.id), name: c.name,
      pressure: Number(c.pressure) || 0, requiredResist: Number(c.requiredResist) || 0,
      partySize: Number(c.partySize) || 2, interval: Number(c.interval) || 30,
      startTime: coerceTimeStr_(c.startTime), endTime: coerceTimeStr_(c.endTime),
      active: c.active === true || String(c.active).toLowerCase() === "true"
    };
  });
  var cfgRowNum = rowIndexByKey["guild-config\u0000true"];
  var cfg = cfgRowNum ? JSON.parse(kvData[cfgRowNum - 1][2]) : {};
  cfg.jobs = jobs;
  cfg.contents = contents;
  var cfgValue = JSON.stringify(cfg);
  if (cfgRowNum) setRowValue(cfgRowNum, cfgValue);
  else appendRows.push(["guild-config", "true", cfgValue]);

  // 2) characters, applications -> rep:* (대표 캐릭터별로 묶어서 저장)
  var chars = readTable_("characters");
  var apps = readTable_("applications");
  var repNames = {};
  chars.forEach(function (c) { repNames[c.repName] = true; });
  apps.forEach(function (a) { repNames[a.repName] = true; });
  // 캐릭터/신청이 하나도 없는 기존 대표 캐릭터도 보존 (위에서 이미 읽어둔 kvData 재사용, 추가 읽기 없음)
  for (var ri = 1; ri < kvData.length; ri++) {
    var key = kvData[ri][0];
    if (String(key).indexOf("rep:") === 0) repNames[String(key).slice(4)] = true;
  }

  Object.keys(repNames).forEach(function (repName) {
    var subs = chars.filter(function (c) { return c.repName === repName; }).map(function (c) {
      return {
        id: String(c.id), nickname: c.nickname, jobId: c.jobId, jobName: c.jobName, role: c.role,
        power: Number(c.power) || 0, resist: Number(c.resist) || 0, penalty: Number(c.penalty) || 0,
        active: c.active === true || String(c.active).toLowerCase() === "true",
        updatedAt: c.updatedAt || Date.now()
      };
    });
    var repApps = apps.filter(function (a) { return a.repName === repName; }).map(function (a) {
      return {
        id: String(a.id), contentId: a.contentId, contentName: a.contentName,
        type: a.type,
        characterIds: String(a.characterIds || "").split(",").filter(String),
        times: String(a.times || "").split(",").filter(String),
        status: a.status, appliedAt: a.appliedAt || Date.now()
      };
    });
    var repKey = "rep:" + repName;
    var repRowNum = rowIndexByKey[repKey + "\u0000true"];
    var value = JSON.stringify({ subs: subs, applications: repApps });
    if (repRowNum) setRowValue(repRowNum, value);
    else appendRows.push([repKey, "true", value]);
  });

  // 갱신 일괄 반영: 읽어온 범위(dataRowCount)만, value(3열)만 덮어씁니다.
  // [Inference] LockService가 없는 구조라, 이 함수 실행 중 다른 클라이언트가
  // 개별 set을 했다면 그 변경이 여기서 다시 쓰는 옛 값으로 되돌아갈 수 있는 창
  // (lost update)이 "해당 행 하나"에서 "여기서 갱신하는 모든 행"으로 넓어집니다.
  // 관리자가 수동으로 누르는 복구용 기능이고 관리자 1인 운영 기준으로는 위험이
  // 낮다고 보고 적용하지만, 위험이 완전히 0은 아닙니다.
  if (dataRowCount > 0) {
    kvSheet.getRange(2, 3, dataRowCount, 1).setValues(valueColumn);
  }
  if (appendRows.length > 0) {
    var startRow = kvSheet.getLastRow() + 1;
    kvSheet.getRange(startRow, 1, appendRows.length, 3).setValues(appendRows);
  }
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

  // list와 동일하지만, 값(value)도 한 번에 같이 돌려줍니다.
  // rep:* 처럼 개수가 많은 키를 하나씩 get으로 반복 조회하면 매번 왕복이 필요해
  // 느려지므로(요청 수만큼 느려짐), 이 액션으로 한 번에 가져옵니다.
  if (action === "listWithValues") {
    var prefix2 = params.prefix || "";
    var sharedList2 = params.shared === "true";
    var data2 = sheet.getDataRange().getValues();
    var rows = [];
    for (var j = 1; j < data2.length; j++) {
      var k2 = data2[j][0];
      var s2 = String(data2[j][1]) === "true";
      if (s2 === sharedList2 && String(k2).indexOf(prefix2) === 0) {
        rows.push({ key: k2, value: String(data2[j][2]) });
      }
    }
    return jsonOut_({ rows: rows });
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
    if (shared && !body.skipMirror) mirrorToTables_(body.key, body.value);
    return jsonOut_({ ok: true });
  }

  if (body.action === "delete") {
    var row2 = findRow_(sheet, body.key, shared);
    if (row2 !== -1) sheet.deleteRow(row2);
    return jsonOut_({ ok: true });
  }

  if (body.action === "pullFromSheets") {
    pullFromSheets_();
    return jsonOut_({ ok: true });
  }

  if (body.action === "backupKv") {
    var backupName = backupKv_();
    return jsonOut_({ ok: true, name: backupName });
  }

  if (body.action === "syncMirror") {
    syncCharacterAndApplicationTables_();
    return jsonOut_({ ok: true });
  }

  if (body.action === "setMany") {
    var items = body.items || [];
    var kvData = sheet.getDataRange().getValues();
    var rowIndexByKey = {}; // "key\u0000shared" -> 1-indexed row number
    for (var ri = 1; ri < kvData.length; ri++) {
      var rk = kvData[ri][0] + "\u0000" + (String(kvData[ri][1]) === "true");
      rowIndexByKey[rk] = ri + 1;
    }

    // 갱신은 value(3열)만 모아뒀다가 마지막에 한 번에 씁니다 (시트API_호출최소화 요청, 항목3).
    // 완화조건: 함수 시작 시 읽어온 범위(dataRowCount)만 정확히 되쓰고, key/shared 열은
    // 건드리지 않습니다. [Inference] LockService가 없어, 읽기~쓰기 사이 다른 클라이언트의
    // 단건 set이 끼어들면 그 변경이 되돌아갈 수 있는 창(lost update)이 "해당 행"에서
    // "여기서 갱신하는 모든 행"으로 넓어집니다. 관리자 1인 운영 기준으로는 위험이 낮다고
    // 보고 적용하지만, 위험이 완전히 0은 아닙니다.
    var dataRowCount = kvData.length - 1;
    var valueColumn = [];
    for (var vi = 1; vi < kvData.length; vi++) valueColumn.push([kvData[vi][2]]);
    function setRowValue(rowNum, value) {
      var idx = rowNum - 2; // 시트 2행 = valueColumn[0]
      if (idx >= 0 && idx < valueColumn.length) valueColumn[idx][0] = value;
    }

    var appendRows = [];
    var pendingIndexByKey = {}; // "key\u0000shared" -> index within appendRows, for keys not yet in kv
    var updatedCount = 0, appendedCount = 0;
    var sawGuildConfig = false, sawRep = false;

    items.forEach(function (item) {
      var itemShared = !!item.shared;
      var rk2 = item.key + "\u0000" + itemShared;
      if (item.key === "guild-config") sawGuildConfig = true;
      if (String(item.key).indexOf("rep:") === 0) sawRep = true;

      var existingRow = rowIndexByKey[rk2];
      if (existingRow) {
        setRowValue(existingRow, item.value);
        updatedCount++;
      } else if (pendingIndexByKey.hasOwnProperty(rk2)) {
        // 같은 요청 안에서 이미 추가 목록에 넣은 (key,shared)가 다시 나온 경우: 마지막 값으로 덮어씁니다.
        appendRows[pendingIndexByKey[rk2]] = [item.key, itemShared ? "true" : "false", item.value];
      } else {
        pendingIndexByKey[rk2] = appendRows.length;
        appendRows.push([item.key, itemShared ? "true" : "false", item.value]);
        appendedCount++;
      }
    });

    if (dataRowCount > 0) {
      sheet.getRange(2, 3, dataRowCount, 1).setValues(valueColumn);
    }
    if (appendRows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, appendRows.length, 3).setValues(appendRows);
    }

    if (!body.skipMirror) {
      if (sawGuildConfig) {
        var cfgRow = findRow_(sheet, "guild-config", true);
        if (cfgRow !== -1) {
          try {
            var cfgVal = JSON.parse(sheet.getRange(cfgRow, 3).getValue());
            mirrorToTables_("guild-config", JSON.stringify(cfgVal));
          } catch (e) { /* 미러링 실패는 setMany 자체를 실패시키지 않습니다. */ }
        }
      }
      if (sawRep) {
        try { syncCharacterAndApplicationTables_(); } catch (e) { /* 위와 동일 */ }
      }
    }

    return jsonOut_({ ok: true, updated: updatedCount, appended: appendedCount });
  }

  return jsonOut_({ error: "unknown action" });
}

/* ---------------- 시간 기반 자동 매칭 결과 만료 삭제 트리거 (방법 A) ---------------- */
function cleanExpiredResults() {
  var sheet = getSheet_();
  var data = sheet.getDataRange().getValues();
  var now = Date.now();
  var retentionMs = 48 * 60 * 60 * 1000; // 48시간
  
  var expiredContentIds = [];
  var expiredRowIndices = []; // 뒤쪽 행부터 순차적으로 지우기 위해 행 번호 저장
  
  // 1) 만료된 results: 키 식별
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    var shared = String(data[i][1]) === "true";
    if (shared && String(key).indexOf("results:") === 0) {
      try {
        var res = JSON.parse(data[i][2]);
        if (res.generatedAt && (now - res.generatedAt) > retentionMs) {
          var contentId = key.slice("results:".length);
          expiredContentIds.push(contentId);
          expiredRowIndices.push(i + 1); // 1-indexed 행 번호
        }
      } catch (e) {
        // JSON 파싱 실패 시 무시
      }
    }
  }
  
  if (expiredContentIds.length === 0) return;

  // 2) 모든 대표 캐릭터(rep:*)의 신청 내역에서 만료된 콘텐츠의 신청을 필터링하여 일관성 유지
  // (시트API_호출최소화 패턴과 동일하게, rep마다 개별 setValue 대신 value(3열)만 모아 1회로 씁니다.
  //  이 함수는 시간 트리거로 자동 실행되므로, 아래 lost-update 위험은 관리자 수동 조작보다
  // 더 신경 써야 할 수 있습니다 — 트리거 주기를 사용량이 적은 시간대로 맞추는 것을 권장합니다.)
  var dataRowCount = data.length - 1;
  var valueColumn = [];
  for (var vi = 1; vi < data.length; vi++) valueColumn.push([data[vi][2]]);
  var anyRepChanged = false;

  for (var j = 1; j < data.length; j++) {
    var key2 = data[j][0];
    var shared2 = String(data[j][1]) === "true";
    if (shared2 && String(key2).indexOf("rep:") === 0) {
      try {
        var repVal = JSON.parse(data[j][2]);
        var originalAppCount = (repVal.applications || []).length;
        var filteredApps = (repVal.applications || []).filter(function (app) {
          return expiredContentIds.indexOf(app.contentId) === -1;
        });
        if (filteredApps.length !== originalAppCount) {
          repVal.applications = filteredApps;
          valueColumn[j - 1][0] = JSON.stringify(repVal); // data[j] <-> valueColumn[j-1] (data[0]은 헤더)
          anyRepChanged = true;
        }
      } catch (e) {
        // 에러 스킵
      }
    }
  }
  if (anyRepChanged && dataRowCount > 0) {
    sheet.getRange(2, 3, dataRowCount, 1).setValues(valueColumn);
  }

  // 3) 만료된 results:* 행 제거 (뒤쪽 행부터 삭제하여 인덱스 뒤틀림 우회)
  expiredRowIndices.sort(function(a, b) { return b - a; });
  expiredRowIndices.forEach(function(rowIdx) {
    sheet.deleteRow(rowIdx);
  });
  
  // 4) 삭제 결과를 반영하여 캐릭터 및 신청 테이블 재동기화
  try {
    syncCharacterAndApplicationTables_();
  } catch (e) {
    // 미러링 에러 스킵
  }
}

