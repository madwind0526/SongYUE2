# State

## Current Wave

- **Wave:** 7
- **Status:** Done
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-09-12 ABC 악보 편집 팝업+오디오 재생(하이라이트/자동스크롤)+AI 지시 편집(LLM이 ABC 수정)+재생컨트롤 스크롤버그 수정, 음악 스타일 프리셋 설정화, ABC 카드 song-card 통일+커버, 보컬+악기/악기만 토글, 제로샷 커버 배관(설정 필드+/api/cover-transcribe+업로드 버튼, 실제 SheetSage2 모델/venv 설치는 사용자 몫으로 남김)

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

## Session Notes

- C:\Codex 경로가 없어 실제 존재하는 C:\Claude\_template\memory-bank를 복사했다.
- 기존 AGENTS.md는 보존했다. 앱 구현·다운로드·검증은 진행 중이다.
