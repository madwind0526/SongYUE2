// Measures what a polish run changed, so the result can be checked by numbers as well as by ear.
// Audio is { left, right, rate } with Float32Array channels of equal length (before and after).
import { Fft } from './fft.mjs';

const FRAME = 4096;
const BANDS = [[0, 200, '저음 ~200 Hz'], [200, 1000, '중저음 200~1k'], [1000, 4000, '중음 1~4k'], [4000, 8000, '중고음 4~8k'], [8000, 12000, '고음 8~12k'], [12000, 22050, '초고음 12k~']];
const db = (value) => 20 * Math.log10(Math.max(value, 1e-9));
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

function rms(values) {
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index] * values[index];
  return Math.sqrt(sum / Math.max(1, values.length));
}

// Average power (dB) of each band over the whole track (mid channel, Hann frames, half overlap).
function bandLevels(audio) {
  const fft = Fft.of(FRAME);
  const window = new Float64Array(FRAME);
  for (let index = 0; index < FRAME; index += 1) window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / FRAME);
  const power = new Float64Array(FRAME / 2);
  let frames = 0;
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  for (let start = 0; start + FRAME <= audio.left.length; start += FRAME / 2) {
    for (let index = 0; index < FRAME; index += 1) { re[index] = ((audio.left[start + index] + audio.right[start + index]) / 2) * window[index]; im[index] = 0; }
    fft.transform(re, im);
    for (let bin = 0; bin < FRAME / 2; bin += 1) power[bin] += re[bin] * re[bin] + im[bin] * im[bin];
    frames += 1;
  }
  const binHz = audio.rate / FRAME;
  return BANDS.map(([low, high]) => {
    let sum = 0;
    let count = 0;
    for (let bin = Math.max(1, Math.floor(low / binHz)); bin < Math.min(FRAME / 2, Math.ceil(high / binHz)); bin += 1) { sum += power[bin]; count += 1; }
    return count && frames ? 10 * Math.log10(Math.max(sum / count / frames, 1e-18)) : -180;
  });
}

// Level (dB) of the quietest tenth of the track in 50 ms blocks: the noise floor between the notes.
function quietLevel(audio) {
  const block = Math.max(1, Math.round(audio.rate * 0.05));
  const levels = [];
  for (let start = 0; start + block <= audio.left.length; start += block) {
    let sum = 0;
    for (let index = start; index < start + block; index += 1) sum += (audio.left[index] ** 2 + audio.right[index] ** 2) / 2;
    levels.push(sum / block);
  }
  levels.sort((a, b) => a - b);
  return db(Math.sqrt(levels[Math.floor(levels.length * 0.1)] || 0));
}

function peak(audio) {
  let value = 0;
  for (let index = 0; index < audio.left.length; index += 1) value = Math.max(value, Math.abs(audio.left[index]), Math.abs(audio.right[index]));
  return value;
}

// How much of the sound was changed: RMS of (after - before) against the RMS of before, in dB (0 dB = everything changed).
function changeDb(before, after) {
  const difference = new Float32Array(before.left.length * 2);
  for (let index = 0; index < before.left.length; index += 1) { difference[index * 2] = after.left[index] - before.left[index]; difference[index * 2 + 1] = after.right[index] - before.right[index]; }
  const reference = Math.sqrt((rms(before.left) ** 2 + rms(before.right) ** 2) / 2);
  return db(rms(difference) / Math.max(reference, 1e-9));
}

// In plain words: below about -40 dB the two versions are practically the same sound.
export function describeChange(changeInDb) {
  if (changeInDb < -40) return '거의 변화 없음 (귀로 구분하기 어려운 수준)';
  if (changeInDb < -30) return '아주 미세한 변화';
  if (changeInDb < -20) return '미세하지만 비교하면 느껴지는 변화';
  if (changeInDb < -12) return '뚜렷한 변화';
  return '큰 변화';
}

export function measureChange(before, after) {
  const beforeBands = bandLevels(before);
  const afterBands = bandLevels(after);
  const change = changeDb(before, after);
  return {
    changeDb: round(change),
    verdict: describeChange(change),
    loudnessDb: { before: round(db(Math.sqrt((rms(before.left) ** 2 + rms(before.right) ** 2) / 2))), after: round(db(Math.sqrt((rms(after.left) ** 2 + rms(after.right) ** 2) / 2))) },
    peakDb: { before: round(db(peak(before))), after: round(db(peak(after))) },
    quietDb: { before: round(quietLevel(before)), after: round(quietLevel(after)) },
    bands: BANDS.map(([low, high, label], index) => ({ label, deltaDb: round(afterBands[index] - beforeBands[index]) })),
  };
}
