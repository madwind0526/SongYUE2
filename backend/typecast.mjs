// Typecast cloud TTS (https://api.typecast.ai) called with plain HTTP from the backend so the API key
// (TYPECAST_API_KEY in .env) never reaches the browser. Attribution follows the Typecast docs: the
// User-Agent below is static and names the onboarding source and the coding agent that wrote this file.
export const TYPECAST_BASE_URL = 'https://api.typecast.ai';
export const TYPECAST_USER_AGENT = 'typecast-direct/1 node typecast-integration/1 (source=api-page; generated_by=claude-code)';
export const TYPECAST_MODEL = 'ssfm-v30';
export const TYPECAST_PRESET_EMOTIONS = ['normal', 'happy', 'sad', 'angry', 'whisper', 'toneup', 'tonedown'];
// UI language id -> ISO 639-3 code (a subset of the ssfm-v30 languages; the API auto-detects when omitted).
export const TYPECAST_LANGUAGES = { ko: 'kor', en: 'eng', ja: 'jpn', zh: 'zho', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', ru: 'rus', vi: 'vie', th: 'tha', id: 'ind', tr: 'tur', ar: 'ara', hi: 'hin' };
const LANGUAGE_CODES = TYPECAST_LANGUAGES;

export class TypecastError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function headers(apiKey, extra = {}) {
  return { 'X-API-KEY': apiKey, 'User-Agent': TYPECAST_USER_AGENT, ...extra };
}

async function failure(response) {
  const detail = await response.text().catch(() => '');
  if (detail.includes('CLONING_NOT_AVAILABLE')) return new TypecastError(400, 'Typecast 목소리 복제는 유료 요금제에서만 쓸 수 있습니다. 현재 요금제에서는 T2S(음색 설명)만 사용할 수 있고, 복제 기능은 다른 참조 모델(VoxCPM2, CosyVoice3 등)을 이용해 주세요.');
  const reason = { 400: '요청 값이 올바르지 않습니다.', 401: 'API 키가 올바르지 않습니다.', 402: 'Typecast 크레딧이 부족합니다.', 403: 'API 키 권한이 없습니다(구형 Starter 키이거나 키에 공백이 섞였는지 확인).', 404: '음성 또는 모델을 찾을 수 없습니다.', 422: '요청 검증에 실패했습니다.', 429: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.' }[response.status] || 'Typecast 서버 오류입니다.';
  return new TypecastError(response.status >= 500 ? 502 : 400, `Typecast 요청 실패 (${response.status}): ${reason}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
}

// Voice names come either as a plain string or a localized map like { eng: 'Valkyrie', kor: '발키리' }.
const voiceName = (voice) => {
  const name = voice.voice_name;
  if (name && typeof name === 'object') return String(name.kor || name.eng || Object.values(name)[0] || voice.voice_id);
  return String(name || voice.voice_id);
};
const voiceList = (data) => (Array.isArray(data) ? data : Array.isArray(data?.voices) ? data.voices : []);

// Picks the best-matching built-in voice for a natural-language description (name only; scores are not a guarantee).
export async function recommendTypecastVoice(fetchImpl, apiKey, query) {
  const response = await fetchImpl(`${TYPECAST_BASE_URL}/v1/voices/recommendations?query=${encodeURIComponent(query)}`, { headers: headers(apiKey) });
  if (!response.ok) throw await failure(response);
  const top = voiceList(await response.json())[0];
  if (!top?.voice_id) throw new TypecastError(400, 'Typecast가 설명에 맞는 목소리를 찾지 못했습니다. 설명을 바꾸거나 목소리를 직접 선택해 주세요.');
  return { id: String(top.voice_id), name: voiceName(top) };
}

// Instant voice cloning (uses one custom voice slot; the caller deletes the voice afterwards).
export async function cloneTypecastVoice(fetchImpl, apiKey, wavBuffer, name) {
  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'reference.wav');
  form.append('name', name.slice(0, 30));
  form.append('model', TYPECAST_MODEL);
  const response = await fetchImpl(`${TYPECAST_BASE_URL}/v1/voices/clone`, { method: 'POST', headers: headers(apiKey), body: form });
  if (!response.ok) throw await failure(response);
  const data = await response.json();
  const id = data?.voice_id || data?.id;
  if (!id) throw new TypecastError(502, 'Typecast 목소리 복제 응답에서 voice_id를 찾지 못했습니다.');
  return String(id);
}

export async function deleteTypecastVoice(fetchImpl, apiKey, voiceId) {
  await fetchImpl(`${TYPECAST_BASE_URL}/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: headers(apiKey) }).catch(() => {});
}

// Plan info (best effort): cloning needs custom_voice_slot > 0, which the free plan does not have.
export async function typecastSubscription(fetchImpl, apiKey) {
  try {
    const response = await fetchImpl(`${TYPECAST_BASE_URL}/v1/users/me/subscription`, { headers: headers(apiKey) });
    if (!response.ok) return null;
    const data = await response.json();
    const total = Number(data?.credits?.plan_credits);
    const used = Number(data?.credits?.used_credits);
    return {
      plan: String(data?.plan || ''),
      cloneAvailable: Number(data?.limits?.custom_voice_slot) > 0,
      creditsLeft: Number.isFinite(total) && Number.isFinite(used) ? Math.max(0, total - used) : null,
      creditsTotal: Number.isFinite(total) ? total : null,
    };
  } catch { return null; }
}

export async function listTypecastVoices(fetchImpl, apiKey) {
  const response = await fetchImpl(`${TYPECAST_BASE_URL}/v3/voices?model=${TYPECAST_MODEL}`, { headers: headers(apiKey) });
  if (!response.ok) throw await failure(response);
  const data = await response.json();
  // The API exposes no per-voice supported-language field, only localized names (eng/kor) and a preview clip.
  return voiceList(data).map((voice) => ({
    id: String(voice.voice_id), name: voiceName(voice), gender: voice.gender || null, age: voice.age || null,
    names: voice.voice_name && typeof voice.voice_name === 'object' ? voice.voice_name : null,
    preview: voice.preview_url || null, useCases: Array.isArray(voice.use_cases) ? voice.use_cases : [],
  }));
}

// Returns the WAV bytes for one text segment. emotion: { type: 'smart', previousText, nextText } or { type: 'preset', preset }.
export async function typecastSpeak(fetchImpl, apiKey, { voiceId, text, language, emotion }) {
  const body = { model: TYPECAST_MODEL, voice_id: voiceId, text, output: { audio_format: 'wav' } };
  if (LANGUAGE_CODES[language]) body.language = LANGUAGE_CODES[language];
  if (emotion?.type === 'preset' && TYPECAST_PRESET_EMOTIONS.includes(emotion.preset)) body.prompt = { emotion_type: 'preset', emotion_preset: emotion.preset, emotion_intensity: 1.0 };
  else if (emotion?.type === 'smart') body.prompt = { emotion_type: 'smart', ...(emotion.previousText ? { previous_text: emotion.previousText } : {}), ...(emotion.nextText ? { next_text: emotion.nextText } : {}) };
  const response = await fetchImpl(`${TYPECAST_BASE_URL}/v1/text-to-speech`, { method: 'POST', headers: headers(apiKey, { 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
  if (!response.ok) throw await failure(response);
  return Buffer.from(await response.arrayBuffer());
}
