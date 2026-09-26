// Worker thread entry: runs the polish chain on raw float32 stereo files so the API server stays responsive.
// workerData: { inputRaw, referenceRaw|null, outputRaw, rate, settings, vstHost|null (see vst-stage.mjs) }. Messages: { type: 'progress', percent, label }, { type: 'report', report } (what the run changed), { type: 'done' }.
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { runPolishChain } from './chain.mjs';
import { measureChange } from './measure.mjs';
import { runVstChain } from './vst-stage.mjs';

function readRaw(file, rate) {
  const buffer = readFileSync(file);
  const samples = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length - (buffer.length % 4)));
  const frames = samples.length >> 1;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) { left[index] = samples[2 * index]; right[index] = samples[2 * index + 1]; }
  return { left, right, rate };
}

try {
  const { inputRaw, referenceRaw, outputRaw, rate, settings, vstHost } = workerData;
  const audio = readRaw(inputRaw, rate);
  // the stages may work in place: keep the untouched original for the before/after measurement
  const original = { left: audio.left.slice(), right: audio.right.slice(), rate };
  const reference = referenceRaw ? readRaw(referenceRaw, rate) : null;
  const { audio: result } = runPolishChain(audio, settings, { reference, vstProcess: vstHost ? (current, plugins) => runVstChain(current, plugins, vstHost) : null, onProgress: (percent, label) => parentPort.postMessage({ type: 'progress', percent, label }) });
  const out = new Float32Array(result.left.length * 2);
  for (let index = 0; index < result.left.length; index += 1) { out[2 * index] = result.left[index]; out[2 * index + 1] = result.right[index]; }
  writeFileSync(outputRaw, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  parentPort.postMessage({ type: 'report', report: measureChange(original, result) });
  parentPort.postMessage({ type: 'done' });
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error?.message || String(error) });
}
