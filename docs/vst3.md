# VST3 플러그인

내 컴퓨터의 VST3 플러그인(리버브, EQ, 컴프레서 등)을 "AI 곡 다듬기"에 끼워 넣는 기능입니다. 플러그인은 앱 안에서 돌지 않고 **별도 프로세스(`vst-host.exe`)**로 실행되므로, 플러그인이 멈추거나 죽어도 앱은 영향을 받지 않습니다.

## 구성

| 항목 | 위치 | 설명 |
|---|---|---|
| 호스트 | `engine/vst-host/vst-host.exe` | [HOT-Step-CPP](https://github.com/timoncool/HOT-Step-CPP)의 VST3 호스트(MIT) + VST3 SDK. 라이선스 파일(`LICENSE-HOT-Step.txt`, `LICENSE-VST3-SDK.txt`)과 `runtime.json`(빌드한 커밋)을 같이 둡니다. `engine/`은 git에 올라가지 않으므로 새 PC에서는 직접 넣어야 합니다 |
| 앱 전용 플러그인 폴더 | `engine/vst-host/plugins/` | `.vst3` 파일이나 번들 폴더를 여기에 넣으면 검색됩니다(3단계 아래까지) |
| 표준 VST3 폴더 | `C:\Program Files\Common Files\VST3`, `%LOCALAPPDATA%\Programs\Common\VST3` | 호스트가 직접 검색합니다(설치 프로그램이 넣는 곳) |
| 플러그인 설정 | `Setting/VST-states/<해시>.vststate` | 플러그인마다 하나. 플러그인 창을 닫을 때 저장됩니다 |
| 체인 프리셋 | `Setting/VST-chain/<이름>.json` | `{name, plugins:[{path, enabled}]}` |
| 시험 듣기 임시 파일 | `runs/vsttest-<id>/` | 가장 최근 시험 하나만 유지하고, 서버를 다시 켤 때 지웁니다 |

`vst-host.exe`의 명령: `--scan`(검색, JSON 배열), `--gui --plugin <경로> [--state <파일>]`(설정 창), `--process-chain --chain <chain.json> --input <in.wav> --output <out.wav>`(체인 처리, `chain.json`은 `{plugins:[{path, enabled, state}]}`), `--process`, `--monitor`(실시간 재생, 앱은 쓰지 않음).

## 화면

- **AI 곡 다듬기**(곡 메뉴): 처리 순서는 노이즈 제거 → Spectral Lifter → 보컬 자연화 → **VST3 플러그인** → 기준곡 마스터링입니다. "VST3 플러그인"을 켜고, "플러그인 불러오기" 상자에서 고르면 바로 체인에 추가됩니다. 줄마다 켜기/끄기, **설정**(플러그인 자체 창), 저장된 설정 지우기, 위/아래, 제거가 있고, "프리셋 불러오기"/저장 아이콘으로 체인 프리셋을 씁니다.
- **VST3 관리**(왼쪽 메뉴, 음색 변조 아래): 플러그인 카드(이름·제작사·버전·분류·위치), 설정, **시험 듣기**, 저장된 설정 지우기, 삭제(앱 폴더에 넣은 것만), 체인 프리셋 만들기/삭제, 추천 무료 플러그인 링크, "폴더 열기".
- **시험 듣기**: 라이브러리 곡의 일부(시작 위치, 5~60초)에 플러그인 하나만 저장된 설정으로 적용해 원본 구간과 번갈아 듣습니다. "음량 맞추기"(기본 켜짐)는 처리한 소리의 음량을 원본 구간에 맞춰 재생합니다(재생용 복사본만 조정, 최대치 0.98 제한).

## 동작 방식

- 곡 다듬기는 처리 스레드 안에서 오디오를 32비트 float WAV로 호스트에 넘기고 결과를 읽어옵니다. 결과 길이는 항상 입력과 같게 맞춥니다.
- **설정 창의 상태는 창을 정상적으로 닫을 때만 저장됩니다.** "강제 종료"는 프로세스를 바로 끄기 때문에 저장되지 않을 수 있습니다. 창은 최대 60분 뒤 자동으로 종료됩니다.
- 검색된 목록에 있는 플러그인만 처리·설정 창에 쓸 수 있습니다(브라우저가 보낸 임의 경로는 호스트에 넘기지 않음). 체인은 최대 8개입니다.
- 처리 한 번은 최대 5분입니다. 넘으면 프로세스를 강제 종료하고 오류를 보여 줍니다.
- 플러그인 삭제는 `engine/vst-host/plugins/` 안의 항목만 됩니다(시스템 폴더의 플러그인은 지우지 않음).

## API

`GET /api/vst/plugins[?refresh=1]`, `GET·POST /api/vst/editor`, `POST /api/vst/editor/close`, `DELETE /api/vst/state`, `POST /api/vst/open-folder`, `DELETE /api/vst/plugin`, `GET·POST·DELETE /api/vst/chains`, `POST /api/vst/test`, `GET /api/vst/test/:id/(original|processed)`. 곡 다듬기 요청(`POST /api/projects/:id/polish`, `POST /api/audio-tools/polish`)의 `settings.vst = {enabled, plugins:[{path, enabled}]}`가 체인입니다. 자세한 내용은 [local-api.md](local-api.md)를 보세요.

## 확인된 것과 한계

- **Dragonfly Reverb(Hall / Plate) 3.2.10**(GPL-3.0)로 검색, 설정 창 열기·닫기(상태 저장), 곡 처리, 시험 듣기까지 실제로 확인했습니다. 같은 구간에서 저장된 설정을 넣었을 때와 뺐을 때 결과가 다르고(약 −14.6 dB 차이), 화면의 결과가 호스트를 직접 돌린 결과와 같음(−121.8 dB)을 측정했습니다. 이 플러그인은 처리할 때 `assertion failure` 경고를 출력하지만 결과에는 문제가 없었습니다.
- 다른 플러그인(TDR Nova/Kotelnikov, Valhalla Supermassive, Kilohearts Essentials 등)은 무료·VST3·Windows 64비트인 것만 확인했고 **이 호스트에서의 동작은 시험하지 않았습니다.** iLok·로그인이 필요한 플러그인이나 신디사이저는 맞지 않습니다.
- 측정용 플러그인(스펙트럼·음량 미터)은 화면 없이 처리하므로 의미가 없어 추천 목록에서 뺐습니다.
- 곡 다듬기는 곡 전체를 한 번에 처리하는 방식이라 실시간 미리듣기는 없습니다. 파라미터는 플러그인 창에서 정한 뒤 "시험 듣기"나 다듬기 결과로 확인합니다.
- Audio Tools의 "AI 처리" 창에는 VST3 UI가 없습니다(서버는 그 요청의 `settings.vst`도 받을 수 있음).

## 테스트

`backend/vst.test.mjs`는 가짜 호스트(node 스크립트)로 WAV 변환, 체인 설정, 시간 초과 종료, 상태 전달, 검색, 설정 창, 폴더 열기, 삭제, 체인 프리셋, 시험 듣기 라우트를 검사합니다. 실제 플러그인은 테스트에 포함되지 않습니다(`engine/`이 git 밖이므로).
