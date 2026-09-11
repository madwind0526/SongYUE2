# Trouble Shooting

> 발생했던 버그와 해결 방법. 같은 문제를 두 번 겪지 않기 위한 기록.

## `curl -I`(HEAD)로 라우트를 확인하면 실제로는 멀쩡한데 404로 보임

### 증상

`GET /api/.../audio`가 실제로는 정상(200, 올바른 바이트) 동작하는데, `curl -sI`로 확인하면 404가 뜬다. 파일 인코딩이 깨졌다고 오인해 한참 다른 곳을 파게 됨.

### 원인

`curl -I`는 HEAD 요청을 보낸다. 이 프로젝트의 라우트들은 전부 `if (... && req.method === 'GET')`처럼 GET만 명시적으로 매칭하므로, HEAD는 어떤 라우트에도 안 걸리고 맨 끝의 `throw fail(404, ...)`로 떨어진다. 브라우저의 `<audio>`/`<img>`/`fetch()`는 HEAD를 안 쓰므로 실제 앱 동작에는 전혀 영향이 없다.

### 해결

라우트 동작을 curl로 확인할 때는 `curl -sI`(HEAD) 대신 `curl -s -o file -w "%{http_code}"`(GET)로 확인한다. HEAD 지원이 실제로 필요하면 해당 라우트에서 `req.method === 'GET' || req.method === 'HEAD'`를 명시적으로 처리해야 한다(현재 프로젝트는 필요 없어서 안 함).

## 비-ASCII(한글) 파일 내용/이름은 Python `repr()`/Bash 터미널 출력만 보고 깨졌다고 판단하지 말 것

### 증상

같은 파일을 두고 Node(`fs.readFile` + 콘솔 로그)로 보면 완벽히 정상인 한글인데, Python 스크립트를 Bash 도구로 실행해 `print(repr(...))`한 결과나 `curl`로 받은 바이트를 그대로 터미널에 찍으면 `Ŀư ���� ����`처럼 깨져 보인다.

### 원인

이 환경의 Bash 도구/Windows 콘솔 파이프라인은 코드페이지에 따라 UTF-8 텍스트를 다른 인코딩으로 잘못 디코딩해 **화면 표시만** 깨뜨릴 수 있다. 파일의 실제 바이트나 Node가 보는 문자열은 전혀 손상되지 않은 경우가 흔하다.

### 해결

한글(비-ASCII) 데이터가 깨져 보이면, **그 데이터를 실제로 소비하는 런타임**(여기서는 Node.js — `fs.readdir`/`JSON.parse` 후 `codePointAt`으로 코드포인트를 직접 찍어보기)으로 검증한다. Python 세컨더리 스크립트나 Bash 터미널 표시만 보고 파일을 고치거나 재작성하지 않는다 — 이미 정상인 파일을 잘못 건드릴 위험이 있다.

## audio.cpp의 yue2 지원은 `dev` 브랜치에만 있고 프리빌드 바이너리가 없음

### 증상

`0xShug0/audio.cpp` GitHub Releases에서 Windows 프리빌드 zip을 받아도 `--family yue2`가 인식되지 않을 것으로 예상됨(직접 검증은 안 했으나 소스 확인으로 확실).

### 원인

`git tree`로 `main`과 `dev` 브랜치를 비교한 결과 yue2 관련 파일(`src/models/yue2/`, `model_specs/yue2.json`, `docs/models/yue2.md` 등)이 `dev`에만 있고 `main`에는 0개. Releases 페이지의 프리빌드는 `main`/태그 기준이라 yue2 미포함. `model_specs/yue2.json`에도 `"status": "experimental"`.

### 해결

`git clone -b dev --depth 1 https://github.com/0xShug0/audio.cpp.git`로 소스를 받아 직접 빌드해야 함. Windows 빌드는 `.\scripts\build_windows.ps1 -Preset windows-cuda-release -Target audiocpp_cli -ModelSet custom -Models yue2 -CudaArchitectures 120a-real`(RTX 50시리즈). 이 PC는 CUDA 12.8/VS2022 MSVC/Windows SDK/CMake·Ninja(VS 번들)/git이 모두 이미 있어 추가 설치 없이 바로 빌드됨. 자세한 절차는 `docs/audiocpp-setup.md`.

## 백엔드 코드를 고쳐도 이미 떠 있는 `node backend/server.mjs` 프로세스는 핫 리로드가 안 됨

### 증상

`backend/server.mjs`를 고치고 프론트엔드에서 테스트했는데 옛 동작이 그대로 나옴(예: `.env`/엔진 연결 전 버전처럼 `apiKeyStorage:"session"`이 나오거나, 새로 추가한 라우트가 "요청한 기능을 찾을 수 없습니다" 404로 응답). 같은 문제로 실제 사용자가 두 번 막힘 — 처음엔 `.env`/audio.cpp 엔진 연결, 두 번째는 `DELETE /api/projects/:id` 추가 후.

### 원인

Node.js는 파일 변경을 감지해 자동 재시작하지 않는다(Vite 같은 프런트엔드 dev 서버와 다름). `npm run dev`/`Start-SongYUE2.cmd`나 이전 세션에서 띄워둔 `node backend/server.mjs` 프로세스가 포트 4311을 계속 점유한 채 옛 코드로 응답을 계속한다.

### 해결

백엔드(`backend/server.mjs` 또는 그게 import하는 파일)를 고칠 때마다 반드시 재시작한다.

```bash
netstat -ano | grep 4311 | grep LISTENING   # PID 확인
taskkill //PID <PID> //F
node backend/server.mjs &   # 재기동, 이후 /api/health로 새 필드가 보이는지 확인
```

### 재사용 가능한 교훈

프론트엔드(Vite/HMR)와 백엔드(순수 Node) dev 서버는 재시작 규칙이 다르다. 백엔드 파일을 수정한 직후에는 습관적으로 재시작 여부를 확인할 것 — 특히 세션이 길어져 "아까 띄운 서버"의 존재를 잊기 쉬운 상황(다른 작업을 한참 하다가 백엔드로 돌아왔을 때)에서 반복되는 실수다.

## `node --test`에서 여러 `createStudioServer` 인스턴스가 `.env` 값을 공유해 격리가 깨짐

### 증상

한 테스트 파일 안에서 서로 다른 `.env` 내용으로 여러 번 서버를 띄우는 테스트를 작성했더니, 나중 테스트의 `.env` 값이 반영 안 되고 먼저 실행된 테스트의 값이 계속 남아있음.

### 원인

`process.loadEnvFile()`은 이미 `process.env`에 설정된 키는 덮어쓰지 않는다(dotenv와 동일한 기본 동작). 같은 Node 프로세스에서 `node:test`의 여러 `test()`는 순차 실행되며 `process.env`를 공유하므로, 먼저 실행된 테스트가 설정한 값이 이후 테스트의 `.env` 재로딩을 무력화한다.

### 해결

각 테스트 시작 시 관련 env 키를 명시적으로 `delete process.env[key]` 한 뒤 `.env`를 쓰고 서버를 생성한다 (`backend/server.test.mjs`의 `resetEnv()` 참고).

## 가짜 `spawn` mock이 동기적으로 완료되면 테스트가 영원히 멈춤

같은 원인/해결/재사용 가능한 교훈을 전역 지식 베이스에 상세히 기록함: `C:\Claude\memory-bank\node-fake-spawn-sync-close-race.md`. 요약: 조건부로만 `await`를 타는 fake spawn IIFE는 그 분기에서 완전히 동기 실행되어 `close` 이벤트가 리스너 등록 전에 발생 → 항상 `await new Promise(resolve => setTimeout(resolve, delayMs || 0))`로 시작해 최소 한 틱을 강제해야 함.

## 새 API 라우트를 백엔드에 추가하고 재시작을 잊으면 "데이터가 다 사라진 것처럼" 보임

### 증상

사용자가 "이전에 있던 노래/설정이 다 없어졌다"고 보고. 실제로는 `Library/Music`·`Library/Setting`의 JSON/오디오 파일이 디스크에 그대로 있고 `curl`로 개별 라우트(`/api/projects`, `/api/settings`)를 찔러보면 전부 정상 응답.

### 원인

프론트엔드 초기 로드가 `Promise.all([api('/projects'), api('/settings'), api('/examples'), api('/playlists')])` 처럼 여러 엔드포인트를 한 번에 묶어서 호출하고, 그중 **하나라도 실패하면 전체 `.catch()`가 걸려 `setOnline(false)`** 로 빠진다. 이 세션에서는 `/api/playlists` 라우트를 백엔드 소스에 새로 추가했지만 이미 떠 있던 `node backend/server.mjs` 프로세스를 재시작하지 않아 그 라우트만 404를 반환 → `Promise.all` 전체가 reject → 화면 전체가 "오프라인/빈 상태"로 보여 마치 모든 데이터가 사라진 것처럼 오인됨. 근본 원인은 [위 항목](#백엔드-코드를-고쳐도-이미-떠-있는-node-backendservermjs-프로세스는-핫-리로드가-안-됨)과 동일(백엔드 무재시작)이지만, 증상이 "일부 기능 404"가 아니라 "전체 데이터 유실처럼 보임"으로 나타나는 게 다른 점.

### 해결

1. 먼저 디스크(`Library/Music`, `Library/Setting` 등)와 `curl`로 개별 API를 찔러 데이터가 실제로 있는지 확인 — 삭제/복구를 시도하기 전에 반드시 이 단계부터.
2. 새 라우트를 추가했다면 백엔드를 재시작(`netstat -ano | grep 4311 | grep LISTENING` → `taskkill //PID <pid> //F` → `node backend/server.mjs`)하고 새 라우트가 200을 반환하는지 확인.

### 재사용 가능한 교훈

프론트엔드에서 초기 로드를 `Promise.all`로 여러 엔드포인트를 묶으면, 그중 하나만 죽어도(신규 라우트 미배포, 오타난 경로 등) 사용자에게는 "전부 사라짐"으로 보인다. 이런 구조에서는 각 엔드포인트를 개별 `.catch()`로 감싸 부분 실패를 허용하거나, 최소한 에러 메시지에 어떤 요청이 실패했는지 남기는 편이 디버깅에 유리하다.
