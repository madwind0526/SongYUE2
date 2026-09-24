import http from 'node:http';
import { mkdir, readFile, writeFile, rename, readdir, access, unlink, rm, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { comfyUiAlive, execute as executeComfyUi } from './comfyui.mjs';
import { parseNoteEvents, encodeMidiFile } from './midi.mjs';
import { startDdspJob, killDdspJob } from './ddsp-svc.mjs';
import { searchRvcVoices, downloadRvcVoice, listInstalledRvcVoices, resolveUserRvcVoice, deleteRvcVoice } from './rvcvoices.mjs';
import { TYPECAST_LANGUAGES, typecastSubscription, listTypecastVoices, typecastSpeak, recommendTypecastVoice, cloneTypecastVoice, deleteTypecastVoice, TypecastError } from './typecast.mjs';
import { readWavPcm16, wavFromPcm16, findSpeechSegments, spliceSegments } from './speechedit.mjs';
import { ASR_FAMILIES, VC_FAMILIES, EDIT_FAMILIES, buildEditText, TTS_FAMILIES, STYLE_FAMILIES, presetVoice, findTtsModel, isTtsModelInstalled, listTtsModels, splitTtsText, splitTtsByScript, buildTtsArgs, downloadTtsModel } from './tts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const providers = new Set(['none', 'ollama', 'claude', 'chatgpt', 'gemini']);
const DEFAULT_CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const AUDIOCPP_MODELS = {
  'yue2-q4': { model: 'yue2-3b-q4_0.gguf', vae: 'yue2-vae-f16.gguf' },
  'yue2-q8': { model: 'yue2-3b-q8_0.gguf', vae: 'yue2-vae-f16.gguf' },
  'yue2-bf16': { model: 'yue2-3b-bf16.gguf', vae: 'yue2-vae-f32.gguf' },
};
const PYTHON_MODELS = {
  'yue2-original': { modelDir: path.join('models', 'm-a-p', 'YuE2-3B'), vaeDir: path.join('models', 'm-a-p', 'YuE2-Vae') },
};
const UNSUPPORTED_MODEL_MESSAGES = {};
const COMFYUI_MODELS = {
  'yue2-int8-convrot': { checkpoint: 'yue2_3b_int8_convrot.safetensors' },
};
const AUDIOCPP_SIDECARS = ['sidecars/yue2-model-config.json', 'sidecars/yue2-generation-config.json', 'sidecars/yue2-qwen.tiktoken', 'sidecars/yue2-vae-config.json'];
const HTDEMUCS_MODEL_PATH = path.join('models', 'audio-cpp', 'audio.cpp-gguf', 'HTDemucs-GGUF', 'htdemucs-q8_0.gguf');
const MEL_BAND_ROFORMER_MODEL_PATH = path.join('models', 'audio-cpp', 'audio.cpp-gguf', 'Mel-Band-RoFormer-GGUF', 'mel-band-roformer-f16.gguf');
const AUDIOSR_MODEL_PATH = path.join('models', 'audio-cpp', 'audio.cpp-gguf', 'AudioSR-GGUF', 'audiosr-basic-f32.gguf');
const MUSCRIPTOR_MODEL_PATH = path.join('models', 'audio-cpp', 'audio.cpp-gguf', 'MuScriptor-Small-GGUF', 'muscriptor-small-f32.gguf');
const SEED_VC_MODEL_PATH = path.join('models', 'audio-cpp', 'audio.cpp-gguf', 'SeedVC-MLX-GGUF', 'seed-vc-mlx-q8_0.gguf');
const VEVO2_MODEL_PATH = path.join('models', 'audio-cpp', 'audio.cpp-gguf', 'Vevo2-GGUF', 'vevo2-q8_0.gguf');
const VOCAL_TIMBRE_ENGINES = new Set(['seed_vc', 'vevo2', 'rvc']);
const STEM_MODES = {
  full: { family: 'htdemucs', modelPath: HTDEMUCS_MODEL_PATH, stems: ['vocals', 'drums', 'bass', 'other'], missingModel: 'STEM 분리 모델(HTDemucs)이 없습니다. scripts/download_models.py를 실행해 주세요.' },
  vocal: { family: 'mel_band_roformer', modelPath: MEL_BAND_ROFORMER_MODEL_PATH, stems: ['vocals', 'instrumental'], missingModel: 'STEM 분리 모델(Mel-Band RoFormer)이 없습니다. scripts/download_models.py를 실행해 주세요.' },
  // No AI model: a plain ffmpeg L/R channel split, reusing the STEM dialog's separate-then-post-
  // process-then-merge flow for independent per-channel EQ/FX instead of source separation.
  channel: { stems: ['left', 'right'] },
};
const STEM_NAMES = [...new Set(Object.values(STEM_MODES).flatMap((mode) => mode.stems))];
const EXAMPLE_COLORS = ['sage', 'blue', 'sand'];
const DEFAULT_EXAMPLES = [
  { title: '늦은 밤의 어쿠스틱', genre: '어쿠스틱 팝', caption: '따뜻한 기타와 담백한 목소리', color: 'sage', style: 'Korean, acoustic pop, intimate warm vocal, fingerpicked guitar, soft drums, gentle evening mood, 82 BPM', lyrics: '[Verse]\n창가에 남은 작은 불빛\n하루의 끝에 너를 생각해\n말없이 건넨 따뜻한 마음\n오늘도 나를 쉬게 해\n\n[Chorus]\n조금 느리게 걸어도 좋아\n우리의 밤은 아직 길어\n너의 목소리 곁에 머물면\n여기가 나의 집이 돼' },
  { title: '도시의 푸른 새벽', genre: '시티 팝', caption: '반짝이는 신스와 느긋한 리듬', color: 'blue', style: 'Korean, city pop, mellow vocal, electric piano, round bass, shimmering synth, relaxed groove, 104 BPM', lyrics: '[Verse]\n잠들지 않은 거리 위로\n푸른 새벽이 내려오면\n어제의 걱정 흘려보내\n낯선 바람에 기대어\n\n[Chorus]\n빛을 따라 달려가\n아직 모르는 내일로\n우리의 작은 꿈들이\n이 도시를 깨울 때' },
  { title: '마음을 전하는 피아노', genre: '피아노 발라드', caption: '여백이 있는 감성적인 선율', color: 'sand', style: 'Korean, piano ballad, expressive soft vocal, spacious piano, subtle strings, tender and hopeful, 72 BPM', lyrics: '[Verse]\n다 하지 못한 말들이\n건반 위에 내려앉아\n그대의 이름 부르면\n작은 노래가 되네\n\n[Chorus]\n언제나 그대 곁에서\n조용한 빛이 될게요\n시간이 우리를 지나도\n이 마음은 여기 있어요' },
];
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const SAVE_FORMATS = new Set(['wav', 'flac', 'mp3', 'mp4']);
const AUDIO_MIME_TYPES = { '.wav': 'audio/wav', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };
const LIBRARY_BROWSE_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.ogg']);
const COVER_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const AUDIO_MIME = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/ogg': 'ogg' };
const FFMPEG_ARGS = {
  wav: (input, output) => ['-y', '-i', input, '-c:a', 'pcm_s16le', output],
  flac: (input, output) => ['-y', '-i', input, '-c:a', 'flac', output],
  mp3: (input, output) => ['-y', '-i', input, '-c:a', 'libmp3lame', '-b:a', '320k', output],
  mp4: (input, output, coverFile) => [
    '-y',
    ...(coverFile ? ['-loop', '1', '-i', coverFile] : ['-f', 'lavfi', '-i', 'color=c=1b2a1d:s=1280x720:r=1']),
    '-i', input,
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x1b2a1d',
    '-c:a', 'aac', '-b:a', '256k', '-shortest', output,
  ],
};
const VIEW_MODES = new Set(['list', 'card']);
const DEFAULT_ENGINE_PATH = path.join('engine', 'audio.cpp', 'build', 'windows-cuda-release', 'bin', 'audiocpp_cli.exe');
const DEFAULT_COMFYUI_ENDPOINT = 'http://127.0.0.1:8190';
// Own install under engine/ (gitignored, same as engine/audio.cpp).
const DEFAULT_COMFYUI_ENGINE_PATH = path.join('engine', 'ComfyUI');
const CHUNK_SECONDS = 10;
const CHUNK_OVERLAP_SECONDS = 2;
const DEFAULT_DDSP_SVC_PATH = path.join('test', 'DDSP-SVC');
const COMFYUI_GENERATE_DEADLINE_MS = GENERATE_TIMEOUT_MS;
const COMFYUI_MAX_DURATION_SECONDS = 240;
const VOCAL_GENDERS = new Set(['', 'male', 'female', 'duet']);
const DEFAULT_STYLE_PRESETS = 'Acoustic\nCity Pop\nBallad\nLo-fi\nJazz';
const DEFAULT_VISUALIZER_ENABLED = true;
const DEFAULT_VISUALIZER_RING_COUNT = 18;
const DEFAULT_VISUALIZER_HUE = 190;
const DEFAULT_VISUALIZER_LINE_WIDTH = 1;
const DEFAULT_VISUALIZER_TRAIL = 0;
const DEFAULT_VISUALIZER_SPIRAL = 100;
const VISUALIZER_RING_MODES = new Set(['radial', 'time']);
const DEFAULT_VISUALIZER_RING_MODE = 'radial';
const DEFAULT_VISUALIZER_TIME_STEP = 0.5;
const DEFAULT_VISUALIZER_TIME_SKEW = 1;
const DEFAULT_VISUALIZER_RING_STEP = 1;
const DEFAULT_VISUALIZER_AMPLITUDE = 2;
const VOCAL_HINTS = { male: ', male vocal', female: ', female vocal', duet: ', duet: male and female vocals' };
const vocalHint = (gender) => VOCAL_HINTS[gender] || '';

// Chunk/overlap come from the API as {chunkSeconds, overlapSeconds} (UI defaults 10s/2s). Overlap
// is clamped to at most half the chunk so the plan always strides forward.
function resolveChunkParams(chunkSeconds, overlapSeconds) {
  const chunk = Number.isFinite(chunkSeconds) && chunkSeconds >= 1 ? Math.min(120, Math.round(chunkSeconds)) : CHUNK_SECONDS;
  const maxOverlap = Math.floor(chunk / 2);
  const overlap = Number.isFinite(overlapSeconds) && overlapSeconds >= 0 ? Math.min(maxOverlap, Math.round(overlapSeconds)) : Math.min(maxOverlap, CHUNK_OVERLAP_SECONDS);
  return { chunkSeconds: chunk, overlapSeconds: overlap, edgeTrimSeconds: overlap / 2 };
}
function buildChunkPlan(durationSeconds, chunkSeconds = CHUNK_SECONDS, overlapSeconds = CHUNK_OVERLAP_SECONDS) {
  const chunks = [];
  const stride = Math.max(1, chunkSeconds - overlapSeconds);
  for (let start = 0; start < durationSeconds - 0.001;) {
    const duration = Math.min(chunkSeconds, durationSeconds - start);
    chunks.push({ start, duration });
    if (start + duration >= durationSeconds - 0.001) break;
    start += stride;
  }
  return chunks;
}
// YuE2 has no dedicated instrumental flag and both the audio.cpp and Python engines require
// non-empty lyrics (audio.cpp throws "Yue2 requires non-empty lyrics" outright), so "instrumental"
// mode can only ever be a soft style hint on top of the real lyrics, not a way to omit them.
const styleHint = (project) => project.instrumental ? ', instrumental, no vocals' : vocalHint(project.vocalGender);
const exists = async (target) => { try { await access(target); return true; } catch { return false; } };
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = (value, max = 20000) => typeof value === 'string' ? value.slice(0, max) : '';
function safeFilename(title) {
  let cleaned = (title || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (!cleaned) cleaned = '제목 없는 곡';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned.slice(0, 120);
}
async function uniqueJsonPath(dir, title, excludeFile) {
  const base = safeFilename(title);
  let candidate = path.join(dir, `${base}.json`);
  for (let n = 1; (await exists(candidate)) && candidate !== excludeFile; n += 1) candidate = path.join(dir, `${base} (${n}).json`);
  return candidate;
}
async function uniqueAbcPath(dir, title, excludeFile) {
  const base = safeAbcFilename(title, 'score').replace(/\.abc$/i, '');
  let candidate = path.join(dir, `${base}.abc`);
  for (let n = 1; (await exists(candidate)) && candidate !== excludeFile; n += 1) candidate = path.join(dir, `${base} (${n}).abc`);
  return candidate;
}
function abcFileId(name) { return `abcfile-${Buffer.from(name, 'utf8').toString('base64url')}`; }
function abcFileNameFromId(id) {
  if (!id?.startsWith('abcfile-')) return null;
  try {
    const name = Buffer.from(id.slice(8), 'base64url').toString('utf8');
    return path.basename(name) === name && name.toLowerCase().endsWith('.abc') ? name : null;
  } catch { return null; }
}
async function readAbcFileNote(dir, name) {
  const file = path.join(dir, name);
  const [abc, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
  return { id: abcFileId(name), title: path.basename(name, path.extname(name)), abc, createdAt: info.birthtime.toISOString(), updatedAt: info.mtime.toISOString(), format: 'abc' };
}
function safeAbcFilename(value, fallback = 'score') {
  let name = path.basename(text(value, 240).trim() || fallback);
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (!name) name = 'score';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
  if (!name.toLowerCase().endsWith('.abc')) name += '.abc';
  return name.slice(0, 180);
}
function safeMidiFilename(value, fallback = 'midi') {
  let name = path.basename(text(value, 240).trim() || fallback);
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (!name) name = 'midi';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`;
  if (!name.toLowerCase().endsWith('.mid')) name += '.mid';
  return name.slice(0, 180);
}
async function readJson(file, fallback) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function saveJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}
async function body(req, maxBytes = 256 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'JSON 형식으로 요청해 주세요.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw fail(413, '입력 내용이 너무 깁니다. 내용을 줄여 주세요.');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch { throw fail(400, '요청 내용을 읽을 수 없습니다. 다시 시도해 주세요.'); }
}
function ollamaEndpoint(value) {
  let url;
  try { url = new URL(value || 'http://127.0.0.1:11434'); } catch { throw fail(400, '.env 파일의 OLLAMA_ENDPOINT 값을 확인해 주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw fail(400, 'Ollama는 이 PC의 localhost 주소를 사용해 주세요. .env 파일의 OLLAMA_ENDPOINT 값을 확인해 주세요.');
  }
  return url.href.replace(/\/$/, '');
}
function providerFromEnv(id) {
  if (id === 'ollama') return { endpoint: ollamaEndpoint(process.env.OLLAMA_ENDPOINT), model: (process.env.OLLAMA_MODEL || '').trim(), apiKey: '' };
  if (id === 'claude') return { endpoint: (process.env.CLAUDE_ENDPOINT || '').trim() || DEFAULT_CLAUDE_ENDPOINT, model: (process.env.CLAUDE_MODEL || '').trim(), apiKey: (process.env.CLAUDE_API_KEY || '').trim() };
  if (id === 'chatgpt') return { endpoint: (process.env.OPENAI_ENDPOINT || '').trim() || DEFAULT_OPENAI_ENDPOINT, model: (process.env.OPENAI_MODEL || '').trim(), apiKey: (process.env.OPENAI_API_KEY || '').trim() };
  if (id === 'gemini') return { endpoint: (process.env.GEMINI_ENDPOINT || '').trim() || DEFAULT_GEMINI_ENDPOINT, model: (process.env.GEMINI_MODEL || '').trim(), apiKey: (process.env.GEMINI_API_KEY || '').trim() };
  return { endpoint: '', model: '', apiKey: '' };
}

export async function createStudioServer({ root = ROOT, port = 4311, fetchImpl = fetch, spawnImpl = spawn } = {}) {
  try { process.loadEnvFile(path.join(root, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const data = path.join(root, 'data');
  const outputDirectory = path.join(root, 'runs');
  const settingsFile = path.join(data, 'settings.json');
  await mkdir(outputDirectory, { recursive: true });
  const stored = await readJson(settingsFile, {});
  let settings = {
    provider: providers.has(stored.provider) ? stored.provider : (providers.has(process.env.LLM_PROVIDER) ? process.env.LLM_PROVIDER : 'none'),
    enginePath: text(stored.enginePath, 2048) || text(process.env.ENGINE_PATH, 2048),
    pythonEnginePath: text(stored.pythonEnginePath, 2048) || text(process.env.PYTHON_ENGINE_PATH, 2048),
    pythonScriptPath: text(stored.pythonScriptPath, 2048) || text(process.env.PYTHON_SCRIPT_PATH, 2048),
    sheetSagePythonPath: text(stored.sheetSagePythonPath, 2048) || text(process.env.SHEETSAGE_PYTHON_PATH, 2048),
    comfyUiEndpoint: text(stored.comfyUiEndpoint, 2048) || text(process.env.COMFYUI_ENDPOINT, 2048),
    comfyUiEnginePath: text(stored.comfyUiEnginePath, 2048) || text(process.env.COMFYUI_ENGINE_PATH, 2048),
    ddspSvcPath: text(stored.ddspSvcPath, 2048) || text(process.env.DDSP_SVC_PATH, 2048),
    settingPath: text(stored.settingPath, 2048) || text(process.env.SETTING_PATH, 2048),
    musicPath: text(stored.musicPath, 2048) || text(process.env.MUSIC_PATH, 2048),
    examplesPath: text(stored.examplesPath, 2048) || text(process.env.EXAMPLES_PATH, 2048),
    coversPath: text(stored.coversPath, 2048) || text(process.env.COVERS_PATH, 2048),
    abcNotesPath: text(stored.abcNotesPath, 2048) || text(process.env.ABC_NOTES_PATH, 2048),
    stylePresets: typeof stored.stylePresets === 'string' ? text(stored.stylePresets, 4000) : DEFAULT_STYLE_PRESETS,
    visualizerEnabled: typeof stored.visualizerEnabled === 'boolean' ? stored.visualizerEnabled : DEFAULT_VISUALIZER_ENABLED,
    visualizerRingCount: Number.isInteger(stored.visualizerRingCount) ? Math.max(1, Math.min(40, stored.visualizerRingCount)) : DEFAULT_VISUALIZER_RING_COUNT,
    visualizerHue: Number.isFinite(stored.visualizerHue) ? ((stored.visualizerHue % 360) + 360) % 360 : DEFAULT_VISUALIZER_HUE,
    visualizerLineWidth: Number.isFinite(stored.visualizerLineWidth) ? Math.max(0.5, Math.min(8, stored.visualizerLineWidth)) : DEFAULT_VISUALIZER_LINE_WIDTH,
    visualizerTrail: Number.isFinite(stored.visualizerTrail) ? Math.max(0, Math.min(95, stored.visualizerTrail)) : DEFAULT_VISUALIZER_TRAIL,
    visualizerSpiral: Number.isFinite(stored.visualizerSpiral) ? Math.max(0, Math.min(100, stored.visualizerSpiral)) : DEFAULT_VISUALIZER_SPIRAL,
    visualizerRingMode: VISUALIZER_RING_MODES.has(stored.visualizerRingMode) ? stored.visualizerRingMode : DEFAULT_VISUALIZER_RING_MODE,
    visualizerTimeStep: Number.isFinite(stored.visualizerTimeStep) ? Math.max(0.02, Math.min(2, stored.visualizerTimeStep)) : DEFAULT_VISUALIZER_TIME_STEP,
    visualizerTimeSkew: Number.isFinite(stored.visualizerTimeSkew) ? Math.max(0.2, Math.min(4, stored.visualizerTimeSkew)) : DEFAULT_VISUALIZER_TIME_SKEW,
    visualizerRingStep: Number.isFinite(stored.visualizerRingStep) ? Math.max(0.1, Math.min(20, stored.visualizerRingStep)) : DEFAULT_VISUALIZER_RING_STEP,
    visualizerAmplitude: Number.isFinite(stored.visualizerAmplitude) ? Math.max(0.1, Math.min(10, stored.visualizerAmplitude)) : DEFAULT_VISUALIZER_AMPLITUDE,
    pythonMemoryBudgetGib: Number.isFinite(stored.pythonMemoryBudgetGib) ? stored.pythonMemoryBudgetGib : (Number(process.env.PYTHON_MEMORY_BUDGET_GIB) || 11),
    saveFormat: SAVE_FORMATS.has(stored.saveFormat) ? stored.saveFormat : (SAVE_FORMATS.has(process.env.SAVE_FORMAT) ? process.env.SAVE_FORMAT : 'wav'),
    viewMode: VIEW_MODES.has(stored.viewMode) ? stored.viewMode : 'list',
    outputDirectory,
  };
  // Shared child-runner with a hard deadline + output cap. The older inline spawn promises resolved
  // only on close/error, so a hung ffmpeg (file held open by another process, corrupt stream) held
  // the HTTP request open forever; this mirrors runSvcCli()'s timer+kill guard so the caller
  // surfaces a clear Korean timeout error instead. runFfmpegCli() wraps it with the label messages.
  async function runBufferedProcess(command, args, { cwd, timeoutMs = FFMPEG_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(command, args, { windowsHide: true, cwd });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    });
  }
  async function runFfmpegCli(args, label) {
    let log;
    try {
      log = await runBufferedProcess('ffmpeg', args);
    } catch {
      throw fail(502, `${label}에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.`);
    }
    if (log.signal) throw fail(502, `${label}이 제한 시간을 넘어 중단되었습니다.`);
    if (log.code !== 0) throw fail(502, `${label}에 실패했습니다. ${log.text.trim().slice(-500) || 'ffmpeg가 설치되어 있는지 확인해 주세요.'}`);
  }
  const resolveLibraryDir = (relative, defaultRelative) => path.join(root, relative.trim() || defaultRelative);
  const settingDir = () => resolveLibraryDir(settings.settingPath, 'library/setting');
  const musicDir = () => resolveLibraryDir(settings.musicPath, 'library/music');
  const examplesDir = () => resolveLibraryDir(settings.examplesPath, 'library/examples');
  const coversDir = () => resolveLibraryDir(settings.coversPath, 'library/cover');
  const abcNotesDir = () => resolveLibraryDir(settings.abcNotesPath, 'library/abc-note');
  // App-level config, not song data - lives under Setting/ (sibling to library/), not inside
  // library/setting: that folder is scanned as song drafts, and library/ is for song-related content only.
  const eqPresetsDir = () => path.join(root, 'Setting', 'EQ-preset');
  const postprocessSettingsDir = () => path.join(root, 'Setting', 'PostProcess');
  const resolveConfigPath = (value, defaultRelative) => path.resolve(root, (value || '').trim() || defaultRelative);
  const resolveOptionalConfigPath = (value) => { const trimmed = (value || '').trim(); return trimmed ? path.resolve(root, trimmed) : ''; };
  // audiocpp_cli resolves model_specs/*.json relative to its working directory for GGUF
  // packages that embed a "legacy" spec (observed previously with bs_roformer; yue2/htdemucs/
  // mel_band_roformer GGUFs happened not to need it) -- run it from the audio.cpp source root
  // (4 levels up from .../build/<preset>/bin/audiocpp_cli.exe) so lookup succeeds regardless of package.
  const audioCppCwd = (engine) => path.dirname(path.dirname(path.dirname(path.dirname(engine))));
  const playlistsDirPath = path.join(root, 'library', 'playlists');
  await mkdir(settingDir(), { recursive: true });
  await mkdir(musicDir(), { recursive: true });
  await mkdir(examplesDir(), { recursive: true });
  await mkdir(coversDir(), { recursive: true });
  await mkdir(abcNotesDir(), { recursive: true });
  await mkdir(playlistsDirPath, { recursive: true });
  async function listPlaylists() {
    const files = (await readdir(playlistsDirPath).catch(() => [])).filter((name) => name.endsWith('.json'));
    const list = await Promise.all(files.map(async (name) => ({ playlist: await readJson(path.join(playlistsDirPath, name), null), file: path.join(playlistsDirPath, name) })));
    return list.filter((entry) => entry.playlist);
  }
  async function listExamples() {
    const dir = examplesDir();
    const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
    const list = await Promise.all(files.map((name) => readJson(path.join(dir, name), null)));
    return list.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  if (!(await listExamples()).length) {
    for (const preset of DEFAULT_EXAMPLES) {
      const createdAt = new Date().toISOString();
      const example = { id: randomUUID(), title: preset.title, genre: preset.genre, caption: preset.caption, color: preset.color, style: preset.style, lyrics: preset.lyrics, createdAt };
      await saveJson(await uniqueJsonPath(examplesDir(), example.title), example);
    }
  }
  async function listEntries() {
    const entries = [];
    for (const dir of [settingDir(), musicDir()]) {
      const files = await readdir(dir).catch(() => []);
      for (const name of files.filter((entry) => entry.endsWith('.json') && !entry.endsWith('.notes.json'))) {
        const project = await readJson(path.join(dir, name), null);
        if (project) entries.push({ project, file: path.join(dir, name) });
      }
    }
    return entries;
  }
  async function findEntry(id) {
    if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) return null;
    return (await listEntries()).find((entry) => entry.project.id === id) || null;
  }
  let mutation = Promise.resolve();
  const serial = (operation) => {
    const next = mutation.then(operation);
    mutation = next.catch(() => {});
    return next;
  };
  let generating = false;
  let generationStatus = null;
  // "음색 변조" DDSP-SVC 탭: 독립된 락/맵 -- 학습이 수십 분~수 시간 걸리므로 일반 생성(generating)을
  // 막으면 안 되고, 다이얼로그가 닫혀도 계속 진행되며 GET /api/ddsp-jobs로 폴링 가능해야 한다.
  let ddspActive = false;
  const ddspJobs = new Map();
  const engineReady = async () => exists(resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH));
  async function finalizeToMusic(project, file, audioFile, extraFields = {}) {
    return serial(async () => {
      const dir = musicDir();
      await mkdir(dir, { recursive: true });
      const musicJson = await uniqueJsonPath(dir, project.title);
      const format = settings.saveFormat;
      const sourceExt = path.extname(audioFile).slice(1).toLowerCase();
      let musicAudio = musicJson.replace(/\.json$/, `.${format}`);
      let saveError = null;
      if (sourceExt === format) {
        await rename(audioFile, musicAudio);
      } else {
        try {
          const sourceCover = project.coverPath ? path.join(coversDir(), project.coverPath) : null;
          const coverFile = sourceCover && await exists(sourceCover) ? sourceCover : null;
          await new Promise((resolve, reject) => {
            const child = spawnImpl('ffmpeg', FFMPEG_ARGS[format](audioFile, musicAudio, coverFile), { windowsHide: true });
            child.once('error', reject);
            child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
          });
          if (!(await stat(musicAudio).catch(() => null))?.size) { await unlink(musicAudio).catch(() => {}); throw new Error('empty output'); }
          await unlink(audioFile).catch(() => {});
        } catch {
          saveError = `${format.toUpperCase()} 변환에 실패했습니다. ffmpeg가 설치되어 있고 PATH에 등록되어 있는지 확인해 주세요. 원본(${sourceExt.toUpperCase()}) 형식으로 대신 저장했습니다.`;
          musicAudio = musicJson.replace(/\.json$/, `.${sourceExt}`);
          await rename(audioFile, musicAudio);
        }
      }
      // A generated song is a new, independent entity: the source project/setting is left untouched
      // (not deleted or moved) so it can be reused to generate more songs. Deleting either one later
      // must not affect the other, so they get separate ids.
      const newId = randomUUID();
      let coverPath = project.coverPath || null;
      if (coverPath) {
        const oldCover = path.join(coversDir(), coverPath);
        const newCover = path.join(coversDir(), `${newId}${path.extname(coverPath)}`);
        if (await exists(oldCover)) { await copyFile(oldCover, newCover); coverPath = path.basename(newCover); } else coverPath = null;
      }
      const current = {
        ...project,
        ...extraFields,
        id: newId,
        sourceProjectId: project.id,
        status: 'completed',
        audioPath: path.basename(musicAudio),
        coverPath,
        saveError,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await saveJson(musicJson, current);
      return current;
    });
  }
  async function runAudioCpp(project, file) {
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    if (!(await exists(engine))) throw fail(400, `audio.cpp 실행 파일을 찾을 수 없습니다: ${path.relative(root, engine)}. 설정에서 경로를 확인해 주세요.`);
    const preset = AUDIOCPP_MODELS[project.modelId];
    if (!preset) throw fail(400, '이 모델은 audio.cpp로 생성할 수 없습니다. Q4/Q8/BF16 GGUF 모델을 선택해 주세요.');
    const modelRoot = path.join(root, 'models', 'audio-cpp', 'Yue2-3B-GGUF');
    for (const relative of [preset.model, preset.vae, ...AUDIOCPP_SIDECARS]) {
      if (!(await exists(path.join(modelRoot, relative)))) throw fail(400, `모델 파일이 없습니다: ${relative}. 모델 관리 화면에서 다운로드 상태를 확인해 주세요.`);
    }
    if (!project.lyrics.trim() || !project.style.trim()) throw fail(400, '가사와 음악 스타일이 필요합니다.');
    if (project.abc && project.abc.trim() && project.cot === 'off') throw fail(400, '악보를 사용하려면 작곡 계획을 "멜로디 계획" 또는 "멜로디와 코드 계획"으로 설정해 주세요.');
    const projectRuns = path.join(outputDirectory, project.id);
    await mkdir(projectRuns, { recursive: true });
    // audio.cpp's yue2 pipeline does accept an external ABC score -- not via a dedicated flag,
    // but through the generic `--request-option abc_file=<path>` mechanism (gated behind
    // cot=melody/full, same as the official Python engine). Reuse the same plan/mute-voice
    // prep as runPythonYue2() so "악기만" and ABC-driven cover work identically on GGUF.
    let effectiveProject = project;
    let abcFile = null;
    if (project.instrumental) {
      let sourceAbc = project.abc && project.abc.trim() ? project.abc : null;
      if (!sourceAbc) {
        const planProject = { ...project, cot: project.cot === 'off' ? 'full' : project.cot };
        const { outDir: planOutDir } = await runPythonAction('plan', planProject, [], 20000);
        const planAbcFile = path.join(planOutDir, 'score.abc');
        if (!(await exists(planAbcFile))) throw fail(502, '악기만 생성을 위한 심볼릭 작곡에 실패했습니다.');
        sourceAbc = await readFile(planAbcFile, 'utf8');
      }
      const instrumentalAbc = await stripVocalVoice(sourceAbc, projectRuns);
      abcFile = path.join(projectRuns, 'input.abc');
      await writeFile(abcFile, instrumentalAbc, 'utf8');
      effectiveProject = { ...project, cot: project.cot === 'off' ? 'melody' : project.cot };
    } else if (project.abc && project.abc.trim()) {
      abcFile = path.join(projectRuns, 'input.abc');
      await writeFile(abcFile, project.abc, 'utf8');
    }
    const audioFile = path.join(projectRuns, 'audio.wav');
    const logFile = path.join(projectRuns, 'generate.log');
    const threads = Math.max(1, Math.min(8, os.cpus().length));
    const args = [
      '--task', 'gen', '--family', 'yue2', '--model', modelRoot, '--backend', 'cuda', '--threads', String(threads),
      '--session-option', `yue2.model_gguf=${preset.model}`, '--session-option', `yue2.vae_gguf=${preset.vae}`,
      '--lyrics', effectiveProject.lyrics, '--request-option', `style=${effectiveProject.style}${styleHint(effectiveProject)}`, '--request-option', `cot=${effectiveProject.cot}`,
      '--request-option', `num_inference_steps=${effectiveProject.steps}`, '--seed', String(effectiveProject.seed),
      ...(abcFile ? ['--request-option', `abc_file=${abcFile}`] : []),
      '--out', audioFile, '--log', '--metrics',
    ];
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(engine, args, { windowsHide: true, cwd: audioCppCwd(engine) });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    }).catch(() => { throw fail(502, '음악 생성 엔진을 실행할 수 없습니다. 설정의 실행 파일 경로를 확인해 주세요.'); });
    await writeFile(logFile, log.text);
    if (log.signal) throw fail(502, '음악 생성이 제한 시간을 넘어 중단되었습니다. 더 짧은 가사나 낮은 추론 단계로 다시 시도해 주세요.');
    if (log.code !== 0 || !(await exists(audioFile))) throw fail(502, `음악 생성에 실패했습니다 (종료 코드 ${log.code}). runs/${project.id}/generate.log에서 로그를 확인해 주세요.`);
    const durationMatch = log.text.match(/metrics\.audio_duration_ms=([\d.]+)/);
    const rtfMatch = log.text.match(/metrics\.rtf=([\d.]+)/);
    return finalizeToMusic(project, file, audioFile, {
      durationMs: durationMatch ? Math.round(Number(durationMatch[1])) : null,
      rtf: rtfMatch ? Number(rtfMatch[1]) : null,
    });
  }
  function stemsDir(projectId) {
    return path.join(outputDirectory, projectId, 'stems');
  }
  async function separateStems(entry, modeKey) {
    if (!entry.project.audioPath) throw fail(404, '완성된 음원을 찾을 수 없습니다.');
    const sourceFile = path.join(path.dirname(entry.file), entry.project.audioPath);
    if (!(await exists(sourceFile))) throw fail(404, '음원 파일을 찾을 수 없습니다.');
    return separateStemsCore(sourceFile, stemsDir(entry.project.id), modeKey);
  }
  // 프로젝트와 무관하게(예: "음색 변조" 팝업에서 라이브러리에서 자유롭게 고른 원본 오디오)
  // 임의의 소스 파일 + 출력 디렉터리로 STEM 분리를 돌릴 수 있는 범용 코어. separateStems()는
  // 프로젝트에서 소스 경로/캐시 디렉터리만 유도해 이 함수에 위임하는 얇은 래퍼다.
  async function separateStemsCore(sourceFile, dir, modeKey) {
    const mode = STEM_MODES[modeKey];
    if (!mode) throw fail(400, '알 수 없는 STEM 분리 방식입니다.');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    if (modeKey === 'channel') {
      const probe = await new Promise((resolve, reject) => {
        const child = spawnImpl('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', sourceFile], { windowsHide: true });
        const chunks = [];
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.once('error', reject);
        child.once('close', (code) => resolve({ text: Buffer.concat(chunks).toString('utf8').trim(), code }));
      }).catch(() => { throw fail(502, '채널 정보를 읽지 못했습니다. ffmpeg(ffprobe)가 설치되어 있는지 확인해 주세요.'); });
      if (probe.code !== 0 || Number(probe.text) !== 2) throw fail(400, '이 곡은 스테레오(2채널)가 아니라 채널 분리를 할 수 없습니다.');
      await new Promise((resolve, reject) => {
        const child = spawnImpl('ffmpeg', ['-y', '-i', sourceFile, '-filter_complex', '[0:a]channelsplit=channel_layout=stereo[left][right]', '-map', '[left]', path.join(dir, 'left.wav'), '-map', '[right]', path.join(dir, 'right.wav')], { windowsHide: true });
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
      }).catch(() => { throw fail(502, '채널 분리에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
      const missing = [];
      for (const name of mode.stems) { if (!(await exists(path.join(dir, `${name}.wav`)))) missing.push(name); }
      if (missing.length) throw fail(502, `채널 분리에 실패했습니다. 누락된 채널: ${missing.join(', ')}`);
      return { stems: mode.stems };
    }
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    if (!(await exists(engine))) throw fail(400, `audio.cpp 실행 파일을 찾을 수 없습니다: ${path.relative(root, engine)}. 설정에서 경로를 확인해 주세요.`);
    const modelPath = path.join(root, mode.modelPath);
    if (!(await exists(modelPath))) throw fail(400, mode.missingModel);
    const sourceWav = path.join(dir, 'source-44k.wav');
    await new Promise((resolve, reject) => {
      const child = spawnImpl('ffmpeg', ['-y', '-i', sourceFile, '-ar', '44100', '-ac', '2', sourceWav], { windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
    }).catch(() => { throw fail(502, 'STEM 분리를 위한 오디오 변환에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
    const args = ['--task', 'sep', '--family', mode.family, '--model', modelPath, '--backend', 'cuda', '--audio', sourceWav, '--out-dir', dir];
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(engine, args, { windowsHide: true, cwd: audioCppCwd(engine) });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    }).catch(() => { throw fail(502, 'STEM 분리 엔진을 실행할 수 없습니다.'); });
    if (log.signal) throw fail(502, 'STEM 분리가 제한 시간을 넘어 중단되었습니다.');
    const missing = [];
    for (const name of mode.stems) { if (!(await exists(path.join(dir, `${name}.wav`)))) missing.push(name); }
    if (log.code !== 0 || missing.length) throw fail(502, `STEM 분리에 실패했습니다 (종료 코드 ${log.code}). ${log.text.trim().slice(0, 500) || '알 수 없는 오류'}`);
    return { stems: mode.stems };
  }
  // "음색 변조" 팝업이 라이브러리에서 자유롭게 고른 "원본 audio"를 위한 스크래치 디렉터리 --
  // stemsDir(projectId)와 같은 패턴이지만 프로젝트가 아니라 이 팝업이 열릴 때마다 생기는
  // 세션 id로 키를 잡는다. 프로젝트 삭제 시 stemsDir가 지워지는 것과 달리 이 디렉터리는
  // 자동으로 정리되지 않는다(DDSP-SVC 학습이 팝업을 닫은 뒤에도 vocals-original.wav를 계속
  // 읽어야 하므로) -- runs/<projectId> 디렉터리도 마찬가지로 자동 정리되지 않는 것과 같은 수준.
  function timbrePreviewDir(id) {
    return path.join(outputDirectory, `timbre-preview-${id}`);
  }
  async function prepareTimbrePreview(sourceDataUrl) {
    const match = typeof sourceDataUrl === 'string' && sourceDataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw fail(400, '원본 오디오(MP3/WAV/FLAC/M4A/OGG)를 선택해 주세요.');
    const ext = AUDIO_MIME[match[1]];
    if (!ext) throw fail(400, '지원하지 않는 오디오 형식입니다. MP3/WAV/FLAC/M4A/OGG 파일을 사용해 주세요.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 200 * 1024 * 1024) throw fail(413, '원본 오디오 파일이 너무 큽니다. 200MB 이하로 줄여 주세요.');
    const id = randomUUID();
    const dir = timbrePreviewDir(id);
    await mkdir(dir, { recursive: true });
    const sourceRaw = path.join(dir, `source-raw.${ext}`);
    await writeFile(sourceRaw, buffer);
    // 항상 WAV로 통일해 재생/서빙 시 포맷 감지 없이 하나의 GET 라우트로 처리한다.
    const sourceFile = path.join(dir, 'source.wav');
    await new Promise((resolve, reject) => {
      const child = spawnImpl('ffmpeg', ['-y', '-i', sourceRaw, sourceFile], { windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
    }).catch(() => { throw fail(502, '원본 오디오 변환에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
    const stems = path.join(dir, 'stems');
    await separateStemsCore(sourceFile, stems, 'vocal');
    await copyFile(path.join(stems, 'vocals.wav'), path.join(stems, 'vocals-original.wav'));
    return id;
  }
  // "음색 변조" 팝업의 "참조 보컬" 표시용: 참조 오디오를 mel_band_roformer로 한 번 더 분리해
  // vocals를 dataUrl로 돌려준다. 원본(prepare)과 달리 preview 캐시가 없어 선택할 때마다 다시
  // 돌리며, 결과는 보관하지 않는다.
  async function separateReferenceVocal(referenceDataUrl) {
    const match = typeof referenceDataUrl === 'string' && referenceDataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw fail(400, '지원하지 않는 참조 오디오 형식입니다.');
    const ext = AUDIO_MIME[match[1]];
    if (!ext) throw fail(400, '지원하지 않는 오디오 형식입니다. MP3/WAV/FLAC/M4A/OGG 파일을 사용해 주세요.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 200 * 1024 * 1024) throw fail(413, '참조 오디오 파일이 너무 큽니다. 200MB 이하로 줄여 주세요.');
    const workDir = path.join(outputDirectory, `timbre-ref-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    try {
      const sourceRaw = path.join(workDir, `source-raw.${ext}`);
      await writeFile(sourceRaw, buffer);
      const sourceFile = path.join(workDir, 'source.wav');
      await new Promise((resolve, reject) => {
        const child = spawnImpl('ffmpeg', ['-y', '-i', sourceRaw, sourceFile], { windowsHide: true });
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
      }).catch(() => { throw fail(502, '참조 오디오 변환에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
      await separateStemsCore(sourceFile, path.join(workDir, 'stems'), 'vocal');
      const vocals = await readFile(path.join(workDir, 'stems', 'vocals.wav'));
      return { vocalsDataUrl: `data:audio/wav;base64,${vocals.toString('base64')}` };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  async function runAudioSr(inputWav, outputWav) {
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    const args = ['--task', 's2s', '--family', 'audiosr', '--model', path.join(root, AUDIOSR_MODEL_PATH), '--backend', 'cuda', '--audio', inputWav, '--request-option', 'num_inference_steps=50', '--request-option', 'guidance_scale=3.5', '--request-option', 'ddim_eta=1.0', '--request-option', 'seed=42', '--out', outputWav];
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(engine, args, { windowsHide: true, cwd: audioCppCwd(engine) });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    }).catch(() => { throw fail(502, 'AudioSR 엔진을 실행할 수 없습니다.'); });
    if (log.signal) throw fail(502, '오디오 복원이 제한 시간을 넘어 중단되었습니다.');
    if (log.code !== 0 || !(await exists(outputWav))) throw fail(502, `오디오 복원에 실패했습니다 (종료 코드 ${log.code}). ${log.text.trim().slice(0, 500) || '알 수 없는 오류'}`);
  }
  // AudioSR always outputs mono regardless of input channel count (model limitation, no
  // bypass option) -- for stereo sources, restore each channel independently and remux so
  // the result stays stereo instead of silently collapsing to mono.
  //
  // Split into preview (this function, keeps its workDir around instead of cleaning it up)
  // + saveRestoredAudio (finalizes an already-restored preview) so the frontend can show a
  // 원본/복원 waveform comparison dialog before committing to the library, matching the
  // preview-then-save pattern used by applyVocalTimbreCore()/STEM dialogs elsewhere in the app.
  function restorePreviewDir(id) {
    return path.join(outputDirectory, `audiosr-${id}`);
  }
  async function previewRestoreAudio(dataUrl) {
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    if (!(await exists(engine))) throw fail(400, `audio.cpp 실행 파일을 찾을 수 없습니다: ${path.relative(root, engine)}. 설정에서 경로를 확인해 주세요.`);
    if (!(await exists(path.join(root, AUDIOSR_MODEL_PATH)))) throw fail(400, 'AudioSR 모델이 없습니다. scripts/download_models.py를 실행해 주세요.');
    const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw fail(400, '오디오 파일(MP3/WAV/FLAC/M4A/OGG)을 선택해 주세요.');
    const ext = AUDIO_MIME[match[1]];
    if (!ext) throw fail(400, '지원하지 않는 오디오 형식입니다. MP3/WAV/FLAC/M4A/OGG 파일을 사용해 주세요.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 100 * 1024 * 1024) throw fail(413, '오디오 파일이 너무 큽니다. 100MB 이하로 줄여 주세요.');
    const id = randomUUID();
    const workDir = restorePreviewDir(id);
    await mkdir(workDir, { recursive: true });
    try {
      const sourceFile = path.join(workDir, `input.${ext}`);
      await writeFile(sourceFile, buffer);
      const sourceWav = path.join(workDir, 'source.wav');
      await new Promise((resolve, reject) => {
        const child = spawnImpl('ffmpeg', ['-y', '-i', sourceFile, '-ar', '48000', sourceWav], { windowsHide: true });
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
      }).catch(() => { throw fail(502, '오디오 변환에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
      const probe = await new Promise((resolve, reject) => {
        const child = spawnImpl('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', sourceWav], { windowsHide: true });
        const chunks = [];
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.once('error', reject);
        child.once('close', (code) => resolve({ text: Buffer.concat(chunks).toString('utf8').trim(), code }));
      }).catch(() => { throw fail(502, '채널 정보를 읽지 못했습니다. ffmpeg(ffprobe)가 설치되어 있는지 확인해 주세요.'); });
      const channels = Number(probe.text);
      if (probe.code !== 0 || !(channels === 1 || channels === 2)) throw fail(400, '모노 또는 스테레오 오디오만 복원할 수 있습니다.');
      const outputWav = path.join(workDir, 'restored.wav');
      if (channels === 1) {
        await runAudioSr(sourceWav, outputWav);
      } else {
        const leftWav = path.join(workDir, 'left.wav');
        const rightWav = path.join(workDir, 'right.wav');
        await new Promise((resolve, reject) => {
          const child = spawnImpl('ffmpeg', ['-y', '-i', sourceWav, '-filter_complex', '[0:a]channelsplit=channel_layout=stereo[left][right]', '-map', '[left]', leftWav, '-map', '[right]', rightWav], { windowsHide: true });
          child.once('error', reject);
          child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
        }).catch(() => { throw fail(502, '채널 분리에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
        const leftRestored = path.join(workDir, 'left-restored.wav');
        const rightRestored = path.join(workDir, 'right-restored.wav');
        await runAudioSr(leftWav, leftRestored);
        await runAudioSr(rightWav, rightRestored);
        await new Promise((resolve, reject) => {
          const child = spawnImpl('ffmpeg', ['-y', '-i', leftRestored, '-i', rightRestored, '-filter_complex', '[0:a][1:a]join=inputs=2:channel_layout=stereo[a]', '-map', '[a]', outputWav], { windowsHide: true });
          child.once('error', reject);
          child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
        }).catch(() => { throw fail(502, '복원된 채널을 다시 합치지 못했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
      }
      return { id, durationMs: await measureDurationMs(outputWav) };
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  async function saveRestoredAudio(id, title) {
    const workDir = restorePreviewDir(id);
    const outputWav = path.join(workDir, 'restored.wav');
    if (!(await exists(outputWav))) throw fail(404, '복원된 오디오를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.');
    try {
      const pseudoProject = { id: randomUUID(), title: text(title, 200).trim() || '복원된 오디오', coverPath: null };
      return await finalizeToMusic(pseudoProject, null, outputWav, { durationMs: await measureDurationMs(outputWav) });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // Shared by runSeedVcSvc()/runVevo2Svc() -- both are just "run audiocpp_cli with these args and
  // fail clearly if it doesn't produce outputWav", differing only in the args themselves.
  async function runSvcCli(args, engineNotRunnableMessage) {
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    const outputWav = args[args.indexOf('--out') + 1];
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(engine, args, { windowsHide: true, cwd: audioCppCwd(engine) });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    }).catch(() => { throw fail(502, engineNotRunnableMessage); });
    if (log.signal) throw fail(502, '보컬 음색 변환이 제한 시간을 넘어 중단되었습니다.');
    if (log.code !== 0 || !(await exists(outputWav))) throw fail(502, `보컬 음색 변환에 실패했습니다 (종료 코드 ${log.code}). ${log.text.trim().slice(0, 500) || '알 수 없는 오류'}`);
  }
  async function runSeedVcSvc(vocalsWav, voiceRefWav, outputWav, options = {}) {
    // f0_condition defaults to false on the v1_svc route (engine/audio.cpp/docs/models/seed_vc.md),
    // meaning the model gets no pitch-contour guidance from the source singing -- without it the
    // output loses the correct pitch trajectory entirely, which is what produced the "quacking"
    // artifact reported in real testing (2026-09-16). Singing voice conversion needs this on.
    //
    // auto_f0_adjust and num_inference_steps=80 (upstream Plachtaa/seed-vc's own Gradio UI
    // recommends 50-100 "for best quality", and defaults auto_f0_adjust to true -- audio.cpp's
    // CLI defaults both to off/30) were added 2026-09-17 to match the upstream-recommended
    // combination after a real "tearing" quality report. In direct A/B testing this combination
    // barely moved a spectral-flatness noise measurement on the specific pathological passage that
    // prompted the report, so it is not a fix on its own -- see the silence-gate step in
    // applyVocalTimbreCore() and the vevo2 alternative engine for the changes that actually mattered.
    // It is kept anyway because it matches the authors' own recommended defaults at no extra cost.
    const f0Condition = options.f0Condition !== false;
    const autoF0Adjust = options.autoF0Adjust !== false;
    const inferenceSteps = Math.max(1, Math.min(200, Math.round(Number(options.inferenceSteps)) || 80));
    await runSvcCli(['--task', 'svc', '--family', 'seed_vc', '--model', path.join(root, SEED_VC_MODEL_PATH), '--backend', 'cuda', '--task-route', 'v1_svc', '--request-option', `f0_condition=${f0Condition}`, '--request-option', `auto_f0_adjust=${autoF0Adjust}`, '--request-option', `num_inference_steps=${inferenceSteps}`, '--audio', vocalsWav, '--voice-ref', voiceRefWav, '--out', outputWav], 'Seed-VC 엔진을 실행할 수 없습니다.');
  }
  // RVC converts into a packaged voice (no reference clip); MeanVC2 is zero-shot from a reference clip.
  async function vcModelPath(familyId, size, precision) {
    const model = findTtsModel(familyId, 'vc', size, precision);
    if (!(await isTtsModelInstalled(root, model))) throw fail(400, `${model.family.label} 모델이 설치되어 있지 않습니다. 음색 변조 창의 모델 Selection에서 '모델 받기'를 눌러 내려받아 주세요.`);
    return path.join(root, model.relativePath);
  }
  async function runRvcSvc(vocalsWav, outputWav, options = {}) {
    const voices = VC_FAMILIES.find((item) => item.id === 'rvc').voices;
    const userVoice = typeof options.rvcVoice === 'string' && options.rvcVoice.startsWith('user:') ? await resolveUserRvcVoice(root, options.rvcVoice) : null;
    if (typeof options.rvcVoice === 'string' && options.rvcVoice.startsWith('user:') && !userVoice) throw fail(400, '선택한 RVC 목소리가 설치되어 있지 않습니다. 다시 받아 주세요.');
    const voice = userVoice ? options.rvcVoice : voices.some((item) => item.id === options.rvcVoice) ? options.rvcVoice : 'default';
    const semitone = Math.max(-24, Math.min(24, Math.round(Number(options.rvcSemitone)) || 0));
    // The packaged "default" voice has no retrieval index: retrieval_blend > 0 crashes audiocpp_cli (access violation, exit 3221225477).
    // Downloaded voices only support blending when a compatible retrieval index came with them.
    const blend = voice === 'default' || (userVoice && !userVoice.index) ? 0 : Math.max(0, Math.min(1, Number(options.rvcRetrieval) || 0));
    const voiceOptions = userVoice
      ? ['--request-option', `voice_model_path=${userVoice.pth}`, ...(userVoice.index && blend > 0 ? ['--request-option', `retrieval_index_path=${userVoice.index}`] : [])]
      : ['--request-option', `voice_id=${voice}`];
    await runSvcCli(['--task', 'vc', '--family', 'rvc', '--model', await vcModelPath('rvc', '기본', 'f16'), '--backend', 'cuda', '--audio', vocalsWav, '--out', outputWav, ...voiceOptions, '--request-option', `semitone_shift=${semitone}`, '--request-option', `retrieval_blend=${blend}`], 'RVC 엔진을 실행할 수 없습니다.');
  }
  async function runMeanVc2Svc(vocalsWav, voiceRefWav, outputWav, options = {}) {
    const precision = options.meanvcPrecision === 'fp32' ? 'fp32' : 'q4_k';
    // MeanVC2's WavLM speaker encoder allocates memory that grows with the square of the reference length
    // (measured: 40 s ok, 60 s wants ~100 GB and dies with cudaMalloc out of memory), and a few seconds are
    // enough to capture a voice, so only the first 20 s of the reference are used.
    const trimmedRef = path.join(path.dirname(outputWav), `meanvc-ref-${randomUUID().slice(0, 8)}.wav`);
    await runFfmpegCli(['-y', '-i', voiceRefWav, '-t', '20', '-ar', '16000', '-ac', '1', trimmedRef], '참조 오디오 자르기');
    await runSvcCli(['--task', 'vc', '--family', 'meanvc2', '--model', await vcModelPath('meanvc2', '120ms/40ms', precision), '--backend', 'cuda', '--audio', vocalsWav, '--voice-ref', trimmedRef, '--out', outputWav], 'MeanVC2 엔진을 실행할 수 없습니다.');
  }
  async function runVevo2Svc(vocalsWav, voiceRefWav, outputWav, route = 'style_preserved_svc') {
    // style_preserved_svc is vevo2's default svc route: convert the source singing to the target
    // voice while keeping the source's own singing style/prosody (engine/audio.cpp/docs/models/vevo2.md).
    // Zero-shot like Seed-VC (a target-voice clip, no training), added 2026-09-17 as an alternative
    // engine after Seed-VC's SVC output kept producing artifacts regardless of reference or parameters.
    const selectedRoute = route === 'style_preserved_vc' ? route : 'style_preserved_svc';
    const task = selectedRoute.endsWith('_vc') ? 'vc' : 'svc';
    await runSvcCli(['--task', task, '--family', 'vevo2', '--model', path.join(root, VEVO2_MODEL_PATH), '--backend', 'cuda', '--task-route', selectedRoute, '--source-audio', vocalsWav, '--target-voice', voiceRefWav, '--out', outputWav], 'Vevo2 엔진을 실행할 수 없습니다.');
  }
  // ffmpeg's volumedetect filter is the cheapest way to read a file's average loudness without
  // pulling in a full loudness-analysis library -- parses the "mean_volume: X dB" line it prints
  // to stderr. Returns null (caller treats as "no adjustment") if the probe itself fails.
  async function measureMeanVolumeDb(file) {
    try {
      const text = await new Promise((resolve, reject) => {
        const chunks = [];
        const child = spawnImpl('ffmpeg', ['-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true });
        const collect = (data) => chunks.push(data);
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.once('error', reject);
        child.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      const match = text.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }
  // ComfyUI's executeComfyUi() has no equivalent to audio.cpp's --metrics log line or the Python
  // runner's reported audio_seconds, so runComfyUi() must measure the rendered file's length
  // itself -- without this, finalizeToMusic() never gets a durationMs and card view silently
  // omits the duration for every song generated with a ComfyUI model (e.g. INT8 ConvRot).
  async function measureDurationMs(file) {
    try {
      const text = await new Promise((resolve, reject) => {
        const chunks = [];
        const child = spawnImpl('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
        const collect = (data) => chunks.push(data);
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.once('error', reject);
        child.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      const seconds = Number(text.trim());
      return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
    } catch {
      return null;
    }
  }
  // Shared by every SVC-style engine (Seed-VC, Vevo2, and later DDSP-SVC): matches the
  // converted vocal's loudness to the pre-conversion vocal, then gates it silent wherever the
  // source vocal is true digital silence, since none of these models pass true silence through
  // on their own (confirmed for Seed-VC/Vevo2 in real testing 2026-09-17; DDSP-SVC is the
  // same class of frame-aligned SVC artifact, so the fix applies unchanged). Returns the path of
  // the final gated WAV inside workDir -- caller decides where that result gets copied to.
  async function postProcessConvertedVocal(convertedVocalWav, originalVocalWav, workDir) {
    const [originalDb, convertedDb] = await Promise.all([measureMeanVolumeDb(originalVocalWav), measureMeanVolumeDb(convertedVocalWav)]);
    const gainDb = (originalDb !== null && convertedDb !== null) ? Math.max(-6, Math.min(18, originalDb - convertedDb)) : 0;
    // A plain gain boost alone clips: this class of model's raw output already peaks close to
    // 0dBFS despite being quiet on average, so matching the mean loudness (+7-8dB in real
    // testing) pushed peaks past full scale and hard-clipped. alimiter (with auto-leveling
    // disabled so it doesn't undo the gain we just asked for) compresses only the peaks that
    // would clip, instead of chopping them flat.
    const leveledVocals = path.join(workDir, 'leveled-vocals.wav');
    await new Promise((resolve, reject) => {
      const child = spawnImpl('ffmpeg', ['-y', '-i', convertedVocalWav, '-af', `volume=${gainDb}dB,alimiter=limit=0.97:level=false`, leveledVocals], { windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
    }).catch(() => { throw fail(502, '변환된 보컬의 음량을 맞추지 못했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
    // A sidechain noise gate keyed off the pre-conversion vocal forces the converted output
    // silent wherever the source actually is, which is what real singing does anyway. -ar 44100
    // also normalizes engines with a different native sample rate (e.g. vevo2's 24kHz) to match
    // the rest of the pipeline.
    const gatedVocals = path.join(workDir, 'gated-vocals.wav');
    await new Promise((resolve, reject) => {
      const child = spawnImpl('ffmpeg', ['-y', '-i', leveledVocals, '-i', originalVocalWav, '-filter_complex', 'sidechaingate=threshold=0.003:ratio=20:attack=5:release=100:range=0.02', '-ar', '44100', gatedVocals], { windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
    }).catch(() => { throw fail(502, '변환된 보컬의 무음 구간을 정리하지 못했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
    return gatedVocals;
  }
  // Seed-VC only converts a single voice track, so the completed song's vocals must be pulled out
  // first (reusing the mel_band_roformer STEM split) -- the instrumental is left alone and mixed
  // back in client-side by the STEM1-style editor UI (VocalTimbreDialog), not here.
  //
  // The separated (pre-conversion) vocal is cached as vocals-original.wav so repeated "적용" clicks
  // with a different reference re-convert from the same clean source instead of compounding
  // conversions, while the servable vocals.wav (read by the existing GET /stems/vocals route) is
  // overwritten with each new conversion result -- this lets the frontend reuse the STEM dialog's
  // existing per-stem fetch/decode/waveform code unchanged.
  //
  // Seed-VC's raw output measured ~7-10dB quieter than the original (pre-conversion) vocal in
  // real testing (2026-09-16) -- quiet enough that once mixed with the instrumental it sounded
  // like the vocal had vanished entirely, not just changed timbre. So before anything else uses
  // the converted vocal, its level is matched to the pre-conversion vocal's measured loudness.
  // stems: 이 소스 오디오의 스템 캐시 디렉터리(prepareTimbrePreview()가 이미 vocals-original.wav를
  // 채워둔 상태여야 함 -- 이 함수는 더 이상 분리를 직접 하지 않는다). 프로젝트와 무관, "음색 변조"
  // 팝업이 라이브러리에서 자유롭게 고른 원본 오디오에 대해서도 그대로 쓸 수 있다.
  async function applyVocalTimbreCore(stems, voiceRefDataUrl, engineChoice, engineOptions, onProgress) {
    const svcEngine = VOCAL_TIMBRE_ENGINES.has(engineChoice) ? engineChoice : 'seed_vc';
    const options = engineOptions && typeof engineOptions === 'object' ? engineOptions : {};
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    if (!(await exists(engine))) throw fail(400, `audio.cpp 실행 파일을 찾을 수 없습니다: ${path.relative(root, engine)}. 설정에서 경로를 확인해 주세요.`);
    if (svcEngine === 'vevo2') {
      if (!(await exists(path.join(root, VEVO2_MODEL_PATH)))) throw fail(400, 'Vevo2 모델이 없습니다. scripts/download_models.py를 실행해 주세요.');
    } else if (svcEngine === 'seed_vc' && !(await exists(path.join(root, SEED_VC_MODEL_PATH)))) throw fail(400, 'Seed-VC 모델이 없습니다. scripts/download_models.py를 실행해 주세요.');
    const needsReference = svcEngine !== 'rvc';
    const match = typeof voiceRefDataUrl === 'string' && voiceRefDataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (needsReference && !match) throw fail(400, '목표 음색의 참조 오디오(MP3/WAV/FLAC/M4A/OGG)를 선택해 주세요.');
    const ext = match ? AUDIO_MIME[match[1]] : 'wav';
    if (!ext) throw fail(400, '지원하지 않는 오디오 형식입니다. MP3/WAV/FLAC/M4A/OGG 파일을 사용해 주세요.');
    const buffer = match ? Buffer.from(match[2], 'base64') : Buffer.alloc(0);
    if (buffer.length > 50 * 1024 * 1024) throw fail(413, '참조 오디오 파일이 너무 큽니다. 50MB 이하로 줄여 주세요.');
    const originalVocalsWav = path.join(stems, 'vocals-original.wav');
    if (!(await exists(originalVocalsWav))) throw fail(502, '보컬/악기 분리 결과를 찾을 수 없습니다.');
    const workDir = path.join(outputDirectory, `vocal-convert-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    try {
      const voiceRefSource = path.join(workDir, `voice-ref.${ext}`);
      if (needsReference) await writeFile(voiceRefSource, buffer);
      // Must be a different filename from voiceRefSource -- when the reference clip is itself a
      // .wav, both used to resolve to the same "voice-ref.wav" path, so ffmpeg was asked to read
      // and write the same file at once ("FFmpeg cannot edit existing files in-place") and always
      // failed with a misleading "ffmpeg가 설치되어 있는지 확인해 주세요" error (2026-09-16, real bug).
      const voiceRefWav = path.join(workDir, 'voice-ref-normalized.wav');
      if (needsReference) await runFfmpegCli(['-y', '-i', voiceRefSource, '-ar', '44100', '-ac', '1', voiceRefWav], '참조 오디오 변환');
      // One conversion call per (chunk of the) vocal, whatever the engine.
      const convertOne = async (sourceWav, outputWav) => {
        if (svcEngine === 'vevo2') await runVevo2Svc(sourceWav, voiceRefWav, outputWav, options.vevoRoute);
        else if (svcEngine === 'rvc') await runRvcSvc(sourceWav, outputWav, options);
        else await runSeedVcSvc(sourceWav, voiceRefWav, outputWav, options);
      };

      // 긴 보컬은 겹치는 10초 창으로 나눠 처리한다. Seed-VC/Vevo2는 소스
      // 전체를 한 번에 변환할 때 길어질수록 점점 노이즈/변형으로 무너지는 것이 실제 테스트로
      // 확인됐다(10초는 들을 만한데 2분이 되면 이상한 소리만 나오는 증상, 2026-09-22). 참조
      // 목소리(voiceRefWav)는 조각과 무관해 모든 조각에 같은 것을 사용하며, 겹친 양 끝을 1초씩
      // 잘라 이어붙인다.
      const durationMs = await measureDurationMs(originalVocalsWav);
      const durationSeconds = durationMs ? durationMs / 1000 : 0;
      const chunkParams = resolveChunkParams(options.chunkSeconds, options.overlapSeconds);
      // RVC splits long audio at quiet points by itself (and reloads ~1 GB of weights per run), so it takes the whole vocal.
      // Seed-VC/Vevo collapse on long input and still need the overlapping 10 s windows.
      const useChunking = svcEngine !== 'rvc' && durationSeconds > chunkParams.chunkSeconds;
      const chunkPlan = useChunking ? buildChunkPlan(durationSeconds, chunkParams.chunkSeconds, chunkParams.overlapSeconds) : [];
      const warning = useChunking
        ? `긴 보컬을 ${chunkParams.chunkSeconds}초 단위(겹침 ${chunkParams.overlapSeconds}초)로 ${chunkPlan.length}개로 나눠 같은 참조 목소리로 변환한 뒤 연결했습니다. 조각 경계 부근에서 음색 전환이 어색할 수 있습니다.`
        : null;

      const convertedVocals = path.join(workDir, 'converted-vocals.wav');
      const runFfmpeg = (args, label) => runFfmpegCli(args, label);

      if (useChunking) {
        const stitchedParts = [];
        if (typeof onProgress === 'function') onProgress(5, '보컬 조각 준비 중 (0/' + chunkPlan.length + ')');
        for (let index = 0; index < chunkPlan.length; index += 1) {
          const chunk = chunkPlan[index];
          const chunkSource = path.join(workDir, `chunk-${String(index).padStart(3, '0')}.wav`);
          const sourceFilter = `atrim=start=${chunk.start.toFixed(3)}:duration=${chunk.duration.toFixed(3)},asetpts=PTS-STARTPTS`;
          await runFfmpeg(['-y', '-i', originalVocalsWav, '-af', sourceFilter, '-ar', '44100', '-ac', '1', chunkSource], '보컬 입력 조각 생성');
          const rawOutput = path.join(workDir, `chunk-${String(index).padStart(3, '0')}-raw.wav`);
          await convertOne(chunkSource, rawOutput);
          const stitchedPart = path.join(workDir, `chunk-${String(index).padStart(3, '0')}-stitched.wav`);
          const trimStart = index === 0 ? 0 : chunkParams.edgeTrimSeconds;
          const trimEnd = index === chunkPlan.length - 1 ? null : Math.max(trimStart, chunk.duration - chunkParams.edgeTrimSeconds);
          const trimFilter = `atrim=start=${trimStart.toFixed(3)}${trimEnd === null ? '' : `:end=${trimEnd.toFixed(3)}`},asetpts=PTS-STARTPTS`;
          await runFfmpeg(['-y', '-i', rawOutput, '-af', trimFilter, '-ar', '44100', '-ac', '1', stitchedPart], '보컬 결과 조각 정리');
          stitchedParts.push(stitchedPart);
          if (typeof onProgress === 'function') onProgress(Math.round(5 + ((index + 1) / chunkPlan.length) * 85), `음색 변환 중 (${index + 1}/${chunkPlan.length})`);
        }
        const concatInputs = stitchedParts.flatMap((file) => ['-i', file]);
        const concatFilter = `${stitchedParts.map((_, index) => `[${index}:a]`).join('')}concat=n=${stitchedParts.length}:v=0:a=1[out]`;
        await runFfmpeg(['-y', ...concatInputs, '-filter_complex', concatFilter, '-map', '[out]', '-ar', '44100', '-ac', '1', convertedVocals], '보컬 결과 조각 연결');
      } else {
        await convertOne(originalVocalsWav, convertedVocals);
      }
      const gatedVocals = await postProcessConvertedVocal(convertedVocals, originalVocalsWav, workDir);
      await copyFile(gatedVocals, path.join(stems, 'vocals.wav'));
      return { ok: true, warning, chunkCount: chunkPlan.length };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // dataUrl 오디오(MP3/WAV/FLAC/M4A/OGG, 50MB 이하)를 작업 폴더에 저장한 뒤 ffmpeg로 모노 44.1kHz
  // WAV로 정규화한다. Audio Tools의 TTS/ASR/조절 작업이 공유한다.
  async function normalizeInputAudio(workDir, audioDataUrl) {
    const match = typeof audioDataUrl === 'string' && audioDataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw fail(400, '지원하지 않는 오디오 형식입니다.');
    const ext = AUDIO_MIME[match[1]];
    if (!ext) throw fail(400, '지원하지 않는 오디오 형식입니다. MP3/WAV/FLAC/M4A/OGG 파일을 사용해 주세요.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 50 * 1024 * 1024) throw fail(413, '오디오 파일이 너무 큽니다. 50MB 이하로 줄여 주세요.');
    const source = path.join(workDir, `input.${ext}`);
    await writeFile(source, buffer);
    const audioFilePath = path.join(workDir, 'input-normalized.wav');
    await runFfmpegCli(['-y', '-i', source, '-ar', '44100', '-ac', '1', audioFilePath], '입력 오디오 변환');
    return audioFilePath;
  }
  // Audio Tools TTS on audio.cpp (Qwen3-TTS / VoxCPM2 / Chatterbox ...). The text is split into
  // sentence-packed segments, each synthesized by its own audiocpp_cli run, then concatenated.
  const ttsDownloads = new Map();
  const rvcDownloads = new Map();
  // Adds downloaded community voices to the RVC voice list of the vc catalog.
  async function withInstalledRvcVoices(vcFamilies) {
    const installed = await listInstalledRvcVoices(root);
    return vcFamilies.map((family) => (family.id === 'rvc' ? { ...family, voices: [...(family.voices || []), ...installed.map((voice) => ({ id: voice.id, label: `${voice.name} · 다운로드${voice.hasIndex ? '' : ' (블렌딩 불가)'}`, hasIndex: voice.hasIndex }))] } : family));
  }
  async function runTtsCli(args, outputWav = args[args.indexOf('--out') + 1]) {
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(engine, ['--backend', 'cuda', ...args], { windowsHide: true, cwd: audioCppCwd(engine) });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    }).catch(() => { throw fail(502, 'TTS 엔진(audio.cpp)을 실행할 수 없습니다.'); });
    if (log.signal) throw fail(502, 'TTS 생성이 제한 시간을 넘어 중단되었습니다.');
    if (log.code !== 0 || !(await exists(outputWav))) throw fail(502, `TTS 생성에 실패했습니다 (종료 코드 ${log.code}). ${log.text.trim().slice(-500) || '알 수 없는 오류'}`);
  }
  function resolveTtsModel(input) {
    const design = input.mode === 'design';
    const preset = input.mode === 'preset';
    const familyId = text(input.family, 40);
    if ([...ASR_FAMILIES, ...VC_FAMILIES, ...EDIT_FAMILIES].some((item) => item.id === familyId)) {
      const asrModel = findTtsModel(familyId, ASR_FAMILIES.some((item) => item.id === familyId) ? 'asr' : EDIT_FAMILIES.some((item) => item.id === familyId) ? 'edit' : 'vc', text(input.size, 20), text(input.precision, 20));
      if (!asrModel) throw fail(400, '지원하지 않는 모델 조합입니다.');
      return { model: asrModel, mode: asrModel.variant.mode, design: false };
    }
    // Families without a native voice-design variant (Chatterbox etc.) always need a reference
    // clip, so in the design tab they use their reference variants and a Qwen3 VoiceDesign clip stands
    // in as the reference.
    const nativeDesign = TTS_FAMILIES.find((item) => item.id === familyId)?.variants.some((variant) => variant.mode === 'design');
    const model = findTtsModel(familyId, preset ? 'preset' : design && nativeDesign ? 'design' : 'ref', text(input.size, 20), text(input.precision, 20));
    if (!model) throw fail(400, '지원하지 않는 TTS 모델 조합입니다.');
    return { model, mode: model.variant.mode, design };
  }
  // Picks the requested ASR model, or the first installed one (Qwen3-ASR 1.7B q8 first) when none is given.
  async function resolveAsrModel(familyId, size, precision) {
    if (familyId) {
      const model = findTtsModel(familyId, 'asr', size, precision);
      if (!model) throw fail(400, '지원하지 않는 음성 인식 모델 조합입니다.');
      if (!(await isTtsModelInstalled(root, model))) throw fail(409, `${model.family.label} ${model.variant.size} ${precision} 모델이 설치되어 있지 않습니다. 모델 선택에서 '받기'를 눌러 내려받아 주세요.`);
      return model;
    }
    for (const family of ASR_FAMILIES) {
      for (const variant of [...family.variants].reverse()) {
        for (const precision of ['q8_0', 'f16']) {
          const model = findTtsModel(family.id, 'asr', variant.size, precision);
          if (model && await isTtsModelInstalled(root, model)) return model;
        }
      }
    }
    throw fail(409, '음성 인식 모델이 설치되어 있지 않습니다. 음성 인식 탭에서 모델을 받아 주세요.');
  }
  async function transcribeWav(workDir, wavPath, language = '', familyId = '', size = '', precision = '') {
    const model = await resolveAsrModel(familyId, size, precision);
    const wav16 = path.join(workDir, `asr-${randomUUID()}.wav`);
    await runFfmpegCli(['-y', '-i', wavPath, '-ar', '16000', '-ac', '1', wav16], '음성 인식 입력 변환');
    const textOut = `${wav16}.txt`;
    const languageValue = model.family.languages?.[language];
    const args = ['--task', 'asr', '--family', model.family.cliFamily, '--model', path.join(root, model.relativePath), '--audio', wav16, ...(languageValue ? ['--language', languageValue] : []), '--text', '', '--text-out', textOut];
    await runTtsCli(args, textOut);
    return (await readFile(textOut, 'utf8')).trim();
  }
  // Speech editing (DotTTS Edit). DotTTS re-synthesizes everything it is given and can garble untouched words in
  // long inputs, so the recording is split at silences into sentences: each sentence is transcribed (STT), only
  // the sentences that contain an edit are re-synthesized, and the rest of the original samples stay untouched.
  async function editSpeech(input) {
    const model = findTtsModel('dotsedit', 'edit', '기본', text(input.precision, 12) || 'q8_0');
    if (!model) throw fail(400, '지원하지 않는 대사 편집 모델 조합입니다.');
    if (!(await isTtsModelInstalled(root, model))) throw fail(409, `${model.family.label} 모델이 설치되어 있지 않습니다. 모델 선택에서 '받기'를 눌러 내려받아 주세요.`);
    const edits = (Array.isArray(input.edits) ? input.edits : []).slice(0, 20).map((item) => ({ op: ['sub', 'del', 'ins', 'apd'].includes(item?.op) ? item.op : 'sub', find: text(item?.find, 200), text: text(item?.text, 200), all: item?.all === true })).filter((item) => item.find);
    if (!edits.length) throw fail(400, '편집할 부분을 하나 이상 입력해 주세요.');
    if (edits.some((item) => item.op !== 'del' && !item.text.trim())) throw fail(400, '바꿀 말 또는 넣을 말을 입력해 주세요.');
    const workDir = path.join(outputDirectory, `speech-edit-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    try {
      const wav = await normalizeInputAudio(workDir, input.audioDataUrl);
      const { rate, samples } = readWavPcm16(await readFile(wav));
      const segments = findSpeechSegments(samples, rate);
      if (!segments.length) throw fail(400, '오디오에서 말소리를 찾지 못했습니다.');
      const languageKey = text(input.language, 8);
      const providedText = text(input.sourceText, 4000).trim();
      const segmentFile = async (index) => {
        const file = path.join(workDir, `segment-${index}.wav`);
        await writeFile(file, wavFromPcm16(samples.subarray(segments[index].start, segments[index].end), rate));
        return file;
      };
      // Transcript of every sentence (a single-sentence recording uses the text the user typed, if any).
      const transcripts = [];
      for (let index = 0; index < segments.length; index += 1) {
        if (segments.length === 1 && providedText) transcripts.push(providedText);
        else transcripts.push(await transcribeWav(workDir, await segmentFile(index), languageKey, text(input.asrFamily, 20), text(input.asrSize, 8), text(input.asrPrecision, 8)));
      }
      // Give every edit to the first sentence that contains its text (every sentence when `all` is set).
      const perSegment = segments.map(() => []);
      for (const edit of edits) {
        const hits = transcripts.map((value, index) => (value.includes(edit.find) ? index : -1)).filter((index) => index >= 0);
        if (!hits.length) throw fail(400, `원문에서 "${edit.find}"을(를) 찾지 못했습니다. 인식된 문장: ${transcripts.join(' / ').slice(0, 300)}`);
        for (const index of edit.all ? hits : hits.slice(0, 1)) perSegment[index].push(edit);
      }
      const languageValue = model.family.languages[languageKey];
      const replacements = [];
      const taggedLines = [];
      for (let index = 0; index < segments.length; index += 1) {
        if (!perSegment[index].length) continue;
        let tagged;
        try { tagged = buildEditText(transcripts[index], perSegment[index]); } catch (error) { throw fail(400, error.message); }
        const editedRaw = path.join(workDir, `edited-${index}.wav`);
        await runTtsCli(['--task', 'tts', '--family', model.family.cliFamily, '--model', path.join(root, model.relativePath), ...(languageValue ? ['--language', languageValue] : []), '--text', tagged, '--request-option', `source_audio=${await segmentFile(index)}`, '--request-option', 'template_name=edit', '--out', editedRaw]);
        const editedWav = path.join(workDir, `edited-${index}-fit.wav`);
        await runFfmpegCli(['-y', '-i', editedRaw, '-ar', String(rate), '-ac', '1', editedWav], '편집 결과 변환');
        const edited = readWavPcm16(await readFile(editedWav)).samples;
        // Short fades hide the seam between the original and the re-synthesized sentence.
        const fade = Math.min(Math.round(rate * 0.005), Math.floor(edited.length / 2));
        for (let position = 0; position < fade; position += 1) { edited[position] = Math.round(edited[position] * (position / fade)); edited[edited.length - 1 - position] = Math.round(edited[edited.length - 1 - position] * (position / fade)); }
        replacements.push({ start: segments[index].start, end: segments[index].end, samples: edited });
        taggedLines.push(tagged);
      }
      const merged = spliceSegments(samples, replacements);
      return { dataUrl: `data:audio/wav;base64,${wavFromPcm16(merged, rate).toString('base64')}`, sourceText: transcripts.join(' '), taggedText: taggedLines.join(' / '), segmentCount: segments.length, editedCount: replacements.length };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // Pitch/tempo via rubberband (independent), loudness via volume, optional broadband denoise via afftdn.
  async function adjustAudio(input) {
    const pitch = Math.max(-24, Math.min(24, Number(input.pitchSemitones) || 0));
    const speed = Math.max(0.25, Math.min(4, Number(input.speed) || 1));
    const volumeDb = Math.max(-40, Math.min(40, Number(input.volumeDb) || 0));
    const denoise = input.denoise === true;
    const filters = [];
    if (denoise) filters.push('afftdn=nr=12:nf=-30');
    if (pitch !== 0 || speed !== 1) filters.push(`rubberband=pitch=${(2 ** (pitch / 12)).toFixed(6)}:tempo=${speed}`);
    if (volumeDb !== 0) filters.push(`volume=${volumeDb}dB`);
    if (!filters.length) throw fail(400, '적용할 조절 값을 하나 이상 입력해 주세요.');
    const workDir = path.join(outputDirectory, `audio-adjust-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    try {
      const source = await normalizeInputAudio(workDir, input.audioDataUrl);
      const outputWav = path.join(workDir, 'adjusted.wav');
      await runFfmpegCli(['-y', '-i', source, '-af', filters.join(','), '-ar', '44100', '-ac', '1', outputWav], '오디오 조절');
      return { dataUrl: `data:audio/wav;base64,${(await readFile(outputWav)).toString('base64')}` };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // Typecast cloud TTS: the key is read from .env (TYPECAST_API_KEY) at call time and never sent to the browser.
  const typecastKey = () => (process.env.TYPECAST_API_KEY || '').trim();
  const typecastMissingKey = () => fail(409, 'Typecast API 키가 없습니다. 프로젝트 폴더의 .env 파일에 TYPECAST_API_KEY=발급받은키 를 추가하고 백엔드를 재시작해 주세요. (키 발급: https://studio.typecast.ai/developers/api)');
  const typecastFailure = (error) => (error instanceof TypecastError ? fail(error.status, error.message) : fail(502, `Typecast에 연결할 수 없습니다. ${(error && error.message) || ''}`.trim()));
  async function runTypecastTool(input) {
    const apiKey = typecastKey();
    if (!apiKey) throw typecastMissingKey();
    const cloneMode = input.mode === 'ref';
    let voiceId = text(input.voiceId, 80).trim();
    const description = text(input.description, 500).trim();
    if (cloneMode && !(typeof input.referenceDataUrl === 'string' && input.referenceDataUrl.length)) throw fail(400, '참조 목소리를 선택해 주세요.');
    if (!cloneMode && !voiceId && !description) throw fail(400, '음색 설명을 입력하거나 Typecast 목소리를 직접 선택해 주세요.');
    const content = text(input.text, 20000).trim();
    if (!content) throw fail(400, '말할 내용을 입력해 주세요.');
    const language = TYPECAST_LANGUAGES[input.language] ? input.language : 'auto';
    const preset = text(input.emotionPreset, 20);
    const segments = splitTtsText(content, 1500);
    const workDir = path.join(outputDirectory, `typecast-tool-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    let clonedVoiceId = '';
    let usedVoiceName = '';
    try {
      if (cloneMode) {
        // Reference clip -> Typecast instant cloning (WAV/MP3, 5-150 s); the temporary voice is deleted afterwards.
        const referenceWav = await normalizeInputAudio(workDir, input.referenceDataUrl);
        const seconds = ((await measureDurationMs(referenceWav)) || 0) / 1000;
        if (seconds && (seconds < 5 || seconds > 150)) throw fail(400, `Typecast 목소리 복제는 5~150초 길이의 참조 오디오가 필요합니다(현재 약 ${Math.round(seconds)}초).`);
        voiceId = clonedVoiceId = await cloneTypecastVoice(fetchImpl, apiKey, await readFile(referenceWav), `songyue-${randomUUID().slice(0, 8)}`).catch((error) => { throw typecastFailure(error); });
      } else if (!voiceId) {
        const picked = await recommendTypecastVoice(fetchImpl, apiKey, description).catch((error) => { throw typecastFailure(error); });
        voiceId = picked.id;
        usedVoiceName = picked.name;
      }
      const parts = [];
      for (let index = 0; index < segments.length; index += 1) {
        const emotion = input.emotion === 'preset' ? { type: 'preset', preset } : { type: 'smart', previousText: segments[index - 1]?.slice(-300), nextText: segments[index + 1]?.slice(0, 300) };
        const wav = await typecastSpeak(fetchImpl, apiKey, { voiceId, text: segments[index], language, emotion }).catch((error) => { throw typecastFailure(error); });
        const file = path.join(workDir, `seg-${String(index).padStart(3, '0')}.wav`);
        await writeFile(file, wav);
        parts.push(file);
      }
      const finalWav = path.join(workDir, 'output.wav');
      if (parts.length === 1) await copyFile(parts[0], finalWav);
      else await runFfmpegCli(['-y', ...parts.flatMap((file) => ['-i', file]), '-filter_complex', `${parts.map((_, index) => `[${index}:a]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`, '-map', '[out]', '-ar', '44100', '-ac', '1', finalWav], 'Typecast 조각 연결');
      return { dataUrl: `data:audio/wav;base64,${(await readFile(finalWav)).toString('base64')}`, segmentCount: segments.length, voiceName: usedVoiceName || undefined };
    } finally {
      if (clonedVoiceId) await deleteTypecastVoice(fetchImpl, apiKey, clonedVoiceId);
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  async function runTtsTool(input) {
    const { model, mode, design } = resolveTtsModel(input);
    if (!(await isTtsModelInstalled(root, model))) throw fail(409, `${model.family.label} ${model.variant.size} ${input.precision} 모델이 설치되어 있지 않습니다. 모델 선택에서 '받기'를 눌러 내려받아 주세요.`);
    const content = text(input.text, 20000).trim();
    if (!content) throw fail(400, '말할 내용을 입력해 주세요.');
    const description = text(input.description, 500).trim();
    if (design && !description) throw fail(400, '음색 설명을 입력해 주세요.');
    if (!design && mode === 'ref' && !(typeof input.referenceDataUrl === 'string' && input.referenceDataUrl.length)) throw fail(400, '참조 목소리를 선택해 주세요.');
    const language = ['ko', 'en'].includes(input.language) ? input.language : 'auto';
    let referenceText = design ? '' : text(input.referenceText, 1000).trim();
    let autoReferenceText = '';
    const style = STYLE_FAMILIES.includes(model.family.id) && (model.family.id !== 'qwen3' || mode === 'preset') ? text(input.style, 200).trim() : '';
    const segments = language === 'auto' ? splitTtsByScript(content, 200) : splitTtsText(content, 200);
    const workDir = path.join(outputDirectory, `tts-tool-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    try {
      let referenceWav = '';
      if (design && mode === 'ref') {
        // Render a short clean reference clip from the description with Qwen3 VoiceDesign, then clone it.
        const voiceModel = findTtsModel('qwen3', 'design', '1.7B', 'q8_0');
        if (!(await isTtsModelInstalled(root, voiceModel))) throw fail(409, `음색 설명을 참조 목소리로 만들려면 Qwen3-TTS VoiceDesign 1.7B INT8 모델이 필요합니다. Qwen3-TTS를 선택해 '받기'를 눌러 내려받아 주세요.`);
        const koreanText = language === 'ko' || (language === 'auto' && /[가-힣]/.test(content));
        referenceText = koreanText ? '안녕하세요, 저는 지금 차분하고 또렷한 목소리로 이야기하고 있습니다.' : 'Hello, I am speaking in a calm and clear voice right now.';
        referenceWav = path.join(workDir, 'design-reference.wav');
        await runTtsCli(buildTtsArgs({ model: voiceModel, mode: 'design', text: referenceText, description, language: koreanText ? 'ko' : 'en', outputWav: referenceWav, modelPath: path.join(root, voiceModel.relativePath) }));
      } else if (mode === 'ref') {
        referenceWav = await normalizeInputAudio(workDir, input.referenceDataUrl);
        // Qwen3 Base clones far better with the reference transcript; when the user left it empty,
        // transcribe the clip with Qwen3-ASR (best effort: without an installed ASR model it falls
        // back to speaker-embedding-only cloning).
        if (!referenceText && ['qwen3', 'omnivoice', 'fish'].includes(model.family.id)) {
          referenceText = await transcribeWav(workDir, referenceWav, language === 'auto' ? '' : language).catch(() => '');
          autoReferenceText = referenceText;
        }
        if (!referenceText && model.family.id === 'omnivoice') throw fail(409, 'OmniVoice는 참조 목소리 텍스트가 필요합니다. 텍스트를 직접 입력하거나 음성 인식 모델(Qwen3-ASR 등)을 설치해 주세요.');
      }
      const parts = [];
      for (let index = 0; index < segments.length; index += 1) {
        const outputWav = path.join(workDir, `seg-${String(index).padStart(3, '0')}.wav`);
        await runTtsCli(buildTtsArgs({ model, mode, text: segments[index], description, style, voiceId: text(input.voiceId, 4), language, referenceWav, referenceText, outputWav, modelPath: path.join(root, model.relativePath) }));
        parts.push(outputWav);
      }
      const finalWav = path.join(workDir, 'output.wav');
      if (parts.length === 1) await copyFile(parts[0], finalWav);
      else await runFfmpegCli(['-y', ...parts.flatMap((file) => ['-i', file]), '-filter_complex', `${parts.map((_, index) => `[${index}:a]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`, '-map', '[out]', '-ar', '44100', '-ac', '1', finalWav], 'TTS 조각 연결');
      const wavBuffer = await readFile(finalWav);
      return { dataUrl: `data:audio/wav;base64,${wavBuffer.toString('base64')}`, segmentCount: segments.length, referenceText: autoReferenceText || undefined };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // "음원 비교" 다이얼로그처럼 프로젝트와 무관하게 브라우저에서 이미 완성된(원본 그대로거나
  // 클라이언트 측 후처리를 거친) WAV 버퍼를 그대로 라이브러리에 추가할 때 쓰는 범용 저장 경로.
  async function saveArbitraryAudio(dataUrl, title) {
    const match = typeof dataUrl === 'string' && dataUrl.match(/^data:audio\/wav;base64,(.+)$/);
    if (!match) throw fail(400, '저장할 오디오(WAV) 데이터가 필요합니다.');
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > 200 * 1024 * 1024) throw fail(413, '저장할 오디오가 너무 큽니다.');
    const workDir = path.join(outputDirectory, `audio-save-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    try {
      const wavFile = path.join(workDir, 'result.wav');
      await writeFile(wavFile, buffer);
      const pseudoProject = { id: randomUUID(), title: text(title, 200).trim() || '저장된 오디오', coverPath: null };
      return await finalizeToMusic(pseudoProject, null, wavFile, { durationMs: await measureDurationMs(wavFile) });
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  async function exportMidi(entry) {
    const engine = resolveConfigPath(settings.enginePath, DEFAULT_ENGINE_PATH);
    if (!(await exists(engine))) throw fail(400, `audio.cpp 실행 파일을 찾을 수 없습니다: ${path.relative(root, engine)}. 설정에서 경로를 확인해 주세요.`);
    if (!(await exists(path.join(root, MUSCRIPTOR_MODEL_PATH)))) throw fail(400, 'MuScriptor 모델이 없습니다. scripts/download_models.py를 실행해 주세요.');
    if (!entry.project.audioPath) throw fail(404, '완성된 음원을 찾을 수 없습니다.');
    const dir = path.dirname(entry.file);
    const sourceFile = path.join(dir, entry.project.audioPath);
    if (!(await exists(sourceFile))) throw fail(404, '음원 파일을 찾을 수 없습니다.');
    const base = path.basename(entry.project.audioPath, path.extname(entry.project.audioPath));
    const midiFile = path.join(dir, `${base}.mid`);
    const notesFile = path.join(dir, `${base}.notes.json`);
    const [sourceStat, midiStat, notesStat] = await Promise.all([stat(sourceFile), stat(midiFile).catch(() => null), stat(notesFile).catch(() => null)]);
    if (midiStat && notesStat && midiStat.mtimeMs >= sourceStat.mtimeMs && notesStat.mtimeMs >= sourceStat.mtimeMs) return { midiFile, notesFile };
    const workDir = path.join(outputDirectory, `midi-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    try {
      const sourceWav = path.join(workDir, 'source.wav');
      await new Promise((resolve, reject) => {
        const child = spawnImpl('ffmpeg', ['-y', '-i', sourceFile, '-ar', '44100', '-ac', '2', sourceWav], { windowsHide: true });
        child.once('error', reject);
        child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
      }).catch(() => { throw fail(502, 'MIDI 추출을 위한 오디오 변환에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.'); });
      const tempMidi = path.join(workDir, 'result.mid');
      const tempNotes = path.join(workDir, 'result.json');
      const args = ['--task', 'midi', '--family', 'muscriptor', '--model', path.join(root, MUSCRIPTOR_MODEL_PATH), '--backend', 'cuda', '--audio', sourceWav, '--out', tempMidi, '--text-out', tempNotes];
      const log = await new Promise((resolve, reject) => {
        const child = spawnImpl(engine, args, { windowsHide: true, cwd: audioCppCwd(engine) });
        const chunks = [];
        let size = 0;
        const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
        child.once('error', (error) => { clearTimeout(timer); reject(error); });
        child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
      }).catch(() => { throw fail(502, 'MuScriptor 엔진을 실행할 수 없습니다.'); });
      if (log.signal) throw fail(502, 'MIDI 추출이 제한 시간을 넘어 중단되었습니다.');
      if (log.code !== 0 || !(await exists(tempMidi))) throw fail(502, `MIDI 추출에 실패했습니다 (종료 코드 ${log.code}). ${log.text.trim().slice(0, 500) || '알 수 없는 오류'}`);
      const rawEvents = (await exists(tempNotes)) ? JSON.parse(await readFile(tempNotes, 'utf8')) : [];
      const notes = parseNoteEvents(rawEvents);
      await copyFile(tempMidi, midiFile);
      await writeFile(notesFile, JSON.stringify(notes), 'utf8');
      return { midiFile, notesFile };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  function parseMidiNotes(rawNotes) {
    return (Array.isArray(rawNotes) ? rawNotes : []).map((note, index) => {
      const pitch = Number(note?.pitch);
      const start = Number(note?.start);
      const end = Number(note?.end);
      if (!Number.isFinite(pitch) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw fail(400, '유효하지 않은 음표 데이터입니다.');
      }
      return { id: index, pitch, start, end, instrument: typeof note?.instrument === 'string' && note.instrument ? note.instrument : 'acoustic_piano' };
    });
  }
  async function saveMidiNotes(entry, rawNotes) {
    if (!entry.project.audioPath) throw fail(404, '완성된 음원을 찾을 수 없습니다.');
    const dir = path.dirname(entry.file);
    const base = path.basename(entry.project.audioPath, path.extname(entry.project.audioPath));
    const midiFile = path.join(dir, `${base}.mid`);
    const notesFile = path.join(dir, `${base}.notes.json`);
    const notes = parseMidiNotes(rawNotes);
    await writeFile(midiFile, encodeMidiFile(notes));
    await writeFile(notesFile, JSON.stringify(notes), 'utf8');
    return midiFile;
  }
  let gpuInfoCache = null;
  async function detectGpu() {
    if (gpuInfoCache) return gpuInfoCache;
    gpuInfoCache = await new Promise((resolve) => {
      let out = '';
      const child = spawnImpl('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { windowsHide: true });
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.once('error', () => resolve({ vramMb: null }));
      child.once('close', (code) => {
        const value = Number.parseInt(out.trim().split('\n')[0], 10);
        resolve(code === 0 && Number.isFinite(value) ? { vramMb: value } : { vramMb: null });
      });
    });
    return gpuInfoCache;
  }
  function pythonEngineOrFail() {
    const python = resolveOptionalConfigPath(settings.pythonEnginePath);
    const script = resolveOptionalConfigPath(settings.pythonScriptPath);
    if (!python) throw fail(400, '설정에서 Python 실행 파일 경로를 확인해 주세요.');
    if (!script) throw fail(400, '설정에서 Python 스크립트(run_yue2.py) 경로를 확인해 주세요.');
    return { python, script };
  }
  function pythonRequestFields(project) {
    return { style: `${project.style}${styleHint(project)}`, lyrics: project.lyrics, cot: project.cot, seed: project.seed };
  }
  function pythonModelFor(project) {
    return PYTHON_MODELS[project.modelId] || PYTHON_MODELS['yue2-original'];
  }
  async function runPythonAction(action, project, extraArgs, expectedMs) {
    const { python, script } = pythonEngineOrFail();
    if (!(await exists(python))) throw fail(400, '설정에서 Python 실행 파일 경로를 확인해 주세요.');
    if (!(await exists(script))) throw fail(400, '설정에서 Python 스크립트(run_yue2.py) 경로를 확인해 주세요.');
    const selected = pythonModelFor(project);
    const modelDir = path.join(root, selected.modelDir);
    const vaeDir = path.join(root, selected.vaeDir);
    if (!(await exists(modelDir)) || !(await exists(vaeDir))) throw fail(400, '원본 모델 파일이 없습니다. 모델 관리 화면에서 다운로드 상태를 확인해 주세요.');
    if (!project.lyrics.trim() || !project.style.trim()) throw fail(400, '가사와 음악 스타일이 필요합니다.');
    if (project.abc && project.abc.trim() && project.cot === 'off') throw fail(400, '악보를 사용하려면 작곡 계획을 "멜로디 계획" 또는 "멜로디와 코드 계획"으로 설정해 주세요.');
    if (action === 'plan' && project.cot === 'off') throw fail(400, '"계획 없이 생성"에서는 심볼릭 작곡을 만들 수 없습니다. 작곡 계획을 바꿔 주세요.');
    const projectRuns = path.join(outputDirectory, project.id);
    await mkdir(projectRuns, { recursive: true });
    const requestFile = path.join(projectRuns, `py-request-${action}.json`);
    const outDir = path.join(projectRuns, `py-${action}`);
    await rm(outDir, { recursive: true, force: true });
    const logFile = path.join(projectRuns, `${action}.log`);
    // yue2's SongRequest.id must match [A-Za-z0-9][A-Za-z0-9_.-]{0,179} (ASCII only), so a
    // Korean or otherwise non-ASCII title cannot be used directly; fall back to the project id.
    const asciiSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const slug = asciiSlug ? `${asciiSlug}-${project.id.slice(0, 8)}` : `song-${project.id.slice(0, 8)}`;
    const request = { id: slug, ...pythonRequestFields(project) };
    await writeFile(requestFile, JSON.stringify(request), 'utf8');
    const args = [script, action, '--request', requestFile, '--output', outDir, '--model', modelDir, '--vae', vaeDir, '--offline', '--memory-budget-gib', String(settings.pythonMemoryBudgetGib || 11), ...extraArgs];
    generationStatus = { projectId: project.id, startedAt: Date.now(), expectedMs };
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(python, args, { windowsHide: true, cwd: path.dirname(script) });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    }).catch(() => { throw fail(502, 'Python 엔진을 실행할 수 없습니다. 설정의 Python/스크립트 경로를 확인해 주세요.'); });
    await writeFile(logFile, log.text);
    if (log.signal) throw fail(502, `${action === 'plan' ? '심볼릭 작곡' : '음악 생성'}이 제한 시간을 넘어 중단되었습니다.`);
    return { outDir, log };
  }
  async function stripVocalVoice(abcText, projectRuns) {
    const { python, script } = pythonEngineOrFail();
    const abcToolsScript = path.join(path.dirname(script), 'abc_tools.py');
    if (!(await exists(abcToolsScript))) throw fail(400, 'abc_tools.py를 찾을 수 없습니다. Python 스크립트 경로를 확인해 주세요.');
    const sourceFile = path.join(projectRuns, `vocal-source-${randomUUID()}.abc`);
    const strippedFile = path.join(projectRuns, `instrumental-${randomUUID()}.abc`);
    await writeFile(sourceFile, abcText, 'utf8');
    const result = await new Promise((resolve, reject) => {
      const child = spawnImpl(python, [abcToolsScript, 'mute-voice', sourceFile, strippedFile, '--keep-voice', 'Ins'], { windowsHide: true, cwd: path.dirname(script) });
      const chunks = [];
      child.stdout.on('data', (chunk) => chunks.push(chunk));
      child.stderr.on('data', (chunk) => chunks.push(chunk));
      child.once('error', reject);
      child.once('close', (code) => resolve({ text: Buffer.concat(chunks).toString('utf8'), code }));
    });
    if (result.code !== 0 || !(await exists(strippedFile))) throw fail(502, `악기만 생성을 위해 보컬 성부를 지우지 못했습니다: ${result.text.trim().slice(0, 500) || '알 수 없는 오류'}`);
    return readFile(strippedFile, 'utf8');
  }
  async function runPythonYue2(project, file) {
    const extraArgs = [];
    const projectRuns = path.join(outputDirectory, project.id);
    await mkdir(projectRuns, { recursive: true });
    let effectiveProject = project;
    if (project.instrumental) {
      // audio.cpp/YuE2 always requires non-empty lyrics and has no dedicated instrumental
      // flag, but a symbolic plan whose Vocal voice is entirely rests gives the model no
      // melody to sing over, which is far more reliable than the style-text hint alone.
      let sourceAbc = project.abc && project.abc.trim() ? project.abc : null;
      if (!sourceAbc) {
        const planProject = { ...project, cot: project.cot === 'off' ? 'full' : project.cot };
        const { outDir: planOutDir } = await runPythonAction('plan', planProject, [], 20000);
        const planAbcFile = path.join(planOutDir, 'score.abc');
        if (!(await exists(planAbcFile))) throw fail(502, '악기만 생성을 위한 심볼릭 작곡에 실패했습니다.');
        sourceAbc = await readFile(planAbcFile, 'utf8');
      }
      const instrumentalAbc = await stripVocalVoice(sourceAbc, projectRuns);
      const abcFile = path.join(projectRuns, 'input.abc');
      await writeFile(abcFile, instrumentalAbc, 'utf8');
      extraArgs.push('--abc-file', abcFile);
      effectiveProject = { ...project, cot: project.cot === 'off' ? 'melody' : project.cot, abc: instrumentalAbc };
    } else if (project.abc && project.abc.trim()) {
      const abcFile = path.join(projectRuns, 'input.abc');
      await writeFile(abcFile, project.abc, 'utf8');
      extraArgs.push('--abc-file', abcFile);
    }
    const { outDir, log } = await runPythonAction('generate', effectiveProject, extraArgs, 90000);
    const audioFile = path.join(outDir, 'audio.flac');
    const resultFile = path.join(outDir, 'result.json');
    if (!(await exists(audioFile))) {
      if (log.text.includes('melody input still contains chords')) throw fail(400, '이 악보에는 코드 기호가 있어 "멜로디 계획"에 쓸 수 없습니다. 작곡 계획을 "멜로디와 코드 계획"으로 바꾸거나, 코드 기호가 없는 악보를 사용해 주세요.');
      if (log.text.includes('off cannot accept ABC')) throw fail(400, '"계획 없이 생성"에서는 악보를 사용할 수 없습니다. 작곡 계획을 바꿔 주세요.');
      throw fail(502, `음악 생성에 실패했습니다 (종료 코드 ${log.code}). VRAM 부족이거나 요청이 너무 무거울 수 있습니다. runs/${project.id}/generate.log에서 로그를 확인해 주세요.`);
    }
    let truncated = false;
    let durationMs = null;
    const result = await readJson(resultFile, null);
    if (result) {
      truncated = Boolean(result.truncated && Object.values(result.truncated).some(Boolean));
      if (Number.isFinite(result.audio_seconds)) durationMs = Math.round(result.audio_seconds * 1000);
    }
    return finalizeToMusic(project, file, audioFile, { truncated, durationMs });
  }
  async function ensureComfyUiRunning() {
    const endpoint = settings.comfyUiEndpoint || DEFAULT_COMFYUI_ENDPOINT;
    if (await comfyUiAlive(fetchImpl, endpoint)) return endpoint;
    const enginePath = resolveConfigPath(settings.comfyUiEnginePath, DEFAULT_COMFYUI_ENGINE_PATH);
    const python = path.join(enginePath, '.venv', 'Scripts', 'python.exe');
    if (!(await exists(python))) throw fail(400, `ComfyUI 실행 파일을 찾을 수 없습니다: ${path.relative(root, python) || python}. 설정에서 ComfyUI 설치 경로를 확인해 주세요.`);
    let url;
    try { url = new URL(endpoint); } catch { throw fail(400, 'ComfyUI 연결 주소가 올바르지 않습니다. 설정에서 확인해 주세요.'); }
    // ComfyUI is a long-running server, not a spawn-per-request CLI like audio.cpp/Python --
    // detached + unref so it outlives this request and is reused by later generations.
    const child = spawnImpl(python, ['main.py', '--listen', url.hostname, '--port', url.port || '8188', '--disable-auto-launch'], { cwd: enginePath, windowsHide: true, detached: true, stdio: 'ignore' });
    if (typeof child.unref === 'function') child.unref();
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await comfyUiAlive(fetchImpl, endpoint)) return endpoint;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw fail(502, 'ComfyUI 엔진이 60초 안에 시작되지 않았습니다. 직접 실행되어 있는지 확인한 뒤 다시 시도해 주세요.');
  }
  async function runComfyUi(project, file) {
    const preset = COMFYUI_MODELS[project.modelId];
    if (!preset) throw fail(400, '이 모델은 ComfyUI로 생성할 수 없습니다.');
    if (!project.lyrics.trim() || !project.style.trim()) throw fail(400, '가사와 음악 스타일이 필요합니다.');
    if (project.abc && project.abc.trim() && project.cot === 'off') throw fail(400, '악보를 사용하려면 작곡 계획을 "멜로디 계획" 또는 "멜로디와 코드 계획"으로 설정해 주세요.');
    const projectRuns = path.join(outputDirectory, project.id);
    await mkdir(projectRuns, { recursive: true });
    // YuE2GenerateMusic ignores `mode` and forces internal "off" behavior whenever `abc` is
    // empty (see comfyui.mjs), so cot='full'/'melody' without a user-supplied score needs an
    // explicit planning pass first to match audio.cpp/Python's auto-plan-then-generate behavior.
    let effectiveAbc = '';
    let effectiveMode = project.cot === 'melody' ? 'melody' : 'full';
    if (project.instrumental) {
      let sourceAbc = project.abc && project.abc.trim() ? project.abc : null;
      if (!sourceAbc) {
        const planProject = { ...project, cot: project.cot === 'off' ? 'full' : project.cot };
        const { outDir: planOutDir } = await runPythonAction('plan', planProject, [], 20000);
        const planAbcFile = path.join(planOutDir, 'score.abc');
        if (!(await exists(planAbcFile))) throw fail(502, '악기만 생성을 위한 심볼릭 작곡에 실패했습니다.');
        sourceAbc = await readFile(planAbcFile, 'utf8');
      }
      effectiveAbc = await stripVocalVoice(sourceAbc, projectRuns);
    } else if (project.abc && project.abc.trim()) {
      effectiveAbc = project.abc;
    } else if (project.cot !== 'off') {
      const { outDir: planOutDir } = await runPythonAction('plan', project, [], 20000);
      const planAbcFile = path.join(planOutDir, 'score.abc');
      if (await exists(planAbcFile)) effectiveAbc = await readFile(planAbcFile, 'utf8');
    }
    const endpoint = await ensureComfyUiRunning();
    let result;
    try {
      result = await executeComfyUi(fetchImpl, endpoint, {
        checkpoint: preset.checkpoint,
        style: `${project.style}${styleHint(project)}`,
        lyrics: project.lyrics,
        abc: effectiveAbc,
        seed: project.seed,
        mode: effectiveMode,
        maxDuration: COMFYUI_MAX_DURATION_SECONDS,
        steps: project.steps,
        filenamePrefix: `songyue2/${project.id}`,
        clientId: `songyue2-${project.id}`,
        deadlineMs: COMFYUI_GENERATE_DEADLINE_MS,
      });
    } catch (error) { throw fail(502, `ComfyUI 음악 생성에 실패했습니다: ${error.message}`); }
    const audioFile = path.join(projectRuns, `audio${path.extname(result.filename) || '.flac'}`);
    await writeFile(audioFile, result.bytes);
    const durationMs = await measureDurationMs(audioFile);
    return finalizeToMusic(project, file, audioFile, { durationMs });
  }
  function sheetSagePythonOrFail() {
    const python = resolveOptionalConfigPath(settings.sheetSagePythonPath);
    const script = resolveOptionalConfigPath(settings.pythonScriptPath);
    if (!python) throw fail(400, '설정에서 SheetSage2 Python 실행 파일 경로를 확인해 주세요.');
    if (!script) throw fail(400, '설정에서 Python 스크립트(run_yue2.py) 경로를 확인해 주세요.');
    return { python, transcribeScript: path.join(path.dirname(script), 'transcribe.py') };
  }
  async function runTranscribe(audioFile, task) {
    const { python, transcribeScript } = sheetSagePythonOrFail();
    if (!(await exists(python))) throw fail(400, '설정에서 SheetSage2 Python 실행 파일 경로를 확인해 주세요. (별도 venv 설치가 필요합니다)');
    if (!(await exists(transcribeScript))) throw fail(400, 'transcribe.py를 찾을 수 없습니다. SheetSage2 스킬 설치를 확인해 주세요.');
    const sheetSageDir = path.join(root, 'models', 'm-a-p', 'SheetSage2');
    const hasLocalSheetSage = await exists(path.join(sheetSageDir, 'config.json')) && await exists(path.join(sheetSageDir, 'model.safetensors'));
    const outDir = path.join(outputDirectory, 'cover-transcribe', randomUUID());
    // transcribe.py creates outDir itself via a "fresh_directory" helper that requires the
    // path not already exist (exist_ok=False), as a safety check against reusing a stale run's
    // directory -- only ensure its parent exists here, or the script's own mkdir collides with
    // one the backend already did and fails immediately.
    await mkdir(path.dirname(outDir), { recursive: true });
    const args = [transcribeScript, audioFile, '--output', outDir, '--task', task, ...(hasLocalSheetSage ? ['--model', sheetSageDir, '--offline'] : [])];
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(python, args, { windowsHide: true, cwd: path.dirname(transcribeScript) });
      const chunks = [];
      let size = 0;
      const collect = (data) => { size += data.length; if (size < 512 * 1024) chunks.push(data); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      const timer = setTimeout(() => child.kill(), GENERATE_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ text: Buffer.concat(chunks).toString('utf8'), code, signal }); });
    }).catch(() => { throw fail(502, 'SheetSage2 전사 스크립트를 실행할 수 없습니다. 설정의 Python 경로를 확인해 주세요.'); });
    // The script may have failed before ever creating outDir itself (e.g. an import error),
    // so make sure it exists before writing the log -- mkdir recursive is safe to call even
    // if transcribe.py already created it, unlike fresh_directory's exist_ok=False.
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, 'run.log'), log.text);
    const abcFile = path.join(outDir, 'score.abc');
    if (!(await exists(abcFile))) {
      const failure = await readJson(path.join(outDir, 'failure.json'), null);
      throw fail(502, failure ? `멜로디 추출에 실패했습니다: ${failure.error}` : `멜로디 추출에 실패했습니다 (종료 코드 ${log.code}). 로그: ${outDir}/run.log`);
    }
    return { abc: await readFile(abcFile, 'utf8'), outDir };
  }
  const publicSettings = () => {
    const env = providerFromEnv(settings.provider);
    return { provider: settings.provider, endpoint: env.endpoint, llmModel: env.model, enginePath: settings.enginePath, pythonEnginePath: settings.pythonEnginePath, pythonScriptPath: settings.pythonScriptPath, pythonMemoryBudgetGib: settings.pythonMemoryBudgetGib, sheetSagePythonPath: settings.sheetSagePythonPath, comfyUiEndpoint: settings.comfyUiEndpoint, comfyUiEnginePath: settings.comfyUiEnginePath, ddspSvcPath: settings.ddspSvcPath, settingPath: settings.settingPath, musicPath: settings.musicPath, examplesPath: settings.examplesPath, coversPath: settings.coversPath, abcNotesPath: settings.abcNotesPath, stylePresets: settings.stylePresets, visualizerEnabled: settings.visualizerEnabled, visualizerRingCount: settings.visualizerRingCount, visualizerHue: settings.visualizerHue, visualizerLineWidth: settings.visualizerLineWidth, visualizerTrail: settings.visualizerTrail, visualizerSpiral: settings.visualizerSpiral, visualizerRingMode: settings.visualizerRingMode, visualizerTimeStep: settings.visualizerTimeStep, visualizerTimeSkew: settings.visualizerTimeSkew, visualizerRingStep: settings.visualizerRingStep, visualizerAmplitude: settings.visualizerAmplitude, saveFormat: settings.saveFormat, viewMode: settings.viewMode, outputDirectory: path.relative(root, outputDirectory) || '.', hasApiKey: Boolean(env.apiKey), apiKey: env.apiKey ? '***' : null, apiKeyStorage: 'env' };
  };
  async function localFile(relativePath) {
    const file = path.join(root, relativePath);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    return { path: relativePath.replaceAll(path.sep, '/'), size: info.size, state: 'complete', completedBytes: info.size };
  }
  async function localModelRepositories() {
    const specs = [
      { id: 'comfy-org/YuE2', path: path.join('models', 'comfy-org', 'YuE2'), files: [path.join('models', 'comfy-org', 'YuE2', 'checkpoints', 'yue2_3b_int8_convrot.safetensors')] },
      { id: 'm-a-p/SheetSage2', path: path.join('models', 'm-a-p', 'SheetSage2'), files: [path.join('models', 'm-a-p', 'SheetSage2', 'model.safetensors'), path.join('models', 'm-a-p', 'SheetSage2', 'config.json')] },
    ];
    const repositories = [];
    for (const spec of specs) {
      const files = (await Promise.all(spec.files.map(localFile))).filter(Boolean);
      if (!files.length) continue;
      const completedBytes = files.reduce((sum, file) => sum + file.completedBytes, 0);
      repositories.push({ id: spec.id, revision: 'local', path: spec.path.replaceAll(path.sep, '/'), state: files.length === spec.files.length ? 'complete' : 'partial', totalBytes: completedBytes, completedBytes, files });
    }
    return repositories;
  }
  async function upstream(url, options = {}) {
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok) {
        const hint = response.status === 401 || response.status === 403 ? 'API 키와 접근 권한을 확인해 주세요.' : response.status === 429 ? '사용 한도나 요청 횟수를 확인한 뒤 다시 시도해 주세요.' : '모델 이름과 제공업체 설정을 확인해 주세요.';
        throw fail(502, `LLM 요청에 실패했습니다 (${response.status}). ${hint}`);
      }
      return await response.json();
    } catch (error) {
      if (error.status) throw error;
      throw fail(502, 'LLM에 연결할 수 없습니다. 실행 상태와 주소를 확인하고 다시 시도해 주세요.');
    }
  }
  async function ask(prompt, test = false) {
    const provider = settings.provider;
    if (provider === 'none') throw fail(400, '설정에서 LLM 제공업체를 선택해 주세요.');
    const env = providerFromEnv(provider);
    const model = env.model;
    if (!model.trim()) throw fail(400, '.env 파일에 해당 제공업체의 모델 이름을 입력해 주세요.');
    const key = env.apiKey;
    if (provider !== 'ollama' && !key) throw fail(400, '.env 파일에 API 키를 입력해 주세요.');
    const headers = { 'Content-Type': 'application/json' };
    let url, payload, extract;
    if (provider === 'ollama') {
      url = `${env.endpoint}/api/chat`;
      payload = { model, stream: false, messages: [{ role: 'user', content: prompt }] };
      extract = result => result.message?.content;
    } else if (provider === 'claude') {
      url = env.endpoint;
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
      payload = { model, max_tokens: test ? 64 : 2048, messages: [{ role: 'user', content: prompt }] };
      extract = result => result.content?.filter(part => part.type === 'text').map(part => part.text).join('\n');
    } else if (provider === 'chatgpt') {
      url = env.endpoint;
      headers.Authorization = `Bearer ${key}`;
      payload = { model, input: prompt, store: false, max_output_tokens: test ? 1024 : 4096 };
      extract = result => result.output?.flatMap(item => item.content || []).filter(part => part.type === 'output_text').map(part => part.text).join('\n');
    } else {
      url = `${env.endpoint.replace(/\/$/, '')}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
      headers['x-goog-api-key'] = key;
      payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
      extract = result => result.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('\n');
    }
    const result = await upstream(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const answer = extract(result);
    if (!answer?.trim()) throw fail(502, 'LLM이 텍스트를 반환하지 않았습니다. 다른 모델이나 요청으로 다시 시도해 주세요.');
    return { text: answer, provider, model };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(JSON.stringify(value));
    };
    try {
      const ownPort = server.address()?.port || port;
      const validHosts = new Set([`127.0.0.1:${ownPort}`, `localhost:${ownPort}`]);
      if (!validHosts.has(req.headers.host)) throw fail(403, '이 PC에서 앱 주소로 접속해 주세요.');
      const allowedOrigins = new Set([`http://127.0.0.1:${ownPort}`, `http://localhost:${ownPort}`, 'http://localhost:5176', 'http://127.0.0.1:5176']);
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) throw fail(403, '허용되지 않은 앱 주소입니다. 로컬 앱에서 다시 시도해 주세요.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, '외부 페이지에서는 요청할 수 없습니다.');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        return res.end();
      }
      const requestUrl = new URL(req.url, `http://127.0.0.1:${ownPort}`);
      const pathname = requestUrl.pathname;
      if (req.method === 'GET' && pathname === '/api/health') return send(200, { ok: true, engineReady: await engineReady(), mode: 'local', version: '0.1.0' });
      if (req.method === 'GET' && pathname === '/api/system') return send(200, await detectGpu());
      if (req.method === 'GET' && pathname === '/api/settings') return send(200, publicSettings());
      if (req.method === 'PUT' && pathname === '/api/settings') {
        const input = await body(req);
        return send(200, await serial(async () => {
          if (input.provider !== undefined && !providers.has(input.provider)) throw fail(400, '지원하는 LLM 제공업체를 선택해 주세요.');
          if (input.saveFormat !== undefined && !SAVE_FORMATS.has(input.saveFormat)) throw fail(400, '지원하는 저장 형식을 선택해 주세요 (wav/flac/mp3/mp4).');
          if (input.viewMode !== undefined && !VIEW_MODES.has(input.viewMode)) throw fail(400, '보기 방식은 list 또는 card만 가능합니다.');
          const next = { ...settings };
          if (input.provider !== undefined) next.provider = input.provider;
          if (input.enginePath !== undefined) next.enginePath = text(input.enginePath, 2048);
          if (input.pythonEnginePath !== undefined) next.pythonEnginePath = text(input.pythonEnginePath, 2048);
          if (input.pythonScriptPath !== undefined) next.pythonScriptPath = text(input.pythonScriptPath, 2048);
          if (input.pythonMemoryBudgetGib !== undefined) next.pythonMemoryBudgetGib = Math.max(1, Math.min(64, Number(input.pythonMemoryBudgetGib) || 11));
          if (input.sheetSagePythonPath !== undefined) next.sheetSagePythonPath = text(input.sheetSagePythonPath, 2048);
          if (input.comfyUiEndpoint !== undefined) next.comfyUiEndpoint = text(input.comfyUiEndpoint, 2048);
          if (input.comfyUiEnginePath !== undefined) next.comfyUiEnginePath = text(input.comfyUiEnginePath, 2048);
          if (input.ddspSvcPath !== undefined) next.ddspSvcPath = text(input.ddspSvcPath, 2048);
          if (input.settingPath !== undefined) next.settingPath = text(input.settingPath, 2048);
          if (input.musicPath !== undefined) next.musicPath = text(input.musicPath, 2048);
          if (input.examplesPath !== undefined) next.examplesPath = text(input.examplesPath, 2048);
          if (input.coversPath !== undefined) next.coversPath = text(input.coversPath, 2048);
          if (input.abcNotesPath !== undefined) next.abcNotesPath = text(input.abcNotesPath, 2048);
          if (input.stylePresets !== undefined) next.stylePresets = text(input.stylePresets, 4000);
          if (input.visualizerEnabled !== undefined) next.visualizerEnabled = input.visualizerEnabled === true;
          if (input.visualizerRingCount !== undefined) next.visualizerRingCount = Math.max(1, Math.min(40, Math.round(Number(input.visualizerRingCount)) || DEFAULT_VISUALIZER_RING_COUNT));
          if (input.visualizerHue !== undefined) next.visualizerHue = ((Math.round(Number(input.visualizerHue)) || 0) % 360 + 360) % 360;
          if (input.visualizerLineWidth !== undefined) next.visualizerLineWidth = Math.max(0.5, Math.min(8, Number(input.visualizerLineWidth) || DEFAULT_VISUALIZER_LINE_WIDTH));
          if (input.visualizerTrail !== undefined) next.visualizerTrail = Math.max(0, Math.min(95, Number(input.visualizerTrail) || 0));
          if (input.visualizerSpiral !== undefined) next.visualizerSpiral = Math.max(0, Math.min(100, Number.isFinite(Number(input.visualizerSpiral)) ? Number(input.visualizerSpiral) : DEFAULT_VISUALIZER_SPIRAL));
          if (input.visualizerRingMode !== undefined) next.visualizerRingMode = VISUALIZER_RING_MODES.has(input.visualizerRingMode) ? input.visualizerRingMode : DEFAULT_VISUALIZER_RING_MODE;
          if (input.visualizerTimeStep !== undefined) next.visualizerTimeStep = Math.max(0.02, Math.min(2, Number.isFinite(Number(input.visualizerTimeStep)) ? Number(input.visualizerTimeStep) : DEFAULT_VISUALIZER_TIME_STEP));
          if (input.visualizerTimeSkew !== undefined) next.visualizerTimeSkew = Math.max(0.2, Math.min(4, Number.isFinite(Number(input.visualizerTimeSkew)) ? Number(input.visualizerTimeSkew) : DEFAULT_VISUALIZER_TIME_SKEW));
          if (input.visualizerRingStep !== undefined) next.visualizerRingStep = Math.max(0.1, Math.min(20, Number.isFinite(Number(input.visualizerRingStep)) ? Number(input.visualizerRingStep) : DEFAULT_VISUALIZER_RING_STEP));
          if (input.visualizerAmplitude !== undefined) next.visualizerAmplitude = Math.max(0.1, Math.min(10, Number.isFinite(Number(input.visualizerAmplitude)) ? Number(input.visualizerAmplitude) : DEFAULT_VISUALIZER_AMPLITUDE));
          if (input.saveFormat !== undefined) next.saveFormat = input.saveFormat;
          if (input.viewMode !== undefined) next.viewMode = input.viewMode;
          await saveJson(settingsFile, { provider: next.provider, enginePath: next.enginePath, pythonEnginePath: next.pythonEnginePath, pythonScriptPath: next.pythonScriptPath, pythonMemoryBudgetGib: next.pythonMemoryBudgetGib, sheetSagePythonPath: next.sheetSagePythonPath, comfyUiEndpoint: next.comfyUiEndpoint, comfyUiEnginePath: next.comfyUiEnginePath, ddspSvcPath: next.ddspSvcPath, settingPath: next.settingPath, musicPath: next.musicPath, examplesPath: next.examplesPath, coversPath: next.coversPath, abcNotesPath: next.abcNotesPath, stylePresets: next.stylePresets, visualizerEnabled: next.visualizerEnabled, visualizerRingCount: next.visualizerRingCount, visualizerHue: next.visualizerHue, visualizerLineWidth: next.visualizerLineWidth, visualizerTrail: next.visualizerTrail, visualizerSpiral: next.visualizerSpiral, visualizerRingMode: next.visualizerRingMode, visualizerTimeStep: next.visualizerTimeStep, visualizerTimeSkew: next.visualizerTimeSkew, visualizerRingStep: next.visualizerRingStep, visualizerAmplitude: next.visualizerAmplitude, saveFormat: next.saveFormat, viewMode: next.viewMode });
          settings = next;
          if (input.settingPath !== undefined) await mkdir(settingDir(), { recursive: true });
          if (input.musicPath !== undefined) await mkdir(musicDir(), { recursive: true });
          if (input.examplesPath !== undefined) await mkdir(examplesDir(), { recursive: true });
          if (input.coversPath !== undefined) await mkdir(coversDir(), { recursive: true });
          if (input.abcNotesPath !== undefined) await mkdir(abcNotesDir(), { recursive: true });
          return publicSettings();
        }));
      }
      if (req.method === 'GET' && pathname === '/api/models') {
        const inventory = await readJson(path.join(root, 'model-download-status.json'), { schemaVersion: 1, updatedAt: null, state: 'not_started', totalBytes: 0, completedBytes: 0, repositories: [] });
        const localRepositories = await localModelRepositories();
        const localBytes = localRepositories.reduce((sum, repo) => sum + repo.completedBytes, 0);
        return send(200, { ...inventory, totalBytes: inventory.totalBytes + localBytes, completedBytes: inventory.completedBytes + localBytes, repositories: [...(inventory.repositories || []), ...localRepositories], engineReady: await engineReady() });
      }
      if (req.method === 'GET' && pathname === '/api/examples') return send(200, await listExamples());
      if (req.method === 'POST' && pathname === '/api/examples') {
        const input = await body(req);
        const title = text(input.title, 200).trim() || '제목 없는 예시';
        const style = text(input.style, 4000);
        const lyrics = text(input.lyrics);
        if (!style.trim() || !lyrics.trim()) throw fail(400, '스타일과 가사가 필요합니다.');
        return send(201, await serial(async () => {
          const dir = examplesDir();
          await mkdir(dir, { recursive: true });
          const createdAt = new Date().toISOString();
          const count = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json')).length;
          const example = { id: randomUUID(), title, genre: text(input.genre, 60), caption: text(input.caption, 200), color: EXAMPLE_COLORS[count % EXAMPLE_COLORS.length], style, lyrics, createdAt };
          await saveJson(await uniqueJsonPath(dir, title), example);
          return example;
        }));
      }
      const exampleMatch = pathname.match(/^\/api\/examples\/([^/]+)$/);
      if (exampleMatch && req.method === 'DELETE') {
        await body(req);
        return send(200, await serial(async () => {
          const dir = examplesDir();
          const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
          for (const name of files) {
            const file = path.join(dir, name);
            const example = await readJson(file, null);
            if (example?.id === exampleMatch[1]) { await unlink(file); return { ok: true, id: example.id }; }
          }
          throw fail(404, '예시를 찾을 수 없습니다.');
        }));
      }
      if (req.method === 'GET' && pathname === '/api/playlists') {
        const list = await listPlaylists();
        return send(200, list.map((entry) => entry.playlist).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      }
      if (req.method === 'POST' && pathname === '/api/playlists') {
        const input = await body(req);
        const name = text(input.name, 200).trim() || '새 재생목록';
        return send(201, await serial(async () => {
          const createdAt = new Date().toISOString();
          const playlist = { id: randomUUID(), name, songIds: [], createdAt, updatedAt: createdAt };
          await saveJson(await uniqueJsonPath(playlistsDirPath, name), playlist);
          return playlist;
        }));
      }
      const playlistMatch = pathname.match(/^\/api\/playlists\/([^/]+)$/);
      if (playlistMatch && req.method === 'PATCH') {
        const input = await body(req);
        return send(200, await serial(async () => {
          const found = (await listPlaylists()).find((entry) => entry.playlist.id === playlistMatch[1]);
          if (!found) throw fail(404, '재생목록을 찾을 수 없습니다.');
          const playlist = found.playlist;
          let file = found.file;
          if (typeof input.name === 'string') {
            const nextName = text(input.name, 200).trim() || '새 재생목록';
            if (nextName !== playlist.name) {
              const target = await uniqueJsonPath(playlistsDirPath, nextName, file);
              if (target !== file) { await rename(file, target); file = target; }
              playlist.name = nextName;
            }
          }
          if (Array.isArray(input.songIds)) playlist.songIds = input.songIds.filter((id) => typeof id === 'string').slice(0, 500);
          playlist.updatedAt = new Date().toISOString();
          await saveJson(file, playlist);
          return playlist;
        }));
      }
      if (playlistMatch && req.method === 'DELETE') {
        await body(req);
        return send(200, await serial(async () => {
          const found = (await listPlaylists()).find((entry) => entry.playlist.id === playlistMatch[1]);
          if (!found) throw fail(404, '재생목록을 찾을 수 없습니다.');
          await unlink(found.file);
          return { ok: true, id: found.playlist.id };
        }));
      }
      if (req.method === 'GET' && pathname === '/api/projects') {
        const entries = await listEntries();
        return send(200, entries.map((entry) => entry.project).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }
      if (req.method === 'POST' && pathname === '/api/projects') {
        const input = await body(req);
        const createdAt = new Date().toISOString();
        const project = { id: randomUUID(), title: text(input.title, 200).trim() || '제목 없는 곡', lyrics: text(input.lyrics), style: text(input.style, 4000), modelId: text(input.modelId, 200), seed: Number.isSafeInteger(Number(input.seed)) ? Number(input.seed) : -1, steps: Math.max(1, Math.min(1000, Number(input.steps) || 32)), cot: ['full', 'melody', 'off'].includes(input.cot) ? input.cot : 'full', vocalGender: VOCAL_GENDERS.has(input.vocalGender) ? input.vocalGender : '', instrumental: input.instrumental === true, abc: text(input.abc, 200000), mode: input.mode === 'simple' ? 'simple' : 'custom', status: 'draft', favorite: false, notes: '', createdAt, updatedAt: createdAt };
        const dir = settingDir();
        await mkdir(dir, { recursive: true });
        const file = await uniqueJsonPath(dir, project.title);
        await saveJson(file, project);
        return send(201, project);
      }
      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(\/export)?$/);
      if (projectMatch && req.method === 'GET') {
        const entry = await findEntry(projectMatch[1]);
        if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
        return send(200, entry.project, projectMatch[2] ? { 'Content-Disposition': `attachment; filename="song-${entry.project.id}.json"` } : {});
      }
      if (projectMatch && !projectMatch[2] && req.method === 'DELETE') {
        await body(req);
        return send(200, await serial(async () => {
          const entry = await findEntry(projectMatch[1]);
          if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
          await unlink(entry.file);
          if (entry.project.status === 'completed' && entry.project.audioPath) await unlink(path.join(path.dirname(entry.file), entry.project.audioPath)).catch(() => {});
          if (entry.project.coverPath) await unlink(path.join(coversDir(), entry.project.coverPath)).catch(() => {});
          await rm(path.join(outputDirectory, entry.project.id), { recursive: true, force: true });
          return { ok: true, id: entry.project.id };
        }));
      }
      if (projectMatch && !projectMatch[2] && req.method === 'PATCH') {
        const input = await body(req);
        return send(200, await serial(async () => {
          const entry = await findEntry(projectMatch[1]);
          if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
          const project = entry.project;
          let file = entry.file;
          if (typeof input.title === 'string') {
            const nextTitle = text(input.title, 200).trim() || '제목 없는 곡';
            if (nextTitle !== project.title) {
              const target = await uniqueJsonPath(path.dirname(file), nextTitle, file);
              if (target !== file) {
                await rename(file, target);
                if (project.status === 'completed' && project.audioPath) {
                  const ext = path.extname(project.audioPath);
                  const oldAudio = path.join(path.dirname(file), project.audioPath);
                  const newAudio = target.replace(/\.json$/, ext);
                  if (await exists(oldAudio)) { await rename(oldAudio, newAudio); project.audioPath = path.basename(newAudio); }
                }
                file = target;
              }
              project.title = nextTitle;
            }
          }
          if (typeof input.notes === 'string') project.notes = text(input.notes, 10000);
          if (typeof input.favorite === 'boolean') project.favorite = input.favorite;
          project.updatedAt = new Date().toISOString();
          await saveJson(file, project);
          return project;
        }));
      }
      if (req.method === 'GET' && pathname === '/api/llm/models') {
        const result = await upstream(`${providerFromEnv('ollama').endpoint}/api/tags`);
        return send(200, { models: (result.models || []).map(model => ({ name: model.name, size: model.size })) });
      }
      if (req.method === 'POST' && pathname === '/api/llm/test') { await body(req); return send(200, { ok: true, ...await ask('연결 확인입니다. "연결되었습니다"라고만 답해 주세요.', true) }); }
      if (req.method === 'POST' && pathname === '/api/llm/assist') {
        const input = await body(req);
        if (!['lyrics', 'style'].includes(input.task)) throw fail(400, '가사 또는 스타일 작업을 선택해 주세요.');
        const instruction = input.task === 'lyrics' ? '한국어 노래 가사를 작성해 주세요. [Verse], [Chorus], [Bridge] 구간 표기를 사용하세요. 설명 없이 가사만 반환하세요.' : '음악 생성에 쓸 스타일 프롬프트를 다듬어 주세요. 장르, 악기, 보컬, 분위기를 간결하게 적고 설명 없이 스타일 프롬프트만 반환하세요.';
        return send(200, await ask(`${instruction}\n요청: ${text(input.prompt, 4000)}\n현재 가사: ${text(input.lyrics)}\n현재 스타일: ${text(input.style, 4000)}`));
      }
      if (req.method === 'POST' && pathname === '/api/llm/abc-edit') {
        const input = await body(req);
        if (!text(input.instruction, 2000).trim()) throw fail(400, 'AI에게 전달할 지시사항을 입력해 주세요.');
        const instruction = 'ABC notation 악보를 수정하는 도우미입니다. 아래 "현재 악보"를 "지시사항"에 따라 수정한 뒤, 다른 설명이나 코드 펜스 없이 수정된 ABC notation 전체만 그대로 반환하세요. X:, T:, M:, L:, K: 같은 헤더 줄은 지시사항에서 명시적으로 바꾸라고 하지 않는 한 그대로 유지하세요.';
        const result = await ask(`${instruction}\n지시사항: ${text(input.instruction, 2000)}\n현재 악보:\n${text(input.abc, 200000)}`);
        const abc = result.text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
        if (!abc) throw fail(502, 'AI가 악보를 반환하지 않았습니다. 다른 지시사항으로 다시 시도해 주세요.');
        return send(200, { abc, provider: result.provider, model: result.model });
      }
      if (req.method === 'POST' && pathname === '/api/generate') {
        const input = await body(req);
        if (typeof input.projectId !== 'string') throw fail(400, '프로젝트 아이디가 필요합니다.');
        const entry = await findEntry(input.projectId);
        if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
        if (UNSUPPORTED_MODEL_MESSAGES[entry.project.modelId]) throw fail(400, UNSUPPORTED_MODEL_MESSAGES[entry.project.modelId]);
        const isPython = Boolean(PYTHON_MODELS[entry.project.modelId]);
        const isComfy = Boolean(COMFYUI_MODELS[entry.project.modelId]);
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        const runner = isPython ? runPythonYue2 : isComfy ? runComfyUi : runAudioCpp;
        const expectedMs = isPython ? 240000 : isComfy ? 60000 : Math.round(60000 * (Math.max(1, entry.project.steps) / 8));
        generationStatus = { projectId: entry.project.id, startedAt: Date.now(), expectedMs };
        try { return send(200, await runner(entry.project, entry.file)); }
        finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'GET' && pathname === '/api/generate/status') {
        if (!generating || !generationStatus) return send(200, { active: false, elapsedMs: 0, expectedMs: 0 });
        return send(200, { active: true, projectId: generationStatus.projectId, elapsedMs: Date.now() - generationStatus.startedAt, expectedMs: generationStatus.expectedMs, progress: generationStatus.progress, detail: generationStatus.detail });
      }
      if (req.method === 'POST' && pathname === '/api/plan') {
        // Stateless preview: planning must not create/persist a project just to produce
        // an ABC score. The draft's fields are enough; nothing is saved unless the user
        // explicitly saves the draft or the resulting score.
        const input = await body(req);
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        const pseudoProject = {
          id: randomUUID(),
          title: text(input.title, 200).trim() || '제목 없는 노래',
          lyrics: text(input.lyrics),
          style: text(input.style, 4000),
          cot: ['full', 'melody', 'off'].includes(input.cot) ? input.cot : 'full',
          seed: Number.isSafeInteger(Number(input.seed)) ? Number(input.seed) : 42,
          vocalGender: VOCAL_GENDERS.has(input.vocalGender) ? input.vocalGender : '',
          instrumental: input.instrumental === true,
        };
        try {
          const { outDir } = await runPythonAction('plan', pseudoProject, [], 20000);
          const abcFile = path.join(outDir, 'score.abc');
          if (!(await exists(abcFile))) throw fail(502, '심볼릭 작곡에 실패했습니다. 로그를 확인해 주세요.');
          return send(200, { abc: await readFile(abcFile, 'utf8') });
        } finally {
          generating = false; generationStatus = null;
          await rm(path.join(outputDirectory, pseudoProject.id), { recursive: true, force: true }).catch(() => {});
        }
      }
      if (req.method === 'POST' && pathname === '/api/abc-check') {
        const input = await body(req, 512 * 1024);
        const abc = text(input.abc, 200000);
        if (!abc.trim()) throw fail(400, '검사할 악보 내용이 없습니다.');
        const { python, script } = pythonEngineOrFail();
        if (!(await exists(python))) throw fail(400, '설정에서 Python 실행 파일 경로를 확인해 주세요.');
        const abcToolsScript = path.join(path.dirname(script), 'abc_tools.py');
        if (!(await exists(abcToolsScript))) throw fail(400, 'abc_tools.py를 찾을 수 없습니다. Python 스크립트 경로를 확인해 주세요.');
        const tempFile = path.join(outputDirectory, `abc-check-${randomUUID()}.abc`);
        await writeFile(tempFile, abc, 'utf8');
        try {
          const result = await new Promise((resolve, reject) => {
            const child = spawnImpl(python, [abcToolsScript, 'inspect', tempFile], { windowsHide: true, cwd: path.dirname(script) });
            const chunks = [];
            child.stdout.on('data', (chunk) => chunks.push(chunk));
            child.stderr.on('data', (chunk) => chunks.push(chunk));
            child.once('error', reject);
            child.once('close', (code) => resolve({ text: Buffer.concat(chunks).toString('utf8'), code }));
          });
          let parsed = null;
          try { parsed = JSON.parse(result.text); } catch { /* fall through to raw text below */ }
          if (result.code === 0 && parsed) return send(200, { valid: true, report: parsed });
          return send(200, { valid: false, error: parsed?.error || result.text.trim().slice(0, 2000) || '악보를 해석할 수 없습니다.' });
        } finally { await unlink(tempFile).catch(() => {}); }
      }
      if (req.method === 'POST' && pathname === '/api/cover-transcribe') {
        const input = await body(req, 60 * 1024 * 1024);
        const match = typeof input.dataUrl === 'string' && input.dataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (!match) throw fail(400, '오디오 파일(MP3/WAV/FLAC/M4A/OGG)을 선택해 주세요.');
        const ext = AUDIO_MIME[match[1]];
        if (!ext) throw fail(400, '지원하지 않는 오디오 형식입니다. MP3/WAV/FLAC/M4A/OGG 파일을 사용해 주세요.');
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > 50 * 1024 * 1024) throw fail(413, '오디오 파일이 너무 큽니다. 50MB 이하로 줄여 주세요.');
        const task = ['full', 'melody-full', 'melody-vocal'].includes(input.task) ? input.task : 'melody-full';
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        const audioFile = path.join(outputDirectory, `cover-source-${randomUUID()}.${ext}`);
        try {
          await writeFile(audioFile, buffer);
          const result = await runTranscribe(audioFile, task);
          return send(200, { abc: result.abc });
        } finally { generating = false; await unlink(audioFile).catch(() => {}); }
      }
      if (req.method === 'POST' && pathname === '/api/audiosr-restore/preview') {
        const input = await body(req, 100 * 1024 * 1024);
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 60000 };
        try { return send(200, await previewRestoreAudio(input.dataUrl)); }
        finally { generating = false; generationStatus = null; }
      }
      const restorePreviewAudioMatch = pathname.match(/^\/api\/audiosr-restore\/preview\/([^/]+)\/(original|restored)$/);
      if (restorePreviewAudioMatch && req.method === 'GET') {
        const file = path.join(restorePreviewDir(restorePreviewAudioMatch[1]), restorePreviewAudioMatch[2] === 'original' ? 'source.wav' : 'restored.wav');
        if (!(await exists(file))) throw fail(404, '복원 결과를 찾을 수 없습니다.');
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(data.length), 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      const restorePreviewSaveMatch = pathname.match(/^\/api\/audiosr-restore\/preview\/([^/]+)\/save$/);
      if (restorePreviewSaveMatch && req.method === 'POST') {
        const input = await body(req);
        return send(200, await saveRestoredAudio(restorePreviewSaveMatch[1], input.title));
      }
      const restorePreviewDeleteMatch = pathname.match(/^\/api\/audiosr-restore\/preview\/([^/]+)$/);
      if (restorePreviewDeleteMatch && req.method === 'DELETE') {
        await body(req);
        await rm(restorePreviewDir(restorePreviewDeleteMatch[1]), { recursive: true, force: true });
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/abc-file') {
        const input = await body(req, 512 * 1024);
        const abc = text(input.abc, 200000);
        if (!abc.trim()) throw fail(400, '\uC800\uC7A5\uD560 \uC545\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.');
        const folderInput = text(input.folder, 2048).trim() || settings.abcNotesPath || 'library/abc-note';
        const dir = path.resolve(root, folderInput);
        const filename = safeAbcFilename(input.filename, input.title || 'score');
        const target = path.join(dir, filename);
        await mkdir(dir, { recursive: true });
        await writeFile(target, abc.endsWith('\n') ? abc : `${abc}\n`, 'utf8');
        return send(200, { ok: true, folder: dir, filename, path: target });
      }
      // 내장 파일 탐색기(보컬 음색 변환의 참조 오디오 선택 등)가 쓰는 라우트 두 개 -- library/ 트리
      // 밖으로는 절대 못 나가게 path.relative()로 확인한다(".." 여러 번 넣어 library 밖 파일을
      // 읽으려는 시도를 막기 위함).
      if (req.method === 'GET' && pathname === '/api/library/browse') {
        const libraryRoot = path.join(root, 'library');
        const relative = text(requestUrl.searchParams.get('path'), 2048).trim();
        const target = path.resolve(libraryRoot, relative);
        const rel = path.relative(libraryRoot, target);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail(400, 'library 폴더 밖의 경로는 열 수 없습니다.');
        await mkdir(libraryRoot, { recursive: true });
        const stats = await stat(target).catch(() => null);
        if (!stats || !stats.isDirectory()) throw fail(404, '폴더를 찾을 수 없습니다.');
        const names = await readdir(target);
        const entries = [];
        for (const name of names) {
          if (name.startsWith('.')) continue;
          const full = path.join(target, name);
          const entryStat = await stat(full).catch(() => null);
          if (!entryStat) continue;
          if (entryStat.isDirectory()) entries.push({ name, type: 'dir' });
          else if (LIBRARY_BROWSE_AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase())) entries.push({ name, type: 'file', size: entryStat.size });
        }
        entries.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
        return send(200, { path: rel.split(path.sep).join('/'), entries });
      }
      if (req.method === 'GET' && pathname === '/api/library/file') {
        const libraryRoot = path.join(root, 'library');
        const relative = text(requestUrl.searchParams.get('path'), 2048).trim();
        const target = path.resolve(libraryRoot, relative);
        const rel = path.relative(libraryRoot, target);
        if (!relative || rel.startsWith('..') || path.isAbsolute(rel)) throw fail(400, '올바르지 않은 경로입니다.');
        const ext = path.extname(target).toLowerCase();
        if (!LIBRARY_BROWSE_AUDIO_EXTENSIONS.has(ext)) throw fail(400, '지원하지 않는 파일 형식입니다.');
        if (!(await exists(target))) throw fail(404, '파일을 찾을 수 없습니다.');
        const data = await readFile(target);
        res.writeHead(200, { 'Content-Type': AUDIO_MIME_TYPES[ext] || 'application/octet-stream', 'Content-Length': String(data.length), 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      // 앱에서 만든 곡의 메타데이터: 오디오와 나란히 저장된 <제목>.json(가사/스타일/제목)을 돌려준다.
      // 외부 오디오처럼 json이 없는 파일이면 404 -- 호출자는 그때 전사(Whisper STT)로 가사를 다시 만든다.
      if (req.method === 'GET' && pathname === '/api/library/meta') {
        const libraryRoot = path.join(root, 'library');
        const relative = text(requestUrl.searchParams.get('path'), 2048).trim();
        const target = path.resolve(libraryRoot, relative);
        const rel = path.relative(libraryRoot, target);
        if (!relative || rel.startsWith('..') || path.isAbsolute(rel)) throw fail(400, '올바르지 않은 경로입니다.');
        if (path.extname(target).toLowerCase() !== '.json') throw fail(400, '메타데이터는 JSON 파일에서만 읽을 수 있습니다.');
        if (!(await exists(target))) throw fail(404, '메타데이터를 찾을 수 없습니다.');
        const project = await readJson(target, null);
        if (!project || typeof project !== 'object') throw fail(400, '메타데이터를 읽을 수 없습니다.');
        return send(200, {
          title: typeof project.title === 'string' ? project.title : null,
          lyrics: typeof project.lyrics === 'string' ? project.lyrics : null,
          style: typeof project.style === 'string' ? project.style : null,
        });
      }
      if (req.method === 'GET' && pathname === '/api/eq-presets') {
        const dir = eqPresetsDir();
        const files = await readdir(dir).catch(() => []);
        const presets = await Promise.all(files.filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(dir, name), null)));
        return send(200, presets.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (req.method === 'POST' && pathname === '/api/eq-presets') {
        const input = await body(req, 8 * 1024);
        const name = text(input.name, 120).trim();
        if (!name) throw fail(400, '프리셋 이름이 필요합니다.');
        if (!Array.isArray(input.eq) || input.eq.length !== 10 || !input.eq.every((value) => typeof value === 'number' && Number.isFinite(value))) throw fail(400, 'EQ 값이 올바르지 않습니다.');
        const preset = { name, eq: input.eq };
        await saveJson(path.join(eqPresetsDir(), `${safeFilename(name)}.json`), preset);
        return send(200, preset);
      }
      if (req.method === 'DELETE' && pathname === '/api/eq-presets') {
        const name = text(requestUrl.searchParams.get('name'), 120).trim();
        if (!name) throw fail(400, '프리셋 이름이 필요합니다.');
        const target = path.join(eqPresetsDir(), `${safeFilename(name)}.json`);
        if (!(await exists(target))) throw fail(404, '프리셋을 찾을 수 없습니다.');
        await unlink(target);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/postprocess-settings') {
        const dir = postprocessSettingsDir();
        const files = await readdir(dir).catch(() => []);
        const presets = await Promise.all(files.filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(dir, name), null)));
        return send(200, presets.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (req.method === 'POST' && pathname === '/api/postprocess-settings') {
        const input = await body(req, 32 * 1024);
        const name = text(input.name, 120).trim();
        if (!name) throw fail(400, '프리셋 이름이 필요합니다.');
        if (!input.params || typeof input.params !== 'object' || Array.isArray(input.params)) throw fail(400, '설정 내용이 올바르지 않습니다.');
        const preset = { name, params: input.params };
        await saveJson(path.join(postprocessSettingsDir(), `${safeFilename(name)}.json`), preset);
        return send(200, preset);
      }
      if (req.method === 'DELETE' && pathname === '/api/postprocess-settings') {
        const name = text(requestUrl.searchParams.get('name'), 120).trim();
        if (!name) throw fail(400, '프리셋 이름이 필요합니다.');
        const target = path.join(postprocessSettingsDir(), `${safeFilename(name)}.json`);
        if (!(await exists(target))) throw fail(404, '프리셋을 찾을 수 없습니다.');
        await unlink(target);
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/abc-notes') {
        const dir = abcNotesDir();
        const files = await readdir(dir).catch(() => []);
        const jsonList = await Promise.all(files.filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(dir, name), null)));
        const abcList = await Promise.all(files.filter((name) => name.toLowerCase().endsWith('.abc')).map((name) => readAbcFileNote(dir, name).catch(() => null)));
        return send(200, [...jsonList, ...abcList].filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      }
      if (req.method === 'POST' && pathname === '/api/abc-notes') {
        const input = await body(req, 512 * 1024);
        const title = text(input.title, 200).trim() || '제목 없는 악보';
        const abc = text(input.abc, 200000);
        if (!abc.trim()) throw fail(400, '저장할 악보 내용이 없습니다.');
        return send(201, await serial(async () => {
          const dir = abcNotesDir();
          await mkdir(dir, { recursive: true });
          const target = await uniqueAbcPath(dir, title);
          await writeFile(target, abc.endsWith('\n') ? abc : `${abc}\n`, 'utf8');
          return readAbcFileNote(dir, path.basename(target));
        }));
      }
      async function findAbcNote(id) {
        const dir = abcNotesDir();
        const abcName = abcFileNameFromId(id);
        if (abcName) {
          const file = path.join(dir, abcName);
          if (await exists(file)) return { note: await readAbcFileNote(dir, abcName), file, format: 'abc' };
          return null;
        }
        const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
        for (const name of files) {
          const filePath = path.join(dir, name);
          const note = await readJson(filePath, null);
          if (note?.id === id) return { note, file: filePath, format: 'json' };
        }
        return null;
      }
      const abcNoteMatch = pathname.match(/^\/api\/abc-notes\/([^/]+)$/);
      if (abcNoteMatch && req.method === 'PATCH') {
        const input = await body(req, 512 * 1024);
        return send(200, await serial(async () => {
          const found = await findAbcNote(abcNoteMatch[1]);
          if (!found) throw fail(404, '악보를 찾을 수 없습니다.');
          const note = found.note;
          let file = found.file;
          if (typeof input.title === 'string') {
            const nextTitle = text(input.title, 200).trim() || '\uC81C\uBAA9 \uC5C6\uB294 \uC545\uBCF4';
            if (nextTitle !== note.title) {
              const target = found.format === 'abc' ? await uniqueAbcPath(abcNotesDir(), nextTitle, file) : await uniqueJsonPath(abcNotesDir(), nextTitle, file);
              if (target !== file) { await rename(file, target); file = target; }
              note.title = nextTitle;
              if (found.format === 'abc') note.id = abcFileId(path.basename(file));
            }
          }
          if (typeof input.abc === 'string') {
            if (!input.abc.trim()) throw fail(400, '\uC545\uBCF4 \uB0B4\uC6A9\uC740 \uBE44\uC6B8 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');
            note.abc = text(input.abc, 200000);
          }
          note.updatedAt = new Date().toISOString();
          if (found.format === 'abc') await writeFile(file, note.abc.endsWith('\n') ? note.abc : `${note.abc}\n`, 'utf8');
          else await saveJson(file, note);
          return note;
        }));
      }
      if (abcNoteMatch && req.method === 'DELETE') {
        await body(req);
        return send(200, await serial(async () => {
          const found = await findAbcNote(abcNoteMatch[1]);
          if (!found) throw fail(404, '악보를 찾을 수 없습니다.');
          if (found.note.coverPath) await unlink(path.join(coversDir(), found.note.coverPath)).catch(() => {});
          await unlink(found.file);
          return { ok: true, id: found.note.id };
        }));
      }
      const abcNoteCoverMatch = pathname.match(/^\/api\/abc-notes\/([^/]+)\/cover$/);
      if (abcNoteCoverMatch && req.method === 'POST') {
        const input = await body(req, 28 * 1024 * 1024);
        const match = typeof input.dataUrl === 'string' && input.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!match) throw fail(400, '지원하는 이미지 형식(PNG/JPEG/WEBP)의 파일을 선택해 주세요.');
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > 20 * 1024 * 1024) throw fail(413, '이미지가 너무 큽니다. 20MB 이하로 줄여 주세요.');
        return send(200, await serial(async () => {
          const found = await findAbcNote(abcNoteCoverMatch[1]);
          if (!found) throw fail(404, '악보를 찾을 수 없습니다.');
          const dir = coversDir();
          await mkdir(dir, { recursive: true });
          if (found.note.coverPath) await unlink(path.join(dir, found.note.coverPath)).catch(() => {});
          const coverName = `abcnote-${found.note.id}.${COVER_MIME[match[1]]}`;
          await writeFile(path.join(dir, coverName), buffer);
          const updated = { ...found.note, coverPath: coverName, updatedAt: new Date().toISOString() };
          await saveJson(found.file, updated);
          return updated;
        }));
      }
      if (abcNoteCoverMatch && req.method === 'DELETE') {
        await body(req);
        return send(200, await serial(async () => {
          const found = await findAbcNote(abcNoteCoverMatch[1]);
          if (!found) throw fail(404, '악보를 찾을 수 없습니다.');
          if (!found.note.coverPath) return { ok: true };
          await unlink(path.join(coversDir(), found.note.coverPath)).catch(() => {});
          const updated = { ...found.note, coverPath: null, updatedAt: new Date().toISOString() };
          await saveJson(found.file, updated);
          return { ok: true };
        }));
      }
      if (abcNoteCoverMatch && req.method === 'GET') {
        const found = await findAbcNote(abcNoteCoverMatch[1]);
        if (!found?.note.coverPath) throw fail(404, '커버 이미지가 없습니다.');
        const coverFile = path.join(coversDir(), found.note.coverPath);
        if (!(await exists(coverFile))) throw fail(404, '커버 이미지 파일을 찾을 수 없습니다.');
        const data = await readFile(coverFile);
        const mimeEntry = Object.entries(COVER_MIME).find(([, ext]) => coverFile.endsWith(`.${ext}`));
        res.writeHead(200, { 'Content-Type': mimeEntry ? mimeEntry[0] : 'application/octet-stream', 'Content-Length': String(data.length), 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      const coverMatch = pathname.match(/^\/api\/projects\/([^/]+)\/cover$/);
      if (coverMatch && req.method === 'POST') {
        const input = await body(req, 28 * 1024 * 1024);
        const match = typeof input.dataUrl === 'string' && input.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
        if (!match) throw fail(400, '지원하는 이미지 형식(PNG/JPEG/WEBP)의 파일을 선택해 주세요.');
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > 20 * 1024 * 1024) throw fail(413, '이미지가 너무 큽니다. 20MB 이하로 줄여 주세요.');
        return send(200, await serial(async () => {
          const entry = await findEntry(coverMatch[1]);
          if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
          const dir = coversDir();
          await mkdir(dir, { recursive: true });
          if (entry.project.coverPath) await unlink(path.join(dir, entry.project.coverPath)).catch(() => {});
          const coverName = `${entry.project.id}.${COVER_MIME[match[1]]}`;
          await writeFile(path.join(dir, coverName), buffer);
          const updated = { ...entry.project, coverPath: coverName, updatedAt: new Date().toISOString() };
          await saveJson(entry.file, updated);
          return updated;
        }));
      }
      if (coverMatch && req.method === 'DELETE') {
        await body(req);
        return send(200, await serial(async () => {
          const entry = await findEntry(coverMatch[1]);
          if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
          if (!entry.project.coverPath) return { ok: true };
          await unlink(path.join(coversDir(), entry.project.coverPath)).catch(() => {});
          const updated = { ...entry.project, coverPath: null, updatedAt: new Date().toISOString() };
          await saveJson(entry.file, updated);
          return { ok: true };
        }));
      }
      if (coverMatch && req.method === 'GET') {
        const entry = await findEntry(coverMatch[1]);
        if (!entry?.project.coverPath) throw fail(404, '커버 이미지가 없습니다.');
        const coverFile = path.join(coversDir(), entry.project.coverPath);
        if (!(await exists(coverFile))) throw fail(404, '커버 이미지 파일을 찾을 수 없습니다.');
        const data = await readFile(coverFile);
        const mimeEntry = Object.entries(COVER_MIME).find(([, ext]) => coverFile.endsWith(`.${ext}`));
        res.writeHead(200, { 'Content-Type': mimeEntry ? mimeEntry[0] : 'application/octet-stream', 'Content-Length': String(data.length), 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      const audioMatch = pathname.match(/^\/api\/projects\/([^/]+)\/audio$/);
      if (audioMatch && req.method === 'GET') {
        const entry = await findEntry(audioMatch[1]);
        if (!entry || entry.project.status !== 'completed' || !entry.project.audioPath) throw fail(404, '아직 생성된 음원이 없습니다.');
        const dir = path.dirname(entry.file);
        const canonical = path.join(dir, entry.project.audioPath);
        if (!(await exists(canonical))) throw fail(404, '음원 파일을 찾을 수 없습니다.');
        const requestedFormat = requestUrl.searchParams.get('format');
        let audioFile = canonical;
        if (requestedFormat && SAVE_FORMATS.has(requestedFormat) && requestedFormat !== path.extname(canonical).slice(1)) {
          const base = path.basename(entry.project.audioPath, path.extname(entry.project.audioPath));
          const cached = path.join(dir, `${base}.${requestedFormat}`);
          const sourceCover = entry.project.coverPath ? path.join(coversDir(), entry.project.coverPath) : null;
          const coverFile = sourceCover && await exists(sourceCover) ? sourceCover : null;
          const [sourceStat, coverStat, cacheStat] = await Promise.all([
            stat(canonical),
            coverFile ? stat(coverFile) : null,
            stat(cached).catch(() => null),
          ]);
          const newestSourceMtime = Math.max(sourceStat.mtimeMs, coverStat?.mtimeMs || 0);
          if (!cacheStat || cacheStat.mtimeMs < newestSourceMtime) {
            await new Promise((resolve, reject) => {
              const child = spawnImpl('ffmpeg', FFMPEG_ARGS[requestedFormat](canonical, cached, coverFile), { windowsHide: true });
              child.once('error', reject);
              child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
            }).then(async () => {
              if (!(await stat(cached).catch(() => null))?.size) { await unlink(cached).catch(() => {}); throw new Error('empty output'); }
            }).catch(() => { throw fail(502, `${requestedFormat.toUpperCase()} 변환에 실패했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.`); });
          }
          audioFile = cached;
        }
        const data = await readFile(audioFile);
        const disposition = requestUrl.searchParams.get('download') ? `attachment; filename="${encodeURIComponent(path.basename(audioFile))}"` : 'inline';
        res.writeHead(200, { 'Content-Type': AUDIO_MIME_TYPES[path.extname(audioFile)] || 'application/octet-stream', 'Content-Length': String(data.length), 'Content-Disposition': disposition, 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      const midiNotesMatch = pathname.match(/^\/api\/projects\/([^/]+)\/midi\/notes$/);
      if (midiNotesMatch && req.method === 'GET') {
        const entry = await findEntry(midiNotesMatch[1]);
        if (!entry || entry.project.status !== 'completed') throw fail(404, '완성된 음원을 찾을 수 없습니다.');
        const { notesFile } = await exportMidi(entry);
        const notes = JSON.parse(await readFile(notesFile, 'utf8'));
        return send(200, { notes });
      }
      const midiMatch = pathname.match(/^\/api\/projects\/([^/]+)\/midi$/);
      if (midiMatch && req.method === 'GET') {
        const entry = await findEntry(midiMatch[1]);
        if (!entry || entry.project.status !== 'completed') throw fail(404, '완성된 음원을 찾을 수 없습니다.');
        const { midiFile } = await exportMidi(entry);
        const data = await readFile(midiFile);
        res.writeHead(200, { 'Content-Type': 'audio/midi', 'Content-Length': String(data.length), 'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(midiFile))}"`, 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      if (midiMatch && req.method === 'POST') {
        const input = await body(req);
        const entry = await findEntry(midiMatch[1]);
        if (!entry || entry.project.status !== 'completed') throw fail(404, '완성된 음원을 찾을 수 없습니다.');
        await saveMidiNotes(entry, input.notes);
        return send(200, { ok: true });
      }
      // Download is independent of save: it encodes whatever note array the editor sends right now
      // (possibly unsaved edits) and streams it back without touching the cached .mid/.notes.json.
      // That's what makes both "edit, download without saving" and "save, then download" work as
      // expected -- the latter just happens to match because save already refreshed the cache.
      const midiRenderMatch = pathname.match(/^\/api\/projects\/([^/]+)\/midi\/render$/);
      if (midiRenderMatch && req.method === 'POST') {
        const input = await body(req);
        const entry = await findEntry(midiRenderMatch[1]);
        if (!entry || entry.project.status !== 'completed') throw fail(404, '완성된 음원을 찾을 수 없습니다.');
        const notes = parseMidiNotes(input.notes);
        const data = encodeMidiFile(notes);
        const filename = safeMidiFilename(entry.project.title, entry.project.title || 'midi');
        res.writeHead(200, { 'Content-Type': 'audio/midi', 'Content-Length': String(data.length), 'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`, 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      const midiSaveToFolderMatch = pathname.match(/^\/api\/projects\/([^/]+)\/midi\/save-to-folder$/);
      if (midiSaveToFolderMatch && req.method === 'POST') {
        const input = await body(req);
        const entry = await findEntry(midiSaveToFolderMatch[1]);
        if (!entry || entry.project.status !== 'completed') throw fail(404, '완성된 음원을 찾을 수 없습니다.');
        const notes = parseMidiNotes(input.notes);
        const data = encodeMidiFile(notes);
        const folderInput = text(input.folder, 2048).trim() || 'library/midi';
        const dir = path.resolve(root, folderInput);
        const filename = safeMidiFilename(input.filename, entry.project.title || 'midi');
        const target = path.join(dir, filename);
        await mkdir(dir, { recursive: true });
        await writeFile(target, data);
        return send(200, { ok: true, folder: dir, filename, path: target });
      }
      // "음색 변조" 팝업: 라이브러리에서 자유롭게 고른 "원본 audio"를 위한 프로젝트 무관 라우트 묶음.
      // prepare가 스템 분리까지 미리 끝내두면, 이후 두 엔진(legacy/ddsp)이 같은 previewId로
      // vocals-original.wav를 공유해서 쓴다 -- 예전 project.id 스코프 라우트들과 완전히 같은 흐름을
      // previewId 기준으로 옮긴 것뿐이다(옛 /projects/:id/vocal-timbre/apply 등은 제거됨).
      if (req.method === 'POST' && pathname === '/api/timbre-transform/prepare') {
        const input = await body(req, 200 * 1024 * 1024);
        const previewId = await prepareTimbrePreview(input.sourceDataUrl);
        return send(200, { previewId });
      }
      // "음색 변조" 참조 보컬: 참조 오디오를 즉석 분리해 vocals dataUrl만 돌려준다.
      if (req.method === 'POST' && pathname === '/api/timbre-transform/reference/separate') {
        const input = await body(req, 200 * 1024 * 1024);
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 60000 };
        try { return send(200, await separateReferenceVocal(input.referenceDataUrl)); }
        finally { generating = false; generationStatus = null; }
      }
      const timbreAudioMatch = pathname.match(/^\/api\/timbre-transform\/([^/]+)\/audio$/);
      if (timbreAudioMatch && req.method === 'GET') {
        const file = path.join(timbrePreviewDir(timbreAudioMatch[1]), 'source.wav');
        if (!(await exists(file))) throw fail(404, '원본 오디오를 찾을 수 없습니다.');
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(data.length), 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      const timbreStemMatch = pathname.match(/^\/api\/timbre-transform\/([^/]+)\/stems\/([a-z]+)$/);
      if (timbreStemMatch && req.method === 'GET') {
        if (!STEM_NAMES.includes(timbreStemMatch[2])) throw fail(404, '알 수 없는 STEM입니다.');
        const file = path.join(timbrePreviewDir(timbreStemMatch[1]), 'stems', `${timbreStemMatch[2]}.wav`);
        if (!(await exists(file))) throw fail(404, 'STEM 파일을 찾을 수 없습니다.');
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(data.length), 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      // RVC voice preview: converts the first seconds of the loaded source vocal into the chosen voice (cached per settings).
      const rvcPreviewMatch = pathname.match(/^\/api\/timbre-transform\/([^/]+)\/rvc-preview$/);
      if (rvcPreviewMatch && req.method === 'POST') {
        const input = await body(req, 64 * 1024);
        const dir = timbrePreviewDir(rvcPreviewMatch[1]);
        const vocals = path.join(dir, 'stems', 'vocals-original.wav');
        if (!(await exists(vocals))) throw fail(404, '원본 오디오 준비 정보를 찾을 수 없습니다. 원본을 다시 선택해 주세요.');
        const voice = text(input.rvcVoice, 100);
        const semitone = Math.max(-24, Math.min(24, Math.round(Number(input.rvcSemitone)) || 0));
        const blend = Math.max(0, Math.min(1, Number(input.rvcRetrieval) || 0));
        const cacheFile = path.join(dir, `rvc-preview-${voice.replace(/[^\w-]+/g, '_')}-${semitone}-${blend}.wav`);
        if (await exists(cacheFile)) return send(200, { dataUrl: `data:audio/wav;base64,${(await readFile(cacheFile)).toString('base64')}`, cached: true });
        if (generating) throw fail(409, '이미 다른 작업을 실행 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 40000 };
        try {
          const clip = path.join(dir, 'rvc-preview-source.wav');
          if (!(await exists(clip))) await runFfmpegCli(['-y', '-i', vocals, '-t', '8', '-ar', '44100', '-ac', '1', clip], 'RVC 미리듣기 입력 준비');
          await runRvcSvc(clip, cacheFile, { rvcVoice: voice, rvcSemitone: semitone, rvcRetrieval: blend });
          return send(200, { dataUrl: `data:audio/wav;base64,${(await readFile(cacheFile)).toString('base64')}`, cached: false });
        } finally { generating = false; generationStatus = null; }
      }
      const timbreLegacyApplyMatch = pathname.match(/^\/api\/timbre-transform\/([^/]+)\/legacy\/apply$/);
      if (timbreLegacyApplyMatch && req.method === 'POST') {
        const input = await body(req, 50 * 1024 * 1024);
        const dir = timbrePreviewDir(timbreLegacyApplyMatch[1]);
        if (!(await exists(dir))) throw fail(404, '원본 오디오 준비 정보를 찾을 수 없습니다. 원본을 다시 선택해 주세요.');
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 60000, progress: 0, detail: '음색 변환 준비 중' };
        const onProgress = (progress, detail) => {
          if (!generationStatus) return;
          generationStatus.progress = progress;
          generationStatus.detail = detail;
        };
        try { return send(200, await applyVocalTimbreCore(path.join(dir, 'stems'), input.dataUrl, input.engine, {
          f0Condition: input.seedF0Condition,
          autoF0Adjust: input.seedAutoF0Adjust,
          inferenceSteps: input.seedInferenceSteps,
          vevoRoute: input.vevoRoute,
          rvcVoice: input.rvcVoice,
          rvcSemitone: input.rvcSemitone,
          rvcRetrieval: input.rvcRetrieval,
          meanvcPrecision: input.meanvcPrecision,
          chunkSeconds: input.chunkSeconds,
          overlapSeconds: input.overlapSeconds,
        }, onProgress)); }
        finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'GET' && pathname === '/api/audio-tools/typecast/voices') {
        const apiKey = typecastKey();
        if (!apiKey) return send(200, { configured: false, voices: [] });
        try { const [voices, subscription] = await Promise.all([listTypecastVoices(fetchImpl, apiKey), typecastSubscription(fetchImpl, apiKey)]); return send(200, { configured: true, voices, subscription }); }
        catch (error) { throw typecastFailure(error); }
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/typecast') {
        const input = await body(req, 50 * 1024 * 1024);
        if (generating) throw fail(409, '이미 다른 작업을 실행 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: Math.max(8000, text(input.text, 20000).length * 60) };
        try { return send(200, await runTypecastTool(input)); }
        finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'GET' && pathname === '/api/rvc-voices') {
        return send(200, { installed: await listInstalledRvcVoices(root), downloads: Object.fromEntries(rvcDownloads) });
      }
      if (req.method === 'GET' && pathname === '/api/rvc-voices/search') {
        try { return send(200, { results: await searchRvcVoices(fetchImpl, requestUrl.searchParams.get('q') || '') }); }
        catch (error) { throw fail(502, (error && error.message) || 'RVC 목소리 검색에 실패했습니다.'); }
      }
      if (req.method === 'POST' && pathname === '/api/rvc-voices/download') {
        const input = await body(req, 16 * 1024);
        const repo = text(input.repo, 200).trim();
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split('/').some((part) => /^\.+$/.test(part))) throw fail(400, '올바른 저장소 이름(예: 사용자/모델)이 아닙니다.');
        void downloadRvcVoice({ fetchImpl, spawnImpl, root, repo, license: text(input.license, 40), downloads: rvcDownloads });
        return send(202, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/rvc-voices/delete') {
        const input = await body(req, 16 * 1024);
        if (!(await deleteRvcVoice(root, text(input.id, 100)))) throw fail(404, '설치된 목소리를 찾을 수 없습니다.');
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && pathname === '/api/audio-tools/tts/models') {
        return send(200, { families: await listTtsModels(root, ttsDownloads), asr: await listTtsModels(root, ttsDownloads, ASR_FAMILIES), vc: await withInstalledRvcVoices(await listTtsModels(root, ttsDownloads, VC_FAMILIES)), edit: await listTtsModels(root, ttsDownloads, EDIT_FAMILIES) });
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/tts/download') {
        const input = await body(req, 64 * 1024);
        const { model } = resolveTtsModel(input);
        if (await isTtsModelInstalled(root, model)) return send(200, { ok: true, installed: true });
        void downloadTtsModel({ fetchImpl, root, model, downloads: ttsDownloads });
        return send(202, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/tts/preview') {
        // Short cached sample of one preset voice so the user can audition it before generating.
        const input = await body(req, 64 * 1024);
        const { model } = resolveTtsModel({ ...input, mode: 'preset' });
        const voiceId = presetVoice(model, text(input.voiceId, 40));
        const cacheFile = path.join(outputDirectory, 'preset-previews', `${model.family.id}-${model.variant.size}-${text(input.precision, 12)}-${voiceId}.wav`.replace(/[^\w.-]+/g, '_'));
        if (await exists(cacheFile)) return send(200, { dataUrl: `data:audio/wav;base64,${(await readFile(cacheFile)).toString('base64')}`, cached: true });
        if (generating) throw fail(409, '이미 다른 작업을 실행 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 8000 };
        try {
          const result = await runTtsTool({ family: model.family.id, mode: 'preset', size: model.variant.size, precision: text(input.precision, 12), voiceId, language: 'ko', text: '안녕하세요, 저는 이 목소리입니다. 오늘도 좋은 하루 되세요.' });
          await mkdir(path.dirname(cacheFile), { recursive: true });
          await writeFile(cacheFile, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
          return send(200, { dataUrl: result.dataUrl, cached: false });
        } finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/tts') {
        const input = await body(req, 50 * 1024 * 1024);
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: Math.max(20000, text(input.text, 20000).length * 250) };
        try { return send(200, await runTtsTool(input)); }
        finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/asr') {
        const input = await body(req, 50 * 1024 * 1024);
        if (!(typeof input.audioDataUrl === 'string' && input.audioDataUrl.length)) throw fail(400, '인식할 오디오가 필요합니다.');
        if (generating) throw fail(409, '이미 다른 작업을 실행 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 30000 };
        try {
          const workDir = path.join(outputDirectory, `asr-tool-${randomUUID()}`);
          await mkdir(workDir, { recursive: true });
          let transcript;
          try {
            const wav = await normalizeInputAudio(workDir, input.audioDataUrl);
            transcript = await transcribeWav(workDir, wav, text(input.language, 8), text(input.family, 20), text(input.size, 8), text(input.precision, 8));
          } finally { await rm(workDir, { recursive: true, force: true }).catch(() => {}); }
          return send(200, { transcript });
        } finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/vc') {
        // Speech voice conversion (MeanVC2, zero-shot): source speech + reference voice -> converted speech.
        const input = await body(req, 100 * 1024 * 1024);
        if (!(typeof input.audioDataUrl === 'string' && input.audioDataUrl.length)) throw fail(400, '변환할 원본 오디오가 필요합니다.');
        if (!(typeof input.referenceDataUrl === 'string' && input.referenceDataUrl.length)) throw fail(400, '목표 목소리의 참조 오디오를 선택해 주세요.');
        if (generating) throw fail(409, '이미 다른 작업을 실행 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 15000 };
        try {
          const workDir = path.join(outputDirectory, `speech-vc-${randomUUID()}`);
          await mkdir(workDir, { recursive: true });
          let dataUrl;
          try {
            const sourceDir = path.join(workDir, 'src');
            const refDir = path.join(workDir, 'ref');
            await mkdir(sourceDir, { recursive: true });
            await mkdir(refDir, { recursive: true });
            const sourceWav = await normalizeInputAudio(sourceDir, input.audioDataUrl);
            const referenceWav = await normalizeInputAudio(refDir, input.referenceDataUrl);
            const outputWav = path.join(workDir, 'converted.wav');
            await runMeanVc2Svc(sourceWav, referenceWav, outputWav, { meanvcPrecision: input.precision });
            dataUrl = `data:audio/wav;base64,${(await readFile(outputWav)).toString('base64')}`;
          } finally { await rm(workDir, { recursive: true, force: true }).catch(() => {}); }
          return send(200, { dataUrl });
        } finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/edit') {
        const input = await body(req, 50 * 1024 * 1024);
        if (!(typeof input.audioDataUrl === 'string' && input.audioDataUrl.length)) throw fail(400, '편집할 원본 오디오가 필요합니다.');
        if (generating) throw fail(409, '이미 다른 작업을 실행 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 30000 };
        try { return send(200, await editSpeech(input)); }
        finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'POST' && pathname === '/api/audio-tools/adjust') {
        const input = await body(req, 50 * 1024 * 1024);
        if (!(typeof input.audioDataUrl === 'string' && input.audioDataUrl.length)) throw fail(400, '조절할 오디오가 필요합니다.');
        if (generating) throw fail(409, '이미 다른 작업을 실행 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        generationStatus = { projectId: null, startedAt: Date.now(), expectedMs: 8000 };
        try { return send(200, await adjustAudio(input)); }
        finally { generating = false; generationStatus = null; }
      }
      // job.child(ChildProcess)는 JSON으로 못 보내니 제외하고 나머지 상태만 프론트에 노출한다.
      const publicDdspJob = (job) => ({ id: job.id, projectId: job.projectId, status: job.status, targetStep: job.targetStep, currentStep: job.currentStep, currentLoss: job.currentLoss, featureEncoder: job.featureEncoder, pitchExtractor: job.pitchExtractor, vocoder: job.vocoder, createdAt: job.createdAt, updatedAt: job.updatedAt, skippedRefs: job.skippedRefs, error: job.error });
      const timbreDdspStartMatch = pathname.match(/^\/api\/timbre-transform\/([^/]+)\/ddsp\/start$/);
      if (timbreDdspStartMatch && req.method === 'POST') {
        const input = await body(req, 200 * 1024 * 1024);
        const previewId = timbreDdspStartMatch[1];
        const dir = timbrePreviewDir(previewId);
        if (!(await exists(dir))) throw fail(404, '원본 오디오 준비 정보를 찾을 수 없습니다. 원본을 다시 선택해 주세요.');
        if (ddspActive) throw fail(409, '이미 다른 DDSP-SVC 학습이 진행 중입니다. 완료 후 다시 시도해 주세요.');
        const references = Array.isArray(input.referenceDataUrls) ? input.referenceDataUrls : [];
        if (!references.length) throw fail(400, '레퍼런스 오디오를 1개 이상 선택해 주세요.');
        const targetStep = Math.max(100, Math.min(500000, Math.round(Number(input.targetStep)) || 40000));
        const stems = path.join(dir, 'stems');
        const originalVocalsWav = path.join(stems, 'vocals-original.wav');
        if (!(await exists(originalVocalsWav))) throw fail(502, '보컬/악기 분리 결과를 찾을 수 없습니다.');
        const jobId = randomUUID();
        const jobWorkDir = path.join(outputDirectory, `ddsp-job-${jobId}`);
        await mkdir(jobWorkDir, { recursive: true });
        const referenceFiles = [];
        for (let index = 0; index < references.length; index += 1) {
          const match = typeof references[index] === 'string' && references[index].match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
          if (!match) continue;
          const ext = AUDIO_MIME[match[1]];
          if (!ext) continue;
          const buffer = Buffer.from(match[2], 'base64');
          const filePath = path.join(jobWorkDir, `ref-${index}.${ext}`);
          await writeFile(filePath, buffer);
          referenceFiles.push(filePath);
        }
        if (!referenceFiles.length) { await rm(jobWorkDir, { recursive: true, force: true }).catch(() => {}); throw fail(400, '유효한 레퍼런스 오디오가 없습니다.'); }
        const job = { id: jobId, projectId: previewId, status: 'preparing', targetStep, currentStep: 0, currentLoss: null, featureEncoder: null, pitchExtractor: null, vocoder: null, createdAt: Date.now(), updatedAt: Date.now(), expdir: null, configPath: null, child: null, skippedRefs: [], error: null };
        ddspJobs.set(jobId, job);
        ddspActive = true;
        const ddspSvcRoot = resolveConfigPath(settings.ddspSvcPath, DEFAULT_DDSP_SVC_PATH);
        // 의도적으로 await하지 않는다 -- 이 HTTP 요청은 jobId만 즉시 돌려주고, 실제 학습은
        // 백그라운드에서 계속 진행되며 GET /api/ddsp-jobs로 폴링한다(다이얼로그가 닫혀도 유지).
        startDdspJob(ddspSvcRoot, job, referenceFiles, {
          spawnImpl,
          sourceVocalPath: originalVocalsWav,
          postProcess: (convertedVocalPath, workDir) => postProcessConvertedVocal(convertedVocalPath, originalVocalsWav, workDir),
          featureEncoder: input.featureEncoder,
          pitchExtractor: input.pitchExtractor,
          vocoder: input.vocoder,
        }).then(async (gatedVocalPath) => {
          if (gatedVocalPath) await copyFile(gatedVocalPath, path.join(stems, 'vocals.wav'));
        }).catch(() => {}) // 실패 사유는 이미 job.error에 기록됨 (startDdspJob 내부)
          .finally(async () => { ddspActive = false; await rm(jobWorkDir, { recursive: true, force: true }).catch(() => {}); });
        return send(200, { jobId });
      }
      if (req.method === 'GET' && pathname === '/api/ddsp-jobs') return send(200, [...ddspJobs.values()].map(publicDdspJob));
      const ddspJobCancelMatch = pathname.match(/^\/api\/ddsp-jobs\/([^/]+)\/cancel$/);
      if (ddspJobCancelMatch && req.method === 'POST') {
        const job = ddspJobs.get(ddspJobCancelMatch[1]);
        if (!job) throw fail(404, '학습 작업을 찾을 수 없습니다.');
        killDdspJob(job);
        return send(200, publicDdspJob(job));
      }
      if (req.method === 'POST' && pathname === '/api/audio-save') {
        const input = await body(req, 200 * 1024 * 1024);
        return send(200, await saveArbitraryAudio(input.dataUrl, input.title));
      }
      const stemsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/stems$/);
      if (stemsMatch && req.method === 'POST') {
        const input = await body(req);
        const modeKey = STEM_MODES[input.mode] ? input.mode : 'full';
        const entry = await findEntry(stemsMatch[1]);
        if (!entry || entry.project.status !== 'completed') throw fail(404, '완성된 음원을 찾을 수 없습니다.');
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        try { return send(200, await separateStems(entry, modeKey)); }
        finally { generating = false; }
      }
      if (stemsMatch && req.method === 'DELETE') {
        await body(req);
        const entry = await findEntry(stemsMatch[1]);
        if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
        await rm(stemsDir(entry.project.id), { recursive: true, force: true });
        return send(200, { ok: true });
      }
      const stemAudioMatch = pathname.match(/^\/api\/projects\/([^/]+)\/stems\/([a-z]+)$/);
      if (stemAudioMatch && req.method === 'GET') {
        if (!STEM_NAMES.includes(stemAudioMatch[2])) throw fail(404, '알 수 없는 STEM입니다.');
        const entry = await findEntry(stemAudioMatch[1]);
        if (!entry) throw fail(404, '프로젝트를 찾을 수 없습니다.');
        const stemFile = path.join(stemsDir(entry.project.id), `${stemAudioMatch[2]}.wav`);
        if (!(await exists(stemFile))) throw fail(404, 'STEM 파일을 찾을 수 없습니다. 먼저 STEM 분리를 실행해 주세요.');
        const data = await readFile(stemFile);
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(data.length), 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      const postProcessMatch = pathname.match(/^\/api\/projects\/([^/]+)\/post-process$/);
      if (postProcessMatch && req.method === 'POST') {
        const input = await body(req, 150 * 1024 * 1024);
        const match = typeof input.dataUrl === 'string' && input.dataUrl.match(/^data:audio\/wav;base64,(.+)$/);
        if (!match) throw fail(400, '처리된 오디오(WAV) 데이터가 필요합니다.');
        const entry = await findEntry(postProcessMatch[1]);
        if (!entry || entry.project.status !== 'completed' || !entry.project.audioPath) throw fail(404, '완성된 음원을 찾을 수 없습니다.');
        const dir = path.dirname(entry.file);
        const originalFile = path.join(dir, entry.project.audioPath);
        if (!(await exists(originalFile))) throw fail(404, '원본 음원 파일을 찾을 수 없습니다.');
        const ext = path.extname(entry.project.audioPath).slice(1).toLowerCase();
        if (!SAVE_FORMATS.has(ext)) throw fail(400, '지원하지 않는 원본 파일 형식입니다.');
        const buffer = Buffer.from(match[1], 'base64');
        const tempWav = path.join(outputDirectory, `post-process-${randomUUID()}.wav`);
        const outFile = path.join(outputDirectory, `post-process-${randomUUID()}.${ext}`);
        try {
          await writeFile(tempWav, buffer);
          const args = ext === 'mp4'
            ? ['-y', '-i', originalFile, '-i', tempWav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', outFile]
            : FFMPEG_ARGS[ext](tempWav, outFile);
          await new Promise((resolve, reject) => {
            const child = spawnImpl('ffmpeg', args, { windowsHide: true });
            child.once('error', reject);
            child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
          });
          const outStat = await stat(outFile).catch(() => null);
          if (!outStat?.size) throw fail(502, '후처리 결과 파일을 만들지 못했습니다. ffmpeg가 설치되어 있는지 확인해 주세요.');
          const data = await readFile(outFile);
          const base = path.basename(entry.project.audioPath, path.extname(entry.project.audioPath));
          const suggestedName = `${base}-modified.${ext}`;
          res.writeHead(200, { 'Content-Type': AUDIO_MIME_TYPES[`.${ext}`] || 'application/octet-stream', 'Content-Length': String(data.length), 'Content-Disposition': `attachment; filename="${encodeURIComponent(suggestedName)}"`, 'Cache-Control': 'no-store' });
          return res.end(data);
        } finally {
          await unlink(tempWav).catch(() => {});
          await unlink(outFile).catch(() => {});
        }
      }
      throw fail(404, '요청한 기능을 찾을 수 없습니다.');
    } catch (error) {
      send(error.status || 500, { error: error.status ? error.message : '로컬 파일 또는 서비스 처리에 실패했습니다. 앱을 다시 실행해 주세요.' });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createStudioServer();
  server.listen(4311, '127.0.0.1', () => console.log('음악 작업실 서비스: http://127.0.0.1:4311'));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '4311 포트를 이미 사용 중입니다. 실행 중인 앱을 확인해 주세요.' : '로컬 서비스를 시작할 수 없습니다.'); process.exitCode = 1; });
}
