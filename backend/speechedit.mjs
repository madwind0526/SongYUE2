// Helpers for sentence-level speech editing: split a recording at silences, then splice re-synthesized
// segments back into the untouched original samples (16-bit mono PCM WAV).

// Parses a PCM16 mono/stereo WAV (as written by ffmpeg) into { rate, samples } (first channel only).
export function readWavPcm16(buffer) {
  let offset = 12;
  let rate = 44100;
  let channels = 1;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      rate = buffer.readUInt32LE(offset + 12);
    } else if (id === 'data') {
      const end = Math.min(buffer.length, offset + 8 + size);
      const frames = Math.floor((end - offset - 8) / (2 * channels));
      const samples = new Int16Array(frames);
      for (let index = 0; index < frames; index += 1) samples[index] = buffer.readInt16LE(offset + 8 + index * 2 * channels);
      return { rate, samples };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV 데이터를 읽지 못했습니다.');
}

export function wavFromPcm16(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) data.writeInt16LE(samples[index], index * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Finds the voiced spans ("sentences") of a recording: runs of speech separated by silences of at least
// `minGapSeconds`. Returns [{ start, end }] in sample indexes, each padded a little so words are not clipped.
export function findSpeechSegments(samples, rate, { minGapSeconds = 0.35, minSegmentSeconds = 0.5, padSeconds = 0.08 } = {}) {
  const frame = Math.max(1, Math.round(rate * 0.02));
  const frames = Math.floor(samples.length / frame);
  if (!frames) return [];
  const rms = new Float64Array(frames);
  let peak = 0;
  for (let index = 0; index < frames; index += 1) {
    let sum = 0;
    for (let offset = 0; offset < frame; offset += 1) { const value = samples[index * frame + offset] / 32768; sum += value * value; }
    rms[index] = Math.sqrt(sum / frame);
    peak = Math.max(peak, rms[index]);
  }
  const threshold = Math.max(0.004, peak * 0.03);
  const minGapFrames = Math.max(1, Math.round(minGapSeconds / 0.02));
  const spans = [];
  let start = -1;
  let lastVoiced = -1;
  for (let index = 0; index < frames; index += 1) {
    if (rms[index] > threshold) {
      if (start < 0) start = index;
      else if (index - lastVoiced > minGapFrames) { spans.push([start, lastVoiced]); start = index; }
      lastVoiced = index;
    }
  }
  if (start >= 0) spans.push([start, lastVoiced]);
  // Very short spans are clicks/breaths: merge them into the closest neighbor instead of editing them alone.
  const minFrames = Math.round(minSegmentSeconds / 0.02);
  const merged = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && (span[1] - span[0] + 1 < minFrames || previous[1] - previous[0] + 1 < minFrames)) previous[1] = span[1];
    else merged.push([...span]);
  }
  const pad = Math.round(padSeconds * rate);
  return merged.map(([first, last]) => ({ start: Math.max(0, first * frame - pad), end: Math.min(samples.length, (last + 1) * frame + pad) }));
}

// Replaces the given spans of `samples` with new PCM (already at the same sample rate); untouched samples stay as they are.
export function spliceSegments(samples, replacements) {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const item of sorted) {
    parts.push(samples.subarray(cursor, item.start), item.samples);
    cursor = item.end;
  }
  parts.push(samples.subarray(cursor));
  const out = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) { out.set(part, position); position += part.length; }
  return out;
}
