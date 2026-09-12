# State

## Current Wave

- **Wave:** 11
- **Status:** Done
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-09-12 후처리/EQ 팝업을 사용자 요청대로 정교화(EQ 프리셋+전체 설정 프리셋을 localStorage/파일 다운로드 대신 이름 붙여 저장하는 서버 파일로 전환, 저장 위치는 `library/`가 아닌 별도 `Setting/EQ-preset`·`Setting/PostProcess`), 토글 버튼에 초기화 아이콘 병합, 재생 중인 트랙 박스 강조, AnalyserNode 기반 원형 라이브 비주얼라이저(Baloo 2 워드마크 idle 상태) 추가. progress.md/README.md/revision.md 신규 작성, 이번 웨이브 커밋+푸시.

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

## Session Notes

- `models/sheetsage2_bf16.safetensors`는 `models/m-a-p/SheetSage2/model.safetensors`로 옮겨져 있음. Hugging Face `m-a-p/SheetSage2`의 config/code/assets 파일이 `models/m-a-p/SheetSage2/`에 함께 있어야 오프라인 로딩이 됨(가중치 파일만으로는 부족).
- `models/yue2_3b_int8_convrot.safetensors`는 `models/comfy-org/YuE2/checkpoints/yue2_3b_int8_convrot.safetensors`로 옮겨져 있음. YuE2 INT8 ConvRot은 ComfyUI 형식이라 SongYUE2의 직접 생성 경로(audio.cpp/공식 Python)로 바로 실행되지 않음 — 백엔드가 명확한 한국어 오류로 차단, 프론트도 선택 자체를 막음.
- `.abc` 형식 라이브러리 노트는 파일명 기반 id(`abcfile-<base64(파일명)>`)를 쓰므로, 제목을 바꾸면(rename) id도 바뀐다 — JSON 형식 노트(안정적 UUID id)와 다른 특성이니 새 UI를 짤 때 유의할 것.
- `data/settings.json`은 백엔드가 메모리에 캐싱하므로, 프로세스가 떠 있는 동안 파일을 직접 고쳐도 다음 저장 시 덮어써진다 — 반드시 파일 수정 후 프로세스 재시작.
- `C:\Claude\Club`의 Vite 개발서버가 5173 포트를 먼저 점유하고 있으면 SongYUE2가 뜨지 않을 수 있으니, SongYUE2 프런트엔드는 5173에 떠 있는지 확인할 것.
