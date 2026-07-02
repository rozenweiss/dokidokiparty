# 길드 파티 매칭 툴 (Vite + React + Google Sheets)

Claude 아티팩트로 만들었던 프로토타입을, 실제 Git/Vercel에 배포할 수 있는 형태로
옮긴 프로젝트입니다. 데이터 저장소는 Google Apps Script를 통해 **구글 시트**를
사용합니다.

## 구조

```
index.html          사용자 화면 진입점 (/)
admin.html           관리자 화면 진입점 (/admin.html)
src/main.jsx          사용자 화면 React 진입점
src/admin-main.jsx     관리자 화면 React 진입점
src/GuildPartyMatcher.jsx        사용자 화면 컴포넌트
src/GuildPartyMatcherAdmin.jsx    관리자 화면 컴포넌트
src/lib/storage.js     구글 시트(Apps Script) API를 호출하는 저장소 어댑터
apps-script/Code.gs     구글 시트에 붙이는 백엔드 스크립트 (직접 배포 필요)
```

## 1) 구글 시트 + Apps Script 배포 (먼저 해야 함)

1. 새 구글 시트를 만듭니다.
2. 확장 프로그램 → Apps Script를 열고, 기본 코드를 지운 뒤
   `apps-script/Code.gs` 내용 전체를 붙여넣습니다.
3. 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성에 `ACCESS_TOKEN`을
   원하는 임의의 문자열로 추가합니다. (이 값이 일종의 비밀번호입니다)
4. 배포 → 새 배포 → 유형: **웹 앱**
   - 실행 계정: 나
   - 액세스 권한: **전체(Anyone)**
   로 설정 후 배포하고, 나오는 웹앱 URL을 복사해둡니다.
5. `Code.gs` 파일 안에 더 자세한 설명과 보안 관련 주의사항이 주석으로
   적혀 있으니 꼭 한 번 읽어보세요. (요약: 이 토큰 방식은 완전한 보안이
   아니라 최소한의 잠금장치입니다.)

## 2) 로컬에서 실행

```bash
npm install
cp .env.example .env
# .env 파일에 VITE_STORAGE_API_URL, VITE_STORAGE_API_TOKEN 채우기
npm run dev
```

- 사용자 화면: http://localhost:5173/
- 관리자 화면: http://localhost:5173/admin.html

## 3) Git + Vercel 배포

1. 이 폴더를 그대로 Git 저장소로 만들어 GitHub 등에 푸시합니다.
   (`.env`는 `.gitignore`에 포함되어 있어 커밋되지 않습니다 — 토큰이
   깃허브에 올라가지 않도록 꼭 확인하세요.)
2. Vercel에서 새 프로젝트로 이 저장소를 Import 합니다. 프레임워크는
   Vite로 자동 인식됩니다.
3. Vercel 프로젝트 설정 → Environment Variables에 다음을 추가합니다:
   - `VITE_STORAGE_API_URL`
   - `VITE_STORAGE_API_TOKEN`
4. 배포하면 `/`는 사용자 화면, `/admin.html`은 관리자 화면으로 접속됩니다.

## 참고 / 한계

- 자동 매칭의 "48시간 후 자동 삭제"는 관리자 화면이 브라우저에 열려있는
  동안에만 체크됩니다. 실제 운영에서는 Vercel Cron Job 등 서버 쪽
  스케줄러로 옮기는 것이 정확합니다.
- 구글 시트 저장 방식은 소규모 길드 트래픽에는 충분하지만, 동시 쓰기가
  많아지면 (여러 명이 동시에 저장) 약간의 지연이나 경합이 생길 수 있습니다.
- `admin.html`은 URL을 아는 사람은 누구나 접근할 수 있는 화면이라
  관리자 비밀번호(관리자 화면 안의 로그인)로만 보호됩니다. 더 강한
  보안이 필요하면 Vercel의 배포 보호 기능이나 별도 인증을 추가하세요.
