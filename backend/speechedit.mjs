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

// ---- word-level (aligner based) editing ----

// Adds charStart/charEnd (positions inside the transcript) to aligner words, or returns null when a word
// cannot be found in order (then the caller falls back to sentence-level editing).
export function locateWords(transcript, words) {
  const located = [];
  let cursor = 0;
  for (const word of words) {
    const at = transcript.indexOf(word.word, cursor);
    if (at < 0) return null;
    located.push({ ...word, charStart: at, charEnd: at + word.word.length });
    cursor = at + word.word.length;
  }
  return located;
}

// Plans the small windows to re-synthesize. Every edit occurrence is mapped to the aligned words it touches
// (editFirst..editLast); the clip sent to the editor is widened by `contextWords` neighbors on each side so the
// edited words are pronounced naturally, but only the edited words' span is replaced afterwards (the context words
// stay original). Occurrences on adjacent words share one window. Each window carries the clip text (its words
// joined by spaces) and the edits re-positioned inside it (`at`). Returns null when an edit cannot be mapped exactly
// (e.g. it spans punctuation), so the caller can fall back to the whole sentence.
export function planWindows(transcript, words, edits, contextWords = 1) {
  const occurrences = [];
  for (const edit of edits) {
    let start = transcript.indexOf(edit.find);
    while (start >= 0) {
      occurrences.push({ edit, start, end: start + edit.find.length });
      start = edit.all ? transcript.indexOf(edit.find, start + edit.find.length) : -1;
    }
  }
  if (!occurrences.length) return null;
  occurrences.sort((a, b) => a.start - b.start);
  const windows = [];
  for (const occurrence of occurrences) {
    const first = words.findIndex((word) => word.charEnd > occurrence.start);
    let last = -1;
    words.forEach((word, index) => { if (word.charStart < occurrence.end) last = index; });
    if (first < 0 || last < first) return null;
    const previous = windows[windows.length - 1];
    if (previous && first <= previous.editLast + 1) { previous.editLast = Math.max(previous.editLast, last); previous.occurrences.push(occurrence); }
    else windows.push({ editFirst: first, editLast: last, occurrences: [occurrence] });
  }
  for (const window of windows) {
    // A side without enough words (sentence start/end) lends its share of context to the other side: the editor
    // garbles words at the very start of a tiny clip.
    const before = Math.min(contextWords, window.editFirst);
    const after = Math.min(contextWords, words.length - 1 - window.editLast);
    window.first = Math.max(0, window.editFirst - contextWords - (contextWords - after));
    window.last = Math.min(words.length - 1, window.editLast + contextWords + (contextWords - before));
    window.preCount = window.editFirst - window.first;
    window.postCount = window.last - window.editLast;
    const parts = words.slice(window.first, window.last + 1);
    window.text = parts.map((word) => word.word).join(' ');
    const offsets = [];
    let position = 0;
    for (const word of parts) { offsets.push(position); position += word.word.length + 1; }
    window.edits = [];
    for (const { edit, start, end } of window.occurrences) {
      const firstWord = words.findIndex((word) => word.charEnd > start);
      const at = offsets[firstWord - window.first] + (start - words[firstWord].charStart);
      if (window.text.slice(at, at + (end - start)) !== edit.find) return null;
      window.edits.push({ ...edit, at });
    }
    // Sample span (aligner time base) of the whole clip and of the part that gets replaced.
    window.startSample = parts[0].start_sample;
    window.endSample = parts[parts.length - 1].end_sample;
    window.replaceStart = window.preCount ? words[window.editFirst - 1].end_sample : window.startSample;
    window.replaceEnd = window.postCount ? words[window.editLast + 1].start_sample : window.endSample;
  }
  return windows;
}

// Aligner word boundaries have a coarse time grid, so cut points are snapped to the quietest spot (5 ms RMS frames)
// within +-radius of the estimated boundary; ties keep the position closest to the estimate.
export function snapToQuietPoint(samples, center, rate, radiusSeconds = 0.08) {
  const frame = Math.max(1, Math.round(rate * 0.005));
  const from = Math.max(0, center - Math.round(radiusSeconds * rate));
  const to = Math.min(samples.length - frame, center + Math.round(radiusSeconds * rate));
  let best = Math.min(Math.max(center, 0), samples.length);
  let bestEnergy = Number.POSITIVE_INFINITY;
  for (let start = from; start <= to; start += frame) {
    let sum = 0;
    for (let offset = 0; offset < frame; offset += 1) { const value = samples[start + offset]; sum += value * value; }
    const distance = Math.abs(start + frame / 2 - center);
    if (sum < bestEnergy || (sum === bestEnergy && distance < Math.abs(best - center))) { bestEnergy = sum; best = start + Math.round(frame / 2); }
  }
  return best;
}
