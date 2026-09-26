import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeWavFloat32, decodeWav, buildChainConfig, runVstChain } from './postfx/vst-stage.mjs';
import { normalizePolishSettings, enabledStages, runPolishChain } from './postfx/chain.mjs';
import { parseScanOutput, stateFileFor, findLocalPlugins, createVstManager } from './vst.mjs';
import { createStudioServer } from './server.mjs';

// A stand-in for vst-host.exe: --scan lists one plugin, --gui writes a state file and stays open, --process-chain scales the float32 WAV by the
// plugin's saved state (a number) or by 0.5 without one; FAKE_MODE=hang never finishes, FAKE_MODE=fail exits with an error.
const FAKE_HOST = `
import fs from 'node:fs';
const args = process.argv.slice(2);
const get = (key) => { const index = args.indexOf(key); return index < 0 ? null : args[index + 1]; };
if (args.includes('--scan')) {
  console.log(JSON.stringify([{ name: 'Fake Reverb', vendor: 'Test', version: '1.0', path: process.env.FAKE_PLUGIN_PATH, uid: 'U1', subcategories: 'Fx|Reverb' }]));
} else if (args.includes('--gui')) {
  fs.writeFileSync(get('--state'), '0.25');
  setInterval(() => {}, 1000);
} else if (args.includes('--process-chain')) {
  if (process.env.FAKE_MODE === 'hang') setInterval(() => {}, 1000);
  else if (process.env.FAKE_MODE === 'fail') { console.error('plugin exploded'); process.exit(3); }
  else {
    const chain = JSON.parse(fs.readFileSync(get('--chain'), 'utf8'));
    let gain = 1;
    for (const plugin of chain.plugins) gain *= plugin.state ? parseFloat(fs.readFileSync(plugin.state, 'utf8')) : 0.5;
    const wav = Buffer.from(fs.readFileSync(get('--input')));
    for (let position = 44; position + 4 <= wav.length; position += 4) wav.writeFloatLE(wav.readFloatLE(position) * gain, position);
    fs.writeFileSync(get('--output'), wav);
  }
}
`;

async function setUp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'songyue-vst-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const hostFile = path.join(dir, 'fake-host.mjs');
  await writeFile(hostFile, FAKE_HOST);
  const pluginFile = path.join(dir, 'Fake.vst3');
  await writeFile(pluginFile, 'x');
  process.env.FAKE_PLUGIN_PATH = pluginFile;
  t.after(() => { delete process.env.FAKE_PLUGIN_PATH; delete process.env.FAKE_MODE; });
  return { dir, host: { exe: process.execPath, args: [hostFile] }, pluginFile };
}

const tone = (frames = 4410, rate = 44100) => ({ left: Float32Array.from({ length: frames }, (_, index) => 0.8 * Math.sin(index / 20)), right: Float32Array.from({ length: frames }, (_, index) => 0.4 * Math.sin(index / 20)), rate });

test('float32 WAV files round-trip, and 16 / 24 bit PCM and mono are read as well', () => {
  const audio = tone(100);
  const back = decodeWav(encodeWavFloat32(audio, 44100));
  assert.equal(back.rate, 44100);
  assert.deepEqual([...back.left], [...audio.left]);
  assert.deepEqual([...back.right], [...audio.right]);
  const pcm = Buffer.alloc(44 + 4);
  pcm.write('RIFF', 0); pcm.writeUInt32LE(40, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(8000, 24); pcm.writeUInt32LE(16000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(4, 40);
  pcm.writeInt16LE(16384, 44); pcm.writeInt16LE(-16384, 46);
  const mono = decodeWav(pcm);
  assert.equal(mono.left[0], 0.5); assert.equal(mono.right[1], -0.5);
  assert.throws(() => decodeWav(Buffer.from('not a wav file at all, not a wav file at all!!')), /WAV/);
});

test('polish settings: the VST3 stage sits between the vocal naturalizer and mastering, only plugins that are on count', () => {
  const settings = normalizePolishSettings({ naturalize: { enabled: true }, master: { enabled: true }, vst: { enabled: true, plugins: [{ path: ' C:\\a.vst3 ', enabled: true }, { path: 'C:\\b.vst3', enabled: false }, { path: 5 }, null] } });
  assert.deepEqual(settings.vst.plugins, [{ path: 'C:\\a.vst3', enabled: true }, { path: 'C:\\b.vst3', enabled: false }]);
  assert.deepEqual(enabledStages(settings), ['naturalize', 'vst', 'master']);
  assert.equal(normalizePolishSettings({ vst: { enabled: true, plugins: [{ path: 'C:\\b.vst3', enabled: false }] } }).vst.enabled, false, 'no plugin on = stage off');
  assert.equal(normalizePolishSettings({ vst: { enabled: true, plugins: Array.from({ length: 20 }, (_, i) => ({ path: `p${i}.vst3` })) } }).vst.plugins.length, 8);
  const order = [];
  const audio = tone(64);
  runPolishChain(audio, { naturalize: { enabled: true, amount: 0.1 }, vst: { enabled: true, plugins: [{ path: 'a.vst3' }] } }, { vstProcess: (current) => { order.push('vst'); return current; }, onProgress: (_, label) => order.push(label) });
  assert.deepEqual(order.slice(0, 4), ['보컬 자연화', 'VST3 플러그인', 'vst', '완료']);
  assert.throws(() => runPolishChain(tone(64), { vst: { enabled: true, plugins: [{ path: 'a.vst3' }] } }, {}), /VST3/);
});

test('the chain file lists only the plugins that are on, with their saved state', () => {
  const chain = buildChainConfig([{ path: 'a.vst3', enabled: true }, { path: 'b.vst3', enabled: false }, { path: 'c.vst3', enabled: true }], { 'a.vst3': 'a.vststate' });
  assert.deepEqual(chain, { plugins: [{ path: 'a.vst3', enabled: true, state: 'a.vststate' }, { path: 'c.vst3', enabled: true, state: '' }] });
});

test('vst-host is run as a separate process: the plugins change the sound, a saved state is used, a hang is cut off and a failure is reported', async (t) => {
  const { dir, host, pluginFile } = await setUp(t);
  const audio = tone();
  const workDir = path.join(dir, 'work');
  const plugins = [{ path: pluginFile, enabled: true }];
  const half = runVstChain(audio, plugins, { ...host, states: {}, workDir });
  assert.equal(half.left.length, audio.left.length);
  assert.ok(Math.abs(half.left[100] - audio.left[100] * 0.5) < 1e-6, 'no state: the fake plugin halves the level');
  const stateFile = path.join(dir, 'a.vststate');
  await writeFile(stateFile, '0.25');
  const quarter = runVstChain(audio, plugins, { ...host, states: { [pluginFile]: stateFile }, workDir });
  assert.ok(Math.abs(quarter.left[100] - audio.left[100] * 0.25) < 1e-6, 'the saved state is passed to the plugin');
  assert.equal(runVstChain(audio, [{ path: pluginFile, enabled: false }], { ...host, workDir }), audio, 'nothing switched on: the audio is untouched');
  process.env.FAKE_MODE = 'fail';
  assert.throws(() => runVstChain(audio, plugins, { ...host, states: {}, workDir }), /종료 코드 3.*plugin exploded/);
  process.env.FAKE_MODE = 'hang';
  const started = Date.now();
  assert.throws(() => runVstChain(audio, plugins, { ...host, states: {}, workDir, timeoutMs: 1200 }), /안에 끝나지 않아 중단/);
  assert.ok(Date.now() - started < 8000, 'the hanging process was killed at the time limit');
  await assert.rejects(stat(path.join(workDir, 'vst-input.wav')), 'temporary files are removed');
});

test('scan output is parsed, the plugin folder of the app is searched and only known plugins may be opened; the settings window is single and can be closed', async (t) => {
  const { dir, host, pluginFile } = await setUp(t);
  assert.deepEqual(parseScanOutput('[vst-host] Scan found 1\n[\n {"name":"B","path":"C:\\\\b.vst3"},{"name":"A","path":"C:\\\\a.vst3","vendor":"V"},{"name":"A","path":"C:\\\\a.vst3"}\n]\n').map((plugin) => plugin.name), ['A', 'B']);
  assert.deepEqual(parseScanOutput('nothing'), []);
  const localDir = path.join(dir, 'plugins');
  await mkdir(path.join(localDir, 'sub', 'Bundle.vst3', 'Contents'), { recursive: true });
  await writeFile(path.join(localDir, 'Local Comp.vst3'), 'x');
  await writeFile(path.join(localDir, 'readme.txt'), 'x');
  assert.deepEqual((await findLocalPlugins(localDir)).map((plugin) => plugin.name).sort(), ['Bundle', 'Local Comp']);
  const statesDir = path.join(dir, 'states');
  const manager = createVstManager({ root: dir, statesDir, spawnImpl: spawn, host, localDir });
  const { plugins } = await manager.scan();
  assert.deepEqual(plugins.map((plugin) => plugin.name), ['Bundle', 'Fake Reverb', 'Local Comp']);
  await manager.requireKnown([pluginFile]);
  await assert.rejects(manager.requireKnown([path.join(dir, 'evil.vst3')]), /검색되지 않은/);
  assert.equal(stateFileFor(statesDir, pluginFile), stateFileFor(statesDir, pluginFile.toUpperCase()), 'one state file per plugin path');
  await assert.rejects(manager.openEditor(path.join(dir, 'evil.vst3')), /검색되지 않은/);
  await manager.openEditor(pluginFile);
  assert.equal(manager.editorStatus().running, true);
  await assert.rejects(manager.openEditor(pluginFile), /이미 열려/);
  assert.equal(manager.closeEditor(), true);
  assert.equal(manager.editorStatus().running, false);
  assert.equal(manager.closeEditor(), false);
  const missing = createVstManager({ root: dir, statesDir, spawnImpl: spawn, host: { exe: path.join(dir, 'nope.exe'), args: [] }, localDir });
  assert.deepEqual(await missing.scan(), { hostReady: false, plugins: [] });
});

test('VST3 routes: plugin list with saved states, settings window, and the polish request only accepts scanned plugins and passes the host settings on', async (t) => {
  const { dir, host, pluginFile } = await setUp(t);
  const root = path.join(dir, 'root');
  await mkdir(root, { recursive: true });
  const runs = [];
  const polishRunner = async ({ outputFile, settings, vstHost, onProgress }) => { runs.push({ settings, vstHost }); onProgress(50, 'x'); await writeFile(outputFile, 'fake-flac'); };
  // ffprobe / ffmpeg are not needed by these routes, but the server calls them for the durations of saved songs
  const fakeSpawn = (command, args, options) => (command === process.execPath ? spawn(command, args, options) : spawn(process.execPath, ['-e', 'process.stdout.write("1.0")'], options));
  const server = await createStudioServer({ root, fetchImpl: async () => Response.json({}), spawnImpl: fakeSpawn, polishRunner, vstHost: host });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, method = 'GET', payload) => { const response = await fetch(`${base}${route}`, { method, headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) }); return { status: response.status, data: await response.json().catch(() => null) }; };

  const list = await call('/api/vst/plugins');
  assert.equal(list.data.hostReady, true);
  assert.deepEqual(list.data.plugins.map((plugin) => plugin.name), ['Fake Reverb']);
  assert.equal(list.data.plugins[0].hasState, false);

  assert.equal((await call('/api/vst/editor', 'POST', { path: path.join(dir, 'evil.vst3') })).status, 400);
  assert.equal((await call('/api/vst/editor', 'POST', { path: pluginFile })).status, 200);
  assert.equal((await call('/api/vst/editor', 'POST', { path: pluginFile })).status, 409);
  assert.equal((await call('/api/vst/editor')).data.running, true);
  // the stand-in window writes its state when it starts; wait for it before closing
  for (let attempt = 0; attempt < 40 && !(await call('/api/vst/plugins')).data.plugins[0].hasState; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await call('/api/vst/plugins')).data.plugins[0].hasState, true, 'the state written by the window is found again');
  assert.equal((await call('/api/vst/editor/close', 'POST', {})).data.closed, true);
  assert.equal((await call('/api/vst/editor')).data.running, false);

  const saved = await call('/api/audio-save', 'POST', { dataUrl: `data:audio/wav;base64,${Buffer.from('fake-song').toString('base64')}`, title: '테스트 곡' });
  const songId = saved.data.id;
  const unknown = await call(`/api/projects/${songId}/polish`, 'POST', { settings: { vst: { enabled: true, plugins: [{ path: path.join(dir, 'evil.vst3'), enabled: true }] } } });
  assert.equal(unknown.status, 400);
  const started = await call(`/api/projects/${songId}/polish`, 'POST', { settings: { naturalize: { enabled: true }, vst: { enabled: true, plugins: [{ path: pluginFile, enabled: true }] } } });
  assert.equal(started.status, 200);
  assert.deepEqual(started.data.stages, ['naturalize', 'vst']);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].vstHost.exe, process.execPath);
  assert.equal(runs[0].vstHost.states[pluginFile], stateFileFor(path.join(root, 'Setting', 'VST-states'), pluginFile), 'the saved state goes to the host');
  await call(`/api/polish/${started.data.previewId}`, 'DELETE');

  assert.equal((await call('/api/vst/state', 'DELETE', { path: pluginFile })).status, 200);
  assert.equal((await call('/api/vst/plugins')).data.plugins[0].hasState, false);
  assert.equal(await readFile(path.join(dir, 'Fake.vst3'), 'utf8'), 'x');
});
