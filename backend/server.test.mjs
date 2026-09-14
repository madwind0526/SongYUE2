import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStudioServer } from './server.mjs';

const ENV_KEYS = ['LLM_PROVIDER', 'OLLAMA_ENDPOINT', 'OLLAMA_MODEL', 'CLAUDE_API_KEY', 'CLAUDE_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'ENGINE_PATH'];
function resetEnv() { for (const key of ENV_KEYS) delete process.env[key]; }
const jsonNames = async (dir) => (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));

test('local API persistence, request boundaries, provider adapters, and setting/music split', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-'));
  await writeFile(path.join(root, '.env'), [
    'LLM_PROVIDER=none',
    'OLLAMA_ENDPOINT=http://127.0.0.1:11434',
    'OLLAMA_MODEL=llama3.1',
    'CLAUDE_API_KEY=unit-test-secret',
    'CLAUDE_MODEL=claude-test',
    'OPENAI_API_KEY=unit-test-secret',
    'OPENAI_MODEL=gpt-test',
    'GEMINI_API_KEY=unit-test-secret',
    'GEMINI_MODEL=gemini-test',
  ].join('\n'), 'utf8');
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, ...options, payload: options?.body ? JSON.parse(options.body) : null });
    return Response.json(url.includes('anthropic') ? { content: [{ type: 'text', text: '클로드 가사' }] } : url.includes('openai') ? { output: [{ content: [{ type: 'output_text', text: '오픈AI 가사' }] }] } : url.includes('googleapis') ? { candidates: [{ content: { parts: [{ text: '제미나이 가사' }] } }] } : { message: { content: '로컬 가사' } });
  };
  let server = await createStudioServer({ root, fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload, headers = {}) => {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  assert.equal((await call('/api/health')).data.engineReady, false);
  assert.equal((await call('/api/settings', 'PUT', { provider: 'chatgpt' }, { Origin: 'https://evil.example' })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http.get(`${base}/api/health`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  const settings = await call('/api/settings', 'PUT', { provider: 'chatgpt' });
  assert.equal(settings.data.hasApiKey, true);
  assert.equal(settings.data.apiKey, '***');
  assert.equal(settings.data.llmModel, 'gpt-test');
  assert.equal(JSON.stringify(settings.data).includes('unit-test-secret'), false);
  assert.equal((await call('/api/settings', 'PUT', { provider: 'none' })).data.hasApiKey, false);
  assert.equal((await call('/api/settings', 'PUT', { provider: 'chatgpt' })).data.hasApiKey, true);
  assert.equal((await readFile(path.join(root, 'data/settings.json'), 'utf8')).includes('unit-test-secret'), false);
  assert.equal(requests.length, 0);

  // library/examples seeded on first boot
  const examples = (await call('/api/examples')).data;
  assert.equal(examples.length, 3);
  assert.equal((await jsonNames(path.join(root, 'library', 'examples'))).length, 3);
  const createdExample = await call('/api/examples', 'POST', { title: '내 예시', style: '스타일', lyrics: '가사' });
  assert.equal(createdExample.status, 201);
  assert.equal((await call('/api/examples')).data.length, 4);
  assert.equal((await call(`/api/examples/${createdExample.data.id}`, 'DELETE', {})).status, 200);
  assert.equal((await call('/api/examples')).data.length, 3);
  assert.equal((await call('/api/examples', 'POST', { title: '불량', lyrics: '가사' })).status, 400);

  // POST /api/projects writes into library/setting, titled by song title
  const draft = await call('/api/projects', 'POST', { title: '검증용 노래', lyrics: '가사', modelId: 'q4', seed: 42 });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.status, 'draft');
  assert.deepEqual(await jsonNames(path.join(root, 'library', 'setting')), ['검증용 노래.json']);
  assert.equal((await call('/api/projects')).data[0].title, '검증용 노래');
  assert.equal((await call(`/api/projects/${draft.data.id}`, 'PATCH', { favorite: true })).data.favorite, true);
  assert.match((await call(`/api/projects/${draft.data.id}/export`)).headers.get('content-disposition'), /attachment/);

  // renaming a draft renames its file on disk
  const renamed = await call(`/api/projects/${draft.data.id}`, 'PATCH', { title: '새 이름' });
  assert.equal(renamed.data.title, '새 이름');
  assert.deepEqual(await jsonNames(path.join(root, 'library', 'setting')), ['새 이름.json']);

  const doomed = await call('/api/projects', 'POST', { title: '삭제될 곡', lyrics: '가사' });
  assert.equal((await call(`/api/projects/${doomed.data.id}`, 'DELETE', {})).status, 200);
  assert.equal((await call(`/api/projects/${doomed.data.id}`)).status, 404);
  assert.equal((await call(`/api/projects/${doomed.data.id}`, 'DELETE', {})).status, 404);
  assert.equal((await call('/api/projects/not-a-uuid')).status, 404);
  assert.equal((await call('/api/projects/not-a-uuid', 'DELETE', {})).status, 404);
  assert.equal((await call('/api/generate', 'POST', {})).status, 400);
  assert.equal((await call('/api/projects', 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await call('/api/projects', 'POST', { lyrics: 'x'.repeat(270000) })).status, 413);
  for (const provider of ['chatgpt', 'claude', 'gemini', 'ollama']) {
    await call('/api/settings', 'PUT', { provider });
    assert.equal((await call('/api/llm/assist', 'POST', { task: 'lyrics', prompt: '봄날' })).status, 200);
  }
  assert.equal(requests.length, 4);
  assert.equal(requests[0].payload.store, false);
  assert.equal(requests[1].headers['anthropic-version'], '2023-06-01');
  assert.equal(requests[2].headers['x-goog-api-key'], 'unit-test-secret');
  assert.equal(requests[3].payload.stream, false);
  await new Promise(resolve => server.close(resolve));
  server = await createStudioServer({ root, fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const restarted = await call('/api/settings');
  assert.equal(restarted.data.provider, 'ollama');
  assert.equal(restarted.data.hasApiKey, false);
  assert.equal((await call('/api/projects')).data[0].favorite, true);
  assert.equal((await call('/api/examples')).data.length, 3);
});

test('EQ presets and whole post-process settings persist under Setting/, not library/setting', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-pp-settings-'));
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  assert.deepEqual((await callJson('/api/eq-presets')).data, []);
  const eq = [46, 33, 21, 8, 0, -4, -8, -8, -4, 0];
  const saved = await callJson('/api/eq-presets', 'POST', { name: '내 프리셋', eq });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, { name: '내 프리셋', eq });
  assert.equal(await readFile(path.join(root, 'Setting', 'EQ-preset', '내 프리셋.json'), 'utf8').then(text => JSON.parse(text).eq.length), 10);
  assert.equal((await jsonNames(path.join(root, 'library', 'setting'))).length, 0, 'a saved EQ preset must not land in library/setting, or it would be scanned as a bogus song draft');
  assert.deepEqual((await callJson('/api/eq-presets')).data, [{ name: '내 프리셋', eq }]);
  assert.equal((await callJson('/api/eq-presets', 'POST', { name: '', eq })).status, 400);
  assert.equal((await callJson('/api/eq-presets', 'POST', { name: '이름', eq: [1, 2, 3] })).status, 400);
  assert.equal((await callJson(`/api/eq-presets?name=${encodeURIComponent('내 프리셋')}`, 'DELETE')).status, 200);
  assert.deepEqual((await callJson('/api/eq-presets')).data, []);
  assert.equal((await callJson(`/api/eq-presets?name=${encodeURIComponent('없음')}`, 'DELETE')).status, 404);

  const params = { eq, masterVolume: 120, eqEnabled: true, fxEnabled: true, reverbEchoEnabled: true, clarity: 0, spaciousness: 0, surround: 0, dynamicBoost: 0, bassBoost: 0, reverbAmount: 0, reverbLength: 50, echoAmount: 0, echoDelayMs: 300 };
  assert.deepEqual((await callJson('/api/postprocess-settings')).data, []);
  const savedSettings = await callJson('/api/postprocess-settings', 'POST', { name: '내 세팅', params });
  assert.equal(savedSettings.status, 200);
  assert.deepEqual(savedSettings.data, { name: '내 세팅', params });
  assert.equal(await readFile(path.join(root, 'Setting', 'PostProcess', '내 세팅.json'), 'utf8').then(text => JSON.parse(text).name), '내 세팅');
  assert.equal((await jsonNames(path.join(root, 'library', 'setting'))).length, 0, 'a saved postprocess settings file must not land in library/setting either');
  assert.deepEqual((await callJson('/api/postprocess-settings')).data, [{ name: '내 세팅', params }]);
  assert.equal((await callJson('/api/postprocess-settings', 'POST', { name: '', params })).status, 400);
  assert.equal((await callJson('/api/postprocess-settings', 'POST', { name: '이름' })).status, 400);
  assert.equal((await callJson(`/api/postprocess-settings?name=${encodeURIComponent('내 세팅')}`, 'DELETE')).status, 200);
  assert.deepEqual((await callJson('/api/postprocess-settings')).data, []);
  assert.equal((await callJson(`/api/postprocess-settings?name=${encodeURIComponent('없음')}`, 'DELETE')).status, 404);
});

test('.env values outside expectations are rejected at use time, not at startup', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-env-'));
  await writeFile(path.join(root, '.env'), 'LLM_PROVIDER=ollama\nOLLAMA_ENDPOINT=http://example.com\nOLLAMA_MODEL=llama3.1\n', 'utf8');
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const response = await fetch(`${base}/api/llm/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /localhost/);
});

test('missing .env file falls back to defaults instead of failing to start', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-noenv-'));
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const response = await fetch(`${base}/api/settings`);
  const data = await response.json();
  assert.equal(data.provider, 'none');
  assert.equal(data.hasApiKey, false);
  assert.equal(data.apiKey, null);
});

function makeFakeSpawn() {
  const calls = [];
  let next = { exitCode: 0, delayMs: 0, metrics: 'metrics.audio_duration_ms=1234\nmetrics.rtf=0.42\n', writeOutput: true };
  let ffmpeg = { exitCode: 0, delayMs: 0, writeOutput: true };
  let sep = { exitCode: 0, delayMs: 0, writeOutput: true };
  const spawnImpl = (engine, args) => {
    calls.push({ engine, args });
    const emitter = new EventEmitter();
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    emitter.kill = () => emitter.emit('close', null, 'SIGTERM');
    if (engine === 'ffmpeg') {
      const behavior = ffmpeg;
      const outPath = args[args.length - 1];
      (async () => {
        await new Promise(resolve => setTimeout(resolve, behavior.delayMs || 0));
        if (behavior.writeOutput && behavior.exitCode === 0) await writeFile(outPath, Buffer.from('fake-transcoded-bytes'));
        emitter.emit('close', behavior.exitCode, null);
      })();
      return emitter;
    }
    if (args.includes('sep')) {
      const behavior = sep;
      const outDir = args[args.indexOf('--out-dir') + 1];
      const names = args.includes('mel_band_roformer') ? ['vocals', 'instrumental'] : ['vocals', 'drums', 'bass', 'other'];
      (async () => {
        await new Promise(resolve => setTimeout(resolve, behavior.delayMs || 0));
        if (behavior.writeOutput && behavior.exitCode === 0) {
          for (const name of names) await writeFile(path.join(outDir, `${name}.wav`), Buffer.from(`fake-${name}-bytes`));
        }
        emitter.emit('close', behavior.exitCode, null);
      })();
      return emitter;
    }
    const behavior = next;
    const outPath = args[args.indexOf('--out') + 1];
    (async () => {
      await new Promise(resolve => setTimeout(resolve, behavior.delayMs || 0));
      if (behavior.writeOutput && behavior.exitCode === 0) await writeFile(outPath, Buffer.from('RIFF-fake-wav-bytes'));
      emitter.stdout.emit('data', Buffer.from(behavior.metrics || ''));
      emitter.emit('close', behavior.exitCode, null);
    })();
    return emitter;
  };
  return { spawnImpl, calls, set: (behavior) => { next = { ...next, ...behavior }; }, setFfmpeg: (behavior) => { ffmpeg = { ...ffmpeg, ...behavior }; }, setSep: (behavior) => { sep = { ...sep, ...behavior }; } };
}

function makeFakePythonSpawn(scriptPath) {
  const calls = [];
  let behavior = { exitCode: 0, writeOutput: true, truncated: false };
  const spawnImpl = (engine, args) => {
    calls.push({ engine, args });
    const emitter = new EventEmitter();
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    emitter.kill = () => emitter.emit('close', null, 'SIGTERM');
    if (path.basename(args[0] || '') === 'abc_tools.py' && args[1] === 'mute-voice') {
      const [, , sourceFile, outFile] = args;
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        const content = await readFile(sourceFile, 'utf8').catch(() => 'X:1\nT:\nK:C\nV: Vocal\nz32|\nV: Ins\nz32|\n');
        await writeFile(outFile, content.replace(/V: Vocal\n[^V]*/, 'V: Vocal\nz32|\n'));
        emitter.emit('close', 0, null);
      })();
      return emitter;
    }
    if (args[0] !== scriptPath) { // ffmpeg calls used for save-format conversion after finalize
      const outPath = args[args.length - 1];
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        await writeFile(outPath, Buffer.from('flac-converted-bytes'));
        emitter.emit('close', 0, null);
      })();
      return emitter;
    }
    const action = args[1];
    const outDir = args[args.indexOf('--output') + 1];
    (async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (behavior.writeOutput) {
        await mkdir(outDir, { recursive: true });
        if (action === 'plan') {
          await writeFile(path.join(outDir, 'score.abc'), 'X:1\nT:\nM:4/4\nL:1/32\nK:C\nV: Vocal\nz32|\nV: Ins\nz32|\n');
        } else {
          await writeFile(path.join(outDir, 'audio.flac'), Buffer.from('fLaC-fake-bytes'));
          await writeFile(path.join(outDir, 'result.json'), JSON.stringify({ status: 'complete', truncated: { abc: behavior.truncated, semantic: false }, audio_seconds: 1.234, sample_rate: 48000 }));
        }
      }
      emitter.emit('close', behavior.exitCode, null);
    })();
    return emitter;
  };
  return { spawnImpl, calls, set: (next) => { behavior = { ...behavior, ...next }; } };
}

async function setUpEngine(root) {
  const modelRoot = path.join(root, 'models', 'audio-cpp', 'Yue2-3B-GGUF');
  await mkdir(path.join(modelRoot, 'sidecars'), { recursive: true });
  for (const name of ['yue2-3b-q4_0.gguf', 'yue2-vae-f16.gguf']) await writeFile(path.join(modelRoot, name), 'stub');
  for (const name of ['yue2-model-config.json', 'yue2-generation-config.json', 'yue2-qwen.tiktoken', 'yue2-vae-config.json']) await writeFile(path.join(modelRoot, 'sidecars', name), 'stub');
  const htdemucsModel = path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf', 'HTDemucs-GGUF', 'htdemucs-q8_0.gguf');
  await mkdir(path.dirname(htdemucsModel), { recursive: true });
  await writeFile(htdemucsModel, 'stub');
  const melBandRoformerModel = path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf', 'Mel-Band-RoFormer-GGUF', 'mel-band-roformer-f16.gguf');
  await mkdir(path.dirname(melBandRoformerModel), { recursive: true });
  await writeFile(melBandRoformerModel, 'stub');
  const enginePath = path.join(root, 'fake-audiocpp_cli.exe');
  await writeFile(enginePath, 'stub');
  return { modelRoot, enginePath, htdemucsModel, melBandRoformerModel };
}

test('audio.cpp generation copies the song into library/music, leaving the source project untouched', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-gen-'));
  const { modelRoot, enginePath } = await setUpEngine(root);
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const settingDir = path.join(root, 'library', 'setting');
  const musicDir = path.join(root, 'library', 'music');

  await callJson('/api/settings', 'PUT', { enginePath });
  assert.equal((await callJson('/api/health')).data.engineReady, true);

  const original = (await callJson('/api/projects', 'POST', { title: '원본', lyrics: '가사', style: '스타일', modelId: 'yue2-original' })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: original.id })).status, 400);

  const convrot = (await callJson('/api/projects', 'POST', { title: 'ConvRot', lyrics: '가사', style: '스타일', modelId: 'yue2-int8-convrot' })).data;
  const convrotResult = await callJson('/api/generate', 'POST', { projectId: convrot.id });
  assert.equal(convrotResult.status, 400);
  assert.match(convrotResult.data.error, /ComfyUI/);

  const q8Project = (await callJson('/api/projects', 'POST', { title: 'Q8 미보유', lyrics: '가사', style: '스타일', modelId: 'yue2-q8' })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: q8Project.id })).status, 400);
  assert.equal(fakeSpawn.calls.length, 0);

  const project = (await callJson('/api/projects', 'POST', { title: '테스트 곡', lyrics: '[Verse]\n가사', style: 'Korean pop', modelId: 'yue2-q4', seed: 42, steps: 8, cot: 'off' })).data;
  assert.ok((await jsonNames(settingDir)).includes('테스트 곡.json'));
  const generated = await callJson('/api/generate', 'POST', { projectId: project.id });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.status, 'completed');
  assert.equal(generated.data.audioPath, '테스트 곡.wav');
  assert.equal(generated.data.durationMs, 1234);
  assert.equal(fakeSpawn.calls.length, 1);
  const args = fakeSpawn.calls[0].args;
  assert.equal(args[args.indexOf('--model') + 1], modelRoot);
  assert.equal(args[args.indexOf('--lyrics') + 1], project.lyrics);
  assert.ok(args.includes('yue2.model_gguf=yue2-3b-q4_0.gguf'));
  assert.ok(args.includes('yue2.vae_gguf=yue2-vae-f16.gguf'));
  assert.ok(args.includes('cot=off'));

  // the draft is left in library/setting untouched; the completed song is a new, separate entity
  assert.ok((await jsonNames(settingDir)).includes('테스트 곡.json'));
  assert.ok((await jsonNames(musicDir)).includes('테스트 곡.json'));
  assert.notEqual(generated.data.id, project.id);
  assert.equal(generated.data.sourceProjectId, project.id);
  assert.equal((await callJson(`/api/projects/${project.id}`)).data.status, 'draft');
  assert.equal(await readFile(path.join(musicDir, '테스트 곡.wav'), 'utf8'), 'RIFF-fake-wav-bytes');
  await assert.rejects(readFile(path.join(root, 'runs', project.id, 'audio.wav')));

  const songId = generated.data.id;
  const audioResponse = await call(`/api/projects/${songId}/audio`);
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers.get('content-type'), 'audio/wav');
  assert.ok((await audioResponse.arrayBuffer()).byteLength > 0);

  // renaming the completed song renames its wav too, and does not touch the source draft's title
  const renamed = await callJson(`/api/projects/${songId}`, 'PATCH', { title: '바꾼 제목' });
  assert.equal(renamed.data.audioPath, '바꾼 제목.wav');
  assert.ok(await readFile(path.join(musicDir, '바꾼 제목.wav'), 'utf8').then(() => true, () => false));
  assert.equal((await call(`/api/projects/${songId}/audio`)).status, 200);
  assert.equal((await callJson(`/api/projects/${project.id}`)).data.title, '테스트 곡');

  // post-processing/EQ save re-encodes the client-rendered WAV, preserving the original file's format and name
  const fakeWavDataUrl = `data:audio/wav;base64,${Buffer.from('client-rendered-wav-bytes').toString('base64')}`;
  const postProcessed = await call(`/api/projects/${songId}/post-process`, 'POST', { dataUrl: fakeWavDataUrl });
  assert.equal(postProcessed.status, 200);
  assert.equal(postProcessed.headers.get('content-type'), 'audio/wav');
  assert.equal(postProcessed.headers.get('content-disposition'), `attachment; filename="${encodeURIComponent('바꾼 제목-modified.wav')}"`);
  assert.equal(await postProcessed.text(), 'fake-transcoded-bytes');
  assert.ok(fakeSpawn.calls.some(c => c.engine === 'ffmpeg'));
  assert.equal((await call(`/api/projects/${songId}/post-process`, 'POST', { dataUrl: 'not-a-data-url' })).status, 400);
  assert.equal((await call(`/api/projects/${project.id}/post-process`, 'POST', { dataUrl: fakeWavDataUrl })).status, 404);
  assert.equal((await call('/api/projects/nonexistent-id/post-process', 'POST', { dataUrl: fakeWavDataUrl })).status, 404);

  // regenerating from the same (still-draft) project produces yet another independent song
  const secondGenerate = await callJson('/api/generate', 'POST', { projectId: project.id });
  assert.equal(secondGenerate.status, 200);
  assert.notEqual(secondGenerate.data.id, songId);
  assert.equal((await callJson(`/api/projects/${project.id}`)).data.status, 'draft');

  fakeSpawn.set({ exitCode: 1, writeOutput: false });
  const failedProject = (await callJson('/api/projects', 'POST', { title: '실패 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: failedProject.id })).status, 502);
  assert.match(await readFile(path.join(root, 'runs', failedProject.id, 'generate.log'), 'utf8'), /metrics/);
  // failed generation leaves the draft in library/setting, untouched
  assert.ok((await jsonNames(settingDir)).includes('실패 테스트.json'));

  fakeSpawn.set({ exitCode: 0, delayMs: 200, writeOutput: true });
  const concurrencyProject = (await callJson('/api/projects', 'POST', { title: '동시성 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  const [first, second] = await Promise.all([
    callJson('/api/generate', 'POST', { projectId: concurrencyProject.id }),
    (async () => { await new Promise(resolve => setTimeout(resolve, 20)); return callJson('/api/generate', 'POST', { projectId: concurrencyProject.id }); })(),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);

  // deleting the song leaves the source project (draft) intact
  assert.equal((await call(`/api/projects/${songId}`, 'DELETE', {})).status, 200);
  assert.equal((await call(`/api/projects/${songId}/audio`)).status, 404);
  await assert.rejects(readFile(path.join(musicDir, '바꾼 제목.wav')));
  assert.equal((await call(`/api/projects/${project.id}`)).status, 200);

  // deleting the project leaves the (other) generated song intact
  assert.equal((await call(`/api/projects/${project.id}`, 'DELETE', {})).status, 200);
  assert.equal((await call(`/api/projects/${secondGenerate.data.id}/audio`)).status, 200);
});

test('audio.cpp (GGUF) generation accepts an external ABC score for cover/instrumental via --request-option abc_file', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-gguf-abc-'));
  const { enginePath } = await setUpEngine(root);
  const pythonEnginePath = path.join(root, 'fake-python.exe');
  const pythonScriptPath = path.join(root, 'run_yue2.py');
  await writeFile(pythonEnginePath, 'stub');
  await writeFile(pythonScriptPath, 'stub');
  await writeFile(path.join(root, 'abc_tools.py'), 'stub');
  // instrumental's auto-plan step runs through the Python engine (there is no GGUF plan path),
  // so it needs the same Python model/vae directories runPythonAction() checks for even though
  // final rendering below happens on audio.cpp
  await mkdir(path.join(root, 'models', 'm-a-p', 'YuE2-3B'), { recursive: true });
  await mkdir(path.join(root, 'models', 'm-a-p', 'YuE2-Vae'), { recursive: true });
  const fakePython = makeFakePythonSpawn(pythonScriptPath);
  const fakeAudioCpp = makeFakeSpawn();
  // ABC prep (plan/mute-voice) always runs through Python; final audio still renders through
  // audio.cpp, so this dispatches each spawn call to whichever fake matches its executable.
  const spawnImpl = (engine, args, options) => (engine === enginePath ? fakeAudioCpp : fakePython).spawnImpl(engine, args, options);
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await call('/api/settings', 'PUT', { enginePath, pythonEnginePath, pythonScriptPath });

  // abc + cot=off is rejected before spawning anything, same as the Python engine
  const badCombo = (await callJson('/api/projects', 'POST', { title: '잘못된 조합', lyrics: '가사', style: '스타일', modelId: 'yue2-q4', cot: 'off', abc: 'X:1\nT:\nK:C\nV: Vocal\nz32|\nV: Ins\nz32|\n' })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: badCombo.id })).status, 400);
  assert.equal(fakeAudioCpp.calls.length, 0);

  // an existing ABC score (e.g. from "심볼릭 작곡"/"오디오에서 추출") is written to a file and
  // passed as --request-option abc_file=<path>, with cot preserved
  const abcWithVocals = 'X:1\nT:\nM:4/4\nL:1/8\nK:C\nV: Vocal\nCDEF GABc|\nV: Ins\nz8|\n';
  const withAbc = (await callJson('/api/projects', 'POST', { title: '악보로 생성', lyrics: '가사', style: '스타일', modelId: 'yue2-q4', cot: 'melody', abc: abcWithVocals })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: withAbc.id })).status, 200);
  const coverArgs = fakeAudioCpp.calls[0].args;
  assert.ok(coverArgs.some(arg => arg === 'cot=melody'));
  const coverAbcOption = coverArgs.find(arg => typeof arg === 'string' && arg.startsWith('abc_file='));
  assert.ok(coverAbcOption, 'expected --request-option abc_file=<path> for a GGUF generation with an ABC score');
  assert.equal(await readFile(coverAbcOption.slice('abc_file='.length), 'utf8'), abcWithVocals);

  // instrumental mode with no existing ABC: auto-plans (Python), strips the Vocal voice
  // (Python abc_tools.py mute-voice), then hands the result to audio.cpp with cot forced melody
  const instrumentalDraft = (await callJson('/api/projects', 'POST', { title: '악기만 GGUF', lyrics: '가사', style: '스타일', modelId: 'yue2-q4', cot: 'off', instrumental: true })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: instrumentalDraft.id })).status, 200);
  assert.ok(fakePython.calls.some(c => c.args[1] === 'plan'), 'expected an auto-plan for instrumental with no existing ABC');
  const muteCall = fakePython.calls.find(c => path.basename(c.args[0]) === 'abc_tools.py' && c.args[1] === 'mute-voice');
  assert.ok(muteCall, 'expected abc_tools.py mute-voice to run for GGUF instrumental generation');
  const instrumentalArgs = fakeAudioCpp.calls[1].args;
  assert.ok(instrumentalArgs.some(arg => arg === 'cot=melody'));
  const instrumentalAbcOption = instrumentalArgs.find(arg => typeof arg === 'string' && arg.startsWith('abc_file='));
  assert.ok(instrumentalAbcOption, 'expected --request-option abc_file=<path> for GGUF instrumental generation');
  // the persisted draft keeps the user's original cot; only the generation call was adjusted
  assert.equal((await callJson(`/api/projects/${instrumentalDraft.id}`)).data.cot, 'off');
});

test('STEM separation (HTDemucs) splits a completed song into vocals/drums/bass/other, serves each, and cleans up on delete', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-stems-'));
  const { enginePath } = await setUpEngine(root);
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath });

  const draft = (await callJson('/api/projects', 'POST', { title: '스템 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  const generated = await callJson('/api/generate', 'POST', { projectId: draft.id });
  assert.equal(generated.status, 200);
  const songId = generated.data.id;

  // no STEM files yet: fetching one 404s
  assert.equal((await call(`/api/projects/${songId}/stems/vocals`)).status, 404);

  const started = await callJson(`/api/projects/${songId}/stems`, 'POST', {});
  assert.equal(started.status, 200);
  assert.deepEqual(started.data.stems, ['vocals', 'drums', 'bass', 'other']);
  const sepCall = fakeSpawn.calls.find(c => c.args.includes('sep'));
  assert.ok(sepCall, 'expected a --task sep invocation');
  assert.ok(sepCall.args.includes('htdemucs'));
  assert.ok(fakeSpawn.calls.some(c => c.engine === 'ffmpeg'), 'expected ffmpeg to convert the source to 44.1kHz first');

  for (const name of ['vocals', 'drums', 'bass', 'other']) {
    const response = await call(`/api/projects/${songId}/stems/${name}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(await response.text(), `fake-${name}-bytes`);
  }
  assert.equal((await call(`/api/projects/${songId}/stems/nonsense`)).status, 404);

  assert.equal((await callJson(`/api/projects/${songId}/stems`, 'DELETE', {})).status, 200);
  assert.equal((await call(`/api/projects/${songId}/stems/vocals`)).status, 404);

  // mode: "vocal" uses mel_band_roformer for a cleaner 2-way vocals/instrumental split instead of htdemucs's 4-way
  const vocalMode = await callJson(`/api/projects/${songId}/stems`, 'POST', { mode: 'vocal' });
  assert.equal(vocalMode.status, 200);
  assert.deepEqual(vocalMode.data.stems, ['vocals', 'instrumental']);
  const roformerCall = fakeSpawn.calls.find(c => c.args.includes('mel_band_roformer'));
  assert.ok(roformerCall, 'expected a --family mel_band_roformer invocation');
  assert.equal((await call(`/api/projects/${songId}/stems/instrumental`)).status, 200);
  assert.equal((await call(`/api/projects/${songId}/stems/drums`)).status, 404, 'vocal mode never produced a drums stem');
  assert.equal((await callJson(`/api/projects/${songId}/stems`, 'DELETE', {})).status, 200);

  // engine failure surfaces as 502, and no stem files are left behind
  fakeSpawn.setSep({ exitCode: 1, writeOutput: false });
  const failed = await callJson(`/api/projects/${songId}/stems`, 'POST', {});
  assert.equal(failed.status, 502);
  assert.equal((await call(`/api/projects/${songId}/stems/vocals`)).status, 404);

  // missing HTDemucs model is a clear 400, not a crash
  await rm(path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf'), { recursive: true, force: true });
  const noModel = await callJson(`/api/projects/${songId}/stems`, 'POST', {});
  assert.equal(noModel.status, 400);
});

test('save format controls what gets written into a custom, relative music folder', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-save-'));
  const { enginePath } = await setUpEngine(root);
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  const customMusic = await callJson('/api/settings', 'PUT', { enginePath, musicPath: 'custom-music', saveFormat: 'wav' });
  assert.equal(customMusic.data.musicPath, 'custom-music');
  assert.ok(await readdir(path.join(root, 'custom-music')).then(() => true, () => false));
  assert.equal((await call('/api/settings', 'PUT', { saveFormat: 'ogg' })).status, 400);

  const weird = (await callJson('/api/projects', 'POST', { title: '가/나:"곡"*<제목>?|', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  const savedWav = await callJson('/api/generate', 'POST', { projectId: weird.id });
  assert.equal(savedWav.status, 200);
  assert.equal(savedWav.data.saveError, null);
  assert.equal(savedWav.data.audioPath, '가 나 곡 제목.wav');
  assert.equal((await readFile(path.join(root, 'custom-music', savedWav.data.audioPath), 'utf8')), 'RIFF-fake-wav-bytes');

  const sameTitleAgain = (await callJson('/api/projects', 'POST', { title: '가/나:"곡"*<제목>?|', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  const savedWavAgain = await callJson('/api/generate', 'POST', { projectId: sameTitleAgain.id });
  assert.equal(savedWavAgain.data.audioPath, savedWav.data.audioPath.replace('.wav', ' (1).wav'));

  await call('/api/settings', 'PUT', { saveFormat: 'mp3' });
  const mp3Project = (await callJson('/api/projects', 'POST', { title: 'MP3 변환 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  const savedMp3 = await callJson('/api/generate', 'POST', { projectId: mp3Project.id });
  assert.equal(savedMp3.data.saveError, null);
  assert.ok(savedMp3.data.audioPath.endsWith('.mp3'));
  const audioResponse = await call(`/api/projects/${savedMp3.data.id}/audio`);
  assert.equal(audioResponse.headers.get('content-type'), 'audio/mpeg');
  assert.ok(fakeSpawn.calls.some(call => call.engine === 'ffmpeg'));

  fakeSpawn.setFfmpeg({ exitCode: 1, writeOutput: false });
  const brokenFfmpegProject = (await callJson('/api/projects', 'POST', { title: 'ffmpeg 실패 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  const brokenResult = await callJson('/api/generate', 'POST', { projectId: brokenFfmpegProject.id });
  assert.equal(brokenResult.status, 200);
  assert.equal(brokenResult.data.status, 'completed');
  assert.ok(brokenResult.data.audioPath.endsWith('.wav'));
  assert.match(brokenResult.data.saveError, /ffmpeg/);
});

test('yue2-original routes to the Python runner, and downloads support on-demand format conversion', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-python-'));
  await mkdir(path.join(root, 'models', 'm-a-p', 'YuE2-3B'), { recursive: true });
  await mkdir(path.join(root, 'models', 'm-a-p', 'YuE2-Vae'), { recursive: true });
  const pythonEnginePath = path.join(root, 'fake-python.exe');
  const pythonScriptPath = path.join(root, 'run_yue2.py');
  await writeFile(pythonEnginePath, 'stub');
  await writeFile(pythonScriptPath, 'stub');
  await writeFile(path.join(root, 'abc_tools.py'), 'stub');
  const fakePython = makeFakePythonSpawn(pythonScriptPath);
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakePython.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await call('/api/settings', 'PUT', { pythonEnginePath, pythonScriptPath, saveFormat: 'flac' });

  const original = (await callJson('/api/projects', 'POST', { title: '원본 모델 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-original', seed: 7, cot: 'off' })).data;
  const generated = await callJson('/api/generate', 'POST', { projectId: original.id });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.status, 'completed');
  assert.equal(generated.data.truncated, false);
  assert.equal(generated.data.sourceProjectId, original.id);
  assert.notEqual(generated.data.id, original.id);
  assert.ok(generated.data.audioPath.endsWith('.flac'));
  // the source project stays a draft, untouched by generation
  assert.equal((await callJson(`/api/projects/${original.id}`)).data.status, 'draft');
  const songId = generated.data.id;
  const pyArgs = fakePython.calls[0].args;
  assert.equal(pyArgs[0], pythonScriptPath);
  assert.equal(pyArgs[1], 'generate');
  assert.ok(pyArgs.includes('--memory-budget-gib'));
  assert.ok(pyArgs.includes('--offline'));
  const requestFile = pyArgs[pyArgs.indexOf('--request') + 1];
  assert.equal(pyArgs[pyArgs.indexOf('--model') + 1], path.join(root, 'models', 'm-a-p', 'YuE2-3B'));
  const sentRequest = JSON.parse(await readFile(requestFile, 'utf8'));
  assert.equal(sentRequest.lyrics, '가사');
  assert.equal(sentRequest.seed, 7);
  assert.equal(sentRequest.cot, 'off');
  assert.equal(generated.data.durationMs, 1234);

  // instrumental mode with no existing ABC: auto-plans, strips the Vocal voice, forces cot off->melody
  const instrumentalDraft = (await callJson('/api/projects', 'POST', { title: '악기만 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-original', cot: 'off', instrumental: true })).data;
  const instrumentalGenerated = await callJson('/api/generate', 'POST', { projectId: instrumentalDraft.id });
  assert.equal(instrumentalGenerated.status, 200);
  const stripCall = fakePython.calls.find(c => path.basename(c.args[0]) === 'abc_tools.py');
  assert.ok(stripCall, 'expected abc_tools.py mute-voice to run for instrumental generation');
  assert.equal(stripCall.args[1], 'mute-voice');
  assert.equal(stripCall.args[4], '--keep-voice');
  assert.equal(stripCall.args[5], 'Ins');
  const instrumentalGenerateCall = fakePython.calls.filter(c => c.args[0] === pythonScriptPath && c.args[1] === 'generate').pop();
  const instrumentalAbcFile = instrumentalGenerateCall.args[instrumentalGenerateCall.args.indexOf('--abc-file') + 1];
  assert.ok(instrumentalAbcFile, 'expected --abc-file to be passed for instrumental generation');
  const instrumentalRequestFile = instrumentalGenerateCall.args[instrumentalGenerateCall.args.indexOf('--request') + 1];
  const instrumentalRequest = JSON.parse(await readFile(instrumentalRequestFile, 'utf8'));
  assert.equal(instrumentalRequest.cot, 'melody');
  assert.equal(instrumentalRequest.style, '스타일, instrumental, no vocals');
  // the persisted draft keeps the user's original cot/abc; only the generation call was adjusted
  assert.equal((await callJson(`/api/projects/${instrumentalDraft.id}`)).data.cot, 'off');

  // instrumental mode with a pre-existing ABC that already has real Vocal notes: those notes
  // must be silenced too, not just passed through (the earlier case only had an empty Vocal voice)
  fakePython.calls.length = 0;
  const abcWithVocals = 'X:1\nT:\nM:4/4\nL:1/8\nK:C\nV: Vocal\nCDEF GABc|\nV: Ins\nz8|\n';
  const instrumentalWithAbc = (await callJson('/api/projects', 'POST', { title: '악보 있는 악기만', lyrics: '가사', style: '스타일', modelId: 'yue2-original', cot: 'full', instrumental: true, abc: abcWithVocals })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: instrumentalWithAbc.id })).status, 200);
  const noPlanCall = fakePython.calls.find(c => c.args[0] === pythonScriptPath && c.args[1] === 'plan');
  assert.equal(noPlanCall, undefined, 'an existing ABC should not trigger an extra auto-plan step');
  const stripCallWithVocals = fakePython.calls.find(c => path.basename(c.args[0]) === 'abc_tools.py');
  const strippedSourceContent = await readFile(stripCallWithVocals.args[2], 'utf8');
  assert.equal(strippedSourceContent, abcWithVocals, 'the real Vocal-note ABC must be handed to mute-voice, not skipped');
  const strippedOutputContent = await readFile(stripCallWithVocals.args[3], 'utf8');
  assert.ok(!strippedOutputContent.includes('CDEF GABc'), 'the Vocal melody notes must be silenced before generation');

  // download endpoint: same format serves directly, different format transcodes on demand and is cached
  const direct = await call(`/api/projects/${songId}/audio?format=flac&download=1`);
  assert.equal(direct.status, 200);
  assert.equal(direct.headers.get('content-disposition'), `attachment; filename="${encodeURIComponent(generated.data.audioPath)}"`);
  const converted = await call(`/api/projects/${songId}/audio?format=wav&download=1`);
  assert.equal(converted.status, 200);
  assert.equal(converted.headers.get('content-type'), 'audio/wav');
  assert.equal(await converted.text(), 'flac-converted-bytes');
  const musicDirPath = path.join(root, 'library', 'music');
  assert.ok(await readdir(musicDirPath).then(names => names.some(name => name.endsWith('.wav'))));

  // cover upload/serve/delete: stored in the shared library/cover folder, keyed by id (independent of title)
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const coverUpload = await callJson(`/api/projects/${songId}/cover`, 'POST', { dataUrl: `data:image/png;base64,${tinyPngBase64}` });
  assert.equal(coverUpload.status, 200);
  assert.equal(coverUpload.data.coverPath, `${songId}.png`);
  assert.ok(await readdir(path.join(root, 'library', 'cover')).then(names => names.includes(`${songId}.png`)));
  const coverGet = await call(`/api/projects/${songId}/cover`);
  assert.equal(coverGet.status, 200);
  assert.equal(coverGet.headers.get('content-type'), 'image/png');
  const renamed = await callJson(`/api/projects/${songId}`, 'PATCH', { title: '원본 모델 테스트 (개명)' });
  assert.equal(renamed.data.coverPath, `${songId}.png`);
  assert.equal((await call(`/api/projects/${songId}/cover`)).status, 200);
  const coverDelete = await callJson(`/api/projects/${songId}/cover`, 'DELETE', {});
  assert.equal(coverDelete.status, 200);
  assert.equal((await call(`/api/projects/${songId}/cover`)).status, 404);

  // playlists: create, add songs, rename, delete
  const playlist = (await callJson('/api/playlists', 'POST', { name: '드라이브 플레이리스트' })).data;
  assert.deepEqual(playlist.songIds, []);
  const withSong = await callJson(`/api/playlists/${playlist.id}`, 'PATCH', { songIds: [songId] });
  assert.deepEqual(withSong.data.songIds, [songId]);
  const renamedPlaylist = await callJson(`/api/playlists/${playlist.id}`, 'PATCH', { name: '새벽 드라이브' });
  assert.equal(renamedPlaylist.data.name, '새벽 드라이브');
  assert.equal((await callJson('/api/playlists')).data.length, 1);
  assert.equal((await callJson(`/api/playlists/${playlist.id}`, 'DELETE', {})).status, 200);
  assert.equal((await callJson('/api/playlists')).data.length, 0);
});

test('symbolic planning, ABC score generation option, and the ABC-note library', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-abc-'));
  await mkdir(path.join(root, 'models', 'm-a-p', 'YuE2-3B'), { recursive: true });
  await mkdir(path.join(root, 'models', 'm-a-p', 'YuE2-Vae'), { recursive: true });
  const pythonEnginePath = path.join(root, 'fake-python.exe');
  const pythonScriptPath = path.join(root, 'run_yue2.py');
  const abcToolsPath = path.join(root, 'abc_tools.py');
  await writeFile(pythonEnginePath, 'stub');
  await writeFile(pythonScriptPath, 'stub');
  await writeFile(abcToolsPath, 'stub');
  const calls = [];
  const spawnImpl = (engine, args) => {
    calls.push({ engine, args });
    const emitter = new EventEmitter();
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    emitter.kill = () => emitter.emit('close', null, 'SIGTERM');
    const script = args[0];
    if (path.basename(script) === 'abc_tools.py') {
      const scoreFile = args[2];
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        const contents = await readFile(scoreFile, 'utf8');
        if (contents.includes('BROKEN')) {
          emitter.stderr.emit('data', Buffer.from('not valid abc'));
          emitter.emit('close', 1, null);
        } else {
          emitter.stdout.emit('data', Buffer.from(JSON.stringify({ voices: { Vocal: {}, Ins: {} } })));
          emitter.emit('close', 0, null);
        }
      })();
      return emitter;
    }
    if (!args.includes('--output')) { // ffmpeg calls used for save-format conversion after finalize
      const outPath = args[args.length - 1];
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        await writeFile(outPath, Buffer.from('flac-converted-bytes'));
        emitter.emit('close', 0, null);
      })();
      return emitter;
    }
    const action = args[1];
    const outDir = args[args.indexOf('--output') + 1];
    (async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await mkdir(outDir, { recursive: true });
      if (action === 'plan') await writeFile(path.join(outDir, 'score.abc'), 'X:1\nT:\nK:C\nV: Vocal\nz32|\nV: Ins\nz32|\n');
      else {
        await writeFile(path.join(outDir, 'audio.flac'), Buffer.from('fLaC-fake-bytes'));
        await writeFile(path.join(outDir, 'result.json'), JSON.stringify({ status: 'complete', truncated: { abc: false, semantic: false }, audio_seconds: 2.0, sample_rate: 48000 }));
      }
      emitter.emit('close', 0, null);
    })();
    return emitter;
  };
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await call('/api/settings', 'PUT', { pythonEnginePath, pythonScriptPath, pythonMemoryBudgetGib: 11 });
  assert.equal((await callJson('/api/settings')).data.pythonMemoryBudgetGib, 11);

  // plan() is stateless: it takes draft fields directly and never creates a project
  const projectCountBefore = (await callJson('/api/projects')).data.length;
  assert.equal((await callJson('/api/plan', 'POST', { title: '계획 없음', lyrics: '가사', style: '스타일', cot: 'off' })).status, 400);

  // plan() succeeds for a symbolic mode and returns real ABC text, still without persisting anything
  const planned = await callJson('/api/plan', 'POST', { title: '악보 테스트', lyrics: '가사', style: '스타일', cot: 'full', seed: 7 });
  assert.equal(planned.status, 200);
  assert.match(planned.data.abc, /^X:1/);
  assert.equal((await callJson('/api/projects')).data.length, projectCountBefore);
  const planArgs = calls.find(c => c.args[1] === 'plan').args;
  assert.ok(planArgs.includes('--memory-budget-gib'));
  assert.ok(planArgs.includes('11'));

  // abc-check validates ABC text via abc_tools.py inspect
  const validCheck = await callJson('/api/abc-check', 'POST', { abc: planned.data.abc });
  assert.equal(validCheck.status, 200);
  assert.equal(validCheck.data.valid, true);
  const invalidCheck = await callJson('/api/abc-check', 'POST', { abc: 'BROKEN garbage' });
  assert.equal(invalidCheck.status, 200);
  assert.equal(invalidCheck.data.valid, false);

  // saving a draft with abc + cot=off is rejected at generation time
  const badCombo = (await callJson('/api/projects', 'POST', { title: '잘못된 조합', lyrics: '가사', style: '스타일', modelId: 'yue2-original', cot: 'off', abc: planned.data.abc })).data;
  assert.equal((await callJson('/api/generate', 'POST', { projectId: badCombo.id })).status, 400);

  // generating with an abc score passes --abc-file and reports duration from result.json
  const withAbc = (await callJson('/api/projects', 'POST', { title: '악보로 생성', lyrics: '가사', style: '스타일', modelId: 'yue2-original', cot: 'melody', abc: planned.data.abc })).data;
  const generated = await callJson('/api/generate', 'POST', { projectId: withAbc.id });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.durationMs, 2000);
  const genArgs = calls.find(c => c.args[1] === 'generate' && c.args.includes('--abc-file')).args;
  const abcFile = genArgs[genArgs.indexOf('--abc-file') + 1];
  assert.equal(await readFile(abcFile, 'utf8'), planned.data.abc);

  // the abc-note library: save as a plain .abc file by default, list, edit (rename + content), delete
  const savedNote = await callJson('/api/abc-notes', 'POST', { title: '내 악보', abc: planned.data.abc });
  assert.equal(savedNote.status, 201);
  assert.equal(savedNote.data.abc, planned.data.abc);
  assert.match(savedNote.data.id, /^abcfile-/);
  const list = await callJson('/api/abc-notes');
  assert.equal(list.data.length, 1);
  // renaming a .abc-format note renames its file, so its id (derived from the filename) changes too
  const edited = await callJson(`/api/abc-notes/${savedNote.data.id}`, 'PATCH', { title: '수정된 악보', abc: 'X:1\nT:\nK:C\nV: Vocal\nz32|\nV: Ins\nz32|\n' });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.title, '수정된 악보');
  assert.equal((await callJson('/api/abc-notes')).data[0].title, '수정된 악보');
  assert.equal((await callJson(`/api/abc-notes/${edited.data.id}`, 'PATCH', { abc: '' })).status, 400);
  assert.equal((await callJson(`/api/abc-notes/${edited.data.id}`, 'DELETE', {})).status, 200);
  assert.equal((await callJson('/api/abc-notes')).data.length, 0);
});
