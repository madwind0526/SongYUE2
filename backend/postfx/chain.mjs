// The "AI song polish" chain, in the order of YuE2 Studio: noise reduction -> Spectral Lifter -> vocal
// naturalizer -> VST3 plugins -> mastering to a reference track. Audio is { left, right, rate } with Float32Array channels.
import { denoise } from './denoise.mjs';
import { lift } from './lifter.mjs';
import { NATURALIZE_DEFAULTS, naturalize } from './naturalize.mjs';
import { master } from './mastering.mjs';
import { VST_MAX_PLUGINS } from './vst-stage.mjs';

export const POLISH_DEFAULTS = {
  denoise: { enabled: false, strength: 0.4 },
  lifter: { enabled: false, gate: 0.3, shimmerDb: 6, hfMix: 0, punch: 0 },
  naturalize: { enabled: false, ...NATURALIZE_DEFAULTS },
  vst: { enabled: false, plugins: [] },
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
  const v = source('vst');
  const plugins = (Array.isArray(v.plugins) ? v.plugins : []).filter((plugin) => plugin && typeof plugin.path === 'string' && plugin.path.trim() && plugin.path.length <= 1024)
    .slice(0, VST_MAX_PLUGINS).map((plugin) => ({ path: plugin.path.trim(), enabled: plugin.enabled !== false }));
  return {
    denoise: { enabled: d.enabled === true, strength: clamp(d.strength, 0.05, 1, POLISH_DEFAULTS.denoise.strength) },
    lifter: { enabled: l.enabled === true, gate: clamp(l.gate, 0, 1, 0.3), shimmerDb: clamp(l.shimmerDb, 0, 12, 6), hfMix: clamp(l.hfMix, 0, 0.5, 0), punch: clamp(l.punch, 0, 1, 0) },
    naturalize: {
      enabled: n.enabled === true,
      amount: clamp(n.amount, 0.05, 1, NATURALIZE_DEFAULTS.amount),
      vibratoRate: clamp(n.vibratoRate, 3, 7, NATURALIZE_DEFAULTS.vibratoRate),
      vibratoDepth: clamp(n.vibratoDepth, 0, 2, NATURALIZE_DEFAULTS.vibratoDepth),
      formantStrength: clamp(n.formantStrength, 0, 2, NATURALIZE_DEFAULTS.formantStrength),
      metallicReduction: clamp(n.metallicReduction, 0, 2, NATURALIZE_DEFAULTS.metallicReduction),
      quantizationMask: clamp(n.quantizationMask, 0, 1, NATURALIZE_DEFAULTS.quantizationMask),
      transitionSmooth: clamp(n.transitionSmooth, 0, 2, NATURALIZE_DEFAULTS.transitionSmooth),
      seed: Math.round(clamp(n.seed, 0, 9999, NATURALIZE_DEFAULTS.seed)),
    },
    vst: { enabled: v.enabled === true && plugins.some((plugin) => plugin.enabled), plugins },
    master: { enabled: m.enabled === true },
  };
}

export const enabledStages = (settings) => ['denoise', 'lifter', 'naturalize', 'vst', 'master'].filter((name) => settings[name].enabled);

// Runs the enabled stages. `reference` (same sample rate) is required when mastering is on.
// onProgress(percent, label) is called before each stage and at the end.
// `vstProcess(audio, plugins)` runs the VST3 plugins (vst-stage.mjs) and is required when that stage is on.
export function runPolishChain(audio, settingsInput, { reference = null, vstProcess = null, onProgress = () => {} } = {}) {
  const settings = normalizePolishSettings(settingsInput);
  const stages = enabledStages(settings);
  if (!stages.length) throw new Error('적용할 단계를 하나 이상 켜 주세요.');
  if (settings.master.enabled && !reference) throw new Error('기준곡 마스터링에는 기준곡이 필요합니다.');
  if (settings.vst.enabled && !vstProcess) throw new Error('VST3 플러그인을 실행할 수 없습니다.');
  const labels = { denoise: '노이즈 제거', lifter: 'Spectral Lifter', naturalize: '보컬 자연화', vst: 'VST3 플러그인', master: '기준곡 마스터링' };
  let current = audio;
  stages.forEach((stage, index) => {
    onProgress(Math.round((index / stages.length) * 100), labels[stage]);
    if (stage === 'denoise') current = denoise(current, { strength: settings.denoise.strength });
    else if (stage === 'lifter') current = lift(current, { denoiseStrength: settings.lifter.gate, shimmerReductionDb: settings.lifter.shimmerDb, hfMix: settings.lifter.hfMix, transientBoost: settings.lifter.punch });
    else if (stage === 'naturalize') current = naturalize(current, settings.naturalize);
    else if (stage === 'vst') current = vstProcess(current, settings.vst.plugins);
    else current = master(current, reference);
  });
  onProgress(100, '완료');
  return { audio: current, stages };
}
