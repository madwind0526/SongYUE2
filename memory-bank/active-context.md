# Active Context

## Current Focus

- **음색 변조(실험적) 파형 미표시 버그 수정(2026-09-20)**: Seed-VC/Vevo에서 원본/참조 선택 시 오른쪽 파형이 안 보이고 아이콘·라벨·파형이 세로로 쌓이는 문제를 수정 — 원인은 `TimbreTransformDialog`가 재사용하는 `audio-compare-dialog` 클래스의 `.stem-row{flex-direction:column}`(+column flex에서 `.pp-waveform`의 flex-basis:0 높이 붕괴). 레거시 목록에 `timbre-legacy-list` 클래스를 추가하고 해당 행만 가로 단일 행(아이콘 왼쪽+파형)으로 복원. AuK/DDSP 차트 뷰는 무변경. `npm run check` 통과.
- 코드 감사(2026-09-20) 발견사항: DDSP 취소가 실제 중단이 아님, `/timbre-transform/prepare`에 generating 락 부재(미수정 — 다음 세션 우선순위), `withEstimatedProgress` 100% 오표시, Vevo2 미반영 문서 drift(README·model-download-status.json) 등 — `memory-bank/knowledge/`로 flush 완료.
- **`todo.md` 밀린 항목 정리(2026-09-20)**: "커버→노래 만들기 완주 검증"(API 레벨로 재현 시도했으나 에러 없이 정상 완주 — 이전에 원인 불명 에러로 막혔던 기록은 이후 다른 세션들의 GGUF/ABC 수정으로 이미 해결된 것으로 보임), ABC "파일에서 가져오기" 브라우저 종단 검증(raw 텍스트+JSON 래핑 둘 다 확인), EQ/전체 설정 프리셋 내보내기·가져오기 신규 구현(기존 라우트 재사용, `showSaveFilePicker`/`<a download>` 양쪽 실기 검증) — 전부 완료. 상세는 `todo.md`.
- **DDSP-SVC 품질 개선 실험 4종 완료, 종합 결론(2026-09-20)**: pitch extractor 6종+vocoder는 기존 100k스텝 체크포인트로 추론만 재실행(저비용)해 비교 — 둘 다 원곡과의 거리가 0.117~0.125로 좁아 원인 아님. Feature encoder(ContentVec↔HubertSoft)만 재학습이 필요해 HubertSoft를 동일 데이터셋·동일 하이퍼파라미터로 100k스텝까지 실제 재학습(~3시간)해 비교 — **세 체크포인트(40k/70k/100k) 전부 ContentVec이 HubertSoft보다 원곡에 더 가까움**(가설과 반대 방향, 바꿀 이득 없음). 데이터셋 확대는 같은 목소리의 추가 레퍼런스가 없어 실행 불가. **결론: "음색이 좁다"는 소견의 원인은 이 4개 파라미터가 아니라 데이터셋 크기(81클립/12분, 단일 화자) 자체일 가능성이 높음** — 검증하려면 사용자가 같은 목소리의 새 레퍼런스 클립을 구해와야 함. 상세: `test/vocal-timbre-engine-comparison/README.md`.
- **"음색 변조"/"오디오 도구" 실기 검증 완주 + DDSP-SVC 체크포인트 버그 발견·수정(2026-09-19)**: 실제 GPU로 `targetStep` 작은 학습을 돌려보니 kill-at-target 메커니즘은 정상이었지만, `configs/reflow.yaml`의 `interval_val: 2000`(체크포인트 저장 주기) 때문에 작은 목표 스텝에서는 체크포인트가 단 한 번도 안 만들어져 실패 — `backend/ddsp-svc.mjs`에서 `interval_val`을 `targetStep`에 비례해 패치하도록 수정, 재검증 성공. **교훈**: [[interval-based-checkpoint-cadence-mocks]] — 주기적으로만 발생하는 부작용을 mock으로 시뮬레이션할 때는 실제 주기 상수를 읽어서 반영해야 "항상 자주 일어난다"는 낙관적 가정이 드문 이벤트 의존 버그를 가려버리는 일을 피할 수 있다.

## Pending / Not Yet Done — 큰 설계 결정·새 엔진 설치가 필요해 사용자 확인 후 진행

- **STEM 분리 모델 선택 UI**: 지금은 모드당 모델이 1개뿐이라(`STEM_MODES`) 진짜 "선택"의 의미가 없음 — 6스템 Demucs(`htdemucs_6s`) 같은 새 옵션을 실제로 추가하려면 별도 독립 Python Demucs 설치가 필요.
- **audio.cpp 미사용 모델군**: Stable Audio(인페인팅/컨티뉴에이션), ACE-Step GGUF 네이티브 경로, RVC — 전부 "발견만 된 후보", 다운로드/실측 후 채택 여부 판단 필요.
- **"DDSP Func" 팝업**(실시간 변환/음색 믹싱/다중 화자): DDSP-SVC를 실제 SVC 엔진으로 채택 확정 시 같이 설계하기로 보류.
- **프론트엔드 자동화 테스트 없음**: 지금까지 전부 수동 브라우저 검증(Playwright)만 — 회귀 테스트 스위트 자체가 큰 신규 이니셔티브라 별도 논의 필요.
- **File System Access API 비-Chromium 폴백**: 이 환경에 비-Chromium 브라우저가 없어 검증 불가, 계속 보류.
- 그 외 세부 항목은 `todo.md` 참고(단일 진실 공급원으로 유지).
