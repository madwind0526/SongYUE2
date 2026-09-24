// Community RVC voice models from HuggingFace: search (license shown for information), download into
// models/rvc-voices/<slug>/ and list/delete installed ones. Installed voices show up in the RVC
// voice list as "user:<slug>" and are passed to audiocpp_cli via voice_model_path (+ retrieval index).
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const RVC_VOICE_ROOT = path.join('models', 'rvc-voices');
const HF = 'https://huggingface.co';
const MAX_MODEL_BYTES = 400 * 1024 * 1024;

export const rvcSlug = (repo) => String(repo).toLowerCase().replace(/[^a-z0-9._-]+/g, '__').slice(0, 80);

export async function searchRvcVoices(fetchImpl, query) {
  const term = String(query || '').trim();
  const search = /rvc/i.test(term) ? term : `${term} rvc`.trim();
  const response = await fetchImpl(`${HF}/api/models?search=${encodeURIComponent(search)}&sort=downloads&direction=-1&limit=60`);
  if (!response.ok) throw new Error(`HuggingFace 검색에 실패했습니다 (${response.status}).`);
  const models = await response.json();
  return (Array.isArray(models) ? models : [])
    .map((model) => {
      const tags = model.tags || [];
      const license = (tags.find((tag) => tag.startsWith('license:')) || '').slice(8);
      return { repo: model.id, downloads: model.downloads || 0, likes: model.likes || 0, license, isRvc: tags.some((tag) => /^rvc$/i.test(tag)) || /rvc/i.test(model.id) };
    })
    .filter((model) => model.isRvc)
    .slice(0, 30)
    .map(({ isRvc, ...rest }) => rest);
}

// Picks the voice checkpoint and (optionally) a compatible retrieval index from a repo's file list.
export async function pickRvcFiles(fetchImpl, repo) {
  const response = await fetchImpl(`${HF}/api/models/${repo}/tree/main`);
  if (!response.ok) throw new Error(`저장소 파일 목록을 불러오지 못했습니다 (${response.status}).`);
  const files = (await response.json()).filter((item) => item.type === 'file').map((item) => ({ path: item.path, size: item.lfs?.size || item.size || 0 }));
  const pth = files.filter((file) => /\.pth$/i.test(file.path) && file.size > 1e6 && file.size <= MAX_MODEL_BYTES && !/^(d|g)_?\d|discriminator/i.test(path.basename(file.path)));
  // Prefer the final checkpoint: no epoch/step suffix, then the largest name-shortest file.
  pth.sort((a, b) => (/_e\d+|_s\d+|epoch|step/i.test(a.path) ? 1 : 0) - (/_e\d+|_s\d+|epoch|step/i.test(b.path) ? 1 : 0) || a.path.length - b.path.length);
  // "trained" indexes are unusable (no full IVF list sizes); the "added" index works.
  const index = files.filter((file) => /\.index$/i.test(file.path) && file.size <= MAX_MODEL_BYTES && !/trained/i.test(file.path)).sort((a, b) => b.size - a.size)[0] || null;
  if (pth.length) return { pth: pth[0], index };
  // Many repos only ship the voice as a .zip (pth + index inside); take the newest-looking archive
  // (highest epoch number in the name, else the largest).
  const zips = files.filter((file) => /\.zip$/i.test(file.path) && file.size > 1e6 && file.size <= MAX_MODEL_BYTES);
  const epoch = (file) => Math.max(0, ...(path.basename(file.path).match(/\d+/g) || []).map(Number));
  zips.sort((a, b) => epoch(b) - epoch(a) || b.size - a.size);
  if (!zips.length) throw new Error('이 저장소에서 RVC 목소리 파일(.pth 또는 .zip)을 찾지 못했습니다(너무 크거나 다른 형식).');
  return { pth: null, index: null, zip: zips[0] };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

// Extracts a downloaded archive with the OS tar (bsdtar reads .zip on Windows 10+) and moves the best
// .pth (largest non-D_/G_ training checkpoint) and non-"trained" .index next to it as voice.pth / voice.index.
async function unpackVoiceZip(zipFile, dir, spawnImpl) {
  const extractDir = path.join(dir, 'extract');
  await mkdir(extractDir, { recursive: true });
  const code = await new Promise((resolve) => {
    const child = spawnImpl('tar', ['-xf', zipFile, '-C', extractDir], { windowsHide: true });
    child.once('error', () => resolve(-1));
    child.once('close', (exit) => resolve(exit));
  });
  if (code !== 0) throw new Error('압축 파일을 풀지 못했습니다(tar 실행 실패).');
  const all = await walk(extractDir);
  const sizes = new Map(await Promise.all(all.map(async (file) => [file, (await stat(file)).size])));
  const pth = all.filter((file) => /\.pth$/i.test(file) && sizes.get(file) > 1e6 && !/^(d|g)_?\d|discriminator/i.test(path.basename(file))).sort((a, b) => sizes.get(a) - sizes.get(b))[0];
  const index = all.filter((file) => /\.index$/i.test(file) && !/trained/i.test(file)).sort((a, b) => sizes.get(b) - sizes.get(a))[0];
  if (!pth) throw new Error('압축 파일 안에서 RVC 목소리 파일(.pth)을 찾지 못했습니다.');
  await copyFile(pth, path.join(dir, 'voice.pth'));
  if (index) await copyFile(index, path.join(dir, 'voice.index'));
  await rm(extractDir, { recursive: true, force: true });
  await rm(zipFile, { force: true });
  return { hasIndex: !!index };
}

async function fetchToFile(fetchImpl, url, target, state) {
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`다운로드 서버 응답 오류 (${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  state.totalBytes += total;
  const partial = `${target}.part`;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => { state.receivedBytes += chunk.length; });
  await pipeline(source, createWriteStream(partial));
  await rename(partial, target);
}

export async function downloadRvcVoice({ fetchImpl, spawnImpl = spawn, root, repo, license, downloads }) {
  const slug = rvcSlug(repo);
  if (downloads.get(slug)?.state === 'running') return;
  const state = { state: 'running', receivedBytes: 0, totalBytes: 0, error: null, repo };
  downloads.set(slug, state);
  const dir = path.join(root, RVC_VOICE_ROOT, slug);
  try {
    const files = await pickRvcFiles(fetchImpl, repo);
    await mkdir(dir, { recursive: true });
    let hasIndex = !!files.index;
    if (files.zip) {
      const zipFile = path.join(dir, 'pack.zip');
      await fetchToFile(fetchImpl, `${HF}/${repo}/resolve/main/${files.zip.path}`, zipFile, state);
      hasIndex = (await unpackVoiceZip(zipFile, dir, spawnImpl)).hasIndex;
    } else {
      await fetchToFile(fetchImpl, `${HF}/${repo}/resolve/main/${files.pth.path}`, path.join(dir, 'voice.pth'), state);
      if (files.index) await fetchToFile(fetchImpl, `${HF}/${repo}/resolve/main/${files.index.path}`, path.join(dir, 'voice.index'), state);
    }
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ repo, license: license || '', name: repo.split('/').pop(), hasIndex, source: `${HF}/${repo}` }, null, 1));
    downloads.delete(slug);
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    state.state = 'failed';
    state.error = error?.message || '다운로드에 실패했습니다.';
  }
}

export async function listInstalledRvcVoices(root) {
  const base = path.join(root, RVC_VOICE_ROOT);
  const names = await readdir(base).catch(() => []);
  const voices = [];
  for (const slug of names) {
    const dir = path.join(base, slug);
    const pth = path.join(dir, 'voice.pth');
    // meta.json is written last, so its presence marks a finished download.
    const metaText = await readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => null);
    if (metaText === null || !(await stat(pth).then((info) => info.isFile(), () => false))) continue;
    const meta = JSON.parse(metaText || '{}');
    const hasIndex = await stat(path.join(dir, 'voice.index')).then((info) => info.isFile(), () => false);
    voices.push({ id: `user:${slug}`, slug, name: meta.name || slug, repo: meta.repo || '', license: meta.license || '', hasIndex });
  }
  return voices;
}

// Resolves "user:<slug>" to file paths (null when not installed or the slug is unsafe).
export async function resolveUserRvcVoice(root, voiceId) {
  const slug = String(voiceId || '').replace(/^user:/, '');
  if (!/^[a-z0-9._-]+$/.test(slug) || slug.includes('..')) return null;
  const dir = path.join(root, RVC_VOICE_ROOT, slug);
  const pth = path.join(dir, 'voice.pth');
  if (!(await stat(path.join(dir, 'meta.json')).then((info) => info.isFile(), () => false)) || !(await stat(pth).then((info) => info.isFile(), () => false))) return null;
  const index = path.join(dir, 'voice.index');
  return { pth, index: (await stat(index).then((info) => info.isFile(), () => false)) ? index : null };
}

export async function deleteRvcVoice(root, voiceId) {
  const voice = await resolveUserRvcVoice(root, voiceId);
  if (!voice) return false;
  await rm(path.dirname(voice.pth), { recursive: true, force: true });
  return true;
}
