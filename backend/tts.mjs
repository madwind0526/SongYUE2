// Audio Tools TTS on audio.cpp: model catalog (family x size x precision), CLI argument
// assembly, text segmentation, and resumable GGUF downloads from the audio.cpp-gguf HF repo.
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HF_BASE = 'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main';
export const TTS_MODEL_ROOT = path.join('models', 'audio-cpp', 'audio.cpp-gguf');

// mode: 'design' = text-described voice (no reference), 'ref' = voice from a reference clip.
// `files` maps precision -> [directory, file, approximate MB].
export const TTS_FAMILIES = [
  {
    id: 'qwen3', label: 'Qwen3-TTS', cliFamily: 'qwen3_tts',
    // Packaged CustomVoice speakers (preset tab). Native language in parentheses; all can read Korean.
    voices: [
      { id: 'Sohee', label: '소희 · 여 · 한국어' }, { id: 'Ono_Anna', label: '오노 안나 · 여 · 일본어' },
      { id: 'Vivian', label: '비비안 · 여 · 중국어' }, { id: 'Serena', label: '세레나 · 여 · 중국어' },
      { id: 'Uncle_Fu', label: '푸 아저씨 · 남 · 중국어' }, { id: 'Dylan', label: '딜런 · 남 · 베이징 방언' },
      { id: 'Eric', label: '에릭 · 남 · 쓰촨 방언' }, { id: 'Ryan', label: '라이언 · 남 · 영어' }, { id: 'Aiden', label: '에이든 · 남 · 영어' },
    ],
    variants: [
      { mode: 'preset', size: '1.7B', files: {
        q8_0: ['Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF', 'qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf', 2817],
        bf16: ['Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF', 'qwen3-tts-12hz-1.7b-customvoice-bf16.gguf', 4179] } },
      { mode: 'design', size: '1.7B', files: {
        q8_0: ['Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF', 'qwen3-tts-12hz-1.7b-voicedesign-q8_0.gguf', 2817],
        bf16: ['Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF', 'qwen3-tts-12hz-1.7b-voicedesign-bf16.gguf', 4179] } },
      { mode: 'ref', size: '0.6B', files: {
        q8_0: ['Qwen3-TTS-12Hz-0.6B-Base-GGUF', 'qwen3-tts-12hz-0.6b-base-q8_0.gguf', 1991],
        bf16: ['Qwen3-TTS-12Hz-0.6B-Base-GGUF', 'qwen3-tts-12hz-0.6b-base-bf16.gguf', 2516] } },
      { mode: 'ref', size: '1.7B', files: {
        q8_0: ['Qwen3-TTS-12Hz-1.7B-Base-GGUF', 'qwen3-tts-12hz-1.7b-base-q8_0_v2.gguf', 2695],
        bf16: ['Qwen3-TTS-12Hz-1.7B-Base-GGUF', 'qwen3-tts-12hz-1.7b-base-bf16.gguf', 4203],
        orig: ['Qwen3-TTS-12Hz-1.7B-Base-GGUF', 'qwen3-tts-12hz-1.7b-base-orig.gguf', 4544] } },
    ],
  },
  {
    // Reference cloning only (no voice description); Korean is a Tier-2 language. INT8 is the practical size.
    id: 'fish', label: 'Fish Audio S2 Pro', cliFamily: 'fish_audio',
    variants: [{ mode: 'ref', size: '기본', files: {
      q8_0: ['Fish-Audio-S2-Pro-GGUF', 'fish-audio-s2-pro-q8_0.gguf', 6318],
      bf16: ['Fish-Audio-S2-Pro-GGUF', 'fish-audio-s2-pro-bf16.gguf', 10229] } }],
  },
  {
    id: 'chatterbox', label: 'Chatterbox', cliFamily: 'chatterbox',
    variants: [{ mode: 'ref', size: '기본', files: {
      q8_0: ['Chatterbox-GGUF', 'chatterbox-q8_0.gguf', 2088],
      f16: ['Chatterbox-GGUF', 'chatterbox-f16.gguf', 3744] } }],
  },
  {
    // Clone only: --instruct accepts just a fixed attribute vocabulary (no free-text voice description),
    // and cloning requires the reference transcript (auto-filled with ASR when left empty).
    id: 'omnivoice', label: 'OmniVoice', cliFamily: 'omnivoice',
    variants: ['ref'].map((mode) => ({ mode, size: '0.6B', files: {
      q8_0: ['OmniVoice-GGUF', 'omnivoice-q8_0.gguf', 1350],
      f16: ['OmniVoice-GGUF', 'omnivoice-f16.gguf', 1640],
      bf16: ['OmniVoice-GGUF', 'omnivoice-bf16.gguf', 1640] } })),
  },
  {
    // Preset-voice TTS (no cloning, no description): voices M1-M5 / F1-F5, 30+ languages incl. Korean.
    id: 'supertonic', label: 'Supertonic 3', cliFamily: 'supertonic',
    voices: ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'].map((id) => ({ id, label: `${id.startsWith('F') ? '여성' : '남성'} ${id}` })),
    variants: [{ mode: 'preset', size: '기본', files: {
      q8_0: ['Supertonic-3-GGUF', 'supertonic-3-q8_0.gguf', 454],
      f16: ['Supertonic-3-GGUF', 'supertonic-3-f16.gguf', 313],
      orig: ['Supertonic-3-GGUF', 'supertonic-3-orig.gguf', 454] } }],
  },
  {
    // NVIDIA MagpieTTS: 5 baked speakers, 13 languages incl. Korean.
    id: 'magpie', label: 'MagpieTTS', cliFamily: 'magpie_tts',
    voices: [{ id: 'Sofia', label: 'Sofia · 여' }, { id: 'Aria', label: 'Aria · 여' }, { id: 'John', label: 'John · 남' }, { id: 'Jason', label: 'Jason · 남' }, { id: 'Leo', label: 'Leo · 남' }],
    variants: [{ mode: 'preset', size: '357M', files: {
      q8_0: ['MagpieTTS-Multilingual-357M-GGUF', 'magpie-tts-multilingual-357m-q8_0.gguf', 1562],
      orig: ['MagpieTTS-Multilingual-357M-GGUF', 'magpie-tts-multilingual-357m-orig.gguf', 1912] } }],
  },
];

// Speech recognition models (Korean-capable only; models without Korean support are excluded): same file layout/download path as the TTS models. `languages` maps
// the UI language id to the value that family's --language option expects (missing id = unsupported;
// an empty map means the family takes no language hint).
const asrFile = (size, precision, mb) => [`Qwen3-ASR-${size}-GGUF`, `qwen3-asr-${size.toLowerCase()}-${precision}.gguf`, mb];
export const ASR_FAMILIES = [
  {
    id: 'qwen3asr', label: 'Qwen3-ASR', cliFamily: 'qwen3_asr', languages: { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese' },
    variants: [
      { mode: 'asr', size: '0.6B', files: { q8_0: asrFile('0.6B', 'q8_0', 1151), f16: asrFile('0.6B', 'f16', 1881) } },
      { mode: 'asr', size: '1.7B', files: { q8_0: asrFile('1.7B', 'q8_0', 2473), f16: asrFile('1.7B', 'f16', 4088) } },
    ],
  },
  {
    id: 'nemotronasr', label: 'Nemotron 3.5 ASR', cliFamily: 'nemotron_asr', languages: { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' },
    variants: [{ mode: 'asr', size: '0.6B', files: {
      q8_0: ['Nemotron-3.5-ASR-Streaming-0.6B-GGUF', 'nemotron-3.5-asr-streaming-0.6b-q8_0.gguf', 931],
      f16: ['Nemotron-3.5-ASR-Streaming-0.6B-GGUF', 'nemotron-3.5-asr-streaming-0.6b-f16.gguf', 1278] } }],
  },
  {
    id: 'vibevoiceasr', label: 'VibeVoice-ASR', cliFamily: 'vibevoice_asr', languages: {},
    variants: [{ mode: 'asr', size: '기본', files: {
      q8_0: ['VibeVoice-ASR-GGUF', 'vibevoice-asr-q8_0.gguf', 9859],
      f16: ['VibeVoice-ASR-GGUF', 'vibevoice-asr-f16.gguf', 17361] } }],
  },
];

// Voice conversion engines used by the timbre-transform window (same catalog/download plumbing).
export const VC_FAMILIES = [
  {
    // Retrieval-based VC: converts the source vocal into one of the packaged voices (no reference clip).
    id: 'rvc', label: 'RVC', cliFamily: 'rvc',
    voices: [{ id: 'default', label: 'default' }, { id: 'manthos', label: 'manthos' }, { id: 'chocola', label: 'chocola' }, { id: 'fraise', label: 'fraise' }],
    variants: [{ mode: 'vc', size: '기본', files: { f16: ['RVC-GGUF', 'rvc-f16.gguf', 1260] } }],
  },
  {
    // Zero-shot VC: converts the source into the voice of a reference clip.
    id: 'meanvc2', label: 'MeanVC2', cliFamily: 'meanvc2',
    variants: [{ mode: 'vc', size: '120ms/40ms', files: {
      q4_k: ['MeanVC2-GGUF', 'meanvc2-120ms-40ms-q4_k.gguf', 342],
      fp32: ['MeanVC2-GGUF', 'meanvc2-120ms-40ms-fp32.gguf', 1629] } }],
  },
];

// Speech editing (change words inside an existing recording, keeping the voice): DotTTS Edit takes tagged text
// (<sub targ="new">old</sub>, <del>, <ins>) plus the source audio. `languages` maps the UI id to its --language code.
export const EDIT_FAMILIES = [
  {
    id: 'dotsedit', label: 'DotTTS Edit', cliFamily: 'dots_tts', languages: { ko: 'ko', en: 'en', ja: 'ja', zh: 'zh' },
    variants: [{ mode: 'edit', size: '기본', files: { q8_0: ['DotTTS-Edit-GGUF', 'dots-tts-edit-q8_0.gguf', 2826], bf16: ['DotTTS-Edit-GGUF', 'dots-tts-edit-bf16.gguf', 4567] } }],
  },
];

// Builds the tagged edit text from the transcript and a list of {op, find, text}; every `find` must occur in the
// transcript (first occurrence, or every one with `all`) and edits may not overlap. Returns the tagged string.
export function buildEditText(source, edits) {
  const spans = [];
  for (const edit of edits) {
    // An explicit `at` pins the edit to one position (used for word-level windows).
    let start = edit.at !== undefined ? (source.startsWith(edit.find, edit.at) ? edit.at : -1) : source.indexOf(edit.find);
    if (start < 0) throw new Error(`원문에서 "${edit.find}"을(를) 찾지 못했습니다.`);
    // `all` applies the edit to every occurrence instead of only the first one.
    while (start >= 0) {
      spans.push({ start, end: start + edit.find.length, edit });
      start = edit.all && edit.at === undefined ? source.indexOf(edit.find, start + edit.find.length) : -1;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  for (let index = 1; index < spans.length; index += 1) {
    if (spans[index].start < spans[index - 1].end) throw new Error('편집 위치가 서로 겹칩니다. 겹치지 않게 나누어 주세요.');
  }
  let out = '';
  let cursor = 0;
  for (const { start, end, edit } of spans) {
    out += source.slice(cursor, start);
    if (edit.op === 'del') out += `<del>${edit.find}</del>`;
    else if (edit.op === 'ins') out += `<ins>${edit.text} </ins>${edit.find}`;
    else if (edit.op === 'apd') out += `${edit.find}<ins> ${edit.text}</ins>`;
    else out += `<sub targ="${edit.text.replace(/"/g, '')}">${edit.find}</sub>`;
    cursor = end;
  }
  return out + source.slice(cursor);
}

// The plain text a speech edit should produce (same rules as buildEditText, without tags), used to align the result.
export function applyEditText(source, edits) {
  const tagged = buildEditText(source, edits);
  return tagged
    .replace(/<sub targ="([^"]*)">[^<]*<\/sub>/g, '$1')
    .replace(/<del>[^<]*<\/del>/g, '')
    .replace(/<ins>([^<]*)<\/ins>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Word-level forced alignment (transcript + audio -> word timestamps), used to cut speech edits tightly around the edited words.
export const ALIGN_FAMILIES = [
  {
    id: 'qwen3align', label: 'Qwen3 Forced Aligner', cliFamily: 'qwen3_forced_aligner', languages: { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese' },
    variants: [{ mode: 'align', size: '0.6B', files: { q8_0: ['Qwen3-ForcedAligner-0.6B-GGUF', 'qwen3-forced-aligner-0.6b-q8_0.gguf', 1130] } }],
  },
];

// Sound-effect generation (text -> short effect); prompts are English-only in the model.
export const SFX_FAMILIES = [
  {
    id: 'stablesfx', label: 'Stable Audio 3 SFX', cliFamily: 'stable_audio',
    variants: [{ mode: 'sfx', size: 'Small', files: {
      q8_0: ['Stable-Audio-3-Small-SFX-GGUF', 'stable-audio-3-small-sfx-q8_0.gguf', 1684],
      f16: ['Stable-Audio-3-Small-SFX-GGUF', 'stable-audio-3-small-sfx-f16.gguf', 2358] } }],
  },
];

export function findTtsModel(familyId, mode, size, precision) {
  const family = [...TTS_FAMILIES, ...ASR_FAMILIES, ...VC_FAMILIES, ...EDIT_FAMILIES, ...ALIGN_FAMILIES, ...SFX_FAMILIES].find((item) => item.id === familyId);
  const variant = family?.variants.find((item) => item.mode === mode && item.size === size);
  const file = variant?.files[precision];
  if (!family || !variant || !file) return null;
  return { family, variant, dir: file[0], file: file[1], sizeMb: file[2], relativePath: path.join(TTS_MODEL_ROOT, file[0], file[1]), url: `${HF_BASE}/${file[0]}/${file[1]}` };
}

// Downloads land in `<file>.part` and are renamed on completion, so a present file is complete.
export async function isTtsModelInstalled(root, model) {
  return stat(path.join(root, model.relativePath)).then((info) => info.isFile() && info.size > 0, () => false);
}

export async function listTtsModels(root, downloads = new Map(), catalog = TTS_FAMILIES) {
  const families = [];
  for (const family of catalog) {
    const variants = [];
    for (const variant of family.variants) {
      const precisions = [];
      for (const precision of Object.keys(variant.files)) {
        const model = findTtsModel(family.id, variant.mode, variant.size, precision);
        const installed = await isTtsModelInstalled(root, model);
        precisions.push({ precision, sizeMb: model.sizeMb, installed, download: installed ? null : downloads.get(model.relativePath) || null });
      }
      variants.push({ mode: variant.mode, size: variant.size, precisions });
    }
    families.push({ id: family.id, label: family.label, languages: family.languages ? Object.keys(family.languages) : undefined, voices: family.voices, variants });
  }
  return families;
}

// Text is synthesized in sentence-packed segments (<= maxChars) and concatenated by the caller:
// long single passes are where autoregressive TTS starts to drift or hallucinate.
export function splitTtsText(input, maxChars = 200) {
  const lines = String(input || '').replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  const segments = [];
  const pack = (parts) => {
    let current = '';
    for (const part of parts) {
      const trial = current ? `${current} ${part}` : part;
      if (trial.length <= maxChars) { current = trial; continue; }
      if (current) segments.push(current);
      current = part;
    }
    if (current) segments.push(current);
  };
  for (const line of lines) {
    if (line.length <= maxChars) { pack([line]); continue; }
    const sentences = line.split(/(?<=[.!?。！？])\s+/).map((s) => s.trim()).filter(Boolean);
    const parts = [];
    for (const sentence of sentences) {
      if (sentence.length <= maxChars) { parts.push(sentence); continue; }
      for (let index = 0; index < sentence.length; index += maxChars) parts.push(sentence.slice(index, index + maxChars));
    }
    pack(parts);
  }
  return segments;
}

// For language 'auto': break mixed Korean/English text at sentence boundaries into runs of the same
// script so every segment gets its own language flag (Qwen3 with one flag drops the other language).
export function splitTtsByScript(input, maxChars = 200) {
  const scriptOf = (sentence) => (/[가-힣]/.test(sentence) ? 'ko' : /[A-Za-z]/.test(sentence) ? 'en' : null);
  const runs = [];
  for (const segment of splitTtsText(input, maxChars)) {
    for (const sentence of segment.split(/(?<=[.!?。！？])\s+/).map((part) => part.trim()).filter(Boolean)) {
      const script = scriptOf(sentence);
      const last = runs[runs.length - 1];
      if (last && (script === null || last.script === null || last.script === script) && last.text.length + sentence.length < maxChars) {
        last.text += ` ${sentence}`;
        last.script = last.script || script;
      } else runs.push({ script, text: sentence });
    }
  }
  return runs.map((run) => run.text);
}

export function detectSpeechLanguage(text) {
  const hangul = (String(text).match(/[가-힣]/g) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  if (hangul && latin) return 'mixed';
  return hangul ? 'ko' : 'en';
}

const QWEN_LANG = { ko: 'korean', en: 'english', mixed: 'auto' };

// Returns the audiocpp_cli argument list (without --backend/--metrics) for one text segment.
// The requested preset voice if the family offers it, otherwise the family's first voice.
export const presetVoice = (model, voiceId) => (model.family.voices?.some((voice) => voice.id === voiceId) ? voiceId : model.family.voices?.[0]?.id);

// Families that accept an optional free-text style/emotion instruction.
export const STYLE_FAMILIES = ['qwen3'];

export function buildTtsArgs({ model, mode, text, description, style, voiceId, language, referenceWav, referenceText, outputWav, modelPath }) {
  const detected = language === 'ko' || language === 'en' ? language : detectSpeechLanguage(text);
  const cli = model.family.cliFamily;
  if (cli === 'magpie_tts') {
    return ['--task', 'tts', '--family', cli, '--model', modelPath, '--language', detected === 'en' ? 'en' : 'ko', '--request-option', `voice_id=${presetVoice(model, voiceId)}`, '--text', text, '--out', outputWav];
  }
  if (cli === 'qwen3_tts' && mode === 'preset') {
    // CustomVoice: packaged speaker plus an optional style/emotion instruction.
    return ['--task', 'tts', '--family', cli, '--model', modelPath, '--speaker', presetVoice(model, voiceId), ...(style ? ['--instruct', style] : []), '--language', QWEN_LANG[detected], '--text', text, '--out', outputWav];
  }
  if (cli === 'qwen3_tts') {
    // Without a reference transcript Qwen3 Base cannot run ICL cloning; fall back to speaker-embedding-only.
    const args = mode === 'design'
      ? ['--task', 'vdes', '--family', cli, '--model', modelPath, '--instruct', description]
      : ['--task', 'tts', '--family', cli, '--model', modelPath, '--voice-ref', referenceWav, ...(referenceText ? ['--reference-text', referenceText] : ['--request-option', 'x_vector_only_mode=true'])];
    return [...args, '--language', QWEN_LANG[detected], '--text', text, '--out', outputWav];
  }
  if (cli === 'fish_audio') {
    return ['--task', 'tts', '--family', cli, '--model', modelPath, '--voice-ref', referenceWav, ...(referenceText ? ['--reference-text', referenceText] : []), '--text', text, '--out', outputWav];
  }
  if (cli === 'supertonic') {
    return ['--task', 'tts', '--family', cli, '--model', modelPath, '--language', detected === 'en' ? 'en' : 'ko', '--voice-id', presetVoice(model, voiceId), '--text', text, '--out', outputWav];
  }
  if (cli === 'omnivoice') {
    return ['--task', 'tts', '--family', cli, '--model', modelPath, '--voice-ref', referenceWav, ...(referenceText ? ['--reference-text', referenceText] : []), '--text', text, '--out', outputWav];
  }
  return ['--task', 'clon', '--family', cli, '--model', modelPath, '--voice-ref', referenceWav, '--language', detected === 'ko' ? 'ko' : 'en', '--text', text, '--out', outputWav];
}

// Resumable download (`<file>.part` + Range) tracked in `downloads` so the UI can poll progress.
export async function downloadTtsModel({ fetchImpl, root, model, downloads }) {
  const target = path.join(root, model.relativePath);
  const partial = `${target}.part`;
  if (downloads.get(model.relativePath)?.state === 'running') return;
  const state = { state: 'running', receivedBytes: 0, totalBytes: 0, error: null };
  downloads.set(model.relativePath, state);
  try {
    await mkdir(path.dirname(target), { recursive: true });
    const existing = await stat(partial).then((info) => info.size, () => 0);
    const response = await fetchImpl(model.url, { headers: existing ? { Range: `bytes=${existing}-` } : {}, redirect: 'follow' });
    if (!response.ok && response.status !== 206) throw new Error(`다운로드 서버 응답 오류 (${response.status})`);
    const resumed = response.status === 206;
    const remaining = Number(response.headers.get('content-length')) || 0;
    state.totalBytes = (resumed ? existing : 0) + remaining;
    state.receivedBytes = resumed ? existing : 0;
    const output = createWriteStream(partial, { flags: resumed ? 'a' : 'w' });
    const source = Readable.fromWeb(response.body);
    source.on('data', (chunk) => { state.receivedBytes += chunk.length; });
    await pipeline(source, output);
    if (state.totalBytes && state.receivedBytes < state.totalBytes) throw new Error('다운로드가 중간에 끊겼습니다. 다시 시도하면 이어받습니다.');
    await rename(partial, target);
    downloads.delete(model.relativePath);
  } catch (error) {
    state.state = 'failed';
    state.error = error?.message || '다운로드에 실패했습니다.';
  }
}
