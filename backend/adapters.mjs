// LoRA/LoKr adapter management: searching Hugging Face for YuE2 adapters, classifying them from what the repos
// publish (tags, card data, file names, sample audio, README), installing them into models/yue-adapters and keeping
// a small metadata file next to each installed adapter so it can be recognised by more than its file name.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const HF = 'https://huggingface.co';
export const META_FILE = 'songyue2-adapter.json';
const REPO_PATTERN = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

// Tags that describe the tooling, not the music.
const NOISE_TAGS = new Set(['lora', 'yue2', 'yue', 'music-generation', 'text-to-music', 'song-generation', 'text-to-audio', 'audio', 'music', 'safetensors', 'comfyui', 'fs_audio', 'ai-toolkit', 'diffusers', 'peft', 'endpoints_compatible', 'jam', 'tokenizer', 'adapter']);

// Korean categories used for filtering; the first matching category of a tag/name wins per keyword.
const CATEGORIES = [
  ['록/메탈', /rock|metal|punk|grunge|industrial|hardcore|deathmetal/i],
  ['레게/댄스홀', /reggae|dancehall|ska|dub|steppers/i],
  ['재즈/블루스', /jazz|blues|swing|bossa/i],
  ['힙합/R&B', /hip-?hop|rap|trap|r&b|rnb|soul|funk/i],
  ['팝', /(^|[^a-z])(j-?pop|k-?pop|pop|synth-?pop|ye-?ye|city-?pop|italo)/i],
  ['포크/어쿠스틱', /folk|acoustic|country|singer-?songwriter|chanson|ballad/i],
  ['클래식/오케스트라', /orchestra|cinematic|epic|trailer|classical|symphon|choir|opera/i],
  ['일렉트로닉', /electro|edm|house|techno|trance|disco|ambient|synthwave|dubstep|afrobeats/i],
  ['월드/민속', /world|qawwali|sufi|balkan|ethno|tuvan|throat|latin|flamenco|celtic|bhangra|african/i],
];

const LANGUAGE_NAMES = new Intl.DisplayNames(['ko'], { type: 'language' });
const languageName = (code) => { try { return LANGUAGE_NAMES.of(code); } catch { return code; } };

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const baseModels = (model) => [...asArray(model.cardData?.base_model), ...(model.tags || []).filter((tag) => tag.startsWith('base_model:')).map((tag) => tag.replace(/^base_model:(adapter:|finetune:|quantized:)?/, ''))];

// A repo is a YuE2 adapter repo when it holds weights and either names YuE2 or is trained on it; adapters for
// other models (a search for "yue2" also finds image LoRAs) are dropped.
export function isYueAdapterRepo(model) {
  const files = (model.siblings || []).map((item) => item.rfilename);
  if (!files.some((file) => file.endsWith('.safetensors'))) return false;
  const bases = baseModels(model).map((item) => item.toLowerCase());
  if (bases.length && !bases.some((item) => item.includes('yue2') || item.includes('mert'))) return false;
  const name = model.id.toLowerCase();
  const tags = (model.tags || []).map((tag) => tag.toLowerCase());
  // Converted or quantized copies of the whole model (MLX, FP8, GGUF, ...) are not adapters: an adapter says so itself.
  const yue2 = name.includes('yue2') || tags.includes('yue2');
  return yue2 && (tags.includes('lora') || /lora|adapter|slider/.test(name) || files.some((file) => /(^|[/_-])(lora|adapter)/i.test(file)));
}

const stageOfName = (name) => (/(^|[-_/. ])nar([-_/. 0-9]|$)/i.test(name) ? 'nar' : /(^|[-_/. ])ar([-_/. 0-9]|$)/i.test(name) ? 'ar' : 'unknown');

function categoriesOf(words) {
  const found = new Set();
  for (const [label, pattern] of CATEGORIES) if (words.some((word) => pattern.test(word))) found.add(label);
  return [...found];
}

// The files a single click on a repo card downloads: the only weight file, or exactly one composition (AR) + one sound (NAR) file
// (variants such as bf16 / ComfyUI copies do not count). null = the repo offers a choice the user has to make.
export function defaultPaths(model) {
  const all = listUnits(model);
  const units = all.filter((unit) => !unit.variant).length ? all.filter((unit) => !unit.variant) : all;
  if (units.length === 1) return [units[0].path];
  const stages = units.map((unit) => unit.stage);
  if (units.length === 2 && stages.includes('ar') && stages.includes('nar')) return units.map((unit) => unit.path);
  return null;
}

// What a repo tells about itself, reduced to the fields the UI filters and shows.
export function classifyRepo(model) {
  const files = (model.siblings || []).map((item) => item.rfilename);
  const weights = files.filter((file) => file.endsWith('.safetensors'));
  const languageCodes = [...asArray(model.cardData?.language), ...(model.tags || []).filter((tag) => /^[a-z]{2,3}$/.test(tag) && languageName(tag) !== tag)].map((code) => String(code).toLowerCase());
  const tags = (model.tags || []).filter((tag) => !tag.includes(':') && !NOISE_TAGS.has(tag.toLowerCase()) && !/^[a-z]{2,3}$/.test(tag));
  const name = model.id.split('/')[1];
  const stages = new Set(weights.map(stageOfName).filter((item) => item !== 'unknown'));
  const license = String(model.cardData?.license || (model.tags || []).find((tag) => tag.startsWith('license:'))?.slice(8) || '');
  return {
    id: model.id,
    url: `${HF}/${model.id}`,
    author: model.id.split('/')[0],
    title: name.replace(/^yue2[-_]?/i, '').replace(/[-_]?lora$/i, '').replace(/[-_]+/g, ' ').trim() || name,
    likes: model.likes || 0,
    downloads: model.downloads || 0,
    updatedAt: model.lastModified || model.createdAt || '',
    license,
    commercialUse: license ? !/(^|-)nc(-|$)/i.test(license) : null,
    categories: categoriesOf([...tags, name]),
    tags: tags.slice(0, 12),
    languages: [...new Set(languageCodes.map(languageName))],
    stage: stages.size > 1 ? 'both' : stages.size === 1 ? [...stages][0] : 'unknown',
    weightCount: weights.length,
    sampleCount: files.filter((file) => /\.(flac|mp3|wav|ogg)$/i.test(file)).length,
    comfyui: (model.tags || []).includes('comfyui') || weights.some((file) => /comfyui/i.test(file)),
    defaultPaths: defaultPaths(model),
  };
}

// The installable units of a repo (one weight file each, together with its adapter_config.json when it has one).
export function listUnits(model) {
  const sizes = new Map((model.siblings || []).map((item) => [item.rfilename, item.size || 0]));
  const files = [...sizes.keys()];
  const units = [];
  for (const file of files.filter((item) => item.endsWith('.safetensors'))) {
    const dir = path.posix.dirname(file);
    const config = files.find((item) => item === (dir === '.' ? 'adapter_config.json' : `${dir}/adapter_config.json`));
    const label = path.posix.basename(file).toLowerCase() === 'lora.safetensors' || path.posix.basename(file) === 'adapter_model.safetensors' ? (dir === '.' ? file : dir) : file.replace(/\.safetensors$/, '');
    units.push({ path: file, config: config || null, label, size: sizes.get(file) || 0, stage: stageOfName(label), variant: /bf16|fp16|comfyui|archive/i.test(file) ? 'variant' : null });
  }
  return units;
}

// First readable paragraph of a model card (front matter, headings, tables and HTML removed).
export function summarizeReadme(markdown) {
  const body = String(markdown || '').replace(/^---[\s\S]*?\n---\s*\n/, '');
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^(#|<|\||!\[|```|\[!|- \*\*|>)/.test(line));
  const paragraphs = [];
  let current = [];
  for (const line of body.split(/\r?\n/).map((item) => item.trim())) {
    if (!line) { if (current.length) { paragraphs.push(current.join(' ')); current = []; } continue; }
    if (/^(#|<|\||!\[|```|\[!)/.test(line)) { if (current.length) { paragraphs.push(current.join(' ')); current = []; } continue; }
    current.push(line);
  }
  if (current.length) paragraphs.push(current.join(' '));
  const text = (paragraphs.find((item) => item.length > 40) || lines[0] || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
  return text.length > 400 ? `${text.slice(0, 397)}...` : text;
}

const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}
export const clearHubCache = () => cache.clear();

async function hfJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`허깅페이스 응답 오류 (${response.status})`);
  return response.json();
}

export async function searchHub({ fetchImpl = fetch, query = '' } = {}) {
  const models = await cached('search', 10 * 60 * 1000, async () => {
    const found = new Map();
    const queries = [
      `search=${encodeURIComponent('yue2')}`, `search=${encodeURIComponent('yue2 lora')}`,
      `filter=${encodeURIComponent('base_model:adapter:m-a-p/YuE2-3B')}`, `filter=${encodeURIComponent('base_model:adapter:Comfy-Org/YuE2')}`,
    ];
    for (const query of queries) {
      const list = await hfJson(fetchImpl, `${HF}/api/models?${query}&full=true&limit=100&sort=likes&direction=-1`).catch(() => []);
      for (const model of list) if (model?.id && !found.has(model.id)) found.set(model.id, model);
    }
    if (!found.size) throw new Error('허깅페이스에서 LoRA 목록을 가져오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    return [...found.values()].filter(isYueAdapterRepo).map(classifyRepo);
  });
  const needle = String(query).trim().toLowerCase();
  if (!needle) return models;
  return models.filter((item) => [item.id, item.title, ...item.tags, ...item.categories, ...item.languages].join(' ').toLowerCase().includes(needle));
}

export async function hubDetail({ fetchImpl = fetch, repo }) {
  if (!REPO_PATTERN.test(repo)) throw new Error('저장소 이름이 올바르지 않습니다.');
  return cached(`detail:${repo}`, 10 * 60 * 1000, async () => {
    const model = await hfJson(fetchImpl, `${HF}/api/models/${repo}?blobs=true`);
    let summary = '';
    try {
      const response = await fetchImpl(`${HF}/${repo}/raw/main/README.md`, { signal: AbortSignal.timeout(20000) });
      if (response.ok) summary = summarizeReadme((await response.text()).slice(0, 60000));
    } catch { /* the card is optional */ }
    const files = (model.siblings || []).map((item) => item.rfilename);
    return {
      ...classifyRepo(model),
      summary,
      units: listUnits(model),
      samples: files.filter((file) => /\.(flac|mp3|wav|ogg)$/i.test(file)).slice(0, 8).map((file) => ({ name: file, url: `${HF}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}` })),
    };
  });
}

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'adapter';
const uniqueName = (base, existing) => { let name = base; for (let counter = 2; existing.includes(name); counter += 1) name = `${base}-${counter}`; return name; };

const KIND_LABEL = { style: '스타일', artist: '아티스트', composition: '작곡', sound: '사운드', slider: '슬라이더' };
const resolveUrl = (repo, revision, file) => `${HF}/${repo}/resolve/${revision || 'main'}/${file.split('/').map(encodeURIComponent).join('/')}`;

// One adapter = one folder holding one or two weight files (a composition half and a sound half may come as two files)
// plus songyue2-adapter.json. Files are downloaded into <name>.partial first, so a failed download leaves nothing behind.
// files: [{ repo, revision, path, bytes, config? }]
async function installAdapter({ fetchImpl, adapterDir, existingNames, name, files, meta, onProgress = () => {} }) {
  const finalName = uniqueName(slug(name), existingNames);
  const dir = path.join(adapterDir, finalName);
  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  const total = files.reduce((sum, file) => sum + (file.bytes || 0), 0);
  let done = 0;
  try {
    const used = [];
    for (const file of files) {
      const base = uniqueName(slug(path.posix.basename(file.path).replace(/\.safetensors$/i, '')), used);
      used.push(base);
      const response = await fetchImpl(resolveUrl(file.repo, file.revision, file.path), { redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`다운로드에 실패했습니다 (${response.status})`);
      const source = Readable.fromWeb(response.body);
      source.on('data', (chunk) => { done += chunk.length; onProgress(done, total); });
      await pipeline(source, createWriteStream(path.join(partial, `${base}.safetensors`)));
      if (file.config && !used.includes('adapter_config')) {
        const configResponse = await fetchImpl(resolveUrl(file.repo, file.revision, file.config), { redirect: 'follow' }).catch(() => null);
        if (configResponse?.ok) { await writeFile(path.join(partial, 'adapter_config.json'), Buffer.from(await configResponse.arrayBuffer())); used.push('adapter_config'); }
      }
    }
    await writeFile(path.join(partial, META_FILE), JSON.stringify({ ...meta, note: meta.note || '', verified: null, installedAt: new Date().toISOString() }, null, 1), 'utf8');
    await rm(dir, { recursive: true, force: true });
    await rename(partial, dir);
    return { name: finalName };
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function loadCatalog() {
  const raw = JSON.parse(await readFile(new URL('./adapter-catalog.json', import.meta.url), 'utf8'));
  return raw.entries;
}

// Catalog entry -> what the UI needs (with the pinned files summed up).
export function catalogSummary(entry) {
  return {
    id: entry.id, kind: entry.kind, kindLabel: KIND_LABEL[entry.kind] || entry.kind, name: entry.name, description: entry.description, tip: entry.tip || '', trigger: entry.trigger || '', stage: entry.stage || 'unknown',
    author: entry.author, page: entry.page, license: entry.license, scales: entry.scales, bytes: entry.files.reduce((sum, file) => sum + file.bytes, 0), files: entry.files.length,
  };
}

export async function installCatalogEntry({ fetchImpl = fetch, adapterDir, existingNames = [], entry, onProgress }) {
  return installAdapter({
    fetchImpl, adapterDir, existingNames, name: entry.id, onProgress,
    files: entry.files.map((file) => ({ repo: entry.repo, revision: entry.revision, path: file.path, bytes: file.bytes })),
    meta: {
      displayName: entry.name, description: entry.description, tip: entry.tip || '', kind: entry.kind, stage: entry.stage || 'unknown', trigger: entry.trigger || '', scales: entry.scales,
      categories: [KIND_LABEL[entry.kind] || entry.kind], tags: [], languages: [],
      license: entry.license, commercialUse: entry.license ? !/(^|-)nc(-|$)/i.test(entry.license) : null,
      source: { repo: entry.repo, path: entry.files.map((file) => file.path).join(' + '), url: entry.page, revision: entry.revision, catalogId: entry.id },
    },
  });
}

// Files ticked in a repo's detail view become ONE adapter when they are exactly a composition (AR) file plus a sound (NAR) file,
// otherwise each file is its own adapter.
export async function installHubUnits({ fetchImpl = fetch, adapterDir, existingNames = [], repo, unitPaths, onProgress = () => {} }) {
  const detail = await hubDetail({ fetchImpl, repo });
  const units = unitPaths.map((unitPath) => {
    const unit = detail.units.find((item) => item.path === unitPath);
    if (!unit) throw new Error('선택한 파일을 이 저장소에서 찾을 수 없습니다.');
    return unit;
  });
  if (!units.length) throw new Error('받을 파일을 선택해 주세요.');
  const stages = units.map((unit) => unit.stage);
  const together = units.length === 2 && stages.includes('ar') && stages.includes('nar');
  const groups = together ? [units] : units.map((unit) => [unit]);
  const totalBytes = units.reduce((sum, unit) => sum + unit.size, 0);
  let finished = 0;
  const names = [];
  for (const group of groups) {
    const groupBytes = group.reduce((sum, unit) => sum + unit.size, 0);
    const label = group.map((unit) => unit.label).join(' + ');
    const installed = await installAdapter({
      fetchImpl, adapterDir, existingNames: [...existingNames, ...names], name: `${repo.split('/')[1].replace(/^yue2[-_]?/i, '')}-${group[0].label.replace(/\.safetensors$/, '').replace(/[\\/]/g, '-')}`,
      onProgress: (done) => onProgress(finished + done, totalBytes),
      files: group.map((unit) => ({ repo, revision: 'main', path: unit.path, bytes: unit.size, config: unit.config })),
      meta: {
        displayName: detail.title === label ? detail.title : `${detail.title} · ${label}`, description: detail.summary, kind: '', trigger: '',
        categories: detail.categories, tags: detail.tags, languages: detail.languages, license: detail.license, commercialUse: detail.commercialUse,
        source: { repo, path: group.map((unit) => unit.path).join(' + '), url: detail.url }, samples: detail.samples.slice(0, 3),
        stage: together ? 'both' : group[0].stage !== 'unknown' ? group[0].stage : detail.stage,
      },
    });
    finished += groupBytes;
    names.push(installed.name);
  }
  return { names };
}

// Copies weight files (and an adapter_config.json next to them) from the user's disk into a new adapter.
export async function importLocalFiles({ adapterDir, existingNames = [], name, paths }) {
  const weights = paths.filter((file) => /\.safetensors$/i.test(file));
  if (!weights.length || weights.length > 2) throw new Error('.safetensors 파일을 1~2개 선택해 주세요. (작곡용과 사운드용이 따로 있으면 2개)');
  for (const file of weights) if (!(await stat(file).then((info) => info.isFile(), () => false))) throw new Error(`파일을 찾을 수 없습니다: ${file}`);
  const finalName = uniqueName(slug(name || path.basename(weights[0]).replace(/\.safetensors$/i, '')), existingNames);
  const dir = path.join(adapterDir, finalName);
  const partial = `${dir}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    const used = [];
    for (const file of weights) {
      const base = uniqueName(slug(path.basename(file).replace(/\.safetensors$/i, '')), used);
      used.push(base);
      await copyFile(file, path.join(partial, `${base}.safetensors`));
    }
    const config = path.join(path.dirname(weights[0]), 'adapter_config.json');
    if (await stat(config).then((info) => info.isFile(), () => false)) await copyFile(config, path.join(partial, 'adapter_config.json'));
    const meta = { displayName: String(name || finalName).slice(0, 120), description: '', kind: '', trigger: '', categories: [], tags: [], languages: [], license: '', commercialUse: null, stage: 'unknown', source: null, samples: [], note: '', verified: null, installedAt: new Date().toISOString() };
    await writeFile(path.join(partial, META_FILE), JSON.stringify(meta, null, 1), 'utf8');
    await rm(dir, { recursive: true, force: true });
    await rename(partial, dir);
    return { name: finalName };
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function readMeta(dir) {
  try { return JSON.parse(await readFile(path.join(dir, META_FILE), 'utf8')); } catch { return null; }
}

export async function updateMeta(dir, patch) {
  const meta = (await readMeta(dir)) || {};
  const next = { ...meta, ...patch };
  await writeFile(path.join(dir, META_FILE), JSON.stringify(next, null, 1), 'utf8');
  return next;
}

export const adapterFolderExists = (dir) => stat(dir).then((info) => info.isDirectory(), () => false);
