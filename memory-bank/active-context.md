# Active Context

## Current Focus

- **보기 방식(list/card)이 설정 항목이 됨**: `settings.viewMode`(백엔드 `GET/PUT /api/settings`, `library/setting`이 아닌 `data/settings.json`에 저장)로 관리. 세션 로컬 `listView` state는 제거하고 `projectList()`의 card-view 클래스와 설정 페이지의 "보기 방식" select, 컬렉션 툴바의 토글 버튼이 모두 같은 `settings.viewMode`를 읽고 `setViewMode()`로 즉시 PUT-저장. `projectList()`가 내 작업/라이브러리/프로젝트/재생목록 상세 등 여러 곳에서 재사용되므로 한 곳만 고치면 전체에 적용됨.
- 카테고리 탭에 "프로젝트" 추가: `[전체, 프로젝트, 완성된 곡, 좋아요]`. `tab==='projects'`는 `item.status==='draft'` 필터.
- 좌측 메뉴 순서: 만들기(고정 CTA, 그대로 최상단) → 홈 → 프로젝트 → 내 라이브러리 → 재생목록 → 좋아요.
- 초안(프로젝트) 카드 본문 클릭 시 팝업 없이 바로 `loadProject()`로 만들기 화면으로 이동(관련 설정 자동 적용). 완성곡(노래) 카드는 기존과 동일하게 본문 클릭 시 상세 팝업, 커버 클릭 시 바로 재생 유지.
- 플레이어 바 확장(`.player-bar.expanded`): seek bar, 볼륨, 속도(1x/2x 토글), 10초 뒤로, 꾹 눌러 계속 앞으로(mousedown/up 인터벌), 역재생 토글. **역재생은 브라우저 `<audio>`가 실제 파형 역재생을 지원하지 않아 completely honest 구현이 불가능** — `setInterval`로 `currentTime`을 100ms마다 0.15초씩 되감는 스크럽 방식으로 근사 구현(진짜 반전 오디오 아님, 스크래치 느낌에 가까움). 향후 진짜 역재생이 필요하면 Web Audio API로 버퍼를 디코드해 역순 재생하는 방식으로 재구현해야 함.
- "폴더 열기" 버튼 제거(작동 안 함 + 목적 불명확) — 프론트 버튼과 백엔드 `POST /api/open-output` 라우트(`spawn('explorer.exe',...)`) 전부 삭제.
- **엔진/파이썬/로그 경로도 SongYUE2 루트 기준 상대경로로 통일**: `resolveConfigPath(value, defaultRelative) = path.resolve(root, value.trim() || defaultRelative)`(audio.cpp 경로는 기본값 `engine\audio.cpp\build\windows-cuda-release\bin\audiocpp_cli.exe` 존재), `resolveOptionalConfigPath(value)`(Python 경로는 고정 기본값 없음 — 비어있으면 빈 문자열 유지해 "미설정" 에러 그대로 발생). `path.resolve`라서 절대경로를 넣어도 정상 동작(하위호환). `outputDirectory`(로그 폴더, 읽기전용)는 `publicSettings()`에서 `path.relative(root, outputDirectory)`로 상대 표시("runs")로 변경, 내부 로직은 여전히 절대경로 사용.
- TypeScript 타입체크 통과, 백엔드 테스트 6/6 통과, 라이브 서버 재시작 후 `/api/settings`(viewMode/outputDirectory 상대화 확인), `/api/health`(엔진 빈 값→기본 상대경로 자동 인식 확인), `/api/open-output`(404 확인) curl 검증 완료.

## Pending / Not Yet Done

- `docs/local-api.md`, `docs/audiocpp-setup.md`를 최근 몇 웨이브 전체(Python 러너, 커버, 재생목록, 다운로드, copy-not-move, GPU 감지, viewMode, 상대경로 엔진설정) 기준으로 전면 갱신 필요 — 계속 미룸.
- 브라우저에서 실제 클릭 테스트(재생목록, 다운로드 다이얼로그, 커버 업로드, 보컬 성별, 확장 플레이어의 hold-forward/역재생 버튼, 보기 방식 전환)는 아직 라이브로 직접 해보지 않음(코드/타입체크/API curl로만 검증) — 다음 세션에서 실기기 확인 권장.
