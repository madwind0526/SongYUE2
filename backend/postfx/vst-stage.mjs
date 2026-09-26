// The VST3 stage of the polish chain: the audio goes to vst-host.exe (HOT-Step) as a float32 WAV, the plugins of the chain process it there
// and the result is read back. vst-host is a separate process, so a plugin that crashes or hangs cannot take the app down: a run has a time
// limit and the process is killed when it is exceeded. Used inside the polish worker thread (synchronous calls).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const VST_MAX_PLUGINS = 8;
export const VST_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

// 32-bit float stereo WAV (format tag 3)
export function encodeWavFloat32({ left, right }, rate) {
  const frames = left.length;
  const dataBytes = frames * 2 * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 8, 28); buffer.writeUInt16LE(8, 32); buffer.writeUInt16LE(32, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < frames; index += 1) { buffer.writeFloatLE(left[index], 44 + index * 8); buffer.writeFloatLE(right[index], 48 + index * 8); }
  return buffer;
}

// WAV (PCM 16 / 24 / 32 or float 32, any channel count) -> { left, right, rate }; mono is copied to both sides
export function decodeWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV 형식이 아닙니다.');
  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      let tag = buffer.readUInt16LE(body);
      if (tag === 0xfffe && size >= 26) tag = buffer.readUInt16LE(body + 24);
      format = { tag, channels: buffer.readUInt16LE(body + 2), rate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14) };
    } else if (id === 'data') { data = buffer.subarray(body, Math.min(buffer.length, body + size)); break; }
    offset = body + size + (size % 2);
  }
  if (!format || !data) throw new Error('WAV 헤더를 읽을 수 없습니다.');
  const bytes = format.bits / 8;
  const isFloat = format.tag === 3 && format.bits === 32;
  if (!isFloat && !(format.tag === 1 && [16, 24, 32].includes(format.bits))) throw new Error(`지원하지 않는 WAV 형식입니다 (${format.tag}, ${format.bits}비트).`);
  const frames = Math.floor(data.length / (bytes * format.channels));
  const read = (position) => (isFloat ? data.readFloatLE(position) : format.bits === 16 ? data.readInt16LE(position) / 32768 : format.bits === 24 ? data.readIntLE(position, 3) / 8388608 : data.readInt32LE(position) / 2147483648);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const position = index * bytes * format.channels;
    left[index] = read(position);
    right[index] = format.channels > 1 ? read(position + bytes) : left[index];
  }
  return { left, right, rate: format.rate };
}

// vst-host chain file: only the plugins that are switched on; "state" is the saved plugin state (empty when there is none)
export function buildChainConfig(plugins, states) {
  return { plugins: plugins.filter((plugin) => plugin.enabled).map((plugin) => ({ path: plugin.path, enabled: true, state: states?.[plugin.path] || '' })) };
}

// Runs the chain on { left, right, rate } and returns the processed audio, always with the length of the input.
// host: { exe, args (in front of the vst-host arguments), states: { pluginPath: stateFile }, workDir, timeoutMs }
export function runVstChain(audio, plugins, host, spawnSyncImpl = spawnSync) {
  const active = plugins.filter((plugin) => plugin.enabled);
  if (!active.length) return audio;
  mkdirSync(host.workDir, { recursive: true });
  const input = path.join(host.workDir, 'vst-input.wav');
  const output = path.join(host.workDir, 'vst-output.wav');
  const chain = path.join(host.workDir, 'vst-chain.json');
  try {
    writeFileSync(input, encodeWavFloat32(audio, audio.rate));
    writeFileSync(chain, JSON.stringify(buildChainConfig(plugins, host.states)));
    const timeoutMs = host.timeoutMs || VST_PROCESS_TIMEOUT_MS;
    const result = spawnSyncImpl(host.exe, [...(host.args || []), '--process-chain', '--chain', chain, '--input', input, '--output', output], { timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.error?.code === 'ETIMEDOUT') throw new Error(`VST3 플러그인 처리가 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않아 중단했습니다. 플러그인이 멈췄을 수 있습니다.`);
    if (result.error) throw new Error(`VST3 호스트를 실행할 수 없습니다. ${result.error.message}`);
    if (result.status !== 0) throw new Error(`VST3 플러그인 처리에 실패했습니다 (종료 코드 ${result.status}). ${String(result.stderr || '').trim().split(/\r?\n/).slice(-2).join(' ')}`.trim());
    let processed;
    try { processed = decodeWav(readFileSync(output)); } catch (error) { throw new Error(`VST3 처리 결과를 읽을 수 없습니다. ${error.message}`); }
    const frames = audio.left.length;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    const copy = Math.min(frames, processed.left.length);
    left.set(processed.left.subarray(0, copy)); right.set(processed.right.subarray(0, copy));
    return { left, right, rate: audio.rate };
  } finally {
    for (const file of [input, output, chain]) rmSync(file, { force: true });
  }
}
