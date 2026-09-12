# 변경 이력 (Revision History)

`git log`를 기준으로 정리한 커밋 단위 변경 이력입니다. 최신 항목이 위에 옵니다.

## Unreleased — 이 커밋에 포함될 변경사항 (2026-09-12)

**"악기만" 무보컬 메커니즘 재검증 및 수정**

- 사용자가 YuE2의 Vocal/Ins 2성부 설계를 상세히 설명하며 재검토를 요청: `V: Vocal` 성부는 지우면 안 되고, 화음 기호가 붙은 쉼표(예 `"D"z16`)로 채워야 화성이 오케스트라에 전달됨.
- 로컬에 설치된(레포 밖, `test/` — `.gitignore`) `abc_tools.py`를 확인해 보니 기존 `strip-chords --keep-voice Ins`는 Vocal을 쉼표로 바꾸는 것과 별개로 **전체 성부의 화음 기호까지 지워버려** 이 설계와 어긋났음 — 파서 자체의 불변식(`"Native chord symbols belong in Vocal, not Ins"`)과 `references/abc-editing.md`("harmony is represented by quoted symbols in Vocal, including when resting")가 이를 뒷받침.
- `abc_tools.py`에 화음 기호는 건드리지 않고 선택하지 않은 성부의 음표만 쉼표로 바꾸는 `mute-voice` 명령을 신설, `backend/server.mjs`의 `stripVocalVoice()`를 이 명령을 쓰도록 전환. `backend/server.test.mjs`의 관련 검증도 함께 갱신, 8개 스위트 전체 통과.

**문서화**

- `docs/local-api.md`의 엔드포인트 표를 실제 코드 기준으로 전면 재작성. 이전에는 3개 엔드포인트만 누락된 것으로 파악했으나, 실제로는 재생목록·프로젝트 커버·심볼릭 작곡(ABC) 관련 엔드포인트 대부분(`plan`/`abc-check`/`cover-transcribe`/`abc-file`/`abc-notes`+하위 경로/`llm/abc-edit`/`generate/status`)이 문서화되어 있지 않았음.
- `Setting/` 폴더(앱 레벨 설정 저장소, `library/`와 별개)의 존재와 용도를 `docs/local-api.md`에 문서화.
- `docs/models.md`의 SheetSage2 절이 "config.json 미설치" 기준으로 정체되어 있던 것을, 실제로 설치가 끝난 현재 상태(config.json+코드 완비, 별도 Python venv만 남음)로 갱신.

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
