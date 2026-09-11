# AuK 후처리 검토

확인일: 2026-09-12. 현재 UI 구현과 별개의 후속 확장 계획이며 AuK 모델은 아직 다운로드하거나 실행하지 않았습니다.

## 권장 흐름

YuE2 생성 → 보컬/반주 분리 → 짧은 보컬 구간 선택 → AuK 가사 수정 → 시간 정렬과 경계 크로스페이드 → 반주 재결합 → 원본과 비교.

AuK는 ComfyUI가 필수가 아닙니다. CLI `auk-infer`, Python API `AukInfer`, Gradio, 선택적 ComfyUI 연동을 제공합니다. 본 앱에서는 별도 Python 프로세스 어댑터로 실행하고, 작업 간 GPU 모델을 해제하는 구조를 권장합니다. 프로세스 분리만으로 12GB 실행 가능성을 보장하지 않습니다.

공식 가사 편집은 반주 없는 아카펠라 입력이 필요합니다. 보컬 추출은 지원하지만 정밀한 반주 stem 복원과 믹싱은 별도 검증이 필요합니다. 음악 전체에 음성 잡음 제거를 적용하는 것을 기본 동작으로 삼지 않습니다. 한국어 가사 수정, 멜로디/음색 보존, 길이 및 샘플레이트, 긴 곡 분할 경계 품질은 미검증입니다. ComfyUI 통합의 입력/출력 합산 30초 제한을 일반 CLI 무제한 지원으로 해석하지 않습니다.

필요 자원: AuK 또는 AuK-Flash, VAE, Qwen2.5-Omni-3B 인코더 및 Python 환경. AuK 1.5B라는 수치만으로 전체 VRAM을 판단하지 않습니다. AuK와 YuE2를 동시에 올리지 않고 순차 실행하도록 설계합니다.

UI 후속안: 생성 결과의 '후처리' → '보컬 추출 / 가사 한 구절 수정' → 원문/수정문 및 구간 설정 → '새 버전으로 저장'. 현재 메뉴에는 미구현 기능 버튼을 추가하지 않았습니다.

## 출처

- https://github.com/Tencent-Hunyuan/AuK
- https://github.com/Tencent-Hunyuan/AuK/blob/main/docs/COOKBOOK.md
- https://github.com/Tencent-Hunyuan/AuK/blob/main/docs/COMFYUI.md
