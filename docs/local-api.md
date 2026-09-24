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

### `Setting/` 폴더 (앱 레벨 설정, `library/`와 별개)

`library/setting/`은 `listEntries()`가 그 안의 모든 `*.json`을 프로젝트 초안으로 스캔하는 폴더라서, EQ 프리셋이나 전체 후처리 설정처럼 곡과 무관한 JSON을 함께 두면 프로젝트 목록이 오염됩니다. 그래서 이 둘은 `library/`가 아닌 프로젝트 루트의 별도 `Setting/` 폴더에 저장됩니다(사용자가 위치를 바꿀 수 없는 고정 경로):

| 폴더 | 내용 | 저장 형식 |
|---|---|---|
| `Setting/EQ-preset/` | 사용자가 저장한 10밴드 EQ 프리셋 | `<프리셋 이름>.json` = `{name, eq:[10개 숫자]}` |
| `Setting/PostProcess/` | 사용자가 저장한 전체 후처리 설정(EQ+FxSound+리버브/에코) | `<프리셋 이름>.json` = `{name, params:{...}}` |

두 폴더 모두 다른 PC로 옮기려면 폴더째 복사해야 하며, 동기화 기능은 없습니다.

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
| GET `/api/playlists` | 재생목록 배열(`id,name,songIds[],createdAt,updatedAt`), 생성순 정렬 |
| POST `/api/playlists` | `{name}` → 201 저장된 빈 재생목록(`songIds:[]`) |
| PATCH `/api/playlists/:id` | `{name?,songIds?}` → 수정된 재생목록. `songIds`는 문자열 배열만 허용(최대 500개), 이름을 바꾸면 파일명도 함께 바뀜 |
| DELETE `/api/playlists/:id` | 재생목록 삭제 → `{ok:true,id}` |
| GET `/api/projects` | `library/setting`+`library/music`를 합쳐 최신 생성순으로 반환 |
| POST `/api/projects` | `{title,lyrics,style,modelId,seed,steps,cot,vocalGender?,instrumental?,abc?,mode}` → 201 저장된 draft(`library/setting/{제목}.json`) |
| GET `/api/projects/:id` | 저장된 프로젝트 |
| PATCH `/api/projects/:id` | `{title?,notes?,favorite?}` → 수정된 프로젝트. 제목이 바뀌면 파일명(및 완성곡이면 오디오 파일명)도 함께 바뀜 |
| DELETE `/api/projects/:id` | 프로젝트 JSON과(완성곡이면) 오디오, `runs/<id>/`를 삭제 → `{ok:true,id}`. 없는 프로젝트는 404 |
| GET `/api/projects/:id/export` | 프로젝트 JSON 다운로드 |
| POST `/api/projects/:id/cover` | `{dataUrl}`(PNG/JPEG/WEBP, base64, 최대 20MB) → 저장된 프로젝트(커버 경로 포함). 기존 커버는 교체 전 삭제 |
| DELETE `/api/projects/:id/cover` | 커버 이미지 삭제 → `{ok:true}` |
| GET `/api/projects/:id/cover` | 커버 이미지 바이트 스트리밍. 없으면 404 |
| GET `/api/llm/models` | Ollama 설치 모델 `{models:[{name,size}]}` |
| POST `/api/llm/test` | `{}` → `{ok:true,text,provider,model}` |
| POST `/api/llm/assist` | `{task:'lyrics'|'style',prompt,lyrics,style}` → `{text,provider,model}` |
| POST `/api/llm/abc-edit` | `{instruction,abc}` → `{abc,provider,model}`. LLM에게 ABC notation을 지시사항대로 수정하게 하고, 코드펜스를 벗겨낸 결과 전체를 반환(설명 텍스트 없음). 지시사항이 비어있으면 400 |
| POST `/api/generate` | `{projectId}` → 선택 모델에 따라 audio.cpp GGUF 또는 공식 Python YuE2 엔진을 실행해 음악을 생성하고, 성공하면 `library/music`에 새 완성곡으로 저장합니다. 200과 갱신된 프로젝트(`status:'completed'`, `audioPath`, `durationMs`, `rtf`, `saveError?`) 반환. 모델·가사·스타일·시드·스텝·cot·instrumental·abc는 저장된 프로젝트 값을 그대로 사용합니다. 400: 엔진 경로 미설정/모델 미지원/모델 파일 누락/가사·스타일 없음/**GGUF 모델에 비어있지 않은 `abc`가 있는 경우**(`runAudioCpp`는 `--abc-file`을 지원하지 않아 조용히 무시되므로 사전 차단). 409: 이미 다른 곡을 생성 중. 502: 엔진 실행 실패, 제한 시간(10분) 초과, 종료 코드 비정상 — `runs/<id>/generate.log`에서 로그 확인 가능 |
| GET `/api/generate/status` | 생성 진행 상황 폴링용. `{active:false,elapsedMs:0,expectedMs:0}` 또는 `{active:true,projectId,elapsedMs,expectedMs}` |
| GET `/api/projects/:id/audio` | 완성된 오디오를 실제 확장자에 맞는 Content-Type(wav/flac/mp3/mp4)으로 스트리밍. 아직 생성되지 않았거나 파일이 없으면 404 |
| POST `/api/projects/:id/post-process` | `{dataUrl}`(`audio/wav`, base64, 최대 150MB) → 브라우저에서 Web Audio로 EQ/FX/리버브·에코 처리된 오디오를 원본과 같은 파일 형식(mp4는 원본 비디오+새 오디오 트랙 합성)으로 재인코딩해 바이너리로 응답(다운로드). 원본 프로젝트 파일 자체는 바뀌지 않음. `ffmpeg`가 없거나 실패하면 502 |
| POST `/api/projects/:id/stems` | `{mode?:"full"\|"vocal"}`(기본 `"full"`) → 완성곡을 `audiocpp_cli --task sep`로 분리해 `runs/:id/stems/`에 저장(먼저 `ffmpeg`로 44.1kHz WAV 변환). `full`은 `--family htdemucs`로 보컬/드럼/베이스/기타 4갈래(`{stems:["vocals","drums","bass","other"]}`), `vocal`은 `--family mel_band_roformer`로 보컬/악기 2갈래(`{stems:["vocals","instrumental"]}`) 반환. 해당 모델/엔진이 없으면 400, 분리 실패 시 502. 생성과 동시 실행 차단(`generating` 플래그 공유) |
| GET `/api/projects/:id/stems/:stem` | 분리된 스템 하나를 `audio/wav`로 스트리밍. 먼저 STEM 분리를 실행해야 함(없으면 404) |
| DELETE `/api/projects/:id/stems` | `runs/:id/stems/`를 통째로 삭제(임시 파일 정리). 프론트엔드는 STEM 분리 다이얼로그를 닫을 때(합치기 완료 포함) 항상 호출 |

### 심볼릭 작곡 (ABC notation)

| 메서드 / 주소 | 요청 / 응답 |
|---|---|
| POST `/api/plan` | `{title?,lyrics,style,cot,seed?,vocalGender?,instrumental?}` → `{abc}`. 프로젝트를 저장하지 않는 상태 없는(stateless) 미리보기 — 공식 Python 엔진으로 심볼릭 작곡만 실행. 409: 이미 다른 곡 생성/작곡 중 |
| POST `/api/abc-check` | `{abc}` → `{valid:true,report}` 또는 `{valid:false,error}`. `abc_tools.py inspect`로 두 성부(Vocal/Ins) 구조·박자·화음을 검사 |
| POST `/api/cover-transcribe` | `{dataUrl}`(오디오, base64, 최대 50MB), `{task?:'full'|'melody-full'|'melody-vocal'}` → `{abc}`. SheetSage2로 오디오에서 멜로디/화음을 전사해 native ABC로 반환. `sheetSagePythonPath` 미설정 시 400, 실행 실패 시 502 |
| POST `/api/abc-file` | `{abc,filename?,title?,folder?}` → `{ok:true,folder,filename,path}`. ABC 텍스트를 `.abc` 파일로 저장(`folder` 생략 시 `abcNotesPath` 또는 기본 `library/abc-note`) |
| GET `/api/abc-notes` | ABC 라이브러리 배열(JSON 노트 + `.abc` 파일 노트를 합쳐 `createdAt` 순). `.abc` 파일 노트의 `id`는 파일명 기반(`abcfile-<base64(파일명)>`)이라 제목을 바꾸면 id도 바뀜 |
| POST `/api/abc-notes` | `{title,abc}` → 201 저장된 `.abc` 파일 노트(기본 저장 형식) |
| PATCH `/api/abc-notes/:id` | `{title?,abc?}` → 수정된 노트. 제목이 바뀌면 파일명(및 `.abc` 노트면 id)도 함께 바뀜 |
| DELETE `/api/abc-notes/:id` | 노트와(있으면) 커버 이미지를 삭제 → `{ok:true,id}` |
| POST `/api/abc-notes/:id/cover` | `{dataUrl}`(PNG/JPEG/WEBP, base64, 최대 20MB) → 수정된 노트(커버 경로 포함) |
| DELETE `/api/abc-notes/:id/cover` | 커버 이미지 삭제 → `{ok:true}` |
| GET `/api/abc-notes/:id/cover` | 커버 이미지 바이트 스트리밍. 없으면 404 |

### EQ 프리셋 / 전체 후처리 설정 프리셋

`Setting/EQ-preset/`, `Setting/PostProcess/`에 이름 붙여 저장하는 사용자 프리셋. 두 그룹 모두 같은 GET(목록)/POST(저장·덮어쓰기)/DELETE(`?name=`, URL 인코딩 필요) 패턴입니다.

| 메서드 / 주소 | 요청 / 응답 |
|---|---|
| GET `/api/eq-presets` | 저장된 EQ 프리셋 배열(`{name,eq:[10개 숫자]}`), 이름순 정렬 |
| POST `/api/eq-presets` | `{name,eq:[10개 숫자]}` → 저장된 프리셋(같은 이름이면 덮어씀). `eq`가 10개 유한수 배열이 아니면 400 |
| DELETE `/api/eq-presets?name=` | 프리셋 삭제 → `{ok:true}`. 없으면 404 |
| GET `/api/postprocess-settings` | 저장된 전체 설정 프리셋 배열(`{name,params:{...}}`), 이름순 정렬 |
| POST `/api/postprocess-settings` | `{name,params:{...}}` → 저장된 프리셋(같은 이름이면 덮어씀). `params`가 객체가 아니면 400 |
| DELETE `/api/postprocess-settings?name=` | 프리셋 삭제 → `{ok:true}`. 없으면 404 |

## 가사 싱크 (LRC / 재생 중 가사 표시)

곡의 가사를 소리에 맞춰 줄 단위 시간으로 만든다. 방식: ① Mel-Band RoFormer로 보컬 분리 → ② Qwen3-ASR(+ Qwen3 Forced Aligner, `--words-out`)로 들린 단어의 시간을 구함(단독 정렬기는 긴 오디오를 못 받아 `max_source_positions` 오류가 나므로 ASR이 오디오를 나눠 각 조각을 정렬하는 이 경로를 쓴다) → ③ 들린 글자와 곡의 가사 글자를 편집거리 정렬(`backend/lyricsync.mjs`)로 맞춰 줄 시작 시각을 얻음. 인식이 조금 틀려도(앞의 대사 누락, 허밍 환각, 철자 차이) 동작하며, 인식되지 않은 줄은 이웃 줄 사이에서 추정한다(`estimated: true`). 가사의 `[Verse]` 같은 태그 줄과 빈 줄은 제외한다.

| 엔드포인트 | 설명 |
|---|---|
| POST `/api/projects/:id/lyrics-sync` | 싱크를 만들어 `{language, coverage, lines:[{text,start,end,confidence,estimated,words:[{text,start,end}]}], stale:false}`를 돌려주고 곡 옆에 `<이름>.lyrics.json`, `<이름>.lrc`로 저장. 가사가 없으면 400, Qwen3-ASR 또는 Forced Aligner 모델이 없으면 409(받는 방법 안내), 다른 작업 중이면 409 |
| GET `/api/projects/:id/lyrics-sync` | 저장된 싱크. 없으면 404. `stale`은 곡 파일이 더 새롭거나 가사가 바뀐 경우 true |
| GET `/api/projects/:id/lrc` | LRC 텍스트(`[mm:ss.xx]가사`, `[ti:]`, `[length:]` 포함) |

곡 목록은 `.notes.json`과 `.lyrics.json`을 곡으로 읽지 않는다. 곡 이름을 바꾸면 두 부속 파일도 같이 이동하고, 곡을 지우면 함께 지워진다. `GET /api/projects/:id/audio`는 HTTP Range(`bytes=a-b`, `bytes=a-`)에 206으로 답한다(플레이어가 재생 위치를 옮기는 데 필요, 범위 밖은 416). 실측(2분대 곡 3곡): 영어 글자 일치율 92%·26줄 중 23줄이 보컬 위, 한국어 100%·25/25, 일본어 96%·24/25, 처리 약 20~25초(보컬 분리 약 11초 + 인식 약 7초).

## AI 곡 다듬기 (노이즈 제거 · Spectral Lifter · 보컬 자연화 · 기준곡 마스터링)

완성곡의 메뉴 "AI 곡 다듬기"가 쓰는 후처리 체인이다. 알고리듬은 YuE2 Studio(MIT)의 `audio-post` 크레이트를 Node로 옮긴 것이며(`backend/postfx/`), 순수 DSP라 같은 입력·설정이면 결과가 같다. 무거운 계산은 워커 스레드(`postfx/worker.mjs`)에서 돌려 API 서버가 멈추지 않는다. 처리 순서는 고정: 노이즈 제거 → Spectral Lifter → 보컬 자연화 → 기준곡 마스터링. 사용자가 단계를 켜고 시작해야 하며(자동 적용 아님), 결과는 미리듣기로만 만들어지고 사용자가 저장해야 라이브러리에 추가된다.

| 엔드포인트 | 설명 |
|---|---|
| POST `/api/projects/:id/polish` | `{settings:{denoise:{enabled,strength},lifter:{enabled,gate,shimmerDb,hfMix,punch},naturalize:{enabled,amount},master:{enabled}}, referencePath?}` → 임시 미리듣기를 만들어 `{previewId, stages, durationMs}`. `referencePath`는 `library/` 기준 상대경로(마스터링일 때 필수, 경로 이탈은 400). 진행률은 `GET /api/generate/status`(`progress`, `detail`). 켠 단계가 없으면 400, 다른 작업 중이면 409 |
| GET `/api/polish/:previewId/audio` | 다듬은 미리듣기(24비트 FLAC) |
| POST `/api/polish/:previewId/save` | `{title?}` → 새 곡(기본 제목 `<원제> (다듬기)`, 원곡의 가사·스타일·커버 유지, `polishedStages` 기록)을 라이브러리에 저장하고 201 |
| DELETE `/api/polish/:previewId` | 미리듣기 삭제. 서버가 종료되거나 다시 시작할 때도 `runs/polish-*`를 지운다 |

설정값은 서버가 범위로 잘라 낸다(노이즈 세기 0.05~1, 리프터 게이트 0~1·반짝임 0~12 dB·고음역 복원 0~0.5·타격감 0~1, 자연화 양 0.05~1). 기본값은 Studio와 같다(노이즈 0.4, 게이트 0.3, 반짝임 6 dB, 자연화 0.5). 곡은 원래 샘플레이트 그대로 스테레오로 디코딩해 처리하고, 기준곡은 그 샘플레이트로 맞춰 디코딩한다. 실측(RTX 5070과 무관한 CPU 처리): 124.8초 곡의 전체 체인이 약 6.5초, 최대 메모리 약 390MB.

## 음악 생성 엔진 (audio.cpp)

`enginePath`가 가리키는 `audiocpp_cli.exe`를 `--family yue2 --task gen`으로 실행합니다. 모델 폴더는 항상 `models/audio-cpp/Yue2-3B-GGUF`(프로젝트 루트 기준) 고정이며, 프론트엔드의 모델 선택(`modelId`)에 따라 본체/VAE 조합이 정해집니다.

| modelId | 본체 GGUF | VAE GGUF |
|---|---|---|
| `yue2-q4` | `yue2-3b-q4_0.gguf` | `yue2-vae-f16.gguf` |
| `yue2-q8` | `yue2-3b-q8_0.gguf` | `yue2-vae-f16.gguf` |
| `yue2-bf16` | `yue2-3b-bf16.gguf` | `yue2-vae-f32.gguf` |
| `yue2-original` | audio.cpp 미사용. 공식 Python 파이프라인으로 실행 |
| `yue2-int8-convrot` | ComfyUI 형식 safetensors. ComfyUI 어댑터로 생성 지원(설치/설정은 [docs/comfyui-setup.md](comfyui-setup.md) 참고, VRAM 절약은 없음) |

audio.cpp 자체의 설치/빌드 방법은 [audiocpp-setup.md](audiocpp-setup.md)를 참고하세요. 한 번에 한 곡만 생성합니다(서버 내부 플래그로 동시 실행 차단, GPU 하나를 공유하기 때문). `wav`가 아닌 형식을 선택했는데 `ffmpeg`가 PATH에 없으면 변환이 실패해도 생성 자체는 성공 처리하고 `wav`로 대신 저장하며, `saveError`에 이유를 남깁니다.

### "악기만"(구조적 무보컬)이 실제로 동작하는 방식 — GGUF/원본 공통 (2026-09-14부터)

YuE2는 범용 악보 리더가 아니라, `V: Vocal`/`V: Ins` 두 성부를 각각 사람 목소리/악기 연주로 렌더링하도록 학습된 2채널 전용 모델입니다. `V: Vocal` 성부를 통째로 지우면 `AbcError: Incomplete native two-voice ABC`로 즉시 실패하고, 지우지 않더라도 그 자리를 실제 멜로디로 채우면 YuE2가 다시 사람 목소리로 합성해 버립니다. 화성(코드) 심볼은 이 native 방언에서 오직 `Vocal` 성부에만 존재할 수 있고(`Ins`에 있으면 파싱 단계에서 거부됩니다), Vocal이 쉬는 구간에도 화성 전달을 위해 그대로 남아 있어야 합니다.

그래서 `instrumental:true`로 생성할 때 서버는 `abc_tools.py mute-voice <원본.abc> <output.abc> --keep-voice Ins`를 실행합니다 — `Vocal`의 소리 나는 음표만 같은 박자 그리드 위의 쉼표(`z`)로 바꾸고, `"Am7"` 같은 화음 기호는 코드가 아니라 텍스트 위치만 유지되므로 그대로 남아 `"Am7"z16` 형태가 됩니다. `Ins` 성부는 그대로(코드 없이 실제 반주 멜로디)이며, 이렇게 만든 ABC를 원본(Python) 경로는 `--abc-file`로, GGUF 경로는 아래 방식으로 넘겨 생성합니다. 기존에 있던 `strip-chords --keep-voice`(모든 화음 기호를 지우는 명령, `cot="melody"` 재작곡용)로는 Vocal의 화성 정보까지 사라져 이 용도에 맞지 않아 별도 명령으로 분리했습니다. ABC 준비(계획/mute-voice) 자체는 두 경로 모두 Python 엔진(`pythonEnginePath`/`pythonScriptPath`)을 거치므로, GGUF만 쓰더라도 이 설정은 필요합니다.

### ABC 악보(심볼릭 작곡/커버)도 GGUF에서 동작함 — `--request-option abc_file=`

`audiocpp_cli`는 전용 `--abc-file` 플래그는 없지만, 범용 `--request-option key=value` 메커니즘으로 `abc`(텍스트) 또는 `abc_file`(경로)을 받습니다(`cot=melody`/`full`일 때만 허용 — `engine/audio.cpp/src/models/yue2/request.cpp`의 `abc_from_options()`). `runAudioCpp()`는 `project.abc`가 있으면(또는 `instrumental:true`로 위 mute-voice를 거치면) 이를 `runs/<project>/input.abc`에 쓰고 `--request-option abc_file=<path>`로 넘깁니다. 이전에는 이 메커니즘을 놓치고 "GGUF는 ABC를 지원하지 않는다"고 잘못 판단해 프론트엔드에서 두 버튼을 막고 `/api/generate`에서 GGUF+abc 조합을 거부했으나(2026-09-13), 실제로는 동작함을 CLI로 직접 검증(`yue2.plan.abc_tokens` 로그로 토큰화 확인)한 뒤 그 제약을 제거했습니다(2026-09-14). "심볼릭 작곡"(`/api/plan`)과 SheetSage2 "오디오에서 추출"(`/api/cover-transcribe`)은 어느 모델을 선택했든 동일하게 쓸 수 있습니다.

## STEM 분리 (audio.cpp HTDemucs / Mel-Band RoFormer)

완성곡 메뉴의 "STEM 분리"에는 두 모드가 있고 `separateStems()`가 `mode`에 따라 다른 `--family`로 `audiocpp_cli --task sep`를 호출합니다:

- **보컬+드럼+베이스+기타** (`mode:"full"`, 기본값): `--family htdemucs --model models/audio-cpp/audio.cpp-gguf/HTDemucs-GGUF/htdemucs-q8_0.gguf` → 4갈래 WAV. 매우 빠름(RTX 5070 2분짜리 곡 기준 약 5~7초, RTF ≈ 0.037)이지만 엔진이 고품질 앙상블("bag") 체크포인트를 지원하지 않아 보컬 누출이 상대적으로 있을 수 있음.
- **보컬+악기** (`mode:"vocal"`): `--family mel_band_roformer --model models/audio-cpp/audio.cpp-gguf/Mel-Band-RoFormer-GGUF/mel-band-roformer-f16.gguf` → 2갈래 WAV. 다른 아키텍처라 보컬 누출이 더 적음(RTX 5070 기준 약 10초, RTF ≈ 0.076). 처음엔 BS-RoFormer(ep368)를 썼다가 사용자가 직접 듣고 mel_band_roformer가 더 낫다고 판단해 교체했습니다 — 자세한 비교 경위는 [models.md](models.md)와 [audiocpp-setup.md](audiocpp-setup.md#stem-분리-보컬드럼베이스기타-악기) 참고.

두 패밀리 모두 audio.cpp 빌드 시 기본으로 포함되지 않으므로 `-Models yue2,htdemucs,bs_roformer`로 함께 빌드해야 하며(`bs_roformer` 별칭이 `mel_band_roformer` 로더도 같이 빌드함), 안 되어 있으면 400으로 명확히 실패합니다(자세한 빌드는 [audiocpp-setup.md](audiocpp-setup.md) 참고).

분리 결과는 `runs/:id/stems/`에 임시로 저장되고 **프로젝트 라이브러리에는 들어가지 않습니다** — 프론트엔드가 STEM 분리 다이얼로그를 열 때마다 `POST .../stems`로 새로 분리하고, 닫을 때(취소·합치기 완료 모두) `DELETE .../stems`로 지웁니다. 두 모드 다 10초 안팎이라 매번 새로 분리해도 부담이 적다고 판단해 캐싱하지 않았습니다.

각 STEM의 개별 후처리는 새 다이얼로그를 만들지 않고 기존 `PostProcessDialog`를 `sourceOverride`(스템 오디오 버퍼 + 이전 설정)와 `onSaveOverride`(저장 시 서버 대신 부모 컴포넌트로 결과를 돌려줌) props로 재사용합니다. "합치기"는 스템별로 처리된(또는 미처리 원본) 버퍼들을 `OfflineAudioContext`에서 동시에 재생해 자연스럽게 합산한 뒤, 기존 `/api/projects/:id/post-process`(원본 곡 후처리와 같은 엔드포인트)로 저장합니다 — STEM 분리 전용 저장 엔드포인트는 따로 없습니다.

## SheetSage2

`POST /api/cover-transcribe`는 설정의 `sheetSagePythonPath`로 별도 Python 환경을 실행합니다. `models/m-a-p/SheetSage2/config.json`과 `models/m-a-p/SheetSage2/model.safetensors`가 있으면 `--model models/m-a-p/SheetSage2 --offline`으로 로컬 모델을 사용합니다. 가중치 파일만 있으면 준비가 끝난 것이 아니며, Hugging Face 스냅샷의 Python 코드와 설정 파일이 같은 폴더에 있어야 합니다.

**현재 상태(2026-09-12)**: 실제 오디오 파일로 `POST /api/cover-transcribe` 종단 테스트에 성공했습니다 — 완성곡을 입력으로 넣어 `abc_tools.py inspect`로 구조 검증까지 통과하는 native ABC(Vocal/Ins 두 성부, 128개 소리 나는 음표, 37마디)가 정상 생성됨을 확인했습니다. 준비 과정에서 실제로 걸렸던 문제 두 가지와 해결책:

1. **`models/m-a-p/SheetSage2/config.json`의 `weights_format` 불일치.** 다운로드한 `model.safetensors`를 직접 열어보면(`safetensors.safe_open`) `encoder.*` 키가 876개 들어 있는 **완전히 병합(merged)된 체크포인트**인데, `config.json`은 `"weights_format": "adapter"`(별도 LoRA 어댑터 + 원격 `m-a-p/MERT-v2-FullSong` 베이스 모델을 따로 받아 병합하는 방식)로 되어 있어 `missing_keys` 오류로 로드가 실패했습니다. `config.json`의 `weights_format` 값을 `"merged"`로 바꾸면(어댑터/베이스 모델 다운로드 자체가 불필요해짐) 정상 로드됩니다. `models/`는 `.gitignore`에 있어 이 수정은 코드 저장소에 남지 않으므로, 모델을 다시 받을 경우 이 값을 다시 고쳐야 합니다.
2. **`backend/server.mjs`가 출력 폴더를 미리 만들어 `transcribe.py`와 충돌.** `transcribe.py`는 안전장치로 `fresh_directory()`(`exist_ok=False`)를 써서 출력 폴더가 이미 있으면 실패하도록 만들어져 있는데, 백엔드가 그 폴더를 스크립트 실행 전에 미리 만들어 항상 충돌했습니다. 부모 폴더만 미리 만들고 실제 출력 폴더는 스크립트가 직접 만들게 하도록 수정했습니다(백엔드 코드 수정이라 git에 반영됨).

**SheetSage2 전용 Python 가상환경 준비**: `test/YuE2-source/requirements-sheetsage2.txt`에 고정된 버전(`torch==2.8.0`+cu128, `transformers==4.45.2` 등)이 필요한데, YuE2 본체 실행에 쓰는 기존 `.venv`는 더 최신 버전(`torch 2.10`, `transformers 4.57`)이 설치돼 있어 같은 venv를 공유하면 버전 충돌이 날 수 있습니다. 별도 venv(`.venv-sheetsage2`)를 만들어 `pip install -r requirements-sheetsage2.txt`로 설치한 뒤, 설정 화면에서 `sheetSagePythonPath`를 그 venv의 `python.exe`로 지정해야 합니다. `transcribe.py`(전사 스크립트)는 `pythonScriptPath`와 같은 폴더(`test/YuE2-source/skills/yue2-music/scripts/`)에 있습니다.

**완성곡 메뉴의 "커버" (2026-09-13)**: 프론트엔드가 이 엔드포인트를 두 번째 방식으로도 부릅니다 — 파일 업로드가 아니라 `GET /api/projects/:id/audio`로 완성곡 자신의 오디오를 받아 `Blob`→`FileReader`로 data URL로 바꾼 뒤 그대로 `POST /api/cover-transcribe`에 넘깁니다(새 백엔드 엔드포인트 없이 기존 것을 재사용). 이 UI는 결과 ABC를 소비할 모델이 원본(Python)인지만 확인하고, 그 곡을 원래 어떤 엔진으로 만들었는지는 확인하지 않습니다 — 전사 자체는 오디오 출처와 무관하기 때문입니다.

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
