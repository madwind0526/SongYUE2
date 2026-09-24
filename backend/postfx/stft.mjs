// Short-time Fourier analysis/synthesis of a stereo track. The two channels share one complex FFT
// (left as the real part, right as the imaginary part), which halves the work. The signal is padded
// by one window on both sides, so every sample sits under fully overlapped windows and comes back
// from synthesis unchanged when nothing is modified.
import { Fft } from './fft.mjs';

export class StereoStft {
  constructor(size, hop) {
    this.size = size;
    this.hop = hop;
    this.bins = size / 2 + 1;
    this.fft = Fft.of(size);
    this.window = new Float64Array(size);
    for (let index = 0; index < size; index += 1) this.window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  }

  // Spectrogram: { frames, bins, length, lre, lim, rre, rim } with Float32Array [frame * bins + bin].
  analyze(left, right) {
    const { size: n, hop, bins, window } = this;
    const length = Math.min(left.length, right.length);
    const frames = Math.floor((length + 2 * n - n) / hop) + 1;
    const spec = { frames, bins, length, lre: new Float32Array(frames * bins), lim: new Float32Array(frames * bins), rre: new Float32Array(frames * bins), rim: new Float32Array(frames * bins) };
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let frame = 0; frame < frames; frame += 1) {
      const start = frame * hop;
      for (let index = 0; index < n; index += 1) {
        const position = start + index - n;
        if (position >= 0 && position < length) { re[index] = left[position] * window[index]; im[index] = right[position] * window[index]; }
        else { re[index] = 0; im[index] = 0; }
      }
      this.fft.transform(re, im);
      const base = frame * bins;
      for (let bin = 0; bin < bins; bin += 1) {
        const mirror = bin === 0 ? 0 : n - bin;
        spec.lre[base + bin] = (re[bin] + re[mirror]) * 0.5;
        spec.lim[base + bin] = (im[bin] - im[mirror]) * 0.5;
        spec.rre[base + bin] = (im[bin] + im[mirror]) * 0.5;
        spec.rim[base + bin] = (re[mirror] - re[bin]) * 0.5;
      }
    }
    return spec;
  }

  // Returns { left, right } Float32Arrays of spec.length samples.
  synthesize(spec) {
    const { size: n, hop, bins, window } = this;
    const total = spec.length + 3 * n;
    const outLeft = new Float64Array(total);
    const outRight = new Float64Array(total);
    const weight = new Float64Array(total);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const scale = 1 / n;
    for (let frame = 0; frame < spec.frames; frame += 1) {
      const base = frame * bins;
      // DC and Nyquist bins of a real signal carry no imaginary part
      const lastBin = bins - 1;
      for (let bin = 0; bin < bins; bin += 1) {
        const lr = spec.lre[base + bin];
        const li = bin === 0 || bin === lastBin ? 0 : spec.lim[base + bin];
        const rr = spec.rre[base + bin];
        const ri = bin === 0 || bin === lastBin ? 0 : spec.rim[base + bin];
        re[bin] = lr - ri;
        im[bin] = li + rr;
        if (bin > 0 && bin < lastBin) {
          re[n - bin] = lr + ri;
          im[n - bin] = -li + rr;
        }
      }
      this.fft.transform(re, im, true);
      const start = frame * hop;
      for (let index = 0; index < n; index += 1) {
        const w = window[index];
        outLeft[start + index] += re[index] * scale * w;
        outRight[start + index] += im[index] * scale * w;
        weight[start + index] += w * w;
      }
    }
    const left = new Float32Array(spec.length);
    const right = new Float32Array(spec.length);
    for (let index = 0; index < spec.length; index += 1) {
      const w = weight[n + index];
      if (w > 1e-8) { left[index] = outLeft[n + index] / w; right[index] = outRight[n + index] / w; }
    }
    return { left, right };
  }
}

// Magnitudes of the mid signal (L + R) / 2, Float32Array [frame * bins + bin].
export function midMagnitudes(spec) {
  const out = new Float32Array(spec.frames * spec.bins);
  for (let index = 0; index < out.length; index += 1) out[index] = Math.hypot((spec.lre[index] + spec.rre[index]) * 0.5, (spec.lim[index] + spec.rim[index]) * 0.5);
  return out;
}

// Multiplies both channels by one gain per frame and bin, so the stereo image holds.
export function applyMask(spec, mask) {
  for (let index = 0; index < mask.length; index += 1) {
    const gain = mask[index];
    spec.lre[index] *= gain; spec.lim[index] *= gain; spec.rre[index] *= gain; spec.rim[index] *= gain;
  }
}
