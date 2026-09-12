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
