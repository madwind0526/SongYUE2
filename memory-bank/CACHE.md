# Cache

> 임시 발견사항 저장소. Wave 완료 후 knowledge/로 flush하고 이 섹션을 비울 것.

## Active Findings

| # | 유형 | 발견사항 | 상태 |
|---|------|----------|------|
| F1 | 버그/확정 | AudioAuK `AuKGenerateEdit`/`runtime.generate()`는 요청한 `seconds`만큼 **정확히** 오디오를 생성 후 `audio[..., :round(target_seconds*24000)]`로 자름. seconds가 실제 발화보다 길면 남는 시간을 지어낸 말로 채움(끝 ~1초 환각). 근거: ComfyUI-AuK `nodes/runtime.py:233` | wave 48 |
| F2 | 버그/확정 | Audio Tools TTS의 `selectTool`/`selectCategory`가 TTS 도구 선택 시 `seconds` 기본값을 강제로 10으로 설정 → 고정 10초 예산 → 영어 텍스트(~9초 발화)에 끝 1초 환각 추가. `run()`의 자동 추정(seconds=0) 경로가 발동하지 않던 직접 원인 | wave 48 |
| F3 | 버그/확정 | 한국어 TTS 내용이 중국어 발화로 나옴 — 발화 언어 '자동'·'한국어' 모두 동일. AuK 모델은 지시문 언어 신호가 약함(README prompt adherence: "instruction language can materially affect the result"). Wave 47의 한국어 스캐폴딩만으로는 불충분, 언어 금지+정확한 내용 마커 명시로 강화 | wave 48 |
| F4 | 해결 | `estimateSpeechSeconds` 10% 과대 추정 → `×0.9` 캘리브레이션 추가(영어 ~167wpm, AuK 노드 가이드 2-3 words/sec와 일치). TTS 분할도 청크(초) 설정을 따르되 최대 10초 상한 | wave 48 |
| F5 | 지식 | ComfyUI-AuK 노드 위치: `C:\Claude\AudioAuK\engine\ComfyUI\custom_nodes\ComfyUI-AuK` (nodes.py TASKS 26개, runtime.py generate/시간 클립, README prompt adherence 단원). AudioAuK API에 TTS 언어 강제 필드 없음(opencode 문서에 없음) | wave 48 |