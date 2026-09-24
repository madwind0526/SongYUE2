// Iterative radix-2 complex FFT with precomputed tables (in place, Float64 work arrays).
// The inverse is unnormalized (like realfft): callers scale by 1/n.

const cache = new Map();

export class Fft {
  constructor(size) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`);
    this.size = size;
    this.reverse = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let index = 0; index < size; index += 1) {
      let value = 0;
      for (let bit = 0; bit < bits; bit += 1) value |= ((index >> bit) & 1) << (bits - 1 - bit);
      this.reverse[index] = value;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let index = 0; index < size / 2; index += 1) {
      this.cos[index] = Math.cos((2 * Math.PI * index) / size);
      this.sin[index] = Math.sin((2 * Math.PI * index) / size);
    }
  }

  static of(size) {
    if (!cache.has(size)) cache.set(size, new Fft(size));
    return cache.get(size);
  }

  transform(re, im, inverse = false) {
    const n = this.size;
    const { reverse, cos, sin } = this;
    for (let index = 0; index < n; index += 1) {
      const other = reverse[index];
      if (other > index) {
        let swap = re[index]; re[index] = re[other]; re[other] = swap;
        swap = im[index]; im[index] = im[other]; im[other] = swap;
      }
    }
    const sign = inverse ? 1 : -1;
    for (let half = 1; half < n; half <<= 1) {
      const step = n / (half << 1);
      for (let start = 0; start < n; start += half << 1) {
        for (let k = 0, twiddle = 0; k < half; k += 1, twiddle += step) {
          const wr = cos[twiddle];
          const wi = sign * sin[twiddle];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}
