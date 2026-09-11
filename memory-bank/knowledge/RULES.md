# Rules

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
**이유:** 프론트엔드(5173)와 백엔드(4311)가 다른 포트라 브라우저가 크로스오리진 프리플라이트를 보내는데, 목록에 없는 메서드는 CORS로 막혀 실제 라우트가 있어도 요청 자체가 도달하지 못한다.
**적용 시점:** 새 라우트/메서드를 추가할 때마다.

## 로컬 실행 파일/스크립트 경로 설정도 라이브러리 폴더처럼 SongYUE2 루트 기준 상대경로로 취급

**규칙:** `settings.enginePath`/`pythonEnginePath`/`pythonScriptPath`는 저장된 값을 `path.resolve(root, value)`로 해석한다(절대경로를 넣으면 `path.resolve`가 root를 무시하고 그대로 반환하므로 하위호환됨). `enginePath`만 프로젝트 표준 빌드 위치(`engine\audio.cpp\build\windows-cuda-release\bin\audiocpp_cli.exe`)를 기본값으로 갖고, 값이 비어 있으면 그 기본 상대경로를 사용한다(`resolveConfigPath`). Python 경로는 보편적 기본값이 없으므로 비어 있으면 그대로 빈 문자열 유지 → "설정에서 경로를 확인해 주세요" 에러(`resolveOptionalConfigPath`). `outputDirectory`(로그 폴더, 읽기전용)는 내부적으로는 절대경로를 계속 쓰되 `publicSettings()`가 `path.relative(root, outputDirectory)`로 변환해 사용자에게는 상대경로("runs")로만 보여준다.
**이유:** `settingPath`/`musicPath`/`examplesPath`와 일관된 멘탈 모델을 유지하고, 프로젝트 폴더를 통째로 옮기거나 다른 PC로 복사해도 설정이 깨지지 않게 하기 위함.
**적용 시점:** 로컬 실행 파일/스크립트/폴더 경로를 다루는 설정 필드를 추가하거나 수정할 때.

## HTML5 `<audio>`는 진짜 역재생(파형 반전)을 지원하지 않는다

**규칙:** "역재생" 기능이 필요하면 `audio.playbackRate`를 음수로 주지 말 것(브라우저별 동작이 일관되지 않고 대부분 무시/무음 처리됨). 이 프로젝트에서는 `setInterval`로 `currentTime`을 짧은 간격(100ms)마다 조금씩(0.15s) 되감는 "스크럽 근사"로 구현했다(재생을 멈추고 반복적으로 되감기만 함, 실제 반전된 파형이 들리는 게 아님).
**이유:** W3C HTMLMediaElement 스펙과 실제 브라우저 구현 모두 순방향 디코딩 파이프라인만 보장한다. 진짜 역재생 오디오가 필요하면 Web Audio API로 버퍼 전체를 디코드한 뒤 `Float32Array`를 직접 뒤집어 재생하는 방식으로 가야 하며, 이는 스트리밍이 아닌 전체 파일 사전 로드가 필요해 구현 비용이 훨씬 크다.
**적용 시점:** 오디오 플레이어에 "역재생"/"스크래치" 같은 기능을 요청받을 때, 구현 전에 이 제약을 먼저 사용자에게 알릴 것.

## 음악 생성은 한 번에 하나만

**규칙:** `/api/generate`는 서버 프로세스 내 불리언 플래그(`generating`)로 동시 실행을 막고, 이미 실행 중이면 409를 반환한다.
**이유:** GPU(VRAM) 하나를 공유하는 로컬 단일 사용자 앱이므로 동시 생성은 의미가 없고 리소스 경합만 일으킴. 단, 이 플래그는 가벼운 프로젝트 CRUD(즐겨찾기, 메모 저장 등)에 쓰이는 `serial()` 뮤텍스와는 별개 — 무거운 생성 작업이 가벼운 조작들을 막지 않도록 분리했다.
**적용 시점:** 생성 관련 엔드포인트를 추가/수정할 때.
