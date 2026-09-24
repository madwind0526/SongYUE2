// Live (streaming) voice conversion on audiocpp_cli: the CLI runs MeanVC2 in streaming mode, reads raw 16 kHz
// mono s16le PCM from stdin and (with AUDIOCPP_STREAM_AUDIO_CHUNKS set, an engine patch documented in
// docs/audiocpp-setup.md) writes every converted chunk to <out-dir>/chunk-XXXXXX.wav, announcing it on stdout.
// This module wraps that process: input goes in through write(), converted chunks come out as events.
import { readFile, rm } from 'node:fs/promises';
import { readWavPcm16 } from './speechedit.mjs';

export const REALTIME_INPUT_RATE = 16000;
// MeanVC2 consumes 160 ms of audio per step.
export const REALTIME_CHUNK_SAMPLES = 2560;

export function startRealtimeVcProcess({ spawnImpl, engine, cwd, args }) {
  const child = spawnImpl(engine, args, { windowsHide: true, cwd, env: { ...process.env, AUDIOCPP_STREAM_AUDIO_CHUNKS: '1' } });
  const session = { child, events: [], seq: 0, listeners: new Set(), ready: false, closed: false, exitCode: null, log: '', lastActivity: Date.now(), chunkCount: 0 };
  let pending = '';
  let queue = Promise.resolve();
  const emit = (event) => {
    session.events.push(event);
    if (session.events.length > 400) session.events.shift();
    for (const listener of session.listeners) listener(event);
  };
  const addLog = (data) => { session.log = (session.log + data.toString('utf8')).slice(-3000); };
  child.stdout.on('data', (data) => {
    pending += data.toString('utf8');
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for (const line of lines) {
      if (line.startsWith('audio_input=stdin')) { session.ready = true; emit({ type: 'ready' }); continue; }
      const match = line.match(/^audio_out=(.+chunk-\d+\.wav)$/);
      if (!match) { addLog(`${line}\n`); continue; }
      queue = queue.then(async () => {
        try {
          const { rate, samples } = readWavPcm16(await readFile(match[1]));
          await rm(match[1], { force: true });
          session.seq += 1;
          session.chunkCount += 1;
          emit({ type: 'audio', seq: session.seq, rate, pcm: Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64') });
        } catch { /* a chunk that cannot be read is skipped */ }
      });
    }
  });
  child.stderr?.on('data', addLog);
  const finish = (code) => {
    queue = queue.then(() => {
      if (session.closed) return;
      session.closed = true;
      session.exitCode = code;
      emit({ type: 'end', code });
    });
  };
  child.once('error', () => finish(-1));
  child.once('close', (code) => finish(code));
  session.write = (buffer) => {
    session.lastActivity = Date.now();
    if (!session.closed && child.stdin && !child.stdin.destroyed) child.stdin.write(buffer);
  };
  session.endInput = () => { try { child.stdin?.end(); } catch { /* already closed */ } };
  session.waitClosed = (timeoutMs) => new Promise((resolve) => {
    if (session.closed) { resolve(true); return; }
    const timer = setTimeout(() => { session.listeners.delete(onEvent); resolve(false); }, timeoutMs);
    const onEvent = (event) => { if (event.type === 'end') { clearTimeout(timer); session.listeners.delete(onEvent); resolve(true); } };
    session.listeners.add(onEvent);
  });
  return session;
}
