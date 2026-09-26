# Trouble Shooting

> **2026-09-24: AuK(AudioAuK) 연동은 SongYUE2에서 제거되었다.** 이 문서의 AuK 관련 항목은 과거 이력이며 현재 코드에는 해당 기능이 없다(음성 인식은 audio.cpp Qwen3-ASR 등, Audio Tools는 audio.cpp/ffmpeg 기반).


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

## Seed-VC로 노래(SVC) 변환 시 "꽥꽥거리는" 소리가 남 — `f0_condition` 옵션이 기본값 `false`라 피치 추적이 아예 꺼져 있었음

### 증상

"보컬 음색 변환"으로 완성곡의 보컬을 다른 목소리로 바꾸면, 보컬이 거의 안 들리고 꽥꽥/왝왝거리는 로봇 같은 잡음만 남는다고 사용자가 보고. 모델(GGUF 정밀도 등)을 바꿔봐도 증상이 동일해 모델 자체 문제가 아님을 사용자가 먼저 확인함.

### 원인

`runSeedVcSvc()`가 `--task-route v1_svc`(노래/SVC용 경로)를 쓰면서도 `f0_condition` 요청 옵션을 아예 안 넘겼다. `engine/audio.cpp/model_specs/seed_vc.json`과 `docs/models/seed_vc.md`를 보면 `f0_condition`은 **기본값이 `false`**이고, "V1 F0 conditioning for singing voice conversion"이라고 명시되어 있다 — 즉 노래 변환인데도 피치(F0) 컨디셔닝이 꺼진 채로 돌아간 것. 소스 보컬의 실제 음높이 궤적을 전혀 참고하지 않고 변환하니, 결과물이 올바른 피치 컨투어를 잃고 브로드밴드 잡음에 가까운 소리(스펙트로그램상 깨끗한 하모닉 밴딩 없이 뭉개진 broadband 에너지, 원곡과 어긋나는 구간 타이밍)로 나왔다.

직접 `ffmpeg -lavfi showspectrumpic`으로 원곡 보컬 / 수정 전 변환곡 / 수정 후 변환곡 스펙트로그램을 나란히 비교해서 확정: 수정 전은 선명한 하모닉 라인이 거의 없고 구간 타이밍도 원곡과 크게 어긋났지만(예: 원곡 15.9s/23.8s/31.8s 지점 vs 변환 10.3s/30.9s/51.5s), `f0_condition=true`를 추가한 뒤에는 하모닉 밴딩이 뚜렷해지고 구간 타이밍도 원곡과 거의 일치했다.

### 해결

`runSeedVcSvc()`의 args에 `'--request-option', 'f0_condition=true'`를 추가. (`backend/server.mjs`의 `runSeedVcSvc()`)

```js
const args = ['--task', 'svc', '--family', 'seed_vc', '--model', path.join(root, SEED_VC_MODEL_PATH),
  '--backend', 'cuda', '--task-route', 'v1_svc',
  '--request-option', 'f0_condition=true',   // 이게 없으면 노래 변환인데 피치 추적이 꺼진 채로 돈다
  '--audio', vocalsWav, '--voice-ref', voiceRefWav, '--out', outputWav];
```

### 재사용 가능한 교훈

- 서드파티 음성/음악 변환 엔진을 특정 "라우트/모드"(여기선 `v1_svc`, 노래 전용)로 호출할 때는, 그 라우트 전용 문서(`docs/models/*.md`)에서 "이 라우트에서만 의미있는 옵션과 그 기본값"을 반드시 확인할 것. `model_specs/*.json`의 `options.request[].default`만 봐서는 "이 옵션이 이 라우트에 실질적으로 얼마나 중요한지"를 놓치기 쉽다 — `docs/models/seed_vc.md`처럼 라우트별 문서에 "F0 extraction: Optional through `f0_condition`"이라고 명시된 걸 봐야 "노래 변환인데 피치 추적이 옵션이고 기본 꺼짐"이라는 게 이상하다는 걸 알아챌 수 있다.
- "품질이 이상하다"는 모호한 사용자 신고는 스펙트로그램(`ffmpeg -lavfi showspectrumpic=s=1024x512:legend=1`)으로 원본/결과물을 시각적으로 비교하면 근거가 빠르게 확보된다 — 특히 "하모닉 밴딩이 선명한가(피치가 있는 소리)" vs "뭉개진 broadband 에너지인가(피치 추적 실패/잡음)"는 육안으로도 뚜렷이 구분된다. 구간 타이밍(가로축)이 원본과 어긋나는지도 파이프라인 단계 하나가 통째로 잘못 작동 중임을 시사하는 좋은 단서.
- 사용자가 "모델을 바꿔봐도 증상이 같다"고 스스로 확인해준 정보는 원인 후보를 크게 좁혀준다(모델 가중치/정밀도 문제가 아니라 호출 파라미터/파이프라인 문제 쪽으로) — 이런 사용자 제공 단서를 코드 조사보다 먼저 반영해 탐색 범위를 좁힐 것.

## `finalizeToMusic()`을 호출하는 경로 중 일부(ComfyUI/AudioSR 복원/보컬 음색 변환 저장)는 `durationMs`를 아예 안 넘겨서 카드 보기에 곡 길이가 빠짐

### 증상

카드 보기에서 일부 곡(특히 최근에 INT8 ConvRot으로 만든 곡)만 곡 길이(예: "2:11")가 안 보이고, 다른 곡(GGUF 계열)은 정상적으로 보임.

### 원인

`finalizeToMusic(project, file, audioFile, extraFields)`은 `extraFields`를 그대로 저장할 프로젝트 레코드에 스프레드한다. 생성 경로별로 `extraFields`를 채우는 방식이 갈렸다:
- audio.cpp(GGUF) 경로(`runAudioCpp`)는 엔진 로그의 `metrics.audio_duration_ms=` 라인을 파싱해 `durationMs`를 넘김.
- Python(`yue2-original`) 경로는 `result.audio_seconds`를 넘김.
- **ComfyUI 경로(`runComfyUi`), AudioSR "음원 복원", 보컬 음색 변환 "저장" 이 세 곳은 `finalizeToMusic(..., {})`처럼 빈 객체를 넘겨서 `durationMs`가 아예 없었다.** 프론트(`app/app/studio.tsx`의 `projectList()`)는 `item.durationMs`가 falsy면 그냥 뱃지를 안 그리므로 조용히 사라져 보인다.

### 해결

`ffprobe -show_entries format=duration -of csv=p=0 <file>`로 렌더링 직후 파일의 실제 길이를 재는 `measureDurationMs()`를 추가(`measureMeanVolumeDb()`와 같은 패턴)하고, 저 세 호출부 모두에서 `finalizeToMusic(..., { durationMs: await measureDurationMs(outputFile) })`로 바꿨다. 이미 저장된 기존 곡은 코드를 고쳐도 소급 적용이 안 되므로, `library/Music/*.json` 중 `status:'completed' && !durationMs`인 파일을 찾아 해당 오디오를 직접 ffprobe로 재서 JSON을 패치(백엔드의 `saveJson()`과 동일한 원자적 쓰기 패턴으로)하는 1회성 백필도 같이 했다.

### 재사용 가능한 교훈

- 같은 "완성곡을 라이브러리에 저장"하는 목적의 함수(`finalizeToMusic`)를 여러 경로에서 호출할 때, 각 경로가 채워 넣는 `extraFields`(부가 메타데이터)가 서로 다를 수 있다는 걸 놓치기 쉽다. 새 생성/후처리 경로를 추가할 때는 기존 경로들이 어떤 필드를 채우는지 먼저 확인하고 빠진 게 있으면 의도적으로 뺀 것인지 확인할 것 — `{}`처럼 빈 extraFields를 넘기는 곳이 있으면 특히 의심.
- 이런 "메타데이터 누락" 버그는 코드를 고쳐도 **이미 생성된 데이터**는 그대로 깨진 채 남는다. 사용자가 "이 곡만 안 보인다"고 특정 항목을 지적하면, 코드 수정과 별개로 기존 라이브러리 데이터도 스캔해서 같은 문제가 있는 레코드를 백필해야 한다(코드 배포만으로는 과거 데이터가 저절로 고쳐지지 않음).

## Seed-VC/Vevo2로 보컬 음색을 변환하면 원곡이 완전한 디지털 무음(true silence)인 구간에서도 "찢어지는 소리"가 들어감 — 두 모델 모두 무음 패스스루가 없음

### 증상

사용자 제보("찢어지는 소리가 난다")를 스펙트로그램으로 봐도 뚜렷한 원인이 안 보임 — 여러 밤에 걸쳐 원인 후보(피치 추적, 게인/리미터, 청크 경계 아티팩트 등)를 하나씩 제거하며 조사. 최종적으로 `ffmpeg -af volumedetect`/파형을 원곡 보컬 스템과 직접 비교해서 확인: **원곡 보컬이 -inf dB(완전한 디지털 무음)인 구간에서, Seed-VC/Vevo2로 변환한 결과물은 조용하지만 완전한 무음은 아닌 소리(잡음/아티팩트)를 계속 만들어내고 있었다.** 그 "envelope이 있는 저레벨 잡음"이 재생 시 "찢어지는 소리"로 들린 것.

### 원인

Seed-VC와 Vevo2 둘 다 오디오→오디오 변환 모델인데, **입력이 진짜 무음이어도 그걸 감지해서 무음을 그대로 출력하는 패스스루 메커니즘이 없다** — 모델이 항상 "뭔가"를 생성한다(노래하는 사람이라면 숨소리/공백이 있어야 할 구간에도). 실제 노래에서 보컬이 완전히 쉬는 구간(간주, 곡 시작 전 무음 등)은 이 문제가 특히 두드러짐.

### 해결

`applyVocalTimbre()`의 마지막 단계로, 변환 전 원곡 보컬(`originalVocalsWav`)을 사이드체인 키로 삼아 변환 결과(`leveledVocals`, 게인+리미터까지 끝난 상태)에 `sidechaingate` 필터를 적용 — 원곡이 무음인 구간은 변환 결과도 강제로 무음이 되게 한다(실제 노래가 하는 일과 동일: 안 부르면 조용함):

```js
spawnImpl('ffmpeg', ['-y', '-i', leveledVocals, '-i', originalVocalsWav, '-filter_complex',
  'sidechaingate=threshold=0.003:ratio=20:attack=5:release=100:range=0.02',
  '-ar', '44100', gatedVocals], { windowsHide: true });
```

`-ar 44100`을 같이 넣은 이유는 Vevo2 고유 이슈도 겸사겸사 해결하기 위함 — Vevo2는 24kHz 네이티브 출력이라 파이프라인의 나머지(44.1kHz)와 샘플레이트가 안 맞았는데, 이 게이트 단계가 항상 마지막에 실행되므로 여기서 같이 리샘플링했다.

### 재사용 가능한 교훈

- 오디오→오디오 변환 모델(SVC/VC류)은 "입력이 무음이면 출력도 무음"이라는 당연해 보이는 성질을 보장하지 않을 수 있다 — 특히 제로샷 변환 모델일수록 이런 엣지 케이스가 학습 데이터에 잘 없어서 무음 구간에 대한 명시적 무음 패스스루가 빠져 있을 가능성이 높다. "이상한 잡음" 계열 버그를 조사할 때는 스펙트로그램뿐 아니라 원본과 결과의 무음 구간(특히 -inf dB 구간)을 짚어서 비교해 볼 것.
- `sidechaingate`(원본을 키 신호로 써서 변환 결과를 게이팅)는 "원본의 무음/유음 패턴을 결과물에 강제로 되입히는" 범용 해법이다 — 오디오 변환 파이프라인에서 결과물이 원본과 무음 타이밍이 어긋나는 문제 전반에 재사용 가능.
- 여러 밤에 걸친 조사에서 후보를 하나씩 제거하는 방식이 유효했다 — 매번 "실제로 무엇이 다른지"를 측정 가능한 지표(스펙트로그램, `volumedetect`, 파형 비교)로 좁혀나갔다는 점이 중요. "막연히 이상하다"는 신고일수록 후보를 하나씩 배제하며 좁히는 접근이 필요.
# Audio comparison waveform clipping (2026-09-18)

The comparison chart used 300 flex spans with min-width:1px and gap:1px. Narrow containers clipped the time axis, making halfway playback appear near the end. Comparison charts now use an SVG with a fixed viewBox and preserveAspectRatio="none". Each track derives its fraction from shared seconds divided by its own duration. See docs/audio-compare-validation.md for validation and remaining browser upload limitation.

## "음원 비교"에서 파형이 "30%가 후처리 아이콘/창 밖으로 잘려나간다"는 신고 — 실제로는 위 "Audio comparison waveform clipping" 항목의 그 CSS 오버플로 버그였다 (내가 "무음이라 정상"이라고 잘못 결론 내렸던 사례)

### 증상 및 내가 저지른 실수

사용자가 실제 DDSP-SVC 테스트 mp3(`original-vocal.mp3`, `ddsp-svc-test.mp3`, 둘 다 약 101.6초)를 "음원 비교"에 불러왔을 때 파형이 전체 폭의 약 70%만 그려지고 나머지 ~30%는 후처리 버튼 뒤/창 경계 밖으로 밀려나 잘려 보인다고 신고함. 조사 중 `AudioContext.decodeAudioData()`를 몽키패치해 채널 데이터를 스캔해서 "이 파일은 실제로 처음 ~18초와 마지막 ~9초가 진짜 무음(반주만 나오는 인트로/아웃트로)"이라는 사실을 확인했는데, **이 사실 하나만으로 "버그가 아니라 정상"이라고 성급하게 결론짓고 사용자에게 그렇게 보고함**. 사용자가 "Codex가 이미 나머지 30%를 보이게 고쳤다"고 지적하기 전까지 이 결론을 믿고 있었음 — 실제로는 위 "Audio comparison waveform clipping" 항목에 이미 적혀 있던, 300개 flex 막대의 `min-width:1px`+`gap:1px` 누적폭이 컨테이너 실제 너비를 넘어서면서 `overflow:hidden`에 의해 뒷부분이 통째로 잘리던 **진짜 렌더링(CSS 레이아웃) 버그**가 원인이었고, 이건 이미 다른 세션(Codex)이 SVG 파형(`CompareWaveform`)으로 교체해 고쳐놓은 상태였다.

### 재사용 가능한 교훈 (정정)

- **"오디오 데이터 자체에 무음이 있다"는 사실을 확인했다고 해서 "그러니까 화면에 보이는 잘림도 정상"이라고 바로 연결 짓지 말 것.** 둘은 서로 다른 질문이다 — `decodeAudioData`/`getChannelData()` 계측은 "신호가 진짜로 있는가"만 알려줄 뿐, 그 신호가 화면에 **잘리지 않고 전부 그려지는지**는 전혀 알려주지 않는다. 후자를 확인하려면 실제 렌더된 DOM의 기하 정보(`getBoundingClientRect()`, `overflow` 계산, 자식 요소 총 폭 vs 부모 폭)를 직접 재야 한다.
- 사용자가 "일부가 창/버튼 밖으로 잘려나간다"처럼 **구체적으로 잘리는 위치(어디 뒤에 숨는지)를 언급하면, 그건 거의 항상 CSS 레이아웃/오버플로 문제**라는 강한 신호다 — 콘텐츠 자체의 무음 여부로 설명되는 증상이 아니다.
- 다른 세션/에이전트가 같은 파일을 동시에 고치고 있었다면, **내가 새로 "원인"을 찾기 전에 먼저 그 세션이 이미 뭘 고쳤는지(문서화된 변경 로그, validation 문서 등)부터 읽을 것** — 이번에도 정답은 이미 같은 파일의 몇 줄 위(영어로 적힌 "Audio comparison waveform clipping" 항목)에 있었는데, 그걸 지나치고 새로 그럴듯한 설명을 만들어냈다.
- 보컬 스템에 인트로/아웃트로 무음이 있다는 사실 자체는 여전히 참이고 재사용 가능한 정보이지만(이 프로젝트의 `applyVocalTimbre()` 무음 게이트 이슈와 같은 맥락 — 보컬 파이프라인은 무음 구간이 정상이라는 전제로 접근할 것), **이번 특정 버그 신고의 원인은 아니었다.**

## ACE-Step-1.5(`test/ACE-Step-1.5`) 독립 Python API 서버: RTX 5070 12GB에서 VAE 디코딩이 CPU로 밀려 1시간 넘게 안 끝남 — 진짜 원인은 DiT 모델이 diffusion 후에도 GPU에서 안 내려온 것

### 증상

LoKr(LoRA) 학습이 끝난 어댑터로 실제 생성을 검증하려고 `/release_task`를 호출하면, diffusion 단계(약 5분)는 정상적으로 끝나지만 그 다음 "Decoding audio..." 단계(progress 0.8)에서 멈춘 것처럼 보인다. `batch_size`를 2→1로, `audio_duration`을 30초→15초로 줄여도 동일하게 재현됨 — 두 번의 독립 시도 모두 1시간 안팎을 이 단계에서 벗어나지 못했다.

### 원인

1. **diffusion 직후 "effective free VRAM"이 0.16~0.17GB까지 떨어짐**(`allocated=11.75GB, max=13.74GB`) — 서버 로그에 `[generate_music] Only 0.16 GB free VRAM; auto-enabling CPU VAE decode`가 찍히며 VAE를 CPU로 옮겨 `tiled_decode`로 디코딩하게 되는데, 그 CPU 경로 자체가 이 환경에서 극도로 느려(15초 클립이 1시간 넘게 안 끝남) 사실상 못 쓰는 경로였다.
2. **`ACESTEP_OFFLOAD_TO_CPU=1`(모델을 한 번에 하나씩만 GPU에 올리는 모드)을 켜도 위 증상이 그대로 재현됐다** — 이게 진짜 원인 추적의 실마리였다. 이유는 `acestep/core/generation/handler/init_service_offload_context.py`의 `_load_model_context()`에 DiT("model")만을 위한 예외 분기가 있기 때문: `if model_name == "model" and not self.offload_dit_to_cpu:` 이 참이면 DiT를 GPU에 "영구적으로"(persistent) 올려놓고 컨텍스트가 끝나도 **CPU로 다시 내리지 않는다**. 즉 `offload_to_cpu`(일반 모델들 관리)와 `offload_dit_to_cpu`(DiT 전용)는 서로 다른 플래그이고, **API 서버 진입점(`acestep/api/startup_model_init.py:61`)은 `offload_dit_to_cpu`를 항상 기본값 `False`로 시작**한다(반면 `gpu_config.py`의 GPU 등급표에는 12~16GB 카드를 위한 `offload_dit_to_cpu_default` 값이 있지만, 이 값은 API 서버 경로에서는 아예 안 쓰이고 독립 CLI/Gradio 경로에서만 쓰인다). 그래서 2.4B 파라미터 DiT 모델이 diffusion 이후에도 GPU에 계속 눌러앉아 있었고, VAE 디코딩 시점엔 진짜로 GPU에 여유 공간이 거의 없었다(할당자 캐시 문제가 아니라 실제로 큰 모델이 그대로 상주해 있던 것).
3. **`/query_result` 폴링도 이 상황에서 신뢰할 수 없었다(별개의 버그)** — `acestep/api/http/query_result_service.py`의 `collect_query_results()`는 `local_cache`에 캐시된 항목이 있으면 **항상 그것을 우선 사용하고 실제 job store는 조회조차 하지 않는다**(`if data: ...; continue`). 디코딩 단계에서 캐시 갱신이 멈추면 `task_timeout_seconds`가 지난 뒤 `_build_running_result_payload()`가 무조건 `status: 2`(타임아웃)를 반환한다 — **실제 작업은 여전히 CPU에서 살아서 돌고 있는데도** 클라이언트에게는 "끝났다"고 거짓 보고를 한다. 실제로 살아있는지 확인하려면 `/query_result` 대신 프로세스를 직접 봐야 했다(`Get-CimInstance Win32_Process -Filter "Name='python.exe'"`로 커맨드라인 확인 → `Get-Process -Id <pid> | Select CPU`를 몇 초 간격으로 두 번 찍어 CPU 시간이 실제로 늘어나는지 확인).

### 해결

서버 시작 시 `ACESTEP_OFFLOAD_DIT_TO_CPU=1`(과 `ACESTEP_OFFLOAD_TO_CPU=1`)을 같이 켜면 된다 — 소스 패치 불필요, 이미 있는 환경변수:

```bash
ACESTEP_LM_DEVICE=cuda:0 ACESTEP_DEVICE=cuda:0 \
ACESTEP_OFFLOAD_TO_CPU=1 ACESTEP_OFFLOAD_DIT_TO_CPU=1 \
.venv/Scripts/python.exe -m acestep.api_server
```

이걸로 재시도하자 로그가 `Effective free VRAM before VAE decode: 7.91 GB`로 바뀌었고(0.17GB → 7.91GB), VAE 디코딩이 GPU에서 0.4초 만에 끝났다(이전엔 1시간 넘게도 안 끝났음). 15초 클립 전체 생성 시간은 58.98초.

교훈: "VRAM이 없어서 느리다"는 증상을 봤을 때, 그 시점에 GPU에 정말 뭐가 남아있는지(할당자 캐시 문제인지, 아니면 진짜 큰 모델이 안 내려온 것인지)를 먼저 구분할 것 — `offload_to_cpu` 같은 총괄 플래그가 켜져 있어도, 그 안에 개별 모델(특히 제일 큰 것)만 예외 처리하는 별도 플래그가 숨어있을 수 있다.

## DDSP-SVC(`backend/ddsp-svc.mjs`) 실제 학습: kill-at-target-step은 정상인데 작은 목표 스텝에서 "학습된 체크포인트를 찾지 못했습니다"로 실패 — 체크포인트 저장 주기(`interval_val`)가 목표 스텝보다 큰 게 원인

### 증상

목표 스텝을 작게(예: 300) 잡아 "음색 변조" 팝업의 DDSP-SVC 탭에서 실제 GPU 학습을 돌려보면, 학습 프로세스는 목표 근처(347)에서 정확히 죽는다 — kill-at-target-step 메커니즘 자체는 의도대로 동작. 하지만 그 직후 `latestCheckpoint(expDir)`가 아무 것도 못 찾아 `학습된 체크포인트를 찾지 못했습니다` 에러로 job이 `failed`가 된다. 백엔드 mock 테스트(`stepsPerCheckpoint: 50`이라는 인위적 파라미터로 체크포인트를 흉내냄)는 이 실패를 전혀 잡아내지 못하고 있었다.

### 원인

DDSP-SVC의 `reflow/solver.py`는 체크포인트를 매 스텝마다 저장하지 않는다 — `if saver.global_step % args.train.interval_val == 0:` 일 때만 `saver.save_model()`을 호출한다(로그 출력은 `interval_log: 1`이라 매 스텝 찍히지만, 저장은 별개). `configs/reflow.yaml` 템플릿의 기본값은 `interval_val: 2000`인데, `startDdspJob()`이 이 템플릿을 job 전용 경로(`train_path`/`valid_path`/`expdir`)만 패치하고 `interval_val`은 그대로 두고 있었다. 그 결과 `targetStep`이 2000보다 작은 모든 테스트/짧은 학습에서는 kill이 일어날 때까지 `step % 2000 == 0`인 순간이 단 한 번도 오지 않아, 체크포인트 파일(`model_<step>.pt`)이 **한 개도 생성되지 않은 채** 프로세스가 죽는다. `interval_force_save`(기본 10000)는 이미 저장된 체크포인트 중 어느 걸 지우지 않고 남겨둘지 결정하는 값일 뿐, 저장 자체의 트리거는 오직 `interval_val`이다.

### 해결

`backend/ddsp-svc.mjs`의 `startDdspJob()`에서 config를 패치할 때 `interval_val`도 `targetStep`에 비례해 같이 줄인다:

```js
const intervalVal = Math.max(10, Math.min(2000, Math.floor(job.targetStep / 4)));
const patched = template
  .replace(/(\n\s*train_path:\s*)\S+/, `$1${jobRelDir}/train`)
  .replace(/(\n\s*valid_path:\s*)\S+/, `$1${jobRelDir}/val`)
  .replace(/(\n\s*expdir:\s*)\S+/, `$1${expRelDir}`)
  .replace(/(\n\s*interval_val:\s*)\S+/, `$1${intervalVal}`);
```

`targetStep`이 큰(기본값 40000 등) 정상 규모 학습에서는 `min(2000, ...)`에 걸려 원래 기본값 2000 그대로 유지되므로 기존 동작에 영향 없음. 같은 프로젝트로 `targetStep: 300` 재학습을 실행해 체크포인트 저장(step 75/150/225/300에서 저장) → 추론 → 후처리 → `stems/vocals.wav` 반영까지 전부 성공하는 것을 확인했다(변환된 보컬 `volumedetect`: mean -23dB/max -4.6dB로 무음 아님도 확인).

테스트 mock(`makeFakeDdspSpawn`)도 하드코딩된 `stepsPerCheckpoint` 대신 실제로 패치된 config의 `interval_val`을 읽어 그 배수에서만 체크포인트 파일을 쓰도록 재작성했고, 작은 `targetStep`으로 끝까지 완주하는 회귀 케이스를 추가했다. 이 과정에서 mock 자체의 별도 버그도 발견: `killCount`가 mock 인스턴스 전체(여러 job에 걸쳐 재사용되는 하나의 `makeFakeDdspSpawn()` 호출)에 공유되는 카운터라, 첫 번째 job의 학습이 kill된 뒤 두 번째 job이 새로 `train_reflow.py`를 spawn하면 루프 첫 반복에서 이미 `killCount > 0`을 보고 즉시 리턴해버려(`emitter.stdout`을 한 번도 emit하지 않고) `close` 이벤트도 영영 안 나가 두 번째 job이 `training` 상태로 무한 대기하는 버그였다 — kill 여부는 `killCount`(전체 누적)가 아니라 `emitter._killed`(그 child 자신의 상태)로 체크하도록 고쳤다.

### 재사용 가능한 교훈

- **"목표 도달 시 프로세스를 죽인다"와 "그 시점에 죽여도 되는 결과물이 이미 존재한다"는 서로 다른 보장이다.** kill 메커니즘 자체가 정확해도, kill되는 시점에 필요한 산출물(체크포인트, 스냅샷, 캐시 파일 등)이 아직 만들어지지 않았을 수 있다 — 그 산출물의 생성 주기가 kill 목표보다 더 길면 항상 실패한다. 목표 값을 사용자가 자유롭게 줄일 수 있는 시스템이라면, 그 목표에 딸려오는 다른 주기성 파라미터(저장 주기, 체크포인트 간격, flush 주기 등)도 같이 스케일해야 한다.
- **주기적으로만 발생하는 이벤트(체크포인트 저장, 로그 플러시 등)를 mock으로 흉내낼 때는, mock에 별도의 인위적 상수를 하드코딩하지 말고 실제로 그 주기를 결정하는 설정값(여기서는 패치된 config 파일의 `interval_val`)을 읽어서 반영할 것.** 인위적으로 "자주 일어난다"고 가정한 mock은 실제로는 "드물게만 일어나는" 이벤트에 의존하는 버그(이번처럼 작은 목표값에서만 터지는 경계 조건)를 항상 가려버린다.
- **실측(실제 GPU/실제 프로세스) 검증이 mock 기반 테스트로는 절대 못 잡는 버그의 실제 사례** — 이 프로젝트에서 실기 검증을 후순위로 미루지 않고 매번 실제로 돌려보라는 지침이 반복되는 이유가 바로 이것. mock을 아무리 정교하게 짜도 "실제 하위 프로세스가 실제로 어떤 주기로 어떤 부작용을 내는가"는 소스 코드를 직접 읽어 확인하기 전까진 틀리기 쉽다.
- **테스트 mock을 여러 시나리오(job)에 걸쳐 재사용할 때는 상태 공유 범위를 주의할 것** — "이 mock 인스턴스 전체의 누적 카운터"와 "이번 개별 호출(child)의 상태"를 혼동하면, 앞선 시나리오의 부작용이 뒤 시나리오로 새어 들어가 재현하기 까다로운 행업(hang)을 유발한다.

## 음색 변조(Seed-VC/Vevo)에서 원본/참조 파형이 안 보이고 아이콘·파형이 2줄로 쌓임 — 공용 `audio-compare-dialog` 클래스의 column 레이아웃 재사용이 원인

### 증상

"음색 변조 (실험적)" 팝업에서 Seed-VC/Vevo를 고르고 원본·참조 오디오를 선택하면, 오른쪽 결과 영역에 파형이 보이지 않는다. 아이콘(재생 버튼), 라벨, 파형이 세로로 쌓여 2줄처럼 보인다. AuK/DDSP-SVC 탭은 정상(차트가 잘 보임).

### 원인

`TimbreTransformDialog`의 `DialogContent`가 `className="studio-dialog audio-compare-dialog timbre-transform-dialog"`로 되어 있어, `audio-compare.css`의 `.audio-compare-dialog .stem-row{display:flex;flex-direction:column;align-items:stretch;gap:10px;padding:14px 0}`가 **레거시 Seed-VC/Vevo 행까지 적용**된다. 이 규칙은 비교 차트(`CompareWaveform`/`CompareSpectrogram`, 세로 툴바+차트)용으로만 맞는 레이아웃인데, 레거시 행(재생 아이콘+라벨+`Waveform` 바차트)에도 걸린 것. 여기에 더해 column flex 안에서 `.pp-waveform`의 `flex:1`(=flex-basis:0)은 **세로축(높이)을 flex basis로 삼아**, 컨테이너가 자동 높이면 여유 공간이 0 → 높이 0으로 붕괴 → `height:44px`도 basis에 밀려 파형 막대가 안 그려진다(`min-height:44px`로도 확실히 해결되지 않던 이유 — basis가 main size를 결정하는 단계에서 min은 clamp로 적용되긴 하나, 중첩 flex 안에서는 시각적 붕괴가 반복).

### 해결

공용 클래스가 그린 세로 레이아웃을 **그 안의 해당 뷰에만** 전용 클래스로 되돌린다:

```tsx
// 레거시 목록만 전용 클래스를 얹는다 (AuK/DDSP 차트 뷰는 그대로 두기 위함)
{isLegacy ? <div className="stem-list timbre-legacy-list">...}
```

```css
.timbre-transform-dialog .stem-list.timbre-legacy-list .stem-row {
  display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 7px 0;
}
```

가로(row) 레이아웃에서는 `flex:1`이 가로축(폭)을 차지하고 `height:44px`가 그대로 살아서 파형 막대가 렌더링된다(명시도 0,4,0 > 0,2,0으로 공용 규칙을 이김).

### 재사용 가능한 교훈

- **다이얼로그/컴포넌트에 공용 레이아웃 클래스를 얹는 순간, 그 클래스의 전용 CSS 규칙(여기서는 column `stem-row`)도 함께 물려온다.** "이 클래스를 왜 쓰는지"의 의도와 실제 CSS가 어긋나면 다른 뷰까지 방해한다. 재사용하되 원래 용도와 다른 하위 뷰는 반드시 전용 클래스로 분리할 것.
- **`flex:1`(= flex-grow:1;flex-shrink:1;flex-basis:0)은 메인 축(내용 방향)의 크기를 flex-basis로 결정한다.** row면 폭, column이면 높이가 0에서 시작해 여유분으로만 자란다. 자동 높이 컨테이너(column) 안의 flex item이 "높이 0으로 사라지는" 문제는 대부분 이 flex-basis:0 때문이다.
- 파형/차트가 "사라졌다"는 제보는 코드의 로직보다 **오버라이드된 레이아웃 CSS**를 먼저 의심할 것 — 이번 피해자인 `.pp-waveform` 자체는 정상이었다.

## `withEstimatedProgress`류 진행률: 실패 시 100%로 표시되는 버그 + 전역 상태 오독(진행률이 다른 작업의 것을 보여줌)

### 증상

음색 변조(Seed-VC/Vevo/AuK) 적용 중 `app/app/studio.tsx`의 `withEstimatedProgress()`가 사용한다. (a) 변환이 실패해도 `finally`에서 `setApplyProgress(100)`이 실행되어 **실패가 100%로 출력**된다. (b) 500ms 폴링이 `POST /generate/status`의 **전역** 상태를 읽기 때문에, 노래 만들기 생성과 동시에 데모를 돌리면 엉뚱한 작업의 %를 보여준다.

### 원인

`finally(() => { clearInterval(poll); setApplyProgress(100); })`에 성공 여부가 반영되지 않았고, 진행률 source가 이 job이 아니라 서버의 단일 전역 생성 상태였기 때문.

### 해결 방향 (미수정 시점 기준)

성공 플래그를 도입해 성공에서만 100으로 만들고, 폴링 대상을 이 job 전용 진행률 API(또는 job id 정합성 검사)로 바꾼다. DDSP-SVC처럼 스텝 단위 진행이 있는 엔진만 실시간 %가 정확하다는 점도 원인 주석에 남음.

### 재사용 가능한 교훈

- **진행률 표시의 "마무리 100%"은 성공 신호, "에러"는 별개 신호다 — 하나의 `finally`에서 두 신호를 합치면 실패를 성공으로 위장한다.**
- **전역 상태(단일 생성 슬롯)를 특정 작업의 진행률로 재사용하면 동시 작업 시 오정보를 낸다.** 전용 폴링 엔드포인트가 없으면 최소한 job id를 폴링 응답과 대조할 것.

## 효과 로드 `useEffect`에서 Promise를 버려서는 안 됨 (no-floating-promises)

### 증상

`app/app/studio.tsx`의 DDSP completed-job 결과 로드 effect(2333~)와 `AudioRestoreDialog`(2730)가 `(async () => {...})()` 형태로 Promise를 throw하지 않고 호출해, oxlint `no-floating-promises`가 잡는다. 리액트의 `useEffect` 콜백은 Promise를 반환하면 안 되므로 `void (async () => { try {...} catch {...} })()`로 래핑하면 된다.

### 교훈

비동기 작업을 `void` 없이 버리면 실패한 fetch/decode가 silent fail한다. lint/no-floating-promises를 반드시 지킬 것.

## Closed AudioContext after HMR or dialog cleanup

- **Symptom:** Playback rejects with `Cannot resume a closed AudioContext`, or cleanup rejects with `Cannot close a closed AudioContext`.
- **Cause:** Hot module replacement or repeated dialog cleanup closes the context while a retained ref still points to it; asynchronous `resume()`/`close()` rejection was also left unhandled.
- **Fix:** Treat a `closed` context as absent and create a fresh context before playback. Clear context and gain refs before closing, only resume a `suspended` context, only close a non-closed context, and attach `.catch(() => {})` to both promises.
- **Verified flow:** play audio, close the dialog while playing, reopen the dialog, then confirm no new browser error overlay appears.

## AuK Prompt Enhance can misclassify timbre edits as TTS

- **Symptom:** A loose request such as “make the singer sound like a deep adult man” is rewritten as voice-description TTS and inserts the default content `Hello, welcome to AuK`.
- **Cause:** The local Qwen Prompt Enhance classifier selects `Voice description TTS` instead of `Change timbre` when the task verb is ambiguous.
- **Finding:** Starting the request with `Change the timbre of this singing voice...` classifies correctly, but the resulting instruction is the same canonical template SongYUE2 already builds directly.
- **Decision:** Keep Prompt Enhance disabled for SongYUE2 timbre conversion. Send the canonical instruction directly and compare Base guidance values with a fixed source segment and seed.

## Seed-VC / Vevo2 collapse on any source longer than ~10 seconds

- **Symptom (user-confirmed):** a 10s source + 13s reference converts listenably; a 2-minute source
  turns to noise. Using the SAME track as both source and reference still collapses, proving the
  failure is engine length-dependence, not a reference-matching problem.
- **Fix:** feed the engine 10s windows with 2s overlap and stitch trimmed edges, reusing the same
  reference clip for every window -- mirroring the AuK chunk pipeline (shared constants/helpers).
  Wired into `applyVocalTimbreCore` for both `seed_vc` and `vevo2`, and into the Tools content
  editing path via `runAukTool`'s `chunk` flag.
- **Note:** DDSP-SVC is frame-based and converts whole clips unchanged (no length collapse), so it
  needs no chunking.

## Child process promise that blocks the request forever (no timeout)

- **Symptom:** a hung `ffmpeg`/CLI (file held open by another process, corrupt stream) left the HTTP
  request pending indefinitely -- the whole SongYUE2 handler stalls with no error surfaced.
- **Cause:** inline `new Promise` wrappers resolved only on `close`/`error`; a process that never
  exits never fires either. Only `runSvcCli` had a timer, while the many other spawn sites
  (ffmpeg normalization, chunk slicing, seed/vevo/auk stitching, final format convert) did not.
- **Fix (Wave 46):** one shared `runBufferedProcess`(timer+kill+clearTimeout, 512KB log cap) plus
  `runFfmpegCli`(label-aware Korean error messages). All the ffmpeg helpers in the timbre/AuK/Tools
  paths now go through it.
- **Also fixed:** the AuK fetch path had per-fetch timeouts only on health; settings PUT / job POST /
  poll / result download were unbounded, and the 20-min poll deadline only applied *between* fetches.
  `aukFetchJson` now applies `AbortSignal.timeout` per call (5min config, 10s poll, 3min output).
- **Test status:** 23 tests pass; `npm run check` clean.

## Wave 49 (2026-09-24)

- **증상**: Qwen3-TTS `--language korean`이 혼합문의 영어를 빼먹고 `auto`는 한국어를 빼먹음. **해결**: language=auto일 때 문장 단위로 스크립트(한/영)별 분할해 조각마다 언어 지정(`splitTtsByScript`).
- **증상**: Qwen3 Base "requires reference text". **해결**: 참조 텍스트가 비면 Qwen3-ASR로 자동 받아쓰기, 불가하면 `x_vector_only_mode=true`.
- **증상**: Typecast Ref-T2S에서 "입력 내용이 너무 깁니다". **원인**: 요청 본문 한도 1MB에 참조 오디오가 걸림. **해결**: 50MB로 상향. Typecast 복제는 무료 플랜(`custom_voice_slot: 0`)에서 `CLONING_NOT_AVAILABLE`.
- **증상**: Git Bash `curl -d`로 한글 JSON이 깨짐. **해결**: node fetch 스크립트 사용.
- **증상**: 테스트 실행 후 `scripts/start-studio.mjs`가 더미 텍스트로 덮어써짐. **원인**: fake spawn이 `--out` 없을 때 args[0]에 기록. **해결**: 복구 + 실제 프로세스 기동 경로 차단.

- **증상**: RVC 변환이 "종료 코드 3221225477"(0xC0000005, 접근 위반)로 실패. **원인**: 내장 목소리 `default`에서 `retrieval_blend>0`이면 audiocpp_cli가 죽음(검색 인덱스 없음). manthos/chocola/fraise는 0.5에서도 정상, 음높이(semitone)는 무관. **해결**: `default`는 블렌딩을 0으로 강제하고 UI에서 입력 비활성화.

## Wave 50: Installed 필터 누락 (2026-09-25)

- 원인: Installed 분기는 전체 mine.adapters를 정렬만 했다.
- 해결: 허깅페이스와 categoryOptions/languages 및 판정 공유. mineCategory/mineLanguage의 교집합 필터 후 기존 정렬 적용.
- 검증: 두 탭 옵션 일치, 록/메탈 1개·영어 7개·사운드+영어 1개·빈 결과·전체 12개 복원, 메모 저장/취소, 정렬, 팝업 필터 변경 시 기존 2개 선택 유지. 390×420 팝업 필터 행 폭=스크롤 폭 317, 취소 정상. 타입 검사 통과. 실제 모바일 키보드/OS 글꼴 검증은 후속.

## Wave 51: 표지 자동 생성 / VST3 / LoRA 학습 (2026-09-26)

- **Z-Image Turbo가 프롬프트의 글자를 그림에 그린다**: 제목·가사(특히 한글)를 프롬프트에 넣으면 깨진 한글이 그림 속에 나타난다. cfg 1.0(Turbo 기본)에서는 negative prompt가 무시되고, cfg 2.0에 negative(text, letters, …)를 넣어도 막지 못했다. 해결: 프롬프트에는 스타일의 영어 단어만 쓰고 "wordless purely visual … without any signs, captions, letters" 문구를 붙인다(한글은 걸러 냄).
- **Pixabay는 한글 검색이 안 된다**(`lang=ko`여도 10개 단어 전부 0건). 가사의 한글 단어를 영어 검색어로 바꾸는 사전을 쓴다. 무료 API의 `largeImageURL`은 긴 변 1280px까지라 세로로 긴 사진을 정사각형으로 자르면 작아진다 → `per_page=200`에서 정사각형에 가까운 것만 고르고 자른 변이 너무 작은 것은 제외, 남은 것은 1400px로 확대.
- **VST3 설정 상태는 플러그인 창을 정상적으로 닫을 때만 저장된다**(`vst-host --gui --state`). 프로세스를 죽이면 저장이 안 된다. `Process.CloseMainWindow()`(또는 `taskkill /PID`, /F 없음)는 정상 종료로 저장된다.
- **vst-host의 표준 검색은 표준 VST3 폴더만 본다.** 앱 전용 폴더(`engine/vst-host/plugins/`)는 앱이 직접 찾는다. `--process-chain`의 체인 JSON은 `{plugins:[{path, enabled, state}]}`이고 스캔 결과는 stdout의 JSON 배열(로그는 stderr).
- **Dragonfly Reverb가 처리 중 `assertion failure "outparamsptr != nullptr"`를 출력**하지만 종료 코드 0이고 결과는 정상이다.
- **node로 실행하는 가짜 프로세스에 `-y` 같은 인자를 넘길 때** `node -e code -- ...args`처럼 `--`가 필요하다(없으면 node가 자기 옵션으로 읽어 "bad option").
- **새 백엔드 라우트는 서버를 재시작해야 동작한다**(핫리로드 없음). 화면이 "요청한 기능을 찾을 수 없습니다"(404)이면 재시작을 먼저 확인.


## AI polish Advanced naturalization preview (2026-09-26)

The frontend and postfx chain must use the same naturalization parameter object. Keep defaults in sync with `backend/postfx/naturalize.mjs`, clamp API input in `backend/postfx/chain.mjs`, and pass the complete object to `naturalize()`. The Advanced dialog should keep a draft object until Apply, while Preview submits that draft directly. Numeric slider fields need min/max clamping so typed values cannot escape the backend range.
