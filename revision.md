# 변경 이력 (Revision History)

`git log`를 기준으로 정리한 커밋 단위 변경 이력입니다. 최신 항목이 위에 옵니다.

## "보컬 음색 변환"을 STEM1 스타일로 다시 원복 + 보컬 무음 버그 수정 (2026-09-16, 같은 날 세 번째 재설계)

"원본 vs 결과" 단순화 버전을 배포한 뒤, RVC/Seed-VC 아키텍처(보컬/반주 분리→보컬만 변환→재합성)에 대한 설명을 듣던 사용자가 "내가 이해가 부족했네 그렇다면 이전 구조가 rvc의 플로우하고 맞았던거네 미안한데 이전구조로 원복하는게 좋겠어. 미안해"라며 STEM1 스타일(두 번째 재설계) 편집기로 되돌려달라고 요청했다. 같은 메시지에 실제 버그 제보도 함께 왔다 — "만들어진 것을 들으면 보컬이 아예 없어지고 악기만 남았어 rvc가 제대로 안된거 같은데."

원복 자체는 이전에 이미 짜뒀던 STEM1 스타일 구현을 그대로 복원하는 작업이었다 — `VocalTimbreDialog`를 스템 리스트+개별 "후처리"(중첩 `PostProcessDialog`)+combined-original/preview 비교+합치기/저장 흐름으로, 백엔드도 `applyVocalTimbre()`/`finalizeVocalTimbre()`를 STEM 폴더의 `vocals.wav`를 덮어쓰는 방식으로, `GET /vocal-timbre/result` 라우트는 제거하고 `POST /vocal-timbre/save`는 다시 `{dataUrl, title}`을 받도록 되돌렸다.

버그는 되돌리기와 별개로 원인부터 실측했다. `ffmpeg -af volumedetect`로 캐시된 실제 테스트 오디오를 측정한 결과: 원본(변환 전) 보컬 -26.4dB, Seed-VC 변환 후 보컬 -34.0dB, 반주 -24.1dB — 변환된 보컬이 원본보다 7.6dB나 조용해서 반주에 완전히 묻힌 것이 원인이었다. 모노/스테레오 채널 레이아웃 불일치는 합성 사인파(440Hz 모노+220Hz 스테레오)를 `amix`로 섞어보는 별도 테스트로 원인에서 배제했다.

수정은 두 단계로 진행했다. 1차: `applyVocalTimbre()`에 `measureMeanVolumeDb()` 헬퍼(ffmpeg volumedetect 파싱)를 추가해 변환 전/후 음량 차이를 재고 `-6~+18dB`로 clamp한 값을 `ffmpeg -af volume=XdB`로 곱했다. 실제 캐시 오디오로 재검증했더니 mean_volume은 원본과 거의 일치했지만(-26.5dB), max_volume이 정확히 0.0dB — 원본 변환 출력이 이미 피크 -2.2dB 근처라 게인을 곱하는 순간 하드클리핑이 난 것이었다. 2차: 게인 필터 뒤에 `alimiter=limit=0.97:level=false`를 붙여(자동 레벨 보정을 꺼서 방금 넣은 게인을 되돌리지 않게 함) 피크만 부드럽게 눌렀다 — 최종적으로 mean -27.0dB, peak -0.3dB로 클리핑 없이 음량이 정상화됐다.

백엔드 테스트를 STEM1 흐름(적용→`/stems/vocals`+`/stems/instrumental` 서빙 확인→재적용 시 분리 스킵→`volumedetect` 프로브 2회+게인·리미터 ffmpeg 호출 검증→저장은 dataUrl 업로드)에 맞춰 다시 썼고, `makeFakeSpawn()`에 `volumedetect`(마지막 인자가 `-`인 null 출력이라 기존 범용 ffmpeg 분기가 그대로 못 씀) 전용 분기와 `setVolumeProbe()`를 추가해 실측과 같은 음량 차이를 기본값으로 재현하게 했다. 14개 스위트 전부 통과, `npm run check` 클린.

실제 2분 11초 완성곡으로 브라우저 종단 재검증했다 — 참조 음색 업로드→적용(보컬 분리+변환+음량 보정, 약 150초)→STEM1처럼 보컬/악기 트랙이 나타남 확인→합치기→저장→라이브러리에 새 곡 추가. 저장된 FLAC을 curl로 받아 ffprobe로 길이(2:11) 확인, `ffmpeg astats`로 피크 클리핑 없음(Peak count 801/6.3M 샘플, 정상 범위) 확인, 결과 파일(적용 직후 믹스+최종 저장본 둘 다)을 사용자에게 전달.

## "보컬 음색 변환"을 "원본 vs 결과" 비교로 다시 단순화 (2026-09-16, 같은 날 두 번째 재설계)

STEM1 스타일 편집기를 막 배포하고 나서, 사용자가 "약간 다르게 이해했네"라며 실제로 그렸던 그림을 구체적으로 설명했다 — 참조 음색을 넣고 적용하면 원본과 변경된 오디오가 바로 나타나고, 그걸 비교해서 들으면 되는 정도를 기대했다고 했다. STEM1처럼 보컬/악기를 나눠 보여주는 건 필요 없었고("STEM1처럼 악기 분리는 할 필요가 없었는데"), 개별 트랙 후처리도 "사실 라이브러리에 저장되면 후처리를 따로 할 수 있으니 그것까지 합해놓으면 복잡할 수도 있겠다"며 스스로 빼는 게 낫다고 판단했다. 요청한 최종 레이아웃은 명확했다 — 왼쪽에 있던 것(제목/참조 파일 선택/적용)을 상단으로, 후처리는 빼고, 위에 파일 탐색기+적용 버튼, 아래는 지금처럼 원본과 변경본 비교 듣기만.

`VocalTimbreDialog`를 다시 크게 걷어냈다 — 스템 리스트, 각 트랙의 "후처리"(중첩 `PostProcessDialog`), `mixBuffers`로 클라이언트에서 합치던 로직, `audioBufferToWavBlob`으로 저장용 WAV를 굽던 로직을 전부 제거했다. 남은 건 상단 바(제목 입력+참조 음색 파일 선택+적용하기 버튼)뿐이고, 적용하면 "원본"(이 곡이 원래 갖고 있던 `/api/projects/:id/audio`를 그대로 디코드 — 별도로 재구성할 필요가 없다는 걸 깨달았다)과 "변경본"(서버가 다 끝내놓은 결과) 두 파형만 비교 재생한다.

백엔드도 그만큼 가벼워졌다. `applyVocalTimbre()`가 이제 STEM 폴더의 `vocals.wav`를 프론트가 읽어갈 수 있게 덮어쓰는 대신, 변환된 보컬과 반주를 서버 안에서 ffmpeg `amix`로 곧장 합쳐 `result.wav`로 캐싱하고, 새 라우트 `GET /vocal-timbre/result`가 그걸 그대로 서빙한다. "저장"도 더는 브라우저가 두 트랙을 믹스해서 WAV를 통째로 업로드할 필요가 없어졌다 — `POST /vocal-timbre/save`가 제목만 받아서 서버에 이미 있는 `result.wav`를 그대로 `finalizeToMusic()`에 넘긴다(저장하면 그 캐시가 소비되므로, 재저장하려면 다시 적용해야 한다는 걸 백엔드 테스트로 명시).

같은 2분 11초 완성곡으로 다시 종단 검증했다 — 새 레이아웃(상단 바만, 스템/후처리 없음) 확인 → 참조 음색 선택 → 적용하기(보컬 분리+변환+서버 재합성, 이번엔 서버 쪽 remix 단계가 추가돼 이전보다 살짝 더 걸림) → 원본/변경본 두 파형만 나타남을 확인 → 변경본 재생(0:04/2:11, 파형 하이라이트 정상) → 저장 → 라이브러리에 새 곡 추가(2:11 길이 정확히 일치, curl+ffprobe로 검증)까지 브라우저에서 실제로 확인했다. 백엔드 테스트도 새 흐름(적용→`/result` 200 확인→재적용은 STEM 분리 스킵→저장은 캐시를 소비하므로 재저장 시도는 400)에 맞춰 다시 썼고, 14개 스위트 전부 통과, `npm run check` 클린.

## "보컬 음색 변환"을 STEM1 스타일 편집기로 재설계 (2026-09-16)

방금 만든 원샷(파일 선택→바로 최종 저장) 방식을 배포한 직후, 사용자가 "RVC를 곡 만드는 단계에서 할건가? 만든이후에 후처리로 할껀가?"라고 아키텍처를 다시 물었다. YuE2 자체엔 참조 오디오 기반 화자 임베딩 입력이 없다는 걸 "커버" 기능 때 이미 확인해뒀어서(생성 단계에 ref를 못 먹임), 후처리일 수밖에 없다고 답했다. 이어서 STEM1의 EQ/FX는 브라우저 Web Audio로 즉시 재계산되는 순수 클라이언트 DSP인 반면 RVC/Seed-VC는 GPU 추론(RTF≈0.82)이라 "ref 바꾸면 즉시 바뀐다"는 STEM1 노브 수준의 실시간성은 안 되고 "다시 몇십 초 걸려서 바뀐다"는 것만 가능하다고 짚었다. 사용자가 그래도 "STEM1과 같은 UI"로 만들어달라며 구체적인 레이아웃(왼쪽에 참조 음색 선택+하단에 적용 버튼, 적용하면 원본/결과가 나오고 옆에 후처리, 아래에 원본과 후처리까지 된 결과)을 지정했다.

STEM1(`StemDialog`, 'vocal' 모드)의 코드를 다시 읽어보니 이미 필요한 구조가 거의 다 있었다 — 마운트 시 STEM 분리 → 스템별 waveform+"후처리"(중첩 `PostProcessDialog`, `sourceOverride`/`onSaveOverride`로 편집한 버퍼를 되받음) → combined-original(초기 믹스, 고정)과 combined-preview(스템 편집 때마다 `refreshPreview()`로 갱신) 두 파형 비교 재생 → "합치기"로 미리듣기 확정 → "저장". 저장 흐름을 보니 STEM1은 `/api/projects/:id/post-process`로 파일을 **다운로드만** 하고 라이브러리엔 안 남긴다는 것도 코드로 확인했다 — 우리가 원하는 "새 완성곡으로 저장"과 다른 지점이라 AskUserQuestion으로 명시적으로 확인(다운로드-전용 vs 라이브러리 저장 중 사용자가 "라이브러리 저장"을 선택).

이 골격을 그대로 가져와 `VocalTimbreDialog`를 다시 썼다. StemDialog와 다른 점은 딱 둘: ①마운트 시 바로 분리하지 않고, 왼쪽 사이드바(참조 음색 파일 선택+제목 입력+"적용" 버튼)에서 사용자가 먼저 참조 오디오를 고르고 "적용"을 눌러야 스템이 나타남. ②"저장"이 파일 다운로드 대신 새 완성곡으로 라이브러리에 저장됨(새 백엔드 라우트 `POST /vocal-timbre/save`). 백엔드도 원샷 `convertVocalTimbre()`를 둘로 쪼갰다 — `applyVocalTimbre()`(참조 음색으로 변환해 STEM 폴더의 `vocals.wav`를 덮어써서 기존 `GET /stems/vocals` 라우트를 그대로 재사용 가능하게 함, 분리된 "변환 전 원본 보컬"은 `vocals-original.wav`로 따로 캐싱해 참조를 바꿔 재적용할 때 STEM 분리를 다시 안 하고 보컬만 재변환하도록 함)와 `finalizeVocalTimbre()`(브라우저에서 합쳐진 WAV를 받아 `finalizeToMusic()`으로 새 곡 저장). 사이드 이펙트로 반주 트랙에 이미 적용한 후처리는 참조를 바꿔도 유지됨.

실제 완성곡(2분 11초)으로 새 편집기를 종단 검증했다 — 참조 음색 업로드→적용(보컬 분리+Seed-VC 변환, 약 130초 소요)→보컬/악기 스템이 STEM1처럼 나타남→보컬의 "후처리" 버튼으로 중첩 EQ/FX 다이얼로그가 정상 오픈됨을 확인→재생/파형 하이라이트 정상 동작→"저장"으로 라이브러리에 새 곡 추가(2:11 길이 정확히 일치, curl+ffprobe로 검증)까지 전부 브라우저에서 실제로 눌러봤다. "재적용 시 STEM 분리를 건너뛴다"는 로직은 실제 대기 시간이 길어(2분씩) 브라우저에서 두 번 반복 검증하는 대신, 이미 정밀한 백엔드 유닛 테스트(가짜 spawn 호출 단위로 `mel_band_roformer`가 재적용 시 호출 안 되는 것)로 확인했다. `npm test`(14개)+`npm run check` 통과.

## 보컬 음색 변환(Seed-VC) 기능 추가 (2026-09-16)

"당초 하기로한 순서대로 진행해줘"라는 요청에 따라, AudioSR → MuScriptor 다음으로 정해뒀던 로드맵 3번째 항목(RVC/Seed-VC 보컬 음색 변환)에 착수했다. audio.cpp가 음색 변환을 두 갈래로 제공한다는 걸 확인했다 — RVC(`model_specs/rvc.json`, `"status": "experimental"`, 내장 음색 4개 중에서만 선택)와 Seed-VC(`model_specs/seed_vc.json`, `"status": "supported"`, 임의의 참조 오디오로 제로샷 변환, 노래 전용 `svc` 태스크 있음). AudioSR/MuScriptor 때 세운 기준(`status` 필드로 안정성 판단)을 그대로 적용해 Seed-VC를 택했다.

audio.cpp를 `-Models "yue2,htdemucs,bs_roformer,audiosr,muscriptor,seed_vc"`로 재빌드했는데, 빌드 로그에서 `seed_vc`가 이전엔 전혀 컴파일된 적 없었다는 걸 확인했다(14개 새 오브젝트 파일). 모델(SeedVC-MLX Q8_0 GGUF, 2.90GB) 다운로드 중 흥미로운 문제를 만났다 — 기존 `scripts/download_models.py`의 `urllib` 기반 다운로드가 HuggingFace의 Xet 스토리지 백엔드에서 초당 4MB를 받은 뒤 완전히 멈췄다(같은 URL을 `curl`로 받으면 36MB/s로 정상 동작 — urllib 쪽 문제로 추정, 원인은 못 찾음). `curl`로 직접 받아 우회한 뒤 스크립트를 재실행해 sha256 검증만 통과시켰다.

Seed-VC는 보컬 트랙 하나만 변환하는 모델이라, 곡 전체를 그대로 넣을 수 없다. 그래서 `convertVocalTimbre()`(`backend/server.mjs`)가 기존 STEM 분리 로직(`separateStems(entry, 'vocal')`, Mel-Band RoFormer)을 재사용해 보컬/반주를 먼저 나누고, 보컬만 Seed-VC SVC(`--task-route v1_svc`)로 변환한 뒤 ffmpeg `amix` 필터로 반주와 다시 합쳐 새 완성곡으로 저장하는 파이프라인을 짰다. 완성곡 메뉴에 "보컬 음색 변환"(`Mic` 아이콘) 버튼과 `VocalTimbreDialog`(참조 음색 파일 업로드+제목+진행률)를 추가했는데, AudioSR급으로 느려서(RTF ≈ 0.82, MuScriptor의 0.024보다 훨씬 느림) 음원 복원 때 쓴 진행률 폴링 UI 패턴을 그대로 재사용했다.

Phase 0로 먼저 CLI를 직접 실행해 검증했다 — 실제 라이브러리 곡의 보컬을 추출해 다른 곡의 보컬을 참조 음색으로 40초 클립 변환(33초 소요, 유효한 오디오 확인)한 뒤, 실제 브라우저 UI로 2분 11초 완성곡을 끝까지 변환하는 종단 테스트까지 완료했다(파일 업로드 → 변환 → 라이브러리에 새 곡으로 저장, 임시 파일/STEM 폴더 정리까지 확인). 결과물을 사용자에게 전달했다. 백엔드 테스트 추가(가짜 spawn으로 STEM 분리→seed_vc→amix 순서와 누락 모델 400 검증, 14개 스위트 전부 통과), `npm run check` 통과. 문서(`docs/audiocpp-setup.md`에 "보컬 음색 변환" 절 신설, `docs/models.md`/`README.md`/`progress.md`) 및 memory-bank 갱신.

## MIDI 편집기에 신디사이저 미리듣기 추가 + 프로젝트 목록 스캔 버그 수정 (2026-09-16)

사용자가 "신디사이저 소리듣기는 모야? 그거도 넣으면 환상적일거 같은데"라며 이전에 범위 밖으로 뺐던 재생 기능을 요청해서 바로 이어서 구현했다. 외부 라이브러리나 사운드폰트 없이 Web Audio API의 `OscillatorNode`+`GainNode`만으로 만들었다 — 악기 태그별로 파형을 다르게 매핑(피아노류는 triangle, 현/기타류는 sawtooth, 베이스/보컬/플루트는 sine 등)하고, 클릭 노이즈를 막기 위해 각 음표마다 짧은 attack/release 램프가 있는 게인 엔벨로프를 걸었다. 재생은 현재 편집기에 있는(아직 저장하지 않은) 노트 상태를 그대로 스냅샷해서 스케줄링하므로, 편집 후 저장 전에도 바뀐 내용을 바로 들어볼 수 있다. 피아노롤 위로 재생 위치를 보여주는 세로선(플레이헤드)이 `requestAnimationFrame`으로 실시간 이동하고, 음표를 옮기거나 추가/삭제하면 재생 중이던 예약이 자동으로 멈춘다(그대로 두면 편집 전 상태의 소리가 남아있게 되므로).

구현 중 실제 브라우저로 종단 검증을 하다가 진짜 버그를 하나 발견했다 — `.notes.json` 캐시 파일이 `.mid`와 같은 `library/music/` 폴더에 저장되는데, 프로젝트 목록을 만드는 `listEntries()`가 그 폴더의 `*.json` 전부를 프로젝트 파일로 취급해서 읽고 있었다. `.notes.json`은 `{title, id, ...}` 형태의 프로젝트가 아니라 평범한 노트 배열이라, 이게 "프로젝트"로 잘못 섞여 들어가면 `title`이 `undefined`가 되어 프론트의 정렬 로직(`b.title.localeCompare(a.title)`)이 런타임에 크래시했다(실제로 페이지가 하얗게 깨지는 걸 목격함). `listEntries()`의 `.json` 필터에 `!name.endsWith('.notes.json')`을 추가해 고쳤고, 고치기 전으로 되돌려서 새로 추가한 회귀 테스트가 실제로 이 문제를 잡아내는 것까지 확인한 뒤 다시 복구했다. `npm test`(13개 전부 통과)+`npm run check` 통과, 실제 라이브러리 곡으로 브라우저에서 재생/정지 버튼과 플레이헤드 애니메이션 동작 확인.

## MIDI 편집기 팝업(음표 보기/수정/저장) 추가 (2026-09-16)

"MIDI로 내보내기만 하면 미디가 어떻게 되었는지 확인이 불가능하다"는 사용자 지적에 따라, 메뉴를 눌렀을 때 바로 다운로드하는 대신 SVG 피아노롤 팝업을 띄우도록 바꿨다. 범위를 물어봤을 때 사용자가 "음표 추가까지는 이번에 같이 넣어줘"라고 답해서, 이동/리사이즈/삭제뿐 아니라 빈 공간 클릭으로 새 음표를 추가하는 것까지 이번 범위에 포함했다(재생/신디사이저 미리듣기는 제외).

구현 전 확인해보니 MuScriptor CLI가 `--out result.mid`와 동시에 `--text-out result.json`을 한 번의 실행으로 같이 뽑을 수 있었다(실제 실행해서 JSON 형태 확인: `{"type":"start"|"end", "pitch", "start_time"|"end_time", "index", "start_event_index", "instrument"}` 쌍). 그런데 MuScriptor에도 audio.cpp 전체에도 "편집된 노트 목록 → 표준 MIDI 파일"로 되돌리는 인코더는 없어서, `backend/midi.mjs`에 SMF(포맷 0·단일 트랙) 인코더를 새로 작성했다 — 템포 메타 이벤트, 악기 이름→General MIDI Program Change 매핑, 초→틱 변환, 가변길이 델타타임 인코딩까지 직접 구현. `exportMidi()`를 확장해 `.mid`와 함께 `<파일명>.notes.json`(정리된 평평한 배열)을 같은 mtime 캐싱 규칙으로 저장하고, `GET /midi/notes`(조회)·`POST /midi`(편집 저장, `encodeMidiFile()`로 재인코딩해 캐시 덮어씀) 라우트를 추가했다.

프론트는 기존 `EqBar`/`Knob`의 `setPointerCapture` 드래그 패턴을 참고해 `MidiEditorDialog`(`app/app/studio.tsx`)를 새로 작성했다 — SVG를 택한 이유는 음표별로 개별 `onPointerDown`을 붙이기 쉬워서(이 프로젝트의 기존 캔버스 시각화는 전부 읽기 전용이라 인터랙션엔 안 맞음). 몸통 드래그로 이동, 좌/우 가장자리 드래그로 리사이즈, 빈 배경 클릭으로 새 음표 추가(악기는 다이얼로그 상단 드롭다운, 기본값은 그 곡에서 가장 많이 쓰인 악기), 선택 후 삭제 버튼, 하단에 취소/저장/다운로드. 검증: `backend/midi.mjs`로 만든 `.mid`를 Python `mido`로 라운드트립 검증(타이밍·Program Change 정확함). 실제 라이브러리 곡("JR0001-1 내가 기다리는 것")으로 로컬 dev 서버를 열어 브라우저에서 종단 확인 — 실제 MuScriptor 추출 결과가 피아노롤에 정확히 렌더링, 클릭 선택/삭제/빈칸 클릭 추가 모두 동작, 저장 후 서버에서 다시 받은 노트와 재다운로드한 `.mid`(다시 `mido`로 검증)에 편집이 반영됨을 확인. 테스트에 notes GET/POST 라운드트립 케이스 추가(`backend/server.test.mjs`, 여전히 13개 스위트 전부 통과). `npm run check` 통과.

## AudioSR 클릭 잡음 원인 확정(L/R 분리와 무관) + MIDI로 내보내기(MuScriptor) 기능 추가 (2026-09-16)

사용자가 "음원 복원" 결과물에서 "쇠긁는 소리"를 보고해서, ffmpeg `showspectrumpic` 필터로 스펙트로그램을 뽑아 원인을 추적했다. 처음 보내준 파일(모노를 스테레오로 복제한 테스트 소스)의 좌/우 채널을 각각 스펙트로그램으로 봤더니 17.2초·18.8초에 전 대역(DC~24kHz)을 덮는 수직선(클릭의 전형적 신호)이 있었다. 다음을 실측으로 하나씩 배제했다: L/R 분리·재결합(null-test로 원본과 -91dB=사실상 동일, 완전히 깨끗함), 좌우 디코릴레이션(스테레오 폭 AudioSR 전후 거의 동일), seed 값(42→123으로 바꿔도 같은 위치에 재현), 청크 분할(30초로 통짜 처리해도 그대로). 사용자가 "L/R 분리하지 말고 AudioSR만 해보라"고 요청해서, `channelsplit`를 전혀 거치지 않은 순수 모노 다운믹스(`ffmpeg pan=mono`)를 AudioSR에 직접 돌려봤는데도 클릭이 똑같이 재현됐다 — SongYUE2가 추가한 어떤 코드와도 무관하게 audio.cpp의 AudioSR 구현 자체의 문제임을 최종 확정했다(다른 곡으로 테스트하니 클릭 2개가 아니라 훨씬 잦은 빈도로 나옴). `model_specs/audiosr.json`이 이미 `"status": "experimental"`로 표시해뒀던 것과 부합한다. 사용자 결정에 따라 기능은 유지하되 사이드바 메뉴와 페이지에 "(실험적)" 표시+경고문을 추가하고, 근본 원인(STFT/hop, VAE 디코드 경계 등 audio.cpp C++ 내부) 조사는 `progress.md`에 할 일로 남겨두고 보류했다. 사용자가 스펙트로그램을 마음에 들어해서 `showspectrumpic` 사용법과 그래프 읽는 법(시간/주파수/색상 축, 대역폭 컷오프, 클릭의 수직선 신호)도 설명했다.

이어서 로드맵의 다음 항목인 MuScriptor(오디오→MIDI)를 구현했다. AudioSR과 같은 패턴으로 `scripts/download_models.py`에 `MuScriptor-Small-GGUF/muscriptor-small-f32.gguf`(412MB)를 추가해 받고, audio.cpp를 `-Models "yue2,htdemucs,bs_roformer,audiosr,muscriptor"`로 재빌드했다. `model_specs/muscriptor.json`이 `"status": "supported"`(AudioSR과 달리 실험적 아님)로 표시된 대로, 실측도 매우 안정적이었다 — RTX 5070에서 30초 클립을 0.7초에 처리(RTF ≈ 0.024, 실시간 42배), 유효한 Standard MIDI 파일과 음악적으로 합리적인 노트 이벤트(피치·타이밍·악기 태그)가 나왔다. 속도가 워낙 빨라서 AudioSR/음원 복원 때처럼 진행률 폴링 UI를 만들 필요 없이, 완성곡 메뉴에 "MIDI로 내보내기" 버튼 하나 추가(`Music2` 아이콘, 다운로드 버튼 바로 아래)로 충분했다 — 백엔드 `exportMidi()`가 원본 오디오와 같은 폴더에 `<파일명>.mid`로 결과를 캐시해서(mtime 비교), 재다운로드는 0.08초 만에 즉시 응답한다. 실제 라이브러리 곡으로 종단 검증(가짜 spawn 아님) 후 사용자에게 결과 .mid 파일을 전달했다. `npm test`(13개 전부 통과)/`npm run check` 확인. 문서(`docs/audiocpp-setup.md`에 "MIDI로 내보내기" 절 신설, `docs/models.md`/`README.md`/`progress.md`) 및 memory-bank 갱신.

## 음원 복원(AudioSR) + 채널 분리 기능 추가 (2026-09-16)

audio.cpp의 `model_specs/`를 전부 훑어 음악 관련 미사용 기능(RVC/Seed-VC 음색 변환, ACE-Step/Stable Audio 대체 생성 엔진, MuScriptor 오디오→MIDI, AudioSR 오디오 복원)을 사용자에게 정리해 보고했고, 사용자가 "다 넣어보고 싶다"며 순서를 정해 하나씩 만들자고 해서 AudioSR을 1순위로 확정했다. 처음엔 "완전 저질 오디오 복원+임포트용 별도 메뉴"로 요청했다가, AudioSR이 출력을 무조건 모노로 만드는 것(우회 옵션 없음, 예전에 YuE2 자체 출력에 시도했을 때도 확인했던 한계)을 다시 짚어주자 "L/R 채널을 나눠 각각 복원한 뒤 합치자"는 우회 방식을 사용자가 직접 제안해서 그대로 채택했다.

구현 중간에 사용자가 "L/R 분리를 STEM 분리처럼 후처리 다이얼로그로 넘기고, "..." 메뉴에 STEM1 앞에 추가해봐"라고 해서, 처음엔 AudioSR 복원 자체를 STEM 다이얼로그 재사용 방식으로 재설계하려 했다. 하지만 되물어보니 실제로는 **두 개의 완전히 독립된 기능**이었다 — ①"음원 복원"(AudioSR)은 사이드바의 별도 업로드 페이지로, 내부적으로만 L/R 분리·복원·재결합을 하고 사용자에게는 "복원" 하나로만 보임. ②"채널 분리"는 AudioSR과 무관하게, 완성곡 메뉴에서 AI 모델 없이 순수 `ffmpeg channelsplit`로 왼쪽/오른쪽을 나눠 기존 STEM 분리 UI(각 파트 EQ/FX 후처리 후 합쳐서 저장)를 그대로 재사용하는 범용 도구. 처음에 하나로 오해할 뻔한 걸 사용자가 직접 정정해줬다.

**음원 복원**: `backend/server.mjs`에 `restoreAudio()`/`runAudioSr()` 추가, 새 라우트 `POST /api/audiosr-restore`. 업로드된 파일을 ffmpeg로 48kHz WAV로 정규화 → ffprobe로 채널 수 확인 → 모노면 그대로, 스테레오면 `channelsplit`로 분리해 채널마다 `audiocpp_cli --task s2s --family audiosr`를 따로 돌리고 `join` 필터로 재결합 → project 없이 바로 `finalizeToMusic()`으로 새 완성곡 저장(pseudo-project `{id, title, coverPath:null}`만으로 충분함을 확인 — `file` 파라미터는 애초에 안 쓰임). 사이드바 좌측 하단에 "음원 복원" 메뉴 신설(`Page` 타입에 `'restore'` 추가, `restorePage()` 렌더 함수, 업로드 input은 기존 "오디오에서 추출" 커버 업로드와 같은 FileReader→dataUrl 패턴 재사용).

**채널 분리**: `STEM_MODES`(백엔드)/`STEM_MODE_CONFIG`(프론트)에 `channel: { stems: ['left','right'] }` 모드만 추가 — `STEM_NAMES`가 자동 유도되는 구조 덕분에 `/api/projects/:id/stems/:name` 라우트는 수정 없이 그대로 동작했고, 프론트 `StemDialog` 컴포넌트도 하드코딩된 stem 이름이 없어 `STEM_MODE_CONFIG`/`STEM_LABELS`만 확장하면 됐다(제목/로딩 문구만 `dialogTitle` 필드로 모드별 분기 추가). `separateStems()`는 `modeKey === 'channel'`일 때 audio.cpp 엔진/모델 체크를 완전히 건너뛰고 ffprobe+ffmpeg만 쓰도록 분기.

빌드 중 실제로 겪은 문제: `build_windows.ps1`의 `-Models` 파라미터가 `[string]` 타입인데 따옴표 없이 `-Models yue2,htdemucs,bs_roformer,audiosr`라고 쓰면 PowerShell이 쉼표를 배열 연산자로 해석해 `ParameterBindingArgumentTransformationException`이 남 — `-Models "yue2,htdemucs,bs_roformer,audiosr"`처럼 반드시 따옴표로 감싸야 함(기존 문서의 예시 명령도 따옴표가 없었어서 이번에 처음 발견하고 전부 수정). 테스트의 가짜 spawn에서도 `args.includes('channelsplit')`(정확히 일치 비교)가 실제로는 `args.some(arg => arg.includes('channelsplit'))`(부분 문자열 포함)여야 했던 버그를 초기 테스트 실행에서 잡아 수정.

실기 검증: 11kHz 모노/24kbps mp3로 실제 열화시킨 20초 테스트 클립을 AudioSR로 복원해 6kHz 이상 고음 평균 에너지가 -59.5dB(열화)→-51.0dB(복원)로 실제 개선됨을 확인(무손실 원본은 -42.6dB — 완전 복원은 아니지만 방향은 명확히 원본 쪽). 실제 SongYUE2 백엔드(가짜 spawn 아님)로 `/api/audiosr-restore`와 채널 분리 API를 둘 다 실행해 라이브러리 저장·스테레오 유지까지 확인. `npm test`(mock 테스트 포함 12개 전부 통과)/`npm run check` 통과. 문서(`docs/audiocpp-setup.md`에 채널 분리/음원 복원 절 신설, `docs/models.md`/`README.md`/`progress.md` 갱신) 및 memory-bank 갱신.

## ComfyUI 어댑터를 AudioAuK 재사용 → SongYUE2 독립 설치로 전환 (2026-09-16)

직전 커밋(`1f76797`)에서는 사용자 지시에 따라 ComfyUI를 새로 설치하지 않고 자매 프로젝트 `C:\Claude\AudioAuK\engine\ComfyUI`를 재사용했는데, 사용자가 다시 "독립적으로 설치하면 디스크가 얼마나 필요한지" 물어봐서 실제 AudioAuK 설치를 측정해 답했다(`.venv` 4.10GB, 체크포인트 3.96GB 하드링크면 추가 비용 약 4.2GB, 완전 별도면 약 8.5GB). 이어서 사용자가 실제로 독립 설치 + 문서 갱신 + 실제 생성 테스트 + 커밋/푸시까지 요청해서 진행했다.

`engine/ComfyUI`(다른 엔진들과 같은 위치, `.gitignore` 대상)에 공식 ComfyUI를 클론하고 Python 3.12 venv를 새로 만들어 PyTorch 2.14.0+cu130 + `requirements.txt`(comfy-kitchen 0.2.34 포함 — INT8 ConvRot 양자화 커널)를 설치했다. AudioAuK의 ComfyUI(포트 8189)와 동시에 떠 있어도 충돌하지 않도록 포트를 **8190**으로 분리했고, `backend/server.mjs`/`app/app/studio-data.ts`의 `DEFAULT_COMFYUI_ENDPOINT`/`DEFAULT_COMFYUI_ENGINE_PATH`를 이 새 경로로 갱신했다 — 기본 경로도 다른 `DEFAULT_*_PATH` 상수들과 같은 관례대로 SongYUE2 루트 기준 상대경로(`engine\ComfyUI`)로 되돌렸다(AudioAuK 재사용 때는 절대경로였음). 체크포인트는 이번에도 하드링크로 연결해 3.96GB 중복 저장을 피했다.

설치 직후 `/object_info`+`/prompt` curl 스모크 테스트로 이 새 설치에서도 실제 오디오가 나오는지 먼저 확인한 뒤, SongYUE2 백엔드를 재기동해 실제 곡("독립설치테스트-노래", 51초)을 끝까지 생성해 사용자에게 파일로 전달했다 — 무음/클리핑 없는 정상 오디오였다. `npm test`(11개 전부 통과)와 `npm run check`도 재확인했다. 문서는 `docs/comfyui-setup.md`를 재사용 절차 대신 독립 설치 절차 중심으로 전면 재작성(디스크 용량 표 포함)했고, `docs/models.md`/`progress.md`/memory-bank(`STATE.md`/`active-context.md`/`knowledge/RULES.md`)도 새 경로/포트를 반영해 갱신했다. 테스트에 쓴 프로젝트/곡은 라이브러리에서 삭제해 정리했다.

## `1f76797` — Add ComfyUI adapter to run the INT8 ConvRot model, verified end-to-end (2026-09-15)

`yue2_3b_int8_convrot.safetensors`는 ComfyUI 전용 형식이라 audio.cpp/공식 Python 어느 쪽으로도 실행되지 않아 그동안 명확한 한국어 오류로 생성을 차단만 해왔다. 조사해 보니 ComfyUI 공식(Comfy-Org)이 v0.35.0부터 YuE2를 네이티브로 지원(`comfy_extras/nodes_yue2.py`: `YuE2GenerateABC`/`YuE2GenerateMusic`/`EmptyYuE2LatentAudio`, 체크포인트는 표준 `CheckpointLoaderSimple`)하는 걸 확인해서, `backend/comfyui.mjs`를 새로 만들어 ComfyUI의 HTTP API(`/prompt` POST → `/history` 폴링 → `/view`로 결과 오디오 수신)로 연동했다. 워크플로우 그래프(`CheckpointLoaderSimple → YuE2GenerateMusic → ConditioningZeroOut(negative) → EmptyYuE2LatentAudio → KSampler(cfg=1.0, sampler=euler, scheduler=simple) → VAEDecodeAudio → SaveAudio`)는 소스 코드만으로는 KSampler의 negative/cfg나 디코드·저장 노드의 정확한 class_type을 확정할 수 없어서, 실제로 ComfyUI를 띄워 `/object_info`를 curl로 조회하고 최소 그래프를 직접 `/prompt`에 POST해 실제 오디오가 나오는 것까지 확인한 뒤에 코드를 작성했다.

사용자가 "ComfyUI는 이미 설치되어 있으니 새로 설치하지 말고 그걸 쓰라"고 지시해서, 이 머신에 있던 ComfyUI 두 곳(`C:\ComfyUI-Portable\ComfyUI-Rev0`은 YuE2 PR 병합 이전 커밋이라 `nodes_yue2.py`가 없었고, 자매 프로젝트 `C:\Claude\AudioAuK\engine\ComfyUI`는 이미 YuE2 지원 버전이 설치되어 있었음)를 확인해 후자를 재사용하기로 했다. 체크포인트 파일은 그 폴더의 `models/checkpoints/`에 하드링크로 연결(같은 드라이브라 3.96GB 중복 저장 없음, 심볼릭 링크는 관리자 권한이 필요해 실패해서 하드링크로 전환). `backend/server.mjs`의 `runComfyUi()`는 ComfyUI가 설정된 엔드포인트(기본 `127.0.0.1:8189`)에서 응답이 없으면 `comfyUiEnginePath`(기본값이 바로 그 AudioAuK 경로)의 `.venv\Scripts\python.exe main.py`를 온디맨드로 띄우고, 생성 완료 후에는 `POST /free`로 VRAM을 명시적으로 해제한다 — ComfyUI는 audio.cpp/Python과 달리 프로세스가 계속 떠서 모델을 VRAM에 남겨두기 때문에, 안 해주면 이후 `yue2-bf16`/`yue2-original`로 전환할 때 RTX 5070 12GB가 부족해질 수 있다. `YuE2GenerateMusic`이 `abc`가 빈 문자열이면 `mode`를 무시하고 내부적으로 "off"로 처리하는 것도 확인해서, cot=full/melody인데 사용자가 ABC를 직접 안 넣은 일반 케이스는 `runComfyUi`가 먼저 기존 `runPythonAction('plan', ...)`으로 심볼릭 작곡을 돌려 그 결과를 넘기도록 했다(다른 두 엔진과 동일한 동작 유지) — 즉 이 모델도 cot≠off일 때는 여전히 Python 엔진 설정이 필요하다.

실제 생성으로 4가지를 전부 확인했다: ①일반 노래 생성(40초 분량, 무음/클리핑 없는 정상 오디오) ②"악기만"(기존 mute-voice 메커니즘 그대로 재사용) ③ABC 심볼릭 작곡(이 기능은 애초에 모델과 무관하게 항상 Python 엔진으로 동작) ④커버(원곡 생성 → SheetSage2로 전사 → 새 가사/스타일로 같은 멜로디 재생성). 검증에 쓴 테스트 프로젝트/곡은 라이브러리에서 정리했다. `npm test`(새 mock 기반 테스트 포함 11개 전부 통과) + `npm run check` 확인. 문서(`README.md`, `docs/local-api.md`, `docs/models.md`, `AGENTS.md`, `progress.md`, 신규 `docs/comfyui-setup.md`) 및 memory-bank 갱신.

## Mastering-1의 masterVolume을 146→103으로 재보정 (2026-09-15)

DistroKid-Like2(현재 Mastering-1)를 만들 때 masterVolume/dynamicBoost를 "메이크업 게인 공식(1+dynamicBoost/100*0.4)의 정적 수치"만으로 역산했는데, 이게 틀렸다. 먼저 이 값들을 검증하려고 ffmpeg `acompressor` 필터로 앱의 실제 처리를 흉내 내 오디오를 렌더링했는데, ffmpeg의 컴프레서가 Web Audio `DynamicsCompressorNode`와 전혀 다르게 동작해서(같은 파라미터인데도 마스터링인데 오히려 원곡보다 조용해짐, 최대 -8.5dB까지 떨어짐) 완전히 잘못된 비교 파일을 사용자에게 전달하는 실수를 했다.

Playwright로 브라우저의 실제 `OfflineAudioContext`+`buildProcessingGraph`(앱 코드 그대로)를 돌려 재검증한 결과, `DynamicsCompressorNode`는 정적 메이크업 게인 수치보다 훨씬 크게 평균 레벨을 끌어올린다(지속적으로 프로그램 신호를 압축하면서 조용한 구간을 문턱값 쪽으로 밀어올리는 실제 동적 효과 때문) — masterVolume=146일 때 목표는 +3.77dB였는데 실측은 +7.37dB(같은 30초 클립 기준 실제 LANDR 마스터링은 +3.84~4.27dB)로 거의 2배 더 세게 걸리고 있었다. masterVolume 후보 여러 개를 브라우저에서 직접 렌더링해 실측 비교한 결과 **103**이 실측 목표(+3.84dB)와 가장 근접(+3.73~4.34dB)해서 이 값으로 수정. dynamicBoost(압축비)는 정적으로 예측 불가능한 비선형 요소라 masterVolume처럼 정밀 보정하지 않고 "느낌상 완화" 목적의 근사값(14, 비율 2.54:1)으로 유지.

교훈: **다른 엔진/도구(ffmpeg)로 Web Audio 노드의 동작을 근사하려 하지 말 것** — 같은 이름의 파라미터(threshold, ratio, makeup)라도 구현이 다르면 결과가 완전히 달라질 수 있다. 이후로는 항상 Playwright로 앱이 실제로 쓰는 `OfflineAudioContext` 코드를 그대로 실행해서 검증.

## `db69f10` — Rebuild DistroKid-Like as DistroKid-Like2 from a 10-song sample (2026-09-15)

기존 "DistroKid-Like" 프리셋은 LANDR 전/후 곡 2개만 보고 만든 것인데, 사용자가 실제로 써보고 "너무 과하게 걸린다"고 지적했다. `F:\Music\Music-DistroKid`(마스터링 전, K00xxx)와 `F:\Music\Music-Mastered`(마스터링 후)에서 실제 짝이 존재하는 10곡(0001,0004,0008,0012,0016,0019,0022,0027,0031,0035)을 골라 FFT 대역별 RMS·`ffmpeg loudnorm`·M/S 비율로 재측정했다. 처음엔 K00 원본 폴더가 0040~0062만 있고 Mastered 폴더는 0001~0037만 있어 번호가 아예 안 겹쳤는데(사용자가 `F:\Music\Music-DistroKid` 위치를 알려줘서 해결), 그 폴더에 0001~0039 원본이 K00 이름 그대로 있어서 진짜 같은 곡 짝을 구했다.

측정 결과, 기존 프리셋의 EQ는 "과한" 원인이 아니었다 — 10밴드 peaking 필터를 실제로 캐스케이드시켜(RBJ biquad 전달함수 직접 계산, 각 밴드가 서로 겹쳐 영향을 주는 것까지 반영) 실효 dB를 구해보니, 모든 대역에서 오히려 실측 마스터링 커브보다 **낮았다**(저음 31/62/125Hz는 거의 안 올랐는데 실측은 +3.8~4.9dB, 중음은 과하게 깎여 있었음). 진짜 원인은 압축비(다이내믹 부스트 35 → 4.85:1, 꽤 강한 수준)와 전체 볼륨(측정된 평균 라우드니스 증가 +3.77LU보다 약 0.9dB 더 크게 걸려 있던 것)이었다.

DistroKid-Like2는: ① EQ는 10곡 평균 커브의 70% 강도로 새로 계산(캐스케이드 간섭을 고려한 반복 보정으로 해(solve), 단일 값 대입이 아님) — 결과적으로 저음이 새로 생기고 중음 스쿱이 줄었지만 고음은 거의 그대로(원래도 부족했으니까). ② 압축비 2.54:1로 대폭 완화(다이내믹 부스트 35→14). ③ 전체 볼륨을 실측 +3.77LU에 정확히 맞춤(150→146). ④ 스테레오 확장도 10곡 평균(+1.79dB)으로 갱신(-52→-41). `Setting/EQ-preset/`, `Setting/PostProcess/`에 새 프리셋으로 저장(기존 DistroKid-Like는 그대로 둠). `test/preset-compare/`에 같은 곡(K0001-1)으로 원본·기존 프리셋·새 프리셋·실제 LANDR 마스터링 결과 4개를 렌더링해 직접 비교청취하도록 남겨둠(`test/`는 `.gitignore` 대상이라 커밋에는 없음).

## `1d42acd` — Add STEM separation feature with two modes, then swap to Mel-Band RoFormer (2026-09-15)

완성곡 메뉴에 "STEM 분리" 다이얼로그 추가. HTDemucs(보컬/드럼/베이스/기타 4갈래, 매우 빠름, 엔진이 고품질 "bag" 앙상블을 지원 안 해서 단일 체크포인트만 사용) 또는 보컬/악기 2갈래 분리 중 선택. 각 스템은 기존 `PostProcessDialog`를 `sourceOverride`/`onSaveOverride`로 재사용해 개별 EQ/FX 처리하고, `OfflineAudioContext`로 합친 뒤 기존 후처리 저장 엔드포인트로 저장. 스템 파일은 임시로 `runs/:id/stems/`에만 있다가 다이얼로그를 닫으면 지워짐.

2갈래 모드는 처음에 BS-RoFormer로 시작했는데, 사용자가 직접 들어보고 보컬이 실제로 많이 잘린다고 지적. `num_overlap`을 4→8로 올려 실측했지만 파형 코사인 유사도 0.9996으로 거의 차이가 없어(청크 경계 크로스페이드가 원인이 아님을 확인) 다른 원인을 찾다가, `model_specs/`에 같은 런타임을 쓰는 세 번째 RoFormer 패밀리 `mel_band_roformer`가 있는 걸 발견(다른 체크포인트, Q8_0/F16 두 정밀도 제공). F16을 받아 BS-RoFormer와 A/B 비교(코사인 0.97 — 실제로 다른 결과)했고 사용자가 직접 듣고 mel_band_roformer를 선호해서 2갈래 모드의 기본 모델을 교체. 이제 안 쓰는 BS-RoFormer 모델 파일과 다운로드 설정은 제거.

다이얼로그의 재생 컨트롤을 만들다가 버그 두 개도 발견해서 같이 고침: 재생 중 다른 파트를 클릭하면 이어서 재생돼야 하는데 처음부터 다시 재생되던 것(공유 재생 위치 대신 활성 파트가 바뀔 때만 위치를 리셋하던 로직), 그리고 재생 위치 하이라이트가 현재 소리 나는 파트에만 표시되고 나머지 파트(원곡/미리듣기/보컬/악기)는 같은 타임라인인데도 안 움직이던 것(모든 행에 공통으로 `playedFraction`을 넘기도록 수정, 실제로 소리 나는 파트를 가리키는 테두리 강조만 분리 유지).

## `7eab876` — Add start.bat/stop.bat for reliable dev server restarts (2026-09-15)

`start-studio.mjs`가 포트 4311에 이미 떠 있는 백엔드를 발견하면 그냥 재사용하는 구조라서(`Start-SongYUE2.cmd`도 동일), 백엔드 코드를 고치고 `npm run dev`를 다시 실행해도 예전 프로세스가 계속 응답하는 문제를 STEM 모델 교체를 재검증하다가 실제로 겪었다. `start.bat`은 실행 전 4311/5173 포트를 먼저 정리하고 `stop.bat`은 그 두 포트만 정리한다.

## `8cc3a31` — Make surround/clarity/bassBoost post-process knobs bidirectional (2026-09-14)

후처리/EQ 스튜디오의 "서라운드 사운드"/"선명도"/"베이스 부스트" 세 노브가 내부적으로 쓰는 크로스피드·쉘프 필터 공식은 원래부터 음수 계수를 받아도 수학적으로 문제가 없었는데, UI가 0~100으로만 막아뒀던 것을 확인해 `-100~100`으로 열었다. 서라운드는 `L_out=L+aR, R_out=R+aL` 형태의 크로스피드라 `a`가 양수면 좌우를 섞어 모노에 가깝게(좁힘), 음수면 반대로 Side 성분이 `(1+|a|)`배, Mid 성분이 `(1-|a|)`배가 되는 진짜 M/S 와이드닝이 된다는 걸 수식으로 확인 후 반영. 선명도(6kHz~ 하이쉘프)·베이스 부스트(150Hz 이하 로우쉘프)도 같은 이유로 음수 쪽을 열면 "깎기" 방향이 추가로 생긴다. 다이내믹 부스트(컴프레서 비율 공식이 음수에서 1 미만이 되어 무효)·공간감(우측 채널 전용 딜레이라 음수 딜레이가 무효)·리버브/에코·전체 볼륨은 같은 방식으로 열 수 없음을 확인하고 그대로 둠.

사용자가 실제로 구매한 LANDR 마스터링 전/후 곡 2곡(`F:\Music\Music-원본`, `F:\Music\Music-LANDR-Mastered`)을 `ffmpeg loudnorm`/대역별 `astats`로 분석해 **"DistroKid-Like" EQ·전체 후처리 프리셋**을 만들어 `Setting/EQ-preset/`, `Setting/PostProcess/`에 저장. 두 곡에서 일관되게 확인된 것: 라우드니스 +3.7~3.9 LU, 트루피크가 0dBTP 근처까지 리미팅, 중간 정도의 다이내믹 압축, 4kHz~16kHz를 +7~8dB 부스트하는 "밝은" EQ 틸트, Mid 대비 Side 성분이 약 +2.3dB 커지는 스테레오 와이드닝. 이 마지막 수치를 프리셋에 반영하려다 서라운드 노브가 음수를 막고 있는 걸 발견한 게 이 커밋의 계기. 리버브/에코/선명도/베이스부스트는 LANDR 처리에서 측정 근거를 못 찾아 프리셋 값은 0으로 둠(추정 아님, 미측정).

이 세션에서 먼저 audio.cpp의 GGUF "악기만" 기능(0xShug0/audio.cpp 관련 커뮤니티 제보를 계기로 재검토)이 CUDA 12.8/13.3 두 빌드 모두에서 여전히 보컬을 완전히 억제하지 못함을 실측(사용자 직접 청취)으로 재확인했고 — `[Lyrics]` 텍스트가 ABC 상태와 무관하게 항상 조건부여로 들어가는 게 원인 후보, 엔진이 빈 가사를 구조적으로 거부(`request.cpp:154`)해 우회 불가 — 반면 ABC 멜로디를 그대로 따라 부르는 "커버" 경로는 SheetSage2 역전사로 정확도가 확인됨. 이 조사는 코드 변경 없이 보류 상태로 남겨둠(다른 사람도 같은 문제를 조사 중이라 사용자가 대기 요청).

**`audiosr` 테스트 완료 — 이 용도엔 부적합.** 리마스터링 가능성을 보려고 `audiosr`(오디오 초해상도, 6.18GB GGUF)까지 받아 빌드하고 YuE2로 만든 실제 완성곡 20초 클립에 돌려봤다. 결과: ① **스테레오를 모노로 바꿔버림**(48kHz stereo 입력 → 48kHz mono 출력, 모델 자체 한계로 우회 불가). ② 라우드니스(-22.24→-22.29 LU)·트루피크·대역별 RMS(31Hz~2kHz 오차 ±0.06dB, 4~8kHz -0.6~-1.15dB, 16kHz +0.5dB)가 전부 오차 범위 — 사실상 아무것도 안 바뀜. 사용자 직접 청취로도 "거의 차이 없음" 확인. 원인은 명확함 — `audiosr`은 저비트레이트·손실 압축 등으로 **실제로 디테일이 소실된** 오디오를 복원하는 초해상도 모델인데, YuE2 출력은 이미 48kHz 무손실이라 복원할 게 없었던 것. LANDR 프리셋 작업 때 확인한 "밝은 EQ 틸트 +7~8dB, 라우드니스 +3.7~3.9 LU" 같은 마스터링 특유의 변화와는 완전히 다른 종류의 도구임이 실측으로 확인됨 — **완성곡을 상업 마스터링 서비스 수준으로 다듬는 용도로는 audiosr 대신 EQ 스튜디오(+ DistroKid-Like류 프리셋)를 쓰는 게 맞다.** 테스트 후 모델 파일(`models/audio-cpp/AudioSR-GGUF/`)과 `audiosr`을 포함해 다시 빌드했던 `audiocpp_cli`는 삭제하고, yue2 전용으로 재빌드해 원상 복구함(`models/`, `engine/`는 둘 다 `.gitignore` 대상이라 이 정리는 git 이력에 남지 않음).

## `87c4348` — Add a "커버" (cover) action to each completed song's menu (2026-09-13)

완성곡 메뉴의 "리믹스" 바로 아래 "커버" 항목 신설 — 그 곡의 오디오를 SheetSage2로 전사해 멜로디/코드 ABC를 뽑아 작곡 화면에 채워 넣는다. 활성화 조건은 그 곡을 만든 모델이 아니라 **현재 작곡 화면에 선택된 모델**이 원본인지 여부(사용자 지적으로 초안의 "그 곡의 모델" 기준 구현을 수정) — SheetSage2 전사는 오디오 출처 엔진과 무관하지만, 결과 ABC를 실제로 쓰는 건 지금 선택된 모델이기 때문. 작곡 화면에 이미 가사/스타일이 있으면 유지할지 그 곡 설정으로 바꿀지 확인 대화상자를 띄우며, 어느 쪽이든 modelId는 건드리지 않는다. Suno류와 달리 실제 보컬 음색/톤은 가져오지 않음(YuE2 파이프라인에 참조 오디오 화자 임베딩 입력 자체가 없음) — `progress.md`에 한계로 기록.

## `a1d2439` — Add a linear waveform visualizer to the main player bar (2026-09-13)

후처리 다이얼로그의 원형 비주얼라이저를 하단 전역 재생바(왼쪽 트랜스포트~오른쪽 볼륨 사이)에 일직선으로 펼쳐서 추가 — 같은 설정값과 같은 점별 계산식을 쓰고, 0~360도 원형 좌표를 x=0..width 직선 좌표로 바꾸는 매핑만 다르다. 전역 `<audio>` 엘리먼트에는 원래 Web Audio 그래프가 없어 `AnalyserNode`를 새로 하나 붙였고, `createMediaElementSource`가 엘리먼트당 평생 한 번만 가능하다는 제약 때문에 첫 재생 시 한 번만 생성해 세션 내내 재사용.

## `c778253` — Extend the now-playing card highlight to the playlist detail view (2026-09-13)

## `7ca7006` — Highlight the card of the song currently playing in 내 작업/라이브러리 (2026-09-13)

재생 중인 곡의 카드에 초록 테두리+글로우 강조 추가(후처리 다이얼로그의 재생 중 파형 강조와 같은 스타일). `내 작업`/`홈`/`프로젝트`/`내 라이브러리`/`좋아요`는 공용 `projectList()`를 통해 한 번에 해결되었고, 별도 렌더링 코드를 쓰는 재생목록 상세 화면만 뒤이어 따로 추가.

## `f5332f6` — Document the GGUF+ABC restriction and backfill revision.md history (2026-09-13)

`docs/local-api.md`/`README.md`에 ABC 기반 생성(심볼릭 작곡/커버)이 원본 모델 전용이라는 제약을 문서화. 실제로는 여러 커밋이 있었지만 갱신되지 않았던 `revision.md`의 이력을 `841641d` 이후 전부 다시 채움.

## `4fed156` — Disable ABC-driven generation (symbolic plan/cover) on GGUF models (2026-09-13)

`runAudioCpp()`는 애초에 `--abc-file` 인자를 지원한 적이 없어, GGUF 모델을 선택한 채 ABC 악보(심볼릭 작곡이든 SheetSage2 "오디오에서 추출" 커버 결과든)를 채우고 생성하면 조용히 무시되고 가사/스타일만으로 생성되는 함정이 있었음. "심볼릭 작곡"/"오디오에서 추출" 버튼을 GGUF 선택 시 비활성화하고 안내 문구를 추가, `/api/generate`에도 GGUF+비어있지 않은 ABC 조합을 명확한 오류로 거부하는 보루를 추가.

## `bec5aad` — Fix SheetSage2 cover-transcribe directory collision; verify end-to-end (2026-09-12)

`runTranscribe()`가 출력 폴더를 미리 만들어(`mkdir`) `transcribe.py`의 안전장치(`fresh_directory()`, `exist_ok=False`)와 항상 충돌해 즉시 실패하던 버그 수정 — 부모 폴더만 미리 만들도록 변경. 실제 완성곡 오디오로 `/api/cover-transcribe` 종단 테스트 성공, 결과 ABC가 `abc_tools.py inspect` 구조 검증도 통과. 과정에서 로컬 `models/m-a-p/SheetSage2/config.json`의 `weights_format` 오기(`adapter`→`merged`)도 함께 발견해 수정(모델 폴더는 `.gitignore`라 저장소에는 안 남고 `docs/models.md`에 기록).

## `4be5312` — Disable "악기만" entirely for GGUF models instead of just warning (2026-09-12)

GGUF는 "악기만"을 구조적으로 보장할 수 없어 소프트 스타일 힌트로만 허용해 왔던 것을, 만들기 화면에서 버튼 자체를 비활성화하도록 변경. 직접 토글뿐 아니라 프로젝트 리믹스 로드(`loadProject()`)와 localStorage 초안 복원 경로에서도 `instrumental` 값이 비-Python 모델에 stuck되지 않도록 정리 — 세 경로 모두 Playwright로 검증.

## `6f94640` — Add a seek/position slider below the post-process waveforms (2026-09-12)

후처리/EQ 다이얼로그의 원본·처리 결과 파형 아래에 재생 위치를 보여주고 이동할 수 있는 슬라이더 추가(기존 Web Audio 재생 상태를 재사용하는 `seekTo(seconds)` 신설). 전송 바의 볼륨 아이콘도 속도 컨트롤과의 간격을 위해 약간 오른쪽으로 이동.

## 원형 비주얼라이저 전면 설정화 (11개 커밋, 2026-09-12)

`d8c597b`부터 `52fb4d4`까지, 후처리 다이얼로그의 원형 라이브 비주얼라이저에 하드코딩되어 있던 상수를 사용자가 조정 가능한 설정으로 하나씩 옮기고, 그 과정에서 발견된 시각적 버그를 함께 고침:

- 라인 굵기(`d8c597b`), 잔상/afterimage(`1153411`) 설정 추가.
- 잔상이 배경을 검게 물들이던 버그를 `destination-out` 합성으로 수정, 나선(spiral) 정도 설정 추가(`862ce22`).
- 링마다 같은 프레임을 다른 위상으로 읽는 회전(radial) 모드 외에, 링마다 과거의 다른 프레임을 읽는 시간축(time) 모드 신설(`befb6d1`).
- 항상 0으로 죽어 있던 최상단 주파수 빈과 항상 포화된 최하단 빈을 원 매핑에서 제외(`4cae637`).
- 시간축 모드에 고정 반지름 + 초 단위 시간 간격/가속도(가속도=지수) 설정 추가, 회전 모드의 링 간격도 설정화, 고주파 제외 폭을 25%→35%로 확대(`087a24a`).
- 캔버스의 HTML 해상도와 실제 CSS 박스 크기가 어긋나 원이 타원으로 찌그러지던 버그 수정(`705570c`).
- 변동폭(진폭)을 설정으로 노출(`041db60`), 이후 양방향(줄어듦 포함)으로 개선하고 기본값을 2로 상향(`115ef38`), 줄어드는 쪽은 늘어나는 쪽의 절반 강도로 비대칭 처리(`741ff69`).
- 마지막 점과 첫 점을 잇던 이상한 연결선을 없애고 열린 곡선으로 변경(`52fb4d4`).

## `a73f190` — Triple the height of the lyrics/style suggestion edit textarea (2026-09-12)

AI 제안을 적용 전에 편집하는 다이얼로그의 텍스트영역이 공용 최소 높이(90px)로는 너무 좁아, 전용 클래스로 분리해 세 배로 키움(프로젝트 메모 텍스트영역은 영향 없음).

## `5683fd5` — Update progress.md: SheetSage2 venv is set up, only e2e transcribe test remains (2026-09-12)

진행 상황 문서만 갱신(venv 준비 완료, 남은 것은 실기 종단 테스트뿐이라는 상태 반영).

## `c82248c` — Fix recent-projects sidebar leak, add visualizer settings, UI cleanup (2026-09-12)

사이드바 "최근 프로젝트"가 필터링 없는 전체 프로젝트 목록을 그대로 써서, 방금 완성한 곡이 프로젝트로 잘못 표시되던 버그 수정(초안만 보이도록 제한). 설정 화면에 비주얼라이저 켬/끔·링 개수·색조 설정 섹션 신설, 후처리 다이얼로그의 하드코딩 상수를 이 설정과 연결. 그 외: 사이드바/작곡 화면의 중복 라벨 제거, AI 제안 다이얼로그에 편집 토글 추가, 카드 뷰에 곡 길이(MM:SS, Orbitron) 표시.

## `ccde9ca` — Re-verify low-priority ideas in the browser, drop combined reset button (2026-09-12)

Playwright로 재확인한 결과 비주얼라이저 커스터마이즈와 프리셋 내보내기/가져오기는 여전히 미구현으로 확인. "전체 초기화" 버튼은 이미 EQ/FX/리버브·에코 개별 초기화 버튼 세 개로 구현되어 있어, 통합 버튼을 추가하지 않고 의도된 설계로 확정.

## `841641d` — Fix instrumental vocal-muting to preserve harmony, overhaul API docs (2026-09-12)

"악기만" 생성 경로가 쓰던 `abc_tools.py strip-chords --keep-voice Ins`는 전체 악보의 화음 기호까지 지워버렸음 — native 방언에서 화음 기호는 오직 Vocal에만, 쉬는 동안에도 존재해야 화성이 오케스트라에 전달되는데 그 신호를 잃게 됨. 화음 기호는 건드리지 않고 선택하지 않은 성부의 음표만 쉼표로 바꾸는 `mute-voice` 명령을 신설해 전환. `docs/local-api.md`의 엔드포인트 표도 실제 코드 기준으로 전면 재작성(재생목록·프로젝트 커버·심볼릭 ABC 관련 엔드포인트 대부분이 미문서화 상태였음), `docs/models.md`의 SheetSage2 상태도 갱신.

## `369caf3` — Enlarge and simplify the sidebar by-line (2026-09-12)

사이드바 태그라인을 "(by madwind)"에서 괄호를 뺀 "by madwind"로 단순화하고, 로고 텍스트와 비슷한 크기로 폰트 크기를 키움.

## `c799927` — Replace sidebar tagline with a by-line (2026-09-12)

사이드바 로고 아래의 "나만의 음악 작업실" 태그라인을 저작자 표시 "(by madwind)"로 교체.

## `e56c304` — Add post-processing/EQ studio and structural instrumental generation (2026-09-12)

**"악기만" 실제 구현으로 재작업**

- 직전 커밋(`89c5406`)에서 시도한 "가사 비우기" 방식을 되돌림 — audio.cpp/공식 Python 엔진 둘 다 빈 가사를 하드 거부(`Yue2 requires non-empty lyrics`)한다는 것을 소스에서 확인.
- 대신 원본 Python 엔진(`yue2-original`) 한정으로 `abc_tools.py strip-chords --keep-voice Ins`를 사용해 ABC 악보의 Vocal 성부를 쉼표로 구조적으로 치환한 뒤 생성하는 방식으로 재구현. 기존 ABC 악보가 없으면 자동으로 `plan`부터 실행. 사용자가 실제 보컬 멜로디가 있는 악보를 물려도 정상 동작함을 전용 테스트로 확인.
- GGUF 계열(Q4/Q8/BF16)은 이 구조적 방식을 쓸 수 없어 여전히 소프트 스타일 힌트(`instrumental, no vocals`)만 제공 — UI에 모델별로 다른 안내 문구 표시.

**완성곡 후처리 / EQ 스튜디오 신규**

- 완성곡 "⋯" 메뉴에 "후처리 / EQ" 추가. 10밴드 EQ(31Hz~16kHz, ±100, 프리셋 6종 + 사용자 프리셋), FxSound 노브 5개(선명도/공간감/서라운드/다이내믹부스트/베이스부스트), 리버브·에코 노브 4개, 전체 볼륨 노브, 섹션별 on/off + 초기화 버튼.
- 처리 방식은 브라우저 내 실시간 미리듣기(Web Audio API) — `buildProcessingGraph()`가 `AudioContext`(라이브 재생)와 `OfflineAudioContext`(파라미터 변경 시 디바운스 재렌더링) 양쪽에서 재사용됨.
- 재생 UI: 원본/처리 결과를 같은 재생 위치를 공유하며 전환하는 A/B 청취, 뒤로/앞으로/속도/미리듣기 볼륨 트랜스포트, 현재 재생 중인 트랙의 박스를 색상으로 강조.
- `AnalyserNode`로 실제 재생 중인 오디오의 주파수 데이터를 읽어 그리는 원형 라이브 비주얼라이저(부드러운 다중 라인, 재생 중이 아닐 때는 "SOUND / FX" 워드마크로 대체).
- 저장 시 처리된 오디오를 WAV로 인코딩해 `POST /api/projects/:id/post-process`로 전송 → ffmpeg로 원본과 동일한 파일 형식으로 재인코딩 → `showSaveFilePicker`(미지원 시 다운로드 폴백)로 `{원본}-modified.{원본확장자}` 저장. 원본 파일은 절대 변경되지 않음.
- EQ 프리셋(`GET/POST/DELETE /api/eq-presets`)과 전체 후처리 설정 프리셋(`GET/POST/DELETE /api/postprocess-settings`)을 이름으로 저장·목록·삭제. 저장 위치는 `library/`가 아닌 별도 `Setting/EQ-preset/`, `Setting/PostProcess/` — `library/setting`에 그냥 저장하면 초안 스캐너가 이를 깨진 프로젝트로 오인하기 때문에 의도적으로 분리.
- 백엔드 테스트 스위트에 위 두 엔드포인트의 저장 위치·검증·삭제 케이스 추가(8개 스위트 전체 통과).

## `89c5406` — Make instrumental mode actually withhold vocals (2026-09-12)

가사를 비워서 보컬을 없애려던 첫 시도. 이후 "Unreleased" 항목에서 구조적 방식(ABC 성부 치환)으로 대체됨 — 실제로는 audio.cpp/Python 엔진 모두 빈 가사를 거부해서 동작하지 않았음. 테스트 목(mock)의 ffmpeg `-y` 플래그 처리 버그도 함께 수정.

## `35b7d1d` — Add symbolic ABC composition, editing, and zero-shot cover plumbing (2026-09-12)

- 심볼릭 작곡(ABC) plan/generate/check와 라이브러리 페이지, abcjs 기반 오디오 재생(재생/일시정지/탐색/속도/볼륨, 현재 음표 하이라이트+자동스크롤), LLM 지시 기반 AI 편집 플로우.
- "보컬+악기"/"악기만" 토글(이 시점에는 가사를 유지한 채 보컬만 억제하려는 첫 버전).
- 음악 스타일 프리셋, ABC 라이브러리 카드 커버 아트, SheetSage2 제로샷 커버용 설정 필드 + `/api/cover-transcribe` 엔드포인트 배관(모델/venv 설치는 사용자 몫으로 남김).
- 공식 Python 파이프라인을 12GB GPU(RTX 5070)에서 실측 검증, 백엔드가 `examples/generate.py` 대신 `skills/yue2-music/scripts/run_yue2.py`를 호출하도록 전환. 다이얼로그 스크롤이 재생 컨트롤을 가두는 버그, ABC 카드 색상이 CSS 명시도 문제로 초록색이 되는 버그, 삭제 확인 문구 버그 수정.

## `3fecc3d` — Remove Suno reference from README intro (2026-09-12)

README 도입부에서 Suno 직접 언급을 제거.

## `e5e6331` — Add README with project intro and install instructions (2026-09-12)

프로젝트 소개, 주요 기능, 설치 방법을 담은 최초 README 추가.

## `a77af9f` — Initial commit: SongYUE2 local music studio (2026-09-12)

YuE2(audio.cpp GGUF + 공식 Python 파이프라인)를 감싸는 로컬 웹 앱 최초 커밋. Suno에서 영감을 받은 라이브러리/프로젝트/재생목록/커버/다운로드 UI, Electron 스타일 로컬 실행 구조.
