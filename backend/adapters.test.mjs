import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudioServer } from './server.mjs';
import { isYueAdapterRepo, classifyRepo, listUnits, summarizeReadme, installCatalogEntry, installHubUnits, importLocalFiles, loadCatalog, catalogSummary, clearHubCache } from './adapters.mjs';
import { extractAudioPart, normalizeAdapterSelection, toEngineAdapters, listAdapters, synthesize } from './yueserver.mjs';

const repoModel = (extra) => ({ id: 'someone/yue2-rock-lora', likes: 4, tags: ['lora', 'yue2', 'rock', 'en', 'base_model:m-a-p/YuE2-3B', 'license:cc-by-nc-4.0'], cardData: { language: ['en'] },
  siblings: [{ rfilename: 'README.md', size: 10 }, { rfilename: 'adapter-ar-1/lora.safetensors', size: 100 }, { rfilename: 'adapter-ar-1/adapter_config.json', size: 5 }, { rfilename: 'adapter-nar-2/lora.safetensors', size: 300 }, { rfilename: 'demo.flac', size: 9 }], ...extra });

test('hub repos: only YuE2 adapters are kept and they are classified from their own metadata', () => {
  assert.equal(isYueAdapterRepo(repoModel()), true);
  assert.equal(isYueAdapterRepo(repoModel({ tags: ['lora', 'base_model:Qwen/Qwen-Image-Edit'], cardData: {} })), false, 'adapters of other models are dropped');
  assert.equal(isYueAdapterRepo({ id: 'x/YuE2-3B-MLX', tags: ['mlx'], siblings: [{ rfilename: 'model.safetensors' }] }), false, 'converted copies of the whole model are not adapters');
  assert.equal(isYueAdapterRepo({ id: 'x/yue2-lora', tags: ['lora'], siblings: [{ rfilename: 'README.md' }] }), false, 'no weights');
  const info = classifyRepo(repoModel());
  assert.equal(info.title, 'rock');
  assert.deepEqual(info.categories, ['록/메탈']);
  assert.deepEqual(info.languages, ['영어']);
  assert.equal(info.stage, 'both');
  assert.equal(info.commercialUse, false);
  assert.equal(info.sampleCount, 1);
  const units = listUnits(repoModel());
  assert.deepEqual(units.map((unit) => [unit.label, unit.stage, unit.size, unit.config]), [['adapter-ar-1', 'ar', 100, 'adapter-ar-1/adapter_config.json'], ['adapter-nar-2', 'nar', 300, null]]);
  assert.match(summarizeReadme('---\ntags: [a]\n---\n# Title\n\n<audio src="x"></audio>\n\nA LoRA that pushes the model toward industrial rock with heavy guitars and drums.\n\n| a | b |\n'), /^A LoRA that pushes/);
});

test('the catalog is complete and its entries carry what the UI shows', async () => {
  const entries = await loadCatalog();
  assert.ok(entries.length >= 20);
  for (const entry of entries) {
    assert.ok(entry.name && entry.description && entry.files.length && entry.revision, entry.id);
    assert.ok(['ar', 'nar', 'both'].includes(entry.stage), entry.id);
    assert.ok(entry.files.every((file) => file.bytes > 0), entry.id);
  }
  const summary = catalogSummary(entries.find((entry) => entry.id === 'industrial-rock'));
  assert.equal(summary.kindLabel, '스타일');
  assert.equal(summary.files, 2);
  assert.deepEqual(summary.scales, { ar: 1, nar: 0.5 });
});

const bytesFetch = (files, calls = []) => async (url) => {
  calls.push(String(url));
  const known = Object.entries(files).find(([key]) => String(url).includes(key));
  if (!known) return new Response('nope', { status: 404 });
  return new Response(known[1], { status: 200, headers: { 'content-length': String(known[1].length) } });
};

test('installing a catalog entry makes one adapter folder with its files and metadata; a failed download leaves nothing', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue-adapters-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = { id: 'industrial-rock', kind: 'style', stage: 'both', name: '인더스트리얼 록', description: '설명', trigger: 'sv_x', scales: { ar: 1, nar: 0.5 }, license: 'cc-by-nc-4.0', page: 'https://huggingface.co/a/b', repo: 'a/b', revision: 'abc123',
    files: [{ path: 'adapter-ar/lora.safetensors', bytes: 3 }, { path: 'adapter-nar/lora.safetensors', bytes: 4 }] };
  const calls = [];
  const progress = [];
  const installed = await installCatalogEntry({ fetchImpl: bytesFetch({ 'adapter-ar/lora.safetensors': 'AAA', 'adapter-nar/lora.safetensors': 'BBBB' }, calls), adapterDir: dir, entry, onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(installed.name, 'industrial-rock');
  assert.ok(calls.every((url) => url.includes('/resolve/abc123/')), 'downloads are pinned to the catalog commit');
  assert.deepEqual((await readdir(path.join(dir, 'industrial-rock'))).sort(), ['lora.safetensors', 'lora-2.safetensors', 'songyue2-adapter.json'].sort());
  assert.deepEqual(progress.at(-1), [7, 7]);
  const list = await listAdapters(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0].displayName, '인더스트리얼 록');
  assert.equal(list[0].stage, 'both');
  assert.equal(list[0].trigger, 'sv_x');
  assert.equal(list[0].source.catalogId, 'industrial-rock');
  assert.equal(list[0].commercialUse, false);
  // the same entry again gets its own folder name
  const second = await installCatalogEntry({ fetchImpl: bytesFetch({ 'lora.safetensors': 'ZZ' }), adapterDir: dir, existingNames: ['industrial-rock'], entry });
  assert.equal(second.name, 'industrial-rock-2');
  // a failing download removes the partial folder
  await assert.rejects(installCatalogEntry({ fetchImpl: bytesFetch({}), adapterDir: dir, entry: { ...entry, id: 'broken' } }));
  assert.ok(!(await readdir(dir)).some((name) => name.startsWith('broken')));
});

test('files ticked in a Hugging Face repo: an AR + NAR pair becomes one adapter, anything else one adapter per file', async (t) => {
  clearHubCache();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue-adapters-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('/api/models/someone/yue2-rock-lora')) return Response.json(repoModel());
    if (target.endsWith('/README.md')) return new Response('A long enough model card paragraph that explains what this adapter does for the music.');
    if (target.includes('/resolve/main/')) return new Response(target.includes('nar') ? 'NNNN' : 'AA', { status: 200 });
    return new Response('nope', { status: 404 });
  };
  const pair = await installHubUnits({ fetchImpl, adapterDir: dir, repo: 'someone/yue2-rock-lora', unitPaths: ['adapter-ar-1/lora.safetensors', 'adapter-nar-2/lora.safetensors'] });
  assert.equal(pair.names.length, 1);
  const folder = await readdir(path.join(dir, pair.names[0]));
  assert.equal(folder.filter((name) => name.endsWith('.safetensors')).length, 2);
  assert.ok(folder.includes('adapter_config.json'));
  const single = await installHubUnits({ fetchImpl, adapterDir: dir, existingNames: pair.names, repo: 'someone/yue2-rock-lora', unitPaths: ['adapter-nar-2/lora.safetensors'] });
  assert.equal(single.names.length, 1);
  assert.equal((await listAdapters(dir)).find((item) => item.name === single.names[0]).stage, 'nar');
  await assert.rejects(installHubUnits({ fetchImpl, adapterDir: dir, repo: 'someone/yue2-rock-lora', unitPaths: ['nope.safetensors'] }), /찾을 수 없습니다/);
});

test('importing local files copies them into a new adapter and refuses wrong input', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue-adapters-'));
  const source = await mkdtemp(path.join(os.tmpdir(), 'songyue-src-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); await rm(source, { recursive: true, force: true }); });
  await writeFile(path.join(source, 'my-style.safetensors'), 'weights');
  await writeFile(path.join(source, 'adapter_config.json'), '{"ar":true,"rank":16}');
  const imported = await importLocalFiles({ adapterDir: dir, name: '내 스타일', paths: [path.join(source, 'my-style.safetensors')] });
  assert.equal(imported.name, 'adapter');
  const item = (await listAdapters(dir))[0];
  assert.equal(item.displayName, '내 스타일');
  assert.equal(item.rank, 16);
  assert.equal(item.source, null);
  await assert.rejects(importLocalFiles({ adapterDir: dir, name: 'x', paths: [path.join(source, 'adapter_config.json')] }), /safetensors/);
  await assert.rejects(importLocalFiles({ adapterDir: dir, name: 'x', paths: [path.join(source, 'missing.safetensors')] }), /찾을 수 없습니다/);
});

test('adapter selections are limited to installed adapters and mapped to the engine request', () => {
  const installed = [{ name: 'a' }, { name: 'b' }];
  assert.deepEqual(normalizeAdapterSelection([{ name: 'a', arScale: 0.5, narScale: 3 }, { name: 'a' }, { name: 'zzz' }, { name: 'b', scale: 0.7 }, null], installed),
    [{ name: 'a', arScale: 0.5, narScale: 2 }, { name: 'b', arScale: 0.7, narScale: 0.7 }]);
  assert.deepEqual(normalizeAdapterSelection('x', installed), []);
  assert.deepEqual(toEngineAdapters([{ name: 'a', arScale: 1, narScale: 0.5 }]), [{ name: 'a', ar_scale: 1, nar_scale: 0.5 }]);
});

const multipart = (audio) => Buffer.concat([Buffer.from('--BOUND\r\nContent-Type: application/json\r\n\r\n{"seed":1}\r\n--BOUND\r\nContent-Type: audio/wav\r\n\r\n'), audio, Buffer.from('\r\n--BOUND--\r\n')]);

test('the yue-server result is unpacked from its multipart body', () => {
  const audio = Buffer.from('RIFF\r\n\r\nwith-binary-\r\n-inside');
  assert.deepEqual(extractAudioPart(multipart(audio), 'multipart/mixed; boundary=BOUND'), audio);
  assert.deepEqual(extractAudioPart(audio, 'audio/wav'), audio);
  assert.throws(() => extractAudioPart(Buffer.from('--BOUND\r\nContent-Type: text/plain\r\n\r\nx\r\n--BOUND--'), 'multipart/mixed; boundary=BOUND'), /오디오/);
});

// A stand-in for yue-server: /health, /synth, /job
async function fakeYueServer(t, { failJob = false } = {}) {
  const requests = [];
  const audio = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(48000 * 4 * 2 + 40, 1)]);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/health') { res.setHeader('Content-Type', 'application/json'); return res.end('{"status":"ok"}'); }
      if (url.pathname === '/synth') { requests.push(JSON.parse(Buffer.concat(chunks).toString())); res.setHeader('Content-Type', 'application/json'); return res.end('{"id":"job1"}'); }
      if (url.pathname === '/job' && url.searchParams.has('result')) { res.setHeader('Content-Type', 'multipart/mixed; boundary=BOUND'); return res.end(multipart(audio)); }
      if (url.pathname === '/job') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ status: failJob ? 'failed' : 'done' })); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, requests, audio };
}

test('synthesize talks to a running yue-server and returns the audio', async (t) => {
  const fake = await fakeYueServer(t);
  const result = await synthesize({ paths: {}, base: `http://127.0.0.1:${fake.port}`, request: { style: 'x' }, spawnImpl: () => { throw new Error('must not start a second server'); } });
  assert.deepEqual(result.audio, fake.audio);
  assert.deepEqual(fake.requests, [{ style: 'x' }]);
  const failing = await fakeYueServer(t, { failJob: true });
  await assert.rejects(synthesize({ paths: {}, base: `http://127.0.0.1:${failing.port}`, request: { style: 'x' } }), /실패/);
});

test('API: adapters are listed, edited and deleted; songs with adapters are made by yue-server and store which adapters were used', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-lora-api-'));
  const fake = await fakeYueServer(t);
  const server = await createStudioServer({ root, yueServerPort: fake.port, spawnImpl: () => { throw new Error('the existing server is reused'); } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const call = async (route, method = 'GET', payload) => {
    const response = await fetch(`${base}${route}`, { method, headers: payload === undefined ? {} : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, data: await response.json() };
  };
  assert.deepEqual((await call('/api/adapters')).data.missing, ['yue-server', 'YuE2 모델', 'YuE2 VAE']);
  // engine files missing -> generating says what is missing
  const adapterDir = path.join(root, 'models', 'yue-adapters', 'rock');
  await mkdir(adapterDir, { recursive: true });
  await writeFile(path.join(adapterDir, 'a.safetensors'), 'w');
  await writeFile(path.join(adapterDir, 'songyue2-adapter.json'), JSON.stringify({ displayName: '록', kind: 'style', stage: 'both', scales: { ar: 1, nar: 0.5 }, trigger: 'sv_rock' }));
  const listed = (await call('/api/adapters')).data.adapters;
  assert.equal(listed[0].displayName, '록');
  assert.equal(listed[0].trigger, 'sv_rock');
  const song = (await call('/api/projects', 'POST', { title: 'LoRA 곡', lyrics: '[verse]\n가사', style: 'rock', modelId: 'yue2-q8', seed: 7, steps: 32, cot: 'full', adapters: [{ name: 'rock', arScale: 1, narScale: 0.5 }, { name: 'not-installed', arScale: 1, narScale: 1 }] })).data;
  assert.deepEqual(song.adapters, [{ name: 'rock', arScale: 1, narScale: 0.5 }], 'unknown adapters are dropped when the song is saved');
  const missing = await call('/api/generate', 'POST', { projectId: song.id });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /yue-server/);
  for (const file of [['engine', 'yue-server', 'yue-server.exe'], ['models', 'yue-server', 'YuE2-3B-Q8_0.gguf'], ['models', 'yue-server', 'YuE2-Vae-F32.gguf']]) {
    await mkdir(path.join(root, ...file.slice(0, -1)), { recursive: true });
    await writeFile(path.join(root, ...file), 'x');
  }
  assert.equal((await call('/api/settings', 'PUT', { saveFormat: 'wav' })).status, 200);
  const instrumental = (await call('/api/projects', 'POST', { title: '악기 LoRA', lyrics: '[verse]\n가사', style: 'rock', modelId: 'yue2-q8', instrumental: true, adapters: [{ name: 'rock' }] })).data;
  assert.equal((await call('/api/generate', 'POST', { projectId: instrumental.id })).status, 400);
  const made = await call('/api/generate', 'POST', { projectId: song.id });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  assert.equal(made.data.engine, 'yue-server');
  assert.deepEqual(made.data.adapters, [{ name: 'rock', arScale: 1, narScale: 0.5 }]);
  assert.equal(made.data.durationMs, 2000);
  assert.deepEqual(fake.requests[0].adapters, [{ name: 'rock', ar_scale: 1, nar_scale: 0.5 }]);
  assert.equal(fake.requests[0].cot, 'full');
  assert.equal(fake.requests[0].steps, 32);
  assert.equal(fake.requests[0].output_format, 'wav16');
  assert.equal((await readFile(path.join(root, 'library', 'music', 'LoRA 곡.wav'))).subarray(0, 4).toString(), 'RIFF');
  // rename / notes / delete
  const patched = await call('/api/adapters/rock', 'PATCH', { displayName: '내 록', note: '메모' });
  assert.equal(patched.data.displayName, '내 록');
  assert.equal(patched.data.note, '메모');
  assert.equal((await call('/api/adapters/nope', 'PATCH', { displayName: 'x' })).status, 404);
  assert.equal((await call('/api/adapters/import', 'POST', { name: 'x', paths: ['relative.safetensors'] })).status, 400);
  assert.equal((await call('/api/adapters/catalog')).data.entries.length >= 20, true);
  assert.equal((await call('/api/adapters/rock', 'DELETE')).status, 200);
  assert.deepEqual((await call('/api/adapters')).data.adapters, []);
});

test('API: files chosen in the browser are uploaded and become one adapter', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-lora-upload-'));
  const server = await createStudioServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const uploadId = '3f1b6c1e-2d0e-4c7a-9b1a-0d6f5a1c2e3b';
  const upload = (name, data, id = uploadId) => fetch(`${base}/api/adapters/upload?uploadId=${id}&filename=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
  assert.equal((await upload('my-style.safetensors', Buffer.from('weights-bytes'))).status, 201);
  assert.equal((await upload('adapter_config.json', Buffer.from('{"ar":true,"rank":8}'))).status, 201);
  assert.equal((await upload('notes.txt', Buffer.from('x'))).status, 400, 'only weights and the config are accepted');
  assert.equal((await upload('../evil.safetensors', Buffer.from('x'), 'not-a-uuid')).status, 400);
  const imported = await fetch(`${base}/api/adapters/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '내 스타일', uploadId }) });
  assert.equal(imported.status, 201, JSON.stringify(await imported.clone().json()));
  const list = (await (await fetch(`${base}/api/adapters`)).json()).adapters;
  assert.equal(list.length, 1);
  assert.equal(list[0].displayName, '내 스타일');
  assert.equal(list[0].rank, 8);
  assert.equal(await readFile(path.join(root, 'models', 'yue-adapters', list[0].name, 'my-style.safetensors'), 'utf8'), 'weights-bytes');
  // the temporary upload folder is gone, and importing it again fails cleanly
  const again = await fetch(`${base}/api/adapters/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', uploadId }) });
  assert.equal(again.status, 400);
});
