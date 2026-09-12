# Active Context

## Current Focus

- **후처리/EQ 기능 완성**: "악기만" 구조적 무보컬 생성(원본 Python 모델 한정, `abc_tools.py strip-chords`) + 완성곡 후처리/EQ 스튜디오(10밴드 EQ+프리셋, FxSound/리버브·에코 노브, Web Audio 실시간 미리듣기, A/B 재생, 원형 라이브 비주얼라이저)가 모두 구현되고 실제 브라우저에서 검증됨.
- **EQ 프리셋 / 전체 설정 프리셋 저장 위치**: 처음엔 localStorage(EQ)·파일 다운로드(전체 설정)였으나, 사용자 요청으로 이름 붙여 저장하는 서버 파일로 전환. `library/setting`은 초안 스캐너가 모든 `.json`을 프로젝트로 읽으므로 절대 그 안에 두면 안 됨 — 별도 최상위 `Setting/EQ-preset/`, `Setting/PostProcess/`에 저장(`backend/server.mjs`의 `eqPresetsDir()`/`postprocessSettingsDir()`). `GET/POST/DELETE /api/eq-presets`, `GET/POST/DELETE /api/postprocess-settings`.
- **UI 세부 조정 다수 반영**: 토글 버튼(EQ/FX Sound/리버브·에코)에 초기화 아이콘을 같은 박스 안에 병합, 재생 중인 원본/처리 박스를 트랙별 색상(녹색/금색)으로 강조, `AnalyserNode`로 실제 재생 오디오를 읽어 그리는 원형 비주얼라이저(18개 겹치는 곡선, 재생 전엔 "SOUND / FX" Baloo 2 워드마크).
- **문서화 완료**: `progress.md`(남은 일), `revision.md`(git log 기반 변경 이력), `README.md`(주요 기능 갱신) 신규/갱신. `docs/local-api.md`에 새 엔드포인트 3개(`post-process`, `eq-presets`, `postprocess-settings`) 반영은 아직 안 됨 — `progress.md`에 명시.

## Pending / Not Yet Done

- `docs/local-api.md`에 `post-process`/`eq-presets`/`postprocess-settings` 엔드포인트 미기재, `/api/abc-notes`도 여전히 JSON 기준 설명.
- SheetSage2 제로샷 커버, INT8 ConvRot 어댑터 연동, ABC 파일 가져오기는 여전히 실제 환경 종단 검증 전(코드/수동 브라우저 검증만).
- 프론트엔드 자동화 테스트 없음(후처리/EQ 다이얼로그 등은 chrome-devtools MCP 수동 검증만).
