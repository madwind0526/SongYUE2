# YuE2 모델 보관 및 재다운로드

실제 다운로드 상태는 프로젝트 루트의 `model-download-status.json`에 기록됩니다. `complete`인 파일만 크기 및 SHA-256 검증을 통과했습니다. `models/` 안의 `.part` 파일은 다운로드 중이며 설치 완료로 취급하지 않습니다.

**2026-09-12 03:41:57 KST: 46개 파일, 23,314,925,299 바이트 다운로드 및 SHA-256 검증 완료.** 공식 main/VAE/legacy VAE와 GGUF Q4/Q8/BF16/F16 VAE/F32 VAE가 모두 포함됩니다. Windows Defender 실시간 보호 활성 상태에서 다운로드했고, 공식 main의 Python 코드 및 wheel이 들어 있는 폴더를 사용자 지정 검사했습니다. 검사 명령은 정상 종료했고 이후 위협 탐지 조회 결과는 없었습니다. 이 검사는 모델 추론이나 코드 안전성의 완전한 보증은 아닙니다.

```powershell
python scripts/download_models.py
```

Python 표준 라이브러리만 사용합니다. 중단 후 같은 명령을 실행하면 부분 파일부터 이어 받고, 완성된 파일은 해시를 검증한 후 건너뜁니다. 한 번에 세 파일을 전송합니다. 모델 저장소의 리비전을 고정하고 LFS SHA-256과 대조합니다. 작은 비 LFS 파일도 다운로드한 SHA-256을 기록합니다.

총 다운로드 대상은 **23,314,925,299 바이트 (약 23.31 GB / 21.71 GiB)** 입니다. 모델과 구성 파일, 토크나이저, 모델 코드, 최신 추론 패키지 wheel, 라이선스 문서를 포함합니다. 데모 음원·영상·홍보 이미지, 이전 wheel, 별도 MERT/SheetSage 모델은 제외합니다.

| 저장소 | 고정 리비전 | 로컬 폴더 |
|---|---|---|
| [공식 YuE2-3B](https://huggingface.co/m-a-p/YuE2-3B) | `29b3558dd46954a0cd9021dc76d5c91864a0f1c7` | `models/m-a-p/YuE2-3B` |
| [공식 VAE](https://huggingface.co/m-a-p/YuE2-Vae) | `9a94e1d0ea9f8087e98f77fa88df4a4068104d2a` | `models/m-a-p/YuE2-Vae` |
| [공식 레거시 VAE](https://huggingface.co/m-a-p/YuE2-Vae-legacy) | `5ddd12f79acb90d24b3a672dcd2ebf88da7c92a9` | `models/m-a-p/YuE2-Vae-legacy` |
| [audio.cpp GGUF](https://huggingface.co/audio-cpp/Yue2-3B-GGUF) | `9c31f1c64f73d36799693aa89295b410c76928c3` | `models/audio-cpp/Yue2-3B-GGUF` |

GGUF 폴더에는 BF16, Q8_0, Q4_0 본체와 F16/F32 VAE 및 `sidecars/`가 있습니다. RTX 5070 12 GB에서는 Q4_0 + F16 VAE를 우선 검증합니다. 공식 PyTorch 경로는 상위 사양 PC 및 추후 배포를 위해 함께 보관하며, 다운로드 완료가 추론 검증 완료를 의미하지는 않습니다. wheel과 모델 Python 코드는 다운로드만 하며 자동 설치·실행하지 않습니다.

공식 가중치 라이선스는 **CC BY-NC 4.0**입니다. 각 원본 저장소의 `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/`를 보존했습니다. GGUF 저장소는 README에 라이선스를 표시하지만 별도 LICENSE 파일은 제공하지 않습니다. 배포 시 모델 용량 및 라이선스를 고려해 앱 설치 파일과 모델 다운로드를 분리할 수 있습니다.

상태 JSON은 전체 및 저장소별 총 바이트·완료 바이트와 파일별 경로·크기·해시·상태를 포함합니다. 프론트엔드는 실제 파일 상태와 존재 여부를 바탕으로 다운로드 완료를 표시해야 합니다.
