# 원본 Python 엔진 + SheetSage2 설치 (YuE2 "원본" 모델 & 커버 기능)

## 언제 필요한가

다음 두 가지 중 하나라도 쓰려면 이 문서의 설치가 필요합니다. **audio.cpp(GGUF)만 쓸 계획이면 이 문서 전체를 건너뛰어도 됩니다** — [docs/audiocpp-setup.md](audiocpp-setup.md)만으로 충분합니다.

| 기능 | 필요한 것 |
|---|---|
| 모델 선택에서 **"YuE2 - 원본"** 사용 | 아래 [1~5](#1-공식-yue2-소스-받기) — 공식 Python 파이프라인 |
| 완성곡 메뉴의 **"커버"** / 작곡 화면의 **"오디오에서 추출"** (오디오 → ABC 악보, SheetSage2) | 위 1~5 **더하지 않고 별도로**, 아래 [SheetSage2](#sheetsage2-커버--오디오에서-추출-선택-기능) 절만 |

"심볼릭 작곡"(`/api/plan`, ABC 계획 생성)과 "악기만" 생성도 내부적으로 이 Python 엔진(`abc_tools.py`)을 거칩니다 — GGUF 모델로 최종 음악을 만들 때도 ABC 준비 단계는 Python이 필요합니다. 즉 GGUF만 쓰더라도 "악기만"/"커버"/"심볼릭 작곡"을 쓰려면 아래 1~5(원본 파이프라인 전체는 아니어도 최소한 Python 환경과 `abc_tools.py`)가 필요합니다.

## 요구 사항 (Windows)

- NVIDIA GPU, CUDA BF16 지원, **VRAM 24GB 권장**(생성기가 시작 시 확인하며 부족하면 거부될 수 있음). `PYTHON_MEMORY_BUDGET_GIB`를 낮추면 12GB급에서도 짧은 곡은 동작 확인됨(RTX 5070 12GB, 2026-09-12 실측)
- NVIDIA 드라이버 — CUDA 12.8 이상 지원 (`nvidia-smi` 실행 후 우측 상단 CUDA 버전 확인). RTX 50시리즈(Blackwell, sm_120)는 반드시 cu128 이상
- 디스크 여유 공간 약 20GB 이상 (소스 + 가상환경 + 캐시, 모델 가중치 자체는 별도로 `models/`에 받음)
- git, [uv](https://docs.astral.sh/uv/) — 아래 0번에서 설치

## 0. 사전 준비

### 0-1. 그래픽카드/드라이버 확인

```powershell
nvidia-smi
```

우측 상단에 표시되는 CUDA 버전이 **12.8 이상**인지 확인하세요(RTX 50시리즈는 필수). 낮으면 [NVIDIA 드라이버](https://www.nvidia.com/Download/index.aspx)를 최신으로 업데이트하세요. 이 명령 자체가 실패하면(인식 안 됨) NVIDIA 드라이버가 설치되어 있지 않은 것입니다.

### 0-2. git 설치 확인

```powershell
git --version
```

버전이 나오지 않으면 설치하세요.

```powershell
winget install --id Git.Git -e
```

설치 후 **새 PowerShell 창을 열어야** PATH가 반영됩니다.

### 0-3. uv 설치

```powershell
winget install astral-sh.uv
```

새 PowerShell 창을 연 뒤 확인하세요.

```powershell
uv --version
```

## 1. 공식 YuE2 소스 받기

```powershell
git clone https://github.com/multimodal-art-projection/YuE.git test\YuE2-source
```

- `test/`는 프로젝트 루트 기준 권장 위치이며 `.gitignore`에 등록되어 있습니다(서드파티 소스는 커밋하지 않음).
- SongYUE2가 실제로 실행하는 스크립트(`run_yue2.py`, `abc_tools.py`, `transcribe.py`)는 이 저장소의 `skills/yue2-music/scripts/`에 이미 포함되어 있습니다 — 별도로 받을 필요 없습니다.
- 라이선스: 코드는 Apache 2.0, 모델 가중치는 CC BY-NC 4.0(비상업적 용도만). 자세한 내용은 클론한 폴더의 `README.md`/`INSTALL.md`/`SETUP.md`를 참고하세요.

## 2. Python 환경 구성 (uv)

`test/YuE2-source` 폴더 안에서 PowerShell로 실행하세요.

```powershell
cd test\YuE2-source
$env:UV_PYTHON_INSTALL_DIR = "$PWD\.python"
$env:UV_PYTHON_BIN_DIR     = "$PWD\.python\bin"
$env:UV_CACHE_DIR          = "$PWD\.uv-cache"
$env:UV_LINK_MODE          = "copy"

uv python install 3.12
uv venv --python 3.12 .venv

$env:VIRTUAL_ENV = "$PWD\.venv"
uv pip install "torch==2.10.0" --index-url https://download.pytorch.org/whl/cu128
uv pip install -e .
```

- `--index-url`을 빼지 마세요. PyPI 기본 휠은 CPU 전용이거나 최신 GPU 커널이 없습니다.
- Windows용 FlashAttention 패치(`windows-flash-attention.patch`)는 이 저장소에 이미 적용되어 있어 추가 작업이 필요 없습니다.
- 설치가 끝나면 `.uv-cache\` 폴더는 지워도 됩니다(약 12GB 회수, 다음 설치 시 다시 받을 뿐입니다).

## 3. 설치 확인

```powershell
mkdir .hf-cache, .torch-cache, outputs -ErrorAction SilentlyContinue
. .\yue2-env.ps1
python yue2_gui.py --selftest
```

`RESULT: ready to generate`가 나오면 성공입니다. `arch list`에 내 GPU의 `sm_` 버전이 포함되어 있는지 확인하세요 — 없으면 torch를 더 새로운 CUDA 버전으로 재설치해야 합니다.

## 4. 모델 파일

이 selftest/GUI 자체는 첫 생성 시 `.hf-cache\`로 가중치를 자동 다운로드하지만, **SongYUE2는 이 자동 다운로드를 쓰지 않습니다.** 대신 프로젝트 루트의 `scripts/download_models.py`로 받은 `models/m-a-p/YuE2-3B`, `models/m-a-p/YuE2-Vae`를 `--model`/`--vae`/`--offline` 인자로 직접 지정해 호출합니다.

```powershell
cd C:\Claude\SongYUE2
python scripts/download_models.py
```

이 스크립트는 선택 옵션이 없고 **관련된 4개 저장소를 전부(약 23.3GB) 받습니다** — GGUF만 쓸 계획이어도 원본 모델(7.79GB)이 함께 받아지고, 원본만 쓸 계획이어도 GGUF(14.99GB)가 함께 받아집니다. 일부만 받고 싶다면 스크립트의 `REPOS` 딕셔너리를 직접 편집해야 합니다. 자세한 저장소 목록·크기·검증 방식은 [docs/models.md](models.md)를 참고하세요.

## 5. SongYUE2 앱에 연결

설정 화면(또는 `.env`)에 다음 두 경로를 지정하면 모델 선택에서 "YuE2 - 원본"을 골랐을 때 이 엔진이 호출됩니다.

- **Python 실행 파일**: `test\YuE2-source\.venv\Scripts\python.exe`
- **Python 스크립트**: `test\YuE2-source\skills\yue2-music\scripts\run_yue2.py` (`examples/generate.py`가 **아닙니다** — `plan`/`generate` 하위 명령과 `--memory-budget-gib`를 지원하는 쪽입니다. `abc_tools.py`도 같은 폴더에 있어야 악보 검사·"악기만"·ABC 커버가 동작합니다)
- **Python 메모리 예산(GiB)**: 기본 24(공식 권장), 12GB급 카드는 11 정도로 낮춰 시작해 보세요

## SheetSage2 (커버 / 오디오에서 추출, 선택 기능)

완성곡의 "커버" 메뉴, 작곡 화면의 "오디오에서 추출" 버튼이 쓰는 오디오→ABC 전사 모델입니다. **위 1~5과 완전히 별도의 Python 3.11 가상환경**이 필요합니다 — YuE2 본체 venv(torch 2.10, transformers 4.57)와 SheetSage2가 요구하는 버전(torch 2.8, transformers 4.45.2)이 달라 같은 venv를 공유하면 충돌합니다.

### 요구 사항

- `ffmpeg`가 PATH에 있어야 합니다(`where ffmpeg`로 확인). 없으면 <https://www.gyan.dev/ffmpeg/builds/>에서 받아 PATH에 추가하세요.
- 디스크 약 2GB 추가(전사 모델 220MB + MERT2 인코더 1.8GB, 첫 전사 시 다운로드)

### 설치

`test/YuE2-source` 폴더 안에서:

```powershell
$env:UV_PYTHON_INSTALL_DIR = "$PWD\.python"
$env:UV_CACHE_DIR          = "$PWD\.uv-cache"
$env:UV_LINK_MODE          = "copy"

uv python install 3.11
uv venv --python 3.11 .venv-sheetsage2

$env:VIRTUAL_ENV = "$PWD\.venv-sheetsage2"
uv pip install "torch==2.8.0" "torchaudio==2.8.0" --index-url https://download.pytorch.org/whl/cu128
uv pip install -r requirements-sheetsage2.txt
```

> 공식 SheetSage2 문서는 cu126을 안내하지만, cu126은 sm_90까지만 지원합니다. RTX 50시리즈에서는 위처럼 **cu128**을 쓰세요.

### 모델 파일 받기

SongYUE2가 로컬 모델로 인식하려면 `models/m-a-p/SheetSage2/`에 `config.json`과 `model.safetensors`가 함께 있어야 합니다(둘 다 없으면 API가 매번 온라인 다운로드를 시도합니다). Hugging Face `m-a-p/SheetSage2` 스냅샷 전체(코드·설정 포함)를 이 폴더에 받으세요.

```powershell
cd test\YuE2-source
. .\yue2-env.ps1
.\.venv-sheetsage2\Scripts\python.exe -c @'
from huggingface_hub import snapshot_download
snapshot_download("m-a-p/SheetSage2", local_dir="../../models/m-a-p/SheetSage2",
                  ignore_patterns=["render_assets/soundfonts/*", "assets/*"])
'@
```

**알려진 문제 — `config.json`의 `weights_format` 오기.** 배포되는 `model.safetensors`는 `encoder.*` 키 876개가 포함된 완전히 병합(merged)된 체크포인트인데, 딸려오는 `config.json`은 `"weights_format": "adapter"`(원격 베이스 모델과 별도 병합이 필요한 방식)로 되어 있어 그대로 두면 `missing_keys` 오류로 로드가 실패합니다. **`config.json`을 열어 `"weights_format"` 값을 `"merged"`로 고치세요** — 이후 정상 로드됩니다. `models/`는 `.gitignore`에 있어 이 수정은 저장소에 남지 않으므로, 모델을 다시 받을 때마다 다시 고쳐야 합니다. 자세한 내용은 [docs/models.md](models.md)를 참고하세요.

### SongYUE2 앱에 연결

설정 화면의 "SheetSage2 Python 실행 파일"에 `test\YuE2-source\.venv-sheetsage2\Scripts\python.exe`를 지정하세요. 스크립트 경로는 위 5번의 `pythonScriptPath`와 같은 폴더(`skills/yue2-music/scripts/transcribe.py`)를 자동으로 찾으므로 별도 설정이 없습니다 — 즉 5번의 Python 스크립트 경로 설정이 먼저 되어 있어야 합니다.

## 자주 만나는 문제

| 증상 | 원인 / 해결 |
|---|---|
| `uv: command not found`(새 PowerShell에서도) | winget 설치 후 터미널을 완전히 새로 열지 않음. 터미널을 껐다 켜거나 재부팅 |
| `RESULT: not ready` 또는 selftest 실패 | `. .\yue2-env.ps1`을 먼저 실행했는지 확인. 이 스크립트가 `.venv`를 활성화하고 캐시 경로를 프로젝트 폴더로 고정합니다 |
| `no kernel image is available for execution` | torch가 내 GPU(sm_ 버전)를 지원하지 않음 — `uv pip install "torch==2.10.0" --index-url https://download.pytorch.org/whl/cu128`로 재설치 |
| `USE_FLASH_ATTENTION was not enabled for build` | Windows 패치가 적용 안 된 소스를 받은 경우. 공식 저장소를 그대로 클론했다면 이미 적용되어 있어야 하니, 클론이 중간에 실패하지 않았는지 확인 |
| `requires CUDA BF16 support` | GPU가 BF16을 지원하지 않음 — 요구 사항 미달로 우회 불가 |
| `missing_keys` 오류로 SheetSage2 로드 실패 | `models/m-a-p/SheetSage2/config.json`의 `weights_format`이 `adapter`로 되어 있음. `merged`로 수정(위 참고) |
| `FFmpeg is required to read audio files` | 커버 기능용 ffmpeg가 PATH에 없음. `where ffmpeg`로 확인 후 설치 |
| VRAM 부족으로 생성 실패 | `PYTHON_MEMORY_BUDGET_GIB`(설정 화면의 "Python 메모리 예산")를 낮춰서 재시도. 그래도 안 되면 GGUF(audio.cpp) 경로 사용을 권장 |
| 가중치가 `C:\Users\...\.cache`로 감 | `. .\yue2-env.ps1`을 실행하지 않고 python을 직접 호출함 |
| 디스크가 부족하다 | `.uv-cache\` 삭제(약 12GB 회수), SheetSage2 미사용 시 `.venv-sheetsage2\` 삭제 |
