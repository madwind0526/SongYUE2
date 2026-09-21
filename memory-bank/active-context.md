# Active Context

## Current Focus

- **Seed-VC/Vevo2 10초 청크 변환 + Tools 청크 확장(2026-09-22, 커밋 대기)**: AuK에만 있던 청크 처리를 Seed-VC/Vevo2와 Tools 오디오 도구로 확장. `applyVocalTimbreCore`가 10초 창·2초 겹침·테두리 1초 트림으로 긴 보컬을 나눠 변환(같은 참조 클립 재사용·`onProgress`·`{ok, warning, chunkCount}` 반환), `runAukTool`에 `chunk` 플래그(위치/길이 무관 지시문 전용 — voice-cloning 참조·비언어음 추가·가사/대사 편집 제외), TTS는 긴 텍스트를 `splitSpeechText`+`concatBuffers`로 자동 분할 생성(seconds>0이면 분할 안 함). 테스트 23개 + tsc 통과. 커밋 여부 사용자 확인.

## Next Focus (후보)

- 코드 감사 발견사항: `/timbre-transform/prepare`에 generating 락 부재(미수정 — 우선순위), Vevo2 미반영 문서 drift(README·model-download-status.json).

## Pending / Not Yet Done — 큰 설계 결정·새 엔진 설치가 필요해 사용자 확인 후 진행

- **STEM 분리 모델 선택 UI**: 지금은 모드당 모델이 1개뿐이라(`STEM_MODES`) 진짜 "선택"의 의미가 없음 — 6스템 Demucs(`htdemucs_6s`) 같은 새 옵션을 실제로 추가하려면 별도 독립 Python Demucs 설치가 필요.
- **audio.cpp 미사용 모델군**: Stable Audio(인페인팅/컨티뉴에이션), ACE-Step GGUF 네이티브 경로, RVC — 전부 "발견만 된 후보", 다운로드/실측 후 채택 여부 판단 필요.
- **"DDSP Func" 팝업**(실시간 변환/음색 믹싱/다중 화자): DDSP-SVC를 실제 SVC 엔진으로 채택 확정 시 같이 설계하기로 보류.
- **프론트엔드 자동화 테스트 없음**: 지금까지 전부 수동 브라우저 검증(Playwright)만 — 회귀 테스트 스위트 자체가 큰 신규 이니셔티브라 별도 논의 필요.
- **File System Access API 비-Chromium 폴백**: 이 환경에 비-Chromium 브라우저가 없어 검증 불가, 계속 보류.
- 그 외 세부 항목은 `todo.md` 참고(단일 진실 공급원으로 유지).