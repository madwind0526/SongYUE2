// Tests of the post-processing DSP. They mirror the properties asserted by the unit tests of the original
// Rust crate (YuE2 Studio's audio-post): analysis/synthesis identity, hiss goes down while the tone stays,
// length and finiteness, seeded determinism, the spline/LOWESS/convolution maths, the limiter ceiling and
// loudness matching against a reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Fft } from './fft.mjs';
import { StereoStft } from './stft.mjs';
import { denoise } from './denoise.mjs';
import { lift } from './lifter.mjs';
import { naturalize } from './naturalize.mjs';
import { CubicSpline, lowess, convolveSame } from './matchmath.mjs';
import { limit } from './limiter.mjs';
import { master } from './mastering.mjs';
import { runPolishChain, normalizePolishSettings } from './chain.mjs';
import { peakOf, rmsOf } from './common.mjs';

const tone = (frequency, amplitude, seconds, rate) => {
  const n = Math.floor(seconds * rate);
  const left = Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate));
  return { left, right: Float32Array.from(left), rate };
};

test('FFT matches a direct DFT and the inverse restores the signal', () => {
  const n = 64;
  const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 5) * 0.1);
  const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.3) * 0.5);
  const dftRe = new Float64Array(n);
  const dftIm = new Float64Array(n);
  for (let k = 0; k < n; k += 1) for (let t = 0; t < n; t += 1) {
    const angle = (-2 * Math.PI * k * t) / n;
    dftRe[k] += re[t] * Math.cos(angle) - im[t] * Math.sin(angle);
    dftIm[k] += re[t] * Math.sin(angle) + im[t] * Math.cos(angle);
  }
  const fre = Float64Array.from(re);
  const fim = Float64Array.from(im);
  const fft = Fft.of(n);
  fft.transform(fre, fim);
  for (let k = 0; k < n; k += 1) { assert.ok(Math.abs(fre[k] - dftRe[k]) < 1e-9 && Math.abs(fim[k] - dftIm[k]) < 1e-9); }
  fft.transform(fre, fim, true);
  for (let k = 0; k < n; k += 1) { assert.ok(Math.abs(fre[k] / n - re[k]) < 1e-9 && Math.abs(fim[k] / n - im[k]) < 1e-9); }
});

test('STFT analysis then synthesis returns both channels, edges included', () => {
  const left = Float32Array.from({ length: 10000 }, (_, i) => Math.sin(i * 0.031) * 0.5 + ((i % 17) - 8) * 0.01);
  const right = Float32Array.from({ length: 10000 }, (_, i) => Math.cos(i * 0.017) * 0.4 - ((i % 11) - 5) * 0.01);
  for (const [size, hop] of [[2048, 512], [8192, 4096]]) {
    const stft = new StereoStft(size, hop);
    const back = stft.synthesize(stft.analyze(left, right));
    assert.equal(back.left.length, left.length);
    let worst = 0;
    for (let i = 0; i < left.length; i += 1) worst = Math.max(worst, Math.abs(back.left[i] - left[i]), Math.abs(back.right[i] - right[i]));
    assert.ok(worst < 1e-4, `size ${size}: ${worst}`);
  }
});

test('noise reduction: hiss goes down, the tone stays, strength 0 is the original', () => {
  const rate = 48000;
  const n = rate * 6;
  let seed = 12345;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) / (1 << 24) - 0.5; };
  const clean = Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 330 * i) / rate));
  const noisy = Float32Array.from(clean, (c) => c + 0.02 * noise());
  const audio = { left: noisy, right: Float32Array.from(noisy), rate };
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };
  const residual = (x) => {
    const gain = dot(x, clean) / dot(clean, clean);
    let power = 0;
    for (let i = 0; i < x.length; i += 1) power += (x[i] - gain * clean[i]) ** 2;
    return [gain, Math.sqrt(power / x.length)];
  };
  const [, before] = residual(noisy);
  const out = denoise(audio, { strength: 0.6, smoothing: 0.5, mix: 1 });
  const [gain, after] = residual(out.left);
  assert.ok(after < before * 0.7, `residual ${before} -> ${after}`);
  assert.ok(Math.abs(gain - 1) < 0.03, `the tone moved by ${gain}`);
  assert.equal(out.left.length, n);
  const [gainStrong, stronger] = residual(denoise(audio, { strength: 1, smoothing: 0.5, mix: 1 }).left);
  assert.ok(stronger < after && Math.abs(gainStrong - 1) < 0.05, `strength 1 leaves ${stronger}, 0.6 left ${after}`);
  assert.equal(denoise(audio, { strength: 0 }), audio);
});

test('Spectral Lifter keeps the length, stays finite and keeps the left/right balance', () => {
  const rate = 48000;
  const n = rate * 4;
  const left = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin(i * 0.02) + 0.05 * Math.sin(i * 1.7));
  const right = Float32Array.from(left, (v) => v * 0.8);
  const out = lift({ left, right, rate }, { hfMix: 0.2, transientBoost: 0.5 });
  assert.equal(out.left.length, n);
  assert.ok(out.left.every(Number.isFinite) && out.right.every(Number.isFinite));
  const ratio = rmsOf(out.right) ** 2 / rmsOf(out.left) ** 2;
  assert.ok(Math.abs(ratio - 0.64) < 0.02, String(ratio));
});

test('naturalizer: same seed gives the same result, amount 0 changes nothing, peak stays below 0.95', () => {
  const audio = tone(200, 0.5, 2, 44100);
  const a = naturalize(audio);
  const b = naturalize(audio);
  assert.deepEqual(a.left, b.left);
  assert.ok(peakOf(a) <= 0.95 + 1e-6);
  assert.equal(naturalize(audio, { amount: 0 }), audio);
  assert.notDeepEqual(naturalize(audio, { seed: 7 }).left, a.left);
});

test('spline reproduces a cubic, LOWESS keeps a line and smooths noise, convolution matches the direct sum', () => {
  const f = (x) => 2 * x ** 3 - x * x + 3 * x - 1;
  const x = Float64Array.from({ length: 9 }, (_, i) => i * 0.7 + i * i * 0.05);
  const spline = new CubicSpline(x, Float64Array.from(x, f));
  for (const t of [0.1, 1.3, 2.9, 4.4, 6.9, -0.5, 8.0]) assert.ok(Math.abs(spline.at(t) - f(t)) < 1e-8, `at ${t}`);

  const lx = Float64Array.from({ length: 400 }, (_, i) => i / 399);
  const ly = Float64Array.from(lx, (v) => 3 * v - 1);
  const fit = lowess(lx, ly, 0.0375, 0.001);
  for (let i = 0; i < 400; i += 1) assert.ok(Math.abs(fit[i] - ly[i]) < 1e-9);
  const nx = Float64Array.from({ length: 2000 }, (_, i) => i / 1999);
  const ny = Float64Array.from(nx, (v, i) => v + (i % 2 === 0 ? 0.1 : -0.1));
  const smoothed = lowess(nx, ny, 0.05, 0);
  let worst = 0;
  for (let i = 100; i < 1900; i += 1) worst = Math.max(worst, Math.abs(smoothed[i] - nx[i]));
  assert.ok(worst < 0.01, String(worst));

  const signal = Float32Array.from({ length: 20000 }, (_, i) => Math.sin(i * 0.013) + ((i * 7) % 13 - 6) * 0.01);
  const kernel = Float64Array.from({ length: 101 }, (_, i) => Math.min(1, 1 / Math.exp((i - 50) * 0.1)) * 0.05);
  const fast = convolveSame(signal, kernel);
  const offset = (kernel.length - 1) >> 1;
  for (const i of [0, 7, 5000, 12345, 19999]) {
    let direct = 0;
    for (let j = 0; j < kernel.length; j += 1) { const idx = i + offset - j; if (idx >= 0 && idx < signal.length) direct += signal[idx] * kernel[j]; }
    assert.ok(Math.abs(fast[i] - direct) < 1e-4, `at ${i}: ${fast[i]} vs ${direct}`);
  }
});

test('limiter: nothing changes below the threshold, peaks come down to it without limiting too hard', () => {
  const below = { l: new Float32Array(1000).fill(0.5), r: new Float32Array(1000).fill(-0.4) };
  limit(below.l, below.r, 48000, 0.998);
  assert.ok(below.l.every((v) => v === 0.5));
  const l = Float32Array.from({ length: 48000 }, (_, i) => 1.6 * Math.sin(i * 0.05));
  const r = Float32Array.from(l);
  limit(l, r, 48000, 0.998);
  const peak = peakOf({ left: l, right: r });
  assert.ok(peak <= 0.999 && peak > 0.8, `peak ${peak}`);
});

test('mastering brings a quiet track to the reference loudness and keeps peaks below full scale', () => {
  const target = tone(440, 0.05, 20, 48000);
  const reference = tone(440, 0.5, 20, 48000);
  const out = master(target, reference);
  const level = rmsOf(out.left.subarray(48000, out.left.length - 48000));
  const wanted = 0.5 / Math.SQRT2;
  assert.ok(Math.abs(level / wanted - 1) < 0.1, `rms ${level} vs ${wanted}`);
  assert.ok(peakOf(out) <= 1);
  assert.throws(() => master(target, { ...reference, rate: 44100 }), /sample rate/);
  assert.throws(() => master(tone(440, 0.05, 0.05, 48000), reference), /at least/);
});

test('polish chain: settings are clamped, the order is fixed and mastering needs a reference', () => {
  const s = normalizePolishSettings({ denoise: { enabled: true, strength: 9 }, lifter: { enabled: true, shimmerDb: -3, hfMix: 'x' }, unknown: 1 });
  assert.equal(s.denoise.strength, 1);
  assert.equal(s.lifter.shimmerDb, 0);
  assert.equal(s.lifter.hfMix, 0);
  assert.equal(s.master.enabled, false);
  const audio = tone(300, 0.3, 1, 48000);
  const steps = [];
  const result = runPolishChain(audio, { naturalize: { enabled: true }, denoise: { enabled: true } }, { onProgress: (p, label) => steps.push(label) });
  assert.deepEqual(result.stages, ['denoise', 'naturalize']);
  assert.deepEqual(steps, ['노이즈 제거', '보컬 자연화', '완료']);
  assert.throws(() => runPolishChain(audio, {}), /단계/);
  assert.throws(() => runPolishChain(audio, { master: { enabled: true } }), /기준곡/);
});
