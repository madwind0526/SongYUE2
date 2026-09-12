# SongYUE2 진행 상황 / 남은 일

최종 업데이트: 2026-09-12

이 문서는 지금까지 구현이 끝난 것과 별개로, **아직 손대지 않았거나 실제 환경에서 검증되지 않은 부분**만 모아 둔 체크리스트입니다. 완료된 기능 전체 목록은 [README.md](README.md)를, 커밋 단위 변경 이력은 [revision.md](revision.md)를 참고하세요.

## 문서화

- [x] `docs/local-api.md` 엔드포인트 표를 실제 코드 기준으로 전면 재작성 — 이전에 3개(`post-process`/`eq-presets`/`postprocess-settings`)만 빠진 것으로 파악했으나, 실제로는 재생목록·프로젝트 커버·ABC 관련 엔드포인트(`plan`/`abc-check`/`cover-transcribe`/`abc-file`/`abc-notes`+하위 경로/`llm/abc-edit`/`generate/status`) 전체가 문서화되어 있지 않았음. 전부 반영 완료.
- [x] `Setting/` 폴더(앱 레벨 설정 저장소, `library/`와 별개)의 존재와 용도를 `docs/local-api.md`에 문서화.
- [x] `docs/models.md`의 SheetSage2 절이 "config.json 없음" 기준으로 정체되어 있던 것을 실제 파일 상태(코드·설정 파일 설치 완료, venv만 남음) 기준으로 갱신.

## 구조적 무보컬("악기만") 메커니즘 재검증 및 수정

- [x] 사용자가 지적한 대로, 기존 `abc_tools.py strip-chords --keep-voice Ins`는 Vocal 성부를 쉼표로 바꾸는 것과 별개로 **전체 성부의 화음 기호까지 모두 지워버려**, Vocal이 쉬는 동안에도 화성을 오케스트라에 전달해야 하는 native 방언의 설계(코드 파서의 `"Native chord symbols belong in Vocal, not Ins"` 불변식, `references/abc-editing.md`의 "harmony is represented by quoted symbols in Vocal, including when resting")와 어긋났음.
- [x] `abc_tools.py`에 `mute-voice` 명령을 새로 추가 — 선택하지 않은 성부의 소리 나는 음표만 같은 박자 그리드의 쉼표로 바꾸고, 화음 기호는 전혀 건드리지 않음(`"D"C8` → `"D"z8`). `backend/server.mjs`의 `stripVocalVoice()`를 이 명령을 쓰도록 전환, 백엔드 테스트/`references/abc-editing.md` 갱신, `node --test backend/server.test.mjs` 8/8 통과 확인.

## SheetSage2 제로샷 커버 — 종단 검증 완료 (2026-09-12)

- [x] 실제 완성곡 오디오를 `POST /api/cover-transcribe`에 넣어 종단 테스트 성공. 결과 ABC가 `abc_tools.py inspect` 구조 검증도 통과(Vocal/Ins 두 성부, 128개 소리 나는 음표, 37마디, 원본 길이와 일치하는 nominal duration). 과정에서 실제로 막혔던 문제 두 가지를 찾아 고침:
  1. `models/m-a-p/SheetSage2/config.json`의 `weights_format`이 `"adapter"`로 되어 있었지만, 실제 `model.safetensors`를 열어보면 `encoder.*` 키가 876개 포함된 **완전히 병합된(merged) 체크포인트**였음 — `missing_keys` 오류로 로드 실패. `weights_format`을 `"merged"`로 고쳐 해결(원격 베이스 모델 다운로드도 불필요해짐). `models/`는 `.gitignore`라 이 수정은 저장소에 안 남으므로 모델을 다시 받으면 다시 고쳐야 함 — [docs/models.md](docs/models.md)에 기록.
  2. `backend/server.mjs`가 출력 폴더를 미리 만들어(`mkdir`) `transcribe.py`의 안전장치(`fresh_directory()`, `exist_ok=False`)와 항상 충돌해 즉시 실패하고 있었음. 부모 폴더만 미리 만들도록 수정(커밋 반영됨).

## 실제 환경에서 검증 필요 (코드는 준비됐지만 종단 테스트 못 함)

- [ ] **"악기만" mute-voice 전환의 실제 오디오 검증**: 코드 수정과 유닛 테스트(가짜 spawn)는 통과했지만, 실제 원본(공식 Python) 엔진으로 생성해 Vocal 화음 기호가 남은 ABC가 실제로 화성이 유지된 무보컬 오디오를 만드는지는 아직 실기 검증 전.
- [ ] **INT8 ConvRot 모델**: 지금은 명확한 한국어 안내로 생성을 차단만 함. ComfyUI 어댑터를 실제로 붙여 생성 가능하게 만드는 작업은 시작 전.
- [ ] **ABC "파일에서 가져오기"**: JSON의 `abc` 필드 추출 / 일반 텍스트 폴백 로직은 코드 리뷰로만 검증했고, 실제 파일 업로드로 브라우저에서 종단 테스트는 아직 안 함.
- [ ] **File System Access API 미지원 브라우저**(Safari, Firefox 등)에서의 폴백 저장 경로 — 현재는 Chrome에서 `showSaveFilePicker`/`showOpenFilePicker`를 임시로 지워서 폴백을 강제 검증했을 뿐, 실제 비-Chromium 브라우저 테스트는 안 함.

## 알려진 제약 (설계상 의도이며 버그 아님)

- GGUF 모델(Q4/Q8/BF16)은 "악기만"을 구조적으로 보장할 수 없어, 만들기 화면에서 아예 선택하지 못하도록 막아둠(버튼 비활성화). 무보컬 생성을 원하면 "원본"(공식 Python) 모델을 선택해야 함 — `abc_tools.py mute-voice`로 보컬 성부를 화음 기호는 남긴 채 쉼표 처리하는 구조적 방식은 원본 모델 전용.
- ABC 악보(심볼릭 작곡, SheetSage2 커버 추출 결과 포함)도 GGUF에서는 생성에 전혀 반영되지 않음(2026-09-13 확인) — `backend/server.mjs`의 `runAudioCpp()`가 애초에 `--abc-file` 인자를 지원하지 않아, 그동안은 ABC를 채운 채 GGUF로 생성해도 조용히 무시되고 가사/스타일만으로 생성되는 함정이 있었음. "심볼릭 작곡"/"오디오에서 추출" 버튼을 GGUF 선택 시 비활성화하고, 백엔드 `/api/generate`에서도 GGUF+비어있지 않은 ABC 조합을 명확한 오류로 거부하도록 수정. 커버/심볼릭 작곡을 쓰려면 "원본" 모델을 선택해야 함.
- 후처리/EQ는 **브라우저 세션 내 실시간 미리듣기**(Web Audio API)이며, "저장" 버튼을 눌러야만 서버가 처리된 오디오를 원본과 같은 파일 형식으로 재인코딩해 저장함. 원본 곡 파일은 절대 바뀌지 않음.
- EQ 프리셋과 전체 설정 프리셋은 `SongYUE2/Setting/EQ-preset/`, `SongYUE2/Setting/PostProcess/`에 로컬 파일로만 저장됨 — 다른 PC로 옮기려면 해당 폴더를 직접 복사해야 하고, 자동 동기화 기능은 없음.

## 테스트 커버리지

- 백엔드: `node --test backend/server.test.mjs` — 8개 스위트 전체 통과(생성 파이프라인, 저장 포맷, 심볼릭 작곡/ABC 라이브러리, EQ·후처리 프리셋 저장 위치 등).
- 프론트엔드: 자동화 테스트 없음. 후처리/EQ 다이얼로그, EQ 프리셋, 전체 설정 프리셋, 서클 비주얼라이저는 chrome-devtools MCP로 실제 브라우저에서 수동 검증만 완료된 상태(재실행 가능한 자동 테스트는 아님).

## 향후 개선 아이디어 (필수 아님, 우선순위 낮음)

~~비주얼라이저 커스터마이즈~~ — 완료(2026-09-12). 설정 화면에 표시 켬/끔, 라인 모드(1: 회전/2: 시간축), 색조·라인 개수·굵기·변동폭·잔상·나선 정도·R 간격(회전 모드)·시간 간격·가속도(시간축 모드)까지 모두 설정 가능. `studio.tsx`의 하드코딩된 상수는 전부 설정값으로 교체됨.

- EQ 프리셋 / 전체 설정 프리셋 파일 내보내기·가져오기(다른 PC로 옮기기 쉽게) — 다이얼로그에 저장(POST)만 있고 내보내기/가져오기 버튼 없음 (Playwright로 2026-09-12 재확인, 여전히 미구현)

~~후처리 다이얼로그에 "전체 초기화" 버튼~~ — 애초 EQ/FX/리버브·에코를 한 번에 초기화하는 버튼으로 의도했으나, 실제로는 셋을 각각 초기화하는 버튼으로 구현되어 통합 버튼은 드롭하기로 결정. 각 섹션의 개별 초기화 버튼(`EQ 초기화`/`FX Sound 초기화`/`리버브/에코 초기화`)으로 충분하다고 판단.
