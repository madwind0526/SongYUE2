// AudioAuK integration for the "음색 변조" AuK tab -- AudioAuK (C:\Claude\AudioAuK) is a
// sibling local project with its own HTTP API (default http://127.0.0.1:4312), a separate
// ComfyUI-based generation engine (port 8189, independent of SongYUE2's own ComfyUI on 8190),
// and no training step: every conversion is one zero-shot job submitted to POST /api/jobs.
//
// Important architectural constraint (confirmed by reading AudioAuK's own ComfyUI node graph,
// backend/comfy.mjs's workflow(), 2026-09-19): AuKInstructionEncode has exactly ONE optional
// audio input, used EITHER as "content to preserve, timbre described in text" (change-timbre
// shape) OR as "voice identity to clone, content described in text" (voice-cloning shape) -- it
// cannot take a separate source clip AND a separate reference-voice clip in the same job. So
// when the caller supplies a reference clip, this module transcribes the SOURCE vocal first
// (AudioAuK's own Whisper STT route) and asks AuK to speak that transcript in the reference's
// voice -- the result is spoken TTS reciting the source's words, not the source's original
// melody/rhythm. When no reference is supplied, it instead asks AuK to keep the source audio's
// content and change only its described timbre. Both shapes are real product limitations, not a
// missing feature on this module's part -- see the "음색 변조" plan for the UI warning this pairs with.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const AUK_JOB_POLL_INTERVAL_MS = 1500;
const AUK_JOB_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const AUK_HEALTH_TIMEOUT_MS = 1500;
const AUK_STARTUP_POLL_TIMEOUT_MS = 90000;
const AUK_CHECKPOINTS = { flash: 'auk_flash_w4a8.safetensors', base: 'auk_base_w4a8.safetensors' };

async function aukFetchJson(fetchImpl, endpoint, route, options = {}) {
  const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}${route}`, options);
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `AudioAuK 요청 실패 (${response.status})`);
  return data;
}

export async function ensureAudioAukRunning(fetchImpl, spawnImpl, endpoint, audioAukPath) {
  const healthy = async () => {
    try {
      const response = await fetchImpl(`${endpoint.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(AUK_HEALTH_TIMEOUT_MS) });
      return response.ok;
    } catch { return false; }
  };
  if (await healthy()) return;
  // scripts/start-studio.mjs is AudioAuK's only startup entry point -- it also launches its own
  // ComfyUI engine (port 8189) and a Vite dev server for its own UI, which is more than this
  // integration strictly needs, but AudioAuK has no lighter "backend-only" script and the extra
  // processes are harmless idle overhead.
  const child = spawnImpl('node', ['scripts/start-studio.mjs'], { cwd: audioAukPath, detached: true, stdio: 'ignore', windowsHide: true });
  if (typeof child.unref === 'function') child.unref();
  const deadline = Date.now() + AUK_STARTUP_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('AudioAuK를 자동으로 실행하지 못했습니다. AudioAuK 설치 폴더와 연결 주소를 설정에서 확인해 주세요.');
}

async function uploadAukAudio(fetchImpl, endpoint, filePath, filename) {
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  const item = await aukFetchJson(fetchImpl, endpoint, '/api/audio', { method: 'POST', body: form });
  return item.id;
}

async function pollAukJob(fetchImpl, endpoint, jobId) {
  const deadline = Date.now() + AUK_JOB_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const jobs = await aukFetchJson(fetchImpl, endpoint, '/api/jobs');
    const job = jobs.find((item) => item.id === jobId);
    if (!job) throw new Error('AudioAuK 작업을 찾을 수 없습니다.');
    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.error || 'AudioAuK 작업이 실패했습니다.');
    if (job.status === 'cancelled') throw new Error('AudioAuK 작업이 취소되었습니다.');
    await new Promise((resolve) => setTimeout(resolve, AUK_JOB_POLL_INTERVAL_MS));
  }
  throw new Error('AudioAuK 작업이 제한 시간을 넘어 중단되었습니다.');
}

async function selectAukCheckpoint(fetchImpl, endpoint, checkpoint) {
  const model = AUK_CHECKPOINTS[checkpoint] || AUK_CHECKPOINTS.flash;
  await aukFetchJson(fetchImpl, endpoint, '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine: { model } }) });
}

// Submits one already-built {task, instruction, audioId, seconds, seed} job and returns its
// result audio. Shared by submitAukJob() (음색 변조 탭) and submitAukToolJob() (Tools 메뉴) so
// both go through the identical submit-poll-fetch sequence.
async function runAukJob(fetchImpl, endpoint, jobBody) {
  const created = await aukFetchJson(fetchImpl, endpoint, '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jobBody) });
  const finished = await pollAukJob(fetchImpl, endpoint, created.id);
  if (!finished.outputUrl) throw new Error('AudioAuK 작업이 완료되었지만 결과 오디오가 없습니다.');
  const audioResponse = await fetchImpl(`${endpoint.replace(/\/$/, '')}${finished.outputUrl}`);
  if (!audioResponse.ok) throw new Error('AudioAuK 결과 오디오를 받지 못했습니다.');
  const outputBuffer = Buffer.from(await audioResponse.arrayBuffer());
  // finished.outputUrl is "/api/audio/<uuid><ext>" -- AudioAuK names result files by their real
  // container extension (flac by default), so it's the only reliable source for what format
  // outputBuffer actually is.
  const outputExt = path.extname(finished.outputUrl) || '.flac';
  return { outputBuffer, outputExt };
}

// referenceFilePath/textDescription: at least one must be given (validated by the caller/route).
// sourceVocalPath: the completed song's isolated (pre-conversion) vocal, always needed -- either
// as the thing AuK transcribes+clones-into (reference branch) or as the thing AuK edits directly
// (text-only branch).
export async function submitAukJob(fetchImpl, spawnImpl, endpoint, audioAukPath, { referenceFilePath, textDescription, sourceVocalPath, checkpoint }) {
  await ensureAudioAukRunning(fetchImpl, spawnImpl, endpoint, audioAukPath);
  await selectAukCheckpoint(fetchImpl, endpoint, checkpoint);

  const sourceAudioId = await uploadAukAudio(fetchImpl, endpoint, sourceVocalPath, path.basename(sourceVocalPath));
  let transcript = null;
  let jobBody;
  if (referenceFilePath) {
    const referenceAudioId = await uploadAukAudio(fetchImpl, endpoint, referenceFilePath, path.basename(referenceFilePath));
    const transcribeJob = await aukFetchJson(fetchImpl, endpoint, '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioId: sourceAudioId }) });
    const transcribed = await pollAukJob(fetchImpl, endpoint, transcribeJob.id);
    transcript = (transcribed.transcript || '').trim();
    if (!transcript) throw new Error('AudioAuK가 소스 보컬의 가사를 인식하지 못했습니다.');
    const instruction = textDescription
      ? `Say the following with the same voice, ${textDescription}: "${transcript}".`
      : `Say the following with the same voice: "${transcript}".`;
    jobBody = { task: 'tts', instruction, audioId: referenceAudioId, seconds: 0, seed: 0 };
  } else {
    jobBody = { task: 'tts', instruction: `Keep the spoken content unchanged and change the timbre to: "${textDescription}".`, audioId: sourceAudioId, seconds: 0, seed: 0 };
  }
  const result = await runAukJob(fetchImpl, endpoint, jobBody);
  return { ...result, transcript };
}

// "Tools" 메뉴: TASKS 템플릿 하나를 직접 지정해서 돌리는 범용 경로 -- 음색 변조 탭과 달리 완성곡
// 맥락이 없고(독립 오디오 파일 업로드 또는 텍스트만), 전사(transcribe) 같은 특수 분기도 없다.
// instruction은 호출자가 이미 TOOL 템플릿 문자열을 채워서 넘긴다(app/app/studio.tsx의
// AUK_TOOLS 테이블 참고).
export async function submitAukToolJob(fetchImpl, spawnImpl, endpoint, audioAukPath, { task, instruction, audioFilePath, checkpoint, seconds }) {
  await ensureAudioAukRunning(fetchImpl, spawnImpl, endpoint, audioAukPath);
  await selectAukCheckpoint(fetchImpl, endpoint, checkpoint);
  const audioId = audioFilePath ? await uploadAukAudio(fetchImpl, endpoint, audioFilePath, path.basename(audioFilePath)) : undefined;
  return runAukJob(fetchImpl, endpoint, { task, instruction, audioId, seconds: seconds ?? 0, seed: 0 });
}
