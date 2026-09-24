// Shared spectral-mask helpers (noise floor estimate, temporal smoothing, frequency blur).
// Matrices are Float32Array [frame * bins + bin].

// k-th smallest of arr[0..length) using quickselect (reorders arr).
export function selectNth(arr, length, k) {
  let lo = 0;
  let hi = length - 1;
  while (lo < hi) {
    const pivot = arr[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (arr[i] < pivot) i += 1;
      while (arr[j] > pivot) j -= 1;
      if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i += 1; j -= 1; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  return arr[k];
}

// Noise floor of each bin: a low percentile of its magnitude over time, then a median across
// neighbouring bins (about a sixth of an octave wide). Hiss is broadband and survives the median, a
// held note is a narrow peak and does not.
export function noiseFloor(magnitudes, frames, bins, percentile) {
  const k = Math.min(Math.floor(frames * percentile), frames - 1);
  const overTime = new Float32Array(bins);
  const column = new Float32Array(frames);
  for (let bin = 0; bin < bins; bin += 1) {
    for (let frame = 0; frame < frames; frame += 1) column[frame] = magnitudes[frame * bins + bin];
    overTime[bin] = selectNth(column, frames, k);
  }
  const out = new Float32Array(bins);
  const window = new Float32Array(2 * Math.max(8, Math.floor(bins / 24)) + 2);
  for (let bin = 0; bin < bins; bin += 1) {
    const half = Math.max(Math.floor(bin / 24), 8);
    const lo = Math.max(0, bin - half);
    const hi = Math.min(bins - 1, bin + half);
    const size = hi - lo + 1;
    for (let index = 0; index < size; index += 1) window[index] = overTime[lo + index];
    out[bin] = selectNth(window, size, size >> 1);
  }
  return out;
}

// Attack/release smoothing forward in time, then a softer pass backward.
export function smoothOverTime(mask, frames, bins, attack, release) {
  if (frames < 2) return;
  const previous = new Float32Array(mask.subarray(0, bins));
  for (let frame = 1; frame < frames; frame += 1) {
    const base = frame * bins;
    for (let bin = 0; bin < bins; bin += 1) {
      const current = mask[base + bin];
      const c = current > previous[bin] ? attack : release;
      const value = c * previous[bin] + (1 - c) * current;
      previous[bin] = value;
      mask[base + bin] = value;
    }
  }
  previous.set(mask.subarray((frames - 1) * bins, frames * bins));
  for (let frame = frames - 2; frame >= 0; frame -= 1) {
    const base = frame * bins;
    for (let bin = 0; bin < bins; bin += 1) {
      const current = mask[base + bin];
      const value = 0.5 * current + 0.5 * (release * previous[bin] + (1 - release) * current);
      previous[bin] = value;
      mask[base + bin] = value;
    }
  }
}

// Gaussian blur across bins, sigma in bins (a sigma of 1 or less leaves the mask as it is).
export function blurOverFrequency(mask, frames, bins, sigma) {
  if (sigma <= 1) return;
  const kernel = new Float64Array(2 * sigma + 1);
  for (let k = 0; k <= 2 * sigma; k += 1) kernel[k] = Math.exp(-0.5 * ((k - sigma) / sigma) ** 2);
  const row = new Float32Array(bins);
  for (let frame = 0; frame < frames; frame += 1) {
    const base = frame * bins;
    row.set(mask.subarray(base, base + bins));
    for (let bin = 0; bin < bins; bin += 1) {
      let sum = 0;
      let weight = 0;
      for (let k = 0; k <= 2 * sigma; k += 1) {
        const index = bin + k - sigma;
        if (index >= 0 && index < bins) { sum += row[index] * kernel[k]; weight += kernel[k]; }
      }
      mask[base + bin] = sum / weight;
    }
  }
}
