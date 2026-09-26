# Rules

> **2026-09-24: AuK(AudioAuK) 연동은 SongYUE2에서 제거되었다.** 이 문서의 AuK 관련 항목은 과거 이력이며 현재 코드에는 해당 기능이 없다(음성 인식은 audio.cpp Qwen3-ASR 등, Audio Tools는 audio.cpp/ffmpeg 기반).


> 이 프로젝트의 규칙과 컨벤션. 모든 sub-agent가 반드시 따라야 함.

## G-01: 코드 주석은 영어만 사용 (MANDATORY)

**규칙:** 모든 코드 주석(`//`, `/* */`, `///`)은 영어로 작성. 한글 주석 금지.
**이유:** 소스 파일 내 한글은 인코딩 문제 및 빌드 오류를 유발할 수 있음.
**적용 시점:** 코드 작성 또는 수정 시 항상. UI 텍스트(사용자에게 보이는 문자열)는 한국어 유지.

## API 키/시크릿은 `.env`에서만, 응답엔 항상 마스킹

**규칙:** LLM 제공업체 API 키·연결 주소·모델 이름은 `.env` 파일에서만 읽는다. `data/settings.json`에는 `provider`와 `enginePath`만 저장(시크릿 절대 금지). API 응답의 `apiKey` 필드는 키가 있으면 `'***'`, 없으면 `null`만 반환.
**이유:** 파일/로그/브라우저 응답에 평문 키가 남지 않게 하기 위함. `.env`는 `.gitignore`로 커밋 차단(`.env.sample`만 추적).
**적용 시점:** LLM 설정 관련 API(`/api/settings`, `/api/llm/*`)를 수정할 때.

## audio.cpp 모델 매핑

**규칙:** `modelId`(`yue2-q4`/`yue2-q8`/`yue2-bf16`)는 각각 `yue2-3b-{q4_0,q8_0,bf16}.gguf` + VAE(`yue2-vae-f16.gguf`, q4/q8은 F16, bf16은 `yue2-vae-f32.gguf`)로 고정 매핑한다. `yue2-original`(공식 Python 모델)은 audio.cpp로 실행할 수 없으므로 `/api/generate`가 400으로 거부해야 한다.
**이유:** audio.cpp는 GGUF 전용 런타임이고, safetensors 원본은 별도 Python 파이프라인이 필요함(테스트/YuE2-source 참고, 24GB VRAM 요구).
**적용 시점:** `AUDIOCPP_MODELS` 매핑 테이블을 수정하거나 새 모델을 추가할 때.

## 새 HTTP 메서드 추가 시 OPTIONS 프리플라이트도 갱신

**규칙:** `backend/server.mjs`에 GET/POST/PUT/PATCH 외의 새 메서드(DELETE 등)를 쓰는 라우트를 추가하면, `OPTIONS` 핸들러의 `Access-Control-Allow-Methods` 목록에도 반드시 같은 메서드를 추가한다.
**이유:** 프론트엔드(5176)와 백엔드(4311)가 다른 포트라 브라우저가 크로스오리진 프리플라이트를 보내는데, 목록에 없는 메서드는 CORS로 막혀 실제 라우트가 있어도 요청 자체가 도달하지 못한다.
**적용 시점:** 새 라우트/메서드를 추가할 때마다.

## 로컬 실행 파일/스크립트 경로 설정도 라이브러리 폴더처럼 SongYUE2 루트 기준 상대경로로 취급

**규칙:** `settings.enginePath`/`pythonEnginePath`/`pythonScriptPath`는 저장된 값을 `path.resolve(root, value)`로 해석한다(절대경로를 넣으면 `path.resolve`가 root를 무시하고 그대로 반환하므로 하위호환됨). `enginePath`만 프로젝트 표준 빌드 위치(`engine\audio.cpp\build\windows-cuda-release\bin\audiocpp_cli.exe`)를 기본값으로 갖고, 값이 비어 있으면 그 기본 상대경로를 사용한다(`resolveConfigPath`). Python 경로는 보편적 기본값이 없으므로 비어 있으면 그대로 빈 문자열 유지 → "설정에서 경로를 확인해 주세요" 에러(`resolveOptionalConfigPath`). `outputDirectory`(로그 폴더, 읽기전용)는 내부적으로는 절대경로를 계속 쓰되 `publicSettings()`가 `path.relative(root, outputDirectory)`로 변환해 사용자에게는 상대경로("runs")로만 보여준다.
**이유:** `settingPath`/`musicPath`/`examplesPath`와 일관된 멘탈 모델을 유지하고, 프로젝트 폴더를 통째로 옮기거나 다른 PC로 복사해도 설정이 깨지지 않게 하기 위함.
**적용 시점:** 로컬 실행 파일/스크립트/폴더 경로를 다루는 설정 필드를 추가하거나 수정할 때.

## HTML5 `<audio>`는 진짜 역재생(파형 반전)을 지원하지 않는다

**규칙:** "역재생" 기능이 필요하면 `audio.playbackRate`를 음수로 주지 말 것(브라우저별 동작이 일관되지 않고 대부분 무시/무음 처리됨). 이 프로젝트에서는 `setInterval`로 `currentTime`을 짧은 간격(100ms)마다 조금씩(0.15s) 되감는 "스크럽 근사"로 구현했다(재생을 멈추고 반복적으로 되감기만 함, 실제 반전된 파형이 들리는 게 아님).
**이유:** W3C HTMLMediaElement 스펙과 실제 브라우저 구현 모두 순방향 디코딩 파이프라인만 보장한다. 진짜 역재생 오디오가 필요하면 Web Audio API로 버퍼 전체를 디코드한 뒤 `Float32Array`를 직접 뒤집어 재생하는 방식으로 가야 하며, 이는 스트리밍이 아닌 전체 파일 사전 로드가 필요해 구현 비용이 훨씬 크다.
**적용 시점:** 오디오 플레이어에 "역재생"/"스크래치" 같은 기능을 요청받을 때, 구현 전에 이 제약을 먼저 사용자에게 알릴 것.

## ComfyUI 어댑터(`yue2-int8-convrot`)는 `engine/ComfyUI`에 독립 설치, 포트 8190

**규칙:** `models/comfy-org/YuE2/checkpoints/yue2_3b_int8_convrot.safetensors`는 ComfyUI 공식(Comfy-Org) INT8 ConvRot 형식이며 v0.35.0+ 네이티브 YuE2 지원(`comfy_extras/nodes_yue2.py`)으로만 실행 가능하다. SongYUE2는 `engine/ComfyUI`(`.gitignore` 대상, `engine/audio.cpp`와 같은 위치 규칙)에 전용 `.venv`(PyTorch 2.14.0+cu130, `pip install -r requirements.txt`가 `comfy-kitchen`도 함께 설치)로 독립 설치했다(2026-09-16, 처음엔 자매 프로젝트 `C:\Claude\AudioAuK\engine\ComfyUI`를 재사용했다가 사용자 요청으로 전환) — 포트를 AudioAuK의 ComfyUI(8189)와 겹치지 않게 **8190**으로 분리해서 두 설치가 서로 간섭 없이 독립적으로/동시에 동작한다. 체크포인트는 `engine/ComfyUI/models/checkpoints/`에 하드링크(같은 드라이브, `New-Item -ItemType HardLink`, 심볼릭 링크는 관리자 권한 필요해서 실패함)로 연결했다. `backend/comfyui.mjs`의 워크플로우 그래프: `CheckpointLoaderSimple → YuE2GenerateMusic(clip, style, lyrics, abc, seed, mode, max_duration) → ConditioningZeroOut(→negative) → EmptyYuE2LatentAudio(seconds) → KSampler(cfg=1.0, sampler=euler, scheduler=simple) → VAEDecodeAudio → SaveAudio`. cfg=1.0이라 negative는 실질적으로 무시됨(YuE2는 별도 negative prompt가 없음). `backend/server.mjs`의 `runComfyUi()`는 ComfyUI가 `settings.comfyUiEndpoint`(기본 `http://127.0.0.1:8190`)에서 응답 없으면 `settings.comfyUiEnginePath`(기본 `engine\ComfyUI`, SongYUE2 루트 기준 상대경로)의 `.venv\Scripts\python.exe main.py`를 온디맨드로 spawn한다(detached, `--disable-auto-launch`). 생성 완료 후 `POST /free {unload_models:true, free_memory:true}`로 VRAM을 명시적으로 해제한다(ComfyUI는 audio.cpp/Python과 달리 프로세스가 계속 떠 있어 모델을 VRAM에 남겨두므로, 안 해주면 이후 yue2-bf16/yue2-original 전환 시 RTX 5070 12GB에서 부족해질 수 있음). `YuE2GenerateMusic`은 `abc`가 빈 문자열이면 내부적으로 `mode`를 무시하고 "off"로 처리하므로, cot=full/melody인데 사용자가 ABC를 직접 안 넣은 일반 케이스는 `runComfyUi`가 먼저 `runPythonAction('plan', ...)`으로 심볼릭 작곡을 돌려 그 결과를 `abc`로 넘긴다 — 즉 **ComfyUI 모델도 cot≠off일 때는 여전히 Python 엔진(`pythonEnginePath`/`pythonScriptPath`) 설정이 필요**하다(cot=off로 계획 없이 생성할 때만 예외).
**이유:** 처음엔 사용자가 "이미 설치된 ComfyUI(AudioAuK)를 재사용, 새로 설치하지 말라"고 지시했으나(디스크/시간 절약), 이후 "독립적으로 설치"로 방침을 바꿨다(자매 프로젝트에 대한 의존성 제거 — AudioAuK의 ComfyUI 폴더가 이동/삭제/업데이트되면 SongYUE2도 영향받는 문제 해소). `/object_info`를 실제 ComfyUI에 curl로 조회해 정확한 노드 스키마를 확인한 뒤 그래프를 작성했다(추측 금지 — KSampler의 negative/cfg, VAEDecodeAudio/SaveAudio 등 소스 코드만으로는 확정 불가능한 부분이 있었음). 독립 설치 디스크 비용은 약 4.2GB(`.venv`+코드, 체크포인트는 하드링크라 중복 없음) — 자세한 설치 절차는 [[comfyui-setup]] 참고(`docs/comfyui-setup.md`).
**적용 시점:** `yue2-int8-convrot` 모델 관련 코드(`backend/comfyui.mjs`, `runComfyUi`)를 수정하거나, ComfyUI 연동이 필요한 새 모델을 추가할 때.

## `STEM_MODES`/`STEM_MODE_CONFIG`에 모드 추가 = 새 "분리" 기능을 거의 공짜로 얻는 패턴

**규칙:** 완성곡을 여러 파트로 나눠 각각 후처리(EQ/FX)한 뒤 합쳐 저장하는 기능(STEM 분리, 채널 분리)은 백엔드 `STEM_MODES`(`backend/server.mjs`)와 프론트 `STEM_MODE_CONFIG`(`app/app/studio.tsx`)에 새 모드 객체 하나만 추가하면 거의 전부 재사용된다 — `STEM_NAMES`가 `Object.values(STEM_MODES).flatMap(m => m.stems)`로 자동 유도되므로 `/api/projects/:id/stems/:name` 라우트는 무수정이고, 프론트 `StemDialog` 컴포넌트도 stem 이름을 하드코딩하지 않고 항상 `STEM_MODE_CONFIG[mode]`/`STEM_LABELS[name]`으로 조회하므로 다이얼로그 로직도 무수정이다(제목/로딩 문구만 `dialogTitle` 필드로 모드별 분기 필요). AI 분리 모델이 필요 없는 모드(예: "채널 분리" — `ffmpeg channelsplit`로 왼쪽/오른쪽만 나눔)는 `backend/server.mjs`의 `separateStems()`에서 `modeKey === 'channel'`(또는 `!mode.family`) 분기로 엔진/모델 체크 자체를 건너뛰면 된다.
**이유:** "음원 복원"(AudioSR) 작업 중 "L/R 채널을 STEM처럼 분리해서 후처리 다이얼로그로 넘기자"는 사용자 제안을 그대로 따라가 보니, 실제로 프론트 다이얼로그 코드를 한 줄도 안 고치고 설정 객체 확장 + 백엔드 분기 하나만으로 완전히 새로운 "채널 분리" 기능이 나왔다(2026-09-16). 이 제네릭 설계 덕분에 앞으로 다른 분리 방식(예: 주파수 대역별 분리 등)을 추가할 때도 같은 패턴을 우선 시도해볼 가치가 있음.
**적용 시점:** 완성곡을 "나눠서 각각 후처리 후 합치는" 새 기능을 요청받을 때, 새 다이얼로그를 처음부터 만들기 전에 이 패턴으로 될지 먼저 검토.

## `-Models`(audio.cpp `build_windows.ps1`)는 반드시 따옴표로 감쌀 것

**규칙:** `build_windows.ps1`의 `-Models` 파라미터는 `[string]$Models = ""`로 선언되어 있어 **하나의 문자열**을 받는다. `-Models yue2,htdemucs,bs_roformer`처럼 따옴표 없이 쓰면 PowerShell이 쉼표를 배열 연산자로 해석해 3-요소 배열을 만들고, 이를 `[string]`으로 바인딩하려다 `ParameterBindingArgumentTransformationException`("Cannot convert value to type System.String")이 난다. 항상 `-Models "yue2,htdemucs,bs_roformer,audiosr"`처럼 전체를 따옴표로 감쌀 것.
**이유:** 2026-09-16 audiosr 추가 재빌드 중 실제로 이 오류를 만남 — 기존 `docs/audiocpp-setup.md`의 예시 명령도 따옴표가 없었다(우연히 이전 빌드들이 어떻게 통과했는지는 불명; 최신 PowerShell/스크립트 버전에서 이 문제가 재현됨). 발견 즉시 문서의 모든 예시 명령을 따옴표 포함으로 수정함.
**적용 시점:** audio.cpp를 `-Models`로 재빌드할 때마다.

## audio.cpp의 AudioSR은 클릭/틱 잡음을 만든다 — 실험적 기능으로만 취급할 것

**규칙:** audio.cpp의 `audiosr`(`--task s2s --family audiosr`) 출력에는 전 대역(DC~24kHz)을 덮는 클릭/틱 잡음이 재현성 있게 섞여 나온다. 2026-09-16 실측으로 다음을 전부 배제했다 — 즉 SongYUE2가 추가한 어떤 코드의 문제도 아니다:
- **L/R 분리·재결합 자체**: null-test(위상 반전 후 합산)로 원본과 -91dB(사실상 완전히 동일) — 분리/합치기 로직은 깨끗함.
- **좌우 채널 디코릴레이션**: 스테레오 폭(L-R 에너지)이 AudioSR 전후 거의 동일(-32.3dB→-32.6dB) — 좌우를 따로 처리해서 위상이 어긋나는 것도 아님.
- **seed**: 42→123으로 바꿔도 클릭이 거의 같은 시간대에 재현(무작위 샘플링 실패가 아니라 deterministic).
- **청크 분할**: `audio_chunk_duration_sec`를 30초(통짜 처리)로 올려도 클릭이 그대로 남음(청크 경계 이음새 문제가 아님).
- 반대로 **콘텐츠를 바꾸면 클릭 빈도가 크게 달라짐**(어떤 20초 클립은 2개, 다른 클립은 훨씬 잦은 다발) — 콘텐츠에 따라 심하게 반응하는 구조적 결함으로 보임. `model_specs/audiosr.json`에 이미 `"status": "experimental"`로 표시되어 있던 것과 부합.
- **(최종 확인) `channelsplit`를 아예 거치지 않은 순수 모노 다운믹스**(`ffmpeg pan=mono`)를 AudioSR에 1회만 돌려도 동일하게 재현됨 — L/R 분리·재결합 코드와는 100% 무관함을 최종 확정.
**이유:** 사용자가 "음원 복원" 결과물에서 "쇠긁는 소리"를 보고해서 스펙트로그램(`ffmpeg showspectrumpic`)으로 원인을 추적한 결과. 근본 원인(STFT/hop, VAE 디코드 경계, 수치 안정성 등 audio.cpp C++ 구현 내부)은 아직 못 찾음 — `progress.md`의 "[할 일] AudioSR 복원 결과에 클릭/틱 잡음" 항목 참고.
**적용 시점:** "음원 복원" 기능을 수정하거나 audio.cpp AudioSR 관련 버그를 다시 조사할 때. 현재는 사이드바/페이지에 "(실험적)" 표시와 경고문만 달고 기능은 유지 중(사용자 결정) — 근본 원인 조사 전에는 audio.cpp AudioSR의 파라미터(seed/청크 크기/weight_type 등) 튜닝으로 해결하려 하지 말 것(이미 시도해서 안 됨을 확인함).

## MuScriptor(오디오→MIDI)는 AudioSR과 달리 안정적이고 매우 빠름 — 캐싱된 GET으로 충분

**규칙:** audio.cpp의 `muscriptor`(`--task midi --family muscriptor`)는 `model_specs/muscriptor.json`에 `"status": "supported"`(AudioSR의 `"experimental"`과 대비)로 표시되어 있고, 실측도 이를 뒷받침한다 — RTX 5070에서 RTF ≈ 0.024(실시간의 42배), 30초 클립 0.7초, 실제 라이브러리 곡(수십 초~수 분)도 5~6초 안에 완료. 이 정도로 빠르면 AudioSR/음원 복원이나 ComfyUI 생성처럼 `generating` 락+진행률 폴링 UI(`/api/generate/status`)를 붙일 필요가 없다 — SongYUE2는 `GET /api/projects/:id/midi` 하나로 구현했고(`exportMidi()`), 원본 오디오와 같은 폴더에 `<파일명>.mid`로 캐시(원본 mtime과 비교)해서 재다운로드는 즉시(약 0.08초) 응답한다. 프론트는 진행률 UI 없이 `<a href>` + `.click()` 다운로드 링크 패턴(`confirmDownload`와 동일)만으로 충분했다.
**이유:** 매번 새 기능을 추가할 때 "느릴 것"이라고 지레짐작해 무거운 락/폴링 UI부터 설계하지 않기 위해 — 실제 속도를 먼저 실측(Phase 0 CLI 테스트)한 뒤 UX를 결정하는 게 이 프로젝트의 관례임을 재확인.
**적용 시점:** audio.cpp의 새 task(패밀리)를 SongYUE2 기능으로 연결할 때, 무조건 무거운 진행률 UI를 만들지 말고 먼저 실제 RTF/처리 시간을 CLI로 측정해서 UX 복잡도를 결정할 것.

## MuScriptor의 `--text-out`과 노트 편집 UI는 "노트→MIDI" 인코더가 없다는 전제로 설계할 것

**규칙:** MuScriptor CLI는 `--out result.mid`(표준 MIDI)와 `--text-out result.json`(paired start/end 이벤트, `start_event_index`로 서로 참조)을 같은 실행에서 함께 뽑을 수 있지만, **"편집된 노트 목록 → 표준 MIDI 파일"로 되돌리는 인코더는 MuScriptor에도 audio.cpp 전체에도 없다.** SongYUE2는 `backend/midi.mjs`에 SMF(Standard MIDI File) 인코더를 직접 작성했다 — 포맷 0·단일 트랙, 템포 메타 이벤트, 악기 이름→General MIDI Program Change 매핑(모르는 악기는 피아노 폴백, 드럼류만 채널 9), 가변길이 델타타임 인코더. `parseNoteEvents()`가 start/end 쌍을 `{id, pitch, start, end, instrument}[]`로 평평하게 정리해 프론트에 넘긴다. `encodeMidiFile()`로 만든 파일은 Python `mido`로 라운드트립 검증 완료(타이밍·Program Change 정확함).
**이유:** "MIDI로 저장/수정 가능하게 해달라"는 요청이 들어오면 기존 MuScriptor 출력을 그대로 재사용할 수 있을 거라 가정하기 쉽지만, 실제로는 왕복(round-trip) 인코더를 새로 만들어야 한다는 점을 사전에 몰라서 계획 단계에서 놓칠 뻔했다.
**적용 시점:** MuScriptor/MIDI 관련 기능을 확장하거나 다른 오디오→심볼릭 변환 엔진(예: 향후 다른 전사 모델)을 추가할 때 — "이 도구가 내보내기도 하고 다시 읽어들이기도 하는가"를 먼저 확인할 것.

## SVG 피아노롤은 `EqBar`/`Knob`의 `setPointerCapture` 드래그 패턴을 2D로 확장해서 구현

**규칙:** `MidiEditorDialog`(음표 이동/리사이즈/삭제/추가)는 캔버스가 아니라 SVG로 렌더링했다 — 음표(`<rect>`)마다 개별 `onPointerDown`/`onPointerMove`/`onPointerUp`을 붙이기 쉽고, `event.currentTarget.setPointerCapture(event.pointerId)` 뒤 시작 좌표(clientX/clientY)와 시작 값(start/end/pitch)을 `dragRef`에 저장한 다음 델타로 새 값을 계산하는 기존 `EqBar`/`Knob` 패턴(`app/app/studio.tsx:356-399`, 1축)을 그대로 2축(시간=X, 피치=Y)으로 확장했다. 이 프로젝트의 기존 캔버스 시각화(파형/스펙트럼)는 전부 읽기 전용이라 인터랙션이 필요한 새 UI에는 SVG를 우선 고려할 것.
**이유:** 이미 검증된 드래그 상호작용 패턴을 재사용하면 포인터 캡처 관련 버그(드래그 중 다른 요소로 포인터가 빠져나가는 문제 등)를 처음부터 피할 수 있다.
**적용 시점:** 그래프/타임라인처럼 요소별 클릭·드래그가 필요한 새 UI를 만들 때.

## `library/music/`에 프로젝트 JSON 외의 다른 `.json` 파일을 두지 말 것 (또는 스캔에서 명시적으로 제외할 것)

**규칙:** `listEntries()`(`backend/server.mjs`)는 `settingDir()`/`musicDir()` 안의 `*.json` 파일을 전부 "프로젝트 파일"로 읽어들인다(`readJson` 후 무조건 `entries.push`). `library/music/`은 완성곡의 오디오 파일과 프로젝트 JSON이 같이 있는 폴더라서, 여기에 확장자가 `.json`으로 끝나는 다른 캐시 파일(예: MIDI 노트 캐시 `<곡 파일명>.notes.json`)을 아무 생각 없이 저장하면 그 파일도 "프로젝트"로 잘못 읽혀서 `project.title`/`project.id`가 `undefined`인 가짜 엔트리가 프로젝트 목록에 섞여 들어간다. 이 상태로 프론트가 `b.title.localeCompare(a.title)` 같은 정렬을 돌리면 `Cannot read properties of undefined (reading 'localeCompare')`로 즉시 크래시한다.
**이유:** 2026-09-16 "MIDI 편집기" 기능에서 `.mid`와 같은 폴더에 `<곡 파일명>.notes.json`(평평한 노트 배열, `{title}` 없음) 캐시를 추가했다가 실제로 재현·목격함(브라우저가 완전히 하얗게 깨짐). `listEntries()`의 `.json` 필터에 `&& !name.endsWith('.notes.json')`을 추가해 수정. 일반화하면: `library/music/`이나 `library/setting/`에 `.json` 파일을 새로 쓰는 기능을 추가할 때마다 매번 같은 함정에 빠질 수 있다.
**적용 시점:** `library/music/`(또는 `settingDir()`)에 새로운 캐시/부가 파일을 저장하는 기능을 만들 때 — 가능하면 `.json`이 아닌 확장자를 쓰거나, 반드시 `listEntries()`의 필터에서 명시적으로 제외할 것. 회귀를 잡는 가장 쉬운 방법은 `GET /api/projects` 응답의 모든 항목이 `title`을 갖는지 테스트로 확인하는 것(`backend/server.test.mjs`의 MIDI 테스트에 추가된 케이스 참고).

## 단일 트랙만 다루는 오디오→오디오 모델(음색 변환 등)은 STEM 분리로 감싸서 재사용할 것

**규칙:** Seed-VC(음색 변환), AudioSR(초해상도) 같은 audio.cpp 모델은 오디오 한 트랙 전체를 입력으로 받지만, 실제로 바꾸고 싶은 건 보컬 한 갈래뿐인 경우가 많다(반주까지 같이 모델에 넣으면 안 됨). 이럴 땐 이미 있는 `separateStems(entry, 'vocal')`(Mel-Band RoFormer STEM 분리)을 새 기능 함수 안에서 그대로 호출해 보컬/반주를 먼저 나누고, 모델은 보컬에만 적용한 뒤 ffmpeg `amix` 필터로 반주와 재합성하는 패턴을 쓴다(`convertVocalTimbre()`, `backend/server.mjs`). `stemsDir(entry.project.id)`를 이렇게 내부적으로 재사용할 때는 작업이 끝나면(성공/실패 무관) `finally`에서 반드시 정리(`rm(stemsDir(...), {recursive:true,force:true})`)할 것 — 안 그러면 사용자가 별도로 STEM 분리 다이얼로그를 연 적이 없는데도 그 곡의 `runs/<id>/stems/`에 파일이 계속 남는다.
**이유:** 2026-09-16 "보컬 음색 변환" 기능에서 이 패턴을 처음 썼다 — Seed-VC(`svc` 태스크)는 트랙 하나만 변환하는 모델이라 STEM 분리 없이는 반주까지 같이 변환되어 결과가 망가진다.
**적용 시점:** 오디오 전체가 아니라 특정 성분(보컬/특정 악기)에만 적용해야 하는 새 audio.cpp 기능을 추가할 때.

## RVC보다 Seed-VC를 우선 고려할 것 (audio.cpp의 두 음색 변환 패밀리)

> **대체됨 (2026-09-25)**: Seed-VC와 Vevo2는 결과가 좋지 않아 앱에서 제거했고, 곡 보컬 변환은 RVC(와 DDSP-SVC)로 바뀌었습니다. 아래 내용은 당시의 판단 기록입니다.

**규칙:** audio.cpp에는 보컬 음색 변환 모델이 둘 있다 — RVC(`model_specs/rvc.json`, `"status": "experimental"`, 패키지에 내장된 음색 4개(default/manthos/chocola/fraise) 중에서만 고르거나 사용자가 직접 `.pth` 체크포인트를 학습해 넣어야 함)와 Seed-VC(`model_specs/seed_vc.json`, `"status": "supported"`, 임의의 짧은 참조 오디오로 제로샷 변환이 가능한 `speaker_reference` capability + 노래 전용 `svc`(Singing Voice Conversion) 태스크가 따로 있음). SongYUE2의 "보컬 음색 변환"은 AudioSR/MuScriptor 때와 같은 기준(`status` 필드)으로 Seed-VC를 선택했다 — 사용자가 곡마다 원하는 목소리를 즉석에서 참조 오디오로 지정하는 유스케이스에 RVC의 "미리 학습된 음색 4개"보다 훨씬 잘 맞는다.
**이유:** 이름만 보면 RVC가 더 유명해서 먼저 시도하기 쉽지만, 실제 요구사항(사용자가 원하는 임의의 목소리로 바꾸기)에는 제로샷인 Seed-VC가 구조적으로 맞다. `"status": "experimental"`/`"supported"` 필드를 항상 먼저 확인하는 습관은 AudioSR 클릭 잡음 사고 이후 이 프로젝트의 고정 관례가 됨.
**적용 시점:** audio.cpp의 새 모델 패밀리를 추가할 때 같은 카테고리(`category` 필드)에 후보가 여럿이면 `model_specs/*.json`을 전부 비교해서 `status`와 실제 유스케이스 적합성으로 고를 것.

## HuggingFace Xet 스토리지 파일은 `urllib`로 멈출 수 있음 — `curl`로 우회

**규칙:** `scripts/download_models.py`의 `urllib.request` 기반 다운로드가 특정 파일(`SeedVC-MLX-GGUF/seed-vc-mlx-q8_0.gguf`, HuggingFace의 Xet 스토리지 백엔드로 서빙됨)에서 첫 4MB 청크만 받고 그대로 멈췄다(수 분간 0바이트/초, 소켓은 established 상태 유지). 같은 URL을 `curl -L`로 받으면 즉시 30~60MB/s로 정상 다운로드됐다 — 네트워크나 서버 문제가 아니라 Python `urllib` 쪽에서만 재현되는 문제(정확한 원인은 못 찾음, 프록시/청크 처리 관련 추정). **해결**: 막힌 프로세스를 죽이고 `curl -L --retry 5 -o <target-path> <url>`로 해당 파일 하나만 직접 받은 뒤, `python scripts/download_models.py`를 다시 실행하면 이미 크기가 맞는 파일을 sha256 검증만으로 "complete" 처리한다(재다운로드 없음, `download()`의 `target.stat().st_size == entry["size"]` 조기 반환 경로).
**이유:** 이런 정체를 "네트워크가 느리다"고 오판하고 그냥 무한정 기다리면 시간을 크게 낭비한다 — 진행이 없는 채로 몇 분이 지나면(`.part` 파일 크기가 안 늘어남) 네트워크 자체의 속도를 `curl`로 먼저 확인해보고, 빠르면 `urllib` 쪽 문제로 간주해 바로 우회할 것.
**적용 시점:** `scripts/download_models.py`로 새 모델을 받을 때 진행이 유독 안 되는 파일이 있으면 우선 `curl -sIL <url>`/직접 GET으로 그 파일만 따로 속도를 확인해볼 것.

## 음색/스타일 변환 계열 기능은 "생성 단계"가 아니라 "후처리"로 설계할 것 (YuE2는 참조 오디오 조건을 안 받음)

**규칙:** "RVC를 곡 만드는 단계에서 할 건가, 만든 이후 후처리로 할 건가"라는 질문이 나오면 답은 항상 후처리다 — YuE2 자체에 참조 오디오 기반 화자/음색 임베딩 입력이 없다("커버" 기능을 만들 때 이미 확인됨: Suno류와 달리 실제 보컬 음색/톤을 가져오는 입력 경로가 없음). 그래서 audio.cpp의 음색 변환류 모델(Seed-VC, RVC 등)은 전부 완성곡에 대한 후처리 파이프라인으로만 구현 가능하고, "생성 시 참조 음색을 같이 넣는" 방식은 YuE2 쪽 제약으로 애초에 선택지가 아니다.
**이유:** 2026-09-16 "보컬 음색 변환" 설계 논의에서 사용자가 이 질문을 했고, YuE2의 조건 입력 구조를 다시 설명할 필요가 있었다 — 매번 모델 카드/코드를 다시 뒤지지 않도록 결론만 기록.
**적용 시점:** 음색/화자/보컬 스타일을 바꾸는 새 기능을 제안하거나 설계할 때, "생성 단계 통합" 아이디어가 나오면 먼저 이 제약을 확인시킬 것.

## STEM 분리 다이얼로그(StemDialog)는 "여러 트랙을 각각 다듬어 저장" 패턴의 골격 — 하지만 "OO처럼 만들어줘"는 먼저 어디까지인지 확인할 것

**규칙:** `StemDialog`(`app/app/studio.tsx`)의 구조 — 스템 목록(waveform+개별 "후처리" 버튼, 중첩 `PostProcessDialog`) + 하단 combined-original/combined-preview 비교 재생 + "합치기"/"저장" — 은 "여러 오디오 트랙을 각각 다듬고 하나로 합쳐 결과를 확인한 뒤 저장한다"는 패턴이 필요한 기능에 재사용 가능한 골격이다. 다만 **"보컬 음색 변환"에서 사용자가 "STEM1과 같은 UI로 만들어줘"라고 했을 때 이 골격 전체(스템 분리 표시+개별 후처리+합치기)를 통째로 가져다 구현했다가, 배포 직후 사용자가 "약간 다르게 이해했네"라며 실제로는 훨씬 단순한 것(참조 파일 선택+적용 버튼+원본/결과 비교 재생만)을 원했다고 정정했다** — 사용자가 "STEM1처럼"이라고 말한 진짜 의도는 스템 골격 전체가 아니라 "원본과 결과를 나란히 두고 비교해서 들을 수 있게" 정도의 좁은 의미였다. 결국 스템 목록/개별 후처리/클라이언트 믹싱을 전부 걷어내고, 상단 바(파일 선택+적용)+"원본"(기존 오디오 그대로 재사용)/"변경본"(서버가 완성해서 캐싱한 결과) 비교만 남기는 두 번째 재설계를 했다. STEM1의 "저장"은 `POST /post-process`로 다운로드만 하고 라이브러리엔 안 남는다는 점도 주의 — 라이브러리에 남아야 하는 새 기능은 반드시 별도 백엔드 라우트(`finalizeToMusic()` 경유)를 만들 것.
**이유:** "OO 화면처럼 만들어줘"라는 요청은 그 화면의 어느 부분(전체 골격? 특정 상호작용 패턴만? 시각적 스타일만?)을 가리키는지 여러 갈래로 해석될 수 있다. 이번엔 먼저 구현하고 사용자의 구체적인 레이아웃 설명("왼쪽에 있던 걸 상단으로, 후처리는 빼고, 위에 파일탐색기+적용, 아래는 비교 듣기")으로 교정받았는데, 처음부터 그 정도로 구체적인 레이아웃을 한 번 더 확인했다면 큰 재작업을 피할 수 있었을 것.
**적용 시점:** 사용자가 기존 UI를 참고점으로 들며 "OO처럼 만들어줘"라고 할 때, 특히 그 UI가 여러 하위 기능(스템 분리+개별 편집+합치기처럼)을 포함하는 복합 컴포넌트라면, 구현 전에 "그 중 정확히 어떤 부분(레이아웃/상호작용/특정 기능)을 가져오고 싶은지" 한 번 더 짚어서 확인할 것 — 특히 예상 작업량이 크면(여러 상태/refs/nested dialog를 새로 쓰는 수준) 되돌리기 비용이 크므로 더욱 그렇다.

## 오디오 모델 출력의 음량을 보정할 땐 게인만으로 끝내지 말고 피크(헤드룸)도 항상 같이 볼 것

**규칙:** Seed-VC 같은 오디오→오디오 모델의 출력이 입력보다 평균 음량이 낮게 나올 수 있다(실측: Seed-VC 변환 보컬이 원본보다 7.6dB 조용함, `ffmpeg -af volumedetect`의 `mean_volume`으로 확인). 이걸 단순히 `ffmpeg -af volume=XdB`로 평균 음량만 맞추면, 모델 출력이 이미 피크 쪽으로는 여유가 별로 없는 경우(실측: 원본 변환 보컬의 `max_volume`이 -2.2dB) 게인을 곱하는 순간 풀스케일을 넘어 하드클리핑한다(실측: 보정 후 `max_volume`이 정확히 0.0dB로 천장에 닿음 = 클리핑 신호). **해결**: 게인 필터 뒤에 `alimiter=limit=0.97:level=false`를 붙여서 피크만 부드럽게 눌러준다 — `level=false`(자동 레벨 보정 끄기)가 핵심인데, 안 끄면 alimiter가 평균 음량을 다시 원본 수준으로 되돌려버려서 방금 올린 게인을 무의미하게 만든다(`level=true`가 기본값이라 반드시 명시적으로 꺼야 함).
**이유:** 2026-09-16 "보컬 음색 변환" 무음 버그(사용자 제보: "보컬이 아예 없어지고 악기만 남았어") 수정 중 발견 — 게인만 넣은 1차 수정은 평균 음량은 맞았지만(`mean_volume` 원본과 거의 일치) `max_volume`이 0.0dB로 클리핑돼서 "보컬은 들리지만 찌그러짐"이라는 새 문제를 만들 뻔했다. 한 번 실제 오디오로 전/후 `volumedetect` 수치를 직접 비교해보지 않았다면 이 클리핑을 놓쳤을 것.
**적용 시점:** 오디오 모델(변환/복원/합성 등) 출력의 음량이 기대보다 작아서 게인 보정을 추가할 때는 반드시 보정 전/후로 `mean_volume`과 `max_volume`(또는 `astats`의 Peak level)을 둘 다 실측 비교할 것 — 평균만 맞추고 끝내면 안 됨.

## "이전 구조로 되돌려줘"는 재설계 이력을 존중하되, 같은 메시지 안의 다른 요청(버그 제보 등)과 뒤섞이지 않게 분리해서 처리할 것

**규칙:** 사용자가 이전에 승인했던 설계를 스스로 되돌려달라고 요청할 때("이전구조로 원복하는게 좋겠어. 미안해") — 이번 경우처럼 중간 설계(STEM1 스타일 → "원본 vs 결과" 단순화)가 실제로는 도메인 제약(RVC/Seed-VC는 항상 분리→변환→재합성 구조)과 어긋났다는 걸 사용자가 뒤늦게 이해하고 정정한 것이면, 되돌리는 작업 자체는 이전 버전의 코드를 그대로 복원하면 되므로 빠르다. 하지만 **같은 메시지에 완전히 다른 종류의 요청(실제 버그 제보)이 같이 왔을 때 이 둘을 하나로 뭉쳐서 처리하면 안 된다** — "구조를 되돌리는 것"과 "무음 버그를 고치는 것"은 독립적인 작업이고, 되돌리는 김에 버그도 조용히 같이 고치면 사용자가 각각이 왜/어떻게 해결됐는지 추적하기 어려워진다. 이번엔 되돌리기(백엔드+프론트+CSS+테스트 복원)와 버그 원인 진단(`volumedetect` 실측)+수정(게인+리미터)을 순서대로 분리해서 처리하고, 각각을 별도로 설명·검증했다.
**이유:** 재설계를 세 번째 하게 된 상황이라 자칫 "일단 빨리 되돌리고 넘어가자"는 유혹이 생기기 쉬운데, 같이 온 버그 제보를 대충 묻어버리면 사용자가 정말 원했던 것(들리는 보컬)을 놓칠 위험이 크다.
**적용 시점:** 사용자 메시지에 "되돌려줘/원복해줘" 같은 요청과 별개의 문제 제보가 함께 오면, 되돌리기를 먼저 완료해 기준선을 확보한 뒤 문제 진단을 별도 단계로 진행할 것 — 특히 문제가 "실제로 들어보니 이상하다"처럼 실측이 필요한 종류면 더더욱 분리해서 각각 검증 가능하게 만들 것.

## 음악 생성은 한 번에 하나만

**규칙:** `/api/generate`는 서버 프로세스 내 불리언 플래그(`generating`)로 동시 실행을 막고, 이미 실행 중이면 409를 반환한다.
**이유:** GPU(VRAM) 하나를 공유하는 로컬 단일 사용자 앱이므로 동시 생성은 의미가 없고 리소스 경합만 일으킴. 단, 이 플래그는 가벼운 프로젝트 CRUD(즐겨찾기, 메모 저장 등)에 쓰이는 `serial()` 뮤텍스와는 별개 — 무거운 생성 작업이 가벼운 조작들을 막지 않도록 분리했다.
**적용 시점:** 생성 관련 엔드포인트를 추가/수정할 때.

## G-01(코드 주석 영어)·G-02(UI 텍스트 한국어)는 새 코드에서도 계속 지켜질 것 — 감사에서 위반이 자꾸 나온다

**규칙:** 2026-09-20 코드 감사에서 신규 코드에 한글 주석이 다수 재발했다(`app/app/studio.tsx` ~16건, `backend/server.mjs` ~10건). 대화/음색 변조/오디오 도구 구현물에서 전부 영어 주석 규칙을 위반. **CSS placeholder/기본값 경계 케이스**도 있음: `AudioToolsPage` 필드의 placeholder이 영어 문장이자 입력 기본값으로 노출돼('Warm, clear voice' 등) 사용자에게 영어 문장이 보임 — 라벨은 한국어지만 placeholder/기본 시드 텍스트도 G-02 대상이다.
**이유:** 댓글로 동작 설명을 남기는 습관 자체는 좋지만(제거보다 번역을 권장), 위반이 세션마다 반복되므로 새 다이얼로그/라이브러리를 커밋하기 전에 자기 코드를 grep(`\/\/.*[가-힣]`, `/\/\*.*[가-힣]/`)해보는 단계를 추가할 것. placeholder가 "입력값"으로 쓰이는 `Textarea`/`Input`에는 그 값까지 사용자에게 보이는 UI 텍스트라는 점을 기억할 것.

## AuK 노래 음색 변환 기본 프롬프트

- 음색 변조의 텍스트 전용 AuK 경로는 `Keep the lyrics, melody, phrasing and rhythm unchanged and change the timbre to: "${textDescription}".` 형식을 사용한다.
- 기본 목표 음색 설명은 `a deep adult male with a warm, resonant baritone voice`이다.
- 이 프롬프트는 남성 음색을 유지하지만 가창 품질을 크게 개선하지는 않는다.

## Wave 49 (2026-09-24)

- 한국어를 지원하지 않는 모델은 카탈로그에 넣지 않고, 받아 둔 파일은 삭제한다(사용자 결정). 품질이 나쁘다고 판단된 모델(CosyVoice3)도 제거.
- 포트는 `C:\Claude\PORTS.md`에서만 배정(SongYUE2 = 5176/4311).
- 테스트의 fake spawn이 실제 파일을 덮어쓰지 않게 한다(`--out` 없는 호출은 아무것도 쓰지 않도록 유지). 테스트가 실제 프로세스 기동 경로를 타면 안 된다.
- 응답 전송 전에 `generating` 락을 풀어야 한다.

## 사용자 데이터 보호 (2026-09-24, 사고 기록)

- `models/`(특히 사용자가 앱에서 받은 `models/rvc-voices/`, `models/audio-cpp/`), `library/`, `runs/`, `Setting/`은 **사용자 데이터다. 시험·정리 명목으로 `rm -rf`로 지우지 않는다.** 시험은 임시 폴더(예: `%TEMP%`)에서만 하고, 지울 때는 방금 만든 파일의 정확한 경로만 지운다.
- 사고: RVC 다운로드 기능을 시험하고 `rm -rf models/rvc-voices`로 정리하다가 사용자가 받아 둔 BTS 목소리까지 삭제함(복구 불가). 앱은 폴더를 스캔하므로 표시는 파일이 있으면 유지된다.

## Wave 50: LoRA 필터 (2026-09-25)

- Installed의 분류·언어 버튼은 허깅페이스와 같은 배열을 사용한다. 설치된 LoRA에서 옵션을 추리지 않는다. 탭별 선택은 독립 유지.
- 월드/민속·중국어 버튼은 제외하고 분류·언어·정렬을 한 줄에 배치한다. 좁은 화면에서는 줄바꿈. 중국어 등 별도 버튼 없는 언어는 기타에 포함.
- 설치 메타데이터의 빈 언어/장르는 불러온 원본 repo로 보완하되 로컬 파일·설정·stage는 변경하지 않는다.
- 곡 표지는 항상 정사각형이다: 자동 생성 표지는 처음부터 1:1, 직접 올린 그림은 가운데 기준으로 자르고 2475px 초과는 줄이며 1400px 미만은 늘리지 않고 안내만 한다(Pixabay 사진만 1400px로 확대). 표지 프롬프트에는 한글과 제목·가사를 넣지 않는다.
- VST3 플러그인은 반드시 별도 프로세스(vst-host)로 돌리고 시간 제한과 강제 종료를 둔다. 검색된 플러그인 경로만 호스트에 넘긴다. 삭제는 `engine/vst-host/plugins/` 안의 항목만.
- `engine/`은 git에 올라가지 않으므로 새 PC용 준비 방법은 docs에 적는다(vst-host.exe, 표지 모델, LoRA 학습기).
