// Lyric sync (karaoke / LRC): maps the words a speech recognizer heard (with word times from the forced aligner)
// onto the song's known lyric lines. The recognizer is imperfect on singing (missed intro, hallucinated hums,
// misspellings), so the two texts are aligned character by character with an edit-distance alignment; every
// lyric character that lines up with a heard character takes its time, the rest is interpolated.

const LETTER = /[\p{L}\p{N}]/u;
const RATE = 16000;

// Lyric lines without the [Section] tag lines and blank lines.
export function lyricLines(lyrics) {
  return String(lyrics || '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^\[[^\]]*\]$/.test(line));
}

// Dominant script of the lyrics -> UI language id of the recognizer (ko / ja / zh / en).
export function detectLanguage(text) {
  let hangul = 0; let kana = 0; let han = 0; let latin = 0;
  for (const char of String(text)) {
    if (/[가-힯ᄀ-ᇿ]/.test(char)) hangul += 1;
    else if (/[぀-ヿ]/.test(char)) kana += 1;
    else if (/[一-鿿]/.test(char)) han += 1;
    else if (/[A-Za-z]/.test(char)) latin += 1;
  }
  if (kana > 0 && kana >= hangul) return 'ja';
  if (hangul > 0 && hangul >= latin * 0.5) return 'ko';
  if (han > latin) return 'zh';
  return 'en';
}

// Characters of the lyrics that take part in the alignment: { ch, line, word } (letters and digits only).
function lyricChars(lines) {
  const chars = [];
  lines.forEach((line, lineIndex) => {
    line.split(/\s+/).filter(Boolean).forEach((word, wordIndex) => {
      for (const char of word) if (LETTER.test(char)) chars.push({ ch: char.toLowerCase(), line: lineIndex, word: wordIndex });
    });
  });
  return chars;
}

// Characters the recognizer heard, each with the time slice it occupies inside its word: { ch, time, end }.
function heardChars(words) {
  const chars = [];
  for (const word of words) {
    const letters = [...String(word.word)].filter((char) => LETTER.test(char));
    if (!letters.length) continue;
    const start = word.start_sample / RATE;
    const end = word.end_sample / RATE;
    // each character owns an equal slice of its word: `time` is where the slice starts, `end` where it ends
    letters.forEach((char, index) => chars.push({ ch: char.toLowerCase(), time: start + (index / letters.length) * (end - start), end: start + ((index + 1) / letters.length) * (end - start) }));
  }
  return chars;
}

// Global alignment (edit distance): returns for every lyric character the index of the heard character it
// lines up with, or -1 when the recognizer missed it.
function alignChars(lyric, heard) {
  const n = lyric.length;
  const m = heard.length;
  const width = m + 1;
  const trace = new Uint8Array((n + 1) * width); // 1 diagonal, 2 up (lyric char missed), 3 left (extra heard char)
  let previous = new Int32Array(width);
  let current = new Int32Array(width);
  for (let j = 1; j <= m; j += 1) { previous[j] = j; trace[j] = 3; }
  for (let i = 1; i <= n; i += 1) {
    current[0] = i;
    trace[i * width] = 2;
    for (let j = 1; j <= m; j += 1) {
      const diagonal = previous[j - 1] + (lyric[i - 1].ch === heard[j - 1].ch ? 0 : 1);
      const up = previous[j] + 1;
      const left = current[j - 1] + 1;
      let best = diagonal;
      let move = 1;
      if (up < best) { best = up; move = 2; }
      if (left < best) { best = left; move = 3; }
      current[j] = best;
      trace[i * width + j] = move;
    }
    [previous, current] = [current, previous];
  }
  const mapping = new Int32Array(n).fill(-1);
  const matchedExact = new Uint8Array(n);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const move = i === 0 ? 3 : j === 0 ? 2 : trace[i * width + j];
    if (move === 1) { mapping[i - 1] = j - 1; matchedExact[i - 1] = lyric[i - 1].ch === heard[j - 1].ch ? 1 : 0; i -= 1; j -= 1; }
    else if (move === 2) i -= 1;
    else j -= 1;
  }
  return { mapping, matchedExact };
}

const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[sorted.length >> 1] : 0; };

// lines: lyric lines; words: [{ word, start_sample, end_sample }] at 16 kHz from the recognizer.
// Returns { lines: [{ text, start, end, confidence, estimated, words: [{ text, start, end }] }], coverage }.
export function alignLyrics(lines, words) {
  const lyric = lyricChars(lines);
  const heard = heardChars(words);
  if (!lyric.length || !heard.length) throw new Error('인식된 가사가 없어 싱크를 만들 수 없습니다.');
  const { mapping, matchedExact } = alignChars(lyric, heard);
  const charDuration = Math.max(0.05, median(words.map((word) => (word.end_sample - word.start_sample) / RATE / Math.max(1, [...String(word.word)].length))));

  // time of each lyric character: matched -> the heard time, otherwise unknown (NaN)
  const times = lyric.map((_, index) => (mapping[index] >= 0 ? heard[mapping[index]].time : Number.NaN));
  const ends = lyric.map((_, index) => (mapping[index] >= 0 ? heard[mapping[index]].end : Number.NaN));

  // group by line
  const perLine = lines.map(() => ({ chars: [], matched: 0, exact: 0 }));
  lyric.forEach((item, index) => { const entry = perLine[item.line]; entry.chars.push(index); if (mapping[index] >= 0) { entry.matched += 1; entry.exact += matchedExact[index]; } });

  // line start times: the first matched character of the line (lines without any match are estimated below)
  const starts = perLine.map((entry) => { const first = entry.chars.find((index) => mapping[index] >= 0); return first === undefined ? Number.NaN : times[first]; });
  const lineEnds = perLine.map((entry) => { const last = [...entry.chars].reverse().find((index) => mapping[index] >= 0); return last === undefined ? Number.NaN : ends[last]; });
  const estimated = starts.map((value) => Number.isNaN(value));

  // fill the unknown lines from their neighbours, proportionally to the number of characters
  const known = starts.map((value, index) => (Number.isNaN(value) ? -1 : index)).filter((index) => index >= 0);
  if (!known.length) throw new Error('가사와 인식된 소리가 맞는 곳을 찾지 못했습니다.');
  const charCount = (index) => Math.max(1, perLine[index].chars.length);
  for (let line = 0; line < lines.length; line += 1) {
    if (!Number.isNaN(starts[line])) continue;
    const before = [...known].reverse().find((index) => index < line);
    const after = known.find((index) => index > line);
    if (before !== undefined && after !== undefined) {
      let total = 0; let upTo = 0;
      for (let k = before; k < after; k += 1) { total += charCount(k); if (k < line) upTo += charCount(k); }
      const span = starts[after] - starts[before];
      starts[line] = starts[before] + (span * upTo) / total;
    } else if (before !== undefined) {
      let offset = 0;
      for (let k = before; k < line; k += 1) offset += charCount(k) * charDuration;
      starts[line] = starts[before] + offset;
    } else {
      let offset = 0;
      for (let k = line; k < after; k += 1) offset += charCount(k) * charDuration;
      starts[line] = Math.max(0, starts[after] - offset);
    }
  }
  // times only move forward
  for (let line = 1; line < lines.length; line += 1) if (starts[line] < starts[line - 1]) starts[line] = starts[line - 1];

  const result = lines.map((text, line) => {
    const start = starts[line];
    const nextStart = line + 1 < lines.length ? starts[line + 1] : Number.NaN;
    let end = !Number.isNaN(lineEnds[line]) && lineEnds[line] >= start ? lineEnds[line] : start + charCount(line) * charDuration;
    if (!Number.isNaN(nextStart)) end = Math.min(Math.max(end, start), nextStart);
    // word times: first matched character of the word, otherwise spread over the line by characters
    const tokens = text.split(/\s+/).filter(Boolean);
    const wordChars = tokens.map((_, wordIndex) => perLine[line].chars.filter((index) => lyric[index].word === wordIndex));
    const totalChars = wordChars.reduce((sum, chars) => sum + Math.max(1, chars.length), 0);
    let consumed = 0;
    const wordsOut = tokens.map((token, wordIndex) => {
      const chars = wordChars[wordIndex];
      const weight = Math.max(1, chars.length);
      const guessStart = start + ((end - start) * consumed) / totalChars;
      const guessEnd = start + ((end - start) * (consumed + weight)) / totalChars;
      consumed += weight;
      const first = chars.find((index) => mapping[index] >= 0);
      const wordStart = first !== undefined ? Math.max(start, Math.min(times[first], end)) : guessStart;
      return { text: token, start: round(wordStart), end: round(Math.max(wordStart, guessEnd)) };
    });
    for (let k = 1; k < wordsOut.length; k += 1) if (wordsOut[k].start < wordsOut[k - 1].start) wordsOut[k].start = wordsOut[k - 1].start;
    const entry = perLine[line];
    return { text, start: round(start), end: round(end), confidence: round(entry.chars.length ? entry.matched / entry.chars.length : 0), estimated: estimated[line], words: wordsOut };
  });
  const matchedTotal = perLine.reduce((sum, entry) => sum + entry.matched, 0);
  return { lines: result, coverage: round(matchedTotal / lyric.length) };
}

const round = (value) => Math.round(value * 100) / 100;

const stamp = (seconds) => {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${(total - minutes * 60).toFixed(2).padStart(5, '0')}`;
};

// LRC text: one timestamped line per lyric line (with title/length tags).
export function toLrc(result, { title = '', durationMs = 0 } = {}) {
  const header = [];
  if (title) header.push(`[ti:${title}]`);
  if (durationMs) header.push(`[length:${stamp(durationMs / 1000).slice(0, 5)}]`);
  return [...header, ...result.lines.map((line) => `[${stamp(line.start)}]${line.text}`)].join('\n') + '\n';
}
