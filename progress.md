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

## 실제 환경에서 검증 필요 (코드는 준비됐지만 종단 테스트 못 함)

- [ ] **SheetSage2 제로샷 커버**: `models/m-a-p/SheetSage2/`에 `config.json`+전체 코드가 이미 설치되어 있어 로컬 모델 인식 조건은 충족됨. 남은 것은 `test/YuE2-source/requirements-sheetsage2.txt`(torch 2.8.0/transformers 4.45.2 등, 본체 venv와 버전이 달라 별도 venv 필요) 설치와 설정 화면의 `sheetSagePythonPath` 지정뿐 — venv 생성 여부는 아직 확인/실행 안 함. venv 준비 후 `POST /api/cover-transcribe` 종단 테스트 필요.
- [ ] **"악기만" mute-voice 전환의 실제 오디오 검증**: 코드 수정과 유닛 테스트(가짜 spawn)는 통과했지만, 실제 원본(공식 Python) 엔진으로 생성해 Vocal 화음 기호가 남은 ABC가 실제로 화성이 유지된 무보컬 오디오를 만드는지는 아직 실기 검증 전.
- [ ] **INT8 ConvRot 모델**: 지금은 명확한 한국어 안내로 생성을 차단만 함. ComfyUI 어댑터를 실제로 붙여 생성 가능하게 만드는 작업은 시작 전.
- [ ] **ABC "파일에서 가져오기"**: JSON의 `abc` 필드 추출 / 일반 텍스트 폴백 로직은 코드 리뷰로만 검증했고, 실제 파일 업로드로 브라우저에서 종단 테스트는 아직 안 함.
- [ ] **File System Access API 미지원 브라우저**(Safari, Firefox 등)에서의 폴백 저장 경로 — 현재는 Chrome에서 `showSaveFilePicker`/`showOpenFilePicker`를 임시로 지워서 폴백을 강제 검증했을 뿐, 실제 비-Chromium 브라우저 테스트는 안 함.

## 알려진 제약 (설계상 의도이며 버그 아님)

- GGUF 모델(Q4/Q8/BF16)에서 "악기만"은 `instrumental, no vocals` 스타일 힌트일 뿐 구조적 보장이 없음. 보컬을 확실히 제거하려면 "원본"(공식 Python) 모델을 써야 함 — `abc_tools.py mute-voice`로 보컬 성부를 화음 기호는 남긴 채 쉼표 처리하는 구조적 방식은 원본 모델 전용.
- 후처리/EQ는 **브라우저 세션 내 실시간 미리듣기**(Web Audio API)이며, "저장" 버튼을 눌러야만 서버가 처리된 오디오를 원본과 같은 파일 형식으로 재인코딩해 저장함. 원본 곡 파일은 절대 바뀌지 않음.
- EQ 프리셋과 전체 설정 프리셋은 `SongYUE2/Setting/EQ-preset/`, `SongYUE2/Setting/PostProcess/`에 로컬 파일로만 저장됨 — 다른 PC로 옮기려면 해당 폴더를 직접 복사해야 하고, 자동 동기화 기능은 없음.

## 테스트 커버리지

- 백엔드: `node --test backend/server.test.mjs` — 8개 스위트 전체 통과(생성 파이프라인, 저장 포맷, 심볼릭 작곡/ABC 라이브러리, EQ·후처리 프리셋 저장 위치 등).
- 프론트엔드: 자동화 테스트 없음. 후처리/EQ 다이얼로그, EQ 프리셋, 전체 설정 프리셋, 서클 비주얼라이저는 chrome-devtools MCP로 실제 브라우저에서 수동 검증만 완료된 상태(재실행 가능한 자동 테스트는 아님).

## 향후 개선 아이디어 (필수 아님, 우선순위 낮음)

- 비주얼라이저 커스터마이즈(라인 색상/개수, 켜고 끄기)를 설정으로 노출
- EQ 프리셋 / 전체 설정 프리셋 파일 내보내기·가져오기(다른 PC로 옮기기 쉽게)
- 후처리 다이얼로그에 "전체 초기화" 버튼(EQ/FX/리버브·에코 개별 초기화는 이미 있음)
