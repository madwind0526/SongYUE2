// Numerical pieces of the matchering-style mastering: not-a-knot cubic spline, LOWESS smoothing and
// FFT overlap-add convolution. (Ports of the corresponding modules of YuE2 Studio's audio-post.)
import { Fft } from './fft.mjs';

// Cubic spline interpolation with not-a-knot ends (SciPy interp1d kind="cubic"), extrapolated with the
// end polynomials. x strictly increasing, at least four points.
export class CubicSpline {
  constructor(x, y) {
    const n = x.length;
    if (n < 4 || y.length !== n) throw new Error('a not-a-knot spline needs four points or more');
    this.x = x;
    this.y = y;
    const h = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i += 1) h[i] = x[i + 1] - x[i];
    const slope = (i) => (y[i + 1] - y[i]) / h[i];
    const size = n - 2;
    const lower = new Float64Array(size);
    const diag = new Float64Array(size);
    const upper = new Float64Array(size);
    const rhs = new Float64Array(size);
    for (let row = 0; row < size; row += 1) {
      const i = row + 1;
      lower[row] = h[i - 1];
      diag[row] = 2 * (h[i - 1] + h[i]);
      upper[row] = h[i];
      rhs[row] = 6 * (slope(i) - slope(i - 1));
    }
    const h0 = h[0];
    const h1 = h[1];
    diag[0] += (h0 * (h0 + h1)) / h1;
    upper[0] -= (h0 * h0) / h1;
    lower[0] = 0;
    const ha = h[n - 3];
    const hb = h[n - 2];
    const last = size - 1;
    diag[last] += (hb * (ha + hb)) / ha;
    if (size > 1) { lower[last] -= (hb * hb) / ha; upper[last] = 0; }
    // Thomas algorithm
    const c = new Float64Array(size);
    const d = new Float64Array(size);
    c[0] = upper[0] / diag[0];
    d[0] = rhs[0] / diag[0];
    for (let i = 1; i < size; i += 1) {
      const denom = diag[i] - lower[i] * c[i - 1];
      c[i] = i + 1 < size ? upper[i] / denom : 0;
      d[i] = (rhs[i] - lower[i] * d[i - 1]) / denom;
    }
    const inner = new Float64Array(size);
    inner[size - 1] = d[size - 1];
    for (let i = size - 2; i >= 0; i -= 1) inner[i] = d[i] - c[i] * inner[i + 1];
    const m = new Float64Array(n);
    for (let i = 0; i < size; i += 1) m[i + 1] = inner[i];
    m[0] = ((h0 + h1) * m[1] - h0 * m[2]) / h1;
    m[n - 1] = ((ha + hb) * m[n - 2] - hb * m[n - 3]) / ha;
    this.m = m;
  }

  at(t) {
    const { x, y, m } = this;
    const n = x.length;
    // interval: clamped to the end ones outside the range, which extrapolates
    let lo = 0;
    let hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (x[mid] < t) lo = mid + 1; else hi = mid; }
    let i;
    if (lo < n && x[lo] === t) i = Math.min(lo, n - 2);
    else if (lo === 0) i = 0;
    else i = Math.min(lo - 1, n - 2);
    const x0 = x[i];
    const x1 = x[i + 1];
    const h = x1 - x0;
    const a = (x1 - t) / h;
    const b = (t - x0) / h;
    return a * y[i] + b * y[i + 1] + (((a * a * a - a) * m[i] + (b * b * b - b) * m[i + 1]) * h * h) / 6;
  }
}

// LOWESS: the local linear regression of statsmodels' nonparametric.lowess without robustness passes,
// including its `delta` shortcut of interpolating between regressions closer than `delta`.
export function lowess(x, y, frac, delta) {
  const n = x.length;
  const k = Math.min(Math.max(Math.floor(frac * n + 1e-10), 2), n);
  const fit = new Float64Array(n);
  const weights = new Float64Array(n);
  let left = 0;
  let right = k;
  let i = 0;
  let lastFit = -1;
  for (;;) {
    const xval = x[i];
    while (right < n && xval > (x[left] + x[right]) / 2) { left += 1; right += 1; }
    const radius = Math.max(xval - x[left], x[right - 1] - xval);
    let sum = 0;
    let nonzero = 0;
    for (let j = left; j < right; j += 1) {
      const d = radius > 0 ? Math.min(Math.abs(x[j] - xval) / radius, 1) : 0;
      const w = (1 - d * d * d) ** 3;
      weights[j] = w;
      sum += w;
      if (w > 1e-12) nonzero += 1;
    }
    if (nonzero < 2) fit[i] = y[i];
    else {
      let meanX = 0;
      for (let j = left; j < right; j += 1) { weights[j] /= sum; meanX += weights[j] * x[j]; }
      let spread = 0;
      for (let j = left; j < right; j += 1) spread += weights[j] * (x[j] - meanX) ** 2;
      spread = Math.max(spread, 1e-12);
      let value = 0;
      for (let j = left; j < right; j += 1) value += weights[j] * (1 + ((xval - meanX) * (x[j] - meanX)) / spread) * y[j];
      fit[i] = value;
    }
    // linear interpolation over the points skipped since the last fit
    if (lastFit < i - 1) {
      const from = lastFit;
      const span = x[i] - x[from];
      for (let j = from + 1; j < i; j += 1) { const a = (x[j] - x[from]) / span; fit[j] = a * fit[i] + (1 - a) * fit[from]; }
    }
    // next regression point: the farthest one within delta
    let last = i;
    const cut = x[last] + delta;
    let kNext = last;
    for (let j = last + 1; j < n; j += 1) {
      kNext = j;
      if (x[j] > cut) break;
      if (x[j] === x[last]) { fit[j] = fit[last]; last = j; }
    }
    lastFit = last;
    if (lastFit >= n - 1) break;
    i = Math.max(Math.max(kNext - 1, 0), last + 1);
  }
  return fit;
}

// FIR filtering of a long signal by overlap-add FFT convolution, returning the centred part the length of
// the input (SciPy fftconvolve mode="same"). Two blocks share one complex FFT: the kernel is real, so
// the convolution of a + ib is conv(a) + i conv(b).
export function convolveSame(signal, kernel) {
  const n = signal.length;
  const m = kernel.length;
  if (n === 0 || m === 0) return new Float32Array(n);
  let block = 8192;
  while (block < 4 * m) block *= 2;
  const step = block - m + 1;
  const fft = Fft.of(block);
  const kr = new Float64Array(block);
  const ki = new Float64Array(block);
  for (let index = 0; index < m; index += 1) kr[index] = kernel[index];
  fft.transform(kr, ki);
  const out = new Float64Array(n + m - 1 + block);
  const re = new Float64Array(block);
  const im = new Float64Array(block);
  const scale = 1 / block;
  for (let first = 0; first < n; first += 2 * step) {
    re.fill(0); im.fill(0);
    const endA = Math.min(first + step, n);
    for (let index = first; index < endA; index += 1) re[index - first] = signal[index];
    const second = first + step;
    const endB = Math.min(second + step, n);
    for (let index = second; index < endB; index += 1) im[index - second] = signal[index];
    fft.transform(re, im);
    for (let index = 0; index < block; index += 1) {
      const a = re[index] * kr[index] - im[index] * ki[index];
      const b = re[index] * ki[index] + im[index] * kr[index];
      re[index] = a; im[index] = b;
    }
    fft.transform(re, im, true);
    for (let index = 0; index < block; index += 1) {
      out[first + index] += re[index] * scale;
      if (second < n) out[second + index] += im[index] * scale;
    }
  }
  const offset = (m - 1) >> 1;
  const result = new Float32Array(n);
  for (let index = 0; index < n; index += 1) result[index] = out[offset + index];
  return result;
}
