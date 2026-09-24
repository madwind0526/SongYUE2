// Noise reduction for generated audio: the steady hiss and fizz a decoder leaves under the music.
// The noise floor of each bin comes from the quietest frames of the track itself, and a Wiener-style
// power subtraction removes that much from every frame; gains are smoothed over time and frequency
// against musical noise and applied to both channels alike. (Algorithm of YuE2 Studio's audio-post.)
import { StereoStft, midMagnitudes, applyMask } from './stft.mjs';
import { noiseFloor, smoothOverTime, blurOverFrequency } from './spectral.mjs';

export const DENOISE_DEFAULTS = { strength: 0.4, smoothing: 0.5, mix: 1 };

const SIZE = 8192;
const HOP = SIZE / 4;
const FLOOR = 0.02;
const NOISE_PERCENTILE = 0.1;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export function denoise(audio, options = {}) {
  const settings = { ...DENOISE_DEFAULTS, ...options };
  const strength = clamp(settings.strength, 0, 1);
  const smoothing = clamp(settings.smoothing, 0, 1);
  const mix = clamp(settings.mix, 0, 1);
  const frames = Math.min(audio.left.length, audio.right.length);
  if (strength <= 0 || mix <= 0 || frames < SIZE) return audio;
  const stft = new StereoStft(SIZE, HOP);
  const spec = stft.analyze(audio.left, audio.right);
  const magnitudes = midMagnitudes(spec);
  const noise = noiseFloor(magnitudes, spec.frames, spec.bins, NOISE_PERCENTILE);
  const overSubtraction = 0.5 + 3.5 * strength;
  const mask = new Float32Array(magnitudes.length);
  for (let frame = 0; frame < spec.frames; frame += 1) {
    for (let bin = 0; bin < spec.bins; bin += 1) {
      const index = frame * spec.bins + bin;
      const signal = magnitudes[index] * magnitudes[index];
      const floor = (noise[bin] * overSubtraction) ** 2;
      // power subtraction: |S| = sqrt(|X|^2 - |N|^2)
      mask[index] = signal > 1e-12 ? Math.max(Math.sqrt(Math.max(0, 1 - floor / signal)), FLOOR) : FLOOR;
    }
  }
  // Mostly over time: a wide blur across bins would spread the low gains around a note onto its own narrow peak.
  smoothOverTime(mask, spec.frames, spec.bins, 0.3, 0.5 + 0.49 * smoothing);
  blurOverFrequency(mask, spec.frames, spec.bins, 1 + Math.round(2 * smoothing));
  applyMask(spec, mask);
  const wet = stft.synthesize(spec);
  if (mix >= 1) return { left: wet.left, right: wet.right, rate: audio.rate };
  const blend = (dry, processed) => { const out = new Float32Array(frames); for (let index = 0; index < frames; index += 1) out[index] = (1 - mix) * dry[index] + mix * processed[index]; return out; };
  return { left: blend(audio.left, wet.left), right: blend(audio.right, wet.right), rate: audio.rate };
}
