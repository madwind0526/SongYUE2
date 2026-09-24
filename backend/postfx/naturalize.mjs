// Vocal naturaliser: five band-targeted stages on the full mix that loosen the machine steadiness of a
// generated voice (from ComfyUI_MusicTools by Jean Kassio by way of HOT-Step and YuE2 Studio's
// audio-post). No separation: every stage works in the vocal bands directly, so nothing is lost to a
// split and a remix. The noise is seeded, so the same input and settings give the same result.
import { keepBelow } from './common.mjs';

export const NATURALIZE_DEFAULTS = { amount: 0.5, vibratoRate: 4.5, vibratoDepth: 1, formantStrength: 1, metallicReduction: 1, quantizationMask: 0, transitionSmooth: 1, seed: 1 };

function lowpass(cutoff, rate) {
  const wc = Math.tan((Math.PI * cutoff) / rate);
  const wc2 = wc * wc;
  const norm = 1 / (1 + Math.SQRT2 * wc + wc2);
  return { b0: wc2 * norm, b1: 2 * wc2 * norm, b2: wc2 * norm, a1: 2 * (wc2 - 1) * norm, a2: (1 - Math.SQRT2 * wc + wc2) * norm };
}

function bandpass(low, high, rate) {
  const wl = Math.tan((Math.PI * low) / rate);
  const wh = Math.tan((Math.PI * high) / rate);
  const w0 = Math.sqrt(wl * wh);
  const q = w0 / (wh - wl);
  const alpha = Math.sin(2 * Math.atan(w0)) / (2 * q);
  const cosW0 = (1 - w0 * w0) / (1 + w0 * w0);
  const norm = 1 / (1 + alpha);
  return { b0: alpha * norm, b1: 0, b2: -alpha * norm, a1: -2 * cosW0 * norm, a2: (1 - alpha) * norm };
}

function run(filter, input) {
  const out = new Float64Array(input.length);
  let z1 = 0;
  let z2 = 0;
  for (let index = 0; index < input.length; index += 1) {
    const x = input[index];
    const y = filter.b0 * x + z1;
    z1 = filter.b1 * x - filter.a1 * y + z2;
    z2 = filter.b2 * x - filter.a2 * y;
    out[index] = y;
  }
  return out;
}

// Gaussian noise from a small seeded generator (mulberry32 and Box-Muller).
function gaussian(length, seed) {
  let state = (seed + 0x9e3779b9) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float64Array(length);
  for (let index = 0; index < length; index += 2) {
    const u1 = Math.max(next(), 1e-12);
    const u2 = next();
    const magnitude = Math.sqrt(-2 * Math.log(u1));
    out[index] = magnitude * Math.cos(2 * Math.PI * u2);
    if (index + 1 < length) out[index + 1] = magnitude * Math.sin(2 * Math.PI * u2);
  }
  return out;
}

function channel(audio, rate, s, seed) {
  const amount = s.amount;
  const n = audio.length;
  const source = Float64Array.from(audio);
  const result = Float64Array.from(source);

  // 1. pitch variation, a slow amplitude wobble at the vibrato rate
  if (s.vibratoDepth > 0.01) {
    const depth = 0.002 * amount * s.vibratoDepth;
    for (let index = 0; index < n; index += 1) {
      const phase = Math.sin(2 * Math.PI * s.vibratoRate * (index / rate)) * depth * 2 * Math.PI;
      const modulated = source[index] * (1 + Math.sin(phase) * 0.01 * amount * s.vibratoDepth);
      result[index] = result[index] * 0.7 + modulated * 0.3;
    }
  }
  // 2. formant variation, noise-modulated 200 to 3000 Hz band
  if (s.formantStrength > 0.01) {
    const noise = gaussian(n, seed);
    const band = run(bandpass(200, 3000, rate), source);
    for (let index = 0; index < n; index += 1) result[index] += band[index] * noise[index] * 0.005 * amount * s.formantStrength * 0.15 * amount * s.formantStrength;
  }
  // 3. metallic artefacts, 6 to 10 kHz pulled back
  if (s.metallicReduction > 0.01 && rate > 12000) {
    const band = run(bandpass(6000, Math.min(10000, rate * 0.45), rate), source);
    for (let index = 0; index < n; index += 1) result[index] -= band[index] * 0.3 * amount * s.metallicReduction;
  }
  // 4. quantisation masking, shaped 1 to 4 kHz noise
  if (s.quantizationMask > 0.01) {
    const raw = gaussian(n, seed + 42);
    for (let index = 0; index < n; index += 1) raw[index] *= 0.002 * amount * s.quantizationMask;
    const shaped = run(bandpass(1000, 4000, rate), raw);
    for (let index = 0; index < n; index += 1) result[index] += shaped[index];
  }
  // 5. transition smoothing, the sample-to-sample differential low-passed at 80 Hz
  if (s.transitionSmooth > 0.01) {
    const diff = new Float64Array(n);
    for (let index = 1; index < n; index += 1) diff[index] = result[index] - result[index - 1];
    const smoothed = run(lowpass(80, rate), diff);
    const blend = 0.4 * amount * s.transitionSmooth;
    for (let index = 0; index < n; index += 1) result[index] = result[index] - diff[index] * blend + smoothed[index] * blend;
  }
  return Float32Array.from(result);
}

export function naturalize(audio, options = {}) {
  const settings = { ...NATURALIZE_DEFAULTS, ...options };
  if (settings.amount < 0.01) return audio;
  const out = { left: channel(audio.left, audio.rate, settings, settings.seed), right: channel(audio.right, audio.rate, settings, settings.seed + 1), rate: audio.rate };
  // one gain for both channels, so the balance holds
  keepBelow(out, 0.95);
  return out;
}
