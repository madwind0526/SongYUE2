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

  // regression: ComfyUI/AudioAuK/DDSP-SVC endpoint+path settings were silently missing from
  // publicSettings()'s response allowlist (comfyUiEndpoint/comfyUiEnginePath, pre-existing) and
  // from the saveJson() disk-persistence allowlist (audioAukEndpoint/audioAukPath/ddspSvcPath,
  // introduced when those fields were added) -- both bugs let "설정 저장" claim success while the
  // value silently never reached the client or survived a restart. Assert the full round trip.
  const engineSettingsInput = { comfyUiEndpoint: 'http://127.0.0.1:9001', comfyUiEnginePath: 'engine/ComfyUI-test', audioAukEndpoint: 'http://127.0.0.1:9002', audioAukPath: 'C:\\AudioAuK-test', ddspSvcPath: 'test/DDSP-SVC-test' };
  const engineSettingsSaved = await call('/api/settings', 'PUT', engineSettingsInput);
  for (const [key, value] of Object.entries(engineSettingsInput)) assert.equal(engineSettingsSaved.data[key], value, `expected ${key} in the PUT response`);
  const engineSettingsFetched = await call('/api/settings');
  for (const [key, value] of Object.entries(engineSettingsInput)) assert.equal(engineSettingsFetched.data[key], value, `expected ${key} in a fresh GET`);

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
  for (const [key, value] of Object.entries(engineSettingsInput)) assert.equal(restarted.data[key], value, `expected ${key} to survive a server restart (saveJson persistence)`);
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
  let probe = { exitCode: 0, channels: '2', durationSeconds: '97.5' };
  // Seed-VC's raw output measures quieter than the pre-conversion vocal in real testing, so the
  // default here mirrors that gap -- exercising the vocal-timbre loudness-matching fix by default
  // instead of only under an opt-in test scenario.
  let volumeProbe = { forFile: (file) => (file.includes('converted-vocals') ? -34 : -26.4) };
  const spawnImpl = (engine, args) => {
    calls.push({ engine, args });
    const emitter = new EventEmitter();
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    emitter.kill = () => emitter.emit('close', null, 'SIGTERM');
    if (engine === 'ffprobe') {
      const behavior = probe;
      const isDurationProbe = args.some(arg => String(arg).includes('format=duration'));
      (async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        emitter.stdout.emit('data', Buffer.from((isDurationProbe ? behavior.durationSeconds : behavior.channels) || ''));
        emitter.emit('close', behavior.exitCode, null);
      })();
      return emitter;
    }
    if (engine === 'ffmpeg') {
      const behavior = ffmpeg;
      if (args.includes('volumedetect')) {
        const inputFile = args[args.indexOf('-i') + 1];
        const db = volumeProbe.forFile(inputFile);
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 0));
          emitter.stderr.emit('data', Buffer.from(`[Parsed_volumedetect_0 @ 0x0] mean_volume: ${db} dB\n`));
          emitter.emit('close', 0, null);
        })();
        return emitter;
      }
      if (args.some(arg => arg.includes('channelsplit'))) {
        const leftPath = args[args.indexOf('[left]') + 1];
        const rightPath = args[args.indexOf('[right]') + 1];
        (async () => {
          await new Promise(resolve => setTimeout(resolve, behavior.delayMs || 0));
          if (behavior.writeOutput && behavior.exitCode === 0) {
            await writeFile(leftPath, Buffer.from('fake-left-bytes'));
            await writeFile(rightPath, Buffer.from('fake-right-bytes'));
          }
          emitter.emit('close', behavior.exitCode, null);
        })();
        return emitter;
      }
      const outPath = args[args.length - 1];
      // Mirrors real ffmpeg's refusal to read and write the same file in one invocation ("FFmpeg
      // cannot edit existing files in-place") -- catches any future same-path regression like the
      // vocal-timbre reference-audio bug (2026-09-16: a .wav reference collided with the ffmpeg
      // output path since both defaulted to "voice-ref.wav").
      const inIndex = args.indexOf('-i');
      const inPath = inIndex >= 0 ? args[inIndex + 1] : null;
      if (inPath && inPath === outPath) {
        (async () => {
          await new Promise(resolve => setTimeout(resolve, behavior.delayMs || 0));
          emitter.emit('close', 1, null);
        })();
        return emitter;
      }
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
    const textOutIndex = args.indexOf('--text-out');
    const textOutPath = textOutIndex >= 0 ? args[textOutIndex + 1] : null;
    (async () => {
      await new Promise(resolve => setTimeout(resolve, behavior.delayMs || 0));
      if (behavior.writeOutput && behavior.exitCode === 0) {
        await writeFile(outPath, Buffer.from('RIFF-fake-wav-bytes'));
        if (textOutPath) {
          await writeFile(textOutPath, JSON.stringify([
            { type: 'start', pitch: 60, start_time: 0, index: 0, instrument: 'acoustic_piano' },
            { type: 'end', end_time: 0.5, start_event_index: 0 },
            { type: 'start', pitch: 64, start_time: 0.5, index: 1, instrument: 'acoustic_piano' },
            { type: 'end', end_time: 1, start_event_index: 1 },
          ]));
        }
      }
      emitter.stdout.emit('data', Buffer.from(behavior.metrics || ''));
      emitter.emit('close', behavior.exitCode, null);
    })();
    return emitter;
  };
  return { spawnImpl, calls, set: (behavior) => { next = { ...next, ...behavior }; }, setFfmpeg: (behavior) => { ffmpeg = { ...ffmpeg, ...behavior }; }, setSep: (behavior) => { sep = { ...sep, ...behavior }; }, setProbe: (behavior) => { probe = { ...probe, ...behavior }; }, setVolumeProbe: (behavior) => { volumeProbe = { ...volumeProbe, ...behavior }; } };
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

  // Default cot is 'full' (see /api/projects), so runComfyUi first needs a symbolic-planning
  // pass (the same Python engine the other two runners already depend on for this) before it
  // ever reaches ComfyUI -- and this section never configures pythonEnginePath/pythonScriptPath.
  // The full ComfyUI success/failure path (with cot: 'off', no planning needed) is covered
  // separately below.
  const convrot = (await callJson('/api/projects', 'POST', { title: 'ConvRot', lyrics: '가사', style: '스타일', modelId: 'yue2-int8-convrot' })).data;
  const convrotResult = await callJson('/api/generate', 'POST', { projectId: convrot.id });
  assert.equal(convrotResult.status, 400);
  assert.match(convrotResult.data.error, /Python/);

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

test('STEM separation (HTDemucs/Mel-Band RoFormer/plain L-R channel split) splits a completed song, serves each part, and cleans up on delete', async t => {
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

  // mode: "channel" is a plain ffmpeg L/R split, no audio.cpp/model involved at all
  const callsBeforeChannel = fakeSpawn.calls.length;
  const channelMode = await callJson(`/api/projects/${songId}/stems`, 'POST', { mode: 'channel' });
  assert.equal(channelMode.status, 200);
  assert.deepEqual(channelMode.data.stems, ['left', 'right']);
  const channelCalls = fakeSpawn.calls.slice(callsBeforeChannel);
  assert.ok(channelCalls.some(c => c.engine === 'ffprobe'), 'expected an ffprobe channel-count check');
  assert.ok(channelCalls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => arg.includes('channelsplit'))), 'expected an ffmpeg channelsplit invocation');
  assert.ok(!channelCalls.some(c => c.args.includes('sep')), 'channel mode must never invoke the audio.cpp engine');
  assert.equal((await call(`/api/projects/${songId}/stems/left`)).status, 200);
  assert.equal(await (await call(`/api/projects/${songId}/stems/right`)).text(), 'fake-right-bytes');
  assert.equal((await callJson(`/api/projects/${songId}/stems`, 'DELETE', {})).status, 200);

  // mono source: rejected with a clear 400, no ffmpeg split attempted
  fakeSpawn.setProbe({ channels: '1' });
  const monoRejected = await callJson(`/api/projects/${songId}/stems`, 'POST', { mode: 'channel' });
  assert.equal(monoRejected.status, 400);
  fakeSpawn.setProbe({ channels: '2' });

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

test('yue2-int8-convrot routes to the ComfyUI runner (mocked ComfyUI HTTP API) and produces a completed song', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-comfyui-'));
  const fakeSpawn = makeFakeSpawn();
  const requests = [];
  const fetchImpl = async (url, options) => {
    const href = String(url);
    requests.push({ url: href, body: options?.body ? JSON.parse(options.body) : null });
    if (href.includes('/system_stats')) return Response.json({ system: { os: 'win32' } });
    if (href.includes('/prompt')) return Response.json({ prompt_id: 'test-prompt-1', number: 0, node_errors: {} });
    if (href.includes('/history/test-prompt-1')) return Response.json({ 'test-prompt-1': { status: { status_str: 'success', completed: true }, outputs: { '7': { audio: [{ filename: 'smoke.flac', subfolder: 'songyue2-test', type: 'output' }] } } } });
    if (href.includes('/view')) return new Response(Buffer.from('fake-comfyui-flac-bytes'), { status: 200 });
    if (href.includes('/free')) return Response.json({});
    return Response.json({});
  };
  const server = await createStudioServer({ root, fetchImpl, spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  const project = (await callJson('/api/projects', 'POST', { title: 'ComfyUI 테스트', lyrics: '[Verse]\n가사', style: 'Korean pop', modelId: 'yue2-int8-convrot', seed: 42, steps: 20, cot: 'off' })).data;
  const generated = await callJson('/api/generate', 'POST', { projectId: project.id });
  assert.equal(generated.status, 200);
  assert.equal(generated.data.status, 'completed');
  assert.ok(generated.data.audioPath.endsWith('.wav')); // default saveFormat; ComfyUI returns flac, so this also exercises the ffmpeg conversion path
  assert.equal(await readFile(path.join(root, 'library', 'music', generated.data.audioPath), 'utf8'), 'fake-transcoded-bytes');
  assert.ok(fakeSpawn.calls.some(call => call.engine === 'ffmpeg'));
  // ComfyUI has no --metrics log line like audio.cpp, so runComfyUi() must probe the rendered file
  // itself -- without this, card view silently showed no duration for ComfyUI-generated songs
  // (e.g. INT8 ConvRot), a real bug reported 2026-09-17.
  assert.equal(generated.data.durationMs, 97500);
  assert.ok(fakeSpawn.calls.some(call => call.engine === 'ffprobe' && call.args.some(arg => String(arg).includes('format=duration'))));

  const promptRequest = requests.find(r => r.url.includes('/prompt'));
  assert.ok(promptRequest.body.prompt['1'].inputs.ckpt_name === 'yue2_3b_int8_convrot.safetensors');
  assert.equal(promptRequest.body.prompt['2'].inputs.style.startsWith('Korean pop'), true);
  assert.equal(promptRequest.body.prompt['2'].inputs.abc, ''); // cot: 'off' with no user-supplied ABC -> no planning pass, empty abc
});

test('음원 복원 (AudioSR): mono restores directly, stereo splits L/R and remuxes, missing model is a clear 400', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-audiosr-'));
  const { enginePath } = await setUpEngine(root);
  const audiosrModel = path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf', 'AudioSR-GGUF', 'audiosr-basic-f32.gguf');
  await mkdir(path.dirname(audiosrModel), { recursive: true });
  await writeFile(audiosrModel, 'stub');
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath });
  const dataUrl = `data:audio/wav;base64,${Buffer.from('fake-degraded-audio').toString('base64')}`;

  // stereo source: ffprobe -> 2 channels -> L/R split, two audiosr runs, remux -- preview only, not yet saved to the library
  const stereoPreview = await callJson('/api/audiosr-restore/preview', 'POST', { dataUrl });
  assert.equal(stereoPreview.status, 200);
  assert.ok(stereoPreview.data.id);
  assert.ok(fakeSpawn.calls.some(c => c.engine === 'ffprobe'));
  assert.ok(fakeSpawn.calls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => arg.includes('channelsplit'))));
  assert.equal(fakeSpawn.calls.filter(c => c.args.includes('audiosr')).length, 2, 'expected two audiosr runs, one per channel');
  assert.ok(fakeSpawn.calls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => arg.includes('join'))), 'expected a join remux back to stereo');
  assert.equal(stereoPreview.data.durationMs, 97500, 'restored song must carry a measured duration for card view (2026-09-17 bug)');

  // preview audio is servable before saving (dialog plays 원본/복원 from these routes)
  const original = await call(`/api/audiosr-restore/preview/${stereoPreview.data.id}/original`);
  assert.equal(original.status, 200);
  const restored = await call(`/api/audiosr-restore/preview/${stereoPreview.data.id}/restored`);
  assert.equal(restored.status, 200);

  // saving finalizes into the library
  const stereo = await callJson(`/api/audiosr-restore/preview/${stereoPreview.data.id}/save`, 'POST', { title: '복원 테스트(스테레오)' });
  assert.equal(stereo.status, 200);
  assert.equal(stereo.data.status, 'completed');
  assert.equal(stereo.data.title, '복원 테스트(스테레오)');
  // preview is cleaned up once saved
  assert.equal((await call(`/api/audiosr-restore/preview/${stereoPreview.data.id}/restored`)).status, 404);

  // mono source: single audiosr run, no channel split
  fakeSpawn.calls.length = 0;
  fakeSpawn.setProbe({ channels: '1' });
  const monoPreview = await callJson('/api/audiosr-restore/preview', 'POST', { dataUrl });
  assert.equal(monoPreview.status, 200);
  assert.equal(fakeSpawn.calls.filter(c => c.args.includes('audiosr')).length, 1, 'expected one audiosr run for mono');
  assert.ok(!fakeSpawn.calls.some(c => c.args.some(arg => arg.includes('channelsplit'))), 'mono source must not be channel-split');
  fakeSpawn.setProbe({ channels: '2' });

  // cancelling (DELETE) instead of saving cleans up without touching the library
  const cancelled = await call(`/api/audiosr-restore/preview/${monoPreview.data.id}`, 'DELETE', {});
  assert.equal(cancelled.status, 200);
  assert.equal((await call(`/api/audiosr-restore/preview/${monoPreview.data.id}/restored`)).status, 404);

  // empty title falls back to a default, not a blank library entry
  const untitledPreview = await callJson('/api/audiosr-restore/preview', 'POST', { dataUrl });
  const untitled = await callJson(`/api/audiosr-restore/preview/${untitledPreview.data.id}/save`, 'POST', {});
  assert.equal(untitled.status, 200);
  assert.equal(untitled.data.title, '복원된 오디오');

  // bad dataUrl / missing model
  assert.equal((await callJson('/api/audiosr-restore/preview', 'POST', { dataUrl: 'not-a-data-url' })).status, 400);
  await rm(audiosrModel);
  const noModel = await callJson('/api/audiosr-restore/preview', 'POST', { dataUrl });
  assert.equal(noModel.status, 400);
  assert.match(noModel.data.error, /AudioSR/);
});

test('음원 비교(범용 저장): 프로젝트 없이 브라우저에서 만든 WAV 버퍼를 그대로 라이브러리에 추가한다', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-audio-save-'));
  const { enginePath } = await setUpEngine(root);
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const callJson = async (route, method, payload) => { const response = await fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  await callJson('/api/settings', 'PUT', { enginePath });

  const dataUrl = `data:audio/wav;base64,${Buffer.from('client-side-buffer-bytes').toString('base64')}`;
  const titled = await callJson('/api/audio-save', 'POST', { dataUrl, title: '음원-1 (후처리)' });
  assert.equal(titled.status, 200);
  assert.equal(titled.data.status, 'completed');
  assert.equal(titled.data.title, '음원-1 (후처리)');
  assert.equal(titled.data.durationMs, 97500);

  // empty title falls back to a default, not a blank library entry
  const untitled = await callJson('/api/audio-save', 'POST', { dataUrl });
  assert.equal(untitled.status, 200);
  assert.equal(untitled.data.title, '저장된 오디오');

  // bad dataUrl / not-wav is a clear 400
  assert.equal((await callJson('/api/audio-save', 'POST', { dataUrl: 'not-a-data-url' })).status, 400);
  assert.equal((await callJson('/api/audio-save', 'POST', { dataUrl: 'data:audio/mpeg;base64,AAAA' })).status, 400);
});

test('MIDI 내보내기 (MuScriptor): exports a completed song to MIDI, caches the result, missing model is a clear 400', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-midi-'));
  const { enginePath } = await setUpEngine(root);
  const muscriptorModel = path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf', 'MuScriptor-Small-GGUF', 'muscriptor-small-f32.gguf');
  await mkdir(path.dirname(muscriptorModel), { recursive: true });
  await writeFile(muscriptorModel, 'stub');
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath });
  const draft = (await callJson('/api/projects', 'POST', { title: 'MIDI 테스트', lyrics: '가사', style: '스타일', modelId: 'yue2-q4' })).data;
  const generated = await callJson('/api/generate', 'POST', { projectId: draft.id });
  assert.equal(generated.status, 200);
  const songId = generated.data.id;

  const callsBeforeMidi = fakeSpawn.calls.length;
  const midiResponse = await call(`/api/projects/${songId}/midi`);
  assert.equal(midiResponse.status, 200);
  assert.equal(midiResponse.headers.get('content-type'), 'audio/midi');
  assert.match(midiResponse.headers.get('content-disposition') || '', /attachment/);
  const midiCalls = fakeSpawn.calls.slice(callsBeforeMidi);
  assert.ok(midiCalls.some(c => c.args.includes('muscriptor')), 'expected a --family muscriptor invocation');
  assert.ok(midiCalls.some(c => c.engine === 'ffmpeg'), 'expected ffmpeg to normalize the source audio first');
  assert.ok(midiCalls.some(c => c.args.includes('--text-out')), 'expected a --text-out request alongside --out');

  // the cached <song>.notes.json now sits next to the .mid in the music folder -- the project-list
  // scan must not mistake it for a project descriptor (it has no .title, only a bare notes array)
  const projectsAfterMidi = await callJson('/api/projects');
  assert.ok(projectsAfterMidi.data.every(p => typeof p.title === 'string'), 'expected every listed project to have a title (the .notes.json cache file must be excluded from the scan)');

  // second request hits the cache: no new muscriptor/ffmpeg calls
  const callsBeforeCached = fakeSpawn.calls.length;
  const cachedResponse = await call(`/api/projects/${songId}/midi`);
  assert.equal(cachedResponse.status, 200);
  assert.equal(fakeSpawn.calls.length, callsBeforeCached, 'expected the cached .mid to be served without re-running MuScriptor');

  // notes are parsed from the paired start/end events into a flat {id, pitch, start, end, instrument}[]
  const notesResponse = await callJson(`/api/projects/${songId}/midi/notes`);
  assert.equal(notesResponse.status, 200);
  assert.equal(notesResponse.data.notes.length, 2);
  assert.deepEqual(notesResponse.data.notes[0], { id: 0, pitch: 60, start: 0, end: 0.5, instrument: 'acoustic_piano' });
  assert.equal(fakeSpawn.calls.length, callsBeforeCached, 'expected notes to be served from the cached .notes.json, not regenerated');

  // editing and saving overwrites the cached .mid/.notes.json without touching MuScriptor
  const edited = [{ pitch: 67, start: 0, end: 1, instrument: 'acoustic_piano' }];
  const callsBeforeSave = fakeSpawn.calls.length;
  const saveResponse = await callJson(`/api/projects/${songId}/midi`, 'POST', { notes: edited });
  assert.equal(saveResponse.status, 200);
  assert.equal(fakeSpawn.calls.length, callsBeforeSave, 'saving is a pure re-encode, no engine invocation');
  const afterSave = await callJson(`/api/projects/${songId}/midi/notes`);
  assert.equal(afterSave.data.notes.length, 1);
  assert.equal(afterSave.data.notes[0].pitch, 67);
  const savedMidiResponse = await call(`/api/projects/${songId}/midi`);
  const savedMidiBytes = Buffer.from(await savedMidiResponse.arrayBuffer());
  assert.equal(savedMidiBytes.subarray(0, 4).toString('ascii'), 'MThd', 'expected a valid re-encoded Standard MIDI File header');

  // an invalid note (end <= start) is rejected with a clear 400
  const invalidSave = await callJson(`/api/projects/${songId}/midi`, 'POST', { notes: [{ pitch: 60, start: 1, end: 1 }] });
  assert.equal(invalidSave.status, 400);

  // "다운로드" is independent of "저장": it renders whatever note array the request sends right now
  // (possibly unsaved edits) and never touches the cached .mid/.notes.json -- so it must NOT just
  // re-serve whatever was last saved (the cache currently holds the single pitch-67 note from above).
  const unsavedEdit = [{ pitch: 40, start: 0, end: 2, instrument: 'electric_bass' }, { pitch: 44, start: 2, end: 4, instrument: 'electric_bass' }];
  const rendered = await call(`/api/projects/${songId}/midi/render`, 'POST', { notes: unsavedEdit });
  assert.equal(rendered.status, 200);
  assert.equal(rendered.headers.get('content-type'), 'audio/midi');
  assert.match(rendered.headers.get('content-disposition') || '', /attachment/);
  const renderedBytes = Buffer.from(await rendered.arrayBuffer());
  assert.equal(renderedBytes.subarray(0, 4).toString('ascii'), 'MThd', 'expected a valid Standard MIDI File header');
  const cachedStillHasSavedEdit = await callJson(`/api/projects/${songId}/midi/notes`);
  assert.equal(cachedStillHasSavedEdit.data.notes.length, 1, 'render must not overwrite the cached .notes.json with the unsaved notes it was just asked to encode');
  assert.equal(fakeSpawn.calls.length, callsBeforeSave, 'render is a pure client-side-driven encode, no engine invocation');

  // "다운로드"(브라우저 저장 대화상자 미지원 시 폴백) also renders the notes it's given, not the cache
  const savedToDefault = await callJson(`/api/projects/${songId}/midi/save-to-folder`, 'POST', { filename: 'my-export', notes: unsavedEdit });
  assert.equal(savedToDefault.status, 200);
  assert.equal(savedToDefault.data.filename, 'my-export.mid');
  const defaultBytes = await readFile(path.join(root, 'library', 'midi', 'my-export.mid'));
  assert.equal(defaultBytes.subarray(0, 4).toString('ascii'), 'MThd', 'expected the file written into library/midi to be a valid Standard MIDI File');
  assert.equal(defaultBytes.length, renderedBytes.length, 'expected save-to-folder to encode the same unsaved notes as /midi/render, not the cached file');

  const savedToCustomFolder = await callJson(`/api/projects/${songId}/midi/save-to-folder`, 'POST', { folder: 'custom-midi-out', filename: 'renamed', notes: unsavedEdit });
  assert.equal(savedToCustomFolder.status, 200);
  assert.equal(savedToCustomFolder.data.filename, 'renamed.mid');
  await readFile(path.join(root, 'custom-midi-out', 'renamed.mid')); // throws if missing

  assert.equal((await call(`/api/projects/${draft.id}/midi/save-to-folder`, 'POST', { filename: 'x', notes: unsavedEdit })).status, 404);
  assert.equal((await call(`/api/projects/${draft.id}/midi/render`, 'POST', { notes: unsavedEdit })).status, 404);

  // missing MuScriptor model is a clear 400, not a crash (delete the cached .mid first so it can't just be re-served)
  await rm(muscriptorModel);
  const cachedMidiPath = path.join(root, 'library', 'music', path.basename(generated.data.audioPath, path.extname(generated.data.audioPath)) + '.mid');
  await rm(cachedMidiPath).catch(() => {});
  const noModel = await callJson(`/api/projects/${songId}/midi`);
  assert.equal(noModel.status, 400);
  assert.match(noModel.data.error, /MuScriptor/);
});

test('음색 변조 - 기존 방식(Seed-VC) 탭: prepare가 원본을 한 번만 분리해두고, apply는 그 캐시를 재사용해 변환(음량 매칭 포함)하며, 저장은 범용 /api/audio-save로 끝난다', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-vocaltimbre-'));
  const { enginePath } = await setUpEngine(root);
  const seedVcModel = path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf', 'SeedVC-MLX-GGUF', 'seed-vc-mlx-q8_0.gguf');
  await mkdir(path.dirname(seedVcModel), { recursive: true });
  await writeFile(seedVcModel, 'stub');
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath });
  const sourceDataUrl = `data:audio/wav;base64,${Buffer.from('fake-source-song').toString('base64')}`;
  const voiceRefDataUrl = `data:audio/wav;base64,${Buffer.from('fake-target-voice').toString('base64')}`;

  // 라이브러리에서 자유롭게 고른 "원본 audio" 준비: 프로젝트 없이 바로 소스 오디오만으로 분리까지 끝낸다
  const prepared = await callJson('/api/timbre-transform/prepare', 'POST', { sourceDataUrl });
  assert.equal(prepared.status, 200);
  const previewId = prepared.data.previewId;
  assert.ok(fakeSpawn.calls.some(c => c.args.includes('mel_band_roformer')), 'expected prepare itself to run the vocals/instrumental STEM split');

  // stems and the original audio are already servable right after prepare, before any apply
  const vocalsAfterPrepare = await call(`/api/timbre-transform/${previewId}/stems/vocals`);
  assert.equal(vocalsAfterPrepare.status, 200);
  assert.equal(vocalsAfterPrepare.headers.get('content-type'), 'audio/wav');
  assert.equal((await call(`/api/timbre-transform/${previewId}/stems/instrumental`)).status, 200);
  assert.equal((await call(`/api/timbre-transform/${previewId}/audio`)).status, 200);

  // "적용": converts the already-separated vocal -- apply itself never re-runs STEM separation
  const callsBeforeApply = fakeSpawn.calls.length;
  const firstApply = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl, seedF0Condition: false, seedAutoF0Adjust: false, seedInferenceSteps: 42 });
  assert.equal(firstApply.status, 200);
  const applyCalls = fakeSpawn.calls.slice(callsBeforeApply);
  assert.ok(!applyCalls.some(c => c.args.includes('mel_band_roformer')), 'expected apply to reuse the STEM split done during prepare, not re-run it');
  assert.ok(applyCalls.some(c => c.args.includes('seed_vc')), 'expected a --family seed_vc invocation');
  assert.ok(applyCalls.some(c => c.args.includes('--voice-ref')), 'expected the reference clip to be passed as --voice-ref');
  const seedCall = applyCalls.find(c => c.args.includes('seed_vc'));
  assert.ok(seedCall.args.includes('f0_condition=false'));
  assert.ok(seedCall.args.includes('auto_f0_adjust=false'));
  assert.ok(seedCall.args.includes('num_inference_steps=42'));
  assert.ok(!applyCalls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => arg.includes('amix'))), 'remixing now happens client-side (mixBuffers), not via a server-side amix');

  // the silence-gate fix (2026-09-17): both Seed-VC and Vevo2 were found to keep generating audible
  // content through passages where the source vocal is true digital silence, instead of staying
  // silent themselves -- a sidechain noise gate keyed off the pre-conversion vocal forces the
  // converted output silent wherever the source actually is.
  const gateCall = applyCalls.find(c => c.engine === 'ffmpeg' && c.args.some(arg => typeof arg === 'string' && arg.includes('sidechaingate')));
  assert.ok(gateCall, 'expected a sidechaingate pass to clean up hallucinated content in silent passages');
  assert.ok(gateCall.args.some(arg => typeof arg === 'string' && arg.includes('vocals-original.wav')), 'expected the pre-conversion vocal to be used as the sidechain reference');

  // the loudness-matching fix: after conversion, both the pre-conversion and converted vocal are
  // probed with ffmpeg volumedetect, and a clamped gain-correction pass (ffmpeg -af volume=XdB) is
  // applied before the result becomes the servable vocals.wav -- this is the fix for the real bug
  // where Seed-VC's raw output measured ~8dB quieter and the vocal was inaudible once mixed in.
  const volumeProbeCalls = applyCalls.filter(c => c.engine === 'ffmpeg' && c.args.includes('volumedetect'));
  assert.equal(volumeProbeCalls.length, 2, 'expected the original and converted vocal to each be probed once');
  const gainCall = applyCalls.find(c => c.engine === 'ffmpeg' && c.args.some(arg => typeof arg === 'string' && arg.startsWith('volume=')));
  assert.ok(gainCall, 'expected a gain-correction pass on the converted vocal');
  const gainArg = gainCall.args.find(arg => typeof arg === 'string' && arg.startsWith('volume='));
  assert.match(gainArg, /^volume=-?[\d.]+dB,alimiter=limit=0\.97:level=false$/, 'expected the gain boost to be paired with a peak limiter so it cannot introduce new clipping');
  const gainDb = Number(gainArg.match(/^volume=(-?[\d.]+)dB/)[1]);
  assert.ok(gainDb > 0, `expected a positive boost since the fake converted vocal (-34dB) is quieter than the original (-26.4dB), got ${gainDb}dB`);
  assert.ok(gainDb <= 18, 'expected the gain correction to be clamped');

  // the resulting vocals stem (loudness-matched) and the untouched instrumental stem are both still servable
  const vocalsResponse = await call(`/api/timbre-transform/${previewId}/stems/vocals`);
  assert.equal(vocalsResponse.status, 200);
  assert.equal((await call(`/api/timbre-transform/${previewId}/stems/instrumental`)).status, 200);

  // re-apply with a different reference: reconverts from the cached pre-conversion vocals, still no re-separation
  const callsBeforeReapply = fakeSpawn.calls.length;
  const secondApply = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl });
  assert.equal(secondApply.status, 200);
  const reapplyCalls = fakeSpawn.calls.slice(callsBeforeReapply);
  assert.ok(!reapplyCalls.some(c => c.args.includes('mel_band_roformer')), 'expected re-apply to skip STEM separation and reuse the cached pre-conversion vocals');
  assert.ok(reapplyCalls.some(c => c.args.includes('seed_vc')), 'expected re-apply to still run a fresh seed_vc conversion');

  // "저장": the frontend mixes vocals+instrumental client-side (Web Audio) and uploads the result via
  // the generic, project-independent /api/audio-save (same route AuK/DDSP-SVC/음원비교 already use)
  const mixedWavDataUrl = `data:audio/wav;base64,${Buffer.from('client-mixed-wav-bytes').toString('base64')}`;
  const saved = await callJson('/api/audio-save', 'POST', { dataUrl: mixedWavDataUrl, title: '음색 변환됨' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.status, 'completed');
  assert.equal(saved.data.title, '음색 변환됨');
  assert.equal(saved.data.durationMs, 97500, 'saved song must carry a measured duration for card view (2026-09-17 bug)');

  // bad dataUrl / an unknown previewId are clear errors, not crashes
  assert.equal((await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: 'not-a-data-url' })).status, 400);
  assert.equal((await callJson('/api/timbre-transform/not-a-real-preview-id/legacy/apply', 'POST', { dataUrl: voiceRefDataUrl })).status, 404);

  // missing model is a clear 400 on apply, not a crash
  await rm(seedVcModel);
  const noModel = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl });
  assert.equal(noModel.status, 400);
  assert.match(noModel.data.error, /Seed-VC/);
});

test('음색 변조 - 참조 보컬: 참조 오디오를 mel_band_roformer로 분리해 vocals dataUrl을 돌려준다 (오디오 없음 400)', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-timbre-ref-vocal-'));
  const { enginePath } = await setUpEngine(root);
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath });

  const missing = await callJson('/api/timbre-transform/reference/separate', 'POST', {});
  assert.equal(missing.status, 400);

  const referenceDataUrl = `data:audio/wav;base64,${Buffer.from('fake-reference-song').toString('base64')}`;
  const result = await callJson('/api/timbre-transform/reference/separate', 'POST', { referenceDataUrl });
  assert.equal(result.status, 200);
  assert.match(result.data.vocalsDataUrl, /^data:audio\/wav;base64,/);
  assert.ok(fakeSpawn.calls.some(c => c.args.includes('mel_band_roformer')), 'expected the reference to be STEM-split with mel_band_roformer');
  assert.ok(!fakeSpawn.calls.some(c => c.args.includes('seed_vc')), 'expected reference separation to never run a Seed-VC conversion');
});

test('음색 변조 - 기존 방식: engine:\'vevo2\'를 보내면 Seed-VC 대신 Vevo2(style_preserved_svc)로 변환하고, 모델이 없으면 Seed-VC와 무관하게 Vevo2 전용 에러를 준다', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-vevo2-'));
  const { enginePath } = await setUpEngine(root);
  const vevo2Model = path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf', 'Vevo2-GGUF', 'vevo2-q8_0.gguf');
  await mkdir(path.dirname(vevo2Model), { recursive: true });
  await writeFile(vevo2Model, 'stub');
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath });
  const sourceDataUrl = `data:audio/wav;base64,${Buffer.from('fake-source-song').toString('base64')}`;
  const voiceRefDataUrl = `data:audio/wav;base64,${Buffer.from('fake-target-voice').toString('base64')}`;
  const previewId = (await callJson('/api/timbre-transform/prepare', 'POST', { sourceDataUrl })).data.previewId;

  // note: the Seed-VC model is never written in this test -- if applyVocalTimbreCore() checked for it
  // regardless of the requested engine, this would fail with a Seed-VC-model-missing 400 instead.
  const applied = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl, engine: 'vevo2' });
  assert.equal(applied.status, 200);
  const vevo2Call = fakeSpawn.calls.find(c => c.args.includes('vevo2'));
  assert.ok(vevo2Call, 'expected a --family vevo2 invocation');
  assert.ok(vevo2Call.args.includes('style_preserved_svc'), 'expected the style_preserved_svc route (vevo2\'s default svc route)');
  assert.ok(vevo2Call.args.includes('--source-audio'), 'vevo2 takes the source clip as --source-audio, not --audio like seed_vc');
  assert.ok(vevo2Call.args.includes('--target-voice'), 'vevo2 takes the reference clip as --target-voice, not --voice-ref like seed_vc');
  assert.ok(!fakeSpawn.calls.some(c => c.args.includes('seed_vc')), 'expected engine:\'vevo2\' to never invoke seed_vc');
  // the silence-gate fix applies to both engines, not just the default seed_vc path
  assert.ok(fakeSpawn.calls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => typeof arg === 'string' && arg.includes('sidechaingate'))), 'expected the silence gate to also run for the vevo2 path');

  const callsBeforeVcRoute = fakeSpawn.calls.length;
  const vcRoute = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl, engine: 'vevo2', vevoRoute: 'style_preserved_vc' });
  assert.equal(vcRoute.status, 200);
  const vcCall = fakeSpawn.calls.slice(callsBeforeVcRoute).find(c => c.args.includes('vevo2'));
  assert.ok(vcCall.args.includes('style_preserved_vc'));
  assert.equal(vcCall.args[vcCall.args.indexOf('--task') + 1], 'vc');

  // an unrecognized/omitted engine value falls back to seed_vc, not an error
  const unknownEngine = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl, engine: 'not-a-real-engine' });
  assert.equal(unknownEngine.status, 400);
  assert.match(unknownEngine.data.error, /Seed-VC/, 'expected an unrecognized engine value to fall back to seed_vc (whose model is missing here), not crash');

  // missing vevo2 model is a clear, vevo2-specific 400 -- independent of whether seed_vc's model exists
  await rm(vevo2Model);
  const noModel = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl, engine: 'vevo2' });
  assert.equal(noModel.status, 400);
  assert.match(noModel.data.error, /Vevo2/);
});

test('음색 변조 - 기존 방식: 긴 보컬은 Seed-VC도 10초 창(겹침 2초)으로 나눠 같은 참조 목소리로 변환하고 연결한다(AuK와 동일 패턴, 긴 소스 붕괴 회피)', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-timbre-legacy-chunk-'));
  const { enginePath } = await setUpEngine(root);
  const seedVcModel = path.join(root, 'models', 'audio-cpp', 'audio.cpp-gguf', 'SeedVC-MLX-GGUF', 'seed-vc-mlx-q8_0.gguf');
  await mkdir(path.dirname(seedVcModel), { recursive: true });
  await writeFile(seedVcModel, 'stub');
  const fakeSpawn = makeFakeSpawn();
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath });
  const sourceDataUrl = `data:audio/wav;base64,${Buffer.from('fake-source-song').toString('base64')}`;
  const voiceRefDataUrl = `data:audio/wav;base64,${Buffer.from('fake-target-voice').toString('base64')}`;
  const previewId = (await callJson('/api/timbre-transform/prepare', 'POST', { sourceDataUrl })).data.previewId;
  fakeSpawn.setProbe({ durationSeconds: '26' });

  const callsBeforeApply = fakeSpawn.calls.length;
  const applied = await callJson(`/api/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl: voiceRefDataUrl });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.chunkCount, 3);
  assert.match(applied.data.warning, /10초 단위.*3개/);
  const applyCalls = fakeSpawn.calls.slice(callsBeforeApply);
  const seedCalls = applyCalls.filter(c => c.args.includes('seed_vc'));
  assert.equal(seedCalls.length, 3, 'expected one Seed-VC run per 10s chunk, never on the whole 26s vocal at once');
  for (const seedCall of seedCalls) {
    assert.ok(seedCall.args.some(arg => String(arg).includes('voice-ref-normalized.wav')), 'expected every chunk to reuse the SAME normalized reference clip');
    assert.ok(!seedCall.args.some(arg => String(arg).includes('vocals-original.wav')), 'a chunk source, not the full vocal, is what goes through Seed-VC');
  }
  const chunkArgs = applyCalls.filter(c => c.engine === 'ffmpeg').flatMap(c => c.args).map(String);
  assert.ok(chunkArgs.some(arg => arg.includes('atrim=start=0.000:duration=10.000')));
  assert.ok(chunkArgs.some(arg => arg.includes('atrim=start=8.000:duration=10.000')));
  assert.ok(chunkArgs.some(arg => arg.includes('atrim=start=16.000:duration=10.000')));
  assert.ok(chunkArgs.some(arg => arg.includes('concat=n=3:v=0:a=1')));
  // the shared loudness-match + sidechain silence gate still runs on the stitched result
  assert.ok(applyCalls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => typeof arg === 'string' && arg.includes('sidechaingate'))), 'expected the shared post-processing chain on the concatenated vocal too');
  assert.ok(applyCalls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => typeof arg === 'string' && arg.startsWith('volume='))), 'expected the shared gain-correction pass on the concatenated vocal');
});

function makeFakeAudioAuk() {
  const calls = [];
  const jobs = new Map();
  const audio = new Map();
  let counter = 1;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const method = (options.method || 'GET').toUpperCase();
    calls.push({ pathname: parsed.pathname, method, body: options.body });
    if (parsed.pathname === '/api/health') return Response.json({ status: 'ok', engine: { connected: true } });
    if (parsed.pathname === '/api/settings' && method === 'PUT') return Response.json(JSON.parse(options.body));
    if (parsed.pathname === '/api/audio' && method === 'POST') {
      const id = `audio-${counter++}.wav`;
      return new Response(JSON.stringify({ id, name: id, url: `/api/audio/${id}`, kind: 'source' }), { status: 201 });
    }
    if (parsed.pathname === '/api/transcribe' && method === 'POST') {
      const id = `job-stt-${counter++}`;
      jobs.set(id, { id, task: 'stt', status: 'completed', transcript: '가짜로 인식된 가사입니다' });
      return new Response(JSON.stringify({ id, status: 'queued' }), { status: 201 });
    }
    if (parsed.pathname === '/api/jobs' && method === 'POST') {
      const id = `job-tts-${counter++}`;
      const resultId = `result-${counter++}.flac`;
      audio.set(resultId, Buffer.from('fake-auk-converted-bytes'));
      jobs.set(id, { id, task: 'tts', status: 'completed', outputUrl: `/api/audio/${resultId}`, instruction: JSON.parse(options.body).instruction });
      return new Response(JSON.stringify({ id, status: 'queued' }), { status: 201 });
    }
    if (parsed.pathname === '/api/jobs' && method === 'GET') return Response.json([...jobs.values()]);
    if (parsed.pathname.startsWith('/api/audio/') && method === 'GET') {
      const id = parsed.pathname.slice('/api/audio/'.length);
      const bytes = audio.get(id);
      if (!bytes) return new Response(null, { status: 404 });
      return new Response(bytes, { status: 200 });
    }
    return new Response(JSON.stringify({ error: `unhandled AudioAuK route: ${method} ${parsed.pathname}` }), { status: 404 });
  };
  return { fetchImpl, calls, jobs };
}

test('음색 변조 - AuK 탭: 레퍼런스만 있으면 소스를 전사해 그 목소리로 clone하고, 텍스트만 있으면 change-timbre로, 둘 다 없으면 400, Flash/Base 체크포인트가 설정에 반영된다', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-timbre-auk-'));
  const { enginePath } = await setUpEngine(root);
  const fakeSpawn = makeFakeSpawn();
  const auk = makeFakeAudioAuk();
  const server = await createStudioServer({ root, fetchImpl: auk.fetchImpl, spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath, audioAukEndpoint: 'http://fake-auk.local' });
  const sourceDataUrl = `data:audio/wav;base64,${Buffer.from('fake-source-song').toString('base64')}`;
  const previewId = (await callJson('/api/timbre-transform/prepare', 'POST', { sourceDataUrl })).data.previewId;
  assert.ok(fakeSpawn.calls.some(c => c.args.includes('mel_band_roformer')), 'expected prepare to separate the source once, up front');
  fakeSpawn.setProbe({ durationSeconds: '9.5' });

  // neither reference nor text description: clear 400, no AudioAuK calls made
  const neither = await callJson(`/api/timbre-transform/${previewId}/auk/apply`, 'POST', { checkpoint: 'flash' });
  assert.equal(neither.status, 400);
  assert.match(neither.data.error, /레퍼런스 오디오나 음색 설명/);
  assert.equal(auk.calls.length, 0, 'expected no AudioAuK HTTP calls before validation passes');

  // text description only: uses the change-timbre shape (audio = source vocal, not a reference)
  const callsBeforeText = fakeSpawn.calls.length;
  const textOnly = await callJson(`/api/timbre-transform/${previewId}/auk/apply`, 'POST', { textDescription: '따뜻하고 부드러운 남성 재즈 보컬', checkpoint: 'base', modelVariant: 'bf16', textEncoder: 'int8', vae: 'auk' });
  assert.equal(textOnly.status, 200);
  assert.equal(textOnly.data.transcript, null, 'change-timbre shape does not transcribe anything');
  assert.ok(!fakeSpawn.calls.slice(callsBeforeText).some(c => c.args.includes('mel_band_roformer')), 'expected apply to reuse the STEM split done during prepare, not re-run it');
  const settingsCallText = auk.calls.find(c => c.pathname === '/api/settings' && c.method === 'PUT');
  assert.deepEqual(JSON.parse(settingsCallText.body).engine, { model: 'auk_base_bf16.safetensors', encoder: 'qwen_omni_int8.safetensors', vae: 'auk_vae.safetensors', precision: 'auto' }, 'expected every selected AuK component to reach AudioAuK');
  const ttsJobCallText = auk.calls.filter(c => c.pathname === '/api/jobs' && c.method === 'POST').at(-1);
  const ttsBodyText = JSON.parse(ttsJobCallText.body);
  assert.match(ttsBodyText.instruction, /Keep the lyrics, melody, phrasing and rhythm unchanged and change the timbre to: "따뜻하고 부드러운 남성 재즈 보컬"\./);
  assert.equal(ttsBodyText.steps, 32);
  assert.equal(ttsBodyText.guidance, 0.7);
  assert.ok(!auk.calls.some(c => c.pathname === '/api/transcribe'), 'expected no transcription step when only a text description is given');

  // reference only: transcribes the source vocal, then clones the reference's voice reciting that transcript
  const referenceDataUrl = `data:audio/wav;base64,${Buffer.from('fake-reference-voice').toString('base64')}`;
  const refOnly = await callJson(`/api/timbre-transform/${previewId}/auk/apply`, 'POST', { referenceDataUrl, checkpoint: 'flash' });
  assert.equal(refOnly.status, 200);
  assert.equal(refOnly.data.transcript, '가짜로 인식된 가사입니다');
  assert.ok(auk.calls.some(c => c.pathname === '/api/transcribe' && c.method === 'POST'), 'expected a transcription step when a reference clip is given');
  const settingsCallRef = auk.calls.filter(c => c.pathname === '/api/settings' && c.method === 'PUT').at(-1);
  assert.equal(JSON.parse(settingsCallRef.body).engine.model, 'auk_flash_bf16.safetensors', 'expected the "flash" checkpoint choice to reach AudioAuK');
  const ttsJobCallRef = auk.calls.filter(c => c.pathname === '/api/jobs' && c.method === 'POST').at(-1);
  const ttsBodyRef = JSON.parse(ttsJobCallRef.body);
  assert.match(ttsBodyRef.instruction, /^다음 내용을 같은 목소리로 읽어 주세요: "가짜로 인식된 가사입니다"\.$/);
  assert.equal(ttsBodyRef.steps, 4);
  assert.equal(ttsBodyRef.guidance, 0);

  // both reference and text: clone the reference's voice, but fold the text in as a style qualifier
  const both = await callJson(`/api/timbre-transform/${previewId}/auk/apply`, 'POST', { referenceDataUrl, textDescription: 'warm and smooth', checkpoint: 'flash' });
  assert.equal(both.status, 200);
  const ttsJobCallBoth = auk.calls.filter(c => c.pathname === '/api/jobs' && c.method === 'POST').at(-1);
  const ttsBodyBoth = JSON.parse(ttsJobCallBoth.body);
  assert.match(ttsBodyBoth.instruction, /^다음 내용을 읽어 주세요: "가짜로 인식된 가사입니다"\. 목소리 설명: warm and smooth\.$/);

  // 앱에서 만든 저장곡이면: json에 그대로 있던 가사를 쓰고 Whisper STT 단계를 건너뛴다. AuK의
  // instruction에는 [Verse]/[Chorus] 같은 구간 표기를 제거해 넘기고, 응답 transcript는 그대로 남긴다.
  const callsBeforeLyrics = auk.calls.length;
  const storedLyrics = '[Verse]\n낮은 목소리로 부른 원곡 가사\n[Chorus]\n후렴은 크게';
  const withLyrics = await callJson(`/api/timbre-transform/${previewId}/auk/apply`, 'POST', { referenceDataUrl, lyrics: storedLyrics, checkpoint: 'flash' });
  assert.equal(withLyrics.status, 200);
  assert.equal(withLyrics.data.transcript, storedLyrics, 'expected the display transcript to be the untouched stored lyrics');
  assert.ok(!auk.calls.slice(callsBeforeLyrics).some(c => c.pathname === '/api/transcribe'), 'expected stored lyrics to skip the Whisper STT step entirely');
  const ttsJobCallLyrics = auk.calls.filter(c => c.pathname === '/api/jobs' && c.method === 'POST').at(-1);
  const ttsBodyLyrics = JSON.parse(ttsJobCallLyrics.body);
  assert.match(ttsBodyLyrics.instruction, /^다음 내용을 같은 목소리로 읽어 주세요: "낮은 목소리로 부른 원곡 가사 후렴은 크게"\.$/);

  // Long text-only timbre edits are split into overlapping 10-second windows. With a 26-second
  // source the plan is 0-10, 8-18, 16-26. The first tail and following head each lose one second,
  // producing contiguous 0-9, 9-17, 17-26 output without sending a long clip to AuK.
  fakeSpawn.setProbe({ durationSeconds: '26' });
  const callsBeforeChunking = auk.calls.length;
  const spawnsBeforeChunking = fakeSpawn.calls.length;
  const chunked = await callJson(`/api/timbre-transform/${previewId}/auk/apply`, 'POST', { textDescription: '따뜻하고 중후한 남성', checkpoint: 'flash' });
  assert.equal(chunked.status, 200);
  assert.equal(chunked.data.chunkCount, 3);
  assert.match(chunked.data.warning, /10초 단위.*3개/);
  const chunkJobBodies = auk.calls.slice(callsBeforeChunking)
    .filter(c => c.pathname === '/api/jobs' && c.method === 'POST')
    .map(c => JSON.parse(c.body));
  assert.equal(chunkJobBodies.length, 3, 'expected one AuK job per overlapping source chunk');
  assert.equal(new Set(chunkJobBodies.map(body => body.seed)).size, 1, 'expected every chunk to share one seed for consistent timbre');
  const chunkFfmpegArgs = fakeSpawn.calls.slice(spawnsBeforeChunking).filter(c => c.engine === 'ffmpeg').flatMap(c => c.args);
  assert.ok(chunkFfmpegArgs.some(arg => String(arg).includes('atrim=start=0.000:duration=10.000')));
  assert.ok(chunkFfmpegArgs.some(arg => String(arg).includes('atrim=start=8.000:duration=10.000')));
  assert.ok(chunkFfmpegArgs.some(arg => String(arg).includes('atrim=start=16.000:duration=10.000')));
  assert.ok(chunkFfmpegArgs.some(arg => String(arg).includes('atrim=start=0.000:end=9.000')));
  assert.ok(chunkFfmpegArgs.some(arg => String(arg).includes('atrim=start=1.000:end=9.000')));
  assert.ok(chunkFfmpegArgs.some(arg => String(arg).includes('atrim=start=1.000,asetpts=PTS-STARTPTS')));
  assert.ok(chunkFfmpegArgs.some(arg => String(arg).includes('concat=n=3:v=0:a=1')));

  // the sidechain silence-gate (shared postProcessConvertedVocal helper) still runs on AuK's output, same as Seed-VC/Vevo2
  assert.ok(fakeSpawn.calls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => typeof arg === 'string' && arg.includes('sidechaingate'))), 'expected the shared post-processing chain to run on the AuK result too');

  // an unknown previewId is a clear 404, not a crash
  assert.equal((await callJson('/api/timbre-transform/not-a-real-preview-id/auk/apply', 'POST', { textDescription: 'x' })).status, 404);
});

async function setUpDdspSvcRoot(root) {
  const ddspSvcRoot = path.join(root, 'ddsp-svc-root');
  await mkdir(path.join(ddspSvcRoot, '.venv', 'Scripts'), { recursive: true });
  await writeFile(path.join(ddspSvcRoot, '.venv', 'Scripts', 'python.exe'), 'stub');
  await mkdir(path.join(ddspSvcRoot, 'configs'), { recursive: true });
  await writeFile(path.join(ddspSvcRoot, 'configs', 'reflow.yaml'), [
    'data:', '  f0_extractor: \'rmvpe\'', '  encoder: \'contentvec768l12tta2x\'', '  encoder_hop_size: 160', '  encoder_out_channels: 768', '  encoder_ckpt: pretrain/contentvec/pytorch_model.bin', '  train_path: data/train', '  valid_path: data/val',
    'model:', '  type: \'RectifiedFlow\'',
    'vocoder:', '  type: \'nsf-hifigan\'', '  ckpt: \'pretrain/nsf_hifigan/model\'',
    'env:', '  expdir: exp/reflow-test', '  gpu_id: 0',
    'train:', '  epochs: 100000', '  interval_log: 1', '  interval_val: 2000', '  interval_force_save: 10000',
  ].join('\n'));
  return ddspSvcRoot;
}

// Simulates train_reflow.py emitting one "step: N | loss: X" stdout line per simulated step, and
// (like the real process) stops emitting once its own child.kill() is invoked -- this is what lets
// the test assert the kill-at-target-step mechanism actually fires instead of running past target,
// which is the exact regression (~4h training runaway) this whole DDSP-SVC integration must not repeat.
// Checkpoints are only written every `interval_val` steps (read from the job's own patched config,
// same as the real solver.py) rather than every step -- this is what lets the test also catch the
// separate checkpoint-cadence regression (2026-09-19): the template's own interval_val (2000) never
// saves a checkpoint before a small targetStep is reached, so a naive mock that checkpoints on a
// fixed small cadence would never have exposed that bug.
function makeFakeDdspSpawn({ finalStep = 260 } = {}) {
  const calls = [];
  let killCount = 0;
  const spawnImpl = (engine, args, options = {}) => {
    calls.push({ engine, args, cwd: options.cwd });
    const emitter = new EventEmitter();
    emitter.stdout = new EventEmitter();
    emitter.stderr = new EventEmitter();
    // killCount is a running total across every child this mock ever spawns (used by the "killed
    // exactly once" assertion right after the first training job), but the loop guard below must
    // check THIS child's own kill state, not the shared total -- otherwise a later job's training
    // loop sees an earlier job's kill already counted and returns before emitting anything, hanging
    // ddsp-svc.mjs's await forever since no 'close' event ever follows.
    emitter.kill = () => { killCount += 1; emitter._killed = true; emitter.emit('close', null, 'SIGTERM'); };
    if (engine === 'ffprobe') {
      (async () => { await new Promise(resolve => setTimeout(resolve, 0)); emitter.stdout.emit('data', Buffer.from('12.0')); emitter.emit('close', 0, null); })();
      return emitter;
    }
    if (engine === 'ffmpeg') {
      if (args.includes('volumedetect')) {
        (async () => { await new Promise(resolve => setTimeout(resolve, 0)); emitter.stderr.emit('data', Buffer.from('[Parsed_volumedetect_0 @ 0x0] mean_volume: -30 dB\n')); emitter.emit('close', 0, null); })();
        return emitter;
      }
      const outPath = args[args.length - 1];
      (async () => { await new Promise(resolve => setTimeout(resolve, 0)); await writeFile(outPath, Buffer.from('fake-gated-bytes')); emitter.emit('close', 0, null); })();
      return emitter;
    }
    const script = args[0];
    const cwd = options.cwd;
    const configArg = args[args.indexOf('-c') + 1];
    if (script === 'preprocess.py') {
      (async () => { await new Promise(resolve => setTimeout(resolve, 0)); emitter.emit('close', 0, null); })();
      return emitter;
    }
    if (script === 'train_reflow.py') {
      (async () => {
        const configText = await readFile(path.join(cwd, configArg), 'utf8');
        const expdir = configText.match(/expdir:\s*(\S+)/)[1];
        const intervalValMatch = configText.match(/interval_val:\s*(\d+)/);
        const intervalVal = intervalValMatch ? Number(intervalValMatch[1]) : 2000; // matches solver.py's own default
        const expDir = path.join(cwd, expdir);
        await mkdir(expDir, { recursive: true });
        for (let step = 1; step <= finalStep; step += 1) {
          if (emitter._killed) return; // real train_reflow.py would already be dead
          if (step % intervalVal === 0) await writeFile(path.join(expDir, `model_${step}.pt`), Buffer.from(`fake-checkpoint-${step}`));
          emitter.stdout.emit('data', Buffer.from(`epoch: 1 | 0/1 | ${expdir} | batch/s: 8.0 | lr: 0.0005 | loss: 0.5 | time: 0:00:01 | step: ${step}\n`));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        // simulates the real process eventually finishing on its own if never killed (shouldn't happen in this test)
        if (!emitter._killed) emitter.emit('close', 0, null);
      })();
      return emitter;
    }
    if (script === 'main_reflow.py') {
      const outPath = args[args.indexOf('-o') + 1];
      (async () => { await new Promise(resolve => setTimeout(resolve, 0)); await writeFile(outPath, Buffer.from('fake-converted-vocal')); emitter.emit('close', 0, null); })();
      return emitter;
    }
    (async () => { emitter.emit('close', 1, null); })();
    return emitter;
  };
  return { spawnImpl, calls, killCount: () => killCount };
}

test('Tools 메뉴 - AuK 작업: 완성곡과 무관하게 독립 오디오(선택)+지시문으로 실행하고, 결과를 dataUrl로 돌려준다(라이브러리 저장은 별도)', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-audio-tools-auk-'));
  const fakeSpawn = makeFakeSpawn();
  const auk = makeFakeAudioAuk();
  const server = await createStudioServer({ root, fetchImpl: auk.fetchImpl, spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { audioAukEndpoint: 'http://fake-auk.local' });

  // task/instruction 누락은 400, AudioAuK 호출 없음
  const missing = await callJson('/api/audio-tools/auk', 'POST', {});
  assert.equal(missing.status, 400);
  assert.equal(auk.calls.length, 0);

  // 텍스트 전용(오디오 없음) -- Voice description TTS: audioId 없이 잡 제출
  const ttsOnly = await callJson('/api/audio-tools/auk', 'POST', {
    task: 'tts', instruction: 'Generate speech based on the following description: "warm, clear voice". The content to speak is: "안녕하세요".', checkpoint: 'flash',
  });
  assert.equal(ttsOnly.status, 200);
  assert.match(ttsOnly.data.dataUrl, /^data:audio\/wav;base64,/);
  assert.ok(!auk.calls.some(c => c.pathname === '/api/audio' && c.method === 'POST'), 'expected no audio upload when no audioDataUrl is given');
  const ttsJobCall = auk.calls.filter(c => c.pathname === '/api/jobs' && c.method === 'POST').at(-1);
  const ttsBody = JSON.parse(ttsJobCall.body);
  assert.equal(ttsBody.audioId, undefined);
  assert.match(ttsBody.instruction, /warm, clear voice/);

  // 오디오+지시문 -- 예: Raise pitch: 오디오 업로드 후 audioId로 제출
  const audioDataUrl = `data:audio/wav;base64,${Buffer.from('fake-input-audio').toString('base64')}`;
  const withAudio = await callJson('/api/audio-tools/auk', 'POST', {
    task: 'tts', instruction: 'Raise the pitch by 2 semitones.', audioDataUrl, checkpoint: 'base',
  });
  assert.equal(withAudio.status, 200);
  assert.match(withAudio.data.dataUrl, /^data:audio\/wav;base64,/);
  assert.ok(auk.calls.some(c => c.pathname === '/api/audio' && c.method === 'POST'), 'expected an audio upload when audioDataUrl is given');
  const pitchJobCall = auk.calls.filter(c => c.pathname === '/api/jobs' && c.method === 'POST').at(-1);
  const pitchBody = JSON.parse(pitchJobCall.body);
  assert.ok(pitchBody.audioId, 'expected the uploaded audioId to be wired into the job');
  assert.match(pitchBody.instruction, /Raise the pitch by 2 semitones/);
  const settingsCall = auk.calls.filter(c => c.pathname === '/api/settings' && c.method === 'PUT').at(-1);
  assert.equal(JSON.parse(settingsCall.body).engine.model, 'auk_base_bf16.safetensors');

  // 긴 오디오+지시문(chunk:true)은 10초 창으로 나눠 각각 AuK 잡을 돌리고 이어붙인다 -- 결과는
  // 여전히 dataUrl, 환각 회피용 warning/chunkCount 포함. 참조 목소리나 시점 앵커가 필요한 도구는
  // 프론트가 chunk를 보내지 않으므로 이 경로는 "조각과 무관한 지시문" 전용이다.
  fakeSpawn.setProbe({ durationSeconds: '26' });
  const aukCallsBeforeChunk = auk.calls.length;
  const chunked = await callJson('/api/audio-tools/auk', 'POST', {
    task: 'tts', instruction: 'Remove the background noise, preserve everything else.', audioDataUrl, checkpoint: 'base', chunk: true,
  });
  assert.equal(chunked.status, 200);
  assert.equal(chunked.data.chunkCount, 3);
  assert.match(chunked.data.warning, /10초 단위.*3개/);
  assert.match(chunked.data.dataUrl, /^data:audio\/wav;base64,/);
  const chunkAudios = auk.calls.slice(aukCallsBeforeChunk).filter(c => c.pathname === '/api/audio' && c.method === 'POST');
  assert.equal(chunkAudios.length, 3, 'expected one AudioAuK audio upload per 10s source chunk');
  const chunkJobBodies = auk.calls.slice(aukCallsBeforeChunk).filter(c => c.pathname === '/api/jobs' && c.method === 'POST').map(c => JSON.parse(c.body));
  assert.equal(chunkJobBodies.length, 3, 'expected one AuK job per source chunk');
  assert.equal(new Set(chunkJobBodies.map(body => body.instruction)).size, 1, 'expected every chunk job to carry the same instruction');
  assert.ok(!auk.calls.slice(aukCallsBeforeChunk).filter(c => c.pathname === '/api/jobs' && c.method === 'POST').some(c => JSON.parse(c.body).instruction.includes('26s')), 'sanity: instruction is unchanged by chunking');
  const chunkFfmpegArgs = fakeSpawn.calls.filter(c => c.engine === 'ffmpeg').flatMap(c => c.args).map(String);
  assert.ok(chunkFfmpegArgs.some(arg => arg.includes('concat=n=3:v=0:a=1')), 'expected the three chunk results to be concatenated');
  // chunk:false(또는 누락)는 기존처럼 단일 잡 + 단일 업로드로 돌아간다
  const callsBeforeSingle = auk.calls.length;
  const chunkOff = await callJson('/api/audio-tools/auk', 'POST', {
    task: 'tts', instruction: 'Raise the pitch by 1 semitone.', audioDataUrl, checkpoint: 'base',
  });
  assert.equal(chunkOff.status, 200);
  assert.equal(chunkOff.data.chunkCount, undefined);
  assert.equal(auk.calls.slice(callsBeforeSingle).filter(c => c.pathname === '/api/audio' && c.method === 'POST').length, 1, 'expected exactly one upload when chunking is off');

  // 결과가 라이브러리에 자동 저장되지 않는다 -- 별도로 /api/audio-save를 호출해야 함
  const saved = await callJson('/api/audio-save', 'POST', { dataUrl: withAudio.data.dataUrl, title: 'Tools 결과' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.status, 'completed');
});

test('Tools 메뉴 - 전사: 오디오를 업로드해 Whisper STT로 전사하고 transcript를 돌려준다 (오디오 없음 400)', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-audio-tools-transcribe-'));
  const fakeSpawn = makeFakeSpawn();
  const auk = makeFakeAudioAuk();
  const server = await createStudioServer({ root, fetchImpl: auk.fetchImpl, spawnImpl: fakeSpawn.spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { audioAukEndpoint: 'http://fake-auk.local' });

  // 오디오 없음은 명확한 400, AudioAuK 호출 없음
  const missing = await callJson('/api/audio-tools/transcribe', 'POST', {});
  assert.equal(missing.status, 400);
  assert.ok(!auk.calls.some(c => c.pathname === '/api/transcribe'), 'expected no AudioAuK transcription call without audio');

  // 오디오를 업로드해 전사하고 transcript를 돌려준다 -- 결과 저장 없음
  const audioDataUrl = `data:audio/wav;base64,${Buffer.from('fake-edit-clip').toString('base64')}`;
  const result = await callJson('/api/audio-tools/transcribe', 'POST', { audioDataUrl, checkpoint: 'base' });
  assert.equal(result.status, 200);
  assert.equal(result.data.transcript, '가짜로 인식된 가사입니다');
  assert.ok(auk.calls.some(c => c.pathname === '/api/audio' && c.method === 'POST'), 'expected the audio to be uploaded to AudioAuK');
  assert.ok(auk.calls.some(c => c.pathname === '/api/transcribe' && c.method === 'POST'), 'expected a transcription job on AudioAuK');
  const settingsCall = auk.calls.filter(c => c.pathname === '/api/settings' && c.method === 'PUT').at(-1);
  assert.equal(JSON.parse(settingsCall.body).engine.model, 'auk_base_bf16.safetensors', 'expected the checkpoint choice to reach AudioAuK');
});

test('음색 변조 - DDSP-SVC 탭: 목표 스텝에 도달하면 실제로 학습 프로세스를 죽이고(방치 사고 재발 방지), 그 체크포인트로 추론+후처리까지 끝난다', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-timbre-ddsp-'));
  const { enginePath } = await setUpEngine(root);
  const ddspSvcRoot = await setUpDdspSvcRoot(root);
  const audioSpawn = makeFakeSpawn(); // handles STEM separation (mel_band_roformer)
  const ddspSpawn = makeFakeDdspSpawn({ finalStep: 500 }); // would run to 500 if never killed
  const spawnImpl = (engine, args, options = {}) => {
    if (typeof engine === 'string' && engine.endsWith('python.exe')) return ddspSpawn.spawnImpl(engine, args, options);
    return audioSpawn.spawnImpl(engine, args, options);
  };
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const callJson = async (route, method, payload) => { const response = await call(route, method, payload); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  await callJson('/api/settings', 'PUT', { enginePath, ddspSvcPath: ddspSvcRoot });
  const sourceDataUrl = `data:audio/wav;base64,${Buffer.from('fake-source-song').toString('base64')}`;
  const previewId = (await callJson('/api/timbre-transform/prepare', 'POST', { sourceDataUrl })).data.previewId;

  // no references: clear 400
  const noRefs = await callJson(`/api/timbre-transform/${previewId}/ddsp/start`, 'POST', { targetStep: 200, referenceDataUrls: [] });
  assert.equal(noRefs.status, 400);

  const referenceDataUrls = [
    `data:audio/wav;base64,${Buffer.from('fake-ref-clip-1').toString('base64')}`,
    `data:audio/wav;base64,${Buffer.from('fake-ref-clip-2').toString('base64')}`,
  ];
  const started = await callJson(`/api/timbre-transform/${previewId}/ddsp/start`, 'POST', { targetStep: 200, referenceDataUrls, featureEncoder: 'hubertsoft', pitchExtractor: 'fcpe', vocoder: 'pc_nsf_hifigan' });
  assert.equal(started.status, 200);
  assert.ok(started.data.jobId, 'expected the start route to return a jobId immediately, not wait for training');

  // second start while one is active is rejected, not queued silently
  const secondStart = await callJson(`/api/timbre-transform/${previewId}/ddsp/start`, 'POST', { targetStep: 200, referenceDataUrls });
  assert.equal(secondStart.status, 409);

  // poll GET /api/ddsp-jobs until the job (running in the background, not awaited by /start) completes
  let job = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const jobs = (await callJson('/api/ddsp-jobs')).data;
    job = jobs.find(item => item.id === started.data.jobId);
    if (job && (job.status === 'completed' || job.status === 'failed')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(job, 'expected the job to be visible via GET /api/ddsp-jobs');
  assert.equal(job.status, 'completed', job.error || 'expected the job to complete successfully');
  assert.equal(job.featureEncoder, 'hubertsoft');
  assert.equal(job.pitchExtractor, 'fcpe');
  assert.equal(job.vocoder, 'pc_nsf_hifigan');
  const generatedDdspConfig = await readFile(path.join(ddspSvcRoot, 'configs', `job-${job.id}.yaml`), 'utf8');
  assert.match(generatedDdspConfig, /encoder: 'hubertsoft'/);
  assert.match(generatedDdspConfig, /encoder_hop_size: 320/);
  assert.match(generatedDdspConfig, /encoder_out_channels: 256/);
  assert.match(generatedDdspConfig, /encoder_ckpt: pretrain\/hubert\/hubert-soft-0d54a1f4\.pt/);
  assert.match(generatedDdspConfig, /f0_extractor: 'fcpe'/);
  assert.match(generatedDdspConfig, /ckpt: 'pretrain\/pc_nsf_hifigan_44\.1k_hop512_128bin_2025\.02\/model\.ckpt'/);

  // THE regression check: stdout reported steps 50..500 in increments of 50 (if never killed), but
  // the target was 200 -- the process must have been killed at/just past 200, never anywhere near 500.
  assert.equal(ddspSpawn.killCount(), 1, 'expected the training child process to be killed exactly once');
  assert.ok(job.currentStep >= 200 && job.currentStep <= 250, `expected currentStep to stop just at/after target (200), got ${job.currentStep} -- would be 500 if the kill-at-target mechanism regressed`);

  assert.ok(ddspSpawn.calls.some(c => c.args[0] === 'preprocess.py'), 'expected preprocess.py to run before training');
  const ddspInferenceCall = ddspSpawn.calls.find(c => c.args[0] === 'main_reflow.py');
  assert.ok(ddspInferenceCall, 'expected inference to run after training stops');
  assert.equal(ddspInferenceCall.args[ddspInferenceCall.args.indexOf('-pe') + 1], 'fcpe');
  assert.ok(audioSpawn.calls.some(c => c.engine === 'ffmpeg' && c.args.some(arg => typeof arg === 'string' && arg.includes('sidechaingate'))), 'expected the shared post-processing chain to run on the DDSP-SVC result too');

  // the finished vocal was written back into this preview session's servable stems/vocals.wav
  const vocalsResponse = await call(`/api/timbre-transform/${previewId}/stems/vocals`);
  assert.equal(vocalsResponse.status, 200);

  // ddspActive is released once the background job finishes, so a fresh job can start -- and this one
  // also regression-tests the checkpoint-cadence bug found during real end-to-end testing (2026-09-19):
  // the config template's own interval_val (2000) never saves a checkpoint before a small targetStep is
  // reached, so latestCheckpoint() found nothing and the job failed even though the kill-at-target
  // mechanism above worked correctly. startDdspJob() must scale interval_val down relative to targetStep
  // so a checkpoint always exists in time.
  const thirdStart = await callJson(`/api/timbre-transform/${previewId}/ddsp/start`, 'POST', { targetStep: 15, referenceDataUrls });
  assert.equal(thirdStart.status, 200);
  let thirdJob = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const jobs = (await callJson('/api/ddsp-jobs')).data;
    thirdJob = jobs.find(item => item.id === thirdStart.data.jobId);
    if (thirdJob && (thirdJob.status === 'completed' || thirdJob.status === 'failed')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(thirdJob, 'expected the small-targetStep job to be visible via GET /api/ddsp-jobs');
  assert.equal(thirdJob.status, 'completed', thirdJob.error || 'expected a small targetStep to still find a checkpoint (would fail with the template default interval_val of 2000)');

  // an unknown previewId is a clear 404, not a crash
  assert.equal((await callJson('/api/timbre-transform/not-a-real-preview-id/ddsp/start', 'POST', { targetStep: 200, referenceDataUrls })).status, 404);
});

test('보컬 음색 변환의 내장 파일 탐색기: library/ 트리 안 어디든 탐색 가능, 밖으로는 못 나감, 오디오 파일만 내려받기 가능', async t => {
  resetEnv();
  const root = await mkdtemp(path.join(os.tmpdir(), 'songyue-api-library-browse-'));
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: () => { throw new Error('no engine calls expected'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route) => fetch(`${base}${route}`);
  const callJson = async (route) => { const response = await call(route); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });

  // library/audio-ref (the picker's default landing folder) with a mix of audio/non-audio files and a subfolder
  await mkdir(path.join(root, 'library', 'audio-ref', 'more'), { recursive: true });
  await writeFile(path.join(root, 'library', 'audio-ref', 'voice-a.mp3'), 'fake-mp3');
  await writeFile(path.join(root, 'library', 'audio-ref', 'voice-b.wav'), 'fake-wav');
  await writeFile(path.join(root, 'library', 'audio-ref', 'notes.txt'), 'not audio');
  await writeFile(path.join(root, 'library', 'audio-ref', 'more', 'nested.flac'), 'fake-flac');
  await mkdir(path.join(root, 'library', 'music'), { recursive: true });
  await writeFile(path.join(root, 'library', 'music', 'song.wav'), 'fake-song');

  // browsing audio-ref: folders first, then audio files alphabetically, non-audio files excluded
  const browseAudioRef = await callJson('/api/library/browse?path=audio-ref');
  assert.equal(browseAudioRef.status, 200);
  assert.equal(browseAudioRef.data.path, 'audio-ref');
  assert.deepEqual(browseAudioRef.data.entries, [
    { name: 'more', type: 'dir' },
    { name: 'voice-a.mp3', type: 'file', size: 8 },
    { name: 'voice-b.wav', type: 'file', size: 8 },
  ]);

  // can navigate into a subfolder
  const browseNested = await callJson('/api/library/browse?path=audio-ref/more');
  assert.equal(browseNested.status, 200);
  assert.deepEqual(browseNested.data.entries, [{ name: 'nested.flac', type: 'file', size: 9 }]);

  // and to a sibling library folder entirely (e.g. library/music), not just descendants of audio-ref
  const browseMusic = await callJson('/api/library/browse?path=music');
  assert.equal(browseMusic.status, 200);
  assert.deepEqual(browseMusic.data.entries, [{ name: 'song.wav', type: 'file', size: 9 }]);

  // the library root itself (empty path) lists our two folders alongside whatever else the server
  // maintains there (library/setting, library/music, etc. are created as part of normal startup)
  const browseRoot = await callJson('/api/library/browse?path=');
  assert.equal(browseRoot.status, 200);
  const rootNames = browseRoot.data.entries.map(e => e.name);
  assert.ok(rootNames.includes('audio-ref') && rootNames.includes('music'), `expected both audio-ref and music to be listed, got ${JSON.stringify(rootNames)}`);
  assert.ok(browseRoot.data.entries.every(e => e.type === 'dir'), 'expected only directories at the library root in this fixture');

  // path traversal out of library/ is rejected, not silently resolved
  assert.equal((await call('/api/library/browse?path=..')).status, 400);
  assert.equal((await call('/api/library/browse?path=../..')).status, 400);
  assert.equal((await call('/api/library/browse?path=audio-ref/../../etc')).status, 400);

  // a folder that doesn't exist is a clear 404, not a crash
  assert.equal((await call('/api/library/browse?path=does-not-exist')).status, 404);

  // fetching an actual audio file returns its bytes with the right content-type
  const fileResponse = await call('/api/library/file?path=audio-ref/voice-a.mp3');
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await fileResponse.text(), 'fake-mp3');

  // non-audio extensions and traversal attempts are rejected on the file route too
  assert.equal((await call('/api/library/file?path=audio-ref/notes.txt')).status, 400);
  assert.equal((await call('/api/library/file?path=../outside.mp3')).status, 400);
  assert.equal((await call('/api/library/file?path=audio-ref/missing.mp3')).status, 404);

  // an in-app-created song keeps a {제목}.json next to its audio -- the meta route surfaces the
  // stored lyrics (used by the 음색 변조 AuK tab to skip Whisper STT) alongside title/style
  await writeFile(path.join(root, 'library', 'music', 'song.json'), JSON.stringify({ title: '저장된 곡', lyrics: '[Verse] 실제로 적은 가사', style: '밝은 팝' }));
  const meta = await callJson('/api/library/meta?path=music/song.json');
  assert.equal(meta.status, 200);
  assert.deepEqual(meta.data, { title: '저장된 곡', lyrics: '[Verse] 실제로 적은 가사', style: '밝은 팝' });
  assert.equal((await call('/api/library/meta?path=audio-ref/voice-a.mp3')).status, 400, 'expected the meta route to only read json files');
  assert.equal((await call('/api/library/meta?path=music/없는.json')).status, 404);
  assert.equal((await call('/api/library/meta?path=../outside.json')).status, 400);
});
