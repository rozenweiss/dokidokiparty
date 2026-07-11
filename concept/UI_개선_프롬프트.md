# UI 오딧(Audit) 결과 및 개선 프롬프트

현재 `src/GuildPartyMatcher.jsx`의 UI 코드에 대해 다음과 같은 문제점들이 발견되었습니다. 이 문서를 바탕으로 순차적으로 UI 개선 작업을 진행해 주세요.

## 📊 오딧 건강 점수 (Audit Health Score): 10 / 20 (수정 필요)

| # | 평가 항목 | 점수 | 주요 발견 사항 |
|---|---|---|---|
| 1 | 접근성 (A11y) | 1 | ARIA 속성 누락, 가짜 사용자 정의 폼 컨트롤(div 체크박스), 일부 텍스트 대비(Contrast) 부족 |
| 2 | 성능 (Performance) | 3 | React 구현은 대체로 양호하나, 불필요하게 무거운 그림자(shadow) 효과 존재 |
| 3 | 반응형 (Responsive) | 3 | 모바일 대응(`auto-fill`, `minmax`)은 좋으나 터치 타겟 크기가 다소 작음 |
| 4 | 테마 (Theming) | 2 | CSS 변수 기반은 좋으나 다크모드가 완전히 누락되었고 일부 하드코딩된 rgba 사용 |
| 5 | 안티패턴 (Anti-Patterns) | 1 | AI 생성 느낌이 강한 크림색 배경, 유령 카드(Ghost card) 패턴, 표준 폼 컨트롤 미사용 |

## 🚫 안티패턴 판정 (Fail)
현재 UI는 전형적인 "AI 생성 코드"의 특징과 프로덕트 안티패턴을 다수 포함하고 있습니다.
- **AI 크림색 배경**: `#F7F5F0` 배경과 `#E4DFD3` 테두리를 사용하고 있습니다. 이는 2026년 기준 가장 흔한 AI 생성 디자인 템플릿(따뜻한 종이 느낌)입니다.
- **유령 카드(Ghost Card) 패턴**: 진한 단색 테두리에 넓고 부드러운 그림자(`0 12px 28px -20px`)를 결합했습니다. 또한 카드의 모서리 둥글기가 `22px`로 과도하게 둥급니다(일반적으로 12-16px 권장).
- **장식용 그라데이션**: 아무런 기능적 목적이 없는 `radial-gradient`가 전체 배경과 게이트 카드에 사용되었습니다.
- **표준 UI 재창조**: 기본 `<input type="checkbox">` 대신 `onClick` 이벤트가 달린 커스텀 `div` 태그를 사용하여 접근성을 심각하게 해칩니다.
- **모달 남용**: 인라인 편집이나 점진적 노출(Progressive Disclosure) 대신 캐릭터 편집에 곧바로 모달을 사용합니다.

---

## 🛠️ 세부 문제점 및 개선 권장 사항 (실행 프롬프트)

아래 명령어들을 하나씩 순서대로 실행하여 문제를 해결해 주세요.

### 1. [P0] 접근성 및 폼 컨트롤 수정 (Harden)
- **위치**: `Checkbox`, `JobCombo` 및 모달 폼
- **문제**: 스크린 리더가 상태를 읽을 수 없고 키보드 탐색이 불가능합니다.
- **실행 명령어**:
  ```bash
  /impeccable harden src/GuildPartyMatcher.jsx
  ```
  *(요청 내용: 가짜 `div` 체크박스와 콤보박스를 네이티브 HTML `<input type="checkbox">` 및 `<select>`로 교체하고, 라벨과 인풋을 연결(htmlFor/id)하며, ARIA 속성을 추가해 주세요.)*

### 2. [P1] 레이아웃 및 카드 안티패턴 제거 (Layout)
- **위치**: `.gpm-card`, `.gpm-gate-card`
- **문제**: 브랜드 느낌을 해치는 과도한 그림자와 둥근 모서리, 불필요한 배경 그라데이션.
- **실행 명령어**:
  ```bash
  /impeccable layout src/GuildPartyMatcher.jsx
  ```
  *(요청 내용: 테두리가 있다면 그림자를 제거하고, 카드의 `border-radius`를 12px~16px로 줄이며, 장식용 `radial-gradient`를 삭제하여 깔끔한 프로덕트 구조를 만들어 주세요.)*

### 3. [P1] 테마 변경 및 다크모드 추가 (Colorize)
- **위치**: `.gpm-root` 컬러 토큰
- **문제**: 흔한 AI 크림색 배경을 사용 중이며 `--text-faint`(#A19C8C)의 대비가 떨어집니다(WCAG 실패). 다크모드도 없습니다.
- **실행 명령어**:
  ```bash
  /impeccable colorize src/GuildPartyMatcher.jsx
  ```
  *(요청 내용: AI 크림색 트로프를 버리고 OKLCH 기반의 Restrained(절제된) 또는 Committed(명확한) 컬러 전략을 적용해 주세요. 텍스트 대비를 개선하고 `@media (prefers-color-scheme: dark)`를 지원하는 다크모드를 추가해 주세요.)*

### 4. [P3] 최종 폴리싱 (Polish)
- **실행 명령어**:
  ```bash
  /impeccable polish src/GuildPartyMatcher.jsx
  ```
  *(요청 내용: 위 작업들이 끝난 후 시각적 일관성과 상호작용(인터랙션) 디테일을 최종적으로 다듬어 주세요.)*
