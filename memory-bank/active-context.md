# Active Context

## Current Focus

- Wave 55: SongYUE2 MP4 합성 출력을 1024×1024 정사각형으로 변경. `FFMPEG_ARGS.mp4`를 쓰는 생성·저장·외부 API 경로에 공통 적용.
- SongYUE2가 표지 없이 MP4를 만들 때 쓰는 배경 입력도 1024×1024로 맞춤.
- 실제 보관함 MP4에서 표지 프레임·5초 오디오를 추출해 합성했고, ffprobe로 1024×1024 영상과 오디오 스트림을 확인함.
- 다음 후보: 다른 VST3 플러그인 동작 시험, Audio Tools "AI 처리"에 VST3 UI, 가사 반영 표지(LLM 필요), 캡션(.txt) 학습 확인, 곡 청취 평가.
- UI 검증 후속: 실제 모바일 키보드/OS 큰 글꼴.

## Commit Notes

- 이번 Installed 필터 및 남은 일 문서 정리는 미커밋. 기존 미추적 `.vscode/`, `scripts/lora_compare.py`는 수정하지 않음.
