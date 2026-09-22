# Active Context

## Current Focus

- 코드 리뷰(E1/E2/P1): ffmpeg 전 경로 하드 타임아웃, AuK fetch per-request 타임아웃, 반복 잡 동일 설정 PUT 캐시 — 23개 테스트+tsc 통과.
- 리뷰에서 남긴 미처리 항목: splitSpeechText의 문장부호 없는 초장 절(10초 초과 조각 잔존/E3), DDSP reflow.yaml regex 패치의 존재·단일성 검증(E4), audioAukEndpoint loopback 제한(S1).
- 확인이 필요한 데이터: AudioAuK의 `/api/settings` PUT이 실제로 모델을 재로드하는지(캐시 성과 근거), `auk_flash.safetensors`(flash fp32 변형) 실제 존재 여부.