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
  -ModelSet custom -Models "yue2,htdemucs,bs_roformer,audiosr,muscriptor,seed_vc" -CudaArchitectures 120a-real -Jobs 18
```

- `engine/`은 프로젝트 루트 기준 권장 위치이며 `.gitignore`에 등록되어 있습니다 (대용량 서드파티 소스 트리는 커밋하지 않음).
- **`-Models` 값은 반드시 따옴표로 감싸세요.** `build_windows.ps1`의 `-Models` 파라미터는 `[string]` 타입인데, 따옴표 없이 `-Models yue2,htdemucs`처럼 쓰면 PowerShell이 쉼표를 배열 연산자로 해석해 `System.String`으로 변환할 수 없다는 `ParameterBindingArgumentTransformationException` 오류가 납니다(2026-09-16 실측 확인) — 항상 `-Models "yue2,htdemucs,bs_roformer,audiosr,muscriptor,seed_vc,vevo2"`처럼 통째로 문자열로 감싸세요.
- `-ModelSet custom -Models "yue2,htdemucs,bs_roformer,audiosr,muscriptor,seed_vc,vevo2"`: 음악 생성(yue2), 완성곡 메뉴의 STEM 분리 두 모드(htdemucs=보컬/드럼/베이스/기타 4갈래, mel_band_roformer=보컬/악기 2갈래, 보컬 누출이 더 적음), "음원 복원" 메뉴의 AudioSR(오디오 초해상도), "MIDI로 내보내기"의 MuScriptor, "보컬 음색 변환"의 두 엔진 Seed-VC와 Vevo2를 빌드합니다. `bs_roformer`와 `mel_band_roformer`는 같은 CMake 모듈(`roformer`)의 별칭이라 `bs_roformer`를 적어도 두 로더가 함께 빌드됩니다 — 실제로 쓰는 건 mel_band_roformer뿐입니다. 안 쓸 기능이 있으면 해당 토큰을 빼도 됩니다(그 메뉴만 비활성화됨). 새 모델 패밀리를 추가할 때는 CMake가 이미 빌드된 나머지를 재사용하고 새 패밀리 소스만 컴파일하므로(2026-09-17 실측: vevo2 추가에 13개 오브젝트만 다시 빌드, 수 초 소요) 매번 전체를 새로 빌드할 필요는 없습니다. 기본값 `full`은 60개 이상 모델 패밀리를 전부 빌드해 훨씬 오래 걸립니다.
- `-CudaArchitectures 120a-real`: RTX 50시리즈(Blackwell, sm_120) 전용 아키텍처를 명시합니다. 다른 GPU라면 `-CudaArchitectures auto`(로컬 GPU 자동 감지)를 사용하세요.
- 결과물: `engine/audio.cpp/build/windows-cuda-release/bin/audiocpp_cli.exe`

빌드 전에 설정만 빠르게 검증하려면 `-ConfigureOnly`를 추가해 CMake configure만 실행할 수 있습니다.

## 확인

```powershell
.\build\windows-cuda-release\bin\audiocpp_cli.exe --list-loaders   # "yue2: gen (offline)"와 "htdemucs: sep (offline)" 둘 다 확인
.\build\windows-cuda-release\bin\audiocpp_cli.exe --list-devices   # CUDA GPU 인식 확인
```

## 모델 파일

`scripts/download_models.py`로 이미 받아둔 `models/audio-cpp/Yue2-3B-GGUF` 폴더를 그대로 사용합니다. `model_specs/yue2.json`의 `target_directory: "Yue2-3B-GGUF"` 레이아웃(`sidecars/*` + `.gguf` 파일들)과 정확히 일치하므로 재다운로드가 필요 없습니다. STEM 분리용 HTDemucs 모델(`models/audio-cpp/audio.cpp-gguf/HTDemucs-GGUF/htdemucs-q8_0.gguf`, 약 59MB)과 Mel-Band RoFormer 모델(`models/audio-cpp/audio.cpp-gguf/Mel-Band-RoFormer-GGUF/mel-band-roformer-f16.gguf`, 약 435MB), "음원 복원"용 AudioSR 모델(`models/audio-cpp/audio.cpp-gguf/AudioSR-GGUF/audiosr-basic-f32.gguf`, 약 6.18GB), "MIDI로 내보내기"용 MuScriptor 모델(`models/audio-cpp/audio.cpp-gguf/MuScriptor-Small-GGUF/muscriptor-small-f32.gguf`, 약 412MB)도 같은 스크립트가 함께 받습니다.

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

## STEM 분리 (보컬/드럼/베이스/기타 악기)

완성곡 메뉴에 STEM 분리 모드가 2개 있습니다. 둘 다 같은 `audiocpp_cli.exe`를 쓰고, 소스 오디오만 먼저 `ffmpeg`로 44.1kHz로 변환합니다.

| 메뉴 항목 | `--family` | 모델 파일 | 결과 | 특징 |
|---|---|---|---|---|
| STEM 분리 (보컬+악기) | `mel_band_roformer` | `models/audio-cpp/audio.cpp-gguf/Mel-Band-RoFormer-GGUF/mel-band-roformer-f16.gguf` | `vocals`, `instrumental` (2갈래) | 다른 아키텍처라 보컬 누출이 더 적음. 매우 빠름(RTX 5070에서 2분 12초 곡 기준 약 10초, RTF 0.076) |
| STEM 분리 (보컬+드럼+베이스+기타) | `htdemucs` | `models/audio-cpp/audio.cpp-gguf/HTDemucs-GGUF/htdemucs-q8_0.gguf` | `vocals`, `drums`, `bass`, `other` (4갈래) | 악기별로 더 세분화되지만, 엔진이 고품질 앙상블("bag"/ft) 모델은 지원 안 해서(`"HTDemucs package-spec loader currently supports only single-model manifests"`) 단일 체크포인트만 사용 — 보컬 누출이 상대적으로 더 있을 수 있음. 매우 빠름(같은 곡 기준 약 5~7초, RTF 0.037) |

**2026-09-14: bs_roformer(ep368) → mel_band_roformer(F16)로 교체.** 처음엔 bs_roformer를 "보컬+악기" 모드로 썼는데, 사용자가 실제로 들어보고 "보컬이 너무 많이 짤린다"고 지적했습니다. `num_overlap`을 4→8로 올려 실측 비교했지만 코사인 유사도 0.9996, 무음 구간 개수도 거의 동일해 overlap은 원인이 아님을 확인(자세한 수치는 [revision.md](../revision.md) 참고). `model_specs/`를 전체 확인해보니 audio.cpp가 sep 작업을 지원하는 RoFormer 계열 패밀리가 `bs_roformer` 외에 `mel_band_roformer`도 있었고(같은 코드 경로, 다른 체크포인트), F16 GGUF를 받아 같은 곡으로 비교한 결과(코사인 0.97 — 실제로 다른 결과) 사용자가 직접 듣고 mel_band 쪽을 선호해서 교체했습니다. 참고로 `mel_band_roformer.json`에는 3번째 패키지(`mlx-community/mel-roformer-mlx`, safetensors)도 있지만 메타데이터가 없어 검증하지 않았습니다.

위 빌드 명령에 두 모델을 포함하지 않았다면 해당 메뉴를 눌렀을 때 "STEM 분리 모델(HTDemucs)이 없습니다"/"STEM 분리 모델(Mel-Band RoFormer)이 없습니다" 오류가 납니다 — `-Models "yue2,htdemucs,bs_roformer,audiosr,muscriptor,seed_vc"`로 다시 빌드하세요(`bs_roformer` 별칭이 `mel_band_roformer` 로더도 같이 빌드합니다). bs_roformer의 GGUF는 "legacy model spec"을 내장하고 있어 `model_specs/bs_roformer.json`으로 보충해야 했는데(mel_band_roformer GGUF는 이 문제가 없음), 백엔드가 `audiocpp_cli.exe`를 audio.cpp 소스 루트(`engine/audio.cpp`)를 작업 디렉터리로 실행해 이 조회가 항상 되도록 일괄 처리합니다(직접 CLI 테스트할 땐 `engine/audio.cpp` 안에서 실행해야 함).

분리된 STEM은 곡당 몇 초~수십 초 안에 만들어지는 임시 파일이며, STEM 분리 창을 닫으면 자동으로 지워지고 원본 완성곡은 바뀌지 않습니다.

## 채널 분리 (왼쪽/오른쪽)

완성곡 메뉴의 "채널 분리"(STEM 분리 바로 위)는 AI 분리 모델을 전혀 쓰지 않는, 순수 ffmpeg 채널 분리입니다 — `audiocpp_cli`/모델 파일이 전혀 필요 없습니다. `ffprobe`로 채널 수를 확인해 스테레오(2채널)가 아니면 명확한 오류로 거부하고, 맞으면 `ffmpeg -filter_complex channelsplit`로 왼쪽/오른쪽을 각각 모노 파일로 분리합니다. STEM 분리와 똑같은 다이얼로그/후처리/합치기 UI를 재사용합니다(내부적으로 `STEM_MODE_CONFIG`에 `channel` 모드를 추가한 것뿐, 프론트엔드 다이얼로그 코드는 그대로).

## 음원 복원 (AudioSR)

"음원 복원" 메뉴(왼쪽 하단 사이드바)는 저음질 외부 오디오 파일을 업로드하면 AudioSR(오디오 초해상도, `--task s2s --family audiosr`)로 복원해 새 완성곡으로 라이브러리에 저장합니다. **AudioSR은 출력을 무조건 모노로 만드는 모델 자체 한계**(우회 옵션 없음, 2026-09-15 실측 확인)가 있어서, 스테레오 입력은 `ffprobe`로 채널 수를 확인한 뒤 `channelsplit`로 왼쪽/오른쪽을 분리해 각각 AudioSR을 돌리고 `join` 필터로 다시 합칩니다(모노 입력은 그대로 1회만 처리). 곡 하나(20초 기준 채널당 약 15초, RTF 0.74)당 스테레오면 AudioSR을 2번 돌리므로 시간이 그만큼 더 걸립니다.

이미 무손실인 오디오(예: SongYUE2 자체 생성곡)에 돌리면 개선 효과가 없습니다 — 실제로 정보가 소실된 저음질 소스(오래된 저비트레이트 mp3, 여러 번 재인코딩된 파일 등)에만 효과가 있습니다. 2026-09-16 실측: 11kHz 모노/24kbps mp3로 열화시킨 뒤 복원한 결과, 6kHz 이상 고음 평균 에너지가 -59.5dB(열화)→-51.0dB(복원, 무손실 원본은 -42.6dB)로 실제 개선을 확인했습니다.

모델 파일이 없으면 "AudioSR 모델이 없습니다. scripts/download_models.py를 실행해 주세요." 오류가 납니다. 빌드에 `audiosr`을 포함하지 않았으면 "AudioSR 엔진을 실행할 수 없습니다" 계열 오류가 날 수 있습니다 — 위 빌드 명령에 `audiosr`이 포함됐는지 확인하세요.

## MIDI로 내보내기 (MuScriptor)

완성곡 메뉴의 "MIDI로 내보내기"는 audio.cpp의 MuScriptor(`--task midi --family muscriptor`)로 오디오를 심볼릭 노트 이벤트로 변환해 표준 MIDI 파일(.mid)로 저장합니다. AudioSR과 달리 `model_specs/muscriptor.json`에 `"status": "supported"`로 표시되어 있고(실험적 아님), 실측 속도도 매우 빠릅니다(RTX 5070에서 30초 곡 기준 약 0.7초, RTF ≈ 0.024 — 실시간의 42배). 소스는 먼저 ffmpeg로 44.1kHz 스테레오 WAV로 정규화한 뒤 변환합니다. 결과 `.mid`는 완성곡과 같은 폴더에 캐시되어(`<곡 파일명>.mid`), 원본이 바뀌지 않는 한 다시 누르면 즉시 받아집니다(재변환 없음).

버튼을 누르면 바로 다운로드되지 않고, 추출된 음표를 SVG 피아노롤 팝업(MIDI 편집기)으로 먼저 보여줍니다. 음표를 클릭해 선택하거나 삭제하고, 몸통을 끌어 이동, 가장자리를 끌어 길이를 조절하고, 빈 공간을 클릭해 새 음표를 추가할 수 있습니다. "▷ 미리듣기" 버튼으로 지금 편집 중인(아직 저장하지 않은) 노트 상태를 브라우저 안에서 바로 들어볼 수 있습니다 — Web Audio API의 오실레이터+엔벨로프로 만든 간단한 신디사이저 소리(악기 태그별로 파형이 다름)이며, 실제 악기 음색을 정확히 모사하지는 않습니다. 재생 중에는 피아노롤 위로 재생 위치가 표시되고, 음표를 편집하면 자동으로 멈춥니다. "취소"는 그대로 닫고, "저장"은 편집한 노트 목록을 서버로 보내 `.mid`를 다시 인코딩합니다(MuScriptor는 오디오→MIDI 단방향 변환만 지원하므로, "편집된 노트→MIDI" 재인코딩은 SongYUE2가 `backend/midi.mjs`에 직접 구현한 표준 MIDI 인코더가 담당합니다). 팝업 안의 "다운로드" 버튼으로 언제든 현재 캐시된 `.mid`를 받을 수 있습니다. 정확한 음색으로 확인하려면 저장 후 파일을 DAW 등에서 열어 주세요.

```powershell
audiocpp_cli --task midi --family muscriptor `
  --model models/audio-cpp/audio.cpp-gguf/MuScriptor-Small-GGUF/muscriptor-small-f32.gguf `
  --backend cuda --audio song.wav --out result.mid --text-out result.json
```

모델 파일이 없으면 "MuScriptor 모델이 없습니다. scripts/download_models.py를 실행해 주세요." 오류가 납니다. 빌드에 `muscriptor`가 빠져 있으면 "MuScriptor 엔진을 실행할 수 없습니다" 계열 오류가 날 수 있습니다.

## 보컬 음색 변환 (Seed-VC)

완성곡 메뉴의 "보컬 음색 변환"은 audio.cpp의 Seed-VC(`--task svc --family seed_vc --task-route v1_svc`, Singing Voice Conversion)로 곡의 보컬을 다른 목소리로 바꿉니다. RVC(`model_specs/rvc.json`, `"status": "experimental"`, 패키지에 내장된 4개 음색 중에서만 선택 가능)보다 Seed-VC(`model_specs/seed_vc.json`, `"status": "supported"`)를 선택했습니다 — 실험적이지 않고, 사용자가 올린 임의의 짧은 참조 오디오만으로 제로샷 변환(`speaker_reference` capability)이 가능하기 때문입니다.

Seed-VC는 보컬 트랙 하나만 변환하는 모델이라, 생성 단계에서 참조 음색을 받는 건 불가능합니다(YuE2 자체에 참조 오디오 기반 화자 임베딩 입력이 없음, "커버" 기능 때 확인된 제약과 동일) — 그래서 이 기능은 완성곡에 대한 **후처리**로만 동작합니다. RVC/Seed-VC류 음색 변환 모델은 항상 "보컬/반주 분리 → 보컬만 변환 → 반주와 재합성" 구조를 거쳐야 하므로(모델의 content-feature 추출기가 깨끗한 보컬 단독 신호로 학습돼 있어 믹스를 그대로 넣으면 안 됨), UI도 이 구조를 그대로 보여주는 STEM 분리 다이얼로그(STEM1) 골격을 재사용합니다 — 왼쪽 사이드바에서 참조 음색 선택+적용, 적용되면 보컬/악기 두 트랙이 각각 나타나 개별 "후처리"(EQ/FX)가 가능하고, 아래엔 원본/미리듣기 비교가 있습니다:

1. 사이드바에서 제목을 확인하고, 목표 음색의 참조 오디오 파일을 고른 뒤 "적용"을 누릅니다. 서버가 Mel-Band RoFormer STEM 분리(`vocal` 모드)로 완성곡을 보컬/반주로 나눈 뒤(최초 1회만), 분리된 보컬과 참조 음색(ffmpeg로 44.1kHz 모노 WAV로 정규화)을 Seed-VC SVC(`v1_svc` 라우트)에 넣어 보컬만 변환합니다. **변환 직후 음량 보정**: Seed-VC 출력이 원본 보컬보다 조용하게 나오는 경우가 실측으로 확인돼(약 7~8dB), `ffmpeg -af volumedetect`로 변환 전/후 평균 음량을 재서 그 차이만큼(-6~+18dB로 clamp) `-af "volume=XdB,alimiter=limit=0.97:level=false"`로 게인+피크 리미팅을 같이 적용한 뒤(게인만 넣으면 원본 출력 피크가 이미 높아서 하드클리핑함) STEM 폴더의 `vocals.wav`를 이 결과로 덮어씁니다.
2. 보컬/악기 두 트랙이 STEM1처럼 나타나고, 각 트랙 옆의 "후처리" 버튼으로 EQ/FX를 개별 적용할 수 있습니다. "합치기"를 누르면 두 트랙(후처리 반영)을 브라우저에서 Web Audio로 합쳐 아래 "미리듣기" 파형이 갱신됩니다.
3. 다른 참조 오디오로 다시 "적용"을 누르면 이미 분리해둔 원본 보컬을 재사용해 **보컬만 다시 변환**합니다(STEM 분리는 다시 하지 않음, 악기 트랙에 적용한 후처리도 유지됨).
4. "저장"을 누르면 브라우저에서 합친 최종 WAV를 서버로 올려 새 완성곡으로 라이브러리에 저장합니다(원곡은 그대로 유지).

```powershell
audiocpp_cli --task svc --family seed_vc `
  --model models/audio-cpp/audio.cpp-gguf/SeedVC-MLX-GGUF/seed-vc-mlx-q8_0.gguf `
  --backend cuda --task-route v1_svc --request-option f0_condition=true `
  --audio vocals.wav --voice-ref target-voice.wav --out converted-vocals.wav
```

**`f0_condition=true`가 꼭 필요한 이유(2026-09-16 실측)**: `model_specs/seed_vc.json`/`docs/models/seed_vc.md`에 따르면 `v1_svc` 라우트의 `f0_condition`(피치 컨디셔닝) 기본값은 `false`입니다. 이걸 빼고 노래(SVC) 변환을 하면 모델이 원본 보컬의 피치 궤적을 전혀 참고하지 않아, 결과물이 "꽥꽥거리는" 로봇 잡음에 가깝게 나옵니다(사용자 제보, 모델 정밀도를 바꿔도 재현되어 모델 자체 문제가 아님을 확인) — 원곡/변환곡 스펙트로그램(`ffmpeg -lavfi showspectrumpic`)을 비교해 확정: `f0_condition` 없이는 하모닉 밴딩이 거의 없는 뭉개진 broadband 잡음+구간 타이밍이 원곡과 어긋났고, 추가 후에는 하모닉이 선명해지고 타이밍도 원곡과 일치했습니다.

**실측**: RTX 5070에서 RTF ≈ 0.82(실시간보다 조금 빠름) — 40초 보컬 클립을 약 33초에 변환(2분 11초 완성곡 전체는 보컬 분리+변환+음량 보정까지 합쳐 약 2분 전후 소요). MuScriptor/HTDemucs류보다 훨씬 느리고 AudioSR과 비슷한 체감 속도라, "적용" 버튼에 진행률 폴링 UI(`generating`/`/api/generate/status`)를 사용합니다. 2분 11초짜리 실제 완성곡으로 브라우저에서 종단 검증 완료(참조 음색 업로드 → 적용 → 보컬/악기 STEM 확인 → 합치기 → 저장까지 전부 확인, 결과 길이가 원곡과 정확히 일치, ffmpeg astats로 클리핑 없음도 확인).

**음량 보정이 필요했던 이유(2026-09-16 실측)**: 최초 구현은 변환된 보컬을 그대로 반주와 합쳐서, 사용자가 "저장된 곡에 보컬이 아예 없고 악기만 남았다"고 제보 — `ffmpeg volumedetect`로 확인한 결과 Seed-VC 변환 보컬이 원본 보컬보다 평균 음량이 7.6dB 낮아서(-26.4dB → -34.0dB) 반주(-24.1dB)에 완전히 묻힌 것이 원인이었습니다. 게인 보정만 넣었더니 이번엔 원본 출력의 피크가 이미 -2.2dB 근처라 보정 후 0dBFS를 넘어 하드클리핑(실측 `max_volume` 정확히 0.0dB) — `alimiter=limit=0.97:level=false`를 추가해 게인은 유지하면서 피크만 눌러 해결했습니다(보정 후 mean -27.0dB≈원본과 거의 일치, peak -0.3dB로 클리핑 없음).

### "찢어지는 소리" 제보와 무음 구간 할루시네이션(2026-09-17 실측)

`f0_condition=true` 적용 후에도 "변환곡 보컬이 거의 찢어지는 소리만 난다"는 제보가 이어졌다. 직접 재현하며 확인한 두 가지 원인과 대응:

1. **Seed-VC 파라미터 튜닝의 한계**: 업스트림 `Plachtaa/seed-vc`의 Gradio UI 자체가 `num_inference_steps`는 "50~100 for best quality"를, `auto_f0_adjust`는 기본 `true`를 권장한다(audio.cpp CLI 기본값은 각각 30/`false`). `runSeedVcSvc()`에 `auto_f0_adjust=true`+`num_inference_steps=80`을 추가해 권장 조합과 맞췄지만, 문제가 된 구간에서 spectral flatness(0=순음, 1=잡음, `ffmpeg -af aspectralstats=measure=flatness`)로 직접 측정한 결과 전체 트랙 기준 거의 개선이 없었다(0.4657→0.4668) — 파라미터 튜닝만으로는 해결되지 않는 문제였다.
2. **진짜 원인 — 무음 구간 할루시네이션**: 분리된 원곡 보컬(`vocals-original.wav`)의 노래 사이 간격은 실측상 진짜 디지털 무음(-inf dB)인데, Seed-VC와 Vevo2 둘 다 이 구간에서도 스스로 무음을 출력하지 못하고 계속 소리를 만들어냈다(전체 트랙 스펙트로그램으로 확인: 원곡은 도입부 0~15.9초가 완전히 비어있는데 변환곡은 그 구간에도 밀도 높은 브로드밴드 에너지로 채워짐). 사용자가 "1:40쯤에 원곡 도입부가 다시 들리는 것 같다"고 보고한 현상이 바로 이것 — 시간축이 늘어진 게 아니라(duration 실측: 모든 변환 결과가 원곡과 101.6초로 정확히 일치, 샘플레이트 불일치 가설은 기각됨) 무음이어야 할 구간에 모델이 소리를 만들어 채워 넣은 것이다.

**해결**: `applyVocalTimbre()` 마지막 단계에 원곡 보컬을 사이드체인으로 쓰는 노이즈 게이트를 추가했다 — `ffmpeg -i leveled.wav -i vocals-original.wav -filter_complex "sidechaingate=threshold=0.003:ratio=20:attack=5:release=100:range=0.02" -ar 44100`. 원곡이 무음인 구간은 변환 결과도 강제로 무음 처리되고(게이트 후 실측 RMS -25dB → -57.7dB, 사실상 무음), 원곡이 노래하는 구간은 그대로 통과된다. 엔진(Seed-VC/Vevo2)과 무관하게 적용되고, `-ar 44100`이 Vevo2의 24kHz 네이티브 출력도 나머지 파이프라인과 같은 샘플레이트로 맞춰준다.

### 대체 엔진: Vevo2

Seed-VC의 참조 오디오 종류(발화 vs 노래)나 파라미터를 바꿔도 근본적인 음질 한계가 있어, `model_specs/vevo2.json`(`"status": "supported"`, `svc` task에 `speaker_reference`+`singing` capability)을 대체 엔진으로 추가했다. Seed-VC와 마찬가지로 제로샷(짧은 목표 음색 클립만 있으면 되고 별도 학습 불필요)이라 기존 UI 흐름을 그대로 재사용할 수 있다.

```powershell
audiocpp_cli --task svc --family vevo2 `
  --model models/audio-cpp/audio.cpp-gguf/Vevo2-GGUF/vevo2-q8_0.gguf `
  --backend cuda --task-route style_preserved_svc `
  --source-audio vocals.wav --target-voice target-voice.wav --out converted-vocals.wav
```

`style_preserved_svc`는 `svc` task의 기본 라우트로, 원곡의 창법/스타일을 유지하면서 목소리만 바꾼다. **주의**: 이 GGUF 패키지의 보코더는 네이티브 24kHz(Nyquist 12kHz)로 출력해 Seed-VC(44.1kHz, Nyquist 22kHz)보다 고음역 디테일이 적다 — `applyVocalTimbre()`의 게이트 단계에서 `-ar 44100`으로 리샘플링하지만 12kHz 위 대역이 새로 생기지는 않는다. 실측(2026-09-17)에서 Seed-VC 대비 뚜렷한 음질 우위는 확인되지 않았고(사용자 청취 확인 결과 "차이를 잘 모르겠다"), 무음 구간 할루시네이션 문제도 동일하게 있었다(위 게이트로 해결) — 그래서 어느 쪽이 더 나은지는 곡/참조 오디오에 따라 달라질 수 있다고 보고 `POST /vocal-timbre/apply`에 `engine: 'seed_vc' | 'vevo2'`를 받아 프론트에서 사용자가 선택하게 했다.

모델은 `models/audio-cpp/audio.cpp-gguf/Vevo2-GGUF/vevo2-q8_0.gguf`(Q8_0, 약 3.2GB)이며 `scripts/download_models.py`의 프리픽스 목록에 포함되어 있다. 빌드 시 `-Models`에 `vevo2`를 추가해야 한다(위 "audio.cpp 빌드" 섹션 참고) — 빠뜨리면 `audiocpp_cli failed: unsupported model family hint: vevo2`로 실패한다(실측 확인).

모델 파일이 없으면 "Seed-VC 모델이 없습니다. scripts/download_models.py를 실행해 주세요." 오류가 납니다. 결과물은 보컬 분리(STEM)와 음색 변환을 순서대로 거치므로 원곡보다 음질이 떨어질 수 있고, 참조 음색과의 유사도는 참조 오디오 품질(짧고 깨끗할수록 좋음)에 크게 좌우됩니다.

## "악기만"/ABC 커버를 GGUF에서 쓰려면 Python도 필요

GGUF 모델로 최종 오디오를 생성하는 데는 이 문서만으로 충분하지만, "악기만" 생성이나 ABC 악보 기반 커버/심볼릭 작곡을 쓰려면 ABC 준비 단계(계획 생성, 보컬 성부 뮤트)가 항상 공식 Python 엔진(`abc_tools.py`)을 거칩니다. 이 기능들까지 쓰려면 [python-engine-setup.md](python-engine-setup.md)의 Python 환경 구성도 함께 해야 합니다.

## 자주 만나는 문제

| 증상 | 원인 / 해결 |
|---|---|
| `'cl' is not recognized`, MSVC 컴파일러를 못 찾음 | C++ workload 없이 Build Tools만 설치됨 — 0-2번의 winget 명령을 다시 실행하거나, Visual Studio Installer를 열어 workload를 추가 |
| CMake가 CUDA 컴파일러를 못 찾음 | CUDA Toolkit 설치 후 새 PowerShell 창을 열지 않음 — 터미널 재시작(그래도 안 되면 재부팅) |
| `no kernel image is available for execution`, 또는 빌드는 되는데 실행 시 GPU 인식 실패 | `-CudaArchitectures`가 내 GPU와 안 맞음 — `120a-real`(RTX 50시리즈 전용) 대신 `auto`로 다시 빌드 |
| 빌드가 너무 오래 걸림 | `-ModelSet full`로 잘못 실행했을 가능성 — `-ModelSet custom -Models yue2,htdemucs,bs_roformer`인지 확인 |
| `--list-loaders`에 `yue2`가 안 보임 | `dev` 브랜치가 아니라 `main`을 클론했을 가능성 — `git branch`로 확인(`-b dev`로 다시 클론) |
| 모델 파일이 없다는 오류 | `scripts/download_models.py`를 아직 안 돌렸거나 중간에 중단됨 — 다시 실행하면 이어받기 |
| VRAM 부족(OOM) | 더 작은 양자화(BF16→Q8→Q4) 또는 F16 VAE 조합으로 모델 선택 변경 |

## Audio Tools 모델 (TTS / 음성 인식 / 대사 편집)

"오디오 도구" 페이지의 TTS·음성 인식 모델은 **앱에서 모델·크기·정밀도를 고르고 "모델 받기"로 내려받는다**(`backend/tts.mjs`의 카탈로그, 이어받기 지원, 저장 위치 `models/audio-cpp/audio.cpp-gguf/<폴더>/`). `scripts/download_models.py`의 프리픽스 목록에는 넣지 않았다.

엔진에 패밀리가 컴파일돼 있어야 한다(없으면 "unsupported model family hint"). 재빌드는 `engine\audio.cpp\run-build.ps1`을 실행한다(로그 `build-asr.log`, 끝에 `EXIT=0` 확인). 현재 `-Models` 목록:

```
yue2,htdemucs,bs_roformer,audiosr,muscriptor,seed_vc,vevo2,qwen3_tts,chatterbox,qwen3_asr,qwen3_forced_aligner,nemotron_asr,vibevoice_asr,voxcpm2,omnivoice,supertonic,fish_audio,magpie_tts,rvc,meanvc2,dots_tts
```

새 모델을 추가하는 절차: ① `-Models`에 패밀리 추가 후 재빌드 ② `backend/tts.mjs`의 `TTS_FAMILIES`/`ASR_FAMILIES`에 파일·크기·정밀도 등록 ③ `buildTtsArgs`에 CLI 인자 분기 추가 ④ 한국어 문장으로 실측(`test/tts-model-comparison/`). 한국어를 지원하지 않는 모델은 넣지 않는다.

### 대사 편집 (DotTTS Edit)

Audio Tools의 "대사 편집" 탭은 `dots_tts` 패밀리의 DotTTS Edit(Q8 약 2.8GB, BF16 약 4.6GB, 폴더 `DotTTS-Edit-GGUF`)를 쓴다. `-Models`에 `dots_tts`가 있어야 한다. 원본 말소리 + 태그가 든 텍스트(`<sub targ="새 말">옛 말</sub>`, `<del>`, `<ins>`)로 편집하며, 태그 없이 원문/목표 문장만 주면 편집이 적용되지 않는다(실측). 화면은 원문(STT 자동 받아쓰기 가능)과 편집 항목(바꾸기/지우기/앞에 넣기/뒤에 넣기, "모두"=같은 말 전부)을 받아 서버(`buildEditText`)가 태그로 바꾼다. 한국어 실측: 지우기·넣기는 정확, 바꾸기는 한 글자 짧은 단어와 문장 전체 교체에서 발음이 어긋남. 노래는 지원하지 않는다. `--language`(ko/en/ja/zh) 지정 여부에 따라 결과가 달라질 수 있어 화면에서 고르게 했다.

한국어 실측(2026-09-24): 한 문장에 같은 짧은 단어를 여러 번 바꾸거나 긴 문장을 편집하면, 손대지 않은 이웃 단어("합성"→"한성")도 깨질 수 있다(모델이 문장 전체를 다시 합성하기 때문). 문장 단위로 잘라 한 곳씩 편집하는 것이 안전하다. Q8과 BF16의 품질 차이는 거의 없었다. 다른 편집 모델: Vevo2 편집은 en/zh만 지원, FireRedTTS3 Instruct(`semantic_edit`, 지시문 `Replace 'A' with 'B'.`)는 영어는 정확하지만 한국어 음성을 이해하지 못해 편집이 적용되지 않아 제외했다.

**정밀 편집(단어 단위, 2026-09-24)**: `Qwen3-ForcedAligner-0.6B-GGUF`(Q8 약 1.1GB, `-Models`의 `qwen3_forced_aligner`는 이미 빌드됨)로 문장을 단어별로 정렬해(`--task align --words-out`, 16 kHz 샘플 단위, 80 ms 격자) 바꿀 단어 + 앞뒤 2단어만 잘라 DotTTS Edit로 다시 만들고, 결과를 한 번 더 정렬해 **편집한 단어 구간만** 원본 위치에 붙인다(앞뒤 단어는 문맥용으로만 쓰고 버림). 경계는 ±80 ms 안에서 가장 조용한 지점으로 맞춘다. 실측(문장 3개, 같은 단어 4회 교체): 문장 단위 편집은 이웃 단어("합성"→"한성")가 깨졌으나 정밀 편집은 모두 정확했다. 문맥 단어 0개는 편집한 단어 자체가 "양상"으로 깨지고, 3개는 오히려 나빠져 기본값 2로 정했다(문장 시작/끝처럼 한쪽이 모자라면 반대쪽이 그만큼 더 가져간다). DotTTS Edit 결과 앞에는 약 0.7초 무음이 붙어 나오므로 문맥 단어가 없는 쪽은 첫/마지막 단어 위치로 잘라낸다. 정밀 편집에는 편집 창당 DotTTS 1회 + 정렬 1회가 든다(문장 3개·편집 5곳에 약 45초).
