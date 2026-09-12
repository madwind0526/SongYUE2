# SongYUE2

내 PC에서 돌아가는 로컬 AI 음악 생성 스튜디오입니다. [YuE2](https://github.com/multimodal-art-projection/YuE2) 모델을 [audio.cpp](https://github.com/0xShug0/audio.cpp)(GGUF, 빠름) 또는 공식 Python 파이프라인(원본, 고VRAM)으로 실행해 가사와 스타일 프롬프트만으로 노래를 만들고, 라이브러리·프로젝트·재생목록·커버 아트까지 관리할 수 있습니다.

클라우드 없이 전부 로컬에서 동작하며, 데이터는 내 PC 밖으로 나가지 않습니다(작사 도우미로 클라우드 LLM을 켠 경우 그 요청만 예외).

## 주요 기능

- 가사 + 스타일 프롬프트 → 실제 음악 생성 (audio.cpp GGUF 3종 또는 원본 Python 모델)
- **진짜 "악기만" 생성**: 원본 Python 모델에서는 ABC 악보의 보컬 성부를 화음 기호는 남긴 채 구조적으로 쉼표 처리(`abc_tools.py mute-voice`)해 확실하게 무보컬로 생성. GGUF 모델은 스타일 힌트로만 지원(구조적 보장 없음)
- **심볼릭 작곡(ABC 악보)**: 멜로디/코드 계획 생성·검사·AI 지시 편집·오디오 재생(현재 음표 하이라이트), 오디오에서 멜로디 추출해 커버 만들기(SheetSage2, 실제 오디오로 종단 검증 완료), `.abc` 파일 기반 라이브러리(가져오기/저장/삭제) — ABC 악보 기반 생성(심볼릭 작곡/커버 포함)은 원본 Python 모델 한정, GGUF는 지원하지 않음
- **후처리 / EQ 스튜디오**: 완성곡을 브라우저에서 실시간으로 미리 들으며 10밴드 EQ(프리셋 포함)·FxSound 노브(선명도/공간감/서라운드/다이내믹부스트/베이스부스트)·리버브·에코를 조절하고, 원본 파일은 그대로 둔 채 처리된 사본을 원래 파일 형식으로 저장. 재생 중인 트랙을 실시간 원형 비주얼라이저로 표시
- 라이브러리(완성곡) / 프로젝트(초안·설정) 완전 분리 — 하나를 지워도 다른 하나는 그대로 유지
- 재생목록 생성 및 PC에서 연속 재생, 앨범 커버 등록
- wav / flac / mp3 / mp4 다중 포맷 다운로드
- Ollama / Claude / ChatGPT / Gemini 중 선택해 가사·스타일 작성 도우미로 사용(선택 사항, 꺼도 전체 기능 동작)
- 목록/카드 보기, 좋아요, 예시 둘러보기 등 Suno 스타일 UI(로컬 단일 사용자에 맞게 재구성)

## 요구 사항

- Windows + NVIDIA GPU (CUDA)
- Node.js 24 이상
- (선택) audio.cpp 빌드용 Visual Studio 2022 C++ workload, CUDA Toolkit — 자세한 내용은 [docs/audiocpp-setup.md](docs/audiocpp-setup.md)
- (선택) ffmpeg — wav 이외의 형식(flac/mp3/mp4)으로 저장하거나 다운로드하려면 PATH에 필요

## 설치

```bash
git clone https://github.com/madwind0526/SongYUE2.git
cd SongYUE2
npm install
npm install --prefix app
```

### 1. 환경 설정

```bash
cp .env.sample .env
```

`.env`를 열어 필요한 값을 채우세요(전부 선택 사항이며, 앱 실행 후 설정 화면에서도 바꿀 수 있습니다).

- 작사 도우미로 쓸 LLM(`LLM_PROVIDER`)과 해당 API 키
- 음악 생성 엔진 실행 파일 경로(`ENGINE_PATH` 등) — 아래 2번 참고
- 라이브러리 폴더 위치, 저장 파일 형식

### 2. 음악 생성 엔진 준비 (둘 중 하나 이상)

- **audio.cpp (GGUF, 권장 시작점)**: [docs/audiocpp-setup.md](docs/audiocpp-setup.md) 안내대로 소스에서 빌드 후 모델 파일을 받으세요.
  ```bash
  python scripts/download_models.py
  ```
- **원본 Python 파이프라인**: 24GB급 VRAM을 요구하는 무거운 모델입니다. `.env`의 `PYTHON_ENGINE_PATH`/`PYTHON_SCRIPT_PATH`를 지정하면 연결되지만, VRAM이 부족하면 생성이 실패할 수 있습니다.

엔진 없이도 앱은 실행되며, 초안 작성/설정 저장까지는 가능합니다.

### 3. 실행

```bash
npm run dev
```

또는 Windows에서 `Start-SongYUE2.cmd`를 더블클릭하세요. 브라우저에서 `http://127.0.0.1:5173`으로 접속합니다.

## 기타 명령어

```bash
npm test    # 백엔드 테스트
npm run check   # 프론트엔드 타입 체크
npm run build   # 프론트엔드 빌드
```

## 문서

- [docs/local-api.md](docs/local-api.md) — 로컬 API 엔드포인트 목록
- [docs/audiocpp-setup.md](docs/audiocpp-setup.md) — audio.cpp 빌드 및 연결 방법
- [docs/models.md](docs/models.md) — 지원 모델 안내
- [progress.md](progress.md) — 아직 남은 일 / 실제 환경 검증이 필요한 항목
- [revision.md](revision.md) — 커밋 단위 변경 이력

## 라이선스 안내

YuE2 모델 가중치(GGUF/원본 모두)는 CC BY-NC 4.0을 따릅니다. 비상업적 용도로만 사용하세요.
