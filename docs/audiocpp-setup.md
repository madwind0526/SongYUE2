# audio.cpp 설치 (YuE2 GGUF 실행 엔진)

## 왜 소스 빌드가 필요한가

YuE2 지원은 [`0xShug0/audio.cpp`](https://github.com/0xShug0/audio.cpp)의 **`dev` 브랜치에만** 있습니다(`main`에는 0개 파일). GitHub Releases의 공식 프리빌드 Windows 바이너리는 `main`/태그 기준이라 **yue2가 포함되어 있지 않습니다.** 따라서 `dev` 브랜치를 직접 받아 소스에서 빌드해야 합니다. `model_specs/yue2.json`에 `"status": "experimental"`로 표시되어 있듯 아직 실험 단계입니다.

## 빌드 요구 사항 (Windows)

- Visual Studio Build Tools 2022 이상, C++ desktop workload (Visual Studio IDE 자체는 불필요)
- MSVC x64 컴파일러, Windows SDK, CMake, Ninja, MSVC OpenMP — 모두 VS2022 설치에 번들로 포함되어 있으면 별도 설치 불필요 (`...\Common7\IDE\CommonExtensions\Microsoft\CMake\{CMake,Ninja}\...`)
- NVIDIA CUDA Toolkit (RTX 50시리즈/Blackwell은 12.8 이상 필요)
- git

## 0. 사전 준비

### 0-1. git 설치 확인

```powershell
git --version
```

버전이 안 나오면 설치하세요(설치 후 **새 PowerShell 창을 열어야** PATH가 반영됩니다).

```powershell
winget install --id Git.Git -e
```

### 0-2. Visual Studio 2022 Build Tools + C++ workload 설치

winget으로 한 번에 설치할 수 있습니다(수 GB, 몇 분 소요).

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

또는 [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/) → **Build Tools for Visual Studio 2022**를 받아 실행한 뒤, 워크로드 목록에서 **"C++를 사용한 데스크톱 개발"(Desktop development with C++)**을 체크하고 설치하세요. Visual Studio IDE 전체를 설치할 필요는 없습니다.

설치 확인 — 아래 명령이 실행되는 새 PowerShell 창을 여세요(`vcvars64.bat`가 MSVC 컴파일러를 PATH에 넣어 줍니다).

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

경로가 출력되면 C++ workload가 정상 설치된 것입니다. 아무 것도 안 나오면 workload 없이 Build Tools만 설치된 것이니 위 winget 명령을 다시 실행하세요.

### 0-3. NVIDIA CUDA Toolkit 설치

먼저 드라이버가 지원하는 최대 CUDA 버전을 확인하세요.

```powershell
nvidia-smi
```

우측 상단에 표시되는 CUDA 버전을 확인합니다(RTX 50시리즈/Blackwell은 **12.8 이상 필수**). [developer.nvidia.com/cuda-downloads](https://developer.nvidia.com/cuda-downloads)에서 Windows용 설치 프로그램을 받아 실행하세요(**express(권장) 설치**로 충분합니다). 여러 버전이 필요하면 같은 페이지의 [Archive](https://developer.nvidia.com/cuda-toolkit-archive)에서 특정 버전을 받을 수 있습니다.

설치 확인 — 새 PowerShell 창에서:

```powershell
nvcc --version
```

버전이 출력되지 않으면 설치가 안 됐거나 PATH가 반영되지 않은 것입니다(재부팅 후 재시도).

## 빌드

```powershell
git clone -b dev --depth 1 https://github.com/0xShug0/audio.cpp.git engine/audio.cpp
cd engine/audio.cpp
.\scripts\build_windows.ps1 -Preset windows-cuda-release -Target audiocpp_cli `
  -ModelSet custom -Models yue2 -CudaArchitectures 120a-real -Jobs 18
```

- `engine/`은 프로젝트 루트 기준 권장 위치이며 `.gitignore`에 등록되어 있습니다 (대용량 서드파티 소스 트리는 커밋하지 않음).
- `-ModelSet custom -Models yue2`: yue2만 빌드합니다. 기본값 `full`은 60개 이상 모델 패밀리를 전부 빌드해 훨씬 오래 걸립니다.
- `-CudaArchitectures 120a-real`: RTX 50시리즈(Blackwell, sm_120) 전용 아키텍처를 명시합니다. 다른 GPU라면 `-CudaArchitectures auto`(로컬 GPU 자동 감지)를 사용하세요.
- 결과물: `engine/audio.cpp/build/windows-cuda-release/bin/audiocpp_cli.exe`

빌드 전에 설정만 빠르게 검증하려면 `-ConfigureOnly`를 추가해 CMake configure만 실행할 수 있습니다.

## 확인

```powershell
.\build\windows-cuda-release\bin\audiocpp_cli.exe --list-loaders   # "yue2: gen (offline)" 확인
.\build\windows-cuda-release\bin\audiocpp_cli.exe --list-devices   # CUDA GPU 인식 확인
```

## 모델 파일

`scripts/download_models.py`로 이미 받아둔 `models/audio-cpp/Yue2-3B-GGUF` 폴더를 그대로 사용합니다. `model_specs/yue2.json`의 `target_directory: "Yue2-3B-GGUF"` 레이아웃(`sidecars/*` + `.gguf` 파일들)과 정확히 일치하므로 재다운로드가 필요 없습니다.

## 실행 (SongYUE2 없이 CLI 직접 테스트)

```powershell
.\build\windows-cuda-release\bin\audiocpp_cli.exe `
  --task gen --family yue2 `
  --model "C:\Claude\SongYUE2\models\audio-cpp\Yue2-3B-GGUF" `
  --backend cuda --threads 8 `
  --session-option yue2.model_gguf=yue2-3b-q4_0.gguf `
  --session-option yue2.vae_gguf=yue2-vae-f16.gguf `
  --lyrics "[Verse]`nSoft evening light is touching the window." `
  --request-option style="Korean, warm acoustic pop, gentle guitar, soft vocal" `
  --request-option cot=off `
  --request-option num_inference_steps=8 `
  --seed 831001 `
  --out test.wav --log --metrics
```

RTX 5070(12GB) 기준 Q4_0 + F16 VAE 조합으로 58초 분량 음악을 22.9초에 생성 검증(2026-09-12, RTF 0.395). BF16+F32 VAE는 약 12.5GB, Q8_0+F16 VAE는 약 8.9GB, Q4_0+F16 VAE는 약 7.8GB 피크 VRAM(RTX 5090 기준 실측, `audio-cpp/Yue2-3B-GGUF` README) — 12GB 카드에는 Q4_0+F16 VAE를 우선 권장합니다.

## SongYUE2 앱에 연결

빌드한 `audiocpp_cli.exe`의 전체 경로를 다음 중 하나로 지정하면 앱의 `/api/generate`가 이 엔진을 실제로 호출합니다.

- 설정 화면의 "audio.cpp 실행 파일" 필드, 또는
- `.env`의 `ENGINE_PATH` (최초 실행 시 설정의 기본값으로 사용됨)

모델 선택(Q4/Q8/BF16)에 따라 자동으로 맞는 GGUF 본체+VAE 조합이 선택됩니다. 자세한 API 동작은 [local-api.md](local-api.md)를 참고하세요.

## "악기만"/ABC 커버를 GGUF에서 쓰려면 Python도 필요

GGUF 모델로 최종 오디오를 생성하는 데는 이 문서만으로 충분하지만, "악기만" 생성이나 ABC 악보 기반 커버/심볼릭 작곡을 쓰려면 ABC 준비 단계(계획 생성, 보컬 성부 뮤트)가 항상 공식 Python 엔진(`abc_tools.py`)을 거칩니다. 이 기능들까지 쓰려면 [python-engine-setup.md](python-engine-setup.md)의 Python 환경 구성도 함께 해야 합니다.

## 자주 만나는 문제

| 증상 | 원인 / 해결 |
|---|---|
| `'cl' is not recognized`, MSVC 컴파일러를 못 찾음 | C++ workload 없이 Build Tools만 설치됨 — 0-2번의 winget 명령을 다시 실행하거나, Visual Studio Installer를 열어 workload를 추가 |
| CMake가 CUDA 컴파일러를 못 찾음 | CUDA Toolkit 설치 후 새 PowerShell 창을 열지 않음 — 터미널 재시작(그래도 안 되면 재부팅) |
| `no kernel image is available for execution`, 또는 빌드는 되는데 실행 시 GPU 인식 실패 | `-CudaArchitectures`가 내 GPU와 안 맞음 — `120a-real`(RTX 50시리즈 전용) 대신 `auto`로 다시 빌드 |
| 빌드가 너무 오래 걸림 | `-ModelSet full`로 잘못 실행했을 가능성 — `-ModelSet custom -Models yue2`인지 확인 |
| `--list-loaders`에 `yue2`가 안 보임 | `dev` 브랜치가 아니라 `main`을 클론했을 가능성 — `git branch`로 확인(`-b dev`로 다시 클론) |
| 모델 파일이 없다는 오류 | `scripts/download_models.py`를 아직 안 돌렸거나 중간에 중단됨 — 다시 실행하면 이어받기 |
| VRAM 부족(OOM) | 더 작은 양자화(BF16→Q8→Q4) 또는 F16 VAE 조합으로 모델 선택 변경 |
