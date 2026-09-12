# State

## Current Wave

- **Wave:** 14
- **Status:** Done
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-09-13 완성곡 "..." 메뉴에 "커버" 신설(리믹스 아래) — SheetSage2로 그 곡 자신의 오디오를 전사해 ABC를 작곡 화면에 채움. 활성화 조건을 처음엔 "그 곡을 만든 모델"로 잘못 구현했다가 사용자 지적으로 "현재 선택된 모델"이 원본인지로 정정(전사는 오디오 출처와 무관, ABC를 실제로 쓰는 건 지금 선택된 모델이므로). 가사/스타일이 이미 있으면 유지/교체 확인 대화상자, 실제 보컬 음색은 못 가져오는 한계를 문서화. 그 외: ABC 기반 생성을 GGUF에서 전면 차단(프론트+백엔드 가드), 재생 중인 곡 카드에 초록 테두리 강조(내 작업/재생목록 등 전체), 전역 재생바에 원형 비주얼라이저를 설정 그대로 재사용한 선형 파형 추가. 문서(`README.md`, `docs/local-api.md`, `progress.md`, `revision.md`) 및 memory-bank 갱신.

## Wave History

| Wave | 작업 내용 | 상태 |
|------|-----------|------|
| 1 | 초기 UI, 음악 모델 준비, LLM 설정(.env 전환), audio.cpp 소스 빌드 검증 | Done |
| 2 | `/api/generate`를 실제 audio.cpp 엔진에 연결, 오디오 재생 UI, 회귀 테스트, library/setting·music·examples 구조 개편 | Done |
| 3 | 원본 Python 엔진 연결(+VRAM 감지로 경고 다이얼로그 조건부 표시), 재생목록+연속재생, 커버 아트, 다중 포맷 다운로드, copy-not-move 독립성, 내 홈, 보컬 성별 선택 | Done |
| 4 | 보기 방식 설정화, 카테고리/내비 재구성, 확장 플레이어 컨트롤, 상대 경로 설정 전면화, 폴더 열기 제거 | Done |
| 5 | 정렬, Seed 무작위, 생성 진행률, 커버 캐시 버그, MP4 동영상 변환, 카드 배색 구분, 재생목록 뷰 토글, 커버 폴더 이전 | Done |
| 6 | 원본 Python 파이프라인 실측 검증 + run_yue2.py 전환, 심볼릭 작곡(ABC) plan/generate/라이브러리 관리 페이지, 삭제 문구 버그 | Done |
| 7 | ABC 악보 편집 팝업+오디오 재생(하이라이트/자동스크롤)+AI 지시 편집, 스타일 프리셋 설정화, ABC 카드 리디자인+커버, 보컬+악기/악기만 토글, 제로샷 커버 배관(SheetSage2 연동 준비) | Done |
| 8 | (Codex) 로컬 safetensors 자동 인식, SheetSage2 로컬 모델 오프라인 사용, INT8 ConvRot 모델 정보+생성 차단, `/api/models` 로컬 파일 병합, `.abc` 파일 형식 라이브러리 기반 코드 — 프론트엔드 4곳 미완성 상태로 중단 | Done |
| 9 | Wave 8 프론트엔드 마무리(ABC 버튼 재배치+파일 가져오기+저장 대화상자+모델 비활성화), 라이브러리 기본 저장 형식 .abc로 전환, Python 경로 상대경로 정정, memory-bank 인코딩 복구 | Done |
| 10 | "악기만" 옵션이 실제로 보컬을 빼지 못하던 버그 수정(가사 비우기 시도 → 되돌림 → abc_tools.py strip-chords로 구조적 해결), 완성곡 후처리/EQ 팝업 신규(10밴드 EQ+FxSound 노브+리버브/에코, Web Audio 실시간 미리듣기+디바운스 렌더링, 원본 포맷 유지 저장) | Done |
| 11 | 후처리/EQ UI 반복 개선(EQ·전체 설정 프리셋을 이름 붙여 `Setting/` 폴더에 저장하는 백엔드 엔드포인트 3개 추가, 토글+초기화 버튼 병합, 재생 중 박스 강조, AnalyserNode 원형 라이브 비주얼라이저), progress.md/revision.md 신규 + README.md 갱신 | Done |
| 12 | "악기만" 무보컬 메커니즘 재검증(화음 기호를 지우지 않는 `abc_tools.py mute-voice` 신설, `strip-chords` 오용 수정), `docs/local-api.md` 전면 재작성 + `Setting/` 폴더 문서화, `docs/models.md` SheetSage2 상태 갱신 | Done |
| 13 | SheetSage2 제로샷 커버 종단 검증 성공(venv 구축, config.json weights_format 버그 + 백엔드 디렉터리 충돌 버그 수정), 원형 비주얼라이저 설정 전면 확장, 후처리 재생 위치 슬라이더, GGUF "악기만" 완전 비활성화(3개 경로) | Done |
| 14 | ABC 기반 생성(심볼릭 작곡/커버) GGUF 전면 차단, 재생 중 곡 카드 강조(전체 화면)+전역 재생바 선형 파형 비주얼라이저, 완성곡 메뉴에 "커버" 신설(활성화 조건을 대상곡 모델→현재 선택 모델로 사용자 지적 후 정정) | Done |

## Session Notes

- `models/m-a-p/SheetSage2/`에 `model.safetensors`+`config.json`+전체 코드 파일이 모두 설치 완료(2026-09-12 확인). 남은 준비물은 별도 Python venv뿐 — `test/YuE2-source/requirements-sheetsage2.txt`(torch==2.8.0/transformers==4.45.2 등)가 요구하는 버전이 YuE2 본체용 `.venv`에 이미 설치된 버전(torch 2.10/transformers 4.57)과 달라 같은 venv를 공유하면 충돌 위험 — 새 venv 만들어 설정의 `sheetSagePythonPath`에 지정해야 함.
- `models/yue2_3b_int8_convrot.safetensors`는 `models/comfy-org/YuE2/checkpoints/yue2_3b_int8_convrot.safetensors`로 옮겨져 있음. YuE2 INT8 ConvRot은 ComfyUI 형식이라 SongYUE2의 직접 생성 경로(audio.cpp/공식 Python)로 바로 실행되지 않음 — 백엔드가 명확한 한국어 오류로 차단, 프론트도 선택 자체를 막음.
- `.abc` 형식 라이브러리 노트는 파일명 기반 id(`abcfile-<base64(파일명)>`)를 쓰므로, 제목을 바꾸면(rename) id도 바뀐다 — JSON 형식 노트(안정적 UUID id)와 다른 특성이니 새 UI를 짤 때 유의할 것.
- `data/settings.json`은 백엔드가 메모리에 캐싱하므로, 프로세스가 떠 있는 동안 파일을 직접 고쳐도 다음 저장 시 덮어써진다 — 반드시 파일 수정 후 프로세스 재시작.
- `C:\Claude\Club`의 Vite 개발서버가 5173 포트를 먼저 점유하고 있으면 SongYUE2가 뜨지 않을 수 있으니, SongYUE2 프런트엔드는 5173에 떠 있는지 확인할 것.
