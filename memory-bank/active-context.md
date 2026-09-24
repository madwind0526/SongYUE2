# Active Context

## Current Focus

- **Wave 49 정리 완료(2026-09-24)**: AuK 제거 + Audio Tools 재구성(audio.cpp). 상세 계획과 인수인계는 `todo.md` 최상단 "진행 중 계획"과 `progress.md` "다음 에이전트용 상세 계획".
- **P1 완료(RVC)**, MeanVC2는 Audio Tools '음색 변조'(말소리, 마이크 녹음 입력)로 이동. **다음 작업**: P3 대사 편집 탭 또는 P5 실시간 스트리밍 변환(Vevo2 editing 등 한국어 실측) → P4 효과음 생성 탭. Pending: 강제 정렬, 화자 분리, ACE-Step 편집.

## Pending

- 없음(사용자가 Typecast 유료 복제·화면 실확인·VibeVoice-ASR을 직접 확인함).

## Commit Notes

- Wave 47~49 변경을 한 번에 커밋(새 파일 `backend/tts.mjs`, `backend/typecast.mjs` 포함, `docs/auk-integration.md` 삭제). `.vscode/`는 제외.
