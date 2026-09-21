# Cache

> 임시 발견사항 저장소. Wave 완료 후 knowledge/로 flush하고 이 섹션을 비울 것.

## Active Findings

- **Tools 페이지 재설계(2026-09-20, 커밋 전)**: ① 명칭 "오디오 도구 (실험적)" → "Tools (실험적)" — 사이드바 버튼, `titles.tools`, 페이지 h1, 저장 곡 제목("Tools - ...") 일괄 변경. ② 경고 문구(inline-note warning) 제거. ③ 좌/우 분할 30:70 → 40:60(`flex 0 0 40%`/`1 1 60%`, inputs max-width 제거), 탭과 입력 영역 사이 간격 확대(`.audio-tools-tabs{margin-bottom:12px}` + `.audio-tools-panel{margin-top:24px}`). ④ 좌측 필드 순서 재구성: 오디오 선택(상단, 왼쪽) → 모델 선택(Flash/Base) → Function 선택 → 가변 필드(음색 설명/말할 내용/출력 길이) → 실행. TTS 카테고리는 한글 탭 대신 가사/대사 편집과 같은 `at-function` 체크 칩으로 "Function 선택"(TTS (T2S)/TTS 생성 (Ref-T2S), `selectTool` 재사용, sub-tabs 행은 tts일 때만 숨김). ⑤ 결과 패널: **원본/처리본 2행 동시 표시**(음원 비교 다이얼로그 패턴 그대로 — `at-rowClass`로 원본이면 `pp-row-playing-original`, 처리본이면 `pp-row-playing-processed` 글로우). 파일 선택 즉시 원본 행(버퍼 key='source', `handlePickFile`에서 decode)을 띄우고 처리본은 실행 전 "대기" 상태로 표시. 각 행의 CompareWaveform/Spectrogram은 자기 자신의 실제 duration으로 X축을 그려 "10초 고정 느낌" 해소 — 입력 오디오 길이 기준, 속도/text 길이 따라 짧거나 길어질 수 있음(seek bar max는 재생 중인 행의 duration, `activeKey` 기준).
- **저장 가사 활용 AuK 개선(2026-09-20, 커밋 전)**: 사용자 보고(Whisper가 "아. 아. 아." 같은 환각을 뱉음) 해결 — 앱에서 만든 저장곡은 오디오 옆 `{제목}.json`에 원곡 가사가 있으므로 그걸 쓰고 전사를 건너뛴다. 구현: ① 신규 `GET /api/library/meta?path=<library 상대 .json 경로>` → `{title, lyrics, style}`(비-json 400, 없음 404 — 외부 오디오는 404라서 기존 전사 폴백 유지). ② `applyAukTimbreCore`/`auk/apply` 라우트에 `lyrics` 수용 — 표시 transcript는 원본 그대로, AuK instruction은 `[Verse]/[Chorus]` 구간 표기를 제거해 전달. ③ `auk.mjs submitAukJob` reference 분기: `lyrics` 있으면 `/api/transcribe`(Whisper) 스킵. ④ 프론트: `pickSource`에서 형제 json을 meta로 조회해 `sourceLyrics` state에 보관(외부 파일이면 조용히 null), apply에 `lyrics` 전달, 표시 라벨은 "원곡 가사 (저장된 가사)"로 구분하고 저장 가사가 있으면 apply 전부터 즉시 표시. 테스트 2건 추가(meta 라우트 + lyrics 시 transcribe 미호출·구간표기 제거 instruction), 22개 전부 통과. **중요: 신규 라우트라 백엔드 재시작 필요.**
- **음색 변조 후속(2026-09-20, 커밋 전)**: ① 라벨을 "음색 변조 (평가중)"으로 변경(사이드바+dialog 제목). ② 참조 보컬 분리 실패 디버깅: 신규 라우트나 50MB 상한(→200MB로 조정, prepare와 동일)이 원인 후보였고, 프론트가 실패를 조용히 삼키고 있어 재현이 어려웠음 → 이제 실패 메시지를 행에 직접 표시(`stem-separating-error`). **주의: 백엔드는 재시작해야 신규 라우트가 반영된다(vite HMR은 프론트만).** ③ 파형 색상 구분: 레거시 목록을 원곡=초록(`source` 변형)/참고곡=파랑(`reference` 변형)/변환곡=호박(`processed` 기존)으로 색 코딩, 파형 span 색+재생 글로우(`pp-row-playing-source/reference`)까지 가족 색 적용. `Waveform`의 `variant` 유니언 확장(processed|source|reference). 재생 글로우를 가족별로 바꾸기 위해 레거시 목록만 `legacyRowClass()` 사용(전역 `rowClass`는 원곡 초록 고정).
- **음색 변조 레거시 목록 개편(2026-09-20, 커밋 전)**: ① 행 순서를 "원곡 > 원곡 보컬 > 원곡 악기 > 참고곡 > 참조 보컬 > 변환곡 > 변환곡 보컬"로 변경 — 변환곡 악기 행 제거, 참조 보컬 행 추가(신규 `POST /api/timbre-transform/reference/separate` → `separateReferenceVocal()`이 mel_band_roformer로 참조 오디오를 즉석 분리, preview 캐시 없음). 프론트는 참조 선택 시 `reference-vocal` 버퍼를 비동기로 로드, 연속 선택 시 토큰(`referenceSepTokenRef`)으로 마지막 선택만 반영. ② 왼쪽 edge/파형 길이 정렬: `.stem-row-sub`의 24px 들여쓰기(`margin-left:24px`)가 행 전체를 밀어 파형 좌측 edge와 폭이 어긋났음 → `timbre-legacy-list .stem-row-sub{margin-left:0}`로 해제, 행은 [아이콘 30px][라벨 84px][파형 flex:1] 3열로 완전히 정렬.
- **audio-tools 재설계 건(2026-09-20, 커밋 전)**: ① `AukTool`에 `showSeconds?` 추가 — TTS(T2S)는 출력 길이 필수(양수), Ref-T2S는 0=참조 오디오 길이 허용이며, 오디오 있는 작업(편집/조절 등)은 `showSeconds` 없이 항상 0. `seconds` 기본값은 오디오 없음=10, 오디오 있음=0으로 도구 전환 시 재설정(기존 동작 그대로 보존). ② 가사/대사 편집은 Function 1개만 선택(체크박스 but 단일 선택)되고 함수별 필드가 아래에 렌더링 — "삭제"는 자연상 입력 1개(삭제할 구절)만 필요, 사용자에게 명시 안내 필요. ③ 전사 경로는 auk/transcribe 모두 `normalizeInputAudio(workDir, dataUrl)`(ffmpeg→모노 44.1kHz WAV) 공유. ④ 결과는 오디오 도구 페이지에서 `key='output'`로 로드 — dialog가 아니므로 audio-compare.css의 dialog 스코프 규칙을 `audio-tools.css`에서 재적용. ⑤ `readFileAsDataUrl` 모듈 스코프 승격(음색 변조+오디오 도구 공유).

- 커밋 여부 확인 대기 중. Vevo2 문서 drift, DDSP 취소 버그 등은 별도 항목으로 지속.

---

## 유형 분류

| 유형 | 이동 대상 |
|------|-----------|
| 코드 패턴 | `knowledge/PATTERNS.md` |
| 규칙/원칙 | `knowledge/RULES.md` |
| 버그/해결 | `knowledge/trouble-shooting.md` |
