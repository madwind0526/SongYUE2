// Adapter for the ComfyUI-backed 'yue2-int8-convrot' model. The graph below was built and
// verified against a real ComfyUI 0.35.0 instance (Comfy-Org/ComfyUI#16250's native YuE2
// support): CheckpointLoaderSimple -> YuE2GenerateMusic -> KSampler(cfg=1.0, negative is a
// zeroed-out copy of positive since YuE2 has no separate negative prompt) -> VAEDecodeAudio ->
// SaveAudio. cfg=1.0 makes the KSampler negative input a no-op by construction (result = positive),
// matching how other ComfyUI-native audio models (Stable Audio, ACE-Step) invoke KSampler.
export async function request(fetchImpl, endpoint, route, options = {}) {
  const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}${route}`, { ...options, signal: options.signal || AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`ComfyUI 요청 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

export async function comfyUiAlive(fetchImpl, endpoint) {
  try { const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}/system_stats`, { signal: AbortSignal.timeout(1500) }); return response.ok; }
  catch { return false; }
}

export function buildWorkflow({ checkpoint, style, lyrics, abc, seed, mode, maxDuration, steps, filenamePrefix }) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '2': { class_type: 'YuE2GenerateMusic', inputs: { clip: ['1', 1], style, lyrics, abc: abc || '', seed, mode, max_duration: maxDuration, temperature: 1.0, top_p: 0.95, top_k: 100, repetition_penalty: 1.2 } },
    '3': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['2', 0] } },
    '4': { class_type: 'EmptyYuE2LatentAudio', inputs: { seconds: ['2', 1], batch_size: 1 } },
    '5': { class_type: 'KSampler', inputs: { model: ['1', 0], seed, steps, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], denoise: 1.0 } },
    '6': { class_type: 'VAEDecodeAudio', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveAudio', inputs: { audio: ['6', 0], filename_prefix: filenamePrefix } },
  };
}

export async function execute(fetchImpl, endpoint, job) {
  const { deadlineMs, pollIntervalMs = 1200, clientId } = job;
  const prompt = buildWorkflow(job);
  const submitted = await request(fetchImpl, endpoint, '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: clientId }) });
  if (submitted.node_errors && Object.keys(submitted.node_errors).length) throw new Error(`ComfyUI 워크플로우 오류: ${JSON.stringify(submitted.node_errors).slice(0, 500)}`);
  if (!submitted.prompt_id) throw new Error('ComfyUI가 작업을 수락하지 않았습니다.');
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const history = await request(fetchImpl, endpoint, `/history/${submitted.prompt_id}`);
    const entry = history[submitted.prompt_id];
    if (entry?.status?.status_str === 'error') throw new Error(`ComfyUI 생성 실패: ${JSON.stringify(entry.status.messages).slice(0, 800)}`);
    const output = entry?.outputs?.['7']?.audio?.[0];
    if (output) {
      const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}/view?${new URLSearchParams(output)}`, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('ComfyUI 결과 파일을 받지 못했습니다.');
      const bytes = Buffer.from(await response.arrayBuffer());
      // ComfyUI keeps the model resident in VRAM after finishing (unlike our per-request
      // audio.cpp/Python subprocesses, which release VRAM on exit) -- free it so switching to
      // yue2-bf16/yue2-original right after doesn't fight this process for the RTX 5070's 12GB.
      await request(fetchImpl, endpoint, '/free', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {});
      return { bytes, filename: output.filename };
    }
    if (entry?.status?.completed) throw new Error('ComfyUI 작업이 종료되었지만 오디오 결과가 없습니다.');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error('ComfyUI 작업 제한 시간을 초과했습니다.');
}
