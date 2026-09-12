# Active Context

## Current Focus

- **SheetSage2 제로샷 커버 — 종단 검증 완료(2026-09-12)**: 별도 venv(Python 3.11 + torch 2.8.0+cu128) 구축 후 실제 오디오로 `POST /api/cover-transcribe` 테스트 성공(결과 ABC가 `abc_tools.py inspect` 구조 검증도 통과). 과정에서 찾은 버그 2개 수정: (1) `models/m-a-p/SheetSage2/config.json`의 `weights_format`이 `adapter`로 잘못 설정되어 있었음(실제 파일은 `encoder.*` 876개 키를 가진 merged 체크포인트) — `merged`로 수정, `models/`는 gitignore라 재다운로드 시 다시 고쳐야 함(`docs/models.md`에 기록). (2) `backend/server.mjs`가 출력 폴더를 미리 만들어 `transcribe.py`의 `fresh_directory()`(exist_ok=False) 안전장치와 충돌 — 부모 폴더만 미리 생성하도록 수정(커밋됨).
- **"악기만"은 GGUF에서 아예 선택 불가로 변경**: 이전엔 소프트 힌트로 허용했으나, 구조적 보장이 없는 GGUF에서는 버튼 자체를 비활성화. 모델 전환/프로젝트 로드/localStorage 복원 등 모든 경로에서 `instrumental`이 비-Python 모델에 stuck되지 않도록 정리.
- **후처리/EQ 비주얼라이저 대폭 확장**: 색조/라인개수/굵기/변동폭(양방향, 안쪽은 바깥쪽의 절반)/잔상(destination-out 합성)/나선 정도/라인 모드(1:회전 2:시간축, 시간축은 고정 반지름+시간 간격+가속도)까지 전부 설정 가능. 캔버스 CSS 박스와 실제 해상도 불일치로 인한 타원 왜곡 수정, 링이 마지막→첫 점을 잇던 이상한 연결선 제거(열린 곡선으로 변경). 후처리 다이얼로그에 재생 위치 슬라이더 추가.
- **`mute-voice` 무보컬 메커니즘**: 화음 기호는 유지하고 음표만 쉼표 처리하는 구조적 방식(원본 Python 모델 전용). 유닛 테스트 통과, 실제 오디오로 화성 유지 검증은 아직 전.

## Pending / Not Yet Done

- `mute-voice` 전환이 실제로 화성이 유지된 무보컬 오디오를 만드는지 실기 검증 필요.
- INT8 ConvRot 어댑터 연동, ABC 파일 가져오기, 비-Chromium 폴백은 여전히 실제 환경 종단 검증 전.
- 프론트엔드 자동화 테스트 없음(수동 브라우저 검증만).
- EQ/전체 설정 프리셋 내보내기·가져오기는 여전히 미구현(우선순위 낮음).
