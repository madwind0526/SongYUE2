# SongYUE2 Codex Handoff

Date: 2026-09-12

## Goal

Build a local YuE2/Yue2 music generation studio that can run lightweight/quantized music models as they become available. The immediate practical target is Yue2 GGUF through audio.cpp.

## Background

The user is interested in YuE2/Yue2 as a local alternative to Suno-style AI music generation. The official YuE2 Python pipeline is powerful but heavy. It is intended for Linux/Python with NVIDIA GPU resources and is not the best first target for a 12 GB Windows desktop machine.

A more practical route has appeared: Hugging Face hosts an audio.cpp-native Yue2 GGUF package with Q4 and Q8 variants. This makes a local Windows app more realistic if the app wraps audio.cpp rather than the official Python pipeline.

## Key Research Findings

- Official YuE2 repository:
  - https://github.com/multimodal-art-projection/YuE
- Official YuE2 HF model:
  - https://huggingface.co/m-a-p/YuE2-3B
- GGUF/quantized model:
  - https://huggingface.co/audio-cpp/Yue2-3B-GGUF
- audio.cpp runtime:
  - https://github.com/0xShug0/audio.cpp

### Yue2 GGUF Files

The HF GGUF package includes:

- `yue2-3b-bf16.gguf`
- `yue2-3b-q8_0.gguf`
- `yue2-3b-q4_0.gguf`
- `yue2-vae-f32.gguf`
- `yue2-vae-f16.gguf`

Reported model/package sizes and performance notes from the model page:

- Q4_0 main model: about 2.67 GB
- Q8_0 main model: about 4.26 GB
- BF16 main model: about 7.26 GB
- F16 VAE: about 265 MB
- F32 VAE: about 531 MB
- Q4_0 + F16 VAE reportedly peaked around 7.8 GB VRAM on RTX 5090 test
- Q8_0 + F16 VAE reportedly peaked around 8.9 GB VRAM
- BF16 + F32 VAE reportedly peaked around 12.5 GB VRAM

Given the user's RTX 5070 with around 12 GB VRAM, prioritize:

1. `yue2-3b-q4_0.gguf` + `yue2-vae-f16.gguf`
2. `yue2-3b-q8_0.gguf` + `yue2-vae-f16.gguf`
3. BF16 only as an experimental option

## Product Shape

Working title: SongYUE2 or Yue Studio.

Core idea:

- Suno-like creation workflow
- Local model launcher
- Project/version history
- Audio result comparison

This should not be a Suno clone. Use Suno as product inspiration only:

- create-first workspace
- simple/custom modes
- song cards
- generation history
- collapsible advanced controls
- one-click regenerate/variation flow

Avoid copying Suno branding, colors, exact layout, or visual identity.

## MVP Scope

### Create Screen

- Simple mode:
  - one prompt field
  - optional instrumental/vocal toggle
  - generate button

- Custom mode:
  - lyrics textarea
  - style prompt textarea
  - song title
  - language
  - seed
  - model precision: Q4, Q8, BF16
  - VAE: F16, F32
  - CoT mode: full, melody, off
  - inference steps
  - output directory

### Results

- Generated song cards
- Play/pause
- Filename and duration
- Model/seed/settings badges
- Open output folder
- Duplicate settings
- Regenerate with new seed
- Save notes

### Library

- Project list
- Search/filter by title, date, model, style
- Each song project should keep:
  - `request.json`
  - `lyrics.txt`
  - `style.txt`
  - `audio.wav` or `audio.flac`
  - `score.abc` when available
  - `settings.json`
  - logs

### Settings

- audio.cpp executable path
- model folder path
- default model/VAE
- default output folder
- LLM provider:
  - None
  - Ollama
  - OpenAI-compatible endpoint
  - later: LM Studio/OpenRouter

## LLM Position

The LLM should be optional. The user specifically noted that lyrics may be created externally and pasted in, so the app should not depend on an internal LLM.

LLM helper features can be added later:

- Generate lyrics draft
- Rewrite lyrics into verse/chorus sections
- Translate Korean lyrics to English or bilingual lyrics
- Refine style prompt
- Create alternate genre/style versions
- Generate Suno/YuE-style structured prompts

The core app must work with LLM set to "None".

## Technical Direction

Recommended implementation path:

1. Build UI and local project management first.
2. Implement a runner interface with a mock engine.
3. Add audio.cpp executable detection/config.
4. Download/select Yue2 GGUF models manually at first.
5. Add real audio.cpp command execution once the command is validated.
6. Capture stdout/stderr logs per generation.
7. Add progress and cancellation.

Suggested structure:

```text
C:\Claude\SongYUE2
  app\
  backend\
  data\
  models\
  runs\
  docs\
  AGENTS.md
  CODEX_HANDOFF.md
```

## Open Technical Questions

- Is audio.cpp already installed locally? If not, install/build or download a release.
- Does audio.cpp's Yue2 support require the `dev` branch or a newer release?
- What exact Windows command works for Q4_0 generation on the user's RTX 5070?
- Are CUDA build tools needed, or is there a prebuilt Windows binary?
- Should the app be web-based, Electron, Tauri, or Python/Gradio?

## Recommended First Build Plan

1. Create a minimal desktop/web app in `C:\Claude\SongYUE2`.
2. First version does not generate music; it creates a project folder and `request.json`.
3. Add a fake result card using a placeholder audio file or no audio.
4. Add Settings page for audio.cpp path and model paths.
5. Add a runner abstraction:
   - `MockRunner`
   - `AudioCppRunner`
6. Once audio.cpp command is confirmed, wire the real runner.

## UX Notes

- Korean UI text.
- Use concise, friendly labels.
- Hide advanced settings by default.
- Show VRAM risk hints:
  - Q4 recommended
  - Q8 experimental
  - BF16 may fail on 12 GB VRAM
- Make failure recoverable:
  - show "로그 보기"
  - show "설정 복사"
  - show "다시 시도"

## Licensing Note

YuE2 model weights and Yue2 GGUF are CC BY-NC 4.0. The app should display that generated usage may be non-commercial unless the user separately verifies licensing.

## Current Local Folder Contents

Observed files in `C:\Claude\SongYUE2` before this handoff:

- `KakaoTalk_20260910_232835314.png`
- `yue2-prompt-guide.zip`
- `YuE2-source.zip`

