# SongYUE2 Project Instructions

This project is for building a local YuE2/Yue2 music generation studio.

## Product Direction

- Build a local music generation workstation inspired by Suno's creation workflow, not a clone of Suno branding or exact UI.
- The first screen should be the usable creation workspace, not a landing page.
- Core workflow: lyrics + style prompt + model settings -> generate -> save audio and artifacts -> compare versions.
- LLM support is optional and should help with lyrics/style only. The app must work when LLM is disabled.

## Target User

- Korean-speaking non-technical user.
- UI text should be Korean.
- Advanced settings should be hidden behind collapsible sections.
- Errors should explain what to do next in plain Korean.

## Preferred Architecture

- Frontend: desktop-friendly web UI or desktop app shell.
- Backend: local runner service that can call audio.cpp/Yue2 GGUF first.
- Keep model engines swappable:
  - audio.cpp + Yue2 GGUF
  - official Python YuE2 pipeline
  - cloud GPU runner
  - future lightweight YuE model
  - ComfyUI node/API runner (implemented for yue2-int8-convrot; see docs/comfyui-setup.md)
- Project data should be stored per song/version, with reproducible settings.

## UI Guidelines

- Use a Suno-like workflow structure:
  - left navigation: Library, Create, Projects, Settings
  - center composer: Simple and Custom creation modes
  - right or bottom panel: generation queue and result cards
- Do not copy Suno's logos, exact colors, exact layouts, or trade dress.
- Use dark studio styling, compact controls, and readable Korean labels.
- Include playback controls, generation history, seed/model badges, and output folder access.

## Engine Notes

- Current realistic local path is audio.cpp + Yue2 GGUF.
- Official PyTorch YuE2 is heavier and expects Linux/Python/GPU resources.
- The user's PC has an RTX 5070 with about 12 GB VRAM, so prioritize Q4_0 + F16 VAE.
- Avoid assuming generic llama.cpp, Ollama, or LM Studio can run Yue2 GGUF directly; Yue2 GGUF currently targets audio.cpp.

## LLM Notes

- LLM is optional.
- Supported provider design should allow:
  - None
  - Ollama
  - OpenAI-compatible local endpoint
  - LM Studio/OpenRouter later
- LLM features:
  - draft lyrics
  - restructure lyrics into sections
  - refine style prompt
  - translate/adapt lyrics
  - create variations

## Safety And Licensing

- Scan downloaded binaries/models when practical.
- Surface model license clearly in the app.
- YuE2 model weights and Yue2 GGUF follow CC BY-NC 4.0, so default assumption is non-commercial use.

