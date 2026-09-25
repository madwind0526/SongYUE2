// Cover art for songs: a Z-Image Turbo picture made by ComfyUI, and the square crop / size limits that every cover follows.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const COVER_GENERATE_SIZE = 1536; // native size of the picture; above the 1400 px minimum, so it is never enlarged
export const COVER_MAX_SIZE = 2475;
export const COVER_MIN_SIZE = 1400;

// Model files are looked for by name pattern so the user's own folder layout (sub-folders, fp8 / fp4 variants) still works.
const UNET_PREFERENCE = [/z[_-]?image[_-]?turbo.*nvfp4/i, /z[_-]?image[_-]?turbo.*fp8/i, /z[_-]?image[_-]?turbo.*bf16/i];
const CLIP_PREFERENCE = [/qwen_3_4b_fp8_mixed/i, /qwen_3_4b_fp4_mixed/i, /qwen_3_4b\.safetensors$/i];
const VAE_PREFERENCE = [/(^|[\\/])ae\.safetensors$/i];

const firstMatch = (names, patterns) => { for (const pattern of patterns) { const found = names.find((name) => pattern.test(name)); if (found) return found; } return null; };
const optionsOf = (info, node, field) => (info?.[node]?.input?.required?.[field]?.[0] || []).filter((item) => typeof item === 'string');

// Picks the Z-Image Turbo files that ComfyUI can see (object_info of UNETLoader / CLIPLoader / VAELoader); null when a piece is missing.
export function pickCoverModels(info) {
  const unet = firstMatch(optionsOf(info, 'UNETLoader', 'unet_name'), UNET_PREFERENCE);
  const clip = firstMatch(optionsOf(info, 'CLIPLoader', 'clip_name'), CLIP_PREFERENCE);
  const vae = firstMatch(optionsOf(info, 'VAELoader', 'vae_name'), VAE_PREFERENCE);
  return unet && clip && vae ? { unet, clip, vae } : null;
}

const oneLine = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

// The picture follows the music style only: Z-Image draws any title or lyric line it is given (Korean too) as letters inside the picture,
// so neither is put in the prompt. Vocal gender / instrumental only decide whether a singer belongs in the scene.
export function buildCoverPrompt({ style, instrumental, vocalGender }) {
  // Only plain English / ASCII goes into the prompt (Korean text would be drawn into the picture)
  const asciiStyle = oneLine(String(style || '').replace(/[^ -~]/g, ' '), 240).replace(/\s*,\s*(,\s*)+/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
  const singer = instrumental ? 'No singer, only instruments or scenery.' : vocalGender === 'male' ? 'A male singer may appear.' : vocalGender === 'female' ? 'A female singer may appear.' : '';
  const parts = [
    'Wordless purely visual album cover artwork, cinematic painterly illustration, rich atmosphere, balanced composition, a scene without any signs, captions, letters, numbers or handwriting.',
    asciiStyle ? `Music style: ${asciiStyle}.` : '',
    singer,
  ];
  return parts.filter(Boolean).join(' ');
}

export function buildCoverWorkflow({ models, prompt, seed, size = COVER_GENERATE_SIZE }) {
  return {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'lumina2', device: 'default' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    '5': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    '6': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3.0 } },
    '7': { class_type: 'EmptySD3LatentImage', inputs: { width: size, height: size, batch_size: 1 } },
    '8': { class_type: 'KSampler', inputs: { model: ['6', 0], seed, steps: 8, cfg: 1.0, sampler_name: 'res_multistep', scheduler: 'simple', positive: ['4', 0], negative: ['5', 0], latent_image: ['7', 0], denoise: 1.0 } },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    '10': { class_type: 'PreviewImage', inputs: { images: ['9', 0] } },
  };
}

// Makes one picture with ComfyUI (already running at `endpoint`) and returns the PNG bytes, or null when the models are not installed.
export async function generateCoverPicture({ fetchImpl, endpoint, project, timeoutMs = 240000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() }) {
  const json = async (url, init) => { const response = await fetchImpl(url, init); if (!response.ok) throw new Error(`ComfyUI ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`); return response.json(); };
  const infoParts = await Promise.all(['UNETLoader', 'CLIPLoader', 'VAELoader'].map((node) => json(`${endpoint}/object_info/${node}`).catch(() => ({}))));
  const models = pickCoverModels(Object.assign({}, ...infoParts));
  if (!models) return null;
  const seed = Number.isSafeInteger(Number(project.seed)) ? Math.abs(Number(project.seed)) : Math.floor(Math.random() * 2 ** 31);
  const prompt = buildCoverPrompt(project);
  const queued = await json(`${endpoint}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: buildCoverWorkflow({ models, prompt, seed }) }) });
  const promptId = queued.prompt_id;
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const history = await json(`${endpoint}/history/${promptId}`);
    const entry = history[promptId];
    if (entry?.status?.completed !== undefined || entry?.status?.status_str === 'error') {
      if (entry.status.status_str === 'error') {
        const failure = (entry.status.messages || []).find((message) => message[0] === 'execution_error');
        throw new Error(failure?.[1]?.exception_message || 'ComfyUI reported an error');
      }
      const image = Object.values(entry.outputs || {}).flatMap((node) => node.images || [])[0];
      if (!image) throw new Error('ComfyUI returned no picture');
      const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'temp' });
      const picture = await fetchImpl(`${endpoint}/view?${query}`);
      if (!picture.ok) throw new Error(`ComfyUI view ${picture.status}`);
      return Buffer.from(await picture.arrayBuffer());
    }
    await sleep(1500);
  }
  throw new Error('cover generation timed out');
}

// ffmpeg filter: centre square crop, then at most COVER_MAX_SIZE (never enlarged)
export const squareCropFilter = () => `crop='min(iw,ih)':'min(iw,ih)',scale='min(${COVER_MAX_SIZE},iw)':-1:flags=lanczos`;

// Any uploaded or generated picture -> a square image (JPEG for pictures, PNG kept as PNG) plus its size, so the caller can warn about low resolution.
export async function normalizeCover({ buffer, extension, outputExtension, spawnImpl, runProbe }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue2-cover-'));
  try {
    const ext = (outputExtension || extension) === 'png' ? 'png' : 'jpg';
    const input = path.join(dir, `in.${extension}`);
    const output = path.join(dir, `out.${ext}`);
    await writeFile(input, buffer);
    const args = ['-v', 'error', '-y', '-i', input, '-vf', squareCropFilter(), '-frames:v', '1', ...(ext === 'jpg' ? ['-q:v', '2'] : []), output];
    await new Promise((resolve, reject) => {
      const child = spawnImpl('ffmpeg', args, { windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
    });
    const size = runProbe ? await runProbe(output) : null;
    return { buffer: await readFile(output), extension: ext, size };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- Fallback cover (no ComfyUI / no image models): a coloured gradient with the title, drawn by ffmpeg ----
const FONT_CANDIDATES = ['C:/Windows/Fonts/malgunbd.ttf', 'C:/Windows/Fonts/malgun.ttf', 'C:/Windows/Fonts/gulim.ttc', '/System/Library/Fonts/AppleSDGothicNeo.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Bold.otf'];
// Base hue (0-360) by style words; anything else gets a hue from the title / style hash, so every song looks a little different
const MOOD_HUES = [[/ballad|piano|acoustic|folk|lo-?fi|calm|sad/i, 215], [/rock|metal|punk|hard/i, 5], [/jazz|blues|soul|swing/i, 32], [/electronic|edm|synth|dance|techno|house/i, 275], [/hip-?hop|rap|trap|r&b/i, 20], [/classical|orchestra|cinematic|ambient/i, 165], [/pop|k-?pop|bright|happy/i, 335]];

export function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  return hash >>> 0;
}

function hslToHex(hue, saturation, lightness) {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n) => { const k = (n + hue / 30) % 12; return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [channel(0), channel(8), channel(4)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function fallbackCoverColors({ title, style }) {
  const hash = hashText(`${title}|${style}`);
  const mood = MOOD_HUES.find(([pattern]) => pattern.test(String(style || '')));
  const hue = ((mood ? mood[1] : hash % 360) + (hash % 24) - 12 + 360) % 360;
  return { from: hslToHex(hue, 0.62, 0.38), to: hslToHex((hue + 42) % 360, 0.7, 0.16) };
}

// Wide (Hangul / CJK) characters count 1, Latin ones about half; lines break at spaces when they can; at most 4 lines of 8 units
const unitsOf = (text) => [...text].reduce((sum, char) => sum + (/[ -~]/.test(char) ? 0.55 : 1), 0);
export function wrapCoverTitle(title, unitsPerLine = 8, maxLines = 4) {
  const lines = [];
  let line = '';
  for (const char of String(title || '').replace(/\s+/g, ' ').trim()) {
    if (unitsOf(line + char) > unitsPerLine && line.trim()) {
      const space = line.lastIndexOf(' ');
      if (char !== ' ' && space > 0) { lines.push(line.slice(0, space).trim()); line = line.slice(space + 1); }
      else { lines.push(line.trim()); line = ''; }
      if (lines.length === maxLines) break;
    }
    line += char;
  }
  if (lines.length < maxLines && line.trim()) lines.push(line.trim());
  else if (lines.length === maxLines) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`;
  return lines.filter(Boolean);
}

const filterPath = (file) => file.replace(/\\/g, '/').replace(/:/g, '\\:');

export async function makeFallbackCover({ title, style, spawnImpl, fileExists }) {
  const size = COVER_MAX_SIZE;
  const { from, to } = fallbackCoverColors({ title, style });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue2-fallback-'));
  try {
    let font = null;
    for (const candidate of FONT_CANDIDATES) { if (await fileExists(candidate)) { font = candidate; break; } }
    const lines = wrapCoverTitle(title);
    const genre = oneLine(String(style || '').split(',')[0], 28);
    const filters = [`vignette=angle=PI/4`];
    if (font && lines.length) {
      const fontSize = lines.length > 2 ? 250 : 290;
      const gap = 50;
      const blockHeight = lines.length * fontSize + (lines.length - 1) * gap;
      const top = Math.round(size * (genre ? 0.42 : 0.5) - blockHeight / 2);
      for (const [index, text] of lines.entries()) {
        const file = path.join(dir, `line${index}.txt`);
        await writeFile(file, text, 'utf8');
        filters.push(`drawtext=fontfile='${filterPath(font)}':textfile='${filterPath(file)}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${top + index * (fontSize + gap)}:shadowcolor=black@0.45:shadowx=6:shadowy=6`);
      }
      if (genre) {
        const genreFile = path.join(dir, 'genre.txt');
        await writeFile(genreFile, genre, 'utf8');
        filters.push(`drawtext=fontfile='${filterPath(font)}':textfile='${filterPath(genreFile)}':fontsize=110:fontcolor=white@0.72:x=(w-text_w)/2:y=h*0.82`);
      }
    }
    const output = path.join(dir, 'cover.jpg');
    const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `gradients=s=${size}x${size}:c0=0x${from}:c1=0x${to}:x0=0:y0=0:x1=${size}:y1=${size}:d=1:r=1`, '-vf', filters.join(','), '-frames:v', '1', '-q:v', '2', output];
    await new Promise((resolve, reject) => {
      const child = spawnImpl('ffmpeg', args, { windowsHide: true });
      child.once('error', reject);
      child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
