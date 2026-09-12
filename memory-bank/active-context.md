# Active Context

## Current Focus

- Wave 7 완료: ABC 악보 편집 팝업(현재 초안용, "심볼릭 작곡"/"악보 검사" 다음 순서), abcjs `SynthController` 기반 커스텀 오디오 재생(재생/정지/속도 x1·x2/볼륨/현재 음표 하이라이트+뷰포트 중앙 자동 스크롤), 음악 스타일 프리셋 설정화(`Music style Presets`, 영문 라벨+줄바꿈 텍스트박스), ABC 노트 카드를 song-card 레이아웃으로 통일 + 앨범 커버 업로드, "보컬+악기 / 악기만" 토글(간편모드 아래) 추가 — 모두 tsc/backend 테스트/브라우저 확인 완료.
- **abcjs 재생 버그**: 버튼 클릭으로 재생하면 가끔(자동화 클릭에서 반복 재현, 실사용자 재현 여부는 미확인) 재생 시작 직후 `onFinished`가 오발돼 즉시 멈춤 — 근본 원인 미확정(라이브러리 소스까지 읽고 몽키패치까지 했음), `AbcPreview`의 `onFinished`에 "경과 시간 < 곡 길이 절반이면 자동 재시도" 방어 가드를 추가해 완화. 상세: `knowledge/trouble-shooting.md`.
- **보컬+악기/악기만**: `Draft.instrumental: boolean` 추가. 악기만 선택 시 가사는 그대로 두고(사용자 요청: 가사를 프롬프트로도 활용) 스타일에 `, instrumental, no vocals`만 자동 추가, 보컬 성별 UI만 숨김. 백엔드 `styleHint(project)`가 `vocalHint`를 대체(`server.mjs`). **실제 audio.cpp/Python 생성 결과로 악기만 모드가 잘 동작하는지는 아직 미검증**(API 배선만 확인).
- **스킵한 항목**: 텍스트 커서 위치 → 악보 자동 스크롤(수정 중인 텍스트에 대응하는 음표로 스크롤)은 사용자가 "어려우면 skip" 허용 — abcjs가 문자 오프셋↔SVG 엘리먼트 매핑을 제공하긴 하나 신뢰성 있게 구현하기엔 조사가 더 필요해 보류.

## Current Focus (계속)

- **에이전트 기반 편집(로드맵 3번) 완료**: `POST /api/llm/abc-edit`(`server.mjs`) — 설정된 LLM(`ask()` 재사용)에 "지시사항 + 현재 ABC"를 보내 수정된 ABC notation만 반환받음(코드펜스 제거 후처리). 프론트: "악보 편집" 팝업 두 곳(라이브러리 노트 편집, 현재 초안 편집) 모두에 "AI에게 지시" 입력창 + "AI 적용" 버튼 추가. Ollama(gemma4)로 실제 브라우저 테스트 완료 — "템포를 M:3/4로 바꿔줘" 지시로 헤더 라인이 실제로 바뀌고 미리보기에 반영되는 것까지 확인.
- **악보 편집 팝업 레이아웃 버그 수정**: 재생 컨트롤이 `.dialog-scroll`(스크롤 영역) 안에 있어서 스크롤해야 보이던 문제 — `AbcPreview`에 `controlsSlot` prop을 추가해 `ReactDOM.createPortal`로 컨트롤 DOM을 `.dialog-scroll` 바깥의 별도 sibling div(`.abc-player-slot`)로 이동. `.studio-dialog`가 이미 `flex-direction:column`이라 `.dialog-scroll`만 `flex:1`로 스크롤되고 `.abc-player-slot`/`.abc-ai-edit-row`/`.dialog-actions`는 항상 보이는 고정 행이 됨. 인라인(고급설정) 사용처는 `controlsSlot` 안 넘기면 기존처럼 내부 렌더링 유지.
- **제로샷 커버(로드맵 4번) 조사 완료 + 플러밍(배관) 구현 완료**: Explore 에이전트 조사 결과, `test/YuE2-source/skills/yue2-music/`에 이미 상세한 설계 문서(`references/models-and-setup.md`)와 실제 동작하는 `scripts/transcribe.py`(SheetSage2 Transformers 인터페이스 CLI 래퍼)가 존재함 — 단, **SheetSage2/MERT-v2-FullSong 모델과 별도 venv(`.venv-sheetsage2`, Python 3.10/3.11, torch 2.8.0, transformers 4.45.2 — YuE2용 venv와 호환 안 됨)는 아직 설치/다운로드되지 않은 상태**(`docs/models.md`가 23.3GB 다운로드에서 명시적으로 제외한다고 확인). 가중치는 CC BY-NC 4.0(비상업적 전용) 라이선스.
  - 구현한 것: `Settings.sheetSagePythonPath`(새 설정 필드, `run_yue2.py`와 같은 폴더의 `transcribe.py`를 자동으로 찾음), 백엔드 `runTranscribe()`+`POST /api/cover-transcribe`(오디오 dataURL 업로드 → `transcribe.py --task melody-full` 실행 → `score.abc` 반환, `generating` 플래그로 YuE2 생성과 GPU 충돌 방지), 프론트 "오디오에서 추출" 버튼(작곡 계획 섹션, "심볼릭 작곡" 바로 다음)+숨김 파일 input+`handleCoverAudioFile` 핸들러(FileReader→dataURL→API→`draft.abc`에 반영), 설정 페이지에 SheetSage2 Python 경로 입력란 추가.
  - **아직 안 한 것(사용자 책임)**: 실제 `.venv-sheetsage2` 만들기 + `huggingface-cli download m-a-p/SheetSage2` 실행 — 수 GB 다운로드에 시간이 걸리고 라이선스가 비상업적이라, 자동으로 진행하지 않고 사용자가 `models-and-setup.md`의 정확한 명령을 따라 직접 설치하도록 남겨둠. 설치 전에는 버튼을 눌러도 "설정에서 SheetSage2 Python 실행 파일 경로를 확인해 주세요" 같은 명확한 한국어 에러만 뜨고 앱은 정상 동작(curl로 확인 완료).

## Pending / Not Yet Done

- 제로샷 커버: 사용자가 SheetSage2 venv+모델을 실제로 설치한 뒤 end-to-end(실제 오디오 업로드 → ABC 추출 → cot="melody"로 재생성)까지 검증 필요. `--task` 기본값(`melody-full`)이 적절한지, `--offline` 플래그를 언제 자동으로 켤지(모델이 로컬에 있는지 감지)도 다음 단계에서 결정할 것.
- "보컬+악기/악기만" 토글이 실제 생성 결과물 품질에 미치는 영향은 실제 생성을 돌려봐야 확인 가능(현재는 API 경로 연결만 확인).
- `docs/local-api.md` 등 문서는 계속 미갱신 상태로 누적 중.
