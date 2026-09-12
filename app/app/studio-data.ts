export type Page = 'create' | 'home' | 'cover' | 'library' | 'projects' | 'favorites' | 'playlists' | 'abc' | 'models' | 'settings';
export type Provider = 'none' | 'ollama' | 'claude' | 'chatgpt' | 'gemini';
export type VocalGender = '' | 'male' | 'female' | 'duet';
export type Draft = { title: string; lyrics: string; style: string; modelId: string; seed: number; steps: number; cot: string; vocalGender: VocalGender; instrumental: boolean; abc: string; mode: string };
export type SaveFormat = 'wav' | 'flac' | 'mp3' | 'mp4';
export type Project = Draft & { id: string; sourceProjectId?: string; createdAt: string; updatedAt: string; status: string; favorite?: boolean; notes?: string; audioPath?: string; coverPath?: string | null; durationMs?: number | null; rtf?: number | null; truncated?: boolean; saveError?: string | null };
export type Playlist = { id: string; name: string; songIds: string[]; createdAt: string; updatedAt: string };
export type AbcNote = { id: string; title: string; abc: string; coverPath?: string | null; createdAt: string; updatedAt?: string };
export type ViewMode = 'list' | 'card';
export type Settings = { provider: Provider; endpoint: string; llmModel: string; hasApiKey?: boolean; apiKey?: string | null; enginePath: string; pythonEnginePath: string; pythonScriptPath: string; pythonMemoryBudgetGib: number; sheetSagePythonPath: string; settingPath: string; musicPath: string; examplesPath: string; coversPath: string; abcNotesPath: string; stylePresets: string; visualizerEnabled: boolean; visualizerRingCount: number; visualizerHue: number; visualizerLineWidth: number; visualizerTrail: number; saveFormat: SaveFormat; viewMode: ViewMode; outputDirectory: string };
export const DEFAULT_STYLE_PRESETS = 'Acoustic\nCity Pop\nBallad\nLo-fi\nJazz';
export type CoverPreset = {
  id: string;
  name: string;
  badge: string;
  desc: string;
  style: string;
  icon: string;
};

export const COVER_PRESETS: CoverPreset[] = [
  {
    id: 'city-pop',
    name: '시티팝',
    badge: 'City Pop',
    desc: '80s 레트로 신스, 펑키한 슬랩 베이스, 그루비 드럼 (115 BPM)',
    style: 'Korean city pop, 80s retro synthesizer, funky slap bass, groovy drums, nostalgic female vocal, 115 BPM',
    icon: '🌆',
  },
  {
    id: 'acoustic',
    name: '어쿠스틱 발라드',
    badge: 'Acoustic',
    desc: '따뜻한 핑거스타일 기타, 잔잔한 그랜드 피아노, 서정적 현악 (74 BPM)',
    style: 'Acoustic ballad, warm fingerstyle acoustic guitar, gentle grand piano, soft strings, emotional vocal, 74 BPM',
    icon: '🎸',
  },
  {
    id: 'lofi',
    name: '로파이 칠홉',
    badge: 'Lo-Fi Chill',
    desc: '바이닐 크랙클 노이즈, 빈티지 로즈 피아노, 칠한 힙합 비트 (84 BPM)',
    style: 'Lo-fi chillhop, vintage Rhodes piano, vinyl dust crackle, smooth jazz chords, laid-back boom bap drum, 84 BPM',
    icon: '☕',
  },
  {
    id: 'synthwave',
    name: '신스웨이브',
    badge: 'Synthwave',
    desc: '질주하는 아날로그 베이스 아르페지오, 네온 신스 리드 (126 BPM)',
    style: 'Synthwave, cyberpunk retro electro, driving analog bass arp, lush neon synth lead, punchy gated snare, 126 BPM',
    icon: '⚡',
  },
  {
    id: 'orchestral',
    name: '심포닉 오케스트라',
    badge: 'Orchestral',
    desc: '웅장한 풀 현악 앙상블, 프렌치 호른 브라스, 시네마틱 퍼커션 (92 BPM)',
    style: 'Cinematic orchestral, grand string quartet, powerful French horns, cinematic percussion, epic choral swells, 92 BPM',
    icon: '🎻',
  },
  {
    id: 'jazz',
    name: '재즈 라운지',
    badge: 'Jazz Trio',
    desc: '스윙 리듬, 어쿠스틱 콘트라베이스, 감미로운 즉흥 피아노 (108 BPM)',
    style: 'Jazz lounge, upright double bass, brush snare rhythm, sweet improvisational jazz piano, mellow vibe, 108 BPM',
    icon: '🎹',
  },
  {
    id: 'k-dance',
    name: 'K-Pop 댄스',
    badge: 'K-Dance',
    desc: '강렬한 808 베이스, 세련된 하이햇 롤과 댄서블 신스 (122 BPM)',
    style: 'Modern K-pop dance, punchy 808 bass, crisp trap hi-hats, vibrant catchy vocal chops, energetic drop, 122 BPM',
    icon: '✨',
  },
  {
    id: 'anime-rock',
    name: '애니메이션 록',
    badge: 'Anime Rock',
    desc: '청량한 일렉기타 리프, 폭발적인 드럼, 감성적인 멜로디 (165 BPM)',
    style: 'Energetic J-rock, anime opening style, driving electric guitar riffs, passionate melody, dynamic drums, 165 BPM',
    icon: '🔥',
  },
];
export const DEFAULT_VISUALIZER_ENABLED = true;
export const DEFAULT_VISUALIZER_RING_COUNT = 18;
export const DEFAULT_VISUALIZER_HUE = 190;
export const DEFAULT_VISUALIZER_LINE_WIDTH = 1;
export const DEFAULT_VISUALIZER_TRAIL = 0;
export type Inventory = { state: string; totalBytes: number; completedBytes: number; repositories: { id: string; state: string; path: string; totalBytes: number; completedBytes: number; files: { path: string; state: string; size: number }[] }[] };
export type SystemInfo = { name?: string | null; vramMb: number | null };
export const PYTHON_MODEL_MIN_VRAM_MB = 12 * 1024;
export const emptyDraft: Draft = { title: '', lyrics: '', style: '', modelId: 'yue2-q4', seed: 42, steps: 8, cot: 'full', vocalGender: '', instrumental: false, abc: '', mode: 'custom' };
export const initialSettings: Settings = { provider: 'none', endpoint: '', llmModel: '', apiKey: null, enginePath: '', pythonEnginePath: '', pythonScriptPath: '', pythonMemoryBudgetGib: 11, sheetSagePythonPath: '', settingPath: '', musicPath: '', examplesPath: '', coversPath: '', abcNotesPath: '', stylePresets: DEFAULT_STYLE_PRESETS, visualizerEnabled: DEFAULT_VISUALIZER_ENABLED, visualizerRingCount: DEFAULT_VISUALIZER_RING_COUNT, visualizerHue: DEFAULT_VISUALIZER_HUE, visualizerLineWidth: DEFAULT_VISUALIZER_LINE_WIDTH, visualizerTrail: DEFAULT_VISUALIZER_TRAIL, saveFormat: 'wav', viewMode: 'list', outputDirectory: '' };
export const DEFAULT_SETTING_PATH = 'Library\\Setting';
export const DEFAULT_MUSIC_PATH = 'Library\\Music';
export const DEFAULT_EXAMPLES_PATH = 'Library\\Examples';
export const DEFAULT_COVERS_PATH = 'Library\\Cover';
export const DEFAULT_ABC_NOTES_PATH = 'Library\\Abc-Note';
export const DEFAULT_ENGINE_PATH = 'engine\\audio.cpp\\build\\windows-cuda-release\\bin\\audiocpp_cli.exe';
export const viewModes: { id: ViewMode; label: string }[] = [
  { id: 'list', label: '목록 보기' },
  { id: 'card', label: '카드 보기' },
];
export const saveFormats: { id: SaveFormat; label: string }[] = [
  { id: 'wav', label: 'WAV (무손실, 큰 용량)' },
  { id: 'flac', label: 'FLAC (무손실, 압축)' },
  { id: 'mp3', label: 'MP3 (320kbps)' },
  { id: 'mp4', label: 'MP4-video (커버 이미지 + 오디오)' },
];
export const models = [
  { id: 'yue2-q4', name: 'YuE2 - Q4 GGUF', detail: '가벼운 시작', size: '2.67 GB', engine: 'audio.cpp', file: 'yue2-3b-q4_0.gguf', badge: '이 PC 추천' },
  { id: 'yue2-q8', name: 'YuE2 - Q8 GGUF', detail: '정밀도 우선', size: '4.26 GB', engine: 'audio.cpp', file: 'yue2-3b-q8_0.gguf', badge: '실험적' },
  { id: 'yue2-bf16', name: 'YuE2 - BF16 GGUF', detail: '원본 본체를 GGUF로 변환한 BF16', size: '7.26 GB', engine: 'audio.cpp', file: 'yue2-3b-bf16.gguf', badge: '고용량 GPU' },
  { id: 'yue2-int8-convrot', name: 'YuE2 - INT8 ConvRot', detail: 'ComfyUI 어댑터 필요', size: '3.96 GB', engine: 'ComfyUI', file: 'yue2_3b_int8_convrot.safetensors', repo: 'comfy-org/YuE2', badge: '연결 대기', selectable: false },
  { id: 'yue2-original', name: 'YuE2 - 원본', detail: '공식 Python safetensors 본체', size: '7.26 GB', engine: 'Python', file: 'model.safetensors', badge: '24 GB 환경 권장' },
];
export const providers: { id: Provider; label: string; mark: string; description: string }[] = [
  { id: 'none', label: '사용 안 함', mark: '—', description: '직접 가사 작성' },
  { id: 'ollama', label: 'Ollama', mark: 'O', description: '내 PC에서 실행' },
  { id: 'claude', label: 'Claude', mark: 'C', description: 'Anthropic API' },
  { id: 'chatgpt', label: 'ChatGPT', mark: 'G', description: 'OpenAI API' },
  { id: 'gemini', label: 'Gemini', mark: '✦', description: 'Google AI API' },
];
export type Example = { id: string; title: string; genre?: string; caption?: string; color?: string; style: string; lyrics: string; createdAt?: string };
export const titles: Record<Page, string> = { create: '만들기', home: '내 홈', cover: '커버 스튜디오', library: '내 라이브러리', projects: '프로젝트', favorites: '좋아요', playlists: '재생목록', abc: 'ABC 악보', models: '모델 관리', settings: '설정' };
export const gb = (bytes = 0) => `${(bytes / 1e9).toFixed(2)} GB`;
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const sending = method !== 'GET';
  const response = await fetch(`/api${path}`, { method, headers: sending ? { 'Content-Type': 'application/json' } : undefined, body: sending ? JSON.stringify(body ?? {}) : undefined });
  let data;
  try { data = await response.json(); } catch { throw new Error('로컬 서비스에 연결할 수 없습니다. 앱을 다시 실행해 주세요.'); }
  if (!response.ok) throw new Error((data as { error?: string }).error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return data as T;
}


export const DEFAULT_INSTRUMENTAL_ABC = `X:1
T:
M:4/4
L:1/16
Q:1/4=120
V: Vocal clef=treble name="Vocal Melody" snm="Vocal"
V: Ins clef=treble name="Ins Melody" snm="Inst."
K:C
% intro
V: Vocal
"C"z16 | "G"z16 | "Am"z16 | "F"z16 |
V: Ins
c4 e4 g4 e4 | d4 g4 b4 g4 | c4 e4 a4 e4 | A4 c4 f4 c4 |
% verse
V: Vocal
"C"z8 "G"z8 | "Am"z8 "F"z8 | "C"z8 "G"z8 | "F"z8 "G"z8 |
V: Ins
e2g2 c'2g2 d2g2 b2g2 | c2e2 a2c2 A2c2 f2c2 | e2g2 c'2g2 d2g2 b2g2 | A2c2 f2c2 d2g2 b2g2 |
% chorus
V: Vocal
"C"z16 | "F"z16 | "G"z16 | "C"z16 |
V: Ins
c'4 g4 e4 g4 | a4 f4 c4 f4 | b4 g4 d4 g4 | c'8 c4 z4 |
`;

export function toInstrumentalAbc(abc: string): string {
  if (!abc || !abc.trim()) return DEFAULT_INSTRUMENTAL_ABC;
  const lines = abc.split(/\r?\n/);
  const result: string[] = [];
  let currentVoice: 'Vocal' | 'Ins' | null = null;
  let lastVocalLine: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('V: Vocal') && !line.includes('clef=')) {
      currentVoice = 'Vocal';
      result.push(line);
      continue;
    }
    if (line.startsWith('V: Ins') && !line.includes('clef=')) {
      currentVoice = 'Ins';
      result.push(line);
      continue;
    }
    if (line.startsWith('V:')) {
      result.push(line);
      continue;
    }
    if (currentVoice === 'Vocal' && line.trim().endsWith('|')) {
      lastVocalLine = line;
      const bars = line.trim().slice(0, -1).split('|');
      const vocalBars = bars.map(bar => {
        const tokenRegex = /"([^"]*)"|\[K:[^\]]+\]|(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)([0-9]*)(-?)/g;
        let m: RegExpExecArray | null;
        let curChord: string | null = null;
        let curDur = 0;
        const events: { chord: string | null; dur: number }[] = [];
        while ((m = tokenRegex.exec(bar)) !== null) {
          if (m[1] !== undefined) {
            if (curChord !== null || curDur > 0) {
              events.push({ chord: curChord, dur: curDur });
              curDur = 0;
            }
            curChord = m[1];
          } else if (m[3] !== undefined) {
            const dur = parseInt(m[5] || '1', 10);
            curDur += dur;
          }
        }
        if (curChord !== null || curDur > 0) {
          events.push({ chord: curChord, dur: curDur });
        }
        return events.map(e => e.chord ? `"${e.chord}"z${e.dur > 1 ? e.dur : ''}` : `z${e.dur > 1 ? e.dur : ''}`).join(' ');
      });
      result.push(' ' + vocalBars.join(' | ') + ' |');
      continue;
    }
    if (currentVoice === 'Ins' && line.trim().endsWith('|')) {
      if (lastVocalLine && (line.includes('Z') || !/[A-Ga-g]/.test(line))) {
        const insLine = lastVocalLine.replace(/"[^"]*"/g, '').replace(/\s+/g, ' ').trim();
        result.push(' ' + insLine);
      } else {
        result.push(line);
      }
      lastVocalLine = null;
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}
