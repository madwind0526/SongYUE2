import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { scanSourceDir, cleanTrainRequest, buildTrainPrompt, emaRawVerdict, finalizeTrainedLora, listLoraLibrary, safeFolderName, browseFolders, editLoraLibraryItem, deleteLoraLibraryItem } from './lora-train.mjs';

const temp = async (t) => { const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue-train-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test('the source folder: songs are counted (not recursive), other files are ignored, .txt files are captions', async (t) => {
  const dir = await temp(t);
  await writeFile(path.join(dir, 'b.mp3'), 'bb'); await writeFile(path.join(dir, 'a.wav'), 'a'); await writeFile(path.join(dir, 'c.flac'), 'c');
  await writeFile(path.join(dir, 'a.txt'), 'caption'); await writeFile(path.join(dir, 'cover.jpg'), 'x');
  await mkdir(path.join(dir, 'sub')); await writeFile(path.join(dir, 'sub', 'd.mp3'), 'd');
  const found = await scanSourceDir(dir);
  assert.deepEqual(found.files.map((file) => file.name), ['a.wav', 'b.mp3', 'c.flac']);
  assert.equal(found.captions, 1);
  assert.equal(found.bytes, 4);
  await assert.rejects(scanSourceDir('relative/path'), /전체 경로/);
  await assert.rejects(scanSourceDir(path.join(dir, 'nope')), /찾을 수 없습니다/);
});

test('the training request is cleaned and limited', () => {
  const ok = cleanTrainRequest({ name: ' 지수: 음색 ', triggerWord: 'Jisoo Voice!', steps: 999999, rank: 5, clipSeconds: 20, learningRate: 'x' });
  assert.equal(ok.name, '지수 음색');
  assert.equal(ok.trigger, 'jisoo_voice');
  assert.equal(ok.steps, 20000);
  assert.equal(ok.rank, 32, 'an unknown rank falls back to 32');
  assert.equal(ok.clipSeconds, 6, 'the clip length is at most 6 s (12 GB cards)');
  assert.equal(ok.learningRate, 1e-4);
  assert.throws(() => cleanTrainRequest({ triggerWord: 'a' }), /이름/);
  assert.throws(() => cleanTrainRequest({ name: 'a', triggerWord: '한글' }), /트리거/);
});

test('the ComfyUI prompt: caption mode follows the files, the trainer is fed by the dataset node', () => {
  const base = { sourceDir: 'D:\\songs', cacheDir: 'C:\\c', loraName: 'songyue-1', triggerWord: 'jisoo_voice', steps: 1500, rank: 32, clipSeconds: 6, learningRate: 1e-4 };
  assert.equal(buildTrainPrompt({ ...base, caption: '', hasCaptionFiles: false })['1'].inputs.caption_mode, 'none');
  assert.equal(buildTrainPrompt({ ...base, caption: 'pop', hasCaptionFiles: false })['1'].inputs.caption_mode, 'default');
  const withFiles = buildTrainPrompt({ ...base, caption: 'pop', hasCaptionFiles: true });
  assert.equal(withFiles['1'].inputs.caption_mode, 'txt_file');
  assert.deepEqual(withFiles['2'].inputs.dataset, ['1', 0]);
  assert.equal(withFiles['2'].inputs.alpha, 32);
  assert.equal(withFiles['2'].inputs.lora_name, 'songyue-1');
});

test('EMA vs raw: nearly the same weights are called the same, a bigger difference asks for listening', () => {
  assert.deepEqual(emaRawVerdict(0.0000445), { same: true, recommend: 'ema', needsListening: false });
  assert.equal(emaRawVerdict(0.05).needsListening, true);
  assert.equal(emaRawVerdict(NaN).needsListening, true, 'an unmeasured difference is never called the same');
  assert.equal(emaRawVerdict(null).needsListening, true);
});

test('the chosen result is filed once (archive + hard-linked installed copy), the other result and the helper folders are deleted', async (t) => {
  const dir = await temp(t);
  const loras = path.join(dir, 'loras'); const libraryDir = path.join(dir, 'library', 'Lora'); const adapterDir = path.join(dir, 'adapters'); const work = path.join(dir, 'work');
  await mkdir(loras, { recursive: true }); await mkdir(adapterDir, { recursive: true }); await mkdir(work, { recursive: true });
  await writeFile(path.join(loras, 'a.safetensors'), 'EMA-WEIGHTS'); await writeFile(path.join(loras, 'a_raw.safetensors'), 'RAW');
  await mkdir(path.join(adapterDir, 'jisoo-voice'));
  const result = await finalizeTrainedLora({ libraryDir, adapterDir, existingAdapterNames: ['jisoo-voice'], name: '지수 음색', trigger: 'jisoo_voice', chosenFile: path.join(loras, 'a.safetensors'), otherFile: path.join(loras, 'a_raw.safetensors'), record: { steps: 100 }, cleanupDirs: [work] });
  assert.equal(result.installedName, 'jisoo-voice-2', 'a Korean name uses the trigger word, and a taken name gets a number');
  assert.equal(await readFile(path.join(libraryDir, '지수 음색', '지수 음색.safetensors'), 'utf8'), 'EMA-WEIGHTS');
  assert.equal(await readFile(path.join(adapterDir, 'jisoo-voice-2', 'jisoo-voice-2.safetensors'), 'utf8'), 'EMA-WEIGHTS');
  if (result.mode === 'link') assert.equal((await stat(result.archived)).nlink, 2, 'one file on disk, two names');
  assert.deepEqual(await readdir(loras), [], 'the trainer output folder is empty again (the raw result is deleted)');
  await assert.rejects(stat(work), 'the helper folder is gone');
  const meta = JSON.parse(await readFile(path.join(adapterDir, 'jisoo-voice-2', 'songyue2-adapter.json'), 'utf8'));
  assert.equal(meta.displayName, '지수 음색'); assert.equal(meta.trigger, 'jisoo_voice'); assert.equal(meta.stage, 'nar'); assert.equal(meta.commercialUse, false);
  const record = JSON.parse(await readFile(path.join(libraryDir, '지수 음색', '학습 기록.json'), 'utf8'));
  assert.equal(record.installedAs, 'models/yue-adapters/jisoo-voice-2'); assert.equal(record.steps, 100);
  const library = await listLoraLibrary(libraryDir);
  assert.equal(library.length, 1); assert.equal(library[0].name, '지수 음색'); assert.equal(library[0].hasRecord, true); assert.ok(library[0].bytes > 0);
  assert.equal(safeFolderName('a/b:c'), 'a b c');
});

test('the trainer: the scan lists every song with its length', async (t) => {
  const { createLoraTrainer } = await import('./lora-trainer.mjs');
  const dir = await temp(t);
  await writeFile(path.join(dir, 'a.mp3'), 'aa'); await writeFile(path.join(dir, 'b.wav'), 'b');
  const trainer = createLoraTrainer({ root: dir, outputDirectory: dir, fetchImpl: async () => new Response('{}'), spawnImpl: () => { throw new Error('not used'); }, comfyEnginePath: () => dir, ensureComfyUi: async () => '', setBusy: () => {}, isBusy: () => false, adaptersDir: () => dir, listInstalledNames: async () => [], synthesizeSong: async () => Buffer.alloc(0), measureSeconds: async (file) => (file.endsWith('a.mp3') ? 200 : 100) });
  const found = await trainer.scan(dir);
  assert.deepEqual(found.files.map((file) => [file.name, file.seconds]), [['a.mp3', 200], ['b.wav', 100]]);
  assert.equal(found.seconds, 300); assert.equal(found.minutes, 5);
});

test('the folder browser lists sub-folders with the song count of the folder, and refuses relative paths', async (t) => {
  const dir = await temp(t);
  await mkdir(path.join(dir, 'b')); await mkdir(path.join(dir, 'A')); await writeFile(path.join(dir, 'x.mp3'), 'x'); await writeFile(path.join(dir, 'note.txt'), 'n');
  const listing = await browseFolders(dir);
  assert.deepEqual(listing.dirs.map((item) => item.name), ['A', 'b']);
  assert.equal(listing.songs, 1);
  assert.equal(listing.parent, path.dirname(dir));
  assert.ok((await browseFolders('')).dirs.length >= 1, 'the drives');
  await assert.rejects(browseFolders('relative'), /전체 경로/);
  await assert.rejects(browseFolders(path.join(dir, 'nope')), /찾을 수 없습니다/);
});

test('library entries: the title and notes are edited in the record and the installed copy, deleting removes both', async (t) => {
  const dir = await temp(t);
  const libraryDir = path.join(dir, 'library', 'Lora'); const adapterDir = path.join(dir, 'adapters');
  await mkdir(adapterDir, { recursive: true }); await mkdir(path.join(dir, 'loras'), { recursive: true });
  await writeFile(path.join(dir, 'loras', 'a.safetensors'), 'W');
  const made = await finalizeTrainedLora({ libraryDir, adapterDir, name: '지수 음색', trigger: 'jisoo_voice', chosenFile: path.join(dir, 'loras', 'a.safetensors'), record: { triggerWord: 'jisoo_voice', settings: { steps: 1500, rank: 16 } } });
  let list = await listLoraLibrary(libraryDir);
  assert.equal(list[0].title, '지수 음색'); assert.equal(list[0].steps, 1500); assert.equal(list[0].rank, 16); assert.equal(list[0].installedAs, `models/yue-adapters/${made.installedName}`);
  await editLoraLibraryItem({ libraryDir, adapterRoot: adapterDir, name: '지수 음색', title: '지수 (굵은 톤)', note: '강도 1.0에서 굵은 질감' });
  list = await listLoraLibrary(libraryDir);
  assert.equal(list[0].title, '지수 (굵은 톤)'); assert.equal(list[0].note, '강도 1.0에서 굵은 질감');
  const meta = JSON.parse(await readFile(path.join(adapterDir, made.installedName, 'songyue2-adapter.json'), 'utf8'));
  assert.equal(meta.displayName, '지수 (굵은 톤)'); assert.equal(meta.note, '강도 1.0에서 굵은 질감');
  await assert.rejects(editLoraLibraryItem({ libraryDir, adapterRoot: adapterDir, name: 'nope', title: 'x' }), /찾을 수 없습니다/);
  const removed = await deleteLoraLibraryItem({ libraryDir, adapterRoot: adapterDir, name: '지수 음색' });
  assert.equal(removed.removedInstalled, true);
  assert.deepEqual(await listLoraLibrary(libraryDir), []);
  await assert.rejects(stat(path.join(adapterDir, made.installedName)));
});
