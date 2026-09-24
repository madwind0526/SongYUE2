// Mastering to a reference track, the matchering 2 algorithm: the target is brought to the reference's
// loudness and tonal balance. The loudest pieces of both, in mid and side, set an RMS gain and a smoothed
// spectral correction applied as a FIR filter; four passes of RMS correction follow, then the Hyrax
// brickwall limiter. Both tracks must already have the same sample rate. (Port of YuE2 Studio's audio-post.)
import { Fft } from './fft.mjs';
import { CubicSpline, lowess, convolveSame } from './matchmath.mjs';
import { limit, LIMITER_DEFAULTS } from './limiter.mjs';

export const MASTERING_DEFAULTS = {
  maxPieceSeconds: 15,
  threshold: (32768 - 61) / 32768,
  minValue: 1e-6,
  fftSize: 4096,
  linLogOversampling: 4,
  rmsCorrectionSteps: 4,
  lowessFrac: 0.0375,
  lowessDelta: 0.001,
  limiter: LIMITER_DEFAULTS,
};

function rms(values, from = 0, to = values.length) {
  if (to <= from) return 0;
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += values[index] * values[index];
  return Math.sqrt(sum / (to - from));
}

function rmsClamped(values, from, to) {
  let sum = 0;
  for (let index = from; index < to; index += 1) { const v = Math.max(-1, Math.min(1, values[index])); sum += v * v; }
  return Math.sqrt(sum / (to - from));
}

// RMS of each piece, and the RMS of the pieces at or above the overall RMS ("loud" pieces).
function pieceLevels(array, piece, divisions, clamped = false) {
  const rmses = [];
  for (let d = 0; d < divisions; d += 1) rmses.push(clamped ? rmsClamped(array, d * piece, (d + 1) * piece) : rms(array, d * piece, (d + 1) * piece));
  const average = rms(rmses);
  const loud = [];
  for (let d = 0; d < divisions; d += 1) if (rmses[d] >= average) loud.push(d);
  return { loud, matchRms: rms(loud.map((d) => rmses[d])) };
}

function analyze(audio, config) {
  const n = Math.min(audio.left.length, audio.right.length);
  const mid = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { mid[i] = (audio.left[i] + audio.right[i]) * 0.5; side[i] = (audio.left[i] - audio.right[i]) * 0.5; }
  const maxPiece = Math.floor(config.maxPieceSeconds * audio.rate);
  const divisions = Math.floor(n / maxPiece) + 1;
  const piece = Math.floor(n / divisions);
  const { loud, matchRms } = pieceLevels(mid, piece, divisions);
  return {
    mid, side, matchRms, divisions, piece,
    loudMid: loud.map((d) => mid.slice(d * piece, (d + 1) * piece)),
    loudSide: loud.map((d) => side.slice(d * piece, (d + 1) * piece)),
  };
}

// Mean magnitude spectrum over every non-overlapping boxcar frame of every piece (scaled like SciPy's STFT).
function averageSpectrum(pieces, fftSize) {
  const fft = Fft.of(fftSize);
  const bins = fftSize / 2 + 1;
  const sum = new Float64Array(bins);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let frames = 0;
  for (const piece of pieces) {
    const count = piece.length >= fftSize ? Math.floor((piece.length - fftSize) / fftSize) + 1 : 0;
    for (let f = 0; f < count; f += 1) {
      for (let i = 0; i < fftSize; i += 1) { re[i] = piece[f * fftSize + i]; im[i] = 0; }
      fft.transform(re, im);
      for (let b = 0; b < bins; b += 1) sum[b] += Math.hypot(re[b], im[b]) / fftSize;
      frames += 1;
    }
  }
  if (frames > 0) for (let b = 0; b < bins; b += 1) sum[b] /= frames;
  return sum;
}

// The correction FIR from the target's to the reference's spectrum, smoothed on a logarithmic frequency grid.
function correctionFir(target, reference, rate, config) {
  const { fftSize } = config;
  const bins = fftSize / 2 + 1;
  const targetSpectrum = averageSpectrum(target, fftSize);
  const referenceSpectrum = averageSpectrum(reference, fftSize);
  const matching = new Float64Array(bins);
  for (let b = 0; b < bins; b += 1) matching[b] = referenceSpectrum[b] / Math.max(targetSpectrum[b], config.minValue);
  const nyquist = rate * 0.5;
  const linear = new Float64Array(bins);
  for (let b = 0; b < bins; b += 1) linear[b] = (nyquist * b) / (bins - 1);
  const logPoints = (fftSize / 2) * config.linLogOversampling + 1;
  const start = Math.log10(4 / fftSize);
  const logarithmic = new Float64Array(logPoints);
  for (let i = 0; i < logPoints; i += 1) logarithmic[i] = nyquist * 10 ** (start + ((0 - start) * i) / (logPoints - 1));
  const toLog = new CubicSpline(linear, matching);
  const onLog = new Float64Array(logPoints);
  for (let i = 0; i < logPoints; i += 1) onLog[i] = toLog.at(logarithmic[i]);
  const unit = new Float64Array(logPoints);
  for (let i = 0; i < logPoints; i += 1) unit[i] = i / (logPoints - 1);
  const smoothed = lowess(unit, onLog, config.lowessFrac, config.lowessDelta);
  const back = new CubicSpline(logarithmic, smoothed);
  const filtered = new Float64Array(bins);
  for (let b = 0; b < bins; b += 1) filtered[b] = back.at(linear[b]);
  filtered[0] = 0;
  filtered[1] = matching[1];
  // real inverse FFT of the zero-phase response, centred, Hann windowed
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let b = 0; b < bins; b += 1) { re[b] = filtered[b]; if (b > 0 && b < bins - 1) re[fftSize - b] = filtered[b]; }
  Fft.of(fftSize).transform(re, im, true);
  const half = fftSize >> 1;
  const fir = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) {
    const shifted = re[(i + half) % fftSize] / fftSize;
    fir[i] = shifted * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }
  return fir;
}

const amplify = (values, gain) => { for (let i = 0; i < values.length; i += 1) values[i] *= gain; };

// Masters `target` to sound like `reference`; returns { left, right, rate }.
export function master(target, reference, options = {}) {
  const config = { ...MASTERING_DEFAULTS, ...options };
  const { rate } = target;
  if (reference.rate !== rate) throw new Error('the reference must have the same sample rate as the track');
  const minLength = config.fftSize * 2;
  if (target.left.length < minLength || reference.left.length < minLength) throw new Error(`both tracks need at least ${(minLength / rate).toFixed(2)} s of audio`);

  // the reference is normalised when it peaks below the threshold; the target follows the same change at the end
  let referencePeak = 0;
  for (let i = 0; i < reference.left.length; i += 1) referencePeak = Math.max(referencePeak, Math.abs(reference.left[i]), Math.abs(reference.right[i]));
  let finalGain = 1;
  let ref = reference;
  if (referencePeak < config.threshold) {
    const coefficient = Math.max(referencePeak / config.threshold, config.minValue);
    ref = { left: Float32Array.from(reference.left), right: Float32Array.from(reference.right), rate };
    amplify(ref.left, 1 / coefficient);
    amplify(ref.right, 1 / coefficient);
    finalGain = coefficient;
  }
  const targetLevels = analyze(target, config);
  const referenceLevels = analyze(ref, config);
  if (targetLevels.matchRms <= 0) throw new Error('the track is silent');

  // match levels
  const gain = referenceLevels.matchRms / Math.max(targetLevels.matchRms, config.minValue);
  amplify(targetLevels.mid, gain);
  amplify(targetLevels.side, gain);
  targetLevels.loudMid.forEach((p) => amplify(p, gain));
  targetLevels.loudSide.forEach((p) => amplify(p, gain));

  // match frequencies
  const midFir = correctionFir(targetLevels.loudMid, referenceLevels.loudMid, rate, config);
  const sideFir = correctionFir(targetLevels.loudSide, referenceLevels.loudSide, rate, config);
  const mid = convolveSame(targetLevels.mid, midFir);
  const side = convolveSame(targetLevels.side, sideFir);
  const n = mid.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { left[i] = mid[i] + side[i]; right[i] = mid[i] - side[i]; }

  // correct levels against the clipped mid
  const { piece, divisions } = targetLevels;
  for (let step = 0; step < config.rmsCorrectionSteps; step += 1) {
    const { matchRms } = pieceLevels(mid, piece, divisions, true);
    const correction = referenceLevels.matchRms / Math.max(matchRms, config.minValue);
    amplify(mid, correction); amplify(left, correction); amplify(right, correction);
  }
  limit(left, right, rate, config.threshold, config.limiter);
  amplify(left, finalGain);
  amplify(right, finalGain);
  return { left, right, rate };
}
