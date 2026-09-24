// DDSP-SVC integration for the "음색 변조" DDSP-SVC tab -- unlike the zero-shot engines (a single CLI
// call), this trains a small per-target-voice model from the user's reference clips before it can
// convert anything, which takes tens of minutes to hours on this hardware. This module owns the
// whole job lifecycle: copy references into a job-scoped dataset, preprocess, train while watching
// stdout for the current step, and stop training the moment the target step is reached.
//
// The step-kill mechanism below is the actual fix for a real ~4-hour training-runaway incident
// earlier this session (memory-bank/knowledge/trouble-shooting.md): DDSP-SVC's own train_reflow.py
// has NO "stop at N steps" flag (only train.epochs in the yaml, which doesn't map cleanly to a
// step count), so the caller must parse the step number out of stdout itself and kill the child
// process synchronously the moment currentStep crosses targetStep -- not "notice it happened
// later," which is exactly the gap that let the earlier run go from an agreed 40k to ~102k steps
// unsupervised.

import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const STEP_LOG_PATTERN = /step:\s*(\d+)/;
const LOSS_LOG_PATTERN = /loss:\s*([\d.]+)/;
const MIN_CLIP_DURATION_SECONDS = 2;
const DDSP_ENCODERS = {
  contentvec: { name: 'contentvec768l12tta2x', hopSize: 160, channels: 768, checkpoint: 'pretrain/contentvec/pytorch_model.bin' },
  hubertsoft: { name: 'hubertsoft', hopSize: 320, channels: 256, checkpoint: 'pretrain/hubert/hubert-soft-0d54a1f4.pt' },
};
const DDSP_PITCH_EXTRACTORS = new Set(['rmvpe', 'fcpe']);
const DDSP_VOCODERS = {
  nsf_hifigan: 'pretrain/nsf_hifigan/model',
  pc_nsf_hifigan: 'pretrain/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02/model.ckpt',
};

function ffprobeDurationSeconds(spawnImpl, file) {
  return new Promise((resolve) => {
    const chunks = [];
    let child;
    try {
      child = spawnImpl('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    child.stdout?.on('data', (data) => chunks.push(data));
    child.once('error', () => resolve(null));
    child.once('close', () => {
      const seconds = Number(Buffer.concat(chunks).toString('utf8').trim());
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
  });
}

function runToCompletion(spawnImpl, pythonExe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(pythonExe, args, { cwd, windowsHide: true });
    const chunks = [];
    child.stdout?.on('data', (data) => chunks.push(data));
    child.stderr?.on('data', (data) => chunks.push(data));
    child.once('error', reject);
    child.once('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8');
      if (code === 0) resolve(output);
      else reject(new Error(output.trim().slice(-1000) || `${path.basename(args[0] || '')} exited with code ${code}`));
    });
  });
}

async function latestCheckpoint(expDir) {
  let entries;
  try { entries = await readdir(expDir); } catch { return null; }
  let best = null;
  let bestStep = -1;
  for (const name of entries) {
    const match = name.match(/^model_(\d+)\.pt$/);
    if (!match) continue;
    const step = Number(match[1]);
    if (step > bestStep) { bestStep = step; best = name; }
  }
  return best ? path.join(expDir, best) : null;
}

// referenceFilePaths: already-written-to-disk audio files (any format ffprobe/ffmpeg can read).
// options.sourceVocalPath: the completed song's isolated pre-conversion vocal to convert once
// training finishes. options.postProcess(convertedVocalPath, workDir): the caller's shared
// gain-match + silence-gate chain (same one Seed-VC/Vevo2 use) -- this module calls it but
// doesn't own it, since it lives in server.mjs alongside the other SVC engines.
// Mutates `job` in place through every status transition and returns the final gated vocal path,
// or throws (after recording job.status='failed'/job.error) if any step fails.
export async function startDdspJob(ddspSvcRoot, job, referenceFilePaths, { spawnImpl, sourceVocalPath, postProcess, featureEncoder, pitchExtractor, vocoder }) {
  const selectedEncoderKey = DDSP_ENCODERS[featureEncoder] ? featureEncoder : 'contentvec';
  const selectedEncoder = DDSP_ENCODERS[selectedEncoderKey];
  const selectedPitchExtractor = DDSP_PITCH_EXTRACTORS.has(pitchExtractor) ? pitchExtractor : 'rmvpe';
  const selectedVocoderKey = DDSP_VOCODERS[vocoder] ? vocoder : 'nsf_hifigan';
  const selectedVocoder = DDSP_VOCODERS[selectedVocoderKey];
  job.featureEncoder = selectedEncoderKey;
  job.pitchExtractor = selectedPitchExtractor;
  job.vocoder = selectedVocoderKey;
  const pythonExe = path.join(ddspSvcRoot, '.venv', 'Scripts', 'python.exe');
  const jobRelDir = path.join('data', `job-${job.id}`).split(path.sep).join('/');
  const trainDir = path.join(ddspSvcRoot, 'data', `job-${job.id}`, 'train', 'audio');
  const valDir = path.join(ddspSvcRoot, 'data', `job-${job.id}`, 'val', 'audio');
  const expRelDir = path.join('exp', `job-${job.id}`).split(path.sep).join('/');
  const expDir = path.join(ddspSvcRoot, 'exp', `job-${job.id}`);
  const configRelPath = path.join('configs', `job-${job.id}.yaml`);
  const configPath = path.join(ddspSvcRoot, configRelPath);
  job.expdir = expDir;
  job.configPath = configPath;

  try {
    await mkdir(trainDir, { recursive: true });
    await mkdir(valDir, { recursive: true });

    let copied = 0;
    for (const filePath of referenceFilePaths) {
      const durationSeconds = await ffprobeDurationSeconds(spawnImpl, filePath);
      if (durationSeconds === null || durationSeconds < MIN_CLIP_DURATION_SECONDS) {
        job.skippedRefs.push(path.basename(filePath));
        continue;
      }
      await copyFile(filePath, path.join(trainDir, `clip-${String(copied).padStart(3, '0')}.wav`));
      copied += 1;
    }
    if (copied === 0) throw new Error('레퍼런스 클립이 모두 2초 미만이라 학습할 데이터가 없습니다.');
    // train_reflow.py's validation pass just needs *something* in val/audio to run -- this is a
    // quick per-user timbre model, not a research run where train/val leakage would matter, so
    // reusing one training clip is fine (avoids draw.py's own min/max sampling assumptions, which
    // don't hold up against a dataset this small).
    await copyFile(path.join(trainDir, 'clip-000.wav'), path.join(valDir, 'clip-000.wav'));

    // The template's interval_val (2000) only saves a checkpoint every 2000 steps -- for any
    // targetStep below that, the kill fires before a single checkpoint is ever written and
    // latestCheckpoint() below finds nothing. Scale interval_val down for small targetStep values
    // (capped at the template's own default so normal-length runs are unaffected).
    const intervalVal = Math.max(10, Math.min(2000, Math.floor(job.targetStep / 4)));
    const template = await readFile(path.join(ddspSvcRoot, 'configs', 'reflow.yaml'), 'utf8');
    const patched = template
      .replace(/(\n\s*f0_extractor:\s*)\S+/, `$1'${selectedPitchExtractor}'`)
      .replace(/(\n\s*encoder:\s*)\S+/, `$1'${selectedEncoder.name}'`)
      .replace(/(\n\s*encoder_hop_size:\s*)\S+/, `$1${selectedEncoder.hopSize}`)
      .replace(/(\n\s*encoder_out_channels:\s*)\S+/, `$1${selectedEncoder.channels}`)
      .replace(/(\n\s*encoder_ckpt:\s*)\S+/, `$1${selectedEncoder.checkpoint}`)
      .replace(/(\n\s*ckpt:\s*)\S+/, `$1'${selectedVocoder}'`)
      .replace(/(\n\s*train_path:\s*)\S+/, `$1${jobRelDir}/train`)
      .replace(/(\n\s*valid_path:\s*)\S+/, `$1${jobRelDir}/val`)
      .replace(/(\n\s*expdir:\s*)\S+/, `$1${expRelDir}`)
      .replace(/(\n\s*interval_val:\s*)\S+/, `$1${intervalVal}`);
    await writeFile(configPath, patched, 'utf8');

    job.status = 'preprocessing';
    job.updatedAt = Date.now();
    await runToCompletion(spawnImpl, pythonExe, ['preprocess.py', '-c', configRelPath, '-j', '2'], ddspSvcRoot);

    job.status = 'training';
    job.updatedAt = Date.now();
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl(pythonExe, ['train_reflow.py', '-c', configRelPath], { cwd: ddspSvcRoot, windowsHide: true });
      } catch (error) {
        reject(error);
        return;
      }
      job.child = child;
      let buffer = '';
      let killedAtTarget = false;
      const onChunk = (data) => {
        buffer += data.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const stepMatch = line.match(STEP_LOG_PATTERN);
          const lossMatch = line.match(LOSS_LOG_PATTERN);
          if (stepMatch) { job.currentStep = Number(stepMatch[1]); job.updatedAt = Date.now(); }
          if (lossMatch) job.currentLoss = Number(lossMatch[1]);
          // Checked inline, in the same handler that just parsed the step number -- this is the
          // part that was missing before (detection existed, killing on detection did not).
          if (!killedAtTarget && job.currentStep >= job.targetStep) {
            killedAtTarget = true;
            child.kill();
          }
        }
      };
      child.stdout?.on('data', onChunk);
      child.stderr?.on('data', onChunk);
      child.once('error', (error) => { job.child = null; reject(error); });
      child.once('close', () => { job.child = null; resolve(); });
    });

    job.status = 'inferring';
    job.updatedAt = Date.now();
    const checkpoint = await latestCheckpoint(expDir);
    if (!checkpoint) throw new Error('학습된 체크포인트를 찾지 못했습니다.');
    job.checkpointPath = checkpoint;

    const outputDir = path.join(expDir, 'output');
    await mkdir(outputDir, { recursive: true });
    const convertedVocalPath = path.join(outputDir, 'converted.wav');
    await runToCompletion(spawnImpl, pythonExe, [
      'main_reflow.py', '-m', checkpoint, '-i', sourceVocalPath, '-o', convertedVocalPath,
      '-id', '1', '-k', '0', '-step', '50', '-method', 'euler', '-pe', selectedPitchExtractor,
    ], ddspSvcRoot);

    job.status = 'postprocessing';
    job.updatedAt = Date.now();
    const gatedVocalPath = await postProcess(convertedVocalPath, outputDir);

    job.status = 'completed';
    job.updatedAt = Date.now();
    return gatedVocalPath;
  } catch (error) {
    job.status = 'failed';
    job.error = error.message || String(error);
    job.updatedAt = Date.now();
    throw error;
  }
}

export function killDdspJob(job) {
  if (job.child) { job.child.kill(); job.child = null; }
  if (job.status !== 'completed' && job.status !== 'failed') {
    job.status = 'cancelled';
    job.updatedAt = Date.now();
  }
}
