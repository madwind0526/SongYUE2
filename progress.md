# SongYUE2 진행 상황 / 남은 일

최종 업데이트: 2026-09-24

이 문서는 지금까지 구현이 끝난 것과 별개로, **아직 손대지 않았거나 실제 환경에서 검증되지 않은 부분**만 모아 둔 체크리스트입니다. 완료된 기능 전체 목록은 [README.md](README.md)를, 커밋 단위 변경 이력은 [revision.md](revision.md)를 참고하세요.

## ▶ 다음 에이전트용 상세 계획 (2026-09-24 작성)

이 절은 토큰/세션 한도로 작업이 끊겨도 **다른 에이전트가 그대로 이어받을 수 있게** 쓴 인수인계 문서다. 작업 전에 `todo.md` 최상단의 "진행 중 계획"과 이 절을 먼저 읽는다.

### 0. 환경/규칙 요약
- 작업 폴더 `C:\Claude\SongYUE2`. 프론트 `app/app/studio.tsx`(거대한 단일 파일), 백엔드 `backend/server.mjs`, 모델 카탈로그·CLI 인자 `backend/tts.mjs`, 테스트 `backend/server.test.mjs`(`npm test`, 타입체크 `cd app && npx tsc --noEmit -p tsconfig.json`).
- 전역 규칙: 코드 주석은 영어만, UI 문자열은 한국어. 포트는 `C:\Claude\PORTS.md`에서만 배정(SongYUE2 = 5176 프론트 / 4311 백엔드).
- **서버 재시작**: 백엔드는 핫리로드 없음. 포트 4311/5176 리스너를 죽이고 `node scripts/start-studio.mjs`를 백그라운드로 실행(PowerShell `Start-Process node -ArgumentList 'scripts/start-studio.mjs' -WorkingDirectory C:\Claude\SongYUE2 -WindowStyle Hidden`). `start.bat`을 백그라운드로 돌리면 뜨지 않는 경우가 있었다.
- **audio.cpp CLI**: `engine/audio.cpp/build/windows-cuda-release/bin/audiocpp_cli.exe`, 반드시 cwd=`engine/audio.cpp`. 패밀리는 빌드 시 포함돼야 함(안 그러면 "unsupported model family hint"). 재빌드: `powershell -File engine\audio.cpp\run-build.ps1`(로그 `build-asr.log`, 끝에 `EXIT=0` 확인; 백업 exe는 `*.bak-before-asr`). 새 패밀리를 쓰려면 `run-build.ps1`의 `-Models` 목록에 추가 후 재빌드(10~20분, GPU 작업과 동시에 돌리지 말 것).
- **모델 파일**: `models/audio-cpp/audio.cpp-gguf/<디렉터리>/<파일>.gguf`. 다운로드 URL은 `https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/<디렉터리>/<파일>` (목록: `https://huggingface.co/api/models/audio-cpp/audio.cpp-gguf/tree/main/<디렉터리>`). 앱 안에서는 `/api/audio-tools/tts/download`(카탈로그: `backend/tts.mjs`)로 받는다. 수동은 `curl -L -C - --retry-all-errors -o <파일> <URL>`.
- **함정들**
  - Git Bash `curl -d`로 한글 JSON을 보내면 인코딩이 깨진다 → 테스트는 node `fetch` 스크립트 사용. 긴 Python/JS를 heredoc으로 넘기면 따옴표 문제가 나므로 파일로 만들어 실행.
  - 테스트의 fake spawn은 `--out` 인자가 없으면 `args[0]`에 더미 바이트를 쓴다 → 실제 스크립트를 덮어쓴 사고가 있었음(`scripts/start-studio.mjs`). 테스트에서 실제 프로세스를 띄우는 코드 경로를 만들지 말 것.
  - `generating` 락은 응답 전송 전에 풀려야 한다(응답 후 `await rm(...)` 같은 게 락 해제를 늦추면 연속 요청이 409). ASR 라우트에서 겪음.
  - Qwen3-TTS `--language`는 `korean`/`english`/`auto` 전체 이름. 혼합 문장은 auto가 한국어를 빼먹고 korean이 영어를 빼먹으므로 문장 단위로 나눠 언어를 따로 지정(`splitTtsByScript`).
  - Qwen3-ASR는 `--language Korean` 같은 전체 이름, 입력은 16kHz mono WAV(서버가 ffmpeg로 변환), 출력은 `--text-out` 파일.
  - Playwright MCP 브라우저에 파일 대화상자가 쌓여 클릭이 막히는 경우가 있음 → `browser_file_upload`(경로 없이)로 취소하거나 `browser_close` 후 재접속.
  - 동시에 GPU를 쓰는 작업(Seed-VC 변환 등)을 벤치/빌드와 겹치면 OOM.

### 1. P0 — 마무리/정리 (**완료**, 커밋 `6471683`. 아래는 수행 내역 기록)
1. 브라우저(`http://127.0.0.1:5176/`)로 Audio Tools → 음성 인식(파일 선택→실행→텍스트 표시→저장 .txt), 음성 조절(피치/속도/음량→처리본 재생→저장), TTS 두 탭 동작 확인. 음색 변조 창에서 모델 버튼이 Seed-VC/Vevo/DDSP-SVC 3개인지 확인.
2. 남은 AuK/Whisper 언급 정리: `README.md`, `docs/*.md`, `memory-bank/knowledge/*`, `test/tts-model-comparison/bench.mjs`(전사를 AuK 4312로 하고 있음 → `POST /api/audio-tools/asr`로 교체).
3. `scripts/download_models.py`(REPOS `audio-cpp/audio.cpp-gguf` prefixes)와 `docs/audiocpp-setup.md`(`-Models` 목록)에 Qwen3-TTS/CosyVoice3/Chatterbox/Qwen3-ASR/ForcedAligner 반영.
4. memory-bank: `CACHE.md`의 wave 49 항목을 `knowledge/`로 flush, `STATE.md` wave 증가·CLEAN, `active-context.md`를 다음 과제로 갱신. `PORTS.md`의 AudioAuK 행은 별개 프로젝트이므로 유지.
5. `git add`(untracked `backend/tts.mjs` 포함) 후 커밋(시스템이 지정한 Co-Authored-By 줄 포함).

### 2. P0-b — 음성 인식 다중 모델 (사용자 요청)
- 현재 `backend/tts.mjs`의 `ASR_FAMILIES`에 `qwen3asr` 하나만 있고, `server.mjs`의 `transcribeWav`/`resolveAsrModel`이 `qwen3_asr` 패밀리 인자로 고정돼 있다. 프론트 `AudioToolsPage`의 음성 인식 UI도 `asrModels[0]`만 쓴다.
- 후보(README 표, 한국어 가능 여부 확인 필요): `nemotron_asr`(100+ 언어, Nemotron-3.5-ASR-Streaming-0.6B-GGUF), `vibevoice_asr`(auto, VibeVoice-ASR-GGUF), `fun_asr_nano`(auto/zh/en/ja, Fun-ASR-Nano-2512-GGUF — 한국어 미표기), `sense_asr`/`audio8_asr`(ko 표기, HF 디렉터리 존재 여부 확인), `voxtral_realtime`. 각 `docs/models/<family>.md`에서 CLI 예시(`--task asr --family <f> --model <gguf> --audio ... --text-out`)와 언어 옵션 이름을 확인.
- 절차: ① `run-build.ps1` `-Models`에 채택 후보 패밀리 추가·재빌드 ② 모델 다운로드 후 같은 한국어 샘플(`test/tts-model-comparison/audio/*.wav`)로 CER 비교 ③ `ASR_FAMILIES`에 패밀리별 `variants`(크기/정밀도)와 `cliFamily`, 언어 옵션 매핑을 추가 ④ `transcribeWav`가 선택된 패밀리의 `cliFamily`와 언어 인자를 쓰도록 일반화(`/api/audio-tools/asr` 요청에 `family` 추가) ⑤ 프론트에 모델(패밀리) 버튼 + 크기 + 정밀도 + "모델 받기" 표시(TTS 모델 선택 UI와 동일 컴포넌트 패턴, `renderModelStatus` 재사용) ⑥ 백엔드 테스트에 패밀리별 인자 검증 추가.
- 미설치 모델은 409 + "받기" 안내(이미 구현된 패턴). 자동 참조 텍스트(TTS)는 설치된 ASR 중 가장 좋은 것 사용(`resolveAsrModel` 우선순위 목록 갱신).

### 3. P1 — 음성 변환에 RVC·MeanVC2 추가 (**완료** 2026-09-24. 구현: `backend/tts.mjs` `VC_FAMILIES`, `server.mjs` `runRvcSvc/runMeanVc2Svc/convertOne`, 프론트 `TIMBRE_ENGINES`. 아래는 원래 계획 기록)
- 문서: `engine/audio.cpp/docs/audio_tools.md`의 "RVC", "MeanVC2" 절과 `docs/models/meanvc2.md`에서 CLI 확인 (RVC: `--family rvc --task vc`, 포장된 v1/v2 음성 + retrieval blending 옵션; MeanVC2: `--task vc`, zero-shot).
- 모델: HF `RVC-GGUF/`, MeanVC2 디렉터리 이름은 `.../tree/main`에서 `MeanVC` 검색. `run-build.ps1`의 `-Models`에 `rvc,meanvc2` 추가 후 재빌드.
- 백엔드: `runSeedVcSvc`/`runVevo2Svc`(server.mjs)와 같은 위치에 `runRvcSvc`/`runMeanVc2Svc` 추가(둘 다 `runSvcCli` 재사용). `applyVocalTimbreCore`의 엔진 분기(`engine: 'seed_vc'|'vevo2'`)에 새 값 추가, 긴 보컬은 기존 10초 창 청크 로직(`buildChunkPlan`) 공유. 결과는 `postProcessConvertedVocal` 통과.
- 프론트: `TIMBRE_ENGINES`에 `rvc`, `meanvc2` 추가, `isLegacy`(참조 audio 기반) 조건과 `applyLegacy`의 engine 전달 확장. RVC는 "packaged voice" 선택 UI가 필요할 수 있으니 문서를 먼저 읽고 결정.
- 테스트: `server.test.mjs`의 Vevo2 엔진 테스트를 복제(인자 `--family rvc` 등, 모델 미설치 400). 실제 곡으로 Seed-VC와 A/B 청취 후 `test/vocal-timbre-engine-comparison/README.md`에 기록.

### 4. P2 — TTS 추가 모델 옵션
- 후보: `voxcpm2`(30개 언어, 48kHz, Clone/Design), `fish_audio`(S2 Pro, 감정 태그), `index_tts2`(zh/en/ja 위주, 감정 제어), `omnivoice`(646개 언어, Clone/Design), `supertonic`(ko 포함, 프리셋 화자), `fireredtts3`, `dots_tts`. 각 `docs/models/<family>.md`에서 CLI 예시와 한국어 지원 확인.
- 절차: (a) 후보 3~4개 빌드 목록 추가·재빌드, 모델 다운로드 (b) `test/tts-model-comparison/bench.mjs`에 설정 추가(전사는 Qwen3-ASR로 교체 후) 동일 4개 문장으로 CER 비교 (c) 상위 모델을 `backend/tts.mjs`의 `TTS_FAMILIES`에 variants로 추가하고 `buildTtsArgs`에 분기 (d) 프론트는 `ttsModels`에서 버튼이 자동으로 늘어남(`ttsVariantsFor`의 non-qwen 규칙 확인) — Design 지원 모델은 `mode:'design'` 변형으로 등록.
- 기본 선택은 Qwen3-TTS 유지.

### 5. P3 — 대사 편집 탭
- 후보를 한국어로 실측: Vevo2 `--task s2s --task-route editing --source-audio A.wav --target-voice ref.wav --target-text "새 문장"`(빌드 포함됨, `docs/models/vevo2.md` "Speech Editing"), DotTTS Edit(`template_name=edit`, `source_text` 필요), FireRedTTS3 edit.
- UX: 오디오 선택 → 음성 인식으로 전사해 텍스트 표시(`/api/audio-tools/asr` 재사용) → 바꿀 문장 입력 → 새 라우트 `/api/audio-tools/edit` → 처리본 비교/저장. 과거 AuK Function UI(교체/삽입(앞)/삽입(뒤)/삭제)는 `git show HEAD:app/app/studio.tsx`의 `EDIT_FUNCTIONS` 참고.
- 실측 결과가 나쁘면 탭을 만들지 않고 pending으로 남긴다.

### 6. P4 — 효과음 생성 탭
- `stable_audio`(SFX 변형) 또는 `controlfoley`(44kHz). `docs/audio_tools.md` ControlFoley 절: `--task gen --family controlfoley --model .../controlfoley-large-44k-f32.gguf --text "..."`. 모델 크기·VRAM·길이 지정 가능 여부 확인 후 선택.
- UI: 텍스트 프롬프트 + 길이 + 모델/정밀도 선택, 결과 비교창 재사용, 저장은 `AudioToolsPage`의 `saveBlob`.

### 7. Pending 판단 기준
- 강제 정렬: 가사 싱크/LRC가 필요해지면 `qwen3_asr`의 `--words-out words.json`(+forced aligner 모델 경로, `docs/models/qwen3.md`) 또는 `qwen3_forced_aligner` 단독. 모델 `Qwen3-ForcedAligner-0.6B-GGUF`(q8 1130MB).
- 화자 분리: 대화 오디오 처리 요구가 생길 때. `sortformer_diar`(`--task diar --turns-out`, 4인, 영어 학습).
- ACE-Step 편집: YuE2 결과의 부분 재생성이 필요할 때 `repaint`(`--repaint-start/--repaint-end`)만 시험.

### 8. 완료 정의 (각 단계 공통)
`npm test` 통과 + `npx tsc --noEmit` 통과 + 실제 모델로 API 직접 호출 1회(node fetch) + 브라우저 화면 확인 + 문서/todo 체크 갱신 + 커밋.

## 문서화

- [x] `docs/local-api.md` 엔드포인트 표를 실제 코드 기준으로 전면 재작성 — 이전에 3개(`post-process`/`eq-presets`/`postprocess-settings`)만 빠진 것으로 파악했으나, 실제로는 재생목록·프로젝트 커버·ABC 관련 엔드포인트(`plan`/`abc-check`/`cover-transcribe`/`abc-file`/`abc-notes`+하위 경로/`llm/abc-edit`/`generate/status`) 전체가 문서화되어 있지 않았음. 전부 반영 완료.
- [x] `Setting/` 폴더(앱 레벨 설정 저장소, `library/`와 별개)의 존재와 용도를 `docs/local-api.md`에 문서화.
- [x] `docs/models.md`의 SheetSage2 절이 "config.json 없음" 기준으로 정체되어 있던 것을 실제 파일 상태(코드·설정 파일 설치 완료, venv만 남음) 기준으로 갱신.

## 구조적 무보컬("악기만") 메커니즘 재검증 및 수정

- [x] 사용자가 지적한 대로, 기존 `abc_tools.py strip-chords --keep-voice Ins`는 Vocal 성부를 쉼표로 바꾸는 것과 별개로 **전체 성부의 화음 기호까지 모두 지워버려**, Vocal이 쉬는 동안에도 화성을 오케스트라에 전달해야 하는 native 방언의 설계(코드 파서의 `"Native chord symbols belong in Vocal, not Ins"` 불변식, `references/abc-editing.md`의 "harmony is represented by quoted symbols in Vocal, including when resting")와 어긋났음.
- [x] `abc_tools.py`에 `mute-voice` 명령을 새로 추가 — 선택하지 않은 성부의 소리 나는 음표만 같은 박자 그리드의 쉼표로 바꾸고, 화음 기호는 전혀 건드리지 않음(`"D"C8` → `"D"z8`). `backend/server.mjs`의 `stripVocalVoice()`를 이 명령을 쓰도록 전환, 백엔드 테스트/`references/abc-editing.md` 갱신, `node --test backend/server.test.mjs` 8/8 통과 확인.

## SheetSage2 제로샷 커버 — 종단 검증 완료 (2026-09-12)

- [x] 실제 완성곡 오디오를 `POST /api/cover-transcribe`에 넣어 종단 테스트 성공. 결과 ABC가 `abc_tools.py inspect` 구조 검증도 통과(Vocal/Ins 두 성부, 128개 소리 나는 음표, 37마디, 원본 길이와 일치하는 nominal duration). 과정에서 실제로 막혔던 문제 두 가지를 찾아 고침:
  1. `models/m-a-p/SheetSage2/config.json`의 `weights_format`이 `"adapter"`로 되어 있었지만, 실제 `model.safetensors`를 열어보면 `encoder.*` 키가 876개 포함된 **완전히 병합된(merged) 체크포인트**였음 — `missing_keys` 오류로 로드 실패. `weights_format`을 `"merged"`로 고쳐 해결(원격 베이스 모델 다운로드도 불필요해짐). `models/`는 `.gitignore`라 이 수정은 저장소에 안 남으므로 모델을 다시 받으면 다시 고쳐야 함 — [docs/models.md](docs/models.md)에 기록.
  2. `backend/server.mjs`가 출력 폴더를 미리 만들어(`mkdir`) `transcribe.py`의 안전장치(`fresh_directory()`, `exist_ok=False`)와 항상 충돌해 즉시 실패하고 있었음. 부모 폴더만 미리 만들도록 수정(커밋 반영됨).

## 완성곡 메뉴에 "커버" 추가 (2026-09-13)

- [x] 완성된 곡의 "..." 메뉴에 "리믹스" 바로 아래 "커버" 항목 추가. 그 곡 자신의 오디오를 SheetSage2로 전사해 멜로디/코드 ABC 악보를 뽑아 작곡 화면에 채워 넣는다.
- [x] 활성화 조건은 **그 곡을 만든 모델이 아니라 현재 작곡 화면에서 선택된 모델**이 원본(Python)인지 여부다 — SheetSage2 전사는 어떤 엔진으로 만들었든 오디오 파일이면 다 되지만, 결과 ABC를 실제로 소비하는 쪽은 지금 선택된 모델이기 때문(GGUF는 `--abc-file` 자체를 지원하지 않음). 현재 GGUF가 선택되어 있으면 GGUF로 만든 곡이든 원본으로 만든 곡이든 상관없이 모든 곡의 "커버"가 비활성화된다.
- [x] 클릭 시 이미 작곡 화면에 가사/스타일이 채워져 있으면 "현재 설정 유지"/"이 곡 설정 사용" 중 선택하는 확인 대화상자를 띄운다. 어느 쪽이든 ABC는 항상 그 곡의 멜로디로 채워지고, 모델 선택(modelId)은 어느 쪽을 골라도 건드리지 않는다(이미 원본으로 확인된 상태라 바꿀 필요가 없고, 바꾸면 오히려 그 곡의 원래 모델이 GGUF일 때 방금 만든 ABC가 다시 무용지물이 됨).
- [x] 브라우저에서 종단 확인 완료(실제 "노래 만들기" 생성 직전까지): GGUF 선택 시 비활성화, 원본 선택 시 활성화(대상 곡의 원래 모델과 무관), 확인 대화상자 노출, "이 곡 설정 사용" 선택 시 가사·스타일·고급 설정과 실제 추출된 ABC 악보까지 정상 반영, 모델 선택은 원본으로 유지됨을 확인. "노래 만들기"로 실제 오디오까지 생성하는 마지막 단계는 별도 이슈(현재 실제 생성이 중간에 에러로 끊김)로 이번 검증 범위에서 제외했다.
- **알려진 한계**: Suno류 서비스의 "커버"와 달리 **실제 보컬 음색/톤을 가져오지 않는다**. `run_yue2.py`의 CLI 인자를 확인한 결과 참조 오디오에서 화자 임베딩/음색을 추출해 넘기는 입력 경로 자체가 없다(`--abc-file`로 멜로디/코드만, `--request`로 가사·스타일·`vocalGender` 텍스트만 전달). "이 곡 설정 사용"을 선택하면 그 곡의 `vocalGender`(남/여/듀엣)라는 거친 카테고리 힌트만 함께 복사될 뿐, 실제 음색은 모델이 가사/스타일 프롬프트만으로 새로 만들어낸 목소리다.

## INT8 ConvRot 모델 — ComfyUI 어댑터 구현 및 종단 검증 완료 (2026-09-15)

- [x] `yue2_3b_int8_convrot.safetensors`는 ComfyUI 전용 형식이라 audio.cpp/공식 Python으로 실행 불가 — ComfyUI가 v0.35.0부터 YuE2를 네이티브 지원하는 것을 확인하고, `backend/comfyui.mjs`로 HTTP API(`/prompt`+`/history`+`/view`) 연동을 구현. 워크플로우 그래프(`CheckpointLoaderSimple → YuE2GenerateMusic → ConditioningZeroOut → EmptyYuE2LatentAudio → KSampler(cfg=1.0) → VAEDecodeAudio → SaveAudio`)는 실제 ComfyUI의 `/object_info`를 조회해 정확한 노드 스키마로 작성(추측 없음).
- [x] 처음엔 자매 프로젝트 `C:\Claude\AudioAuK\engine\ComfyUI`(이미 YuE2 지원 버전)를 재사용했으나, 2026-09-16 SongYUE2 전용 독립 설치(`engine/ComfyUI`, 포트 8190, `.venv` 약 4.1GB, `.gitignore` 대상)로 전환 — 체크포인트는 여전히 하드링크로 연결(디스크 중복 없음). `backend/server.mjs`의 `runComfyUi()`가 ComfyUI 미기동 시 자동으로 띄우고, 생성 후 `POST /free`로 VRAM을 해제해 다른 모델로 전환할 때 RTX 5070 12GB에서도 여유가 있게 함. 설치 가이드: [docs/comfyui-setup.md](docs/comfyui-setup.md).
- [x] 실제 생성으로 4가지 모두 확인: ①일반 노래 생성(자동 심볼릭 작곡 후 렌더링, 40초 분량) ②"악기만"(기존 mute-voice 메커니즘 재사용) ③ABC 심볼릭 작곡(모델과 무관하게 항상 Python 엔진 사용) ④커버(SheetSage2로 원곡 전사 → 새 가사/스타일로 같은 멜로디 재생성) — 전부 무음/클리핑 없는 정상 오디오로 완료됨.
- **알아둘 점**: INT8 ConvRot은 로드 시 BF16으로 복원되어 VRAM을 절약하지 않음(다운로드 용량만 감소). 기본 작곡 계획(cot=full)에서는 이 모델도 Python 엔진(`pythonEnginePath`/`pythonScriptPath`) 설정이 필요함(cot=off일 때만 예외). 설치/설정 가이드: [docs/comfyui-setup.md](docs/comfyui-setup.md).

## 음원 복원(AudioSR) + 채널 분리 기능 추가 및 실기 검증 완료 (2026-09-16)

- [x] **음원 복원**: 사이드바 좌측 하단에 새 메뉴 신설. 저음질 외부 오디오 파일을 업로드하면 audio.cpp의 AudioSR(`--task s2s --family audiosr`)로 복원해 새 완성곡으로 라이브러리에 저장. AudioSR이 출력을 무조건 모노로 만드는 모델 자체 한계(우회 옵션 없음)가 있어, `ffprobe`로 채널 수를 확인한 뒤 스테레오면 `ffmpeg channelsplit`로 좌/우를 분리해 각각 복원하고 `join` 필터로 재결합해 스테레오를 유지. 11kHz 모노/24kbps mp3로 실제 열화시킨 테스트 소스로 검증: 6kHz 이상 고음 평균 에너지 -59.5dB(열화)→-51.0dB(복원, 무손실 원본 -42.6dB) — 실제 개선 확인, 사용자에게 원본/열화/복원 3개 파일 전달함. 이미 무손실인 오디오(예: SongYUE2 생성곡)에는 효과 없음(이전에 YuE2 출력으로 시도했을 때와 동일한 결론). **후속 발견(같은 날): 결과물에 클릭/틱 잡음이 재현됨 — 아래 "[할 일] AudioSR 복원 결과에 클릭/틱 잡음" 섹션 참고, 현재 실험적 기능으로 표시하고 원인 조사는 보류 중.**
- [x] **채널 분리**: AudioSR과는 완전히 독립된 별개 기능(처음엔 하나로 오해해서 사용자가 직접 정정함). 완성곡 메뉴의 "STEM 분리" 바로 앞에 "채널 분리" 항목 추가 — AI 모델 없이 `ffmpeg channelsplit`만으로 왼쪽/오른쪽 채널을 나눠, 기존 STEM 분리와 완전히 동일한 다이얼로그(분리 → 각 트랙 EQ/FX 후처리 → 합쳐서 저장)를 그대로 재사용(`STEM_MODE_CONFIG`에 `channel` 모드 추가만으로 구현, 프론트 다이얼로그 컴포넌트는 무수정). 스테레오가 아닌 곡은 명확한 오류로 거부.
- [x] audio.cpp를 `-Models "yue2,htdemucs,bs_roformer,audiosr"`로 재빌드(기존 3개 유지 + audiosr 추가). 빌드 중 `-Models` 파라미터가 `[string]` 타입인데 따옴표 없이 쉼표로 나열하면 PowerShell이 배열로 오인해 바인딩 오류가 나는 걸 발견 — 항상 따옴표로 감싸야 함(`docs/audiocpp-setup.md`에 기록).
- [x] 실기 검증: 실제 SongYUE2 백엔드(가짜 spawn 아님)로 `/api/audiosr-restore`와 채널 분리 `/api/projects/:id/stems`(mode: channel)를 둘 다 실제 GPU로 호출해 라이브러리 저장·스테레오 유지까지 확인. `npm test`(mock 기반 테스트 포함 12개 전부 통과), `npm run check` 통과. 테스트 프로젝트는 정리함.

## [할 일] AudioSR 복원 결과에 클릭/틱 잡음 — 원인 미해결 (2026-09-16 발견)

- [ ] **증상**: "음원 복원"으로 만든 결과물에 미세한 "쇠긁는 소리"(클릭/틱 잡음)가 들림. 사용자가 직접 보고.
- [x] **원인 조사 완료, 근본 원인은 아직 못 찾음**: 스펙트로그램으로 확인한 결과 특정 시점에 전 대역(DC~24kHz)을 덮는 수직선(클릭)이 보임. 다음을 실측으로 배제함:
  - L/R 분리·재결합 메커니즘 — null-test(위상 반전 후 합산)로 원본과 -91dB(사실상 동일) 확인, 분리/합치기 자체는 완전히 깨끗함.
  - 좌우 채널 간 위상/디코릴레이션 — 스테레오 폭(L-R 에너지) AudioSR 전후 거의 동일(-32.3dB → -32.6dB).
  - seed 값 — 42→123으로 바꿔도 클릭이 거의 같은 위치에 재현됨(무작위 샘플링 문제 아님, deterministic).
  - 청크 분할 — `audio_chunk_duration_sec`를 30초(청크 1개로 통짜 처리)로 올려도 클릭이 그대로 남음(청크 경계 이음새 문제 아님).
  - **다른 곡/다른 구간으로 테스트하니 클릭 2개가 아니라 훨씬 잦은 빈도로 재현됨** — 콘텐츠에 따라 심하게 재현되는 구조적 문제로 보임. audio.cpp의 `model_specs/audiosr.json`에 `"status": "experimental"`로 이미 표시되어 있던 것과 부합.
  - **(최종 확인) L/R 분리 코드를 아예 거치지 않은 순수 모노 다운믹스**(`ffmpeg pan=mono`로 생성, `channelsplit` 미사용)를 AudioSR 1회만 돌려도 동일한 클릭이 재현됨 — SongYUE2가 추가한 분리/합치기 코드와는 100% 무관, AudioSR/audio.cpp 자체의 문제로 최종 확정.
- [ ] **다음 단계(우선순위 낮음, 보류 중)**: audio.cpp의 AudioSR C++ 구현 소스를 직접 읽어 클릭이 STFT/hop 크기, VAE 디코드 경계, 혹은 수치 안정성 문제 중 어디서 나는지 추적. 또는 audio.cpp 업스트림에 이슈 제보 고려.
- **현재 조치**: 기능은 유지하되 사이드바 메뉴("음원 복원 (실험적)")와 페이지 안에 명확한 경고 문구 추가(`app/app/studio.tsx`의 `restorePage()`) — 사용자가 결과물을 듣고 잡음이 있으면 쓰지 말고 삭제하도록 안내.

## MIDI로 내보내기(MuScriptor) 기능 추가 및 실기 검증 완료 (2026-09-16)

- [x] 완성곡 메뉴에 "MIDI로 내보내기" 항목 신설(`Music2` 아이콘, "다운로드" 바로 아래). audio.cpp의 MuScriptor(`--task midi --family muscriptor`)로 오디오를 노트 이벤트로 변환해 표준 MIDI(.mid) 파일을 다운로드. `model_specs/muscriptor.json`이 `"status": "supported"`(AudioSR과 달리 실험적 아님)로 표시된 것과 일치하게 실제로도 안정적으로 동작함.
- [x] **매우 빠름**: RTX 5070에서 30초 클립 기준 약 0.7초(RTF ≈ 0.024, 실시간의 42배). 실제 라이브러리 곡으로도 5.7초 만에 완료(대부분 ffmpeg 정규화 시간). 결과는 원본 오디오 파일과 같은 폴더에 `<파일명>.mid`로 캐시되어(mtime 비교), 원본이 안 바뀌면 두 번째 요청부터 0.08초 만에 즉시 응답 — 진행률 표시 없이 단순 다운로드 링크로 구현해도 충분함을 실측으로 확인.
- [x] audio.cpp를 `-Models "yue2,htdemucs,bs_roformer,audiosr,muscriptor"`로 재빌드. 실제 라이브러리의 피아노 발라드 곡으로 테스트한 결과 유효한 Standard MIDI(format 1) 파일이 나왔고, 노트 이벤트(피치·타이밍·`acoustic_piano`/`voice` 악기 태그)가 음악적으로 합리적인 것을 JSON 이벤트 로그로 확인함(MIDI 신디사이저가 없어 직접 렌더링해 듣지는 못함 — 사용자에게 파일을 전달해 DAW/미디 플레이어로 직접 확인 요청).
- 설치 가이드: [docs/audiocpp-setup.md](docs/audiocpp-setup.md)의 "MIDI로 내보내기" 절.

## MIDI 편집기 팝업(음표 보기/수정/저장) 추가 및 실기 검증 완료 (2026-09-16)

- [x] "MIDI로 내보내기" 메뉴 버튼이 더 이상 바로 다운로드하지 않고, SVG 피아노롤 팝업(`MidiEditorDialog`, `app/app/studio.tsx`)을 띄움 — MuScriptor가 추출한 음표를 눈으로 보고, 이동/리사이즈/삭제하거나 빈 공간을 클릭해 새 음표를 추가한 뒤 "취소"(버림) 또는 "저장"할 수 있음. 다이얼로그 안에 별도 "다운로드" 버튼도 유지.
- [x] 백엔드: `exportMidi()`가 `--out`과 함께 `--text-out`을 요청해 노트 이벤트 JSON을 같이 뽑고, start/end 쌍을 `{id, pitch, start, end, instrument}[]`로 평평하게 정리해 `<파일명>.notes.json`으로 `.mid`와 같은 mtime 캐싱 규칙으로 저장(`GET /api/projects/:id/midi/notes`). 새 `backend/midi.mjs`에 표준 MIDI 인코더(`encodeMidiFile`, 포맷 0·단일 트랙·템포 메타·악기별 Program Change·가변길이 델타타임)를 작성 — MuScriptor에도 audio.cpp에도 "노트→MIDI" 인코더가 없어서 직접 구현. `POST /api/projects/:id/midi`가 편집된 노트 배열을 받아 재인코딩해 캐시를 덮어씀.
- [x] 검증: `backend/midi.mjs`로 만든 파일을 Python `mido`로 라운드트립 검증(타이밍·Program Change 정확함 확인). 실제 라이브러리 곡("JR0001-1 내가 기다리는 것")으로 브라우저 종단 테스트 — 실제 MuScriptor 추출 결과가 피아노롤에 정확히 렌더링됨, 음표 클릭 선택/삭제, 빈 공간 클릭으로 새 음표 추가 모두 동작 확인, 저장 후 서버에서 다시 받은 노트 배열과 재다운로드한 .mid 파일(`mido`로 재검증)에 편집 내용이 반영됨을 확인.
- [x] **신디사이저 미리듣기 추가**: 사용자가 "그것도 넣으면 환상적일거 같다"고 요청해서 바로 이어서 구현. Web Audio API의 `OscillatorNode`(악기별 파형: 피아노류 triangle, 현/기타류 sawtooth, 베이스/보컬/관악기류 sine 등)+`GainNode` ADSR 엔벨로프(클릭 방지용 짧은 attack/release)로 현재 편집 중인(저장 전) 노트 상태를 그대로 재생. 재생 위치를 보여주는 플레이헤드 세로선이 피아노롤 위를 실시간으로 이동(`requestAnimationFrame`). 음표를 옮기거나 추가/삭제하면 재생 중이던 미리듣기를 자동으로 멈춰서(재생 예약은 클릭 시점 스냅샷이라) 오래된 소리가 남지 않게 함. 다이얼로그 언마운트/닫기/저장 시 재생 정리(`stopPlayback()`).
- **버그 발견 및 수정**: `.notes.json` 캐시 파일이 `library/music/`에 `.mid`와 같이 저장되는데, 프로젝트 목록을 스캔하는 `listEntries()`가 그 폴더의 모든 `*.json`을 프로젝트로 취급하고 있어서 `.notes.json`(노트 배열, `{title}` 없음)을 잘못된 "프로젝트"로 읽어들여 프론트 정렬(`title.localeCompare`)에서 런타임 크래시가 났다. `listEntries()`의 필터에 `&& !name.endsWith('.notes.json')` 추가로 수정, 회귀 테스트도 추가(수정 전 되돌려서 테스트가 실제로 잡아내는 것 확인).
- 범위: 음표 재생 미리듣기는 넣었지만, 실제 악기 음색을 모사하는 샘플 기반 신디사이저는 아님(오실레이터 기반 단순 신디사이저) — 정확한 음색 확인은 여전히 저장 후 파일을 DAW 등에서 여는 방식을 권장.

## 보컬 음색 변환(Seed-VC) 기능 추가 및 실기 검증 완료 (2026-09-16)

- [x] 완성곡 메뉴에 "보컬 음색 변환" 항목 신설(`Mic` 아이콘, STEM 분리 항목들 아래). 목표 음색의 짧은 참조 오디오를 올리면 audio.cpp의 Seed-VC(`--task svc --family seed_vc --task-route v1_svc`, Singing Voice Conversion)로 그 곡의 보컬만 바꿔서 새 완성곡으로 라이브러리에 저장. 로드맵상 RVC(`model_specs/rvc.json`, `"status": "experimental"`, 내장 음색 4개 중 선택만 가능)와 Seed-VC(`model_specs/seed_vc.json`, `"status": "supported"`, 임의의 참조 오디오로 제로샷 변환) 중 AudioSR/MuScriptor 때와 같은 기준(`status` 필드+실제 용도 적합성)으로 Seed-VC를 선택.
- [x] Seed-VC는 보컬 트랙 하나만 변환하므로, 백엔드 `convertVocalTimbre()`가 기존 `separateStems(entry, 'vocal')`(Mel-Band RoFormer)을 재사용해 보컬/반주를 먼저 분리 → 보컬만 Seed-VC SVC로 변환(`runSeedVcSvc()`) → 변환된 보컬을 ffmpeg `amix` 필터로 원래 반주와 재합성 → `finalizeToMusic()`으로 새 완성곡 저장. 임시 작업 폴더와 재사용한 STEM 폴더 모두 완료 후 정리.
- [x] **실측**: RTX 5070에서 RTF ≈ 0.82(40초 보컬 변환에 약 33초) — MuScriptor(RTF 0.024)보다 훨씬 느리고 AudioSR과 비슷한 체감 속도라 AudioSR/음원 복원과 같은 진행률 폴링 UI(`generating`+`/api/generate/status`) 패턴을 그대로 재사용.
- [x] **실기 검증**: 실제 라이브러리 곡("E0062-1 The World Behind the Curtain")의 보컬을 추출해 다른 곡("J0062-1")의 보컬을 참조 음색으로 40초 클립 변환 테스트(CLI 직접 실행) 후, 실제 브라우저 UI로 2분 11초 완성곡("E0062-2 The World Behind the Curtain")을 끝까지 변환 — 파일 업로드→변환→라이브러리에 새 곡으로 저장까지 전체 흐름 확인. 결과물을 사용자에게 전달해 직접 들어보도록 요청.
- [x] 범위/한계: 보컬 분리(STEM)와 음색 변환(Seed-VC)을 순서대로 거치므로 원곡보다 음질이 떨어질 수 있고, 참조 음색과의 유사도는 참조 오디오 품질(짧고 깨끗할수록 좋음)에 크게 좌우됨 — 다이얼로그에 경고 문구 표시.
- 설치 가이드: [docs/audiocpp-setup.md](docs/audiocpp-setup.md)의 "보컬 음색 변환" 절.

## "보컬 음색 변환"을 원샷 업로드에서 STEM1 스타일 편집기로 재설계 (2026-09-16)

- [x] 사용자가 "RVC를 곡 만드는 단계에서 할건가? 만든이후에 후처리로 할껀가?"라고 물어서, YuE2 자체엔 참조 오디오 화자 임베딩 입력이 없어(이미 "커버" 기능에서 확인된 제약) 생성 단계 적용은 불가능하고 후처리일 수밖에 없다고 답한 뒤, 사용자가 "STEM1과 같은 UI"로 다시 만들어달라고 요청 — 왼쪽에 참조 음색 선택+적용 버튼, 적용하면 보컬/악기 두 트랙이 STEM1처럼 나타나 각각 후처리 가능, 아래엔 원본과 후처리까지 적용된 결과를 비교하는 미리듣기.
- [x] 기존 원샷(파일 선택 즉시 최종 저장) 방식을 버리고 `VocalTimbreDialog`를 `StemDialog`의 편집기 골격(스템 리스트+개별 후처리(중첩 `PostProcessDialog`)+combined-original/combined-preview 비교+"합치기"+"저장" 흐름)을 그대로 재사용해 다시 작성. 다른 점은 둘뿐: ①트랙이 준비되기 전에 왼쪽 사이드바에서 참조 음색 선택+"적용"이 필요하고, ②"저장"이 STEM1처럼 파일 다운로드가 아니라 새 완성곡으로 라이브러리에 저장됨(사용자가 AskUserQuestion으로 직접 선택: STEM1 방식 다운로드-전용이 아니라 "라이브러리 저장"을 선택).
- [x] 백엔드도 원샷 `convertVocalTimbre()`를 2단계로 분리: `applyVocalTimbre()`(참조 음색으로 변환해 STEM 폴더의 `vocals.wav`를 덮어씀 — 기존 `GET /stems/vocals` 라우트를 그대로 재사용할 수 있도록)와 `finalizeVocalTimbre()`(브라우저에서 합쳐진 최종 WAV를 받아 새 완성곡으로 저장). 분리 결과(보컬/반주)가 나온 뒤에 참조 음색을 바꿔 다시 "적용"하면, 이미 분리된 "변환 전 원본 보컬"(`vocals-original.wav`)을 재사용해 **보컬만 다시 변환**하고 STEM 분리(HTDemucs/Mel-Band RoFormer 호출)는 다시 하지 않음 — 반주 트랙에 이미 적용한 후처리도 그대로 유지됨.
- [x] **실기 검증**: 실제 완성곡("E0062-2 The World Behind the Curtain", 2분 11초)으로 새 편집기 종단 테스트 — 참조 음색 파일 선택→적용(보컬 분리+음색 변환, 약 130초)→보컬/악기 스템이 STEM1처럼 표시됨→보컬 스템의 "후처리" 버튼으로 중첩 EQ/FX 다이얼로그가 정상적으로 열리는 것 확인→재생 위치/파형 하이라이트 정상 동작 확인→"저장"으로 새 완성곡이 라이브러리에 추가됨(2:11 길이 정확히 일치)을 curl+ffprobe로 확인, 사용자에게 결과 파일 전달. 재적용 시 분리를 건너뛰는 로직은 백엔드 테스트로 정밀 검증(가짜 spawn 호출 단위로 확인).
- 관련 커밋 전 상태: 이전 원샷 방식으로 만든 완성곡 2개가 테스트 중 라이브러리에 남아있음(둘 다 "E0062-2 The World Behind the Curtain (음색 변환)") — 필요 없으면 라이브러리에서 직접 삭제 가능, 자동으로 지우지 않음.

## "보컬 음색 변환"을 STEM1 스타일에서 "원본 vs 결과" 비교로 다시 단순화 (2026-09-16, 같은 날 두 번째 재설계)

- [x] STEM1 스타일 편집기를 배포한 직후, 사용자가 "약간 다르게 이해했네"라며 실제로 원했던 그림을 구체적으로 설명 — 보컬/악기 분리를 화면에 보여줄 필요가 없었고(STEM1 UI를 빌려온 건 오해), 개별 트랙 후처리도 "저장 후 기존 후처리/EQ 메뉴로 따로 할 수 있으니 다이얼로그 안에 합치면 오히려 복잡해진다"는 판단으로 뺐음. 원한 것: 상단에 참조 음색을 고르는 파일 탐색기+적용 버튼, 그 아래엔 원본과 변경본을 비교해서 들을 수 있는 것뿐.
- [x] `VocalTimbreDialog`를 다시 크게 단순화 — 스템 리스트, 개별 "후처리"(중첩 `PostProcessDialog`), `mixBuffers`/`audioBufferToWavBlob` 클라이언트 믹싱을 전부 제거. 상단 바(제목+참조 파일 선택+적용하기)만 남기고, 적용하면 "원본"(이 곡의 기존 `/audio`를 그대로 디코드)과 "변경본"(서버가 보컬 분리→변환→반주 재합성까지 전부 끝낸 결과) 두 파형만 비교 재생.
- [x] 백엔드도 그만큼 단순해짐 — `applyVocalTimbre()`가 이제 STEM 폴더의 `vocals.wav`를 덮어쓰는 대신, 변환된 보컬과 반주를 ffmpeg `amix`로 서버에서 바로 합쳐 `result.wav`로 캐싱(새 라우트 `GET /vocal-timbre/result`로 서빙). "저장"도 더 이상 브라우저에서 합친 WAV를 업로드하지 않고, `POST /vocal-timbre/save`가 제목만 받아 캐싱된 `result.wav`를 그대로 새 완성곡으로 저장 — 오디오 재업로드가 없어져 더 가벼워짐.
- [x] **실기 검증**: 같은 2분 11초 완성곡으로 다시 종단 테스트 — 상단 바 레이아웃 확인→참조 음색 선택→적용하기(보컬 분리+변환+서버 재합성)→원본/변경본 두 파형만 나타나는 것 확인(스템 분리나 후처리 버튼 없음)→변경본 재생 확인(0:04/2:11 파형 하이라이트 정상)→저장→라이브러리에 새 곡 추가(2:11 길이 정확히 일치)를 curl+ffprobe로 확인, 결과 파일 전달. 백엔드 테스트도 새 흐름(적용→result 캐시 확인→재적용은 분리 스킵→저장은 캐시 소비→재저장은 400)으로 다시 작성해 14개 스위트 전부 통과.
- 설계 교훈: 사용자가 UI 참고점으로 "STEM1처럼"이라고 말해도, 그게 정확히 어떤 부분(전체 골격? 아니면 단지 재생/비교 UX?)을 가리키는지는 구체적인 레이아웃 스케치를 받기 전까진 확정하기 어려움 — 이번엔 먼저 구현하고 나서 사용자의 구체적인 스케치로 교정받았지만, 다음엔 레이아웃을 말로 먼저 한 번 더 확인하는 것도 방법.

## "보컬 음색 변환"을 STEM1 스타일로 원복 + 보컬이 안 들리던 실제 버그 수정 (2026-09-16, 같은 날 세 번째 재설계)

- [x] "원본 vs 결과" 단순화 버전을 배포한 뒤, 사용자가 RVC/Seed-VC 아키텍처(분리→변환→재합성)에 대한 설명을 듣고서 "그렇다면 이전 구조가 rvc의 플로우하고 맞았던거네... 이전구조로 원복하는게 좋겠어"라며 STEM1 스타일 편집기(두 번째 재설계)로 되돌려달라고 요청 — `VocalTimbreDialog`를 STEM1 스타일(스템 리스트+개별 후처리+combined-original/preview 비교+합치기/저장)로 복원, 백엔드도 `applyVocalTimbre()`/`finalizeVocalTimbre()`를 다시 STEM 폴더의 `vocals.wav`를 덮어쓰는 방식(+ `GET /vocal-timbre/result` 라우트 제거, `POST /vocal-timbre/save`를 다시 `{dataUrl, title}` 받도록)으로 되돌림.
- [x] **진짜 버그 발견 및 수정**: 같은 메시지에서 사용자가 "만들어진 것을 들으면 보컬이 아예 없어지고 악기만 남았어"라고 실제 버그를 제보. `ffmpeg -af volumedetect`로 직접 측정해 원인 확정 — Seed-VC가 변환한 보컬은 원본 보컬보다 평균 음량이 **7.6dB나 조용함**(원본 -26.4dB → 변환 후 -34.0dB, 반주는 -24.1dB)해서 합쳤을 때 보컬이 반주에 완전히 묻힘. 모노/스테레오 채널 레이아웃 불일치는 합성 사인파 테스트로 직접 검증해 원인에서 배제.
- [x] **수정**: `applyVocalTimbre()`에 새 `measureMeanVolumeDb()` 헬퍼로 변환 전/후 보컬의 평균 음량을 측정해 그 차이만큼(−6~+18dB로 clamp) `ffmpeg -af volume=XdB`로 보정 — 그런데 이 보정만으로는 새 문제 발생: Seed-VC 원본 출력이 이미 피크 -2.2dB 근처라 +7.6dB를 그대로 곱하면 풀스케일을 넘어 하드 클리핑됨(실측: 보정 후 max_volume이 정확히 0.0dB로 천장에 닿음). `alimiter=limit=0.97:level=false`(자동 레벨 보정을 꺼서 방금 준 게인을 되돌리지 않게 함)를 게인 뒤에 붙여 피크만 부드럽게 눌러 해결 — 최종 보컬 피크가 -0.3dB로 정상화됨.
- [x] **실측 검증**: 캐시된 실제 테스트 오디오로 수정 전/후 비교 — 게인만 적용 시 max_volume 0.0dB(클리핑), 게인+리미터 적용 시 mean -27.0dB(원본 -26.4dB와 거의 일치)·max -0.3dB(클리핑 없음). 실제 브라우저 종단 테스트로 재확인: 2분 11초 완성곡("E0062-2 The World Behind the Curtain")에 새 참조 음색 적용 → 저장된 결과물의 보컬 -23.8dB, 반주 -16.6dB, 합친 미리듣기 -19.3dB/최대 -0.6dB(클리핑 없음), 최종 라이브러리 저장본(FLAC)도 2:11 길이 그대로에 피크 클리핑 없이 정상 저장됨을 ffprobe+ffmpeg astats로 확인, 결과 파일 전달.
- [x] 백엔드 테스트를 STEM1 스타일 흐름(적용→`/stems/vocals`+`/stems/instrumental` 서빙 확인→재적용 시 분리 스킵→`volumedetect` 프로브 2회+게인·리미터 ffmpeg 호출 확인→저장은 dataUrl 업로드 방식)에 맞게 다시 작성, `makeFakeSpawn()`에 `volumedetect`(마지막 인자가 `-`인 null-출력 프로브) 전용 분기와 `setVolumeProbe()`를 추가해 실측과 같은 음량 차이(-26.4dB vs -34dB)를 기본값으로 재현 — 14개 스위트 전체 통과.
- 설계 교훈: 게인 보정만으로 음량을 맞추면 원본 신호의 피크 여유(헤드룸)를 무시하게 되어 새로운 하드 클리핑을 만들 수 있음 — 음량을 올릴 땐 항상 피크/리미터도 같이 고려해야 함.

## 실제 환경에서 검증 필요 (코드는 준비됐지만 종단 테스트 못 함)

- [ ] **"커버" 메뉴의 실제 생성까지 종단 검증**: ABC 추출과 설정 채우기까지는 확인했지만, 채워진 내용으로 실제 "노래 만들기"를 눌러 오디오까지 완성되는지는 아직 못 함(현재 실제 생성이 원인 불명 에러로 중간에 끊기는 별도 문제 있음).
- [ ] **"악기만" mute-voice 전환의 실제 오디오 검증**: 코드 수정과 유닛 테스트(가짜 spawn)는 통과했지만, 실제 원본(공식 Python) 엔진으로 생성해 Vocal 화음 기호가 남은 ABC가 실제로 화성이 유지된 무보컬 오디오를 만드는지는 아직 실기 검증 전.
- [ ] **ABC "파일에서 가져오기"**: JSON의 `abc` 필드 추출 / 일반 텍스트 폴백 로직은 코드 리뷰로만 검증했고, 실제 파일 업로드로 브라우저에서 종단 테스트는 아직 안 함.
- [ ] **File System Access API 미지원 브라우저**(Safari, Firefox 등)에서의 폴백 저장 경로 — 현재는 Chrome에서 `showSaveFilePicker`/`showOpenFilePicker`를 임시로 지워서 폴백을 강제 검증했을 뿐, 실제 비-Chromium 브라우저 테스트는 안 함.

## 알려진 제약 (설계상 의도이며 버그 아님)

- GGUF 모델(Q4/Q8/BF16)은 "악기만"을 구조적으로 보장할 수 없어, 만들기 화면에서 아예 선택하지 못하도록 막아둠(버튼 비활성화). 무보컬 생성을 원하면 "원본"(공식 Python) 모델을 선택해야 함 — `abc_tools.py mute-voice`로 보컬 성부를 화음 기호는 남긴 채 쉼표 처리하는 구조적 방식은 원본 모델 전용.
- ABC 악보(심볼릭 작곡, SheetSage2 커버 추출 결과 포함)도 GGUF에서는 생성에 전혀 반영되지 않음(2026-09-13 확인) — `backend/server.mjs`의 `runAudioCpp()`가 애초에 `--abc-file` 인자를 지원하지 않아, 그동안은 ABC를 채운 채 GGUF로 생성해도 조용히 무시되고 가사/스타일만으로 생성되는 함정이 있었음. "심볼릭 작곡"/"오디오에서 추출" 버튼을 GGUF 선택 시 비활성화하고, 백엔드 `/api/generate`에서도 GGUF+비어있지 않은 ABC 조합을 명확한 오류로 거부하도록 수정. 커버/심볼릭 작곡을 쓰려면 "원본" 모델을 선택해야 함.
- 후처리/EQ는 **브라우저 세션 내 실시간 미리듣기**(Web Audio API)이며, "저장" 버튼을 눌러야만 서버가 처리된 오디오를 원본과 같은 파일 형식으로 재인코딩해 저장함. 원본 곡 파일은 절대 바뀌지 않음.
- EQ 프리셋과 전체 설정 프리셋은 `SongYUE2/Setting/EQ-preset/`, `SongYUE2/Setting/PostProcess/`에 로컬 파일로만 저장됨 — 다른 PC로 옮기려면 해당 폴더를 직접 복사해야 하고, 자동 동기화 기능은 없음.

## 테스트 커버리지

- 백엔드: `node --test backend/server.test.mjs` — 14개 스위트 전체 통과(생성 파이프라인, 저장 포맷, 심볼릭 작곡/ABC 라이브러리, EQ·후처리 프리셋 저장 위치, ComfyUI 어댑터, AudioSR 복원/채널 분리, MuScriptor MIDI 내보내기, Seed-VC 보컬 음색 변환 등).
- 프론트엔드: 자동화 테스트 없음. 후처리/EQ 다이얼로그, EQ 프리셋, 전체 설정 프리셋, 서클 비주얼라이저는 chrome-devtools MCP로 실제 브라우저에서 수동 검증만 완료된 상태(재실행 가능한 자동 테스트는 아님).

## 향후 개선 아이디어 (필수 아님, 우선순위 낮음)

~~비주얼라이저 커스터마이즈~~ — 완료(2026-09-12). 설정 화면에 표시 켬/끔, 라인 모드(1: 회전/2: 시간축), 색조·라인 개수·굵기·변동폭·잔상·나선 정도·R 간격(회전 모드)·시간 간격·가속도(시간축 모드)까지 모두 설정 가능. `studio.tsx`의 하드코딩된 상수는 전부 설정값으로 교체됨.

- EQ 프리셋 / 전체 설정 프리셋 파일 내보내기·가져오기(다른 PC로 옮기기 쉽게) — 다이얼로그에 저장(POST)만 있고 내보내기/가져오기 버튼 없음 (Playwright로 2026-09-12 재확인, 여전히 미구현)

~~후처리 다이얼로그에 "전체 초기화" 버튼~~ — 애초 EQ/FX/리버브·에코를 한 번에 초기화하는 버튼으로 의도했으나, 실제로는 셋을 각각 초기화하는 버튼으로 구현되어 통합 버튼은 드롭하기로 결정. 각 섹션의 개별 초기화 버튼(`EQ 초기화`/`FX Sound 초기화`/`리버브/에코 초기화`)으로 충분하다고 판단.
