// Small helpers shared by the post-processing stages. Audio is { left, right, rate } with Float32Array channels.

// Scales the whole track down (one gain for both channels) when it would clip.
export function keepBelow(audio, ceiling) {
  let peak = 0;
  for (let index = 0; index < audio.left.length; index += 1) peak = Math.max(peak, Math.abs(audio.left[index]), Math.abs(audio.right[index]));
  if (peak > ceiling) {
    const gain = ceiling / peak;
    for (let index = 0; index < audio.left.length; index += 1) { audio.left[index] *= gain; audio.right[index] *= gain; }
  }
}

export function peakOf(audio) {
  let peak = 0;
  for (let index = 0; index < audio.left.length; index += 1) peak = Math.max(peak, Math.abs(audio.left[index]), Math.abs(audio.right[index]));
  return peak;
}

export function rmsOf(values) {
  if (!values.length) return 0;
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) sum += values[index] * values[index];
  return Math.sqrt(sum / values.length);
}
