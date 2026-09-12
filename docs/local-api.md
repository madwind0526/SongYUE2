# 로컬 API

`node backend/server.mjs`로 실행합니다. Node.js 24 내장 모듈만 사용하며 `127.0.0.1:4311`에서만 연결을 받습니다. 프론트엔드는 `/api`를 이 주소로 프록시합니다. 허용된 브라우저 주소는 localhost/127.0.0.1의 5173과 서버 포트입니다.

## .env 설정

LLM 제공업체의 API 키, 연결 주소, 모델 이름은 **`.env` 파일**에서 읽습니다. 프로젝트 루트의 `.env.sample`을 복사해 `.env`로 저장한 뒤 값을 입력하세요. `.env`는 git에 커밋되지 않습니다(`.gitignore`). 값을 바꾼 뒤에는 서버를 다시 실행해야 반영됩니다(`process.loadEnvFile`로 시작 시 한 번만 읽음). `.env`가 없어도 서버는 정상 시작하며, 이 경우 LLM 제공업체는 `none`으로 동작합니다.

| 변수 | 용도 |
|---|---|
| `LLM_PROVIDER` | 기본 제공업체: none/ollama/claude/chatgpt/gemini |
| `OLLAMA_ENDPOINT` / `OLLAMA_MODEL` | Ollama 주소(localhost만 허용)와 모델 이름 |
| `CLAUDE_API_KEY` / `CLAUDE_MODEL` | Anthropic API 키와 모델 이름 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI API 키와 모델 이름 |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Google AI API 키와 모델 이름 |
| `ENGINE_PATH` | 음악 생성 엔진(audio.cpp) 실행 파일 경로 (선택, 설정 화면에서도 지정 가능) |
| `PYTHON_ENGINE_PATH` | 공식 Python YuE2("원본" 모델) 실행 파일 경로. 원본 모델 생성, ABC 계획, 악보 검사에 사용 |
| `SETTING_PATH` / `MUSIC_PATH` / `EXAMPLES_PATH` | 라이브러리 폴더(SongYUE2 루트 기준 **상대 경로**). 비우면 각각 `library/setting`/`library/music`/`library/examples` 사용. 설정 화면에도 placeholder로 기본값이 보임 |
| `SAVE_FORMAT` | 완성곡을 `MUSIC_PATH`에 저장할 파일 형식: wav/flac/mp3/mp4 (기본 wav) |

## 라이브러리 폴더 구조

프로젝트는 상태에 따라 서로 다른 폴더에, **곡 제목을 파일명으로** 저장됩니다(UUID는 내부 `id` 필드로만 남고 파일명에는 쓰이지 않음). 제목은 Windows 금지 문자 제거 후 사용되며, 같은 제목이 이미 있으면 `제목 (1).json`처럼 번호가 붙습니다.

| 폴더(기본값) | 내용 | 대응 화면 |
|---|---|---|
| `library/setting/` | 아직 생성하지 않은 초안(가사·스타일·모델 설정) JSON | 프로젝트 |
| `library/music/` | 생성 완료된 곡 — JSON + 오디오 파일(`SAVE_FORMAT` 확장자) | 내 라이브러리 |
| `library/examples/` | "예시 둘러보기"에 쓰이는 예시 목록. 최초 실행 시 기본 3개 자동 생성 | 만들기 화면 하단/팝업 |

초안을 생성하면(`POST /api/generate` 성공) 해당 JSON과 오디오가 `library/setting/`에서 `library/music/`으로 **이동**합니다(복사 후 보관하는 방식이 아님). 제목을 바꾸면(PATCH) 파일명과 오디오 파일명도 함께 바뀝니다. 삭제하면 JSON과 오디오가 함께 지워집니다.

## 데이터 및 응답

- 설정: `data/settings.json`에는 `provider`/`enginePath`/`pythonEnginePath`/`settingPath`/`musicPath`/`examplesPath`/`saveFormat`만 저장합니다. API 키/연결 주소/모델 이름은 저장하지 않고 매 요청마다 `.env`(`process.env`)에서 읽습니다.
- 로그 폴더: `runs/<projectId>/generate.log`(엔진 stdout/stderr, 최대 512KB)는 라이브러리 폴더와 별개로 항상 프로젝트 루트의 `runs/`에 고정됩니다. 생성 중 임시로 쓰이는 wav도 여기서 만들어졌다가 성공 시 `library/music/`으로 옮겨집니다.
- 모델 다운로드 상태: 루트 `model-download-status.json`을 읽고, 사용자가 직접 둔 로컬 safetensors(`comfy-org/YuE2`, `m-a-p/SheetSage2`)도 함께 표시합니다. 실제 설치 여부와 실행 엔진 연결 여부는 별개입니다.
- 오류: `{ "error": "한국어 안내" }`, HTTP 400/403/404/409/413/415/500/502.
- API 키는 응답에 평문으로 포함되지 않습니다. `GET`/`PUT /api/settings`는 키가 설정되어 있으면 `apiKey: "***"`, 없으면 `null`을 반환합니다(`hasApiKey`로도 확인 가능). 실제 키 값은 파일, 브라우저 응답, 로그 어디에도 저장·노출되지 않습니다. `apiKeyStorage: "env"`로 안내합니다.
- 클라우드 제공업체 주소는 공식 API로 고정합니다. Ollama 주소는 localhost만 허용합니다. LLM 요청은 사용자가 연결 확인이나 가사/스타일 보조 버튼을 누른 경우에만 실행합니다. 연결 확인도 실제 짧은 API 요청입니다.

| 메서드 / 주소 | 요청 / 응답 |
|---|---|
| GET `/api/health` | `{ok:true,engineReady,mode:'local',version:'0.1.0'}` — engineReady는 `enginePath`가 설정되어 있고 실제 파일이 존재하는지를 확인한 값 |
| GET `/api/settings` | `{provider,endpoint,llmModel,hasApiKey,apiKey,apiKeyStorage,enginePath,pythonEnginePath,settingPath,musicPath,examplesPath,saveFormat,outputDirectory}` — endpoint/llmModel/apiKey는 `.env`에서 읽은 값(읽기 전용) |
| PUT `/api/settings` | `{provider?,enginePath?,pythonEnginePath?,settingPath?,musicPath?,examplesPath?,saveFormat?}`만 반영합니다. provider: none/ollama/claude/chatgpt/gemini. saveFormat: wav/flac/mp3/mp4. 경로를 바꾸면 그 폴더를 즉시 만듭니다(기존 파일은 옮기지 않음). endpoint/llmModel/apiKey는 더 이상 이 API로 바꿀 수 없으며(`.env`를 수정), 요청에 포함돼도 무시됩니다 |
| GET `/api/models` | 다운로드 상태 원본 + `engineReady` (health와 동일 기준) |
| GET `/api/examples` | 예시 배열(`id,title,genre?,caption?,color?,style,lyrics,createdAt`) |
| POST `/api/examples` | `{title,style,lyrics,genre?,caption?}` → 201 저장된 예시 |
| DELETE `/api/examples/:id` | 예시 삭제 → `{ok:true,id}` |
| GET `/api/projects` | `library/setting`+`library/music`를 합쳐 최신 생성순으로 반환 |
| POST `/api/projects` | `{title,lyrics,style,modelId,seed,steps,cot,mode}` → 201 저장된 draft(`library/setting/{제목}.json`) |
| GET `/api/projects/:id` | 저장된 프로젝트 |
| PATCH `/api/projects/:id` | `{title?,notes?,favorite?}` → 수정된 프로젝트. 제목이 바뀌면 파일명(및 완성곡이면 오디오 파일명)도 함께 바뀜 |
| DELETE `/api/projects/:id` | 프로젝트 JSON과(완성곡이면) 오디오, `runs/<id>/`를 삭제 → `{ok:true,id}`. 없는 프로젝트는 404 |
| GET `/api/projects/:id/export` | 프로젝트 JSON 다운로드 |
| GET `/api/llm/models` | Ollama 설치 모델 `{models:[{name,size}]}` |
| POST `/api/llm/test` | `{}` → `{ok:true,text,provider,model}` |
| POST `/api/llm/assist` | `{task:'lyrics'|'style',prompt,lyrics,style}` → `{text,provider,model}` |
| POST `/api/generate` | `{projectId}` → 선택 모델에 따라 audio.cpp GGUF 또는 공식 Python YuE2 엔진을 실행해 음악을 생성하고, 성공하면 `library/music`에 새 완성곡으로 저장합니다. 200과 갱신된 프로젝트(`status:'completed'`, `audioPath`, `durationMs`, `rtf`, `saveError?`) 반환. 모델·가사·스타일·시드·스텝·cot은 저장된 프로젝트 값을 그대로 사용합니다. 400: 엔진 경로 미설정/모델 미지원/모델 파일 누락/가사·스타일 없음. 409: 이미 다른 곡을 생성 중. 502: 엔진 실행 실패, 제한 시간(10분) 초과, 종료 코드 비정상 — `runs/<id>/generate.log`에서 로그 확인 가능 |
| GET `/api/projects/:id/audio` | 완성된 오디오를 실제 확장자에 맞는 Content-Type(wav/flac/mp3/mp4)으로 스트리밍. 아직 생성되지 않았거나 파일이 없으면 404 |

## 음악 생성 엔진 (audio.cpp)

`enginePath`가 가리키는 `audiocpp_cli.exe`를 `--family yue2 --task gen`으로 실행합니다. 모델 폴더는 항상 `models/audio-cpp/Yue2-3B-GGUF`(프로젝트 루트 기준) 고정이며, 프론트엔드의 모델 선택(`modelId`)에 따라 본체/VAE 조합이 정해집니다.

| modelId | 본체 GGUF | VAE GGUF |
|---|---|---|
| `yue2-q4` | `yue2-3b-q4_0.gguf` | `yue2-vae-f16.gguf` |
| `yue2-q8` | `yue2-3b-q8_0.gguf` | `yue2-vae-f16.gguf` |
| `yue2-bf16` | `yue2-3b-bf16.gguf` | `yue2-vae-f32.gguf` |
| `yue2-original` | audio.cpp 미사용. 공식 Python 파이프라인으로 실행 |
| `yue2-int8-convrot` | ComfyUI 형식 safetensors. 현재 직접 생성 미지원, ComfyUI 어댑터 필요 |

audio.cpp 자체의 설치/빌드 방법은 [audiocpp-setup.md](audiocpp-setup.md)를 참고하세요. 한 번에 한 곡만 생성합니다(서버 내부 플래그로 동시 실행 차단, GPU 하나를 공유하기 때문). `wav`가 아닌 형식을 선택했는데 `ffmpeg`가 PATH에 없으면 변환이 실패해도 생성 자체는 성공 처리하고 `wav`로 대신 저장하며, `saveError`에 이유를 남깁니다.

## SheetSage2

`POST /api/cover-transcribe`는 설정의 `sheetSagePythonPath`로 별도 Python 환경을 실행합니다. `models/m-a-p/SheetSage2/config.json`과 `models/m-a-p/SheetSage2/model.safetensors`가 있으면 `--model models/m-a-p/SheetSage2 --offline`으로 로컬 모델을 사용합니다. 가중치 파일만 있으면 준비가 끝난 것이 아니며, Hugging Face 스냅샷의 Python 코드와 설정 파일이 같은 폴더에 있어야 합니다.

## 검증

`node --test backend/server.test.mjs`

임시 디렉터리에 `.env`를 만들어 저장/재시작 복원(재시작 후에도 `.env` 기반 API 키는 유지됨), 즐겨찾기/내보내기, 외부 Origin/Host 차단, JSON 크기 제한, API 키 마스킹(`***`)과 비노출, `.env`가 없을 때의 기본값, 잘못된 `OLLAMA_ENDPOINT`가 사용 시점에 거부되는 것, 네 제공업체의 요청/응답 형태를 검증합니다. LLM 테스트는 가짜 HTTP 응답을 주입하며 실제 API 키나 과금 요청을 사용하지 않습니다. 실제 제공업체 연결은 사용자가 `.env`에 키를 넣고 설정 화면에서 확인해야 합니다.

`/api/generate`와 `/api/projects/:id/audio`는 주입된 가짜 `spawnImpl`(자식 프로세스를 실제로 실행하지 않음)로 성공/실패/시간 초과/동시 생성 차단 경로를 검증합니다. 실제 `audiocpp_cli.exe` 실행은 이 테스트에 포함되지 않으며, 실기 검증은 2026-09-12에 RTX 5070에서 수동으로 완료했습니다(Q4_0+F16 VAE, RTF 0.395~0.46).

## 공식 API 근거

- [Ollama Chat](https://docs.ollama.com/api/chat): `/api/chat`, stream:false.
- [Claude 시작하기](https://platform.claude.com/docs/en/get-started): Messages API와 API 키/버전 헤더.
- [OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create): input과 output 텍스트, store:false.
- [Gemini generateContent](https://ai.google.dev/api/generate-content): contents/parts와 candidates 응답.

사용 가능한 모델 이름은 계정마다 달라 직접 입력합니다. ChatGPT 항목은 OpenAI API를 뜻하며 웹 구독 로그인 기능이 아닙니다.
