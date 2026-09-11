export type Page = 'create' | 'home' | 'library' | 'projects' | 'favorites' | 'playlists' | 'models' | 'settings';
export type Provider = 'none' | 'ollama' | 'claude' | 'chatgpt' | 'gemini';
export type VocalGender = '' | 'male' | 'female' | 'duet';
export type Draft = { title: string; lyrics: string; style: string; modelId: string; seed: number; steps: number; cot: string; vocalGender: VocalGender; mode: string };
export type SaveFormat = 'wav' | 'flac' | 'mp3' | 'mp4';
export type Project = Draft & { id: string; sourceProjectId?: string; createdAt: string; status: string; favorite?: boolean; notes?: string; audioPath?: string; coverPath?: string | null; durationMs?: number | null; rtf?: number | null; truncated?: boolean; saveError?: string | null };
export type Playlist = { id: string; name: string; songIds: string[]; createdAt: string; updatedAt: string };
export type ViewMode = 'list' | 'card';
export type Settings = { provider: Provider; endpoint: string; llmModel: string; hasApiKey?: boolean; apiKey?: string | null; enginePath: string; pythonEnginePath: string; pythonScriptPath: string; settingPath: string; musicPath: string; examplesPath: string; saveFormat: SaveFormat; viewMode: ViewMode; outputDirectory: string };
export type Inventory = { state: string; totalBytes: number; completedBytes: number; repositories: { id: string; state: string; path: string; totalBytes: number; completedBytes: number; files: { path: string; state: string; size: number }[] }[] };
export type SystemInfo = { vramMb: number | null };
export const PYTHON_MODEL_MIN_VRAM_MB = 20 * 1024;
export const emptyDraft: Draft = { title: '', lyrics: '', style: '', modelId: 'yue2-q4', seed: 42, steps: 8, cot: 'full', vocalGender: '', mode: 'custom' };
export const initialSettings: Settings = { provider: 'none', endpoint: '', llmModel: '', apiKey: null, enginePath: '', pythonEnginePath: '', pythonScriptPath: '', settingPath: '', musicPath: '', examplesPath: '', saveFormat: 'wav', viewMode: 'list', outputDirectory: '' };
export const DEFAULT_SETTING_PATH = 'Library\\Setting';
export const DEFAULT_MUSIC_PATH = 'Library\\Music';
export const DEFAULT_EXAMPLES_PATH = 'Library\\Examples';
export const DEFAULT_ENGINE_PATH = 'engine\\audio.cpp\\build\\windows-cuda-release\\bin\\audiocpp_cli.exe';
export const viewModes: { id: ViewMode; label: string }[] = [
  { id: 'list', label: '목록 보기' },
  { id: 'card', label: '카드 보기' },
];
export const saveFormats: { id: SaveFormat; label: string }[] = [
  { id: 'wav', label: 'WAV (무손실, 큰 용량)' },
  { id: 'flac', label: 'FLAC (무손실, 압축)' },
  { id: 'mp3', label: 'MP3 (320kbps)' },
  { id: 'mp4', label: 'MP4/AAC (256kbps)' },
];
export const models = [
  { id: 'yue2-q4', name: 'YuE2 · Q4', detail: '가벼운 시작', size: '2.67 GB', engine: 'audio.cpp', file: 'yue2-3b-q4_0.gguf', badge: '이 PC 추천' },
  { id: 'yue2-q8', name: 'YuE2 · Q8', detail: '정밀도 우선', size: '4.26 GB', engine: 'audio.cpp', file: 'yue2-3b-q8_0.gguf', badge: '실험적' },
  { id: 'yue2-bf16', name: 'YuE2 · BF16', detail: '양자화하지 않은 GGUF', size: '7.26 GB', engine: 'audio.cpp', file: 'yue2-3b-bf16.gguf', badge: '고용량 GPU' },
  { id: 'yue2-original', name: 'YuE2 · 원본', detail: '공식 Python 모델', size: '7.26 GB', engine: 'Python', file: 'model.safetensors', badge: '24 GB 환경 권장' },
];
export const providers: { id: Provider; label: string; mark: string; description: string }[] = [
  { id: 'none', label: '사용 안 함', mark: '—', description: '직접 가사 작성' },
  { id: 'ollama', label: 'Ollama', mark: 'O', description: '내 PC에서 실행' },
  { id: 'claude', label: 'Claude', mark: 'C', description: 'Anthropic API' },
  { id: 'chatgpt', label: 'ChatGPT', mark: 'G', description: 'OpenAI API' },
  { id: 'gemini', label: 'Gemini', mark: '✦', description: 'Google AI API' },
];
export type Example = { id: string; title: string; genre?: string; caption?: string; color?: string; style: string; lyrics: string; createdAt?: string };
export const titles: Record<Page, string> = { create: '만들기', home: '내 홈', library: '내 라이브러리', projects: '프로젝트', favorites: '좋아요', playlists: '재생목록', models: '모델 관리', settings: '설정' };
export const gb = (bytes = 0) => `${(bytes / 1e9).toFixed(2)} GB`;
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const sending = method !== 'GET';
  const response = await fetch(`/api${path}`, { method, headers: sending ? { 'Content-Type': 'application/json' } : undefined, body: sending ? JSON.stringify(body ?? {}) : undefined });
  let data;
  try { data = await response.json(); } catch { throw new Error('로컬 서비스에 연결할 수 없습니다. 앱을 다시 실행해 주세요.'); }
  if (!response.ok) throw new Error((data as { error?: string }).error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return data as T;
}
