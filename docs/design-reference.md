# SongYUE2 디자인 참조

2026-09-12 확인. 실제 참조 경로는 `C:\Claude\SNS-Reader`이며 소스는 수정하지 않았다.

## 소스에서 직접 확인한 SNS-Reader 스타일

출처: `src/styles/app.css`, `src/App.tsx`의 `PlatformSidebar`, `TopToolbar`.

| 항목 | 값 |
|---|---|
| 글꼴 | `"Segoe UI", "Noto Sans KR", Inter, system-ui, sans-serif` |
| 어두운 바탕 / 본문 | `#171817` / `#f3f1ea` |
| 기본 강조 / 어두운 활성 강조 | `#1f6f68` / `#8ed8c8` |
| 어두운 보조 본문 | `#bac6c0` |
| 어두운 구분선 | `rgba(243,241,234,0.14)` |
| 어두운 입력 배경 | `rgba(255,255,255,0.06)` |
| 활성 배경 / 테두리 | `rgba(31,111,104,0.12)` / `rgba(31,111,104,0.34)` |
| 컨트롤 모서리 | `8px` |
| 사이드바 | `140px`; 내부 여백 `16px 12px` |
| 메뉴 | 높이 `46px`, 최대 너비 `112px`, 아이콘 열 `24px`, 간격 `8px` |
| 아이콘 버튼 | `44px × 44px` |
| 상단 도구 모음 | 여백 `16px 22px`, 간격 `18px` |
| 제목 / 부제 | `1rem / 650`, `0.76rem / 500` |

사이드바는 `grid-template-rows: 1fr auto`로 상단 탐색과 하단 도구를 분리한다. 원본 하단 도구는 검색·필터·질의·폴더·태그·갱신이며 설정은 상단 도구 모음에 있다. SongYUE2는 요청대로 설정을 왼쪽 하단에 둔다.

참조 스크린샷은 `C:\Claude\SNS-Reader\screenshot\00.png`부터 `05.png`까지 존재한다. 위 값은 화면 추정이 아닌 소스 추출값이다.

## 적용 방향

- SNS-Reader의 짙은 회색, 청록색 강조, 얇은 테두리, 조밀한 컨트롤을 유지한다.
- Suno에서 참고할 흐름: 왼쪽 상단 탐색, 하단 설정, 중앙 작곡 입력, 결과 목록과 재생 영역.
- 메인 상단에 음악 모델 선택을 둔다. 가사 보조 LLM 선택과 키 입력은 설정에 둔다.
- 한국어 UI를 제공하고 Suno 로고·고유 배색을 복제하지 않는다.
- 첫 화면은 가사·스타일·고급 설정·결과를 다루는 실제 작업 공간이다.
- 입력 폼은 스크롤 가능하게 만들고 작은 화면·큰 글꼴·키보드 상태를 검증한다.

## 기존 해결 지식

`C:\Codex` 대신 실제 존재하는 `C:\Claude\memory-bank\INDEX.md`와 관련 문서를 읽었다.

- `css-grid-align-content-stretch.md`: 유연한 높이를 받는 grid 폼과 필드에 `align-content: start`를 명시한다.
- `python-subprocess-cp949-crash.md`: Node에서 실행하는 Python에 `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1`을 전달한다.
- `vite-config-imported-file-restart.md`: Vite 설정이 import한 서버 모듈의 변경도 서버 재시작을 유발한다. 재기동 후 API를 검사한다.
- SNS-Reader `memory-bank/knowledge/trouble-shooting.md`: 사용자 미들웨어의 변경 API는 Origin/Sec-Fetch-Site를 직접 검사한다. 한글 파일은 UTF-8로 명시해서 읽고 검증한다.

이 문서는 참조 감사 결과이며 SongYUE2 구현·생성·회귀 검증 완료를 뜻하지 않는다.
