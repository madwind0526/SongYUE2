# 변경 이력 (Revision History)

`git log`를 기준으로 정리한 커밋 단위 변경 이력입니다. 최신 항목이 위에 옵니다.

## `8cc3a31` — Make surround/clarity/bassBoost post-process knobs bidirectional (2026-09-14)

후처리/EQ 스튜디오의 "서라운드 사운드"/"선명도"/"베이스 부스트" 세 노브가 내부적으로 쓰는 크로스피드·쉘프 필터 공식은 원래부터 음수 계수를 받아도 수학적으로 문제가 없었는데, UI가 0~100으로만 막아뒀던 것을 확인해 `-100~100`으로 열었다. 서라운드는 `L_out=L+aR, R_out=R+aL` 형태의 크로스피드라 `a`가 양수면 좌우를 섞어 모노에 가깝게(좁힘), 음수면 반대로 Side 성분이 `(1+|a|)`배, Mid 성분이 `(1-|a|)`배가 되는 진짜 M/S 와이드닝이 된다는 걸 수식으로 확인 후 반영. 선명도(6kHz~ 하이쉘프)·베이스 부스트(150Hz 이하 로우쉘프)도 같은 이유로 음수 쪽을 열면 "깎기" 방향이 추가로 생긴다. 다이내믹 부스트(컴프레서 비율 공식이 음수에서 1 미만이 되어 무효)·공간감(우측 채널 전용 딜레이라 음수 딜레이가 무효)·리버브/에코·전체 볼륨은 같은 방식으로 열 수 없음을 확인하고 그대로 둠.

사용자가 실제로 구매한 LANDR 마스터링 전/후 곡 2곡(`F:\Music\Music-원본`, `F:\Music\Music-LANDR-Mastered`)을 `ffmpeg loudnorm`/대역별 `astats`로 분석해 **"DistroKid-Like" EQ·전체 후처리 프리셋**을 만들어 `Setting/EQ-preset/`, `Setting/PostProcess/`에 저장. 두 곡에서 일관되게 확인된 것: 라우드니스 +3.7~3.9 LU, 트루피크가 0dBTP 근처까지 리미팅, 중간 정도의 다이내믹 압축, 4kHz~16kHz를 +7~8dB 부스트하는 "밝은" EQ 틸트, Mid 대비 Side 성분이 약 +2.3dB 커지는 스테레오 와이드닝. 이 마지막 수치를 프리셋에 반영하려다 서라운드 노브가 음수를 막고 있는 걸 발견한 게 이 커밋의 계기. 리버브/에코/선명도/베이스부스트는 LANDR 처리에서 측정 근거를 못 찾아 프리셋 값은 0으로 둠(추정 아님, 미측정).

이 세션에서 먼저 audio.cpp의 GGUF "악기만" 기능(0xShug0/audio.cpp 관련 커뮤니티 제보를 계기로 재검토)이 CUDA 12.8/13.3 두 빌드 모두에서 여전히 보컬을 완전히 억제하지 못함을 실측(사용자 직접 청취)으로 재확인했고 — `[Lyrics]` 텍스트가 ABC 상태와 무관하게 항상 조건부여로 들어가는 게 원인 후보, 엔진이 빈 가사를 구조적으로 거부(`request.cpp:154`)해 우회 불가 — 반면 ABC 멜로디를 그대로 따라 부르는 "커버" 경로는 SheetSage2 역전사로 정확도가 확인됨. 이 조사는 코드 변경 없이 보류 상태로 남겨둠(다른 사람도 같은 문제를 조사 중이라 사용자가 대기 요청). `audiosr`(오디오 초해상도) 모델도 같은 맥락에서 빌드·다운로드까지 마쳤으나 아직 실사용 테스트는 안 함.

## `87c4348` — Add a "커버" (cover) action to each completed song's menu (2026-09-13)

완성곡 메뉴의 "리믹스" 바로 아래 "커버" 항목 신설 — 그 곡의 오디오를 SheetSage2로 전사해 멜로디/코드 ABC를 뽑아 작곡 화면에 채워 넣는다. 활성화 조건은 그 곡을 만든 모델이 아니라 **현재 작곡 화면에 선택된 모델**이 원본인지 여부(사용자 지적으로 초안의 "그 곡의 모델" 기준 구현을 수정) — SheetSage2 전사는 오디오 출처 엔진과 무관하지만, 결과 ABC를 실제로 쓰는 건 지금 선택된 모델이기 때문. 작곡 화면에 이미 가사/스타일이 있으면 유지할지 그 곡 설정으로 바꿀지 확인 대화상자를 띄우며, 어느 쪽이든 modelId는 건드리지 않는다. Suno류와 달리 실제 보컬 음색/톤은 가져오지 않음(YuE2 파이프라인에 참조 오디오 화자 임베딩 입력 자체가 없음) — `progress.md`에 한계로 기록.

## `a1d2439` — Add a linear waveform visualizer to the main player bar (2026-09-13)

후처리 다이얼로그의 원형 비주얼라이저를 하단 전역 재생바(왼쪽 트랜스포트~오른쪽 볼륨 사이)에 일직선으로 펼쳐서 추가 — 같은 설정값과 같은 점별 계산식을 쓰고, 0~360도 원형 좌표를 x=0..width 직선 좌표로 바꾸는 매핑만 다르다. 전역 `<audio>` 엘리먼트에는 원래 Web Audio 그래프가 없어 `AnalyserNode`를 새로 하나 붙였고, `createMediaElementSource`가 엘리먼트당 평생 한 번만 가능하다는 제약 때문에 첫 재생 시 한 번만 생성해 세션 내내 재사용.

## `c778253` — Extend the now-playing card highlight to the playlist detail view (2026-09-13)

## `7ca7006` — Highlight the card of the song currently playing in 내 작업/라이브러리 (2026-09-13)

재생 중인 곡의 카드에 초록 테두리+글로우 강조 추가(후처리 다이얼로그의 재생 중 파형 강조와 같은 스타일). `내 작업`/`홈`/`프로젝트`/`내 라이브러리`/`좋아요`는 공용 `projectList()`를 통해 한 번에 해결되었고, 별도 렌더링 코드를 쓰는 재생목록 상세 화면만 뒤이어 따로 추가.

## `f5332f6` — Document the GGUF+ABC restriction and backfill revision.md history (2026-09-13)

`docs/local-api.md`/`README.md`에 ABC 기반 생성(심볼릭 작곡/커버)이 원본 모델 전용이라는 제약을 문서화. 실제로는 여러 커밋이 있었지만 갱신되지 않았던 `revision.md`의 이력을 `841641d` 이후 전부 다시 채움.

## `4fed156` — Disable ABC-driven generation (symbolic plan/cover) on GGUF models (2026-09-13)

`runAudioCpp()`는 애초에 `--abc-file` 인자를 지원한 적이 없어, GGUF 모델을 선택한 채 ABC 악보(심볼릭 작곡이든 SheetSage2 "오디오에서 추출" 커버 결과든)를 채우고 생성하면 조용히 무시되고 가사/스타일만으로 생성되는 함정이 있었음. "심볼릭 작곡"/"오디오에서 추출" 버튼을 GGUF 선택 시 비활성화하고 안내 문구를 추가, `/api/generate`에도 GGUF+비어있지 않은 ABC 조합을 명확한 오류로 거부하는 보루를 추가.

## `bec5aad` — Fix SheetSage2 cover-transcribe directory collision; verify end-to-end (2026-09-12)

`runTranscribe()`가 출력 폴더를 미리 만들어(`mkdir`) `transcribe.py`의 안전장치(`fresh_directory()`, `exist_ok=False`)와 항상 충돌해 즉시 실패하던 버그 수정 — 부모 폴더만 미리 만들도록 변경. 실제 완성곡 오디오로 `/api/cover-transcribe` 종단 테스트 성공, 결과 ABC가 `abc_tools.py inspect` 구조 검증도 통과. 과정에서 로컬 `models/m-a-p/SheetSage2/config.json`의 `weights_format` 오기(`adapter`→`merged`)도 함께 발견해 수정(모델 폴더는 `.gitignore`라 저장소에는 안 남고 `docs/models.md`에 기록).

## `4be5312` — Disable "악기만" entirely for GGUF models instead of just warning (2026-09-12)

GGUF는 "악기만"을 구조적으로 보장할 수 없어 소프트 스타일 힌트로만 허용해 왔던 것을, 만들기 화면에서 버튼 자체를 비활성화하도록 변경. 직접 토글뿐 아니라 프로젝트 리믹스 로드(`loadProject()`)와 localStorage 초안 복원 경로에서도 `instrumental` 값이 비-Python 모델에 stuck되지 않도록 정리 — 세 경로 모두 Playwright로 검증.

## `6f94640` — Add a seek/position slider below the post-process waveforms (2026-09-12)

후처리/EQ 다이얼로그의 원본·처리 결과 파형 아래에 재생 위치를 보여주고 이동할 수 있는 슬라이더 추가(기존 Web Audio 재생 상태를 재사용하는 `seekTo(seconds)` 신설). 전송 바의 볼륨 아이콘도 속도 컨트롤과의 간격을 위해 약간 오른쪽으로 이동.

## 원형 비주얼라이저 전면 설정화 (11개 커밋, 2026-09-12)

`d8c597b`부터 `52fb4d4`까지, 후처리 다이얼로그의 원형 라이브 비주얼라이저에 하드코딩되어 있던 상수를 사용자가 조정 가능한 설정으로 하나씩 옮기고, 그 과정에서 발견된 시각적 버그를 함께 고침:

- 라인 굵기(`d8c597b`), 잔상/afterimage(`1153411`) 설정 추가.
- 잔상이 배경을 검게 물들이던 버그를 `destination-out` 합성으로 수정, 나선(spiral) 정도 설정 추가(`862ce22`).
- 링마다 같은 프레임을 다른 위상으로 읽는 회전(radial) 모드 외에, 링마다 과거의 다른 프레임을 읽는 시간축(time) 모드 신설(`befb6d1`).
- 항상 0으로 죽어 있던 최상단 주파수 빈과 항상 포화된 최하단 빈을 원 매핑에서 제외(`4cae637`).
- 시간축 모드에 고정 반지름 + 초 단위 시간 간격/가속도(가속도=지수) 설정 추가, 회전 모드의 링 간격도 설정화, 고주파 제외 폭을 25%→35%로 확대(`087a24a`).
- 캔버스의 HTML 해상도와 실제 CSS 박스 크기가 어긋나 원이 타원으로 찌그러지던 버그 수정(`705570c`).
- 변동폭(진폭)을 설정으로 노출(`041db60`), 이후 양방향(줄어듦 포함)으로 개선하고 기본값을 2로 상향(`115ef38`), 줄어드는 쪽은 늘어나는 쪽의 절반 강도로 비대칭 처리(`741ff69`).
- 마지막 점과 첫 점을 잇던 이상한 연결선을 없애고 열린 곡선으로 변경(`52fb4d4`).

## `a73f190` — Triple the height of the lyrics/style suggestion edit textarea (2026-09-12)

AI 제안을 적용 전에 편집하는 다이얼로그의 텍스트영역이 공용 최소 높이(90px)로는 너무 좁아, 전용 클래스로 분리해 세 배로 키움(프로젝트 메모 텍스트영역은 영향 없음).

## `5683fd5` — Update progress.md: SheetSage2 venv is set up, only e2e transcribe test remains (2026-09-12)

진행 상황 문서만 갱신(venv 준비 완료, 남은 것은 실기 종단 테스트뿐이라는 상태 반영).

## `c82248c` — Fix recent-projects sidebar leak, add visualizer settings, UI cleanup (2026-09-12)

사이드바 "최근 프로젝트"가 필터링 없는 전체 프로젝트 목록을 그대로 써서, 방금 완성한 곡이 프로젝트로 잘못 표시되던 버그 수정(초안만 보이도록 제한). 설정 화면에 비주얼라이저 켬/끔·링 개수·색조 설정 섹션 신설, 후처리 다이얼로그의 하드코딩 상수를 이 설정과 연결. 그 외: 사이드바/작곡 화면의 중복 라벨 제거, AI 제안 다이얼로그에 편집 토글 추가, 카드 뷰에 곡 길이(MM:SS, Orbitron) 표시.

## `ccde9ca` — Re-verify low-priority ideas in the browser, drop combined reset button (2026-09-12)

Playwright로 재확인한 결과 비주얼라이저 커스터마이즈와 프리셋 내보내기/가져오기는 여전히 미구현으로 확인. "전체 초기화" 버튼은 이미 EQ/FX/리버브·에코 개별 초기화 버튼 세 개로 구현되어 있어, 통합 버튼을 추가하지 않고 의도된 설계로 확정.

## `841641d` — Fix instrumental vocal-muting to preserve harmony, overhaul API docs (2026-09-12)

"악기만" 생성 경로가 쓰던 `abc_tools.py strip-chords --keep-voice Ins`는 전체 악보의 화음 기호까지 지워버렸음 — native 방언에서 화음 기호는 오직 Vocal에만, 쉬는 동안에도 존재해야 화성이 오케스트라에 전달되는데 그 신호를 잃게 됨. 화음 기호는 건드리지 않고 선택하지 않은 성부의 음표만 쉼표로 바꾸는 `mute-voice` 명령을 신설해 전환. `docs/local-api.md`의 엔드포인트 표도 실제 코드 기준으로 전면 재작성(재생목록·프로젝트 커버·심볼릭 ABC 관련 엔드포인트 대부분이 미문서화 상태였음), `docs/models.md`의 SheetSage2 상태도 갱신.

## `369caf3` — Enlarge and simplify the sidebar by-line (2026-09-12)

사이드바 태그라인을 "(by madwind)"에서 괄호를 뺀 "by madwind"로 단순화하고, 로고 텍스트와 비슷한 크기로 폰트 크기를 키움.

## `c799927` — Replace sidebar tagline with a by-line (2026-09-12)

사이드바 로고 아래의 "나만의 음악 작업실" 태그라인을 저작자 표시 "(by madwind)"로 교체.

## `e56c304` — Add post-processing/EQ studio and structural instrumental generation (2026-09-12)

**"악기만" 실제 구현으로 재작업**

- 직전 커밋(`89c5406`)에서 시도한 "가사 비우기" 방식을 되돌림 — audio.cpp/공식 Python 엔진 둘 다 빈 가사를 하드 거부(`Yue2 requires non-empty lyrics`)한다는 것을 소스에서 확인.
- 대신 원본 Python 엔진(`yue2-original`) 한정으로 `abc_tools.py strip-chords --keep-voice Ins`를 사용해 ABC 악보의 Vocal 성부를 쉼표로 구조적으로 치환한 뒤 생성하는 방식으로 재구현. 기존 ABC 악보가 없으면 자동으로 `plan`부터 실행. 사용자가 실제 보컬 멜로디가 있는 악보를 물려도 정상 동작함을 전용 테스트로 확인.
- GGUF 계열(Q4/Q8/BF16)은 이 구조적 방식을 쓸 수 없어 여전히 소프트 스타일 힌트(`instrumental, no vocals`)만 제공 — UI에 모델별로 다른 안내 문구 표시.

**완성곡 후처리 / EQ 스튜디오 신규**

- 완성곡 "⋯" 메뉴에 "후처리 / EQ" 추가. 10밴드 EQ(31Hz~16kHz, ±100, 프리셋 6종 + 사용자 프리셋), FxSound 노브 5개(선명도/공간감/서라운드/다이내믹부스트/베이스부스트), 리버브·에코 노브 4개, 전체 볼륨 노브, 섹션별 on/off + 초기화 버튼.
- 처리 방식은 브라우저 내 실시간 미리듣기(Web Audio API) — `buildProcessingGraph()`가 `AudioContext`(라이브 재생)와 `OfflineAudioContext`(파라미터 변경 시 디바운스 재렌더링) 양쪽에서 재사용됨.
- 재생 UI: 원본/처리 결과를 같은 재생 위치를 공유하며 전환하는 A/B 청취, 뒤로/앞으로/속도/미리듣기 볼륨 트랜스포트, 현재 재생 중인 트랙의 박스를 색상으로 강조.
- `AnalyserNode`로 실제 재생 중인 오디오의 주파수 데이터를 읽어 그리는 원형 라이브 비주얼라이저(부드러운 다중 라인, 재생 중이 아닐 때는 "SOUND / FX" 워드마크로 대체).
- 저장 시 처리된 오디오를 WAV로 인코딩해 `POST /api/projects/:id/post-process`로 전송 → ffmpeg로 원본과 동일한 파일 형식으로 재인코딩 → `showSaveFilePicker`(미지원 시 다운로드 폴백)로 `{원본}-modified.{원본확장자}` 저장. 원본 파일은 절대 변경되지 않음.
- EQ 프리셋(`GET/POST/DELETE /api/eq-presets`)과 전체 후처리 설정 프리셋(`GET/POST/DELETE /api/postprocess-settings`)을 이름으로 저장·목록·삭제. 저장 위치는 `library/`가 아닌 별도 `Setting/EQ-preset/`, `Setting/PostProcess/` — `library/setting`에 그냥 저장하면 초안 스캐너가 이를 깨진 프로젝트로 오인하기 때문에 의도적으로 분리.
- 백엔드 테스트 스위트에 위 두 엔드포인트의 저장 위치·검증·삭제 케이스 추가(8개 스위트 전체 통과).

## `89c5406` — Make instrumental mode actually withhold vocals (2026-09-12)

가사를 비워서 보컬을 없애려던 첫 시도. 이후 "Unreleased" 항목에서 구조적 방식(ABC 성부 치환)으로 대체됨 — 실제로는 audio.cpp/Python 엔진 모두 빈 가사를 거부해서 동작하지 않았음. 테스트 목(mock)의 ffmpeg `-y` 플래그 처리 버그도 함께 수정.

## `35b7d1d` — Add symbolic ABC composition, editing, and zero-shot cover plumbing (2026-09-12)

- 심볼릭 작곡(ABC) plan/generate/check와 라이브러리 페이지, abcjs 기반 오디오 재생(재생/일시정지/탐색/속도/볼륨, 현재 음표 하이라이트+자동스크롤), LLM 지시 기반 AI 편집 플로우.
- "보컬+악기"/"악기만" 토글(이 시점에는 가사를 유지한 채 보컬만 억제하려는 첫 버전).
- 음악 스타일 프리셋, ABC 라이브러리 카드 커버 아트, SheetSage2 제로샷 커버용 설정 필드 + `/api/cover-transcribe` 엔드포인트 배관(모델/venv 설치는 사용자 몫으로 남김).
- 공식 Python 파이프라인을 12GB GPU(RTX 5070)에서 실측 검증, 백엔드가 `examples/generate.py` 대신 `skills/yue2-music/scripts/run_yue2.py`를 호출하도록 전환. 다이얼로그 스크롤이 재생 컨트롤을 가두는 버그, ABC 카드 색상이 CSS 명시도 문제로 초록색이 되는 버그, 삭제 확인 문구 버그 수정.

## `3fecc3d` — Remove Suno reference from README intro (2026-09-12)

README 도입부에서 Suno 직접 언급을 제거.

## `e5e6331` — Add README with project intro and install instructions (2026-09-12)

프로젝트 소개, 주요 기능, 설치 방법을 담은 최초 README 추가.

## `a77af9f` — Initial commit: SongYUE2 local music studio (2026-09-12)

YuE2(audio.cpp GGUF + 공식 Python 파이프라인)를 감싸는 로컬 웹 앱 최초 커밋. Suno에서 영감을 받은 라이브러리/프로젝트/재생목록/커버/다운로드 UI, Electron 스타일 로컬 실행 구조.
