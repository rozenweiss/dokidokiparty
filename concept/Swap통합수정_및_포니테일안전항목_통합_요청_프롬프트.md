# 통합 요청: ① Swap 후보 통합 수정 ② 포니테일 리뷰 안전 항목 반영 (1·3·4·7번)

## 0. 이 문서에 대해

구현 세션에 그대로 붙여넣어 사용하는 문서입니다. 두 작업은 서로 다른 파일을 건드리는
독립적인 변경이라 순서 상관없이 진행 가능합니다. `[Inference]` 표시는 확정 사실이 아닌
추론이며, 구현 전 애매하면 사용자에게 확인해야 합니다.

---

# 요청 ① — 균형최적화형 힐클라이밍의 Swap 후보 통합

## 1-1. 대상 파일

`src/lib/matchEngine.experimental.js`

## 1-2. 배경: 진단으로 확인된 문제

실측 진단 결과, 일반 배치 완료 후 표준편차(3018.4)가 지원 채우기 완료 후(2610.5)보다
오히려 높았다 — 즉 균형 문제의 진짜 원인은 지원 채우기가 아니라 **일반 배치 힐클라이밍
자체**였다.

코드 확인 결과, 매 반복의 후보 생성이 계층 구조로 되어 있다:

```js
// 1. 미배정자가 있으면 → 그 이동 후보만 생성
for (const key of unassignedKeys) { ... TimeMove/RoleCross/RepReshuffle/CreateDealerParty ... }
// 2. 위에서 개선이 없었을 때만 → Merge 시도
if (!bestNext) { ... tryMerge ... }
// 3. 그것도 없었을 때만 → Swap 시도
if (!bestNext) { ... trySwap ... }
```

미배정자가 하나라도 남아있는 동안, 그 처리 후보 중 조금이라도 개선되는 게 있으면 그
반복은 거기서 끝나고 **Swap은 시도조차 되지 않는다.** 미배정을 0으로 만드는 과정에서
배치의 큰 틀이 굳어지고, 그 이후에야 Swap이 열리지만 이미 지역 최적 근처에 도달해 개선
여지가 없는 경우가 많다.

## 1-3. 확정된 수정 (사용자가 직접 결정 — 추측 아님, 2026-07-10)

매 반복마다 **미배정자 이동 후보·Merge 후보·Swap 후보를 하나의 후보 풀로 모아서**, 그중
`objectiveOf` 기준(사전식 비교) 최선을 고르는 구조로 바꾼다.

`[Inference]` 구현 형태 제안 (세부는 구현자 재량, 결과 기준은 1-4절):

```js
for (let iter = 0; iter < MAX_ITER && noImprove < 1; iter++) {
  let bestNext = null, bestObj = obj;
  const consider = (cand) => {
    if (!cand) return;
    const co = objectiveOf(cand);
    if (better(co, bestObj)) { bestObj = co; bestNext = cand; }
  };

  const unassignedKeys = [...charInfo.keys()].filter((k) => !state.placement[k]);
  for (const key of unassignedKeys) {
    const info = charInfo.get(key);
    info.times.forEach((t) => consider(tryTimeMove(state, key, t)));
    consider(tryRoleCross(state, key));
    consider(tryRepReshuffle(state, key));
    if (info.char.role === "dealer") consider(tryCreateDealerParty(state, key));
  }

  consider(tryMerge(state));

  const placedKeys = [...charInfo.keys()].filter((k) => state.placement[k]);
  for (let i = 0; i < placedKeys.length; i++) {
    for (let j = i + 1; j < placedKeys.length; j++) {
      consider(trySwap(state, placedKeys[i], placedKeys[j]));
    }
  }

  if (bestNext) { state = bestNext; obj = bestObj; noImprove = 0; } else { noImprove++; }
}
```

**우선순위 보장 근거 (검증됨, 임의 주장 아님)**: `objectiveOf`가 `[미배정수, 초과파티수,
표준편차]`이고 `better()`는 순수 사전식 비교(132~138행, 1번째 항목에서 차이가 있으면
그 즉시 판정)이다. `trySwap`은 이미 배치된 두 캐릭터만 맞바꾸므로 미배정수를 절대 바꾸지
못한다 — 반면 미배정자를 배치하는 이동은 미배정수를 1 줄인다. 따라서 미배정자를 줄이는
후보가 존재하는 한, Swap이 아무리 균형을 개선해도 1번째 항목에서 결코 이기지 못한다.
즉 이 통합은 우선순위를 바꾸는 게 아니라, 목적함수에 이미 내장된 우선순위를 그대로
유지하면서 인위적인 단계 구분 때문에 막혀 있던 Swap 기회만 추가로 열어주는 것이다.

## 1-4. 완료 기준

- 미배정자가 있는 반복에서도 (그 반복에서 미배정을 줄이는 후보가 없다면) Swap이 고려된다.
- 미배정자를 줄일 수 있는 후보가 하나라도 있는 반복에서는, Swap이 아무리 좋아 보여도
  선택되지 않는다 (1순위 절대 우선이 그대로 유지된다).
- 계산 시간이 체감상 크게 느려지지 않는지 확인한다 (Swap의 O(n²) 쌍 탐색이 매 반복 돌아가는
  비용 증가 — 이 프로젝트 규모(길드원 50명 미만)에서는 감당 가능할 것으로 예상되나 실측
  확인 필요) `[Inference]`.
- `20260709_test` 실데이터로 재검증 시, 일반 배치 완료 후 표준편차가 기존(3018.4)보다
  개선되는 경향을 보인다 `[Inference — 기대 효과이며 절대 수치 목표 아님]`.
- 목적함수·재시작 로직·다른 이웃 탐색 연산자·지원 채우기는 변경하지 않는다.

---

# 요청 ② — 포니테일 리뷰 안전 항목 반영

## 2-1. 대상 항목 (승인된 것만 — 나머지는 보류)

이전 검토에서 리스크가 낮다고 판단된 항목만 반영한다. **5번(JobCombo→datalist), 6번
(ConfirmModal→window.confirm), 9번(matchEngine.experimental.js 삭제)은 이번 요청에
포함하지 않는다** — 각각 키워드 검색 기능 손실, 커스텀 라벨/스타일 손실, 진행 중인 재설계
작업 파기 우려가 있어 보류 중이다.

### 2-1-1. 상수·유틸리티 분리 (1번, 조건부 반영)

**대상**: `src/GuildPartyMatcher.jsx`, `src/GuildPartyMatcherAdmin.jsx`,
`src/lib/matchEngine.js`, `src/lib/matchEngine.experimental.js`

**반영할 것** (순수 로직·데이터만, React/lucide 의존성 없음):
- `DEFAULT_JOBS`, `DEFAULT_CONTENTS` (데이터 상수)
- `timeSlots`, `charFinalPower`(및 관련 상수: 저항-압력 비율·한도), `groupCandidatesByChar`,
  `stdev` (순수 함수)
- `ROLE_LABEL` (문자열 라벨 객체, JSX 아님 — 공유 가능)
- `APP_TYPE_LABEL` (문자열 라벨이면 공유 가능 — JSX를 포함하고 있지 않은지 확인 후 반영)

이들을 `src/lib/constants.js`(데이터 상수)와 `src/lib/utils.js`(순수 함수) 정도로 분리하고,
네 파일 모두 여기서 import하도록 수정한다.

**반영하지 말 것 (제외 — 하드 요구사항)**:
- **`ROLE_ICON`은 절대 공유 유틸로 옮기지 않는다.** lucide-react(`Shield`/`HeartPulse`/
  `Swords`)를 참조하므로, `matchEngine.js`/`matchEngine.experimental.js`가 "React·
  lucide-react·storage 의존성 없이 Node에서 단독 실행 가능해야 한다"는 기존 확정 요구사항
  (매칭엔진 모듈분리 요청 4절)을 깬다. `ROLE_ICON`은 UI 파일(`GuildPartyMatcher.jsx`,
  `GuildPartyMatcherAdmin.jsx`)에만 두거나, 두 UI 파일이 공유하는 **별도의 UI 전용 파일**
  (예: `src/uiConstants.js`, 매칭 엔진 파일은 import하지 않는 파일)로 분리한다.

### 2-1-2. 커스텀 `uid()` → `crypto.randomUUID()` (3번)

**대상**: `src/GuildPartyMatcher.jsx`, `src/GuildPartyMatcherAdmin.jsx`

`Math.random().toString(36)...` 방식의 `uid()` 함수를 삭제하고, 호출부를 모두
`crypto.randomUUID()`로 교체한다. Vercel 배포(HTTPS)이므로 브라우저 보안 컨텍스트 문제는
없을 것으로 예상된다 `[Inference]`.

### 2-1-3. 커스텀 `Checkbox` → 네이티브 `<input type="checkbox">` (4번)

**대상**: `src/GuildPartyMatcher.jsx`

`div`로 구현한 커스텀 체크박스 컴포넌트를 삭제하고 네이티브 `<input type="checkbox" />`로
교체한다. 스타일은 CSS `accent-color` 속성이나 `:checked` 가상 클래스로 맞춘다. 기존 디자인
톤(모던 프론트엔드 스타일 가이드)과 크게 어긋나지 않는지 결과물을 눈으로 한 번 확인할 것.

### 2-1-4. `GlobalStyle` 인라인 CSS 공통 파일 추출 (7번)

**대상**: `src/GuildPartyMatcher.jsx`, `src/GuildPartyMatcherAdmin.jsx`

두 파일 상단에 중복 선언된 거대한 인라인 `GlobalStyle` CSS 블록을 `src/index.css`(또는
`src/styles.css`)로 추출하고, 양쪽 파일에서 그 CSS 파일을 import하도록 수정한다. CSS
내용 자체는 변경하지 않는다(순수 이동).

## 2-2. 완료 기준

- `matchEngine.js`/`matchEngine.experimental.js`가 여전히 React·lucide-react·storage 없이
  Node에서 단독 실행 가능하다 (2-1-1의 하드 요구사항 검증).
- 새 uid 생성에 `Math.random()` 기반 코드가 남아있지 않다.
- 체크박스가 네이티브 `<input type="checkbox">`로 동작하고 시각적으로 크게 이질적이지 않다.
- 공통 CSS 파일 추출 후에도 두 화면의 스타일이 이전과 동일하게 보인다 (순수 리팩터링,
  시각적 변화 없음).
- 매칭 알고리즘·데이터 흐름 등 기능적 동작에는 전혀 변화가 없다 (이번 항목들은 전부
  구조적 정리이며 로직 변경이 아니다).
