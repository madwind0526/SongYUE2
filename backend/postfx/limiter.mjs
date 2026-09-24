// The Hyrax brickwall limiter of matchering: a gain envelope from the hard-clip gain, smoothed by a
// zero-phase attack filter and a hold/release pair of first-order Butterworth low-passes.
// Envelopes are stored as Float32Array (gains in 0..1); the filters run in double precision.

export const LIMITER_DEFAULTS = { attackMs: 1, holdMs: 1, releaseMs: 3000, attackFilterCoefficient: -2, holdFilterCoefficient: 7, releaseFilterCoefficient: 800 };

const msToSamples = (ms, rate) => Math.floor(rate * ms * 1e-3);

// Maximum over a centred window of `size` (odd), edges clipped.
function centredMax(x, size) {
  const half = size >> 1;
  const n = x.length;
  const out = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < n; i += 1) {
    const hi = Math.min(i + half, n - 1);
    while (next <= hi) {
      while (tail > head && x[queue[tail - 1]] <= x[next]) tail -= 1;
      queue[tail] = next; tail += 1; next += 1;
    }
    const lo = Math.max(0, i - half);
    while (queue[head] < lo) head += 1;
    out[i] = x[queue[head]];
  }
  return out;
}

// Maximum over the `size` samples ending at each one (zeros before the start).
function trailingMax(x, size) {
  const n = x.length;
  const out = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i += 1) {
    while (tail > head && x[queue[tail - 1]] <= x[i]) tail -= 1;
    queue[tail] = i; tail += 1;
    while (queue[head] + size <= i) head += 1;
    out[i] = Math.max(x[queue[head]], 0);
  }
  return out;
}

// First-order Butterworth low-pass, bilinear with pre-warping (SciPy butter(1, fc, fs=rate)).
function butter1(cutoff, rate) {
  const k = Math.tan((Math.PI * cutoff) / rate);
  const b = k / (1 + k);
  return { b0: b, b1: b, a1: (k - 1) / (k + 1) };
}

// lfilter for a first-order section, from rest.
function lfilter1({ b0, b1, a1 }, x) {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let y1 = 0;
  for (let index = 0; index < x.length; index += 1) {
    const xi = x[index];
    const yi = b0 * xi + b1 * x1 - a1 * y1;
    y[index] = yi;
    x1 = xi; y1 = yi;
  }
  return y;
}

// SciPy filtfilt(b=[1-c], a=[1,-c], x): odd extension of 6 samples at both ends, steady-state initial
// conditions, forward then backward.
function filtfiltOnePole(c, x) {
  const n = x.length;
  const pad = Math.min(6, Math.max(0, n - 1));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 1; i <= pad; i += 1) ext[pad - i] = 2 * x[0] - x[i];
  for (let i = 0; i < n; i += 1) ext[pad + i] = x[i];
  for (let i = 1; i <= pad; i += 1) ext[pad + n + i - 1] = 2 * x[n - 1] - x[n - 1 - i];
  const b0 = 1 - c;
  let state = c * ext[0];
  for (let i = 0; i < ext.length; i += 1) { const yi = b0 * ext[i] + state; state = c * yi; ext[i] = yi; }
  state = c * ext[ext.length - 1];
  for (let i = ext.length - 1; i >= 0; i -= 1) { const yi = b0 * ext[i] + state; state = c * yi; ext[i] = yi; }
  return Float32Array.from(ext.subarray(pad, pad + n));
}

// Limits stereo audio in place to `threshold`.
export function limit(left, right, rate, threshold, options = {}) {
  const config = { ...LIMITER_DEFAULTS, ...options };
  const n = Math.min(left.length, right.length);
  if (n === 0) return;
  const hard = new Float32Array(n);
  let limited = false;
  for (let i = 0; i < n; i += 1) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const rectified = Math.max(peak, threshold) / threshold;
    if (Math.abs(rectified - 1) > 1e-8 + 1e-5) limited = true;
    hard[i] = 1 - 1 / rectified;
  }
  if (!limited) return;
  const attack = Math.max(msToSamples(config.attackMs, rate), 1);
  const odd = attack % 2 === 0 ? attack + 1 : attack;
  const slided = centredMax(hard, 2 * odd - 1);
  const c = Math.exp(config.attackFilterCoefficient / attack);
  const gainAttack = filtfiltOnePole(c, slided);
  const hold = Math.max(msToSamples(config.holdMs, rate), 1);
  const held = trailingMax(slided, hold);
  const holdOut = lfilter1(butter1(config.holdFilterCoefficient, rate), held);
  const releaseIn = new Float32Array(n);
  for (let i = 0; i < n; i += 1) releaseIn[i] = Math.max(held[i], holdOut[i]);
  const releaseOut = lfilter1(butter1(config.releaseFilterCoefficient / config.releaseMs, rate), releaseIn);
  for (let i = 0; i < n; i += 1) {
    const g = Math.max(hard[i], gainAttack[i], holdOut[i], releaseOut[i]);
    const gain = 1 - g;
    left[i] *= gain;
    right[i] *= gain;
  }
}
