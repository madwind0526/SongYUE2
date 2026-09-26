# YuE2 모델 보관 및 재다운로드

실제 다운로드 상태는 프로젝트 루트의 `model-download-status.json`에 기록됩니다. `complete`인 파일만 크기 및 SHA-256 검증을 통과했습니다. `models/` 안의 `.part` 파일은 다운로드 중이며 설치 완료로 취급하지 않습니다.

**2026-09-12 03:41:57 KST: 46개 파일, 23,314,925,299 바이트 다운로드 및 SHA-256 검증 완료.** 공식 main/VAE/legacy VAE와 GGUF Q4/Q8/BF16/F16 VAE/F32 VAE가 모두 포함됩니다. Windows Defender 실시간 보호 활성 상태에서 다운로드했고, 공식 main의 Python 코드 및 wheel이 들어 있는 폴더를 사용자 지정 검사했습니다. 검사 명령은 정상 종료했고 이후 위협 탐지 조회 결과는 없었습니다. 이 검사는 모델 추론이나 코드 안전성의 완전한 보증은 아닙니다.

**2026-09-14: STEM 분리(완성곡의 보컬/드럼/베이스/기타 악기 분리)용 HTDemucs Q8_0 GGUF(61,940,768 바이트) 추가.** `audio-cpp/audio.cpp-gguf`는 60개 이상의 무관한 모델 패밀리를 한 저장소에 같이 담고 있어서, 전체 스냅샷 대신 `REPOS`에 `prefix: "HTDemucs-GGUF/htdemucs-q8_0.gguf"`를 지정해 그 파일 하나만 받도록 `scripts/download_models.py`를 확장했습니다(리비전은 `6d5436fc85f7a20c2e9f4e472b7f3a532f686444`로 고정). 총 다운로드 대상이 **23,376,866,067 바이트 (약 23.38 GB / 21.77 GiB)** 로 늘었습니다.

**2026-09-14 (이어서): BS-RoFormer ep368 Q8_0 GGUF(172,532,256 바이트) 추가.** 사용자가 직접 HTDemucs 결과를 들어보고 "보컬에 악기가 섞이고 보컬 일부가 사라진다"고 지적해서 원인을 조사한 결과, audio.cpp의 HTDemucs 구현이 고품질 앙상블("bag"/공식 ft) 체크포인트를 지원하지 않음을 소스에서 확인(`src/models/demucs/assets.cpp`: `"HTDemucs package-spec loader currently supports only single-model manifests"`)했고, 대신 다른 아키텍처라 이 제약이 없는 BS-RoFormer를 보컬/악기 2갈래 분리 모드로 추가했습니다. `REPOS`의 `prefixes`를 리스트로 바꿔 같은 저장소에서 두 파일을 모두 받도록 확장(`["HTDemucs-GGUF/htdemucs-q8_0.gguf", "BS-RoFormer-ep368-GGUF/bs-roformer-ep368-q8_0.gguf"]`). 총 다운로드 대상이 **23,549,398,323 바이트 (약 23.55 GB / 21.93 GiB)** 로 늘었습니다. `num_overlap`(bs_roformer)을 기본값 4보다 올리면 더 나을지도 확인했으나, 프로젝트 자체 벤치마크(`tests/bs_roformer/README.md`)가 4를 "정식 기준치"로 명시하고 그보다 낮출 때만 코사인 유사도가 실측으로 떨어짐을 보여줘서(더 높일 때의 개선 근거는 없음) 기본값을 그대로 둠. bs_roformer GGUF는 "legacy model spec"을 내장하고 있어 `model_specs/bs_roformer.json`으로 보충해야 하는데, 백엔드가 `audiocpp_cli`를 항상 audio.cpp 소스 루트를 작업 디렉터리로 실행하도록 고쳐서(이전엔 프로젝트 루트가 작업 디렉터리였음) 이 조회가 되게 함 — yue2/htdemucs는 이 문제가 없었지만(GGUF에 완전한 스펙이 내장됨) 일관성을 위해 모든 `audiocpp_cli` 호출에 적용.

**2026-09-16 (이어서): "MIDI로 내보내기" 기능용 MuScriptor GGUF(411,908,672 바이트, f32 단일 정밀도) 추가.** 완성곡을 audio.cpp의 MuScriptor(`--task midi`)로 표준 MIDI 파일로 변환하는 기능. `REPOS`의 `prefixes`에 `"MuScriptor-Small-GGUF/muscriptor-small-f32.gguf"`를 추가해 받음. `model_specs/muscriptor.json`에 `"status": "supported"`(AudioSR과 달리 실험적 아님)로 표시되어 있고, 실측도 이를 뒷받침 — RTX 5070에서 30초 클립을 0.7초에 처리(RTF ≈ 0.024, 실시간의 42배), 실제 완성곡으로도 5.7초 만에 완료(캐시 히트 시 0.08초). 결과는 곡 파일과 같은 폴더에 `<파일명>.mid`로 캐시되어 원본이 안 바뀌면 재변환 없이 즉시 제공됨. 총 다운로드 대상이 **30,423,145,171 바이트 (약 30.42 GB / 28.34 GiB)** 로 늘었습니다.

**2026-09-16 (이어서): "보컬 음색 변환" 기능용 Seed-VC GGUF(3,120,809,248 바이트, MLX Q8_0) 추가.** 완성곡의 보컬을 참조 오디오의 음색으로 바꾸는 기능. `REPOS`의 `prefixes`에 `"SeedVC-MLX-GGUF/seed-vc-mlx-q8_0.gguf"`를 추가해 받음. 로드맵상 RVC(`model_specs/rvc.json`, `"status": "experimental"`, 내장 음색 4개 중 선택만 가능)와 Seed-VC(`model_specs/seed_vc.json`, `"status": "supported"`, 임의의 참조 오디오로 제로샷 변환) 중 후자를 선택 — AudioSR/MuScriptor 때와 같은 기준(`status` 필드)으로 안정적인 쪽을 골랐고, 노래 보컬 변환에는 `svc`(Singing Voice Conversion) 전용 태스크가 있어 더 적합함. `--task svc --family seed_vc --task-route v1_svc`로 Mel-Band RoFormer STEM 분리(vocal 모드)로 뽑은 보컬만 변환한 뒤 ffmpeg `amix`로 반주와 재합성. 실측(RTX 5070): RTF ≈ 0.82(40초 보컬 변환에 약 33초) — MuScriptor보다 훨씬 느려 AudioSR처럼 진행률 폴링 UI 사용. 다운로드가 처음에 HuggingFace의 Xet 스토리지 백엔드에서 `urllib` 기반 다운로드가 초당 수십 KB로 멈춰(원인 불명, 다른 파일들과 달리 재현) `curl`로 직접 받아 우회함(스크립트 자체는 정상 — 재검증 시 sha256 일치 확인). 실제 2분 11초 완성곡으로 브라우저 종단 검증 완료(보컬 분리→변환→반주 재합성→라이브러리 저장 전부 확인). 총 다운로드 대상이 **33,543,954,419 바이트 (약 33.54 GB / 31.24 GiB)** 로 늘었습니다.

**2026-09-16: "음원 복원" 기능용 AudioSR GGUF(6,177,855,616 바이트, f32 단일 정밀도) 추가.** 저음질 외부 오디오를 업로드해 복원한 뒤 라이브러리에 새 완성곡으로 저장하는 기능("사이드바의 음원 복원 메뉴") 추가. `REPOS`의 `prefixes`에 `"AudioSR-GGUF/audiosr-basic-f32.gguf"`를 추가해 받음. AudioSR은 로드 시 출력을 무조건 모노로 만드는 모델 자체 한계가 있어(우회 옵션 없음, 이전에 YuE2 자체 출력에 시도했을 때도 확인했던 문제), 스테레오 입력은 `ffprobe`로 채널 수를 확인한 뒤 `ffmpeg channelsplit`로 좌/우를 분리해 각각 복원하고 `join` 필터로 재결합하는 방식으로 스테레오를 유지함. 실측(20초 클립, RTX 5070): 채널당 약 14.7~14.8초(RTF ≈ 0.74~0.75). 11kHz 모노/24kbps mp3로 열화시킨 테스트 소스로 실제 개선 확인(6kHz 이상 고음 평균 에너지 -59.5dB(열화)→-51.0dB(복원), 무손실 원본은 -42.6dB) — 이미 무손실인 오디오(예: YuE2 생성곡)에는 효과 없음. 같은 리비전에서 두 모델을 함께 재활용해, 완성곡 메뉴에 AI 모델 없이 순수 `ffmpeg channelsplit`만 쓰는 "채널 분리"(왼쪽/오른쪽)도 STEM 분리와 같은 UI로 추가함(`STEM_MODE_CONFIG`에 `channel` 모드만 추가, 프론트 다이얼로그 코드 변경 없음). 총 다운로드 대상이 **30,011,236,499 바이트 (약 30.01 GB / 27.95 GiB)** 로 늘었습니다.

**2026-09-15: BS-RoFormer ep368 Q8_0 GGUF를 Mel-Band RoFormer F16 GGUF(456,514,816 바이트)로 교체.** 사용자가 STEM 분리(보컬+악기) 결과를 직접 들어보고 "보컬이 너무 많이 짤린다"고 다시 지적했습니다. `num_overlap`을 4→8로 올려 같은 곡으로 실측 비교했으나(엔진 자체 오버랩-애드 구현은 표준적이고 Python 레퍼런스와 코사인 0.996으로 이미 검증되어 있었음) 보컬 트랙 파형 코사인 유사도 0.9996, 100ms 단위 무음 구간 개수도 350/1318 vs 342/1318로 거의 동일해 overlap 파라미터는 원인이 아님을 확인. `model_specs/`를 전체 확인해보니 audio.cpp가 sep 작업을 지원하는 RoFormer 계열 패밀리가 `bs_roformer` 외에 `mel_band_roformer`도 있었음(같은 `roformer` 코드 경로, CMake에서도 같은 모듈의 별칭 — 다른 체크포인트, dim 384/depth 6로 bs_roformer의 512/12보다 가벼움). GGUF는 q8_0(252MB)과 F16(457MB) 두 정밀도가 있어 더 높은 F16을 받아 같은 곡으로 비교(보컬 트랙 코사인 0.97 — 실제로 다른 결과)한 뒤 사용자가 직접 듣고 mel_band 쪽을 선호해서 STEM 분리(보컬+악기) 모드의 기본 모델을 이걸로 교체하고 bs_roformer 모델 파일은 삭제했습니다(`REPOS`의 `prefixes`에서도 제거). mel_band_roformer는 RTX 5070에서 2분 12초 곡 기준 약 10초(RTF ≈ 0.076)로, bs_roformer(약 37초)보다도 빠릅니다. `mel_band_roformer.json`에는 3번째 패키지(`mlx-community/mel-roformer-mlx`, safetensors)도 있지만 원본 체크포인트 메타데이터가 없어 검증하지 않고 보류함. 총 다운로드 대상이 **23,833,380,883 바이트 (약 23.83 GB / 22.20 GiB)** 로 바뀌었습니다.

```powershell
python scripts/download_models.py
```

Python 표준 라이브러리만 사용합니다. 중단 후 같은 명령을 실행하면 부분 파일부터 이어 받고, 완성된 파일은 해시를 검증한 후 건너뜁니다. 한 번에 세 파일을 전송합니다. 모델 저장소의 리비전을 고정하고 LFS SHA-256과 대조합니다. 작은 비 LFS 파일도 다운로드한 SHA-256을 기록합니다. **저장소를 선택해서 받는 옵션은 없습니다** — 실행할 때마다 아래 5개 저장소(4개는 전체 스냅샷, `audio-cpp/audio.cpp-gguf`는 `prefixes`로 좁힌 HTDemucs+Mel-Band RoFormer+AudioSR+MuScriptor+Seed-VC 파일 5개)를 전부 대상으로 합니다(이미 완료된 파일은 해시 검증 후 건너뜀). GGUF만 쓸 계획이어도 원본 모델(m-a-p/YuE2-3B, YuE2-Vae)이 함께 받아지고, 그 반대도 마찬가지입니다. 일부만 받고 싶다면 스크립트 상단의 `REPOS` 딕셔너리를 직접 편집해야 합니다.

| 저장소 | 고정 리비전 | 로컬 폴더 |
|---|---|---|
| [공식 YuE2-3B](https://huggingface.co/m-a-p/YuE2-3B) | `29b3558dd46954a0cd9021dc76d5c91864a0f1c7` | `models/m-a-p/YuE2-3B` |
| [공식 VAE](https://huggingface.co/m-a-p/YuE2-Vae) | `9a94e1d0ea9f8087e98f77fa88df4a4068104d2a` | `models/m-a-p/YuE2-Vae` |
| [공식 레거시 VAE](https://huggingface.co/m-a-p/YuE2-Vae-legacy) | `5ddd12f79acb90d24b3a672dcd2ebf88da7c92a9` | `models/m-a-p/YuE2-Vae-legacy` |
| [audio.cpp GGUF](https://huggingface.co/audio-cpp/Yue2-3B-GGUF) | `9c31f1c64f73d36799693aa89295b410c76928c3` | `models/audio-cpp/Yue2-3B-GGUF` |
| [audio.cpp GGUF 패키지 모음](https://huggingface.co/audio-cpp/audio.cpp-gguf)(`HTDemucs-GGUF/htdemucs-q8_0.gguf` + `Mel-Band-RoFormer-GGUF/mel-band-roformer-f16.gguf` + `AudioSR-GGUF/audiosr-basic-f32.gguf` + `MuScriptor-Small-GGUF/muscriptor-small-f32.gguf` + `SeedVC-MLX-GGUF/seed-vc-mlx-q8_0.gguf`만) | `6d5436fc85f7a20c2e9f4e472b7f3a532f686444` | `models/audio-cpp/audio.cpp-gguf/{HTDemucs-GGUF,Mel-Band-RoFormer-GGUF,AudioSR-GGUF,MuScriptor-Small-GGUF,SeedVC-MLX-GGUF}` |

GGUF 폴더에는 BF16, Q8_0, Q4_0 본체와 F16/F32 VAE 및 `sidecars/`가 있습니다. RTX 5070 12 GB에서는 Q4_0 + F16 VAE를 우선 검증합니다. 공식 PyTorch 경로는 상위 사양 PC 및 추후 배포를 위해 함께 보관하며, 다운로드 완료가 추론 검증 완료를 의미하지는 않습니다. wheel과 모델 Python 코드는 다운로드만 하며 자동 설치·실행하지 않습니다. HTDemucs Q8_0/Mel-Band RoFormer F16는 SongYUE2의 "STEM 분리" 기능(각각 보컬/드럼/베이스/기타 4갈래, 보컬/악기 2갈래) 전용이며, RTX 5070에서 2분짜리 곡 기준 HTDemucs는 약 5~7초(RTF ≈ 0.037), Mel-Band RoFormer는 약 10초(RTF ≈ 0.076)에 분리를 마칩니다.

## 직접 추가한 safetensors 파일

사용자가 직접 받은 `yue2_3b_int8_convrot.safetensors`는 `models/comfy-org/YuE2/checkpoints/yue2_3b_int8_convrot.safetensors` 위치에 두었습니다. 이 파일은 헤더 기준 `convrot_int8` 양자화와 `model.diffusion_model.*` 텐서 구조를 가진 ComfyUI 전용 형식이라, SongYUE2의 직접 생성 경로(audio.cpp GGUF, 공식 Python YuE2)로는 바로 실행되지 않습니다.

**2026-09-15: ComfyUI 어댑터 구현 및 실제 생성 검증 완료.** ComfyUI 공식(Comfy-Org)이 v0.35.0부터 YuE2를 네이티브 지원(`comfy_extras/nodes_yue2.py`: `YuE2GenerateABC`/`YuE2GenerateMusic`/`EmptyYuE2LatentAudio`, 체크포인트는 표준 `CheckpointLoaderSimple`)하는 것을 확인하고, 이 워크플로우를 `backend/comfyui.mjs`(그래프: `CheckpointLoaderSimple → YuE2GenerateMusic → ConditioningZeroOut(negative) → EmptyYuE2LatentAudio → KSampler(cfg=1.0) → VAEDecodeAudio → SaveAudio`)로 이식했습니다. 처음에는 다른 프로젝트의 ComfyUI 설치(이미 YuE2 지원 버전)를 재사용했으나, **2026-09-16 SongYUE2 전용 독립 설치로 전환**했습니다(`engine/ComfyUI`, `.gitignore` 대상, `engine/audio.cpp`와 같은 위치 규칙) — 약 4.1GB `.venv`(PyTorch 2.14.0+cu130) 구성, 포트도 다른 프로젝트(8189)와 겹치지 않게 **8190**으로 분리해 두 설치가 서로 독립적으로 동시에 동작할 수 있습니다. 체크포인트 파일은 여전히 하드링크로 연결(같은 드라이브라 디스크 중복 없음). `backend/server.mjs`의 `runComfyUi()`가 ComfyUI 미기동 시 `settings.comfyUiEnginePath`(기본값 `engine\ComfyUI`)에서 온디맨드로 기동합니다. 설치 방법은 [docs/comfyui-setup.md](comfyui-setup.md) 참고.

실제 생성으로 4가지를 모두 확인했습니다: ①일반 노래 생성(가사+스타일, 자동 심볼릭 작곡 후 렌더링, 40초 분량 정상 오디오) ②"악기만"(기존 mute-voice 메커니즘 재사용, 정상 오디오) ③ABC 악보(심볼릭 작곡)는 모델과 무관하게 항상 Python 엔진으로 동작(`/api/plan`에 modelId 없음) — 이 모델도 정상 사용 가능 ④커버(SheetSage2로 원곡 전사 → 새 가사/스타일로 같은 멜로디 재생성) 성공. **주의:** INT8 ConvRot은 로드 시 BF16로 복원되어 VRAM을 절약하지 않으며(RTX 5070 12GB에서 BF16과 동일 사용), ComfyUI는 audio.cpp/Python과 달리 생성 후에도 모델을 VRAM에 유지하므로 어댑터가 매 생성 후 `POST /free`로 명시적으로 해제합니다. 또한 기본 작곡 계획(cot=full)은 Python 엔진의 심볼릭 작곡 단계를 거치므로, ComfyUI 모델도 여전히 `pythonEnginePath`/`pythonScriptPath` 설정이 필요합니다(cot=off로 계획 없이 생성할 때만 예외).

사용자가 직접 받은 `sheetsage2_bf16.safetensors`는 `models/m-a-p/SheetSage2/model.safetensors` 위치에 두었고, 이후 Hugging Face `m-a-p/SheetSage2` 스냅샷의 `config.json`과 나머지 코드·자산 파일(`modeling_sheetsage2.py`, `pipeline_sheetsage2.py`, `notation_sheetsage2.py`, `requirements.txt` 등 전체)도 같은 폴더에 받아 두어, `AutoModel.from_pretrained(..., trust_remote_code=True)`로 로드 가능한 상태입니다. 앱의 `GET /api/models`/`POST /api/cover-transcribe`는 `config.json`+`model.safetensors` 존재 여부로 로컬 모델 사용 가능 여부를 판단하므로, 이 조건은 이미 충족됩니다.

이 폴더의 코드가 요구하는 Python 패키지 버전(`torch==2.8.0`+cu128, `transformers==4.45.2` 등, `requirements-sheetsage2.txt`)은 YuE2 본체용 venv에 이미 설치된 더 최신 버전(`torch 2.10`, `transformers 4.57`)과 달라 같은 venv를 공유하면 버전 충돌 위험이 있으므로, **별도 Python 가상환경**(`test/YuE2-source/.venv-sheetsage2`)을 만들어 `requirements-sheetsage2.txt`를 설치하고, 설정 화면의 `sheetSagePythonPath`를 그 venv의 `python.exe`로 지정해야 합니다. 처음부터 설치하는 절차는 [docs/python-engine-setup.md](python-engine-setup.md)의 SheetSage2 절을 참고하세요.

**2026-09-12: 실제 오디오로 종단 테스트 성공.** venv 준비 후 `config.json`에 문제가 하나 더 있었습니다 — 다운로드한 `model.safetensors`를 직접 열어보면 `encoder.*` 키가 876개 포함된 **완전히 병합된(merged) 체크포인트**인데, `config.json`은 `"weights_format": "adapter"`(원격 `m-a-p/MERT-v2-FullSong`을 따로 받아 LoRA 어댑터와 병합하는 방식)로 되어 있어 `missing_keys` 오류로 로드가 실패했습니다. `config.json`의 `weights_format`을 `"merged"`로 고치면 정상 로드됩니다(베이스 모델 다운로드 자체가 불필요해짐). `models/`는 `.gitignore`에 있어 이 수정은 저장소에 남지 않으므로, 모델을 다시 받을 경우 이 값을 다시 고쳐야 합니다. 자세한 내용과 백엔드 쪽에 있었던 두 번째 문제(출력 폴더 충돌)는 [docs/local-api.md](local-api.md#sheetsage2)를 참고하세요.

공식 가중치 라이선스는 **CC BY-NC 4.0**입니다. 각 원본 저장소의 `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/`를 보존했습니다. GGUF 저장소는 README에 라이선스를 표시하지만 별도 LICENSE 파일은 제공하지 않습니다. 배포 시 모델 용량 및 라이선스를 고려해 앱 설치 파일과 모델 다운로드를 분리할 수 있습니다.

상태 JSON은 전체 및 저장소별 총 바이트·완료 바이트와 파일별 경로·크기·해시·상태를 포함합니다. 프론트엔드는 실제 파일 상태와 존재 여부를 바탕으로 다운로드 완료를 표시해야 합니다.

**2026-09-25 정리**: 이 PC(RTX 5070 12GB)에서 Q4 GGUF는 품질이 낮아 쓸 수 없고 BF16 GGUF는 너무 커서 실행할 수 없어, `yue2-3b-q4_0.gguf`, `yue2-3b-bf16.gguf`, 그 전용 `yue2-vae-f32.gguf`를 삭제했다(Q4로 만든 저장곡은 없었음). 기본 모델은 Q8 GGUF(+F16 VAE)이고, 다른 하나는 ComfyUI의 INT8 ConvRot이다. 삭제한 모델은 앱의 모델 목록에 "다운로드 필요"로 남으며 누르면 안내만 나온다(선택되지 않음). 원본 Python 모델(`m-a-p/YuE2-3B`)은 "악기만"·ABC 악보 기능의 계획 단계에 쓰이므로 남겨 두었다. 모델 목록(`GET /api/models`)은 다운로드 기록이 아니라 **디스크에 실제로 있는 파일**만 보여 준다.

## LoRA 엔진 (yue-server) — 2026-09-25부터

LoRA/LoKr 어댑터는 audio.cpp가 읽지 못해서, **어댑터를 고른 곡만** YuE2 Studio가 쓰는 `yue-server`(yue2.cpp 포크, MIT)로 만듭니다. 어댑터를 쓰지 않는 곡은 지금까지와 똑같이 audio.cpp로 만들어지며, 이 엔진이 없어도 앱의 다른 기능은 그대로 동작합니다. 새 YuE 모델이 나오면 audio.cpp 쪽 모델만 바꾸면 되도록, 두 엔진의 모델은 서로 독립입니다.

| 필요한 것 | 위치 | 받는 곳 |
|---|---|---|
| `yue-server.exe` 와 dll (CUDA 빌드, 약 207 MB) | `engine/yue-server/` | YuE2 Studio 포터블의 `resources/yue2-cpp/` 폴더 전체를 복사하거나, `github.com/timoncool/yue2.cpp`를 CMake(CUDA)로 빌드 |
| `YuE2-3B-Q8_0.gguf` (3.8 GB) | `models/yue-server/` | 허깅페이스 `Serveurperso/YuE2-GGUF` |
| `YuE2-3B-BF16.gguf` (약 7 GB, 선택) | `models/yue-server/` | 같은 저장소. 화면에서 고른 모델이 "원본" 또는 "BF16"이면 이 파일로 LoRA 곡을 만듭니다(없으면 Q8_0으로 만듭니다). Q4, Q8, INT8 모델은 항상 Q8_0을 씁니다. |
| `YuE2-Vae-F32.gguf` (0.5 GB) | `models/yue-server/` | 같은 저장소 |
| LoRA 어댑터 | `models/yue-adapters/<이름>/` | 앱의 "LoRA 관리" 화면에서 받기("Preset" 탭·"허깅페이스" 탭)·가져오기 |

- **이 앱의 `models/audio-cpp/Yue2-3B-GGUF/yue2-3b-q8_0.gguf`는 yue-server에서 쓸 수 없습니다.** yue-server는 토크나이저가 들어 있는 GGUF를 요구하는데(로드 시 `Tokenizer not found in …`), audio.cpp용 GGUF는 토크나이저를 별도 sidecar 파일로 둡니다. 그래서 위 두 파일이 따로 필요합니다(합계 약 4.3 GB 추가).
- 포트는 `127.0.0.1:8189`(`C:\Claude\PORTS.md`). "노래 만들기" 때 필요하면 앱이 시작하고 곡이 끝나면 종료하므로 GPU 메모리를 계속 점유하지 않습니다. 이미 같은 포트에서 서버가 떠 있으면 그것을 재사용하고 끄지 않습니다.
- 어댑터 폴더 하나 = LoRA 하나입니다. 폴더에 `.safetensors` 파일이 1~2개(작곡 쪽 AR과 사운드 쪽 NAR을 따로 받은 경우 2개)와 앱이 적는 `songyue2-adapter.json`(이름, 종류, 설명, 트리거 단어, 추천 강도, 출처와 커밋)이 들어갑니다. 직접 넣은 폴더도 인식하며, 그때는 `adapter_config.json`의 `"ar": true` 여부로 AR/NAR을 추정하고 "엔진 검사"를 누르면 엔진이 알려 주는 실제 범위(작곡/사운드)로 바뀝니다.
- 확인한 형식: PEFT/일반 LoRA(`lora_A/lora_B`), ComfyUI용 파일, bf16 파일, LoKr 모두 로드됨. DoRA·LoHa·PiSSA 델타는 엔진이 거부합니다. AR(작곡) 쪽만 바꾸는 파일, NAR(사운드) 쪽만 바꾸는 파일, 둘 다 바꾸는 파일이 있고, 곡 만들기의 LoRA 선택은 **작곡 강도와 사운드 강도를 따로** 받습니다(yue-server의 `ar_scale`/`nar_scale`).
- **Preset 탭**(내부 이름은 catalog, `backend/adapter-catalog.json`)는 `node scripts/build-adapter-catalog.mjs`로 만듭니다. 각 항목의 설명·추천 강도·트리거는 공개 모델 카드를 보고 손으로 적고, 파일 크기와 다운로드가 고정되는 커밋은 허깅페이스 API에서 읽습니다. 모든 파일을 실제로 yue-server에 로드해 AR/NAR 범위를 확인했습니다.
- **허깅페이스 탭**은 `yue2` 검색 결과에서 YuE2 어댑터만 골라(다른 모델의 LoRA, 모델 변환본 제외) 태그·언어·라이선스·샘플 수·파일 이름에서 분류하고, 저장소를 열면 README 첫 문단과 샘플 음원, 받을 수 있는 파일을 보여 줍니다. 작곡(AR) 파일 1개와 사운드(NAR) 파일 1개를 함께 고르면 하나의 LoRA로 묶습니다.
- "악기만": 원본(Python) 모델이 아닌 모델(GGUF, INT8 등)에서 "악기만"을 누르면 받아 둔 "연주곡(Instrumental)" LoRA가 모두 자동으로 선택되어 이 엔진으로 만듭니다(가사는 [Verse] 같은 구간 태그만 남깁니다). 그 LoRA가 없으면 기존 방식(audio.cpp + 악보 mute-voice)으로 만들고 화면에서 받도록 안내합니다. 같은 시드여도 audio.cpp와 yue-server의 결과는 다릅니다. 비상업(cc-by-nc) 라이선스인 LoRA가 많아 화면에 "비상업용"으로 표시합니다.
- 실측(RTX 5070 12 GB): 30초 곡 약 14초, 1분 39초 곡 34초(추론 단계 32).

## 표지 이미지 모델 (Z-Image Turbo) — 2026-09-26부터

곡 표지 자동 생성(선택)이 ComfyUI로 돌리는 모델입니다. 앱이 받아 주지는 않으며 ComfyUI가 볼 수 있는 폴더에 있어야 합니다. 없으면 Pixabay 사진, 그래픽 표지로 넘어갑니다. 파일과 연결 방법은 [comfyui-setup.md](comfyui-setup.md)의 5번을 보세요. Z-Image Turbo와 Qwen3-4B 텍스트 인코더의 라이선스는 각 모델 페이지를 확인하세요.

## LoRA 학습용 체크포인트

"LoRA 관리 → 학습"은 ComfyUI의 `models/checkpoints/yue2_3b_bf16.safetensors`(약 7.8GB, Comfy-Org/YuE2)를 씁니다. 사운드(NAR) LoRA만 학습합니다. 준비는 [lora-training.md](lora-training.md)를 보세요.
