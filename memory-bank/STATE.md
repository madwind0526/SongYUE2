# State

## Current Wave

- **Wave:** 4
- **Status:** In Progress
- **Cache Status:** CLEAN
- **Last Checkpoint:** 2026-09-12 보기 방식(list/card) 설정화, 카테고리에 프로젝트 탭 추가, 좌측 메뉴 순서 변경, 초안 카드 클릭 시 바로 만들기로 이동, 플레이어 바 확장(seek/볼륨/속도/뒤로-홀드앞으로/역재생), 폴더 열기 버튼 제거, 엔진/파이썬/로그 경로 상대화

## Wave History

| Wave | 작업 내용 | 상태 |
|------|-----------|------|
| 1 | 초기 UI, 음악 모델 준비, LLM 설정(.env 전환), audio.cpp 소스 빌드 검증 | Done |
| 2 | `/api/generate`를 실제 audio.cpp 엔진에 연결, 오디오 재생 UI, 회귀 테스트, library/setting·music·examples 구조 개편 | Done |
| 3 | 원본 Python 엔진 연결(+VRAM 감지로 경고 다이얼로그 조건부 표시), 재생목록+연속재생, 커버 아트, 다중 포맷 다운로드, copy-not-move 독립성, 내 홈, 보컬 성별 선택 | Done |
| 4 | 보기 방식 설정화, 카테고리/내비 재구성, 확장 플레이어 컨트롤, 상대 경로 설정 전면화, 폴더 열기 제거 | In Progress |

## Session Notes

- C:\Codex 경로가 없어 실제 존재하는 C:\Claude\_template\memory-bank를 복사했다.
- 기존 AGENTS.md는 보존했다. 앱 구현·다운로드·검증은 진행 중이다.
