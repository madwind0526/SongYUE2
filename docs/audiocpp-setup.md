# audio.cpp 설치 (YuE2 GGUF 실행 엔진)

## 왜 소스 빌드가 필요한가

YuE2 지원은 [`0xShug0/audio.cpp`](https://github.com/0xShug0/audio.cpp)의 **`dev` 브랜치에만** 있습니다(`main`에는 0개 파일). GitHub Releases의 공식 프리빌드 Windows 바이너리는 `main`/태그 기준이라 **yue2가 포함되어 있지 않습니다.** 따라서 `dev` 브랜치를 직접 받아 소스에서 빌드해야 합니다. `model_specs/yue2.json`에 `"status": "experimental"`로 표시되어 있듯 아직 실험 단계입니다.

## 빌드 요구 사항 (Windows)

- Visual Studio Build Tools 2022 이상, C++ desktop workload (Visual Studio IDE 자체는 불필요)
- MSVC x64 컴파일러, Windows SDK, CMake, Ninja, MSVC OpenMP — 모두 VS2022 설치에 번들로 포함되어 있으면 별도 설치 불필요 (`...\Common7\IDE\CommonExtensions\Microsoft\CMake\{CMake,Ninja}\...`)
- NVIDIA CUDA Toolkit (RTX 50시리즈/Blackwell은 12.8 이상 필요)
- git

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
