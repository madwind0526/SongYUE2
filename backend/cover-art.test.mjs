import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCoverModels, buildCoverPrompt, buildCoverWorkflow, generateCoverPicture, squareCropFilter, wrapCoverTitle, fallbackCoverColors, COVER_GENERATE_SIZE, COVER_MIN_SIZE } from './cover-art.mjs';

const info = (unets, clips, vaes) => ({
  UNETLoader: { input: { required: { unet_name: [unets] } } },
  CLIPLoader: { input: { required: { clip_name: [clips] } } },
  VAELoader: { input: { required: { vae_name: [vaes] } } },
});

test('the Z-Image Turbo files are picked by preference (nvfp4, then fp8, then bf16) and missing pieces give null', () => {
  const all = info(['Z-image\\z_image_turbo_bf16.safetensors', 'Z-image\\z_image_turbo_nvfp4.safetensors', 'Wan2.2\\x.safetensors'], ['qwen_3_4b.safetensors', 'Qwen\\qwen_3_4b_fp8_mixed.safetensors'], ['flux\\ae.safetensors', 'ae.safetensors']);
  assert.deepEqual(pickCoverModels(all), { unet: 'Z-image\\z_image_turbo_nvfp4.safetensors', clip: 'Qwen\\qwen_3_4b_fp8_mixed.safetensors', vae: 'flux\\ae.safetensors' });
  assert.equal(pickCoverModels(info(['other.safetensors'], ['qwen_3_4b.safetensors'], ['ae.safetensors'])), null);
  assert.equal(pickCoverModels(info(['z_image_turbo_bf16.safetensors'], ['clip_l.safetensors'], ['ae.safetensors'])), null);
  assert.equal(pickCoverModels({}), null);
});

test('the prompt follows the music style only: no title or lyrics (they would be drawn as letters) and a request for no writing', () => {
  const prompt = buildCoverPrompt({ title: '밤 산책', style: 'korean ballad, piano', lyrics: '[verse] 조용한 밤', instrumental: true });
  for (const part of ['Wordless', 'korean ballad, piano', 'No singer']) assert.ok(prompt.includes(part), part);
  assert.ok(!prompt.includes('밤 산책') && !prompt.includes('조용한 밤'));
  assert.ok(buildCoverPrompt({ style: 's', vocalGender: 'female' }).includes('female singer'));
  const mixed = buildCoverPrompt({ style: '한국 발라드, korean ballad, 피아노, soft piano' });
  assert.ok(mixed.includes('Music style: korean ballad, soft piano.'), mixed);
  assert.ok(!/[ㄱ-힝]/.test(mixed), 'no Hangul in the prompt');
  assert.ok(!buildCoverPrompt({ style: '한국 발라드' }).includes('Music style'));
});

test('the workflow is a square picture at the native size (never below the minimum cover size)', () => {
  assert.ok(COVER_GENERATE_SIZE >= COVER_MIN_SIZE);
  const workflow = buildCoverWorkflow({ models: { unet: 'u', clip: 'c', vae: 'v' }, prompt: 'p', seed: 3 });
  assert.equal(workflow['7'].inputs.width, COVER_GENERATE_SIZE);
  assert.equal(workflow['7'].inputs.height, COVER_GENERATE_SIZE);
  assert.equal(workflow['8'].inputs.steps, 8);
  assert.match(squareCropFilter(), /crop='min\(iw,ih\)':'min\(iw,ih\)'.*2475/);
});

test('a picture is fetched from ComfyUI after the run completes; without models nothing is queued', async () => {
  const calls = [];
  const models = info(['z_image_turbo_nvfp4.safetensors'], ['qwen_3_4b_fp8_mixed.safetensors'], ['ae.safetensors']);
  let polls = 0;
  const fetchImpl = async (url) => {
    calls.push(url);
    const reply = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer });
    if (url.includes('/object_info/UNETLoader')) return reply({ UNETLoader: models.UNETLoader });
    if (url.includes('/object_info/CLIPLoader')) return reply({ CLIPLoader: models.CLIPLoader });
    if (url.includes('/object_info/VAELoader')) return reply({ VAELoader: models.VAELoader });
    if (url.endsWith('/prompt')) return reply({ prompt_id: 'p1' });
    if (url.includes('/history/p1')) { polls += 1; return reply(polls < 2 ? {} : { p1: { status: { completed: true, status_str: 'success' }, outputs: { 10: { images: [{ filename: 'a.png', subfolder: '', type: 'temp' }] } } } }); }
    if (url.includes('/view?')) return reply({});
    throw new Error(`unexpected ${url}`);
  };
  const picture = await generateCoverPicture({ fetchImpl, endpoint: 'http://x', project: { title: 't', style: 's', seed: 5 }, sleep: async () => {} });
  assert.deepEqual([...picture], [1, 2, 3]);
  assert.ok(calls.some((call) => call.includes('type=temp')));
  const none = await generateCoverPicture({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }), endpoint: 'http://x', project: { title: 't', style: 's' }, sleep: async () => {} });
  assert.equal(none, null);
});

test('the fallback cover: titles wrap at spaces into at most 4 lines, and every song gets its own colours', () => {
  assert.deepEqual(wrapCoverTitle('조용한 밤에 혼자 걸어요'), ['조용한 밤에', '혼자 걸어요']);
  assert.deepEqual(wrapCoverTitle('Midnight City Lights After The Rain'), ['Midnight City', 'Lights After', 'The Rain']);
  assert.equal(wrapCoverTitle('가나다라마바사아자차카타파하 가나다라마바사아자차카타파하 가나다라마바사아자차카타파하 가나다라마바사아자차카타파하 가나다라마바사아자차카타파하').length, 4);
  assert.deepEqual(wrapCoverTitle(''), []);
  const a = fallbackCoverColors({ title: '노래 1', style: 'rock' });
  assert.deepEqual(a, fallbackCoverColors({ title: '노래 1', style: 'rock' }), 'the same song always gets the same colours');
  assert.match(a.from, /^[0-9a-f]{6}$/);
  assert.notDeepEqual(a, fallbackCoverColors({ title: '노래 1', style: 'korean ballad' }));
});
