# Active Context

## Current Focus

- **Wave 47 진행 중(구현 완료 + TTS 버그 수정, 커밋 대기).** TTS 사용자 실기 리포트 2건 수정: ① 한국어 내용이 중국어로 나옴(자동/한국어 모두) → `descriptionTtsInstruction`/`cloneTtsInstruction`의 ko/mixed/en 지시문을 언어 금지(ko는 중국어/영어 혼입 명시 금지)+"말할 내용" 마커+끝나면 멈춤 워딩으로 전면 강화. ② 영어 텍스트 끝 ~1초 환각 → 원인 2개 해결: (a) `selectTool`/`selectCategory`가 TTS 도구에 `seconds` 기본값을 강제 10으로 되돌리고 있었음(고정 10초 예산=사용자 증상의 직접 원인) → 0으로 고정해 자동 추정 경로 활성화, (b) `estimateSpeechSeconds`에 ×0.9 캘리브레이션(AuK 출력은 요청 seconds만큼 정확히 잘리고 남는 시간을 지어냄 — ComfyUI-AuK runtime.py 확인). TTS 분할(`splitSpeechText`)이 청크(초) 설정을 따르도록 파라미터화(최대 10초 상한). 발화 언어/출력 길이 힌트 문구 갱신.
- Wave 47 나머지: ① 청크/겹침 입력, ② 발화 언어 선택, ③ 라벨/기본값(TTS 길이 0, Audio Tools), ④ 모델 BF16/인코더 INT8 기본값 — 이미 구현 완료.
- 검증: `npm run check`(tsc) 통과, `npm test` 23/23 통과.
- **미커밋.** 커밋 메시지 제안: Wave 47(청크/겹침 설정, TTS 언어 선택, BF16/INT8 기본값) + Wave 48(TTS 한국어→중국어 환각·끝부분 지어냄 버그 수정, 지시문/길이 추정 강화).

## Pending

- 사용자 로컬 테스트(Audio Tools TTS 한국어·영어·혼합 재확인, 청크/겹침, 음색 변조 분할) 후 필요시 조정.
- TTS 실제 한국어 발화가 여전히 중국어면 AuK 모델 한계 가능성 높음(instruction 언어 신호 약함 — README 근거) → 그때 지시문 추가 실험 또는 사용자 판단 요청.
- 이전 리뷰 잔여 항목(우선순위 낮음): splitSpeechText 문장부호 없는 초장 절(E3), DDSP reflow.yaml regex 검증(E4), audioAukEndpoint loopback(S1), AudioAuK /api/settings PUT 모델 재로드 여부·auk_flash.safetensors 존재 확인.
- 나머지 Tools 지적사항(Todo): 비언어음 위치 반영(GUIDE: position 단어+출력 여유 추가), 속도 everything·factor 스케일링, 피치 number 기본값 no-op('0') — 아직 미처리.

## Commit Notes

- 스테이지: `app/app/studio.tsx`, `backend/server.mjs` (+ 선택적으로 memory-bank). `.vscode/` 제외.