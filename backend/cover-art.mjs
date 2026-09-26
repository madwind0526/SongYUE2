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
// (enlargeTo: pictures smaller than that are enlarged to it, 0 = never enlarge)
export const squareCropFilter = (enlargeTo = 0) => `crop='min(iw,ih)':'min(iw,ih)',scale='max(${enlargeTo},min(${COVER_MAX_SIZE},iw))':-1:flags=lanczos`;

// Any uploaded or generated picture -> a square image (JPEG for pictures, PNG kept as PNG) plus its size, so the caller can warn about low resolution.
export async function normalizeCover({ buffer, extension, outputExtension, enlargeTo = 0, spawnImpl, runProbe }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue2-cover-'));
  try {
    const ext = (outputExtension || extension) === 'png' ? 'png' : 'jpg';
    const input = path.join(dir, `in.${extension}`);
    const output = path.join(dir, `out.${ext}`);
    await writeFile(input, buffer);
    const args = ['-v', 'error', '-y', '-i', input, '-vf', squareCropFilter(enlargeTo), '-frames:v', '1', ...(ext === 'jpg' ? ['-q:v', '2'] : []), output];
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

// ---- Free web photo (Pixabay) when ComfyUI cannot make the picture; the key comes from .env (PIXABAY_API_KEY) ----
export const PIXABAY_MIN_SIZE = 1280; // original size asked for
// Pixabay serves at most 1280 px on the long side without full API access, so the square crop is 1280 x (short / long side); crops under
// PIXABAY_MIN_CROP are left out, the others are enlarged to the cover minimum by the caller
export const PIXABAY_LONG_SIDE = 1280;
export const PIXABAY_MIN_CROP = 900;
const cropSide = (hit) => PIXABAY_LONG_SIDE * Math.min(hit.imageWidth, hit.imageHeight) / Math.max(hit.imageWidth, hit.imageHeight);

// Pixabay does not search Korean, so common lyric words are mapped to English picture words (substring match, so 밤에 / 밤이 count as 밤)
const LYRIC_WORDS = [['밤', 'night'], ['별', 'stars'], ['달빛', 'moonlight'], ['달', 'moon'], ['하늘', 'sky'], ['구름', 'clouds'], ['바다', 'sea'], ['파도', 'waves'], ['해변', 'beach'], ['비', 'rain'], ['눈물', 'tears'], ['꽃', 'flowers'], ['벚꽃', 'cherry blossom'], ['봄', 'spring'], ['여름', 'summer'], ['가을', 'autumn'], ['겨울', 'winter'], ['바람', 'wind'], ['햇살', 'sunlight'], ['노을', 'sunset'], ['새벽', 'dawn'], ['아침', 'morning'], ['도시', 'city'], ['거리', 'street'], ['길', 'road'], ['걸어', 'walking'], ['산', 'mountain'], ['강', 'river'], ['숲', 'forest'], ['나무', 'trees'], ['들판', 'field'], ['사랑', 'love'], ['이별', 'farewell'], ['그리움', 'longing'], ['외로', 'lonely'], ['혼자', 'alone'], ['추억', 'memories'], ['기억', 'memories'], ['꿈', 'dream'], ['자유', 'freedom'], ['춤', 'dance'], ['커피', 'coffee'], ['창문', 'window'], ['불빛', 'lights'], ['네온', 'neon'], ['기차', 'train'], ['비행기', 'airplane'], ['여행', 'travel'], ['집', 'home'], ['고양이', 'cat'], ['강아지', 'dog'], ['아이', 'child'], ['엄마', 'mother'], ['웃음', 'smile'], ['태양', 'sun'], ['불꽃', 'fire'], ['안개', 'fog'], ['호수', 'lake'], ['섬', 'island'], ['사막', 'desert'], ['우주', 'space'], ['크리스마스', 'christmas'], ['축제', 'festival'], ['파티', 'party'], ['드라이브', 'driving'], ['자동차', 'car'], ['학교', 'school'], ['시간', 'clock'], ['편지', 'letter'], ['손', 'hands'], ['미소', 'smile']];
const GENERIC_QUERIES = ['landscape', 'sunset sky', 'city night', 'nature', 'sea', 'mountain', 'flowers', 'autumn'];

// English picture words from the title and lyrics: the ones that occur most come first (title counts double)
export function lyricKeywords({ title, lyrics }) {
  const text = `${title || ''} ${title || ''} ${lyrics || ''}`.replace(/\[.*?\]/g, ' ');
  const found = new Map();
  for (const [korean, english] of LYRIC_WORDS) {
    const hits = text.split(korean).length - 1;
    if (hits) found.set(english, (found.get(english) || 0) + hits);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([english]) => english);
}

// Queries in order: lyric words, English words of the title, English style words, then a general picture chosen by the song's seed (not necessarily music)
export function pixabayQueries({ style, title, lyrics, seed } = {}) {
  const tags = String(style || '').replace(/[^ -~]/g, ' ').split(',').map((tag) => oneLine(tag, 40)).filter(Boolean);
  const words = lyricKeywords({ title, lyrics });
  const titleWords = oneLine(String(title || '').replace(/[^ -~]/g, ' '), 60);
  const general = GENERIC_QUERIES[Math.abs(Number(seed) || 0) % GENERIC_QUERIES.length];
  const queries = [words.slice(0, 2).join(' '), words[0] || '', titleWords.length >= 4 ? titleWords : '', tags.slice(0, 3).join(' '), tags[0] || '', general].map((query) => query.slice(0, 100)).filter(Boolean);
  return [...new Set(queries)];
}

// Prefers photos that are close to square (little is lost when cropping) and picks one of the best by the song's seed, so a style does not always give the same picture
export function pickPixabayHit(hits, seed) {
  const usable = (hits || []).filter((hit) => hit.largeImageURL && hit.imageWidth >= PIXABAY_MIN_SIZE && hit.imageHeight >= PIXABAY_MIN_SIZE && cropSide(hit) >= PIXABAY_MIN_CROP);
  usable.sort((a, b) => Math.abs(Math.log(a.imageWidth / a.imageHeight)) - Math.abs(Math.log(b.imageWidth / b.imageHeight)));
  const best = usable.slice(0, 10);
  return best.length ? best[Math.abs(Number(seed) || 0) % best.length] : null;
}

// Returns the JPEG bytes of one matching free photo, or null (no key, nothing found, or a request failed)
export async function fetchPixabayCover({ fetchImpl, apiKey, style, title, lyrics, seed }) {
  if (!apiKey) return null;
  for (const query of pixabayQueries({ style, title, lyrics, seed })) {
    const params = new URLSearchParams({ key: apiKey, q: query, image_type: 'photo', min_width: String(PIXABAY_MIN_SIZE), min_height: String(PIXABAY_MIN_SIZE), safesearch: 'true', order: 'popular', per_page: '200' });
    const response = await fetchImpl(`https://pixabay.com/api/?${params}`);
    if (!response.ok) throw new Error(`Pixabay ${response.status}`);
    const hit = pickPixabayHit((await response.json()).hits, seed);
    if (!hit) continue;
    const picture = await fetchImpl(hit.largeImageURL);
    if (!picture.ok) throw new Error(`Pixabay image ${picture.status}`);
    return Buffer.from(await picture.arrayBuffer());
  }
  return null;
}
