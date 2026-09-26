# ComfyUI 연동 설치 (YuE2 INT8 ConvRot 모델)

## 언제 필요한가

모델 선택에서 **"YuE2 - INT8 ConvRot"**을 쓰려는 경우에만 필요합니다. 다른 모델(Q4/Q8/BF16 GGUF, 원본 Python)은 이 문서와 무관합니다.

INT8 ConvRot 체크포인트(`yue2_3b_int8_convrot.safetensors`)는 audio.cpp도 공식 Python 파이프라인도 읽지 못하는 **ComfyUI 전용 형식**입니다. ComfyUI가 v0.35.0부터 YuE2를 네이티브로 지원(`comfy_extras/nodes_yue2.py`: `YuE2GenerateABC`/`YuE2GenerateMusic`/`EmptyYuE2LatentAudio`, 체크포인트는 표준 `CheckpointLoaderSimple`)하게 된 것을 이용해, SongYUE2가 ComfyUI를 HTTP API(`/prompt`, `/history`, `/view`)로 원격 호출하는 방식으로 연결했습니다.

**중요:** INT8 ConvRot은 로드 시 BF16으로 복원되어 실행됩니다 — **VRAM을 절약하지 않습니다**(RTX 5070 12GB 기준 BF16 GGUF와 동일하게 사용). 줄어드는 건 다운로드 용량뿐(3.96GB)입니다. 저VRAM 환경에서 이 모델을 고르는 실익은 크지 않습니다.

## 디스크 용량

독립 설치 시 약 **8~8.5GB**가 필요합니다(`.venv` 약 4.1GB + ComfyUI 코드 약 0.1GB + YuE2 INT8 체크포인트 3.96GB). 체크포인트는 `scripts/download_models.py`로 이미 받아 둔 파일을 하드링크로 연결하므로 실질 추가 용량은 **약 4.2GB**(venv+코드)입니다. 설치 중 pip 다운로드 캐시가 일시적으로 2~3GB 더 잡힐 수 있으나 설치 후 지워도 됩니다.

## 1. ComfyUI 설치

SongYUE2 전용으로 `engine/ComfyUI/`에 독립 설치합니다(`engine/`은 `.gitignore` 대상이라 저장소에는 남지 않습니다, `engine/audio.cpp/`와 같은 위치 규칙).

```powershell
cd C:\Claude\SongYUE2
git clone https://github.com/comfyanonymous/ComfyUI.git engine\ComfyUI
cd engine\ComfyUI
python -m venv .venv
```

RTX 50시리즈(Blackwell, sm_120)는 cu128 이상이 필요합니다 — 검증에는 cu130을 사용했습니다.

```powershell
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\python.exe -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu130
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

`requirements.txt`가 `comfy-kitchen`(INT8 ConvRot 양자화 CUDA 커널 제공)을 함께 설치합니다 — 별도 설치가 필요 없습니다.

확인:

```powershell
.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
Test-Path comfy_extras\nodes_yue2.py   # True여야 함
```

`torch.cuda.is_available()`이 `False`면 GPU 드라이버/CUDA 버전을 확인하세요. `nodes_yue2.py`가 없으면 클론한 커밋이 [Comfy-Org/ComfyUI#16250](https://github.com/Comfy-Org/ComfyUI/pull/16250) 병합 이전입니다 — `git pull`로 최신화하세요.

**이미 YuE2를 지원하는 ComfyUI가 다른 곳에 있다면** 새로 설치하지 않고 그 경로를 아래 3단계 설정에 그대로 지정해도 됩니다(디스크 절약) — 이 문서의 1~2단계는 건너뛸 수 있습니다.

## 2. 체크포인트 파일 연결

`models/comfy-org/YuE2/checkpoints/yue2_3b_int8_convrot.safetensors`(SongYUE2가 `scripts/download_models.py`로 이미 받아 둔 파일)를 ComfyUI가 찾는 위치(`engine/ComfyUI/models/checkpoints/`)에 연결합니다. **복사 대신 하드링크를 권장**합니다(같은 드라이브라면 3.96GB 중복 저장 없이 즉시 연결됨, 관리자 권한 불필요 — 심볼릭 링크는 관리자 권한이 필요해 실패할 수 있습니다).

```powershell
New-Item -ItemType HardLink `
  -Path "C:\Claude\SongYUE2\engine\ComfyUI\models\checkpoints\yue2_3b_int8_convrot.safetensors" `
  -Target "C:\Claude\SongYUE2\models\comfy-org\YuE2\checkpoints\yue2_3b_int8_convrot.safetensors"
```

다른 드라이브라 하드링크가 안 되면(`New-Item`이 오류를 내면) 그냥 복사해도 됩니다 — 디스크 용량만 더 씁니다.

확인: ComfyUI를 실행한 뒤(아래 3단계) `curl http://127.0.0.1:8190/object_info`로 `CheckpointLoaderSimple`의 `ckpt_name` 목록에 파일명이 보이는지 확인하세요.

## 3. SongYUE2 설정 화면에 연결

설정 화면의 "로컬 실행 환경" 섹션에서 두 필드를 확인/수정하세요(비워두면 아래 기본값 사용):

| 필드 | 기본값 | 의미 |
|---|---|---|
| ComfyUI 연결 주소 | `http://127.0.0.1:8190` | ComfyUI가 리스닝할 주소/포트 |
| ComfyUI 설치 폴더 | `engine\ComfyUI` (SongYUE2 폴더 기준 상대경로) | ComfyUI가 안 떠 있을 때 SongYUE2가 자동으로 실행할 `main.py`/`.venv` 위치 |

다른 위치의 ComfyUI를 쓴다면 이 두 값을 그 위치에 맞게 바꾸세요(절대경로도 가능). 포트를 바꾸려면 두 필드(주소의 포트 번호)만 일치시키면 됩니다.

**ComfyUI를 미리 띄워둘 필요는 없습니다.** `settings.comfyUiEndpoint`가 응답하지 않으면 `runComfyUi()`가 `<ComfyUI 설치 폴더>\.venv\Scripts\python.exe main.py --listen 127.0.0.1 --port <포트> --disable-auto-launch`를 자동으로 실행합니다(최초 1회는 부팅에 수십 초 걸릴 수 있음).

## 4. 심볼릭 작곡(Python 엔진)도 여전히 필요

작곡 계획이 "계획 없이 생성"(`cot=off`)이 아닌 한(기본값은 "멜로디와 코드 계획"), ComfyUI로 생성하기 전에 심볼릭 작곡(ABC 악보) 단계를 먼저 거칩니다 — 이 단계는 ComfyUI가 아니라 기존 Python 엔진을 씁니다. 즉 이 모델을 기본 설정으로 쓰려면 [docs/python-engine-setup.md](python-engine-setup.md)의 Python 실행 파일/스크립트 경로도 설정되어 있어야 합니다. "계획 없이 생성"으로 바꾸면 이 요구사항은 없어집니다.

## 5. 표지 이미지 모델 (Z-Image Turbo, 선택)

곡 표지 자동 생성이 쓰는 모델입니다. 없으면 자동으로 Pixabay 사진이나 그래픽 표지로 넘어갑니다. ComfyUI가 기본으로 지원하므로 새 노드는 필요 없고, 아래 세 파일이 ComfyUI에 보이면 됩니다.

| 파일 | 폴더 | 크기(권장 변형) |
|---|---|---|
| `z_image_turbo_nvfp4.safetensors` (없으면 fp8, bf16 순으로 사용) | `models/diffusion_models/` | 4.5GB |
| `qwen_3_4b_fp8_mixed.safetensors` (없으면 fp4_mixed, qwen_3_4b 순) | `models/text_encoders/` | 5.6GB |
| `ae.safetensors` | `models/vae/` | 0.34GB |

받는 곳은 Hugging Face의 Comfy-Org/z_image_turbo(`split_files/`)입니다. 다른 ComfyUI의 모델 폴더를 그대로 쓰려면 `engine/ComfyUI/extra_model_paths.yaml`에 그 폴더를 적으세요(이 파일은 ComfyUI가 시작할 때 읽으므로 **ComfyUI를 다시 시작**해야 합니다). 예:

```yaml
sd_lib:
    base_path: D:\sd-lib
    diffusion_models: models\diffusion_models
    text_encoders: models\text_encoders
    vae: models\vae
```

파일 이름은 하위 폴더가 있어도 됩니다(패턴으로 찾음). 이 PC(RTX 5070 12GB)에서 nvfp4로 1536×1536 한 장에 약 14~20초 걸렸습니다.

## 6. LoRA 학습기 (선택)

"LoRA 관리 → 학습" 탭은 같은 ComfyUI에 ComfyUI-YuE2-Trainer 노드와 BF16 체크포인트(`yue2_3b_bf16.safetensors`)를 더 설치해서 씁니다. 자세한 준비는 [lora-training.md](lora-training.md)를 보세요.

## 검증한 버전 (2026-09-16)

- ComfyUI `0.35.0`, 커밋 `7a0b5ee`(2026-09-15, YuE2 PR 병합 이후) — SongYUE2 전용 독립 설치(`engine/ComfyUI`)
- Python 3.12.10, PyTorch 2.14.0+cu130, comfy-kitchen 0.2.34
- RTX 5070 12GB, 드라이버 596.36
- 독립 설치 디스크 사용량: `.venv` 4.10GB + 체크포인트 3.96GB(하드링크) + 코드 약 0.1GB
- 워크플로우 그래프(`CheckpointLoaderSimple → YuE2GenerateMusic → ConditioningZeroOut → EmptyYuE2LatentAudio → KSampler(cfg=1.0, sampler=euler, scheduler=simple) → VAEDecodeAudio → SaveAudio`)는 실제 ComfyUI에 `GET /object_info`를 조회해 정확한 노드 스키마를 확인한 뒤 작성 — 추측으로 채운 값 없음
- 실제 생성으로 확인: SongYUE2 백엔드 → 이 독립 설치(포트 8190)로 실제 곡 생성(51초 분량, 무음/클리핑 없는 정상 오디오)

## 자주 만나는 문제

| 증상 | 원인 / 해결 |
|---|---|
| "ComfyUI 실행 파일을 찾을 수 없습니다" | 설정의 "ComfyUI 설치 폴더"가 잘못됐거나, 그 폴더에 `.venv\Scripts\python.exe`가 없음(ComfyUI가 시스템 Python이나 `python_embeded`로 설치된 경우 이 경로 구조와 다름 — venv 방식 설치로 맞추거나 경로를 직접 맞게 조정해야 함) |
| "ComfyUI 엔진이 60초 안에 시작되지 않았습니다" | 최초 부팅이 오래 걸리는 GPU/디스크 환경일 수 있음. ComfyUI를 수동으로 먼저 띄워둔 뒤(`main.py --listen 127.0.0.1 --port 8190`) 다시 시도 |
| "ComfyUI 워크플로우 오류" | 체크포인트가 `models/checkpoints/`에 없거나 파일명이 다름(하드링크가 깨졌는지 확인). ComfyUI 콘솔 로그도 함께 확인 |
| 곡 생성 후 다른 모델(원본/BF16)로 전환하니 VRAM 부족 | 정상적으로는 생성 직후 `/free`로 VRAM을 해제하지만, ComfyUI가 예기치 않게 종료되지 않았다면 모델이 여전히 로드되어 있을 수 있음 — ComfyUI 프로세스를 재시작 |
| 가사/스타일은 맞는데 결과가 이상함 | INT8 ConvRot은 양자화 왕복 오차 때문에 같은 seed라도 BF16/원본과 미묘하게 다른 결과가 남 — 설계상 특성이며 버그 아님 |
| `torch.cuda.is_available()`가 `False` | GPU 드라이버가 오래됐거나 cu130이 카드를 지원 안 함 — `nvidia-smi`로 드라이버 버전 확인 후 더 낮은 CUDA 인덱스(cu128)로 재설치 시도 |
