// The "AI song polish" chain, in the order of YuE2 Studio: noise reduction -> Spectral Lifter -> vocal
// naturalizer -> mastering to a reference track. Audio is { left, right, rate } with Float32Array channels.
import { denoise } from './denoise.mjs';
import { lift } from './lifter.mjs';
import { naturalize } from './naturalize.mjs';
import { master } from './mastering.mjs';

export const POLISH_DEFAULTS = {
  denoise: { enabled: false, strength: 0.4 },
  lifter: { enabled: false, gate: 0.3, shimmerDb: 6, hfMix: 0, punch: 0 },
  naturalize: { enabled: false, amount: 0.5 },
  master: { enabled: false },
};

const clamp = (value, lo, hi, fallback) => (Number.isFinite(Number(value)) ? Math.min(hi, Math.max(lo, Number(value))) : fallback);

// Validates and clamps the settings coming from the API (unknown keys are dropped).
export function normalizePolishSettings(input = {}) {
  const source = (name) => (input[name] && typeof input[name] === 'object' ? input[name] : {});
  const d = source('denoise');
  const l = source('lifter');
  const n = source('naturalize');
  const m = source('master');
  return {
    denoise: { enabled: d.enabled === true, strength: clamp(d.strength, 0.05, 1, POLISH_DEFAULTS.denoise.strength) },
    lifter: { enabled: l.enabled === true, gate: clamp(l.gate, 0, 1, 0.3), shimmerDb: clamp(l.shimmerDb, 0, 12, 6), hfMix: clamp(l.hfMix, 0, 0.5, 0), punch: clamp(l.punch, 0, 1, 0) },
    naturalize: { enabled: n.enabled === true, amount: clamp(n.amount, 0.05, 1, 0.5) },
    master: { enabled: m.enabled === true },
  };
}

export const enabledStages = (settings) => ['denoise', 'lifter', 'naturalize', 'master'].filter((name) => settings[name].enabled);

// Runs the enabled stages. `reference` (same sample rate) is required when mastering is on.
// onProgress(percent, label) is called before each stage and at the end.
export function runPolishChain(audio, settingsInput, { reference = null, onProgress = () => {} } = {}) {
  const settings = normalizePolishSettings(settingsInput);
  const stages = enabledStages(settings);
  if (!stages.length) throw new Error('적용할 단계를 하나 이상 켜 주세요.');
  if (settings.master.enabled && !reference) throw new Error('기준곡 마스터링에는 기준곡이 필요합니다.');
  const labels = { denoise: '노이즈 제거', lifter: 'Spectral Lifter', naturalize: '보컬 자연화', master: '기준곡 마스터링' };
  let current = audio;
  stages.forEach((stage, index) => {
    onProgress(Math.round((index / stages.length) * 100), labels[stage]);
    if (stage === 'denoise') current = denoise(current, { strength: settings.denoise.strength });
    else if (stage === 'lifter') current = lift(current, { denoiseStrength: settings.lifter.gate, shimmerReductionDb: settings.lifter.shimmerDb, hfMix: settings.lifter.hfMix, transientBoost: settings.lifter.punch });
    else if (stage === 'naturalize') current = naturalize(current, { amount: settings.naturalize.amount });
    else current = master(current, reference);
  });
  onProgress(100, '완료');
  return { audio: current, stages };
}
