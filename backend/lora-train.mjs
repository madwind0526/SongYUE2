// LoRA training (YuE2 sound / NAR adapters) with the ComfyUI-YuE2-Trainer nodes. This module holds the parts that do not need the
// running server: looking at the source folder, building the ComfyUI request, comparing the EMA and the raw result, and
// filing the chosen result (library archive + installed copy). server.mjs starts the job and follows its progress.
import { copyFile, link, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const TRAIN_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac']);
export const TRAINER_NODE_DIR = 'ComfyUI-YuE2-Trainer';
export const TRAIN_CHECKPOINT = 'yue2_3b_bf16.safetensors';
// EMA and raw results closer than this (relative difference of all weights) are treated as the same sound
export const EMA_RAW_SAME_LIMIT = 0.01;

const exists = (file) => stat(file).then(() => true, () => false);
const slug = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
export const safeFolderName = (value) => String(value || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// The songs in a folder (not recursive, like the trainer): { files: [{ name, bytes }], count, bytes, captions }
export async function scanSourceDir(dir) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('곡이 들어 있는 폴더의 전체 경로를 입력해 주세요. (예: D:\\Music\\지수)');
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error('폴더를 찾을 수 없습니다. 경로를 확인해 주세요.');
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  let captions = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (TRAIN_AUDIO_EXTENSIONS.has(extension)) files.push({ name: entry.name, bytes: (await stat(path.join(dir, entry.name))).size });
    else if (extension === '.txt') captions += 1;
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { dir, files, count: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), captions };
}

// The ComfyUI prompt (API format) of one training run: the dataset node feeding the trainer node, and a text preview node so
// ComfyUI treats it as an output. The trainer writes <loraName>.safetensors (EMA) and <loraName>_raw.safetensors into models/loras.
export function buildTrainPrompt({ sourceDir, cacheDir, loraName, triggerWord, steps, rank, clipSeconds, learningRate, caption, hasCaptionFiles }) {
  const captionMode = hasCaptionFiles ? 'txt_file' : caption ? 'default' : 'none';
  return {
    '1': { class_type: 'YuE2TrainingDataset', inputs: { checkpoint: TRAIN_CHECKPOINT, audio_folder: sourceDir, clip_seconds: clipSeconds, caption_mode: captionMode, default_caption: caption || '', cache_folder: cacheDir, force_reencode: false } },
    '2': { class_type: 'YuE2LoRATrainer', inputs: {
      dataset: ['1', 0], checkpoint: TRAIN_CHECKPOINT, trigger_word: triggerWord, steps, learning_rate: learningRate, rank, alpha: rank, lora_dropout: 0.0,
      target_preset: 'nar_attn_mlp', lora_name: loraName, seed: 1234, optimizer: 'adamw_8bit', lr_scheduler: 'cosine', warmup_steps: Math.min(50, Math.max(5, Math.round(steps / 30))),
      grad_accum: 1, caption_dropout: 0.1, t_sampling: 'logit_normal', max_grad_norm: 1.0, log_every: 10, save_every: 0, ema_decay: 0.99, live_curve: false } },
    '3': { class_type: 'PreviewAny', inputs: { source: ['2', 1] } },
  };
}

// Validates the form of a training request; returns the cleaned values or throws an Error with a Korean message.
export function cleanTrainRequest(input = {}) {
  const name = safeFolderName(input.name);
  if (!name) throw new Error('LoRA 이름을 입력해 주세요.');
  const trigger = String(input.triggerWord || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!trigger) throw new Error('트리거 단어를 영문/숫자로 입력해 주세요. (예: jisoo_voice)');
  const number = (value, min, max, fallback) => { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback; };
  return {
    name, trigger,
    steps: Math.round(number(input.steps, 50, 20000, 1500)),
    rank: [8, 16, 32, 64].includes(Number(input.rank)) ? Number(input.rank) : 32,
    clipSeconds: number(input.clipSeconds, 3, 6, 6),
    learningRate: number(input.learningRate, 1e-6, 1e-3, 1e-4),
    caption: String(input.caption || '').trim().slice(0, 500),
  };
}

// Relative difference between the EMA and the raw weights -> what to tell the user
export function emaRawVerdict(relativeDifference) {
  const same = Number.isFinite(relativeDifference) && relativeDifference < EMA_RAW_SAME_LIMIT;
  return { same, recommend: 'ema', needsListening: !same };
}

const dirSize = async (dir) => {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) total += entry.isDirectory() ? await dirSize(path.join(dir, entry.name)) : (await stat(path.join(dir, entry.name))).size;
  return total;
};

// The installed copy is a hard link to the archived file (no second copy on disk); another drive gets a real copy.
export async function linkOrCopy(source, target) {
  await rm(target, { force: true });
  try { await link(source, target); return 'link'; } catch { await copyFile(source, target); return 'copy'; }
}

// Files the chosen result: library/Lora/<name>/<name>.safetensors + a training record, and models/yue-adapters/<folder>/ (hard link + metadata).
// The result that was not chosen and the helper folders are deleted; the user's source songs are never touched.
export async function finalizeTrainedLora({ libraryDir, adapterDir, existingAdapterNames = [], name, trigger, chosenFile, otherFile, record, cleanupDirs = [] }) {
  const folderName = safeFolderName(name);
  const archive = path.join(libraryDir, folderName);
  await mkdir(archive, { recursive: true });
  const archived = path.join(archive, `${folderName}.safetensors`);
  await rm(archived, { force: true });
  try { await rename(chosenFile, archived); } catch { await copyFile(chosenFile, archived); await rm(chosenFile, { force: true }); }
  if (otherFile) await rm(otherFile, { force: true });
  // the folder name is Latin only: the name when it has Latin letters, otherwise the trigger word (a Korean name has none)
  const baseName = slug(name) || slug(trigger) || 'lora';
  let installedName = baseName;
  for (let suffix = 2; existingAdapterNames.includes(installedName); suffix += 1) installedName = `${baseName}-${suffix}`;
  const installDir = path.join(adapterDir, installedName);
  await mkdir(installDir, { recursive: true });
  const mode = await linkOrCopy(archived, path.join(installDir, `${installedName}.safetensors`));
  await writeFile(path.join(installDir, 'songyue2-adapter.json'), JSON.stringify({
    displayName: name, description: `내가 학습한 LoRA (사운드 · 음색). 스타일에 ${trigger}를 넣으면 반응합니다.`, kind: 'artist', trigger, categories: ['아티스트'], tags: [], languages: [],
    license: 'cc-by-nc-4.0', commercialUse: false, stage: 'nar', source: null, samples: [], note: `학습 기록: library/Lora/${folderName}/학습 기록.json`, verified: null, installedAt: new Date().toISOString(),
  }, null, 1), 'utf8');
  await writeFile(path.join(archive, '학습 기록.json'), JSON.stringify({ ...record, name, installedAs: `models/yue-adapters/${installedName}`, installedBy: mode }, null, 2), 'utf8');
  for (const dir of cleanupDirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  return { installedName, archived, installDir, mode, bytes: (await stat(archived)).size };
}

// Folder browser for the "찾기" button of the training tab: the drives (empty path) or the sub-folders of a folder, with the number of songs in each.
export async function browseFolders(target) {
  if (!target) {
    const drives = [];
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`;
      if (await exists(root)) drives.push({ name: `${letter}:`, path: root });
    }
    return { path: '', parent: null, dirs: drives, songs: 0 };
  }
  if (!path.isAbsolute(target)) throw new Error('폴더의 전체 경로가 필요합니다.');
  const info = await stat(target).catch(() => null);
  if (!info?.isDirectory()) throw new Error('폴더를 찾을 수 없습니다.');
  const entries = await readdir(target, { withFileTypes: true }).catch(() => { throw new Error('이 폴더를 열 수 없습니다.'); });
  const dirs = [];
  let songs = 0;
  for (const entry of entries) {
    if (entry.isFile() && TRAIN_AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) songs += 1;
    else if (entry.isDirectory() && !entry.name.startsWith('$') && entry.name !== 'System Volume Information') dirs.push({ name: entry.name, path: path.join(target, entry.name) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? '' : parent, dirs, songs };
}

const readRecord = async (dir) => readFile(path.join(dir, '학습 기록.json'), 'utf8').then(JSON.parse, () => null);

// library/Lora: one folder per LoRA with its size, title and notes (for the "보관함" list)
export async function listLoraLibrary(libraryDir) {
  const entries = await readdir(libraryDir, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(libraryDir, entry.name);
    const record = await readRecord(dir);
    items.push({ name: entry.name, title: record?.name || entry.name, note: record?.note || '', trigger: record?.triggerWord || '', steps: record?.settings?.steps || null, rank: record?.settings?.rank || null, songs: record?.songCount || null, trainedAt: record?.trainedAt || '', installedAs: record?.installedAs || '', bytes: await dirSize(dir), hasRecord: !!record });
  }
  return items.sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }));
}

// Title / notes of a library entry: kept in its record and copied to the installed adapter so both lists show the same name
export async function editLoraLibraryItem({ libraryDir, adapterRoot, name, title, note }) {
  const dir = path.join(libraryDir, safeFolderName(name));
  const record = await readRecord(dir);
  if (!record) throw new Error('보관함에서 이 LoRA를 찾을 수 없습니다.');
  const next = { ...record };
  if (typeof title === 'string' && title.trim()) next.name = title.trim().slice(0, 120);
  if (typeof note === 'string') next.note = note.slice(0, 2000);
  await writeFile(path.join(dir, '학습 기록.json'), JSON.stringify(next, null, 2), 'utf8');
  const installed = record.installedAs ? path.join(adapterRoot, path.basename(record.installedAs)) : null;
  if (installed && await exists(path.join(installed, 'songyue2-adapter.json'))) {
    const meta = JSON.parse(await readFile(path.join(installed, 'songyue2-adapter.json'), 'utf8'));
    if (typeof title === 'string' && title.trim()) meta.displayName = next.name;
    if (typeof note === 'string') meta.note = note.slice(0, 2000);
    await writeFile(path.join(installed, 'songyue2-adapter.json'), JSON.stringify(meta, null, 1), 'utf8');
  }
  return { name, title: next.name, note: next.note || '' };
}

// Deletes a library entry and the installed copy that belongs to it (the installed file is a hard link of the archived one)
export async function deleteLoraLibraryItem({ libraryDir, adapterRoot, name }) {
  const dir = path.join(libraryDir, safeFolderName(name));
  if (!(await exists(dir))) throw new Error('보관함에서 이 LoRA를 찾을 수 없습니다.');
  const record = await readRecord(dir);
  let removedInstalled = false;
  if (record?.installedAs) {
    const installed = path.join(adapterRoot, path.basename(record.installedAs));
    if (await exists(installed)) { await rm(installed, { recursive: true, force: true }); removedInstalled = true; }
  }
  await rm(dir, { recursive: true, force: true });
  return { ok: true, removedInstalled };
}
