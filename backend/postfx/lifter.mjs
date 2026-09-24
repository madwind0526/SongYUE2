// Spectral Lifter: cleanup for AI-generated audio. One analysis, then in order: a soft spectral gate
// against hiss, an optional extension of the high band the model rolled off, an optional lift of the
// percussive part, and multiband control of sibilance, shimmer and the top octave; one synthesis at the
// end. Every gain is computed from the mid signal and applied to both channels, so the stereo image
// does not move. (Algorithm of YuE2 Studio's audio-post.)
import { StereoStft, midMagnitudes, applyMask } from './stft.mjs';
import { noiseFloor, smoothOverTime, blurOverFrequency } from './spectral.mjs';
import { keepBelow } from './common.mjs';

export const LIFTER_DEFAULTS = { denoiseStrength: 0.3, noiseFloor: 0.1, hfMix: 0, transientBoost: 0, shimmerReductionDb: 6 };

const SIZE = 2048;
const HOP = 512;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const hzToBin = (hz, rate, bins) => Math.min(Math.floor((hz * SIZE) / rate), bins - 1);

// The bin where the mean spectrum falls fastest between 12 and 16 kHz.
function rollOffBin(magnitudes, frames, bins, rate) {
  const mean = new Float64Array(bins);
  for (let frame = 0; frame < frames; frame += 1) for (let bin = 0; bin < bins; bin += 1) mean[bin] += magnitudes[frame * bins + bin];
  let reference = 0;
  for (let bin = 0; bin < bins; bin += 1) reference = Math.max(reference, mean[bin]);
  const lo = hzToBin(12000, rate, bins);
  const hi = hzToBin(16000, rate, bins);
  if (reference <= 1e-10 || lo + 1 >= hi) return hi;
  const db = (bin) => 20 * Math.log10(Math.max(mean[bin], 1e-10) / reference);
  let steepest = [0, lo];
  for (let bin = lo; bin < hi; bin += 1) {
    const drop = db(bin + 1) - db(bin);
    if (drop < steepest[0]) steepest = [drop, bin];
  }
  return steepest[1];
}

function gate(magnitudes, frames, bins, strength, floor) {
  const noise = noiseFloor(magnitudes, frames, bins, 0.05);
  const overSubtraction = 0.5 + 3.5 * strength;
  const mask = new Float32Array(magnitudes.length);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      const threshold = noise[bin] * overSubtraction;
      const softness = Math.max(threshold * 0.3, 1e-8);
      mask[frame * bins + bin] = 1 / (1 + Math.exp(-(magnitudes[frame * bins + bin] - threshold) / softness));
    }
  }
  smoothOverTime(mask, frames, bins, 0.3, 0.5 + 0.49 * 0.7);
  blurOverFrequency(mask, frames, bins, 4);
  for (let index = 0; index < mask.length; index += 1) mask[index] = Math.max(mask[index], floor);
  return mask;
}

// Copies the 8 to 16 kHz band above the roll-off, fading out as it climbs.
function extendHighBand(spec, rate, rollOff, mix) {
  const { bins, frames } = spec;
  const sourceLo = Math.max(hzToBin(8000, rate, bins), 1);
  const sourceHi = hzToBin(16000, rate, bins);
  const rollOffHz = (rollOff * rate) / SIZE;
  const destination = Math.max(hzToBin(Math.max(rollOffHz - 1000, 12000), rate, bins), 1);
  const span = sourceHi - sourceLo;
  if (span <= 0) return;
  const copy = new Float32Array(span);
  for (let frame = 0; frame < frames; frame += 1) {
    const base = frame * bins;
    for (const plane of [spec.lre, spec.lim, spec.rre, spec.rim]) {
      for (let index = 0; index < span; index += 1) copy[index] = plane[base + sourceLo + index];
      for (let index = 0; index < span; index += 1) {
        const target = destination + index;
        if (target >= bins) break;
        plane[base + target] += copy[index] * (mix * (1 - index / span) ** 2);
      }
    }
  }
}

// Gains above 1 where a bin stands out of its neighbours in frequency (the percussive part).
function percussiveMask(magnitudes, frames, bins, boost) {
  const WIDTH = 15;
  const mask = new Float32Array(magnitudes.length);
  const window = new Float32Array(WIDTH);
  for (let frame = 0; frame < frames; frame += 1) {
    const base = frame * bins;
    for (let bin = 0; bin < bins; bin += 1) {
      for (let k = 0; k < WIDTH; k += 1) {
        const index = Math.min(bins - 1, Math.max(0, bin + k - (WIDTH >> 1)));
        window[k] = magnitudes[base + index];
      }
      // insertion sort of 15 values
      for (let i = 1; i < WIDTH; i += 1) {
        const value = window[i];
        let j = i - 1;
        while (j >= 0 && window[j] > value) { window[j + 1] = window[j]; j -= 1; }
        window[j + 1] = value;
      }
      const median = window[WIDTH >> 1];
      const signal = magnitudes[base + bin];
      const ratio = signal > 1e-10 ? Math.min(signal / (median + 1e-10), 4) : 0;
      mask[base + bin] = 1 + boost * clamp(ratio - 1, 0, 1);
    }
  }
  return mask;
}

// Per-frame gain on three bands where their energy passes a percentile.
function bandDynamics(magnitudes, frames, bins, rate, shimmerDb) {
  const mask = new Float32Array(magnitudes.length).fill(1);
  const bands = [[5000, 8000, 3, 0.8], [10000, 14000, shimmerDb, 0.6], [18000, 24000, 12, 0.5]];
  for (const [loHz, hiHz, reductionDb, percentile] of bands) {
    if (reductionDb <= 0) continue;
    const lo = hzToBin(loHz, rate, bins);
    const hi = Math.min(Math.floor((hiHz * SIZE) / rate), bins);
    if (lo >= hi) continue;
    const energy = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      for (let bin = lo; bin < hi; bin += 1) sum += magnitudes[frame * bins + bin];
      energy[frame] = sum / (hi - lo);
    }
    const sorted = Float32Array.from(energy).sort();
    const threshold = sorted[Math.min(Math.floor(frames * percentile), frames - 1)];
    const reduced = 10 ** (-reductionDb / 20);
    const gains = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      const e = energy[frame];
      gains[frame] = e > threshold ? reduced + ((1 - reduced) * threshold) / (e + 1e-10) : 1;
    }
    for (let frame = 0; frame < frames; frame += 1) {
      const from = Math.max(0, frame - 2);
      const to = Math.min(frames - 1, frame + 2);
      let sum = 0;
      for (let k = from; k <= to; k += 1) sum += gains[k];
      const smoothed = clamp(sum / (to - from + 1), reduced, 1);
      for (let bin = lo; bin < hi; bin += 1) mask[frame * bins + bin] *= smoothed;
    }
  }
  return mask;
}

export function lift(audio, options = {}) {
  const settings = { ...LIFTER_DEFAULTS, ...options };
  const frames = Math.min(audio.left.length, audio.right.length);
  const enabled = settings.denoiseStrength > 0 || settings.hfMix > 0 || settings.transientBoost > 0 || settings.shimmerReductionDb > 0;
  if (!enabled || frames < SIZE) return audio;
  const stft = new StereoStft(SIZE, HOP);
  const spec = stft.analyze(audio.left, audio.right);
  const { rate } = audio;
  const magnitudes = midMagnitudes(spec);
  const rollOff = rollOffBin(magnitudes, spec.frames, spec.bins, rate);

  if (settings.denoiseStrength > 0) applyMask(spec, gate(magnitudes, spec.frames, spec.bins, clamp(settings.denoiseStrength, 0, 1), clamp(settings.noiseFloor, 0.01, 0.5)));
  if (settings.hfMix > 0) extendHighBand(spec, rate, rollOff, clamp(settings.hfMix, 0, 0.5));
  if (settings.transientBoost > 0) applyMask(spec, percussiveMask(midMagnitudes(spec), spec.frames, spec.bins, clamp(settings.transientBoost, 0, 1)));
  if (settings.shimmerReductionDb > 0) applyMask(spec, bandDynamics(midMagnitudes(spec), spec.frames, spec.bins, rate, clamp(settings.shimmerReductionDb, 0, 12)));

  const out = stft.synthesize(spec);
  keepBelow(out, 0.999);
  return { left: out.left, right: out.right, rate };
}
