// LoRA training (YuE2 sound / NAR adapters) with the ComfyUI-YuE2-Trainer nodes. This module holds the parts that do not need the
// running server: looking at the source folder, building the ComfyUI request, comparing the EMA and the raw result, and
// filing the chosen result (library archive + installed copy). server.mjs starts the job and follows its progress.
import { copyFile, link, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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

// library/Lora: one folder per LoRA with its size (for the "보관함" list)
export async function listLoraLibrary(libraryDir) {
  const entries = await readdir(libraryDir, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(libraryDir, entry.name);
    items.push({ name: entry.name, bytes: await dirSize(dir), hasRecord: await exists(path.join(dir, '학습 기록.json')) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}
