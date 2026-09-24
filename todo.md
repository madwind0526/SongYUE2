# TODO

## ▶ 진행 중 계획 (2026-09-24): AuK 완전 제거 + Audio Tools를 audio.cpp 기반으로 재구성

**결정 사항(사용자 확정)**
- **CosyVoice3는 품질이 좋지 않아 제거**(카탈로그·모델 파일·테스트). 이미 빌드된 exe에는 코드가 남아 있고 다음 재빌드부터 빠짐.
- **프리셋 탭**: Supertonic 3 + Qwen3 CustomVoice(화자 9, `--instruct` 스타일 지원) + MagpieTTS(화자 5), 목소리 선택 + 미리듣기(샘플을 한 번 생성해 `runs/preset-previews`에 캐시).
- **한국어를 지원하지 않는 모델은 카탈로그에서 제외하고, 이미 받은 파일은 삭제한다.**
- AuK(AudioAuK) 전면 제거. 음색 변조에서도 AuK 탭 제거. AuK의 Whisper는 audio.cpp의 음성 인식 모델로 대체(Qwen3-ASR 한국어 실측 정확).
- **음성 인식은 한 모델로 고정하지 않고 여러 모델을 선택 가능하게**, 모델이 없으면 앱에서 내려받을 수 있게 한다(TTS와 같은 방식).
- 음성 변환: Seed-VC/Vevo2/DDSP-SVC에 **RVC, MeanVC2 추가**.
- 음악 생성은 YuE2 유지(ACE-Step은 이전 평가에서 도움이 안 됐으므로 편집 기능도 pending).
- Audio Tools 메뉴 구성: TTS 생성 / 음성 인식 / 음성 조절 / **대사 편집(예정)** / **효과음 생성(예정)**. "음성 변형", "품질 개선", "가사/대사 편집(AuK)" 메뉴는 삭제.
- TTS 생성은 현재 모델(Qwen3-TTS/CosyVoice3/Chatterbox)에 **추가 모델을 옵션으로** 넣는다.
- 단어별 시간 정렬(Forced Aligner), 화자 분리, ACE-Step 편집은 **pending**(필요성 미정).

### 이미 끝난 것 (코드 반영됨, 커밋 전)
- [x] 포트 정리 + `C:\Claude\PORTS.md`. SongYUE2는 프론트 5176 / 백엔드 4311.
- [x] TTS 엔진 교체: `backend/tts.mjs`(모델 카탈로그·CLI 인자·문장 분할·이어받기 다운로드) + `/api/audio-tools/tts{,/models,/download}`. Qwen3(VoiceDesign/Base 0.6B·1.7B), CosyVoice3, Chatterbox를 모델·크기·정밀도로 선택. T2S 탭에서 CosyVoice3/Chatterbox는 Qwen3 VoiceDesign이 만든 참조 음성을 사용.
- [x] 음성 인식 탭: `/api/audio-tools/asr` (현재 Qwen3-ASR 0.6B/1.7B, q8_0/f16, 언어 지정). Qwen3 Base TTS의 참조 텍스트가 비어 있으면 자동 받아쓰기.
- [x] 음성 조절 탭: `/api/audio-tools/adjust` (ffmpeg rubberband 피치/속도, volume dB, afftdn 노이즈 줄이기).
- [x] AuK 제거(SongYUE2 안): `backend/auk.mjs` 삭제, 관련 라우트/설정/테스트/프론트 UI 제거, 백엔드 테스트 통과, tsc 통과. (git 히스토리에 남아 있음)
- [x] 엔진 재빌드: `engine/audio.cpp/run-build.ps1` (모델셋에 `qwen3_tts,cosyvoice3,chatterbox,qwen3_asr,qwen3_forced_aligner` 포함). 모델 다운로드: Qwen3-ASR-1.7B q8 설치됨.
- [x] 저장 버튼 = OS "다른 이름으로 저장" 창(File System Access API, 미지원 시 다운로드).

### 남은 일 (우선순위 순) — 각 단계의 상세 절차는 `progress.md` "다음 에이전트용 상세 계획" 참고

- [x] **P0. 마무리/정리** (완료 2026-09-24, 커밋 `6471683`): AuK 언급 정리(README/docs/memory-bank), `bench.mjs` 전사를 앱 ASR로 교체, `docs/audiocpp-setup.md`에 Audio Tools 모델 절차 추가, memory-bank flush. 화면 실확인·Typecast 유료 복제·VibeVoice-ASR은 사용자가 직접 확인함(더 할 일 없음). 남은 미커밋: EOL만 다른 `globals.css/layout.tsx/page.tsx/studio.css`(내용 변경 없음, 무시).
- [x] **P0-b. 음성 인식 다중 모델 선택 + 다운로드** (완료 2026-09-24): Qwen3-ASR(0.6B/1.7B) / Nemotron 3.5 ASR / Fun-ASR-Nano(ko 미지원) / VibeVoice-ASR(약 10GB)를 모델→크기→정밀도로 선택, 미설치는 "모델 받기". 엔진에 `nemotron_asr,fun_asr_nano,vibevoice_asr` 빌드 포함. 한국어 실측: Qwen3-ASR 1.7B가 가장 정확, Nemotron은 일부 오인식. 남은 것: VibeVoice-ASR/Fun-ASR 실제 다운로드 후 동작 확인(VibeVoice는 VRAM 10GB 필요), 모델별 CER 비교표를 test/ 에 기록
- [x] **P1. 음성 변환에 RVC·MeanVC2 추가** (완료 2026-09-24): 음색 변조 창에 RVC(내장 목소리 4개 default/manthos/chocola/fraise, 참조 audio 불필요, 음높이/검색 블렌딩 옵션)와 MeanVC2(참조 audio 제로샷, Q4/FP32) 추가, 미설치 시 "모델 받기". 한국어 음성으로 두 엔진 모두 내용 보존 확인(ASR 일치). RVC는 첫 실행 약 35초(모델 1.2GB 로드)라 긴 보컬도 청크 없이 한 번에 처리. **노래에서의 음질은 사용자 청취 평가 필요**(MeanVC2는 말소리용). **추가 완료**: RVC 목소리를 HuggingFace에서 검색·다운로드(`backend/rvcvoices.mjs`, `models/rvc-voices/<slug>/`)해 "내장 목소리" 목록에 추가(`user:<slug>`, `voice_model_path`, 호환 `.index`가 있으면 검색 블렌딩). 라이선스는 정보로만 표시(개인용). 남은 것: Seed-VC 대비 A/B 기록
- [x] **P2. TTS 추가 모델 옵션** (1차 완료 2026-09-24): VoxCPM2(design+ref, CER 0.000~0.017, 최고), OmniVoice(ref 전용, 참조 텍스트 자동 ASR) 추가. 한국어 미지원 모델은 제외 원칙. Supertonic 3 추가(프리셋 목소리 10개, 한/영/혼합 CER 0.000, 새 탭 "TTS (프리셋 목소리)"). Fish Audio S2 Pro INT8 추가·실측(한국어 CER 0.000, 혼합문 0.263, 생성 17~22초). 스타일 지시(선택) 입력칸을 CosyVoice3(instruct 템플릿)·VoxCPM2("(style)text")에 추가, 나머지 모델은 비활성. 미확인: Fish 스타일 태그 문법, Qwen3 CustomVoice(--instruct). IndexTTS2는 한국어 미표기라 제외. 남은 후보(선택): FireRedTTS3 — 필요 시 같은 절차(빌드 목록 추가→다운로드→`bench2.mjs`→`TTS_FAMILIES` 등록)로 추가
- [x] **Typecast(클라우드 TTS) 추가** (2026-09-24): TTS 모델 버튼 "Typecast (클라우드)". T2S=추천 API로 목소리 자동 선택(실측 정확), Ref-T2S=즉시 복제(현재 요금제는 복제 불가: CLONING_NOT_AVAILABLE, 유료 플랜에서 재확인 필요). 키는 `.env`의 TYPECAST_API_KEY.
- [x] **MeanVC2를 Audio Tools "음색 변조" 카테고리로 이동** (2026-09-24): MeanVC2는 말소리용(노래는 깨짐)이라 음색 변조(곡) 창에서 제거하고, Audio Tools에 새 카테고리 "음색 변조" 추가(`POST /api/audio-tools/vc`). 원본은 파일/라이브러리/**마이크 녹음**(입력 장치 선택, 녹음·일시정지·정지, 정지하면 원본 파형으로), 참조 음성(목표 목소리)은 파일/라이브러리, 실행하면 결과 파형·재생·저장. 보컬 전체를 조각 없이 한 번에 변환(조각 방식이 오류율 0.134 vs 통째 0.071로 더 나빴음).
- [x] **P5. 실시간 스트리밍 음색 변조** (완료 2026-09-24): 음색 변조 탭의 '실시간 변환' — MeanVC2 스트리밍(CLI stdin PCM + 엔진 패치 `docs/patches/audiocpp-cli-stream-audio-chunks.patch`), 서버 세션 `/api/realtime-vc/*`(start/audio/events(SSE)/stop), 마이크→재생 지연 약 0.3~0.4 s, 정지하면 원본·처리본이 남아 저장 가능. 별도 audiocpp_server 빌드는 필요 없었음. 남은 것: 실제 마이크·헤드폰으로 체감 확인, 출력 장치 선택, 지연/끊김 지표 개선
- [x] **P3. 대사 편집 탭** (완료 2026-09-24): DotTTS Edit(Q8/BF16) 탭 구현 — 원문(STT 자동), 바꾸기/지우기/앞·뒤 넣기, '모두', 언어 선택. Vevo2 편집(en/zh만)·FireRedTTS3(한국어 편집 불가, 영어만 정확)는 제외. **개선 완료**: 무음 기준 문장 분할 편집 + 단어 단위 정밀 편집(Qwen3 Forced Aligner, 편집 단어 구간만 교체)
- [x] **P4. 효과음 생성 탭** (완료 2026-09-24): Stable Audio 3 Small SFX(Q8/F16) — 영어 설명, 길이 1~30초, 생성 단계, 시드, 빼고 싶은 소리. ControlFoley(영상 동기 효과음)는 넣지 않음. 남은 것: 한국어 설명을 영어로 자동 번역(LLM 연동) 검토
- [ ] **Pending(필요성 판단 후)**: 단어별 시간 정렬(Qwen3-ForcedAligner: 가사 싱크·LRC/SRT·편집 앵커), 화자 분리(Sortformer, 영어 4인 한정), 무음 검출(Silero VAD), ACE-Step 편집(repaint/lego/extract/complete), 음성 인식 결과의 SRT/LRC 저장

### 질문에 대한 정리 (2026-09-24)
- **ACE-Step "편집" 기능** = `complete`(이어 쓰기/완성), `lego`(원곡에 새 악기 레이어 추가), `extract`(보컬·악기 등 트랙 추출), `cover`(스타일 변환 커버), `repaint`(시간 구간을 새로 생성해 교체). 이전 평가(`test/vocal-timbre-engine-comparison/README.md`)에서 cover 품질이 기대에 못 미쳤고 ACE 자체 생성 품질이 YuE2보다 낮아 pending. 그나마 쓸모 있는 후보는 곡의 특정 구간만 갈아끼우는 `repaint`와 stem 추출 `extract`(이미 HTDemucs/RoFormer가 있음).
- **Whisper vs Sortformer**: 둘은 목적이 다르다. Whisper(OpenAI 제작)는 음성→텍스트이고 화자 분리 기능이 없다(보통 pyannote 등과 조합). Sortformer(NVIDIA)는 "누가 언제 말했나"만 구하는 화자 분리 모델로 최대 4명, 영어 위주 학습이라 한국어 성능은 미검증. 이 앱은 대화 녹음보다 노래/TTS가 중심이라 우선순위 낮음 → pending.
- **단어별 시간 정렬** = 오디오와 "정확한 텍스트"를 주면 각 단어의 시작/끝 시간을 계산해 주는 기능(Qwen3-ForcedAligner, 음성 인식과 결합 시 `--words-out words.json`). 용도: 가사 싱크(LRC)·자막(SRT)·특정 단어 구간 잘라내기/교체. 필요성 확정 전까지 pending.

하기로 했지만 아직 진행하지 못한 일들. (2026-09-19 기준)

## 현재까지 결론 (2026-09-19): 쓸 만한 접근은 2가지로 좁혀짐

이번 세션에서 시도한 여러 대안(ACE-Step 커버, ACE-Step+LoRA, DDSP-SVC, AuK 재생성)을 사용자가 직접 들어본 결과:

1. **DDSP-SVC로 변환한 것** — 지금까지 중 제일 낫지만 음색이 "좁다"(전문 가수 대비 일반인 같은 느낌)는 소견.
2. **AuK로 대상 audio profile을 써서 곡을 다시 생성한 것** — 원곡을 그대로 유지하면서 목소리만 바꾸는 방식은 아니지만(레퍼런스 오디오의 음색을 유지하며 곡을 새로 생성하는 방식), 그 나름대로 의미 있는 결과.

**ACE-Step+LoRA는 여기서 접기로 결론남**: 학습·생성 자체는 기술적으로 성공했지만(500epoch 학습 완료, `ACESTEP_OFFLOAD_DIT_TO_CPU=1`로 생성 버그도 해결, 실제 한국어 가사로 생성 검증까지 완료 — 상세는 `memory-bank/knowledge/trouble-shooting.md`), 이걸 실제로 쓰려면 YuE2에는 LoRA를 넣을 자리 자체가 없어서(`backend/`, YuE2 소스, `model_specs/yue2.json` 확인함) ACE-Step을 정식 생성 엔진으로 통째로 바꿔야 하는데, ACE-Step 자체 생성 품질이 YuE2보다 낮다고 이미 이번 세션에서 확인된 상태라 그 방향은 부적합. 결과물(`test/vocal-timbre-engine-comparison/audio/ace-step-lora-jisu-test.wav`, `ace-step-lora-jisu-lyrics-test.wav`)은 참고용으로만 남겨둠.

## 완료 (2026-09-19): "음색 변조 (실험적)" 통합 팝업

사이드바에 "음원 복원" 아래로 새 메뉴 "음색 변조 (실험적)" 신설 — 곡 카드 "..." 메뉴의 옛 "보컬 음색 변환"은 제거하고 이 팝업의 "기존 방식" 탭으로 흡수. 팝업은 곡 선택 → 왼쪽 세로 탭(기존 방식=Seed-VC/Vevo2, AuK, DDSP-SVC) → 각 탭 입력 → 공용 원본/결과 비교(CompareWaveform/CompareSpectrogram)+저장 구조.

- **기존 방식**: 옛 `VocalTimbreDialog` 로직 그대로(`LegacyTabPanel`), 새 라우트 없음.
- **AuK**: 새 `backend/auk.mjs`+`POST /projects/:id/timbre-auk/apply`. AudioAuK(`C:\Claude\AudioAuK`, 포트 4312 자체 API) 연동, 학습 없이 단발 변환. **레퍼런스 오디오/텍스트 설명 조합에 따라 3가지로 분기**(레퍼런스만=AuK Whisper로 소스 가사 전사 후 그 목소리로 clone, 텍스트만=change-timbre, 둘 다=clone+스타일 수식어) — AuK의 오디오 입력 슬롯이 1개뿐이라 "소스+레퍼런스 동시 조건"이 원래 불가능하다는 걸 실제 ComfyUI 노드 그래프 읽고 확인한 뒤 설계함. Flash/Base 체크포인트 선택 가능. 30초 초과 곡은 경고만(차단 안 함, 실측상 AuK가 긴 오디오에서 노이즈로 무너지는 문제가 있음).
- **DDSP-SVC**: 새 `backend/ddsp-svc.mjs`+`POST /projects/:id/timbre-ddsp/start`(즉시 jobId 반환, 백그라운드 진행)+`GET /api/ddsp-jobs`+`POST /api/ddsp-jobs/:id/cancel`. 여러 레퍼런스 클립으로 실제 학습(기본 40k스텝, 사용자가 조절 가능) 후 그 체크포인트로 변환. **목표 스텝 도달 시 학습 프로세스를 실제로 죽이는 메커니즘을 이번에 제대로 구현**(이전 세션의 ~4시간 방치 사고 재발 방지 — stdout에서 스텝 번호를 파싱하는 바로 그 자리에서 동기적으로 kill), 백엔드 테스트로 검증 완료(500까지 갈 수 있는 걸 목표 200에서 정확히 멈추는지 확인). 새 다중 선택 컴포넌트(`MultiFileLibraryPicker`)로 레퍼런스 여러 개 선택. 다이얼로그를 닫아도 학습이 계속되고(App 최상위에서 job 추적), 완료/실패 시 토스트 알림.
- Seed-VC/Vevo2/AuK/DDSP-SVC 넷 다 같은 공용 후처리 체인(`postProcessConvertedVocal()`, 게인보정+리미터+사이드체인게이트) 재사용.
- 백엔드 테스트 20개 전부 통과(AuK 3가지 분기 검증 1개, DDSP-SVC 킬 메커니즘 검증 1개 포함), 타입체크 통과, 실제 브라우저로 사이드바→곡 선택→3개 탭 전환→다중 파일 선택기까지 종단 확인.

**실기 검증 완료(2026-09-19)**: AuK 탭 실제 변환, DDSP-SVC 탭 실제 학습(체크포인트 버그 발견·수정 포함) 모두 실제 AudioAuK/GPU로 돌려서 확인함 — 상세는 아래 "완료: 실기 검증 + DDSP-SVC 체크포인트 버그" 항목 참고.

## 완료 (2026-09-19): "오디오 도구 (실험적)" 페이지 — 옛 "Tools" 아이디어 구현

사이드바 "음색 변조" 아래에 새 페이지 "오디오 도구 (실험적)" 신설. AudioAuK ComfyUI 노드의 `TASKS` 딕셔너리(`nodes.py`, 총 26개 지시문 템플릿)를 직접 읽어서, 완성곡 맥락이 필요 없고 기존 기능(음원 복원=AudioSR, STEM 분리)과 안 겹치는 **21개**를 5개 카테고리로 추려 구현:

- **TTS 생성**(2): 설명으로 TTS 생성(오디오 불필요), 목소리 복제 TTS(레퍼런스 필요).
- **가사/대사 편집**(4): 교체/삽입(앞·뒤)/삭제.
- **음성 특성 조절**(6): 피치 올리기·내리기, 속도, 음량 올리기·내리기, 감정 바꾸기.
- **음성 변형**(5): 속삭임 변환(양방향), 억양 제거, 비언어음 추가·제거.
- **품질 개선**(4, 사용자 요청으로 포함): 음성 향상(종합)/노이즈만/잔향만 제거/음질 결함 복구 — 기존 "음원 복원"(AudioSR)과 다른 별도 엔진(AuK) 경로로 나란히 존재.

**"Change timbre"/화자 분리 계열(Separate speaker/Extract singing/Keep human voices/Extract target speaker) 4개는 제외**: 전자는 "음색 변조" AuK 탭과 중복, 후자는 "STEM 분리"와 중복.

구현: `backend/auk.mjs`에 `submitAukToolJob()`(음색 변조용 `submitAukJob()`과 로직 공유, `runAukJob()`으로 제출-폴링-회수 부분 추출) + `backend/server.mjs`에 `POST /api/audio-tools/auk`(완성곡과 무관, `/api/audio-save`처럼 독립 라우트, 결과는 dataUrl로만 반환하고 저장은 별도) 신설. 프론트는 `AUK_TOOLS`(21개 도구 설정 배열, 카테고리·필드·지시문 템플릿 함수)+`AudioToolsPage`(카테고리→도구→동적 필드→실행→결과 미리듣기+저장). 백엔드 테스트 20→21개(텍스트 전용/오디오+지시문 두 경로 검증), 타입체크 통과, 실제 브라우저로 5개 카테고리+21개 도구 전부 렌더링·필드 전환 확인(실제 AudioAuK 호출까지는 미검증 — 아래 항목).

## 완료 (2026-09-19): "음색 변조"/"오디오 도구" 실기 검증 + DDSP-SVC 체크포인트 버그 발견·수정

AuK 탭(레퍼런스만/텍스트만 2가지 분기)과 오디오 도구 페이지(5개 카테고리 전체)는 실제 AudioAuK(온디맨드 기동 포함, 실제 Whisper 전사까지)로 브라우저 종단 검증 완료 — `seconds` 필드 누락으로 TTS 전용 도구가 502 나던 실제 버그 1개 발견·수정(`AudioToolsPage`에 길이(초) 입력 필드 추가).

DDSP-SVC 탭은 실제 GPU로 목표 스텝을 작게 잡아(`targetStep: 300`) 학습을 돌려 **진짜 버그를 하나 더 발견**: kill-at-target 메커니즘 자체는 정상 작동(300 목표에서 347까지 진행 후 정상 종료)했지만, 그다음 "체크포인트를 찾지 못했습니다"로 실패. 원인은 `configs/reflow.yaml` 템플릿의 `interval_val: 2000`(체크포인트는 2000스텝마다만 저장됨) — `targetStep`이 2000보다 작으면 kill이 일어날 때까지 체크포인트가 단 한 번도 저장되지 않아 `latestCheckpoint()`가 항상 빈 손으로 실패하는 구조적 결함. 기존 mock 테스트(`stepsPerCheckpoint: 50`이라는 인위적 값)는 이 실제 저장 주기(2000/10000)를 반영하지 않아서 못 잡았던 문제 — **실기 검증이 아니었으면 발견 못 했을 버그**.

수정: `backend/ddsp-svc.mjs`의 `startDdspJob()`에서 `interval_val`을 `targetStep`에 비례해 축소(`Math.max(10, Math.min(2000, Math.floor(targetStep / 4)))`, 기본 규모(40000+)에서는 캡에 걸려 기존 2000 그대로) 패치하도록 추가. 같은 프로젝트로 실제 재학습(step 300)을 재실행해 체크포인트 저장→추론→후처리→`stems/vocals.wav` 반영까지 전부 성공 확인(변환된 보컬 `volumedetect` mean -23dB/max -4.6dB로 무음 아님도 확인). 백엔드 테스트도 실제 저장 주기를 반영하도록 `makeFakeDdspSpawn`을 config의 `interval_val`을 읽어 그 배수에서만 체크포인트를 쓰도록 재작성하고, 작은 `targetStep`(15→내부 clamp로 100)으로도 완주하는 회귀 테스트 추가(21개 테스트 전부 통과). 이 과정에서 테스트 mock 자체의 별도 버그(`killCount`가 mock 인스턴스 전체에 공유되어 두 번째 학습 job이 첫 번째 job의 kill 카운트를 보고 즉시 멈춰버리는 문제)도 같이 발견·수정.

- **"오디오 도구" 나머지 세부 도구들(21개 중 검증한 것 외)**: 카테고리당 1개씩만 실기 확인했으므로, 나머지 도구들도 필요시 추가로 실측해볼 것(우선순위 낮음 — 이미 같은 백엔드 경로를 공유하므로 구조적 리스크는 낮음).
- **완료(2026-09-19~20): DDSP-SVC 품질 개선 실험 4종 전부 실측, 종합 결론: 어느 레버도 "음색이 좁다" 문제를 뚜렷이 개선 못함**. 상세·수치·스펙트로그램은 `test/vocal-timbre-engine-comparison/README.md`의 "DDSP-SVC 품질 개선 실험" 절 참고.
  - **Pitch extractor**: rmvpe(현재 기본값)/crepe/fcpe/dio/harvest/parselmouth 전부 실측(기존 100k스텝 체크포인트로 추론만 재실행, 재학습 불필요) — flatness 스프레드가 0.117~0.125로 매우 좁아 원인이 아닌 것으로 결론.
  - **Vocoder**: `pretrain/`에 이미 받아져 있었지만 미사용이던 `pc_nsf_hifigan_44.1k_hop512_128bin_2025.02`로 교체 실측(추론만 재실행) — flatness로는 차이 없음.
  - **Feature encoder(ContentVec↔HubertSoft)**: 유일하게 재학습이 필요했던 항목 — 동일 81클립 데이터셋·동일 하이퍼파라미터로 HubertSoft를 100k스텝까지 실제로 재학습해(~3시간) 기존 ContentVec 40k/70k/100k 체크포인트와 직접 비교. **결과: 세 지점 모두 ContentVec이 HubertSoft보다 원곡에 더 가까웠음** — 가설과 반대 방향, HubertSoft로 바꿀 이득 없음.
  - **데이터셋 크기 확대**: 실행 불가로 결론 — 현재 81클립은 `library/Audio-Ref/지수-01~04` 4개 파일이 전부이고 같은 목소리의 추가 레퍼런스가 프로젝트에 더는 없음.
  - **종합 결론**: "음색이 좁다"는 소견의 원인은 이 4가지 파라미터가 아니라 데이터셋 크기(81클립/12분, 단일 화자) 자체의 한계일 가능성이 높음 — 검증하려면 사용자가 같은 목소리의 추가 레퍼런스 클립을 확보해야 함.
  - 실측 비교는 지금까지 써온 방식대로(스펙트럴 플랫니스 + 실제 청취 + `test/vocal-timbre-engine-comparison/`에 결과 저장) 진행.
- **완료(2026-09-19): GGUF에서 "악기만" 구간 만들기 실험 — 부분적으로만 성공, 신뢰 불가로 결론**. `[Verse]`/`[Chorus]` 등 구조 태그만 넣고 실제 가사는 비운 채 GGUF(`yue2-q4`)로 실제 생성(172.8초) → Mel-Band RoFormer로 보컬 스템만 분리해 스펙트로그램으로 검증. 결과: 약 40%(70초)는 진짜 무보컬로 나왔지만 나머지 55%(93초)는 가사 없이도 모델이 뚜렷한 보컬 배음 패턴으로 뭔가를 불러버림 — "가사를 비우면 항상 무보컬"이라는 가설은 기각. 확실한 무보컬이 필요하면 여전히 원본 Python 엔진의 "악기만" 토글이 유일한 검증된 방법. 상세·오디오·스펙트로그램: `test/gguf-instrumental-lyrics-experiment/README.md`.
- **완료(2026-09-19): 설정 저장 버그 수정**. 처음엔 프론트(`storeSettings()`)만 문제라고 오판했는데, 실제 원인은 백엔드 `publicSettings()`(HTTP 응답 허용목록)에 `comfyUiEndpoint`/`comfyUiEnginePath`가 원래부터 빠져 있었던 것(사전 버그)과, `saveJson()`(디스크 저장 허용목록)에 이번에 추가한 `audioAukEndpoint`/`audioAukPath`/`ddspSvcPath`가 빠져 있었던 것(이번 세션에 내가 만든 버그) 2가지가 겹쳐 있었음 — 둘 다 고침. 이 프로젝트의 설정 시스템은 필드 하나를 추가하려면 4곳(초기화, PUT 파싱, 디스크 저장, HTTP 응답 허용목록)을 전부 손대야 하는 구조라 이런 누락이 재발하기 쉬움 — 회귀 테스트(5개 필드 PUT→GET→서버 재시작 후 재확인) 추가함.

## 사용자가 제안했지만 아직 구현 안 한 UI/기능 개선

- **STEM 분리 시작 전에 분리 모델을 고를 수 있게 하기**: 현재는 모드(`STEM_MODES`)마다 모델이 고정(예: "보컬/악기"→Mel-Band RoFormer, "보컬/드럼/베이스/기타"→HTDemucs)인데, 분리를 시작하기 전에 사용자가 직접 모델을 선택할 수 있게(지금 쓰는 것 + 앞으로 추가될 수 있는 Demucs 계열 등 몇 개 중에서) 하면 좋겠다는 제안. 참고로 Remiqora 조사 중 확인한 바로는 Demucs 자체엔 6스템(기타/피아노 추가) 모델(`htdemucs_6s`)이 있지만, audio.cpp의 모델 저장소엔 표준 4스템 GGUF만 있어서 6스템을 쓰려면 별도 독립 Python Demucs 설치가 필요함.

## 이전부터 밀려 있던 항목 (memory-bank/active-context.md에서 이관)

- **완료(2026-09-20): DDSP-SVC 결과 caveat 문서화**. `test/vocal-timbre-engine-comparison/README.md`에 "DDSP-SVC 품질 개선 실험" 절로 정리 완료 — 작은 학습셋(81클립) caveat, pitch extractor/vocoder/feature encoder 비교, 종합 결론(데이터셋 크기가 근본 한계일 가능성) 전부 포함.
- **완료(2026-09-20): "커버" 메뉴로 채운 내용으로 실제 "노래 만들기" 완주 종단 검증 — 재현 안 됨, 정상 작동 확인**. 실제 완성곡을 `/cover-transcribe`로 멜로디 추출(SheetSage2) → ABC를 담아 GGUF(`yue2-q4`) 초안 생성 → `/generate` 직접 호출까지 API 레벨로 재현했으나 에러 없이 정상 완주(103.9초, RTF 0.256, volumedetect로 정상 음량 확인). "원인 불명 에러로 중간에 끊긴다"던 이전 기록은 이후 다른 세션들의 GGUF/ABC 관련 수정(`--request-option abc_file` 경로 등)으로 이미 해결된 것으로 보임 — 더 이상 막혀 있지 않음.
- **완료(2026-09-20): ABC "파일에서 가져오기" 브라우저 종단 검증**. 실제 `.abc`(순수 텍스트) 파일과 `{abc: "..."}` 형태의 JSON 파일 둘 다 실제 파일 업로드로 테스트 — 두 경로 모두 정상 동작(텍스트는 그대로, JSON은 `abc` 필드를 추출), 토스트 알림도 정상 표시. `handleAbcImportFile()`은 순수 클라이언트 로직(백엔드 호출 없음)이라 실패 위험이 애초에 낮았음.
- **File System Access API 미지원 브라우저(Safari, Firefox 등) 폴백 저장 경로**: Chrome에서 강제로 폴백을 유도해 검증했을 뿐, 실제 비-Chromium 브라우저 테스트는 안 함 — 이 환경에 비-Chromium 브라우저가 없어 계속 보류.
- **프론트엔드 자동화 테스트 없음**: 지금까지 전부 수동 브라우저 검증(Playwright로 실기 확인)만 하고 있음 — 회귀 테스트 스위트는 없음. 큰 신규 이니셔티브라 별도 논의 필요.
- **완료(2026-09-20): EQ/전체 설정 프리셋 내보내기·가져오기**. "후처리 / EQ" 다이얼로그의 "전체 설정" 영역에 내보내기(⬇)/가져오기(📁) 버튼 추가. 기존 `/api/eq-presets`·`/api/postprocess-settings` POST/GET/DELETE 라우트를 그대로 재사용(백엔드 변경 없음, 프론트 전용 구현) — 내보내기는 저장된 EQ/전체설정 프리셋 전부를 JSON 하나로 묶어 `showSaveFilePicker`(지원 시)/`<a download>`(폴백) 저장, 가져오기는 파일을 읽어 각 프리셋을 기존 저장 라우트로 재전송. 실제 브라우저로 저장→내보내기→서버에서 삭제→가져오기→서버에 복원까지 종단 검증(폴백 경로 포함), 타입체크·백엔드 테스트(21개) 통과.

## "DDSP Func" 팝업 — SVC 외 DDSP-SVC 부가 기능 검토 (UI화는 여전히 보류, 내용은 위 항목에 흡수됨)

사용자 제안: "DDSP-SVC가 지원하는 기능을 따로 package로 만들어서 제공할 수 있을까? 음원복원 아래에 DDSP Func 버튼을 추가하고... pop-up 창에서 위에 메뉴 tab이 있고 tab을 누르면 각각 위의 기능을 평가해볼 수 있는... SVC는 지금처럼 오디오의... 안에 음색 변경에 따로 두고 SVC를 제외한 다른 기능들을 평가해볼 수 있는.. encoder, extractor, vocoder등을 선택할 수 있어야 하고". DDSP-SVC README 기준 SVC 외 기능(위 "DDSP-SVC 품질 개선" 항목에서 encoder/extractor/vocoder는 이미 다루고 있음, 여기 나머지는 아직 안 다룸):

- **실시간 변환**: `gui_reflow.py` — 슬라이딩 윈도우+크로스페이드+SOLA 접합 기반 저지연 실시간 보이스 체인저.
- **음색 믹싱**: `-mix "{1:0.5, 2:0.5}"`처럼 여러 화자 음색을 비율대로 섞기.
- **다중 화자 학습**: `n_spk`로 화자별 폴더를 나눠 한 모델에 여러 목소리 학습(현재는 단일 화자 모드만 사용).

이 팝업 UI 자체는 여전히 만들지 않고 보류(DDSP-SVC를 실제 SVC 엔진으로 채택하기로 확정될 때 같이 설계) — 지금은 CLI로 직접 encoder/extractor/vocoder 조합만 실측 비교하는 단계.

## audio.cpp에 이미 있지만 SongYUE2가 아직 안 쓰는 모델군 검토

`engine/audio.cpp/model_specs/`를 직접 확인한 결과(60여 개 모델군 중 TTS/ASR 계열 제외, 음악 제작과 관련 있는 것만), 검토해볼 만한 후보:

- **Stable Audio** (`stable_audio.json`, `status: supported`): 텍스트→음악 생성 + audio-to-audio 편집/인페인팅(구간 다시 채우기)/컨티뉴에이션(곡 이어붙이기)/가변 길이 생성/LoRA 개인화까지 지원. 특히 **인페인팅·컨티뉴에이션은 SongYUE2에 지금 없는 기능**이라 "곡의 일부 구간만 다시 만들기"/"곡 뒷부분 이어서 만들기" 같은 새 메뉴로 발전시킬 여지가 있음. 아직 한 번도 안 받아봤고 평가 안 함.
- **ACE-Step 1.5 네이티브 GGUF 경로** (`ace_step.json`, `status: supported`): audio.cpp 자체가 ACE-Step을 GGUF로 이미 지원하고 cover/repainting(부분 재생성)/continuation/stem extraction/vocal-to-BGM 변환 라우트까지 내장. 지금 LoRA 실험은 별도 독립 Python FastAPI 서버(`test/ACE-Step-1.5`)로 하고 있는데, LoRA 학습이 아닌 **순수 추론만 필요할 때는 audio.cpp의 이 경로가 더 가벼울 수 있음** — GGUF가 LoRA/LoKr 어댑터 로딩을 지원하는지는 미확인.
- **RVC** (`rvc.json`, `status: experimental`): Seed-VC 도입 당시 "내장 음색 4개 중 선택만 가능"이라 후순위로 미뤘는데, 실제 spec 설명을 다시 보니 **사용자가 직접 만든 RVC 체크포인트(`.pth`/`.pt`)도 지정해서 쓸 수 있다고 되어 있음**(패키지 음색 4개로 제한된다는 건 재확인 필요) — Seed-VC/Vevo2/DDSP-SVC와 나란히 4번째 SVC 후보로 재평가해볼 가치가 있음.

이 셋은 아직 아무도 실제로 받아서 검증한 적 없는 "발견만 된" 후보 목록 — 실제로 쓸지는 다운로드/실측 후 판단 필요.

## 정리 (2026-09-25)
- [x] 음색 변조에서 Seed-VC/Vevo 제거(코드·테스트·문서·모델 파일). 곡 보컬 변환 엔진은 RVC와 DDSP-SVC.
- [x] STT는 Qwen3-ASR, Nemotron 남기고 VibeVoice-ASR 삭제, TTS는 Qwen3-TTS/VoxCPM2 남기고 OmniVoice/Fish/Chatterbox 삭제. 지운 모델의 버튼은 남기고 선택하면 "모델 받기" 안내. STT 실측(합성 한국어 9클립): Nemotron CER 0.000 · Qwen3 1.7B 0.003 · Qwen3 0.6B 0.018 · VibeVoice 0.097(7~17배 느림).
- [x] YuE2 Q4/BF16(+F32 VAE) 삭제, 기본 모델을 Q8로 변경, 모델 목록은 디스크 실재 기준.
- [ ] 결정 대기: 원본 Python 모델(7.3GB)은 "악기만"/ABC 기능에 필요 — 그 기능을 안 쓰면 삭제 가능.
- [x] `C:\Claude\AudioAUK` 프로젝트 전체 삭제(2026-09-25, 42GB). 실행 중이던 서버(5174/4312/8189)를 끄고 지웠으며 포트는 `C:\Claude\PORTS.md`에 반환. 참고: Whisper 가상환경 `.venv-whisperx`는 AudioAuK가 아니라 `C:\Claude\MeetingNote` 소유라 그대로 남아 있음.
- [x] `test/ACE-Step-1.5`(ACE 저장소 복제, `lora-data/` 포함) 삭제 완료(2026-09-25, 사용하지 않음).
