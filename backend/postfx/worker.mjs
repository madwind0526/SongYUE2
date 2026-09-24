// Worker thread entry: runs the polish chain on raw float32 stereo files so the API server stays responsive.
// workerData: { inputRaw, referenceRaw|null, outputRaw, rate, settings }. Messages: { type: 'progress', percent, label }.
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync } from 'node:fs';
import { runPolishChain } from './chain.mjs';

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
  const { inputRaw, referenceRaw, outputRaw, rate, settings } = workerData;
  const audio = readRaw(inputRaw, rate);
  const reference = referenceRaw ? readRaw(referenceRaw, rate) : null;
  const { audio: result } = runPolishChain(audio, settings, { reference, onProgress: (percent, label) => parentPort.postMessage({ type: 'progress', percent, label }) });
  const out = new Float32Array(result.left.length * 2);
  for (let index = 0; index < result.left.length; index += 1) { out[2 * index] = result.left[index]; out[2 * index + 1] = result.right[index]; }
  writeFileSync(outputRaw, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  parentPort.postMessage({ type: 'done' });
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error?.message || String(error) });
}
