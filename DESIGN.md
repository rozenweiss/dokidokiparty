---
name: Guild Party Matcher
description: 세인트 길드를 위한 효율적인 파티 매칭 도구
colors:
  primary: "oklch(62% 0.10 40)"
  primary-soft: "oklch(70% 0.08 40)"
  tank: "oklch(60% 0.08 240)"
  support: "oklch(65% 0.10 150)"
  dealer: "oklch(62% 0.11 40)"
  danger: "oklch(60% 0.12 20)"
  success: "oklch(65% 0.10 150)"
  bg: "oklch(98% 0.005 45)"
  bg-elev: "oklch(100% 0 0)"
  surface: "oklch(100% 0 0)"
  surface-2: "oklch(96% 0.01 45)"
  border: "oklch(88% 0.01 45)"
  border-soft: "oklch(94% 0.01 45)"
  text: "oklch(25% 0.01 45)"
  text-dim: "oklch(48% 0.01 45)"
  text-faint: "oklch(68% 0.01 45)"
typography:
  display:
    fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
  body:
    fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif"
  label:
    fontFamily: "'JetBrains Mono', 'Consolas', monospace"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  pill: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "14px 20px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.md}"
    padding: "14px 20px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Guild Party Matcher

## 1. Overview

**Creative North Star: "The Guild Sanctuary"**

이 시스템은 세인트 길드원들을 위한 차분하고 정돈된 길드 아지트를 지향합니다. 누구나 쉽게 길드 파티에 참여할 수 있도록 명확하고 효율적인 인터페이스를 제공하면서도, 게임 밖에서 게임의 연장선을 느끼게 하는 따뜻하고 친근한 무드를 유지합니다. 너무 복잡한 엑셀 느낌의 딱딱한 UI나 유치한 조잡함을 명시적으로 배제하며, 신뢰감을 주는 정돈된 레이아웃을 통해 직관적인 효율성을 달성합니다.

**Key Characteristics:**
- 직관적이고 효율적인 정보 배치
- 게임 몰입감을 이어가는 친숙하고 따뜻한 톤앤매너
- 명확한 피드백과 상태 표시를 통한 신뢰감 구축

## 2. Colors

차분한 오프화이트 배경 위에 생기 있는 '화롯불' 같은 따뜻한 악센트가 더해진 팔레트입니다.

### Primary
- **Warm Hearth** (oklch(62% 0.10 40)): 길드의 활력과 온기를 상징하는 메인 오렌지/테라코타 색상. 주요 액션 버튼(CTA), 활성화된 요소, 브랜드 타이틀 등 화면의 중심을 잡아주는 곳에 사용합니다.
- **Warm Hearth Soft** (oklch(70% 0.08 40)): 메인 컬러를 보조하는 부드러운 톤. 그라데이션이나 강조 효과의 서브 컬러로 사용합니다.

### Secondary
- **Tanker Cobalt** (oklch(60% 0.08 240)): 탱커 역할을 나타내는 차분한 푸른색.
- **Support Jade** (oklch(65% 0.10 150)): 서포터 역할과 성공(Success) 상태를 나타내는 안정적인 녹색.

### Neutral
- **Sanctuary Paper** (oklch(98% 0.005 45)): 전체 화면의 기본 배경(bg)으로, 차가운 순백색이 아닌 아주 미세한 따뜻함이 도는 오프화이트입니다.
- **Surface White** (oklch(100% 0 0)): 카드나 입력 폼 등 콘텐츠가 올라가는 표면 색상. 배경과 확실히 분리됩니다.
- **Ink Dark** (oklch(25% 0.01 45)): 본문 텍스트용 진한 회갈색. 완전한 검은색보다 부드러워 웜톤 배경과 잘 어울립니다.
- **Ink Dim** (oklch(48% 0.01 45)): 보조 텍스트, 라벨, 힌트 등에 사용되는 중간 계조의 텍스트 색상.

## 3. Typography

**Display Font:** 'Pretendard' (with -apple-system, sans-serif)
**Body Font:** 'Pretendard' (with -apple-system, sans-serif)
**Label/Mono Font:** 'JetBrains Mono' (with Consolas, monospace)

**Character:** 극도로 가독성이 높고 정돈된 Pretendard를 기본으로 사용해 복잡한 데이터를 깔끔하게 전달하며, 숫자나 데이터가 부각되어야 하는 곳(전투력 등)에는 고정폭 폰트(Mono)를 혼용해 전문적인 도구의 느낌을 더합니다.

### Hierarchy
- **Display** (Bold, 22px): 페이지 타이틀, 결과 요약의 핵심 숫자.
- **Headline** (Bold, 18px): 주요 섹션의 제목.
- **Title** (Bold, 16px, 16.5px): 카드 제목, 리스트 내 주요 이름.
- **Body** (Regular/Medium, 14px~14.5px, 1.5): 본문 설명, 카드 내 설명문. 줄 바꿈이 길어지지 않도록 관리합니다.
- **Label** (Medium, 12px~13px): 상태 태그, 작은 메타데이터, 폼 필드 라벨.

## 4. Elevation

이 시스템은 "Tactile & Layered" (버튼은 누르는 맛이 있고, 카드는 은은한 그림자로 입체감을 줌) 철학을 따릅니다. 기본적으로 깔끔한 테두리로 구분되지만, 중요한 상호작용 요소나 카드에는 깊이감을 주어 정보의 위계를 나눕니다.

### Shadow Vocabulary
- **Card Shadow** (`box-shadow: 0 4px 16px color-mix(...)`): 플로팅 바, 모달, 특정 떠있는 카드 요소에 사용되어 배경과 확실히 분리되는 느낌을 줍니다.
- **Action Shadow** (`box-shadow: 0 2px 4px color-mix(...)`): 프라이머리 버튼에 사용되어 클릭 가능한 요소임을 명확히 합니다. 클릭 시(`:active`) 위치가 이동하며 물리적 피드백을 줍니다.

## 5. Components

### Buttons
- **Shape:** 약간 둥근 형태 (8px radius)
- **Primary:** Warm Hearth (메인 컬러) 배경과 화이트 텍스트. 클릭 시 Y축으로 `1px` 이동하여 눌리는 느낌을 주며, 은은한 그림자가 동반됩니다.
- **Hover / Focus:** Hover 시 `filter: brightness(1.06)` 적용으로 살짝 밝아집니다.
- **Ghost:** 투명한 배경과 `text-dim` 색상의 텍스트. Hover 시 테두리와 글자가 메인 컬러로 전환되며 살짝 색이 입혀집니다.

### Cards / Containers
- **Corner Style:** 명확히 구분되는 둥근 모서리 (일반 8px, 큰 컨테이너 12px~16px)
- **Background:** `bg-elev` 또는 `surface` 화이트 사용
- **Border:** `border-soft`로 부드러운 테두리를 가짐
- **Internal Padding:** 16px ~ 24px의 넉넉한 내부 여백

### Inputs / Fields
- **Style:** 1px `border` 테두리를 가진 `bg-elev` 배경의 입력창 (8px radius)
- **Focus:** 포커스 시 테두리가 `Primary` 색상으로 변하며, 외곽으로 은은한 컬러 링(box-shadow 확산) 효과가 나타나 현재 입력 중임을 강력하게 피드백합니다.
- **Error:** 테두리 색상이 `danger` 색상으로 변경됩니다.

### Chips / Badges
- **Style:** 각 역할(탱커, 서포터, 딜러)과 상태를 직관적으로 나타내기 위해 해당 색상을 12~15% 투명도로 혼합한 배경과 진한 텍스트 컬러를 세트로 사용합니다. 테두리 반경은 20px 이상으로 완전히 둥글게(Pill) 처리합니다.

## 6. Do's and Don'ts

### Do:
- **Do** 상태 변화 시 명확하고 빠른 시각적 피드백(버튼 눌림, 포커스 링, Hover 상태)을 제공하세요.
- **Do** 텍스트의 가독성(대비)이 떨어지지 않도록, 너무 연한 회색(`text-faint` 이하)의 남용을 피하고 기본 본문은 `text-dim` 이상을 유지하세요.
- **Do** 직업과 역할 등 반복되는 메타 정보는 색상 코딩된 둥근 뱃지(Pill) 형태를 사용해 정보 스캔을 돕게 하세요.

### Don't:
- **Don't** 너무 조잡하거나 유치한 모바일 게임 UI 패턴(과도한 텍스처, 두꺼운 그림자, 화려한 그라데이션)을 사용하지 마세요.
- **Don't** 딱딱하고 복잡한 스프레드시트 느낌을 주는 빽빽한 테이블 레이아웃을 지양하고, 카드 형태로 여백을 두고 정보를 그룹화하세요.
- **Don't** 의미 없는 장식용 사이드 스트라이프 테두리(`border-left` 포인트 컬러)를 남용하지 마세요.
