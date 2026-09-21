# Cache

> 임시 발견사항 저장소. Wave 완료 후 knowledge/로 flush하고 이 섹션을 비울 것.

## Active Findings

- (Wave 44, 2026-09-22) Seed-VC/Vevo2 10초 청크 변환 + Tools 청크 확장 구현 완료.
  - seed_vc/vevo2 긴 보컬 실행은 `applyVocalTimbreCore`가 AuK와 동일한 상수/헬퍼로 10초 창·2초 겹침·테두리 1초 트림을 재사용, 모든 조각에 동일 참조 클립(`voice-ref-normalized.wav`) 재사용, `{ ok, warning, chunkCount }` 반환 + `onProgress` 연결.
  - `runAukTool`에 `chunk` 플래그 신설 — 위치/길이 무관 지시문 전용(비언어음 추가·가사/대사 편집·voice-cloning 참조는 프론트가 chunk를 안 보냄). 프론트 `AukTool`에 `referenceOnly` 추가, `chunkContentAudio` 조건 분기.
  - TTS는 `estimateSpeechSeconds>10 && seconds===0`이면 `splitSpeechText`로 발화 조각 분할 → 잡별 생성 → `concatBuffers` 이어붙이기. `seconds>0`이면 분할 안 함(사용자 의도 존중).
  - 테스트 2건 추가(legacy 26초→3조각·같은 ref·atrim/concat·게인/게이트 유지, audio-tools chunk:true→잡·업로드 3회·동일 instruction·warning, chunk 해제→단일 기존 경로). 23개 전부 통과, `npm run check` 통과.

## 유형 분류

| 유형 | 이동 대상 |
|------|-----------|
| 코드 패턴 | `knowledge/PATTERNS.md` |
| 규칙/원칙 | `knowledge/RULES.md` |
| 버그/해결 | `knowledge/trouble-shooting.md` |