# Trouble Shooting

> 발생했던 버그와 해결 방법. 같은 문제를 두 번 겪지 않기 위한 기록.

## 새 CSS 클래스가 안 먹힐 때: 나중에 정의했다고 이기지 않는다 (specificity)

### 증상

`.abc-score-textarea{min-height:215px}`를 추가했는데도 실제 렌더링된 textarea 높이가 90px(약 4줄)로 고정되어 바뀌지 않았다.

### 원인

같은 CSS 파일에 이미 `.detail-dialog textarea{min-height:90px}`라는 규칙이 있었다. 이 규칙(클래스 1개+태그 1개 = 명시도 0,1,1)이 새로 추가한 `.abc-score-textarea`(클래스 1개 = 명시도 0,1,0)보다 **명시도가 더 높아서**, 파일 내 작성 순서와 무관하게 항상 이겼다. 편집 다이얼로그가 `className="studio-dialog detail-dialog"`를 쓰고 있어서 그 안의 모든 `<textarea>`가 이 범용 규칙에 걸린 것.

### 해결

브라우저에서 직접 `getComputedStyle()`과 매칭된 CSS 규칙 목록을 찍어봐서 실제로 어떤 규칙이 이기고 있는지 확인했다(추측 대신 실측). 고친 방법: 목표 규칙에 `!important`를 붙여 확실히 이기게 함(`.abc-score-textarea{min-height:215px!important}`). 더 일반적인 해법은 선택자 명시도를 올리는 것(`.dialog-scroll .abc-score-textarea`처럼 클래스를 하나 더 얹기).

### 재사용 가능한 교훈

"CSS를 추가했는데 안 먹힌다"는 문제는 대부분 순서가 아니라 **명시도 경쟁**이다. 특히 이 프로젝트처럼 여러 다이얼로그가 `.detail-dialog`/`.studio-dialog` 같은 공용 클래스를 재사용하는 구조에서는, 그 공용 클래스에 걸린 범용 규칙(`.detail-dialog textarea`, `.detail-dialog label` 등)이 나중에 추가한 더 구체적인 의도의 클래스를 조용히 덮어쓸 수 있다. 의심되면 브라우저에서 `getComputedStyle` + 매칭 규칙을 직접 찍어 확인할 것 — 코드만 읽어서는 이런 명시도 충돌을 놓치기 쉽다.

## 서드파티 JS 라이브러리가 자기가 그리는 DOM 요소에 인라인 스타일을 강제로 씀 — 그 요소를 직접 스타일링하지 말 것

### 증상

`abcjs`의 `responsive: 'resize'` 옵션으로 렌더링한 컨테이너에 `max-height`+`overflow-y:auto`를 CSS로 줬는데, 실제로는 항상 원본 크기(수천 px)로 그려지고 스크롤도 안 됐다.

### 원인

`abcjs`가 반응형 처리를 위해 자신이 렌더링을 주입하는 그 DOM 엘리먼트에 직접 `element.style.overflow = 'hidden'`, `padding-bottom: <종횡비>%` 같은 **인라인 스타일**을 겁니다. 인라인 스타일은 일반 스타일시트 규칙보다 항상 우선하므로, 같은 엘리먼트에 건 내 `overflow-y:auto`/`max-height`가 무시되거나(overflow는 확실히 덮어써짐) 예상과 다르게 동작했다.

### 해결

라이브러리가 직접 관리하는 엘리먼트에는 CSS를 걸지 않고, **그 바깥에 래퍼(wrapper) div를 하나 더 두고 래퍼에 크기/스크롤 관련 스타일을 준다**. 라이브러리는 자기 자식 엘리먼트를 마음대로 조작하게 놔두고, 레이아웃 제어는 한 단계 바깥에서 한다.

```tsx
// 나쁨: ref를 단 그 엘리먼트에 직접 크기 제약을 건다 — 라이브러리가 인라인 스타일로 덮어씀
<div className="abc-preview" ref={ref}/>

// 좋음: 래퍼에 크기 제약, 안쪽 div는 라이브러리가 완전히 소유
<div className="abc-preview"><div ref={ref}/></div>
```

### 재사용 가능한 교훈

서드파티 렌더링 라이브러리(차트, 악보, 지도, 에디터 등)를 CSS로 감싸려 할 때, "내가 준 클래스가 안 먹힌다"고 느껴지면 먼저 그 엘리먼트에 **라이브러리가 인라인 스타일을 쓰고 있는지**(`el.getAttribute('style')`) 확인할 것. 그렇다면 그 엘리먼트를 직접 스타일링하는 대신 감싸는 래퍼를 만들어야 한다.

## SVG의 `fill="currentColor"`는 어두운 테마의 밝은 글자색을 그대로 물려받아 밝은 배경 위에서 보이지 않게 될 수 있다

### 증상

`abcjs`로 그린 악보 SVG가 DOM에는 정상적으로 존재하고(`querySelector('svg')`가 요소를 찾음, 크기도 정상) 콘솔 에러도 없는데, 화면에는 완전히 빈 크림색 박스만 보였다.

### 원인

라이브러리가 그린 SVG의 실제 도형들이 `fill="currentColor" stroke="currentColor"`를 쓰고 있었다. `currentColor`는 CSS `color` 속성을 상속받는데, 이 앱은 어두운 테마라 전역 텍스트 색이 밝은 색(`#e8ece2` 계열)이었다. 그 결과 "악보 잉크" 색이 밝은 회백색이 되어, 악보를 담은 크림색(`#f4f1e6`) 배경 위에서 명암비가 거의 0에 가까워 실질적으로 안 보였다 — DOM에는 다 있지만 눈에는 안 보이는 상태.

### 해결

악보를 담는 컨테이너에 명시적으로 어두운 `color`를 지정했다: `.abc-preview{color:#1c1c18}`. 이러면 `currentColor`를 참조하는 모든 자식 SVG 도형이 그 어두운 색을 상속받아 밝은 종이색 배경 위에 정상적으로 보인다.

### 재사용 가능한 교훈

`currentColor`로 그리는 서드파티 SVG(악보, 아이콘, 차트 등)를 어두운 테마 앱 안에서 밝은 배경 카드에 얹을 때는, 그 카드에 **배경색뿐 아니라 명시적 전경색(`color`)도 항상 같이 지정**해야 한다. "DOM에는 있는데 안 보인다"는 보고를 받으면 렌더링 실패보다 이런 색상 상속 문제부터 의심할 것 — `querySelector`로 요소 존재를 먼저 확인하고, 있다면 색/투명도/z-index 쪽을 본다.

## 공식 문서의 하드웨어 요구사항("24GB VRAM")을 실측 없이 그대로 UI 경고에 박아넣지 말 것

### 증상

YuE2 공식 문서/GitHub README는 "24GB VRAM 필요"라고 명시하지만, 실제로 이 PC(RTX 5070, 12GB)에서 `memory_budget_gib=11`로 `plan()`과 전체 `generate()`를 둘 다 성공시켰다(짧은 곡 기준, truncation 없음). 문서의 "권장 사양"을 그대로 앱의 하드 차단/경고 임계값으로 썼다가, 실제로는 되는 걸 "안 될 것"이라고 사용자에게 잘못 안내할 뻔했다.

### 원인

공식 문서의 VRAM 수치는 대체로 "안전하게 보장되는" 상한선이지, 실패 임계값이 아니다. 라이브러리가 `memory_budget_gib` 같은 조절 가능한 파라미터를 노출하는 경우, 짧거나 단순한 요청은 문서 상 권장치보다 훨씬 적은 자원으로도 동작할 수 있다.

### 해결

가능하면 실제 대상 하드웨어에서 최소 파라미터로 한 번 실행해 보고, 그 결과로 UI 경고/차단 임계값을 정한다(이 프로젝트는 `PYTHON_MODEL_MIN_VRAM_MB`를 20GB→12GB로 조정). 문서 수치는 초기 가이드로만 쓰고, 실측이 가능하면 반드시 실측으로 검증한다.

## 서드파티 CLI가 부여하는 `id`/식별자 필드가 ASCII 전용일 수 있음 — 한글 제목을 그대로 슬러그화하면 깨짐

### 증상

한글 제목의 프로젝트로 `run_yue2.py plan`/`generate`를 호출하면 `ValueError: id must be a filename-safe identifier`로 실패. 영문 제목은 멀쩡히 된다.

### 원인

`yue2`의 `SongRequest.id`는 `re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,179}", id)`로 엄격하게 ASCII만 허용한다. 우리 쪽 슬러그 생성 로직(`safeFilename()` + 소문자화 + 공백→언더스코어)은 "파일시스템에 안전한" 문자만 걸러낼 뿐 비-ASCII(한글)는 그대로 통과시키므로, 한글 제목이 그대로 `id`에 들어가 Python 쪽의 더 엄격한 정규식에 걸린다.

### 해결

외부 도구에 넘기는 `id` 같은 식별자는 제목을 슬러그화하지 말고, 애초에 ASCII로 보장되는 값(예: 이미 갖고 있는 UUID의 일부)을 쓴다. 제목에서 뽑아낸 슬러그는 어차피 없어도 되는 장식 정도로만 붙인다: `` `${asciiSlug || ''}-${project.id.slice(0, 8)}` ``처럼 UUID 조각을 항상 포함시키면 제목이 무엇이든(한글이든 특수문자든 빈 문자열이든) 항상 유효한 식별자가 보장된다.

### 재사용 가능한 교훈

사용자 입력(특히 한글 제목처럼 자유 텍스트)을 외부 CLI/라이브러리의 식별자 필드에 그대로/슬러그화해서 넘길 때는, 그 외부 도구의 검증 규칙이 우리 쪽 파일시스템-안전 검사보다 더 엄격할 수 있다는 걸 가정하고 애초에 ASCII-안전이 보장되는 값(UUID 등)을 우선시할 것.

## 서드파티 CLI의 stdout 요약이 JSON이 아니라 Python dict repr일 수 있음

### 증상

`run_yue2.py`의 stdout 마지막 줄을 `JSON.parse()`로 파싱하려 하면 실패한다(작은따옴표 키 때문에). 같은 저장소의 다른 스크립트(`examples/generate.py`)는 `print(json.dumps(...))`라 정상 파싱됐던 것과 다르다.

### 원인

`run_yue2.py`는 결과 dict를 `print(result, flush=True)`로 찍는데, 이는 Python의 기본 `str()/repr()` 포맷(작은따옴표, `True`/`False`/`None`)이지 `json.dumps()`가 아니다. 같은 도구 모음 안에서도 스크립트마다 출력 관례가 다를 수 있다.

### 해결

stdout 파싱에 의존하지 말고, 스크립트가 결과를 디스크에 진짜 JSON 파일로도 저장한다면(`outDir/result.json` 등) 그 파일을 직접 읽는다. 훨씬 안정적이고, 향후 stdout 포맷이 바뀌어도 영향받지 않는다.

## ffmpeg `scale=W:-2:force_original_aspect_ratio=decrease` + `pad`는 작은/정사각형 원본에서 깨짐

### 증상

커버 이미지(특히 1x1처럼 작거나 극단적인 비율)를 `-loop 1`로 두르고 오디오와 합성해 mp4를 만드는데, ffmpeg가 `Padded dimensions cannot be smaller than input dimensions` / `Error reinitializing filters!`로 실패. 종료 코드는 확인 방법에 따라 0으로도 보일 수 있어("Conversion failed!" 메시지만 찍고 프로세스 자체는 비정상 종료가 아닌 것처럼 보임) 성공으로 오인하기 쉽다. 결과 파일은 0바이트.

### 원인

`scale` 필터의 세로를 `-2`(자동 계산, 짝수 보장)로 두고 동시에 `force_original_aspect_ratio=decrease`를 쓰면, 원본이 매우 작거나 정사각형일 때 `-2` 자동계산과 decrease 로직이 상호작용해 패딩 대상보다 큰 중간 해상도를 만들어내는 경우가 있다. 이후 `pad=W:H:...`가 "패딩 대상이 입력보다 작다"며 실패한다.

### 해결

세로도 자동계산(`-2`) 대신 목표 해상도를 그대로 명시한다: `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=...` (ffmpeg wiki의 표준 letterbox 레시피). `-2` 자동계산은 원본 비율이 목표와 비슷할 때만 쓰고, 임의의 사용자 업로드 이미지(비율 예측 불가) 앞에서는 양쪽 다 명시하는 편이 안전하다.

### 재사용 가능한 교훈

ffmpeg 변환을 백엔드에 넣을 때는 **종료 코드 0 여부만으로 성공을 판단하지 말 것** — 필터 그래프 에러 등으로 "정상 종료했지만 출력이 0바이트"인 경우가 실제로 발생한다. 변환 직후 반드시 출력 파일의 크기(`stat().size`)를 확인해 0이면 실패로 처리해야 한다.

## on-demand 포맷 변환 캐시가 소스 파일 mtime만 보고 연관 파일(커버 등) 변경은 무시함

### 증상

곡에 커버 이미지를 새로 등록/변경한 뒤 mp4로 다운로드해도 이전 커버(또는 커버 없음)로 만들어진 캐시 파일이 그대로 내려옴.

### 원인

`GET .../audio?format=mp4`의 캐시 로직이 `cacheStat.mtimeMs < sourceStat.mtimeMs`(오디오 원본 mtime)만 비교했다. mp4 변환은 오디오뿐 아니라 커버 이미지도 입력으로 쓰는데, 커버만 바뀌고 오디오는 그대로면 이 비교식이 "최신"이라고 오판해 재변환을 건너뛴다.

### 해결

캐시 유효성 비교에 관련된 모든 입력 파일의 mtime을 반영한다: `newestSourceMtime = Math.max(오디오 mtime, 커버 mtime)`으로 계산해 `cacheStat.mtimeMs < newestSourceMtime`이면 재변환.

### 재사용 가능한 교훈

여러 입력 파일을 합성해서 만드는 산출물의 mtime 기반 캐시는, 산출물에 영향을 주는 **모든** 입력의 mtime을 비교 대상에 포함해야 한다. 입력이 하나 늘었는데 캐시 무효화 조건을 안 늘리면 딱 이런 식으로 조용히 깨진다.

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

## abcjs `SynthController.play()`를 버튼 클릭으로 재생하면 가끔 즉시 끝나버림 (재생 시작 직후 `onFinished` 오발)

### 증상

`ABCJS.synth.SynthController`로 커스텀 재생 버튼을 만들었을 때, `sc.play()`를 호출하면 `isStarted`가 잠깐 `true`가 되었다가(때로는 콘솔 로그상 성공적으로 resolve됨) 100~1500ms 안에 다시 `false`·`percent:0`으로 리셋되며 실제로는 곡 전체 길이(수 초)를 재생하지 않고 끝나버림. `chrome-devtools` MCP로 자동화된 클릭에서 반복 재현되었지만, 같은 컨트롤러에 대해 콘솔에서 직접 `controller.play()`를 호출하면 매번 정상적으로 끝까지(수 초) 재생됨 — 즉 "API 자체는 100% 정상, 버튼 클릭 경로만 가끔 실패"라는 패턴.

### 원인 (확정하지 못함 — 재현 조건이 일정하지 않음)

`abcjs`의 `TimingCallbacks.doTiming`은 `currentTime = timestamp - startTime`로 진행률을 계산하고, `currentTime >= lastMoment`가 되면 즉시 `finished()`를 호출한다. 버튼 클릭(트러스티드 입력 이벤트) 직후 `requestAnimationFrame` 스케줄링/타이밍이 순수 스크립트 호출과 미묘하게 달라지는 경우가 있어 보이나, `abcjs` 소스(`abc_timing_callbacks.js`, `synth-controller.js`)를 직접 읽고 `doTiming`을 몽키패치해 실측해도 매번 재현되지는 않았다(같은 세션에서 성공/실패가 섞여 나옴). CDP 자동화 클릭 특유의 이벤트 타이밍 아티팩트일 가능성이 있지만 실제 사용자 클릭에서도 발생하지 않는다는 보장은 없다.

### 해결 (근본 원인 대신 방어적 가드로 대응)

`onFinished` 콜백에서 "재생 시작 시각으로부터 경과한 실제 시간"과 "`controller.midiBuffer.duration`(초 단위 실제 재생 길이)"을 비교해, 곡 길이의 절반도 안 되는 시간 만에 `finished`가 호출되면 이를 오발로 간주하고 `controller.seek(0)` 후 `controller.play()`를 자동으로 다시 호출해 재생을 이어간다. 정상 재생(진짜 끝까지 다 들은 경우)은 경과 시간이 곡 길이에 가깝기 때문에 이 가드에 걸리지 않는다. `app/app/studio.tsx`의 `AbcPreview` 컴포넌트, `playStartRef` + `onFinished` 내부 가드 참고.

### 재사용 가능한 교훈

- 서드파티 오디오/타이밍 라이브러리를 커스텀 UI에 연결할 때, "API를 직접 호출하면 항상 되는데 실제 버튼 클릭 경로에서만 가끔 깨진다"는 패턴이 나오면 근본 원인을 무한정 파고들기보다(이 케이스는 라이브러리 소스까지 다 읽고 몽키패치까지 했는데도 확정 못함) **관찰 가능한 이상 상태를 감지해서 자동 복구하는 방어 코드**를 추가하는 편이 실용적일 수 있다. 단, 이건 근본 수정이 아니므로 나중에 재현 조건을 더 좁힐 수 있으면 재조사할 것.
- `chrome-devtools` MCP로 같은 uid를 여러 번 재사용해 연속 클릭하면(특히 그 사이에 리렌더로 아이콘이 바뀌는 토글 버튼), 클릭이 실제로 핸들러를 발화시키지 못하고 조용히 무시되는 경우가 있었다(에러 없이 실패). 연속 클릭 테스트를 할 때는 매번 `take_snapshot`으로 새 uid를 다시 얻는 편이 안전하다.

## "악기만" 옵션은 가사를 비우는 방식으로 구현하면 안 됨 — 모델이 빈 가사를 거부함

### 증상

"악기만" 토글을 켜고 생성했는데 보컬이 그대로 나옴. 이를 고치려고 가사를 빈 문자열로 보내도록 바꿨더니, 이번엔 audio.cpp 엔진 호출 자체가 종료 코드 1로 즉시 실패("초안은 저장했습니다. 음악 생성에 실패했습니다").

### 원인

`engine/audio.cpp/src/models/yue2/request.cpp`의 `normalize_request()`가 `if (out.lyrics.empty()) throw std::runtime_error("Yue2 requires non-empty lyrics");`로 빈 가사를 하드 차단한다. YuE2에는 애초에 "악기만" 전용 플래그가 없고, audio.cpp/공식 Python 엔진 둘 다 가사 기반으로만 동작하도록 설계되어 있다. "가사를 disable하면 되지 않을까"라는 직관적인 접근이 그대로 모델 계약을 깨뜨린다.

### 해결

가사를 없애는 대신, 원본 Python 엔진(`yue2-original`)에서만 지원되는 **구조적 보컬 성부 삭제**를 사용한다: `test/YuE2-source/skills/yue2-music/scripts/abc_tools.py strip-chords <in> <out> --keep-voice Ins`로 ABC 악보의 Vocal 성부를 쉼표(rest)로 치환하고, 그 결과 ABC를 `--abc-file`로 넘겨 생성한다(`cot`는 `melody` 이상이어야 함). 기존 ABC 악보가 없으면 먼저 `plan` 액션으로 자동 작곡한 뒤 같은 처리를 한다(`backend/server.mjs`의 `stripVocalVoice()`/`runPythonYue2()`). GGUF 계열 모델(Q4/Q8/BF16)은 ABC/cot 지원이 아예 없어 이 방법을 못 쓰므로, 그쪽은 여전히 `', instrumental, no vocals'` 같은 소프트 스타일 힌트만 가능하고 보컬 완전 제거를 보장 못 한다는 점을 UI에 명시해야 한다.

### 재사용 가능한 교훈

- 생성형 음악/음성 모델에서 "이 조건을 비우면 저 결과가 안 나오지 않을까"라는 추측으로 필수 입력을 비우는 접근은, 그 모델의 실제 요구사항(소스 코드의 검증 로직)을 먼저 확인하지 않으면 완전히 다른 방식으로 깨질 수 있다. 반드시 엔진 소스(`request.cpp`, `pipeline.py` 등)에서 하드 검증 로직을 직접 읽고 판단할 것.
- 모델이 요구하는 필수 조건(가사)과 사용자가 원하는 결과(보컬 없음)가 충돌할 때는, "조건을 없애기"보다 "조건은 만족시키되 결과를 구조적으로 무력화하기"(성부를 쉼표로 치환) 쪽이 더 안전한 해법인 경우가 많다.
- 이 기능을 테스트할 때, 공유 fake spawn mock(`makeFakePythonSpawn`)의 "스크립트 경로가 아니면 ffmpeg로 간주" 폴백 분기가 새로 추가한 `abc_tools.py` 호출까지 잘못 가로챌 수 있다 — 새 서브프로세스 호출을 mock에 추가할 때는 반드시 `path.basename(args[0]) === '<스크립트명>'`으로 먼저 분기하고, 그 뒤에 범용 ffmpeg 폴백을 두어야 한다.
