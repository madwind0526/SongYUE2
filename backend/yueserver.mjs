// Second song engine: Studio's yue-server (MIT, yue2.cpp fork) is used only for songs that apply LoRA/LoKr
// adapters, which audio.cpp cannot load. It is started on demand, asked for one song over its HTTP API
// (/synth -> /job), and stopped afterwards so its VRAM is free for the other tools.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const YUE_SERVER_PORT = 8189;
export const YUE_SERVER_MODEL = 'YuE2-3B-Q8_0.gguf';
export const YUE_SERVER_VAE = 'YuE2-Vae-F32.gguf';
const START_TIMEOUT_MS = 60 * 1000;

export function yueServerPaths(root) {
  return {
    exe: path.join(root, 'engine', 'yue-server', 'yue-server.exe'),
    model: path.join(root, 'models', 'yue-server', YUE_SERVER_MODEL),
    vae: path.join(root, 'models', 'yue-server', YUE_SERVER_VAE),
    adapters: path.join(root, 'models', 'yue-adapters'),
  };
}

const exists = (file) => stat(file).then(() => true, () => false);

// One adapter = one folder with an adapter_config.json and a .safetensors file. The AR (planning) adapters carry
// "ar": true in their config; the NAR (timbre) adapters do not.
export async function listAdapters(adapterDir) {
  const entries = await readdir(adapterDir, { withFileTypes: true }).catch(() => []);
  const adapters = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(adapterDir, entry.name);
    const files = await readdir(dir).catch(() => []);
    const weights = files.filter((name) => name.endsWith('.safetensors'));
    if (!weights.length) continue;
    let config = {};
    try { config = JSON.parse(await readFile(path.join(dir, 'adapter_config.json'), 'utf8')); } catch { /* config is optional */ }
    let bytes = 0;
    for (const name of weights) bytes += (await stat(path.join(dir, name))).size;
    let meta = null;
    try { meta = JSON.parse(await readFile(path.join(dir, 'songyue2-adapter.json'), 'utf8')); } catch { /* adapters copied by hand have no metadata */ }
    adapters.push({
      name: entry.name,
      displayName: meta?.displayName || entry.name,
      kind: meta?.kind || '', trigger: meta?.trigger || '', tip: meta?.tip || '', scales: meta?.scales || { ar: 1, nar: 1 },
      description: meta?.description || '',
      categories: meta?.categories || [], tags: meta?.tags || [], languages: meta?.languages || [],
      license: meta?.license || '', commercialUse: meta?.commercialUse ?? null,
      source: meta?.source || null, samples: meta?.samples || [], note: meta?.note || '', verified: meta?.verified || null,
      installedAt: meta?.installedAt || '',
      stage: meta?.verified?.ar && meta?.verified?.nar ? 'both' : meta?.verified ? (meta.verified.ar ? 'ar' : 'nar') : (meta?.stage && meta.stage !== 'unknown' ? meta.stage : config.ar === true ? 'ar' : 'nar'),
      rank: Number.isFinite(config.rank) ? config.rank : null,
      bytes,
      baseModel: typeof config.base_model === 'string' ? config.base_model : '',
    });
  }
  return adapters.sort((a, b) => a.name.localeCompare(b.name));
}

// The request's adapters: [{ name, arScale, narScale }] limited to installed adapters, strengths 0..100 (any value >= 0; above 1 exaggerates the LoRA). A plain `scale`
// (older saved songs) sets both halves.
export function normalizeAdapterSelection(input, installed) {
  if (!Array.isArray(input)) return [];
  const names = new Set(installed.map((item) => item.name));
  const clamp = (value, fallback) => { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback; };
  const result = [];
  for (const item of input) {
    const name = typeof item?.name === 'string' ? item.name : '';
    if (!names.has(name) || result.some((existing) => existing.name === name)) continue;
    const both = clamp(item.scale, 1);
    result.push({ name, arScale: clamp(item.arScale, both), narScale: clamp(item.narScale, both) });
  }
  return result;
}

// What yue-server's /synth expects for the chosen adapters.
export const toEngineAdapters = (selection) => selection.map((item) => ({ name: item.name, ar_scale: item.arScale, nar_scale: item.narScale }));

// The result of GET /job?result is a multipart body; returns the bytes of the first audio part.
export function extractAudioPart(buffer, contentType) {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType || '');
  if (!boundaryMatch) return buffer; // not multipart: the body is the audio itself
  const delimiter = Buffer.from(`--${boundaryMatch[1]}`);
  let cursor = buffer.indexOf(delimiter);
  while (cursor >= 0) {
    const start = cursor + delimiter.length;
    const next = buffer.indexOf(delimiter, start);
    if (next < 0) break;
    const part = buffer.subarray(start, next);
    const split = part.indexOf('\r\n\r\n');
    if (split >= 0) {
      const headers = part.subarray(0, split).toString('latin1').toLowerCase();
      if (/content-type:\s*audio\//.test(headers)) {
        let body = part.subarray(split + 4);
        if (body.length >= 2 && body[body.length - 2] === 13 && body[body.length - 1] === 10) body = body.subarray(0, body.length - 2);
        return body;
      }
    }
    cursor = next;
  }
  throw new Error('결과에서 오디오를 찾지 못했습니다.');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthy(base, fetchImpl) {
  try { const response = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(2000) }); return response.ok; } catch { return false; }
}

// Starts yue-server unless one already answers on `base`; returns a stop() that only kills a server it started.
async function ensureServer({ paths, base, spawnImpl, fetchImpl }) {
  if (await healthy(base, fetchImpl)) return () => {};
  const url = new URL(base);
  const args = ['--model', paths.model, '--vae', paths.vae, '--adapters', paths.adapters, '--host', url.hostname, '--port', url.port];
  const child = spawnImpl(paths.exe, args, { windowsHide: true, cwd: path.dirname(paths.exe), stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = async () => {
    if (process.platform === 'win32' && child.pid) { try { const { spawnSync } = await import('node:child_process'); spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* already gone */ } }
    else child.kill();
  };
  let log = '';
  const collect = (data) => { log = (log + data).slice(-8000); };
  child.stdout?.on('data', collect); child.stderr?.on('data', collect);
  let exited = false;
  child.once('exit', () => { exited = true; });
  child.once('error', () => { exited = true; });
  const startedAt = Date.now();
  try {
    while (!(await healthy(base, fetchImpl))) {
      if (exited) throw new Error(`곡 생성 엔진(yue-server)이 시작되지 못했습니다. ${log.split('\n').slice(-4).join(' ')}`);
      if (Date.now() - startedAt > START_TIMEOUT_MS) throw new Error('곡 생성 엔진(yue-server) 시작이 제한 시간을 넘었습니다.');
      await sleep(500);
    }
  } catch (error) { await stop(); throw error; }
  return stop;
}

// Makes one song. A server that was already running is reused and left running. Returns { audio: Buffer, seconds }.
export async function synthesize({ paths, base, request, spawnImpl, fetchImpl = fetch, onProgress = () => {}, isCancelled = () => false, timeoutMs = 10 * 60 * 1000 }) {
  const stop = await ensureServer({ paths, base, spawnImpl, fetchImpl });
  try {
    const started = await fetchImpl(`${base}/synth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const startedBody = await started.json().catch(() => ({}));
    if (!started.ok || !startedBody.id) throw new Error(`곡 생성 요청이 거부되었습니다: ${startedBody.error || started.status}`);
    const id = startedBody.id;
    const startedAt = Date.now();
    for (;;) {
      if (isCancelled()) { await fetchImpl(`${base}/job?id=${id}&cancel=1`, { method: 'POST' }).catch(() => {}); throw new Error('곡 생성이 취소되었습니다.'); }
      if (Date.now() - startedAt > timeoutMs) { await fetchImpl(`${base}/job?id=${id}&cancel=1`, { method: 'POST' }).catch(() => {}); throw new Error('곡 생성이 제한 시간을 넘어 중단되었습니다.'); }
      await sleep(1500);
      const status = (await (await fetchImpl(`${base}/job?id=${id}`)).json()).status;
      onProgress(status);
      if (status === 'done') break;
      if (status === 'failed') throw new Error('곡 생성에 실패했습니다. yue-server 로그를 확인해 주세요.');
      if (status === 'cancelled') throw new Error('곡 생성이 취소되었습니다.');
    }
    const result = await fetchImpl(`${base}/job?id=${id}&result=1`);
    if (!result.ok) throw new Error('생성된 곡을 가져오지 못했습니다.');
    const audio = extractAudioPart(Buffer.from(await result.arrayBuffer()), result.headers.get('content-type'));
    return { audio, seconds: (Date.now() - startedAt) / 1000 };
  } finally {
    await stop();
  }
}

// Which adapters the engine accepts and for which stage (ar / nar): [{ name, ok, ar, nar }].
export async function probeAdapters({ paths, base, spawnImpl, fetchImpl = fetch }) {
  const stop = await ensureServer({ paths, base, spawnImpl, fetchImpl });
  try {
    const props = await (await fetchImpl(`${base}/props`)).json();
    return Array.isArray(props.adapters) ? props.adapters : [];
  } finally {
    await stop();
  }
}

export { exists as fileExists };
