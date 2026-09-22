# Patterns

> 검증된 코드 패턴. 복붙 바로 가능한 형태로 유지.

## 로컬 전용 Node HTTP API 보안

**사용 시점:** Electron/로컬 앱의 백엔드가 `127.0.0.1`에만 바인딩되지만 브라우저에서 접근할 때. 외부 사이트의 CSRF성 요청을 막아야 함.

```js
const validHosts = new Set([`127.0.0.1:${ownPort}`, `localhost:${ownPort}`]);
if (!validHosts.has(req.headers.host)) throw fail(403, ...);
const allowedOrigins = new Set([`http://127.0.0.1:${ownPort}`, `http://localhost:${ownPort}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);
if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) throw fail(403, ...);
if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, ...);
```
Host 헤더, Origin allowlist, `Sec-Fetch-Site` 세 겹 방어. JSON 본문만 허용(`content-type` 체크)하면 단순 `<form>` POST 공격도 막힘. 출처: `backend/server.mjs`.

## `.env` 로딩 (Node 24 내장, 의존성 없음)

**사용 시점:** dotenv 패키지 없이 `.env` 파일을 읽어야 할 때.

```js
try { process.loadEnvFile(path.join(root, '.env')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
```
`.env`가 없어도 앱이 정상 시작하도록 ENOENT는 무시. 이미 설정된 `process.env` 값은 덮어쓰지 않음(테스트 격리 시 주의 — trouble-shooting.md 참고).

## 외부 CLI 실행을 테스트 가능하게 만들기 (spawn 의존성 주입)

**사용 시점:** 실제 바이너리(예: audio.cpp) 실행 로직을 유닛 테스트에서 목(mock)으로 검증하고 싶을 때.

```js
export async function createStudioServer({ root = ROOT, spawnImpl = spawn } = {}) { ... }
// 실제 실행: spawnImpl(engine, args, { windowsHide: true })
// 테스트: createStudioServer({ root, spawnImpl: fakeSpawn })
```
`fetchImpl`(LLM 호출용)과 동일한 패턴. 가짜 `spawnImpl`을 만들 때는 모든 이벤트 emit을 최소 한 틱 지연시켜야 함 — 안 그러면 리스너 등록 전에 이벤트가 발생해 테스트가 멈춤 (`C:\Claude\memory-bank\node-fake-spawn-sync-close-race.md` 참고).

## 완성곡을 사용자 지정 폴더/형식으로 별도 저장

**사용 시점:** 내부 작업 폴더(재생/로그용, 고정 wav)와 별개로 사용자가 지정한 폴더에 원하는 이름·형식으로 결과를 저장해야 할 때.

```js
// 파일명 안전화(Windows 금지문자 제거 + 예약어 회피) + 중복 시 자동 번호
function safeFilename(title) { /* <>:"/\|?*와 제어문자 제거, trailing dot/space 제거, CON/PRN/... 회피 */ }
async function uniquePath(dir, base, ext) { /* 존재하면 " (1)", " (2)"... 붙여가며 재시도 */ }

if (settings.saveDirectory) {
  const target = await uniquePath(settings.saveDirectory, safeFilename(project.title), settings.saveFormat);
  if (settings.saveFormat === 'wav') await copyFile(sourceWav, target);
  else await runFfmpeg(sourceWav, target, settings.saveFormat); // spawnImpl 재사용, engine='ffmpeg'
}
```
핵심 설계: 이 저장 단계가 실패해도(ffmpeg 없음 등) **이미 성공한 생성 자체를 실패로 만들지 않는다** — `saveError` 필드에만 기록하고 앱 내 재생용 원본(wav)은 그대로 둔다. 출처: `backend/server.mjs`, `runAudioCpp`.

## 상태별로 다른 폴더 + 제목 기반 파일명으로 저장하는 라이브러리

**사용 시점:** "초안"과 "완성물"을 서로 다른 화면(Projects/Library)에서 보여줘야 하고, 파일명을 사람이 읽을 수 있는 제목으로 유지하고 싶을 때.

```js
const resolveLibraryDir = (relative, defaultRelative) => path.join(root, relative.trim() || defaultRelative);
const settingDir = () => resolveLibraryDir(settings.settingPath, 'library/setting'); // 함수로! PUT으로 바뀌므로 const 캐시 금지
const musicDir = () => resolveLibraryDir(settings.musicPath, 'library/music');

async function uniqueJsonPath(dir, title, excludeFile) {
  const base = safeFilename(title);
  let candidate = path.join(dir, `${base}.json`);
  for (let n = 1; (await exists(candidate)) && candidate !== excludeFile; n += 1) candidate = path.join(dir, `${base} (${n}).json`);
  return candidate; // excludeFile 없으면 순수 신규 생성, 있으면 "제목 안 바뀌었으면 그대로" 허용(자기 자신과 충돌 취급 안 함)
}
```
- id(UUID)는 내부 식별자로만 쓰고, **폴더 자체가 상태를 의미**하므로 별도 `status` 필터 없이 "어느 폴더를 readdir 하느냐"로 목록이 자연히 갈림.
- 목록 조회는 여러 폴더를 순회해 병합(`listEntries()`), 단건 조회는 전체를 읽어 `project.id`로 찾는 선형 탐색(`findEntry()`) — 개인용 로컬 라이브러리 규모(수백 곡)에서는 매 요청 readdir이 충분히 빠름.
- 완료 전환(생성 성공)은 "복사"가 아니라 **`fs.rename`으로 이동** — 두 폴더에 중복 데이터가 남지 않음. JSON도 이동 후 `unlink`로 원본(초안) 제거.
- 제목 변경(rename) 시 파일명도 같이 바꿔야 하면, 오디오 확장자는 `path.extname(project.audioPath)`로 **저장된 실제 확장자에서** 가져와야 함(포맷이 wav 고정이 아니라 사용자가 flac/mp3/mp4를 고를 수 있는 경우 하드코딩 금지).
- 폴더 경로 자체가 설정(설정 화면에서 상대경로로 변경 가능)이면, 경로를 계산하는 함수도 매번 최신 `settings`를 참조하는 **함수**여야 함 — 서버 시작 시 한 번 계산한 `const`로 캐싱하면 PUT으로 바꿔도 반영 안 됨.

## audio.cpp(yue2) CLI 호출 인자

**사용 시점:** GGUF 양자화 모델로 YuE2 음악을 생성할 때.

```js
const args = [
  '--task', 'gen', '--family', 'yue2', '--model', modelRoot, '--backend', 'cuda', '--threads', String(threads),
  '--session-option', `yue2.model_gguf=${mainGguf}`, '--session-option', `yue2.vae_gguf=${vaeGguf}`,
  '--lyrics', lyrics, '--request-option', `style=${style}`, '--request-option', `cot=${cot}`,
  '--request-option', `num_inference_steps=${steps}`, '--seed', String(seed),
  '--out', outputWavPath, '--log', '--metrics',
];
```
`--model`은 GGUF 저장소 폴더(sidecars 포함)를 가리키는 절대경로, `yue2.model_gguf`/`yue2.vae_gguf`는 그 폴더 기준 **상대** 파일명(절대경로 거부됨). stdout에 `metrics.audio_duration_ms=`, `metrics.rtf=` 라인이 찍힘(`--metrics` 필요). 출처: `backend/server.mjs`, 실측 검증 2026-09-12.

## 스크롤되는 다이얼로그 안에서 특정 UI(재생 컨트롤 등)만 항상 보이게 고정하기

다이얼로그 레이아웃이 `.studio-dialog{display:flex;flex-direction:column}` + `.dialog-scroll{flex:1;overflow-y:auto}` 구조일 때, 내용이 길어지면 `.dialog-scroll` 내부 맨 아래에 있는 자식(재생 버튼 등)은 스크롤해야만 보인다. `position:sticky`로 억지로 고정하려 하면 스크롤 컨테이너/오버플로 조상 관계가 꼬이기 쉽다.

더 간단한 해결책: 해당 UI를 소유한 컴포넌트(`AbcPreview`)가 자기 상태/로직은 그대로 유지한 채, 렌더링 위치만 `ReactDOM.createPortal(controlsJsx, slotElement)`로 부모가 지정한 DOM 노드로 옮기게 한다. 부모는 `.dialog-scroll` **바깥**(형제 위치)에 `<div ref={setSlotState}/>`를 두고 그 state를 컴포넌트에 `controlsSlot` prop으로 넘기면 된다. 컴포넌트는 `controlsSlot`이 없으면 기존처럼 내부에 인라인 렌더링(다른 사용처와 호환 유지), 있으면 포탈로 이동 — 하나의 컴포넌트가 "인라인 컨텍스트"와 "다이얼로그 상단 고정 컨텍스트" 둘 다를 지원할 수 있다. `app/app/studio.tsx`의 `AbcPreview`(`controlsSlot` prop) 참고.

## Web Audio 이펙트 체인을 실시간 미리듣기와 최종 저장 렌더링 둘 다에 재사용하기

**사용 시점:** EQ/리버브/에코 등 브라우저 내 오디오 후처리를 "재생하면서 바로 들리게"(라이브) + "저장 시 전체 길이를 오프라인으로 렌더링"(비라이브) 둘 다 지원해야 할 때, DSP 그래프 구성 코드를 두 번 짜지 않으려면.

```ts
function buildProcessingGraph(ctx: BaseAudioContext, source: AudioNode, params: PostProcessParams): AudioNode {
  // BiquadFilterNode(EQ×N, peaking/lowshelf/highshelf), DynamicsCompressorNode,
  // ChannelSplitter/Delay/ChannelMerger(스테레오 폭 넓히기), ConvolverNode(리버브), Delay+피드백 Gain(에코) 등을
  // ctx(AudioContext 또는 OfflineAudioContext 둘 다 받는 BaseAudioContext 타입)로 구성해 최종 출력 노드 반환
}
// 라이브 미리듣기: buildProcessingGraph(audioContext, sourceNode, params).connect(audioContext.destination)
// 저장용 전체 렌더링: const offline = new OfflineAudioContext(...); buildProcessingGraph(offline, offlineSource, params).connect(offline.destination); await offline.startRendering();
```
핵심은 함수 시그니처를 구체 타입(`AudioContext`)이 아니라 공통 상위 타입(`BaseAudioContext`)으로 받는 것 — `AudioContext`와 `OfflineAudioContext`는 노드 생성 API(`createBiquadFilter` 등)가 동일하므로 그래프 구성 로직이 완전히 재사용된다. 파라미터가 바뀔 때마다(디바운스 후) `OfflineAudioContext`로 전체를 다시 렌더링해 파형/저장용 버퍼를 갱신하고, 재생 버튼은 같은 함수로 만든 라이브 그래프를 쓰면 "화면에 보이는 처리 결과 파형"과 "실제로 저장되는 파일"이 항상 일치한다. 출처: `app/app/studio.tsx`의 `PostProcessDialog`/`buildProcessingGraph`, 실측 검증(EQ 밴드+FxSound 노브 드래그 → 처리 파형 디바운스 갱신 → 저장 → ffmpeg 재인코딩된 실제 파일 생성까지 chrome-devtools로 end-to-end 확인, 2026-09-12).

## `PostProcessDialog`는 이미 "프로젝트 없이 임의의 AudioBuffer를 후처리"하는 모드(`sourceOverride`/`onSaveOverride`/`titleOverride`)를 지원함 — 새 EQ 편집기를 만들기 전에 먼저 확인할 것

**사용 시점:** "이 오디오에도 EQ/FX/리버브·에코를 적용하고 싶다"는 요구가 프로젝트(라이브러리에 저장된 완성곡)가 아닌 임의의 클라이언트 측 버퍼(업로드 직후 파일, STEM 트랙, 두 오디오 비교 등)에 대해 나올 때, `PostProcessDialog`를 처음부터 다시 만들지 말 것.

```tsx
<PostProcessDialog
  project={{ id: 'stable-unique-id', title: displayName } as unknown as Project} // .id/.title만 실제로 쓰임(마운트 이펙트 dep, 다이얼로그 설명문)
  sourceOverride={{ buffer: myAudioBuffer, params: myCurrentParams }} // 있으면 project.id로 /api/projects/:id/audio를 fetch하지 않고 이 buffer를 그대로 씀
  onSaveOverride={(processedBuffer, params) => { /* 네트워크 왕복 없이 바로 호출됨 -- saveProcessedBuffer()(다운로드 전용)는 건너뜀 */ }}
  titleOverride={displayName} // 다이얼로그 제목/설명문에 사용, onSaveOverride가 있으면 project.title 대신 이걸 씀
  onClose={...} notify={...}
  visualizerEnabled={false} visualizerRingCount={1} visualizerHue={0} visualizerLineWidth={1} visualizerTrail={0} visualizerSpiral={0} visualizerRingMode="radial" visualizerTimeStep={0.1} visualizerTimeSkew={1} visualizerRingStep={1} visualizerAmplitude={1}
/>
```
`project`는 타입상 필수지만 `sourceOverride`+`onSaveOverride`가 둘 다 있으면 `project.id`/`project.title`은 실질적으로 읽히지 않는다(마운트 이펙트의 fetch 분기와 다운로드 전용 저장 분기 둘 다 건너뜀) — 안정적인 더미 id(리마운트 방지를 위해 `key={행 구분자}`와 함께)만 넘기면 충분하다. 이 메커니즘은 `StemDialog`가 스템별 "후처리" 버튼에 이미 쓰고 있었다(`editingStem`+`handleStemSaved`) — "음원 비교"(두 임의 오디오를 각각 후처리해서 비교) 기능을 추가할 때 그대로 재사용해 새 EQ UI를 전혀 안 만들고 끝냈다(2026-09-18).
**이유:** `PostProcessDialog`는 10밴드 EQ+FxSound 5노브+리버브/에코+프리셋+서클 비주얼라이저까지 갖춘 무거운 컴포넌트라 처음부터 다시 만들면 수백 줄이 중복된다. 이미 "프로젝트 종속성을 뺀" 우회 경로가 준비되어 있다는 걸 모르고 새로 만들면 이 모든 기능을 재구현하게 된다.

## 오디오 재생 상태/전송 로직은 `useAudioTransport`(`app/app/studio.tsx`) 하나를 쓸 것 — 다이얼로그마다 직접 재구현하지 말 것

**사용 시점:** 새 오디오 비교/변환/복원 다이얼로그에서 재생·seek·속도·볼륨·waveform peaks가 필요할 때.

```tsx
const t = useAudioTransport();
// t.setBuffer(key, AudioBuffer|null) → peaks 자동 계산
// t.bufferForKey(key), t.peaksForKey(key), t.handleKeyClick(key)
// t.rowClass(key, base), t.activeKey/isPlaying/positionSeconds/playedFraction
// t.seekTo/seekBy/cycleSpeed/applyPreviewVolume/stopPlayback/closeContext
<SeekRow t={t}/> <TransportControls t={t}/>
```

`useAudioTransport`(1881쪽, `buffersRef`/`peaksMap`/AudioContext+playing-position 추적 전부 포함)는 현재 `TimbreTransformDialog`만 쓰지만, `AudioRestoreDialog`(2676~)·`AudioCompareDialog`(2921~)가 즐겨찾는 버그를 그대로 각자 ~150줄씩 재구현했다(전송 로직이 3벌 존재). 새 다이얼로그는 처음부터 `useAudioTransport`로 시작하고, 기존 2개는 후속 리팩터에서 통합할 것. 출처: `app/app/studio.tsx`, 2026-09-20 코드 감사.

## 새 다이얼로그가 공용 `audio-compare-dialog` 클래스를 재사용하면 그 CSS가 전부 적용된다 (avatars: 레거시/비교 레이아웃 분리)

**사용 시점:** 다른 목적으로 만든 다이얼로그(`TimbreTransformDialog`)에 차트 레이아웃(`CompareWaveform`/`CompareSpectrogram`)이 필요하다고 기존 다이얼로그 클래스(`audio-compare-dialog`)를 그대로 얹을 때.

```css
/* 공용 클래스를 재사용하되, 원래 용도(비교 차트)와 다른 뷰는 전용 클래스로 분리 */
.timbre-transform-dialog .stem-list.timbre-legacy-list .stem-row {
  display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 7px 0;
}
```

`audio-compare.css`의 `.audio-compare-dialog .stem-row{flex-direction:column}`은 비교 차트(툴바+스펙트로그램)용 세로 레이아웃이다. 이걸 `TimbreTransformDialog`에 물려받으면 Seed-VC/Vevo 레거시 행(아이콘+라벨+파형)까지 세로로 쌓이고, column flex에서 `.pp-waveform`의 `flex:1`(=flex-basis:0)이 **높이 축을 0으로 붕괴**시켜 파형이 안 보인다. 공용 클래스 안에서도 다른 레이아웃이 필요한 하위 뷰에는 전용 클래스를 새로 붙여 오버라이드할 것(명시도 0,1,0 → 0,4,0으로 이김). 상세: `memory-bank/knowledge/trouble-shooting.md`의 "레거시 파형 안 보임" 항목.

## 설정 기본값에 사용자 머신의 절대 경로를 하드코딩하지 말 것

**사용 시점:** `studio-data.ts`의 `DEFAULT_*` 상수나 `.env.sample`에 외부 도구(ComfyUI, AudioAuK, DDSP-SVC 등) 경로를 넣을 때.

`DEFAULT_AUDIO_AUK_PATH='C:\Claude\AudioAuK'`처럼 사용자별 절대 경로를 기본값으로 넣으면, 다른 PC(혹은 폴더를 옮긴 같은 PC)에서는 깨지기 쉬운 설정이 된다. 기본값은 빈 문자열로 두고 첫 실행 시 경로 탐색/유도로 안내하고, 성공 중인 경로는 각자 `data/settings.json`에 저장되는 구조가 낫다(기존 `enginePath`류 설정과 동일 패턴).

## 다이얼로그 폼은 label-control 연결을 명시할 것 (`role="group"` 남발 금지)

**사용 시점:** `AudioToolsPage`/`TimbreTransformDialog`처럼 입력 필드+설명문 데이터 기반 폼을 그릴 때.

`<label className="field-hint">...<Input/>`처럼 label로 감싸는 방식은 접근성 트리에서 인식되게 `htmlFor`+`id`로 연결하고, 단순 컨테이너에 `role="group"` 대신 의미론적 태그(필요 시 `aria-labelledby`)를 쓴다. `<audio>`/`<canvas>`에는 재생 상태를 알릴 `aria-label`/설명이 있어야 한다. 화면 낭독 대상이므로 키보드 포커스가 아니라 접근성 검사 상의 경고로 잡히는 항목들.

## AuK long-audio chunk stitching

- For no-reference AuK timbre conversion, split long vocals into 10-second windows with an 8-second stride so adjacent windows overlap by 2 seconds.
- Reuse one seed for every chunk in the same conversion to reduce timbre drift.
- Keep the first chunk except its final second, trim one second from both sides of middle chunks, and trim the first second from the last chunk before concatenation. This preserves the midpoint of each overlap without duplicating time.
- Report progress from completed chunk count instead of a time-only estimate.

## 10-second chunk pipeline for any short-window voice engine (AuK / Seed-VC / Vevo2)

- Applied whenever an input exceeds the engine window (10s): split the source with a fixed stride
  smaller than the window (8s) so adjacent windows overlap by the difference (2s).
- Keep the first chunk except its final edge second, trim one second from both sides of middle
  chunks, and trim only the first second from the last chunk before concatenation. Every cut lands
  inside an overlap zone and each window's midpoint stays intact.
- Reuse the SAME reference clip and the SAME seed across all chunks of one conversion to avoid
  speaker/timbre drift. (User-confirmed: per-chunk different references are not needed.)
- Never chunk content whose meaning depends on absolute position or duration -- nonverbal insert
  (position relative to the full clip), lyrics/line edits (text anchors), and the voice-cloning
  sample that is the *subject* of the request stay single-shot. Only position-independent
  instructions (loudness/pitch/speed/whisper/noise removal) are safe to chunk.
- Surface the outcome with a warning naming the window/overlap/part count and possible seams at
  chunk boundaries.
- Implement with `ffmpeg atrim+asetpts=PTS-STARTPTS` per chunk and one final
  `concat=n={N}:v=0:a=1`; measure input length first (single ffprobe) to decide chunking.

## Longer-than-window TTS text splitting

- When a TTS tool yields the output budget from text length (seconds=0) and the estimated speech
  time exceeds the 10s engine window, split the text into line-aware segments that each fit under
  the threshold, generate one job per segment, decode all results, and concatenate the buffers
  (`OfflineAudioContext` sources scheduled sequentially by cumulative time), then re-encode to WAV.
- If the user explicitly pins an output length (seconds>0), respect it and do not split.
- The instruction template is rebuilt per segment with only the text replaced, so the user's choices
  are preserved across parts.

## 긴 음성 변환의 공통 청크 처리

- Seed-VC, Vevo2, AuK처럼 긴 입력에서 품질이 무너지는 엔진은 10초 창, 2초 겹침, 양쪽 경계 1초 트림 방식으로 처리한다.
- 모든 청크에 같은 참조 음성을 재사용하고, 진행률·경고·청크 수를 공통 반환 형식으로 유지한다.
- TTS 텍스트는 예상 발화가 10초를 넘고 명시적 길이가 없을 때만 문장 단위로 나누어 생성 후 연결한다.