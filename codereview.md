# 코드 리뷰 (2026-09-26)

## 대상

- 미커밋 변경: `app/app/studio.tsx`, `app/app/adapters.css`
- 미추적 파일: `scripts/lora_compare.py`, `.vscode/settings.json`
- 문서 변경: `todo.md`, `memory-bank/*`

## 요약

차단 수준(P0/P1) 문제는 발견하지 않았습니다. Installed 탭의 분류·언어 필터 로직 자체는 허깅페이스 탭과 판정 함수를 공유하고, 정렬도 필터 결과에 적용되어 의도대로 동작합니다. 다만 필터 상태 관리와 미추적 진단 스크립트에서 P2 2건을 발견했습니다.

## Findings

### [P2] 옵션에서 사라진 필터 선택이 초기화되지 않음

- 위치: `app/app/studio.tsx:3663-3664`, `app/app/studio.tsx:3793`, `app/app/studio.tsx:3804`, `app/app/studio.tsx:3886-3887`
- 증상: 허깅페이스 새로고침이나 목록 변화로 선택했던 분류·언어가 옵션에서 사라져도 `mineCategory` / `mineLanguage` / `category` / `language` 상태는 그대로 남는다. 그 결과 목록이 비어 보이는데 활성화된 칩이 없어 사용자가 왜 비었는지 알 수 없다.
- 더 큰 문제: 허깅페이스 탭은 `languages.length > 0`일 때만 언어 칩을 렌더링하므로, 선택한 언어와 언어 옵션이 모두 사라지면 `전체` 버튼까지 사라져 상태를 되돌릴 방법이 화면에 남지 않는다. 탭을 전환해도 상태는 유지된다.
- 재현: 허깅페이스 탭에서 특정 언어 칩 선택 → 새로고침으로 해당 언어 옵션이 사라진 목록을 받음 → 결과가 모두 숨겨지고 언어 칩 행 자체가 사라짐.
- 영향: 일반적인 캐시 유지 구간(10분)에서는 잘 드러나지 않지만, 새로고침·분류 변경·네트워크 실패로 허깅페이스 목록이 바뀔 때 빈 화면 상태로 남을 수 있다.
- 권장: 렌더 시 선택값을 현재 옵션과 대조해 유효값으로 보정하거나, 옵션이 바뀔 때 해당 상태를 초기화하는 effect를 추가한다.
  - 예: `const activeLanguage = languages.includes(language) || !language ? language : ''`
  - Installed 탭은 `전체` 칩이 항상 있으므로 상태 보정만으로 복구된다.

### [P2] 기준 텐서가 0이면 실제로 다른 파일을 "차이 0"으로 보고

- 위치: `scripts/lora_compare.py:32`, `scripts/lora_compare.py:36`
- 증상: `worst` 계산은 `norm > 0`인 텐서만 검사하고, 전체 `relative`도 `total_norm > 0`이 아니면 `0.0`을 출력한다. 기준 파일의 텐서가 전부 0인데 후보 파일이 0이 아니면, 두 파일이 완전히 다른데 `relative: 0`이 출력된다. 개별 텐서가 0인 경우에도 `largest` 후보에서 조용히 빠진다.
- 영향: 학습 결과 비교용 스크립트가 "EMA와 원본이 동일하다"라는 잘못된 결론을 만들 수 있다. 특히 초기 학습 단계에서 일부 텐서가 0인 경우는 드물지 않다.
- 권장: 0인 기준 텐서를 계수로 집계해 `zeroReference` 같은 필드로 따로 보고하거나, 분모에 epsilon을 사용하거나, 기준이 0인 경우 비율을 `null`(미산정)로 출력한다. 현재 `tensors` 카운트에 0 텐서 개수를 추가하는 것도 도움이 된다.

### [P3] 로컬 전용 절대 경로가 든 `.vscode` 설정

- 위치: `.vscode/settings.json:2`
- 내용: `"cmake.sourceDirectory": "C:/Claude/SongYUE2/engine/audio.cpp"`
- 영향: 이 파일을 커밋하면 다른 PC나 다른 경로의 작업 복사본에서 CMake 경로가 깨진다.
- 권장: 커밋 대상에서 제외하거나(`.gitignore`), 저장소를 옮겨도 동작하는 상대 경로 설정으로 바꾼다. 현재는 미추적 상태이므로 커밋하지 않으면 문제없다.

## 정적 검사 관찰 (기능 버그 아님)

- 새 코드가 oxlint 오류 3건을 추가한다: `app/app/studio.tsx:3847`, `:3848`의 `role="group"`, `app/app/studio.tsx:3852`의 `role="status"`가 `jsx-a11y(prefer-tag-over-role)`에 걸린다. 각각 `fieldset`/`legend`, `output` 등으로 바꿀 수 있다.
- 다만 `npm --prefix app run lint`는 이번 변경 이전에도 대량의 오류로 이미 실패 상태라, 린트를 통과 게이트로 쓰기는 어렵다. 새 코드도 통과 기준을 맞추려면 위 3건을 정리하는 편이 좋다.

## 테스트 커버리지 공백

- Installed/허깅페이스 필터는 200줄 안팎인 컴포넌트 안에 인라인으로 남아 있어 자동 회귀 테스트가 없다. `languageOptions` / `matchesCategory` / `matchesLanguage`을 순수 함수로 분리해 단위 테스트하면 옵션 변경 시 상태 초기화 같은 이번 Finding을 테스트로 고정할 수 있다.
- 현재 테스트는 백엔드 위주(63개)이고 프론트 필터 동작은 직접 브라우저 확인에만 의존한다.

## 검증 결과

| 항목 | 결과 |
|------|------|
| `npm run check` (tsc --noEmit) | 통과 |
| `npm test` | 통과 (63/63) |
| `git diff --check` | 통과 (adapters.css의 LF→CRLF 경고만 존재) |
| `npm --prefix app run lint` | 실패 (기존 오류 다수 + 이번 변경 3건) |
| 브라우저 실기 확인 | 이번 리뷰에서는 재실행하지 않음 |

## 판단

- Installed 필터 추가 자체는 기존 정렬·카드 렌더링·선택 유지와 잘 맞물리고, 설치 메타데이터를 저장하지 않고 표시·필터용으로만 보완하는 점도 안전하다.
- P2 두 건을 먼저 정리하고 커밋하는 것을 권장한다. `lora_compare.py`는 커밋 대상이 아니라면 아무 영향이 없다.
