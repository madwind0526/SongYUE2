# Active Context

## Current Focus

- **후처리/EQ 기능 완성**: 완성곡 후처리/EQ 스튜디오(10밴드 EQ+프리셋, FxSound/리버브·에코 노브, Web Audio 실시간 미리듣기, A/B 재생, 원형 라이브 비주얼라이저)가 모두 구현되고 실제 브라우저에서 검증됨.
- **"악기만" 무보컬 메커니즘 재검증 및 수정**: 사용자가 YuE2의 2성부(Vocal/Ins) 설계를 상세히 설명하며 재검토를 요청 — 기존 `abc_tools.py strip-chords --keep-voice Ins`는 Vocal을 쉼표로 바꾸면서 **화음 기호까지 전부 지워** native 방언의 설계(화성은 오직 Vocal에만 존재하고, 쉬는 동안에도 남아 있어야 함 — `references/abc-editing.md`)와 어긋났음. `abc_tools.py`에 화음은 건드리지 않고 음표만 쉼표로 바꾸는 `mute-voice` 명령을 신설하고 `backend/server.mjs`의 `stripVocalVoice()`를 전환. `node --test backend/server.test.mjs` 8/8 통과. **실제 오디오로 화성 유지 여부는 아직 검증 전** — `progress.md` 참고.
- **문서화**: `docs/local-api.md` 엔드포인트 표를 코드 기준으로 전면 재작성(이전에 알려진 3개 누락이 아니라, 재생목록/커버/ABC 관련 대부분이 빠져 있었음), `Setting/` 폴더 설명 추가. `docs/models.md`의 SheetSage2 절을 최신 파일 상태로 갱신(config.json+코드 설치 완료, 별도 venv만 남음).
- **EQ 프리셋 / 전체 설정 프리셋 저장 위치**: `library/setting`은 초안 스캐너가 모든 `.json`을 프로젝트로 읽으므로 절대 그 안에 두면 안 됨 — 별도 최상위 `Setting/EQ-preset/`, `Setting/PostProcess/`에 저장(`backend/server.mjs`의 `eqPresetsDir()`/`postprocessSettingsDir()`).

## Pending / Not Yet Done

- **SheetSage2 제로샷 커버**: 모델 파일(가중치+config+코드)은 이미 설치 완료. 남은 것은 `test/YuE2-source/requirements-sheetsage2.txt`용 별도 Python venv 생성 + 설정의 `sheetSagePythonPath` 지정뿐(본체 venv와 torch/transformers 버전이 달라 공유 불가) — venv는 아직 만들지 않음.
- `mute-voice` 전환이 실제 원본 엔진으로 화성이 유지된 무보컬 오디오를 만드는지 실기 검증 필요(유닛 테스트만 통과).
- INT8 ConvRot 어댑터 연동, ABC 파일 가져오기, 비-Chromium 폴백은 여전히 실제 환경 종단 검증 전.
- 프론트엔드 자동화 테스트 없음(후처리/EQ 다이얼로그 등은 chrome-devtools MCP 수동 검증만).
- 향후 개선 아이디어(비주얼라이저 커스터마이즈, 프리셋 내보내기/가져오기, 후처리 "전체 초기화" 버튼)는 재확인 결과 여전히 미구현 — 우선순위 낮음, `progress.md` 참고.
