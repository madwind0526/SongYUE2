// One LoRA training run at a time: starts the ComfyUI trainer nodes, follows the progress, compares the EMA and the raw result and
// files the chosen one. The pure helpers live in lora-train.mjs; this file keeps the running state and talks to ComfyUI.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TRAINER_NODE_DIR, TRAIN_CHECKPOINT, buildTrainPrompt, cleanTrainRequest, emaRawVerdict, finalizeTrainedLora, linkOrCopy, scanSourceDir } from './lora-train.mjs';

const exists = (file) => stat(file).then(() => true, () => false);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLoraTrainer(context) {
  const { root, outputDirectory, fetchImpl, spawnImpl, comfyEnginePath, ensureComfyUi, freeComfyUi = async () => {}, setBusy, isBusy, adaptersDir, listInstalledNames, synthesizeSong, measureSeconds, now = () => Date.now() } = context;
  let job = null;
  let socket = null;
  const libraryDir = () => path.join(root, 'library', 'Lora');
  const jobDir = (id) => path.join(outputDirectory, `lora-train-${id}`);
  const lorasDir = () => path.join(comfyEnginePath(), 'models', 'loras');
  const save = async () => { if (job) await writeFile(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2), 'utf8').catch(() => {}); };
  const touch = (patch) => { Object.assign(job, patch, { updatedAt: now() }); void save(); };

  // What is needed before a run can start (each item: { ok, hint })
  async function readiness() {
    const enginePath = comfyEnginePath();
    const checks = {
      comfyui: { ok: await exists(path.join(enginePath, '.venv', 'Scripts', 'python.exe')), hint: 'ComfyUI가 engine/ComfyUI에 설치되어 있어야 합니다. docs/comfyui-setup.md를 확인해 주세요.' },
      trainer: { ok: await exists(path.join(enginePath, 'custom_nodes', TRAINER_NODE_DIR)), hint: `학습 노드가 없습니다. engine/ComfyUI/custom_nodes에서 git clone https://github.com/Starnodes2024/ComfyUI-YuE2-Trainer.git 을 실행해 주세요.` },
      checkpoint: { ok: await exists(path.join(enginePath, 'models', 'checkpoints', TRAIN_CHECKPOINT)), hint: `학습에는 BF16 체크포인트(${TRAIN_CHECKPOINT}, 약 7.8 GB)가 필요합니다. Comfy-Org/YuE2 저장소에서 받아 engine/ComfyUI/models/checkpoints에 넣어 주세요.` },
    };
    return { ready: Object.values(checks).every((item) => item.ok), checks };
  }

  async function scan(dir) {
    const found = await scanSourceDir(dir);
    let seconds = 0;
    for (const file of found.files.slice(0, 200)) seconds += (await measureSeconds(path.join(dir, file.name)).catch(() => 0)) || 0;
    return { ...found, minutes: Math.round(seconds / 6) / 10 };
  }

  const publicJob = () => (job ? { ...job } : null);
  async function current() {
    if (job) return publicJob();
    // a finished run that still waits for the choice survives a restart of the app
    const dirs = (await readdir(outputDirectory, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory() && entry.name.startsWith('lora-train-'));
    let latest = null;
    for (const entry of dirs) {
      const saved = await readFile(path.join(outputDirectory, entry.name, 'job.json'), 'utf8').then(JSON.parse, () => null);
      if (saved?.status === 'review' && (!latest || saved.updatedAt > latest.updatedAt)) latest = saved;
    }
    if (latest) { job = latest; return publicJob(); }
    return null;
  }

  async function start(input) {
    if (isBusy()) throw Object.assign(new Error('다른 작업이 실행 중입니다. 끝난 뒤에 다시 시작해 주세요. (학습은 GPU를 거의 다 씁니다)'), { status: 409 });
    if (job && ['starting', 'training', 'finalizing'].includes(job.status)) throw Object.assign(new Error('이미 학습이 진행 중입니다.'), { status: 409 });
    if (job?.status === 'review') throw Object.assign(new Error('이전 학습 결과를 아직 고르지 않았습니다. 먼저 EMA와 raw 중 하나를 확정하거나 버려 주세요.'), { status: 409 });
    let cleaned;
    try { cleaned = cleanTrainRequest(input); } catch (error) { throw Object.assign(error, { status: 400 }); }
    let source;
    try { source = await scanSourceDir(String(input.sourceDir || '').trim()); } catch (error) { throw Object.assign(error, { status: 400 }); }
    if (source.count < 1) throw Object.assign(new Error('폴더에 mp3, wav, flac 곡이 없습니다.'), { status: 400 });
    const state = await readiness();
    if (!state.ready) throw Object.assign(new Error(Object.values(state.checks).filter((item) => !item.ok).map((item) => item.hint).join(' ')), { status: 409 });
    const id = randomUUID();
    await mkdir(jobDir(id), { recursive: true });
    const loraName = `songyue-${id.slice(0, 8)}`;
    job = { id, status: 'starting', request: cleaned, sourceDir: source.dir, songs: source.count, step: 0, total: cleaned.steps, startedAt: now(), updatedAt: now(), loraName, error: '', message: 'ComfyUI를 준비하는 중', verdict: null, difference: null, ab: null };
    setBusy(true, 'LoRA 학습 중');
    void run(source);
    return publicJob();
  }

  async function run(source) {
    const req = job.request;
    const id = job.id;
    let endpoint = '';
    try {
      endpoint = await ensureComfyUi();
      // free the video memory the other engines hold: training needs almost all of it
      await fetchImpl(`${endpoint}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {});
      const prompt = buildTrainPrompt({ sourceDir: source.dir, cacheDir: path.join(jobDir(id), 'latents'), loraName: job.loraName, triggerWord: req.trigger, steps: req.steps, rank: req.rank, clipSeconds: req.clipSeconds, learningRate: req.learningRate, caption: req.caption, hasCaptionFiles: source.captions > 0 });
      const clientId = randomUUID();
      const url = new URL(endpoint);
      try {
        socket = new WebSocket(`ws://${url.host}/ws?clientId=${clientId}`);
        socket.onmessage = (event) => {
          if (typeof event.data !== 'string') return;
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.type === 'progress' && message.data?.max > 1 && job?.status === 'training') {
            // the encoder reports its own small counter (one step per song) before the training steps start
            if (message.data.max === job.request.steps) touch({ step: message.data.value, total: message.data.max, message: '학습 중' });
            else touch({ step: 0, message: `곡을 읽는 중 (${message.data.value}/${message.data.max})` });
          }
        };
      } catch { socket = null; }
      const response = await fetchImpl(`${endpoint}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: clientId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.prompt_id) throw new Error(`ComfyUI가 학습 요청을 거부했습니다: ${JSON.stringify(body.node_errors || body.error || response.status).slice(0, 300)}`);
      touch({ status: 'training', message: '곡을 읽어 준비하는 중', promptId: body.prompt_id });
      // wait for the run to end (the progress comes over the WebSocket; the history says how it ended)
      for (;;) {
        await sleep(2000);
        if (job?.status === 'cancelled') return;
        const history = await (await fetchImpl(`${endpoint}/history/${body.prompt_id}`)).json().catch(() => ({}));
        const entry = history[body.prompt_id];
        if (!entry) continue;
        if (entry.status?.status_str === 'error') {
          const failure = (entry.status.messages || []).find((item) => item[0] === 'execution_error');
          throw new Error(`학습이 실패했습니다: ${String(failure?.[1]?.exception_message || '알 수 없는 오류').slice(0, 300)}`);
        }
        if (entry.status?.completed || entry.status?.status_str === 'success') break;
      }
      const emaFile = path.join(lorasDir(), `${job.loraName}.safetensors`);
      const rawFile = path.join(lorasDir(), `${job.loraName}_raw.safetensors`);
      if (!(await exists(emaFile))) throw new Error('학습이 끝났지만 결과 파일을 찾지 못했습니다.');
      touch({ message: 'EMA와 raw의 차이를 재는 중', step: job.total });
      const relative = (await exists(rawFile)) ? await compare(emaFile, rawFile) : 0;
      touch({ status: 'review', message: '결과를 고르세요', emaFile, rawFile, difference: relative, verdict: emaRawVerdict(relative) });
    } catch (error) {
      if (job?.status !== 'cancelled') touch({ status: 'failed', error: error.message || String(error), message: '학습 실패' });
    } finally {
      try { socket?.close(); } catch { /* already closed */ }
      socket = null;
      setBusy(false);
    }
  }

  async function compare(emaFile, rawFile) {
    const python = path.join(comfyEnginePath(), '.venv', 'Scripts', 'python.exe');
    const script = path.join(root, 'scripts', 'lora_compare.py');
    return new Promise((resolve) => {
      let out = '';
      const child = spawnImpl(python, [script, emaFile, rawFile], { windowsHide: true });
      child.stdout?.on('data', (chunk) => { out += chunk; });
      child.once('error', () => resolve(NaN));
      child.once('close', () => { try { resolve(Number(JSON.parse(out.trim().split('\n').pop()).relative)); } catch { resolve(NaN); } });
    });
  }

  async function cancel() {
    if (!job || !['starting', 'training'].includes(job.status)) throw Object.assign(new Error('진행 중인 학습이 없습니다.'), { status: 409 });
    touch({ status: 'cancelled', message: '취소됨' });
    try { await fetchImpl(`${(await ensureComfyUi())}/interrupt`, { method: 'POST' }); } catch { /* the run is stopped anyway when ComfyUI goes away */ }
    await rm(jobDir(job.id), { recursive: true, force: true }).catch(() => {});
    await removeOutputs(job);
    setBusy(false);
    const finished = publicJob();
    job = null;
    return finished;
  }

  async function removeOutputs(target) {
    for (const file of [target?.emaFile, target?.rawFile]) if (file) await rm(file, { force: true }).catch(() => {});
  }

  // A/B songs (same lyrics, seed and settings) made with the EMA and with the raw result, so the user can listen
  async function abPreview() {
    if (job?.status !== 'review') throw Object.assign(new Error('비교할 학습 결과가 없습니다.'), { status: 409 });
    if (isBusy()) throw Object.assign(new Error('다른 작업이 실행 중입니다.'), { status: 409 });
    setBusy(true, 'LoRA 비교곡 만드는 중');
    const temp = [];
    try {
      await freeComfyUi();
      touch({ ab: { status: 'making' } });
      const names = {};
      for (const [which, file] of [['ema', job.emaFile], ['raw', job.rawFile]]) {
        const name = `zz-ab-${job.id.slice(0, 8)}-${which}`;
        const dir = path.join(adaptersDir(), name);
        await mkdir(dir, { recursive: true });
        await linkOrCopy(file, path.join(dir, `${name}.safetensors`));
        await writeFile(path.join(dir, 'songyue2-adapter.json'), JSON.stringify({ displayName: name, stage: 'nar' }), 'utf8');
        temp.push(dir); names[which] = name;
      }
      const lyrics = '[verse]\n조용한 밤에 혼자 걸어요\n작은 불빛이 나를 따라와요\n\n[chorus]\n이 노래가 닿기를\n내 마음이 닿기를';
      for (const which of ['ema', 'raw']) {
        const audio = await synthesizeSong({ style: `${job.request.trigger}, korean pop ballad, soft vocal, piano`, lyrics, cot: 'off', steps: 16, lm_seed: 4242, seed: 4242, output_format: 'wav16', adapters: [{ name: names[which], ar_scale: 0, nar_scale: 1 }] });
        await writeFile(path.join(jobDir(job.id), `ab-${which}.wav`), audio);
      }
      touch({ ab: { status: 'ready' } });
    } catch (error) {
      touch({ ab: { status: 'failed', error: error.message || String(error) } });
      throw Object.assign(error, { status: 502 });
    } finally {
      for (const dir of temp) await rm(dir, { recursive: true, force: true }).catch(() => {});
      setBusy(false);
    }
    return publicJob();
  }

  function abFile(which) {
    if (!job || !['ema', 'raw'].includes(which)) return null;
    return path.join(jobDir(job.id), `ab-${which}.wav`);
  }

  async function finalize(choice) {
    if (job?.status !== 'review') throw Object.assign(new Error('확정할 학습 결과가 없습니다.'), { status: 409 });
    if (!['ema', 'raw'].includes(choice)) throw Object.assign(new Error('EMA와 raw 중 하나를 골라 주세요.'), { status: 400 });
    const req = job.request;
    touch({ status: 'finalizing', message: '파일을 정리하는 중' });
    try {
      const result = await finalizeTrainedLora({
        libraryDir: libraryDir(), adapterDir: adaptersDir(), existingAdapterNames: await listInstalledNames(), name: req.name, trigger: req.trigger,
        chosenFile: choice === 'ema' ? job.emaFile : job.rawFile, otherFile: choice === 'ema' ? job.rawFile : job.emaFile,
        record: {
          trainedAt: new Date(job.startedAt).toISOString().slice(0, 10), chosen: choice === 'ema' ? 'EMA' : 'raw', emaRawDifference: job.difference,
          triggerWord: req.trigger, stage: 'sound (NAR) only', trainer: 'ComfyUI-YuE2-Trainer (Starnodes2024)', baseCheckpoint: TRAIN_CHECKPOINT,
          settings: { steps: req.steps, rank: req.rank, alpha: req.rank, learningRate: req.learningRate, clipSeconds: req.clipSeconds, optimizer: 'adamw_8bit', scheduler: 'cosine', emaDecay: 0.99, caption: req.caption || null },
          sourceFolder: job.sourceDir, songCount: job.songs, trainingMinutes: Math.round((now() - job.startedAt) / 6000) / 10,
          license: 'YuE2 가중치는 CC BY-NC 4.0이라 이 LoRA도 비상업용으로만 써야 한다. 학습에 쓴 곡의 저작권과 사용 조건은 사용자가 책임진다.',
        },
        cleanupDirs: [jobDir(job.id)],
      });
      const finished = { ...job, status: 'done', message: '완료', result: { installedName: result.installedName, mode: result.mode, bytes: result.bytes } };
      job = finished;
      return { ...finished };
    } catch (error) {
      touch({ status: 'review', message: '결과를 고르세요', error: error.message || String(error) });
      throw error;
    }
  }

  // Throws away a finished run without keeping any of its files
  async function discard() {
    if (!job || !['review', 'failed', 'done', 'cancelled'].includes(job.status)) throw Object.assign(new Error('버릴 학습 결과가 없습니다.'), { status: 409 });
    const target = job;
    job = null;
    await removeOutputs(target);
    await rm(jobDir(target.id), { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }

  return { readiness, scan, current, start, cancel, abPreview, abFile, finalize, discard, libraryDir };
}
