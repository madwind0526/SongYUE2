import http from 'node:http';
import { mkdir, readFile, writeFile, rename, readdir, access, unlink, rm, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';

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
const UNSUPPORTED_MODEL_MESSAGES = {
  'yue2-int8-convrot': 'INT8 ConvRot 파일은 현재 ComfyUI 형식 safetensors입니다. SongYUE2의 직접 생성 엔진에는 아직 연결되지 않았습니다. ComfyUI 어댑터를 추가한 뒤 사용할 수 있어요.',
};
const AUDIOCPP_SIDECARS = ['sidecars/yue2-model-config.json', 'sidecars/yue2-generation-config.json', 'sidecars/yue2-qwen.tiktoken', 'sidecars/yue2-vae-config.json'];
const EXAMPLE_COLORS = ['sage', 'blue', 'sand'];
const DEFAULT_EXAMPLES = [
  { title: '늦은 밤의 어쿠스틱', genre: '어쿠스틱 팝', caption: '따뜻한 기타와 담백한 목소리', color: 'sage', style: 'Korean, acoustic pop, intimate warm vocal, fingerpicked guitar, soft drums, gentle evening mood, 82 BPM', lyrics: '[Verse]\n창가에 남은 작은 불빛\n하루의 끝에 너를 생각해\n말없이 건넨 따뜻한 마음\n오늘도 나를 쉬게 해\n\n[Chorus]\n조금 느리게 걸어도 좋아\n우리의 밤은 아직 길어\n너의 목소리 곁에 머물면\n여기가 나의 집이 돼' },
  { title: '도시의 푸른 새벽', genre: '시티 팝', caption: '반짝이는 신스와 느긋한 리듬', color: 'blue', style: 'Korean, city pop, mellow vocal, electric piano, round bass, shimmering synth, relaxed groove, 104 BPM', lyrics: '[Verse]\n잠들지 않은 거리 위로\n푸른 새벽이 내려오면\n어제의 걱정 흘려보내\n낯선 바람에 기대어\n\n[Chorus]\n빛을 따라 달려가\n아직 모르는 내일로\n우리의 작은 꿈들이\n이 도시를 깨울 때' },
  { title: '마음을 전하는 피아노', genre: '피아노 발라드', caption: '여백이 있는 감성적인 선율', color: 'sand', style: 'Korean, piano ballad, expressive soft vocal, spacious piano, subtle strings, tender and hopeful, 72 BPM', lyrics: '[Verse]\n다 하지 못한 말들이\n건반 위에 내려앉아\n그대의 이름 부르면\n작은 노래가 되네\n\n[Chorus]\n언제나 그대 곁에서\n조용한 빛이 될게요\n시간이 우리를 지나도\n이 마음은 여기 있어요' },
];
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
const SAVE_FORMATS = new Set(['wav', 'flac', 'mp3', 'mp4']);
const AUDIO_MIME_TYPES = { '.wav': 'audio/wav', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
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
const VOCAL_GENDERS = new Set(['', 'male', 'female', 'duet']);
const DEFAULT_STYLE_PRESETS = 'Acoustic\nCity Pop\nBallad\nLo-fi\nJazz';
const DEFAULT_VISUALIZER_ENABLED = true;
const DEFAULT_VISUALIZER_RING_COUNT = 18;
const DEFAULT_VISUALIZER_HUE = 190;
const DEFAULT_VISUALIZER_LINE_WIDTH = 1;
const VOCAL_HINTS = { male: ', male vocal', female: ', female vocal', duet: ', duet: male and female vocals' };
const vocalHint = (gender) => VOCAL_HINTS[gender] || '';
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
    pythonMemoryBudgetGib: Number.isFinite(stored.pythonMemoryBudgetGib) ? stored.pythonMemoryBudgetGib : (Number(process.env.PYTHON_MEMORY_BUDGET_GIB) || 11),
    saveFormat: SAVE_FORMATS.has(stored.saveFormat) ? stored.saveFormat : (SAVE_FORMATS.has(process.env.SAVE_FORMAT) ? process.env.SAVE_FORMAT : 'wav'),
    viewMode: VIEW_MODES.has(stored.viewMode) ? stored.viewMode : 'list',
    outputDirectory,
  };
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
      for (const name of files.filter((entry) => entry.endsWith('.json'))) {
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
    const projectRuns = path.join(outputDirectory, project.id);
    await mkdir(projectRuns, { recursive: true });
    const audioFile = path.join(projectRuns, 'audio.wav');
    const logFile = path.join(projectRuns, 'generate.log');
    const threads = Math.max(1, Math.min(8, os.cpus().length));
    const args = [
      '--task', 'gen', '--family', 'yue2', '--model', modelRoot, '--backend', 'cuda', '--threads', String(threads),
      '--session-option', `yue2.model_gguf=${preset.model}`, '--session-option', `yue2.vae_gguf=${preset.vae}`,
      '--lyrics', project.lyrics, '--request-option', `style=${project.style}${styleHint(project)}`, '--request-option', `cot=${project.cot}`,
      '--request-option', `num_inference_steps=${project.steps}`, '--seed', String(project.seed),
      '--out', audioFile, '--log', '--metrics',
    ];
    const log = await new Promise((resolve, reject) => {
      const child = spawnImpl(engine, args, { windowsHide: true });
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
    await mkdir(outDir, { recursive: true });
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
    return { provider: settings.provider, endpoint: env.endpoint, llmModel: env.model, enginePath: settings.enginePath, pythonEnginePath: settings.pythonEnginePath, pythonScriptPath: settings.pythonScriptPath, pythonMemoryBudgetGib: settings.pythonMemoryBudgetGib, sheetSagePythonPath: settings.sheetSagePythonPath, settingPath: settings.settingPath, musicPath: settings.musicPath, examplesPath: settings.examplesPath, coversPath: settings.coversPath, abcNotesPath: settings.abcNotesPath, stylePresets: settings.stylePresets, visualizerEnabled: settings.visualizerEnabled, visualizerRingCount: settings.visualizerRingCount, visualizerHue: settings.visualizerHue, visualizerLineWidth: settings.visualizerLineWidth, saveFormat: settings.saveFormat, viewMode: settings.viewMode, outputDirectory: path.relative(root, outputDirectory) || '.', hasApiKey: Boolean(env.apiKey), apiKey: env.apiKey ? '***' : null, apiKeyStorage: 'env' };
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
      const allowedOrigins = new Set([`http://127.0.0.1:${ownPort}`, `http://localhost:${ownPort}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);
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
          if (input.saveFormat !== undefined) next.saveFormat = input.saveFormat;
          if (input.viewMode !== undefined) next.viewMode = input.viewMode;
          await saveJson(settingsFile, { provider: next.provider, enginePath: next.enginePath, pythonEnginePath: next.pythonEnginePath, pythonScriptPath: next.pythonScriptPath, pythonMemoryBudgetGib: next.pythonMemoryBudgetGib, sheetSagePythonPath: next.sheetSagePythonPath, settingPath: next.settingPath, musicPath: next.musicPath, examplesPath: next.examplesPath, coversPath: next.coversPath, abcNotesPath: next.abcNotesPath, stylePresets: next.stylePresets, visualizerEnabled: next.visualizerEnabled, visualizerRingCount: next.visualizerRingCount, visualizerHue: next.visualizerHue, visualizerLineWidth: next.visualizerLineWidth, saveFormat: next.saveFormat, viewMode: next.viewMode });
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
        if (generating) throw fail(409, '이미 다른 곡을 생성하는 중입니다. 완료 후 다시 시도해 주세요.');
        generating = true;
        const isPython = Boolean(PYTHON_MODELS[entry.project.modelId]);
        const runner = isPython ? runPythonYue2 : runAudioCpp;
        const expectedMs = isPython ? 240000 : Math.round(60000 * (Math.max(1, entry.project.steps) / 8));
        generationStatus = { projectId: entry.project.id, startedAt: Date.now(), expectedMs };
        try { return send(200, await runner(entry.project, entry.file)); }
        finally { generating = false; generationStatus = null; }
      }
      if (req.method === 'GET' && pathname === '/api/generate/status') {
        if (!generating || !generationStatus) return send(200, { active: false, elapsedMs: 0, expectedMs: 0 });
        return send(200, { active: true, projectId: generationStatus.projectId, elapsedMs: Date.now() - generationStatus.startedAt, expectedMs: generationStatus.expectedMs });
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
