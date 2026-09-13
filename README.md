# SongYUE2

내 PC에서 돌아가는 로컬 AI 음악 생성 스튜디오입니다. [YuE2](https://github.com/multimodal-art-projection/YuE2) 모델을 [audio.cpp](https://github.com/0xShug0/audio.cpp)(GGUF, 빠름) 또는 공식 Python 파이프라인(원본, 고VRAM)으로 실행해 가사와 스타일 프롬프트만으로 노래를 만들고, 라이브러리·프로젝트·재생목록·커버 아트까지 관리할 수 있습니다.

클라우드 없이 전부 로컬에서 동작하며, 데이터는 내 PC 밖으로 나가지 않습니다(작사 도우미로 클라우드 LLM을 켠 경우 그 요청만 예외).

## 주요 기능

- 가사 + 스타일 프롬프트 → 실제 음악 생성 (audio.cpp GGUF 3종 또는 원본 Python 모델)
- **진짜 "악기만" 생성**: ABC 악보의 보컬 성부를 화음 기호는 남긴 채 구조적으로 쉼표 처리(`abc_tools.py mute-voice`)해 확실하게 무보컬로 생성 — 원본 Python 모델과 GGUF(audio.cpp `--request-option abc_file=`) 모두 지원
- **심볼릭 작곡(ABC 악보)**: 멜로디/코드 계획 생성·검사·AI 지시 편집·오디오 재생(현재 음표 하이라이트), 오디오에서 멜로디 추출해 커버 만들기(SheetSage2, 실제 오디오로 종단 검증 완료), `.abc` 파일 기반 라이브러리(가져오기/저장/삭제) — ABC 악보 기반 생성(심볼릭 작곡/커버 포함)은 원본 Python 모델과 GGUF 모두에서 동작
- **완성곡 "커버" 원클릭**: 완성곡 메뉴의 "리믹스" 아래 "커버"를 누르면 그 곡의 오디오에서 멜로디/코드를 추출해 작곡 화면에 바로 채워 넣음(가사·스타일이 이미 있으면 유지할지 그 곡 설정으로 바꿀지 확인). 단, 실제 보컬 음색/톤까지 가져오는 기능은 아님 — 멜로디·코드와 성별 힌트만 전달됨
- **후처리 / EQ 스튜디오**: 완성곡을 브라우저에서 실시간으로 미리 들으며 10밴드 EQ(프리셋 포함)·FxSound 노브(선명도/공간감/서라운드/다이내믹부스트/베이스부스트)·리버브·에코를 조절하고, 원본 파일은 그대로 둔 채 처리된 사본을 원래 파일 형식으로 저장. 재생 중인 트랙을 실시간 원형 비주얼라이저로 표시
- 라이브러리(완성곡) / 프로젝트(초안·설정) 완전 분리 — 하나를 지워도 다른 하나는 그대로 유지
- 재생목록 생성 및 PC에서 연속 재생, 앨범 커버 등록
- wav / flac / mp3 / mp4 다중 포맷 다운로드
- Ollama / Claude / ChatGPT / Gemini 중 선택해 가사·스타일 작성 도우미로 사용(선택 사항, 꺼도 전체 기능 동작)
- 목록/카드 보기, 좋아요, 예시 둘러보기 등 Suno 스타일 UI(로컬 단일 사용자에 맞게 재구성)

## 요구 사항

전부 Windows 기준입니다(다른 OS는 검증되지 않았습니다).

| 항목 | 필요 여부 | 비고 |
|---|---|---|
| NVIDIA GPU (CUDA), 최신 드라이버 | 필수 | 어떤 모델/엔진을 쓰든 음악 생성 자체는 GPU가 필요합니다 |
| Node.js 24 이상, npm | 필수 | 앱 서버/프론트엔드 실행 |
| Python 3(64비트) | 필수 | `scripts/download_models.py`(표준 라이브러리만 사용, 별도 pip 설치 불필요) 실행에 필요 |
| git | 필수 | audio.cpp/YuE2 소스를 받는 데 필요 |
| Visual Studio 2022 C++ workload, CUDA Toolkit, [uv](https://docs.astral.sh/uv/) | 엔진별 선택 | 아래 "설치" 3단계 참고 — 최소 하나는 있어야 실제 곡 생성이 됩니다 |
| ffmpeg (PATH 등록) | 선택 | wav 이외 형식(flac/mp3/mp4) 저장·다운로드, SheetSage2 커버 기능에 필요 |
| 디스크 여유 공간 | 넉넉히 | 모델 가중치만 약 23.3GB(항상 전부 다운로드, 선택 불가), 엔진 빌드/가상환경은 별도로 각 15~20GB. 아래 표 참고 |

**디스크/네트워크 용량 요약** (자세한 내용은 [docs/models.md](docs/models.md), [docs/audiocpp-setup.md](docs/audiocpp-setup.md), [docs/python-engine-setup.md](docs/python-engine-setup.md)):

| 구성 요소 | 용량 | 필요한 경우 |
|---|---|---|
| `scripts/download_models.py` 전체 다운로드 | 약 23.3GB | **선택 옵션이 없어 항상 4개 저장소 전부를 받습니다** — GGUF만 쓸 계획이어도 원본 모델(7.79GB)이 함께 받아짐 |
| audio.cpp 소스 빌드(engine/) | 소스는 작지만 CUDA Toolkit·VS Build Tools 자체가 수 GB | GGUF 모델(Q4/Q8/BF16) 사용 시 |
| YuE2 원본 Python venv(test/YuE2-source/.venv) | 약 15~20GB(torch+CUDA 휠 포함, `.uv-cache` 삭제 전 기준) | "YuE2 - 원본" 모델 사용 시 |
| SheetSage2 전용 venv(test/YuE2-source/.venv-sheetsage2) + 모델 | 약 2GB(venv) + 2GB(모델, 첫 전사 시) | "커버"/"오디오에서 추출" 기능 사용 시 |

## 설치

처음부터 끝까지 순서대로 따라가면 됩니다. 전부 PowerShell 기준입니다.

### 0단계. 기본 도구 설치 (git / Node.js / Python)

이미 설치되어 있다면 버전 확인만 하고 넘어가세요.

```powershell
git --version
node -v
python --version
```

- `node -v`가 `v24` 미만이거나 안 나오면:
  ```powershell
  winget install --id OpenJS.NodeJS.LTS -e
  ```
- `python --version`이 안 나오면:
  ```powershell
  winget install --id Python.Python.3.12 -e
  ```
- `git --version`이 안 나오면:
  ```powershell
  winget install --id Git.Git -e
  ```

**winget으로 설치한 뒤에는 반드시 PowerShell 창을 완전히 닫았다가 새로 열어야** PATH가 반영되어 명령이 인식됩니다. 새 창에서 위 세 명령을 다시 실행해 버전이 나오는지 확인하세요.

GPU 드라이버도 미리 확인해 두면 좋습니다.

```powershell
nvidia-smi
```

GPU 이름과 CUDA 버전이 나오면 정상입니다. 이 명령 자체가 안 되면 [NVIDIA 드라이버](https://www.nvidia.com/Download/index.aspx)부터 설치하세요 — 이후 모든 엔진이 이 GPU를 사용합니다.

### 1단계. 저장소 클론 및 패키지 설치

```powershell
git clone https://github.com/madwind0526/SongYUE2.git
cd SongYUE2
npm install
npm install --prefix app
```

### 2단계. 환경 설정

```powershell
cp .env.sample .env
```

`.env`를 열어 필요한 값을 채우세요(전부 선택 사항이며, 앱 실행 후 설정 화면에서도 바꿀 수 있습니다). 지금 단계에서는 건너뛰고 아래 5단계에서 설정 화면으로 채워도 됩니다.

- 작사 도우미로 쓸 LLM(`LLM_PROVIDER`)과 해당 API 키
- 음악 생성 엔진 실행 파일 경로(`ENGINE_PATH`/`PYTHON_ENGINE_PATH`/`SHEETSAGE_PYTHON_PATH`) — 아래 3단계 참고
- 라이브러리 폴더 위치, 저장 파일 형식

### 3단계. 음악 생성 엔진 준비 (아래 중 최소 하나, 필요하면 여러 개)

세 가지는 서로 독립적입니다 — 필요한 기능에 맞춰 고르세요. 무엇을 설치하든 먼저 모델 가중치부터 받아야 합니다.

```powershell
python scripts/download_models.py
```

이 한 번의 실행으로 ①②가 쓸 모델(GGUF + 원본 Python 본체/VAE, 약 23.3GB)이 전부 받아집니다. 선택적으로 일부만 받는 옵션은 없습니다(GGUF만 쓸 계획이어도 원본 모델이 함께 받아짐). 시간이 오래 걸리며, 중단 후 재실행하면 이어받기/해시 검증을 하므로 다시 실행해도 안전합니다. ③ SheetSage2의 전사 모델은 이 스크립트가 아니라 별도로 받습니다(아래 참고). 완료되면 `model-download-status.json`의 각 저장소 `state`가 `"complete"`인지 확인하세요.

이제 아래 중 하나 이상을 골라 그 문서를 **처음부터 끝까지** 따라가세요(각 문서에 자체 "0단계 사전 준비"가 있습니다).

- **① audio.cpp (GGUF, 가장 가볍고 권장 시작점)**: Q4/Q8/BF16 GGUF 모델로 빠르게 생성합니다. Visual Studio 2022 C++ workload + CUDA Toolkit으로 소스에서 직접 빌드해야 합니다(사전 빌드 바이너리 없음 — yue2 지원이 아직 dev 브랜치 전용). → **[docs/audiocpp-setup.md](docs/audiocpp-setup.md)**
- **② 원본 Python 파이프라인 ("YuE2 - 원본" 모델)**: 24GB급 VRAM을 권장하는 공식 모델(12GB급도 메모리 예산을 낮추면 짧은 곡은 동작 확인됨). 공식 YuE2 저장소를 받아 `uv`로 전용 가상환경을 구성해야 합니다. → **[docs/python-engine-setup.md](docs/python-engine-setup.md)**
- **③ SheetSage2 (선택, "커버"/"오디오에서 추출" 기능 전용)**: 완성곡이나 업로드한 오디오에서 멜로디/코드를 ABC 악보로 추출합니다. ②와는 완전히 별도의 Python 가상환경이 필요합니다(버전 충돌 방지). `ffmpeg`도 PATH에 있어야 합니다. → **[docs/python-engine-setup.md](docs/python-engine-setup.md)의 SheetSage2 절**

> "심볼릭 작곡"·"악기만"·ABC 기반 커버는 최종 생성에 ①이나 ②를 쓰더라도, ABC 악보 준비(계획 생성/보컬 성부 뮤트) 자체는 항상 ②의 Python 엔진(`abc_tools.py`)을 거칩니다. 즉 GGUF만 쓰더라도 이 기능들을 쓰려면 ②의 Python 환경 구성이 필요합니다.

엔진 없이도 앱은 실행되며, 초안 작성/설정 저장, 라이브러리 탐색까지는 가능합니다. 실제 곡 생성만 안 됩니다 — 엔진 설치는 나중에 해도 됩니다.

### 4단계. 실행

```powershell
npm run dev
```

또는 Windows에서 `Start-SongYUE2.cmd`를 더블클릭하세요. 브라우저에서 `http://127.0.0.1:5173`으로 접속합니다.

### 5단계. 설정 화면에서 엔진 경로 연결

앱 실행 후 우측 상단 모델 선택 옆이나 좌측 메뉴의 "설정" 화면에서, 3단계에서 준비한 경로를 확인/입력하세요(`.env`에 이미 채웠다면 자동으로 기본값이 됩니다). 입력 후 "설정 저장"을 눌러야 반영됩니다.

| 설정 항목 | 가리켜야 할 경로 |
|---|---|
| audio.cpp 실행 파일 | `engine\audio.cpp\build\windows-cuda-release\bin\audiocpp_cli.exe` |
| Python 실행 파일 (원본 모델용) | `test\YuE2-source\.venv\Scripts\python.exe` |
| Python 스크립트 (run_yue2.py) | `test\YuE2-source\skills\yue2-music\scripts\run_yue2.py` |
| SheetSage2 Python 실행 파일 | `test\YuE2-source\.venv-sheetsage2\Scripts\python.exe` |

경로는 모두 SongYUE2 폴더 기준 상대 경로 또는 절대 경로를 쓸 수 있습니다.

### 6단계. 정상 동작 확인

1. 화면 상단의 연결 표시가 "로컬 연결됨"인지 확인하세요("로컬 연결 대기"이면 `npm run dev`가 아직 백엔드를 못 띄운 것 — 터미널의 에러 메시지를 확인).
2. "만들기" 화면에서 상단 모델 선택을 방금 설치한 엔진(예: GGUF만 설치했다면 "YuE2 - Q4")으로 맞추세요.
3. 예시 가사/스타일을 아무거나 채우고(간편 모드의 "예시로 시작하기"를 써도 됩니다) "노래 만들기"를 누르세요.
4. 처음 생성은 모델 로딩 때문에 더 오래 걸릴 수 있습니다. 진행률 표시줄이 끝까지 차고 라이브러리에 곡이 생기면 설치 완료입니다.
5. 실패하면 화면에 뜨는 오류 메시지와 함께 `runs/<프로젝트id>/generate.log`를 확인하세요(원본 Python 엔진은 `runs/<프로젝트id>/py-generate/`에 상세 산출물도 남습니다). 각 엔진 문서의 "자주 만나는 문제" 표도 참고하세요.

## 기타 명령어

```bash
npm test    # 백엔드 테스트
npm run check   # 프론트엔드 타입 체크
npm run build   # 프론트엔드 빌드
```

## 문서

- [docs/local-api.md](docs/local-api.md) — 로컬 API 엔드포인트 목록
- [docs/audiocpp-setup.md](docs/audiocpp-setup.md) — audio.cpp 빌드 및 연결 방법
- [docs/python-engine-setup.md](docs/python-engine-setup.md) — 원본 Python 엔진 + SheetSage2(커버) 설치 방법
- [docs/models.md](docs/models.md) — 지원 모델 안내
- [progress.md](progress.md) — 아직 남은 일 / 실제 환경 검증이 필요한 항목
- [revision.md](revision.md) — 커밋 단위 변경 이력

## 라이선스 안내

YuE2 모델 가중치(GGUF/원본 모두)는 CC BY-NC 4.0을 따릅니다. 비상업적 용도로만 사용하세요.
