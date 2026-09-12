'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as ABCJS from 'abcjs';
import { AudioLines, ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Cpu, Dices, Download, FastForward, FileText, Folder, FolderOpen, Guitar, Headphones, Heart, Home, Image as ImageIcon, LayoutGrid, ListMusic, ListPlus, LoaderCircle, Menu, Mic, MoreVertical, Music2, Pause, Pencil, Play, Plus, Power, RefreshCw, Rewind, RotateCcw, Save, Search, Settings2, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Square, Trash2, Upload, Volume2, WandSparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { api, emptyDraft, initialSettings, models, providers, saveFormats, viewModes, titles, gb, DEFAULT_SETTING_PATH, DEFAULT_MUSIC_PATH, DEFAULT_EXAMPLES_PATH, DEFAULT_COVERS_PATH, DEFAULT_ABC_NOTES_PATH, DEFAULT_STYLE_PRESETS, DEFAULT_VISUALIZER_RING_COUNT, DEFAULT_VISUALIZER_HUE, DEFAULT_VISUALIZER_LINE_WIDTH, DEFAULT_ENGINE_PATH, PYTHON_MODEL_MIN_VRAM_MB, type Page, type Draft, type Project, type Settings, type Inventory, type Example, type Playlist, type AbcNote, type SaveFormat, type SystemInfo } from './studio-data';

type SaveFilePickerFn = (options?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }> }>;
const RANDOMIZE_SEED_KEY = 'songyue2-randomize-seed';
function loadRandomizeSeed(): boolean {
  try { return localStorage.getItem(RANDOMIZE_SEED_KEY) === '1'; } catch { return false; }
}
function AbcPreview({ abc, large, controlsSlot }: { abc: string; large?: boolean; controlsSlot?: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const synthRef = useRef<ABCJS.SynthController | null>(null);
  const highlightedRef = useRef<Element[]>([]);
  const playStartRef = useRef<number | null>(null);
  const [debounced, setDebounced] = useState(abc);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [audioReady, setAudioReady] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDebounced(abc), 250); return () => clearTimeout(timer); }, [abc]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (synthRef.current) { synthRef.current.destroy(); synthRef.current = null; }
    highlightedRef.current = [];
    setIsPlaying(false);
    setAudioReady(false);
    el.innerHTML = '';
    if (!debounced.trim()) return;
    let tunes: ABCJS.TuneObject[];
    try { tunes = ABCJS.renderAbc(el, debounced, { responsive: 'resize', add_classes: true }); }
    catch { el.innerHTML = '<p class="abc-preview-error">악보를 표시할 수 없습니다. 문법을 확인해 주세요.</p>'; return; }
    const tune = tunes[0];
    if (!tune || !ABCJS.synth.supportsAudio()) return;
    const controller = new ABCJS.synth.SynthController();
    controller.cursorControl = {
      onEvent: event => {
        highlightedRef.current.forEach(node => node.classList.remove('abc-note-current'));
        highlightedRef.current = (event.elements || []).flat();
        highlightedRef.current.forEach(node => node.classList.add('abc-note-current'));
        highlightedRef.current[0]?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      },
      onFinished: () => {
        const expectedMs = (controller.midiBuffer?.duration || 0) * 1000;
        const elapsedMs = playStartRef.current === null ? Infinity : performance.now() - playStartRef.current;
        if (expectedMs > 300 && elapsedMs < expectedMs * 0.5) {
          controller.seek(0);
          playStartRef.current = performance.now();
          void controller.play();
          return;
        }
        highlightedRef.current.forEach(node => node.classList.remove('abc-note-current'));
        highlightedRef.current = [];
        setIsPlaying(false);
      },
    };
    controller.setTune(tune, false, { soundFontVolumeMultiplier: volume }).then(() => setAudioReady(true)).catch(() => setAudioReady(false));
    synthRef.current = controller;
    return () => { controller.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  function togglePlay() {
    const sc = synthRef.current;
    if (!sc) return;
    const startingFresh = !sc.isStarted && sc.isLoaded && sc.percent === 0;
    void sc.play().then(() => {
      if (startingFresh) sc.seek(0);
      if (sc.isStarted) playStartRef.current = performance.now();
      setIsPlaying(sc.isStarted);
    });
  }
  function stopPlayback() {
    const sc = synthRef.current;
    if (!sc) return;
    sc.pause();
    sc.restart();
    highlightedRef.current.forEach(node => node.classList.remove('abc-note-current'));
    highlightedRef.current = [];
    setIsPlaying(false);
  }
  function seekBy(delta: number) {
    const sc = synthRef.current;
    if (!sc) return;
    sc.seek(Math.max(0, Math.min(1, (sc.percent || 0) + delta)));
  }
  function cycleSpeed() {
    const sc = synthRef.current;
    if (!sc) return;
    const next = playbackRate >= 2 ? 1 : 2;
    setPlaybackRate(next);
    void sc.setWarp(next * 100);
  }
  function applyVolume(next: number) {
    setVolume(next);
    const sc = synthRef.current;
    if (!sc || !sc.visualObj) return;
    const wasPlaying = sc.isStarted;
    const startPercent = sc.percent;
    sc.options = { ...sc.options, soundFontVolumeMultiplier: next };
    sc.destroy();
    sc.isStarted = false;
    void sc.go().then(() => {
      sc.seek(startPercent);
      if (wasPlaying) void sc.play();
    });
  }
  const controls = (audioReady || large) && <div className="abc-player-controls">
    <Button variant="ghost" size="icon" aria-label="10% 뒤로" onClick={() => seekBy(-0.1)} disabled={!audioReady}><Rewind size={15}/></Button>
    <Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={togglePlay} disabled={!audioReady}>{isPlaying ? <Pause size={15}/> : <Play size={15}/>}</Button>
    <Button variant="ghost" size="icon" aria-label="정지" onClick={stopPlayback} disabled={!audioReady}><Square size={15}/></Button>
    <Button variant="ghost" size="icon" aria-label="10% 앞으로" onClick={() => seekBy(0.1)} disabled={!audioReady}><FastForward size={15}/></Button>
    <button className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed} disabled={!audioReady}>{playbackRate}x</button>
    <Volume2 size={14}/>
    <input className="abc-player-volume" type="range" aria-label="볼륨" min={0} max={2} step={0.1} value={volume} onChange={event => applyVolume(Number(event.target.value))} disabled={!audioReady}/>
  </div>;
  return <>
    <div className={`abc-preview${large ? ' abc-preview-lg' : ''}`}>
      {!abc.trim() && <p className="field-hint">여기에 오선보 형태로 미리보기가 표시됩니다.</p>}
      <div ref={ref}/>
      {!controlsSlot && controls}
    </div>
    {controlsSlot && controls ? createPortal(controls, controlsSlot) : null}
  </>;
}

// --- post-process / EQ ---
const PP_EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const PP_EQ_LABELS = ['31 Hz', '62 Hz', '125 Hz', '250 Hz', '500 Hz', '1 kHz', '2 kHz', '4 kHz', '8 kHz', '16 kHz'];
const PP_CUSTOM_PRESET = '사용자 지정';
const PP_EQ_PRESETS: Record<string, number[]> = {
  '평탄': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  '베이스 부스트': [46, 33, 21, 8, 0, -4, -8, -8, -4, 0],
  '보컬 강조': [-17, -13, -4, 4, 13, 21, 25, 17, 4, -4],
  '트레블 부스트': [-8, -4, 0, 0, 4, 8, 21, 38, 50, 58],
  '라우드니스': [33, 21, 8, 0, -8, -13, -4, 8, 21, 29],
  '어쿠스틱': [13, 17, 13, 4, 0, 4, 8, 13, 8, 4],
};
const PP_EQ_PRESET_NAMES = Object.keys(PP_EQ_PRESETS);
async function loadCustomEqPresets(): Promise<Record<string, number[]>> {
  try {
    const list = await api<{ name: string; eq: number[] }[]>('/eq-presets');
    return Object.fromEntries(list.map(preset => [preset.name, preset.eq]));
  } catch { return {}; }
}
type PostProcessParams = { eq: number[]; masterVolume: number; eqEnabled: boolean; fxEnabled: boolean; reverbEchoEnabled: boolean; clarity: number; spaciousness: number; surround: number; dynamicBoost: number; bassBoost: number; reverbAmount: number; reverbLength: number; echoAmount: number; echoDelayMs: number };
const PP_DEFAULT_PARAMS: PostProcessParams = { eq: Array(10).fill(0), masterVolume: 100, eqEnabled: true, fxEnabled: true, reverbEchoEnabled: true, clarity: 0, spaciousness: 0, surround: 0, dynamicBoost: 0, bassBoost: 0, reverbAmount: 0, reverbLength: 50, echoAmount: 0, echoDelayMs: 300 };
async function loadPostprocessPresets(): Promise<Record<string, PostProcessParams>> {
  try {
    const list = await api<{ name: string; params: PostProcessParams }[]>('/postprocess-settings');
    return Object.fromEntries(list.map(preset => [preset.name, preset.params]));
  } catch { return {}; }
}

function buildProcessingGraph(ctx: BaseAudioContext, source: AudioNode, params: PostProcessParams): AudioNode {
  let node: AudioNode = source;
  for (let i = 0; i < PP_EQ_BANDS.length; i++) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.value = PP_EQ_BANDS[i];
    filter.Q.value = 1.4;
    filter.gain.value = params.eqEnabled ? (params.eq[i] / 100) * 24 : 0;
    node.connect(filter);
    node = filter;
  }
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 150;
  bass.gain.value = params.fxEnabled ? (params.bassBoost / 100) * 18 : 0;
  node.connect(bass);
  node = bass;
  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 6000;
  treble.gain.value = params.fxEnabled ? (params.clarity / 100) * 15 : 0;
  node.connect(treble);
  node = treble;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 12;
  compressor.ratio.value = 1 + (params.fxEnabled ? (params.dynamicBoost / 100) * 11 : 0);
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;
  node.connect(compressor);
  node = compressor;
  const makeup = ctx.createGain();
  makeup.gain.value = 1 + (params.fxEnabled ? (params.dynamicBoost / 100) * 0.4 : 0);
  node.connect(makeup);
  node = makeup;
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  node.connect(splitter);
  const leftDelay = ctx.createDelay(0.05);
  const rightDelay = ctx.createDelay(0.05);
  rightDelay.delayTime.value = params.fxEnabled ? (params.spaciousness / 100) * 0.02 : 0;
  const crossL = ctx.createGain();
  const crossR = ctx.createGain();
  crossL.gain.value = params.fxEnabled ? (params.surround / 100) * 0.25 : 0;
  crossR.gain.value = params.fxEnabled ? (params.surround / 100) * 0.25 : 0;
  splitter.connect(leftDelay, 0);
  splitter.connect(rightDelay, 1);
  leftDelay.connect(merger, 0, 0);
  rightDelay.connect(merger, 0, 1);
  splitter.connect(crossR, 0);
  crossR.connect(merger, 0, 1);
  splitter.connect(crossL, 1);
  crossL.connect(merger, 0, 0);
  node = merger;
  const dry = ctx.createGain();
  dry.gain.value = 1;
  node.connect(dry);
  const reverbWet = ctx.createGain();
  reverbWet.gain.value = params.reverbEchoEnabled ? (params.reverbAmount / 100) * 0.6 : 0;
  const convolver = ctx.createConvolver();
  const irSeconds = 0.3 + (params.reverbLength / 100) * 2.7;
  const irLength = Math.max(1, Math.floor(irSeconds * ctx.sampleRate));
  const irBuffer = ctx.createBuffer(2, irLength, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = irBuffer.getChannelData(ch);
    for (let i = 0; i < irLength; i++) { const decay = Math.pow(1 - i / irLength, 2.5); data[i] = (Math.random() * 2 - 1) * decay; }
  }
  convolver.buffer = irBuffer;
  node.connect(convolver);
  convolver.connect(reverbWet);
  const echoWet = ctx.createGain();
  echoWet.gain.value = params.reverbEchoEnabled ? (params.echoAmount / 100) * 0.7 : 0;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = params.echoDelayMs / 1000;
  const feedback = ctx.createGain();
  feedback.gain.value = params.reverbEchoEnabled ? Math.min(0.6, (params.echoAmount / 100) * 0.6) : 0;
  node.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(echoWet);
  const master = ctx.createGain();
  master.gain.value = Math.max(0, params.masterVolume) / 100;
  dry.connect(master);
  reverbWet.connect(master);
  echoWet.connect(master);
  return master;
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const blockAlign = numChannels * 2;
  const dataLength = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);
  const writeString = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channelData.push(buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function computeWaveformPeaks(buffer: AudioBuffer, buckets: number): number[] {
  const channel = buffer.getChannelData(0);
  const perBucket = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * perBucket;
    const end = Math.min(channel.length, start + perBucket);
    for (let j = start; j < end; j++) { const v = Math.abs(channel[j]); if (v > max) max = v; }
    peaks.push(max);
  }
  return peaks;
}

function Waveform({ peaks, playedFraction, variant }: { peaks: number[]; playedFraction?: number; variant?: 'processed' }) {
  return <div className={variant ? `pp-waveform pp-waveform-${variant}` : 'pp-waveform'}>{peaks.map((peak, index) => <span key={index} className={playedFraction !== undefined && index / peaks.length <= playedFraction ? 'played' : ''} style={{ height: `${Math.max(4, peak * 100)}%` }}/>)}</div>;
}

function snapTo5(value: number): number { return Math.round(value / 5) * 5; }

function EqBar({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startY: event.clientY, startValue: value };
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - event.clientY;
    onChange(snapTo5(Math.max(-100, Math.min(100, dragRef.current.startValue + delta))));
  }
  const halfHeightPct = Math.abs(value) / 100 * 50;
  const bottomPct = value >= 0 ? 50 : 50 - halfHeightPct;
  return <div className="eq-bar-col">
    <input type="number" className="eq-bar-value" value={value} min={-100} max={100} step={5} onChange={event => onChange(Math.max(-100, Math.min(100, Number(event.target.value) || 0)))} onBlur={event => onChange(snapTo5(Math.max(-100, Math.min(100, Number(event.target.value) || 0))))}/>
    <div className="eq-bar-track" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = null; }}>
      <div className="eq-bar-zero"/>
      <div className="eq-bar-fill" style={{ bottom: `${bottomPct}%`, height: `${halfHeightPct}%` }}/>
    </div>
    <span className="eq-bar-label">{label}</span>
  </div>;
}

function Knob({ label, value, min, max, onChange, variant }: { label: string; value: number; min: number; max: number; onChange: (next: number) => void; variant?: 'fx' | 'reverb' }) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null);
  const pct = (value - min) / (max - min);
  const angle = -135 + pct * 270;
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startY: event.clientY, startValue: value };
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - event.clientY;
    const next = dragRef.current.startValue + (delta / 150) * (max - min);
    onChange(snapTo5(Math.max(min, Math.min(max, next))));
  }
  return <div className={variant ? `knob knob-${variant}` : 'knob'}>
    <div className="knob-dial" style={{ '--pct': pct } as React.CSSProperties} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { dragRef.current = null; }}>
      <div className="knob-pointer" style={{ transform: `rotate(${angle}deg)` }}/>
    </div>
    <span className="knob-label">{label}</span>
    <input type="number" className="knob-value" value={value} min={min} max={max} step={5} onChange={event => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))} onBlur={event => onChange(snapTo5(Math.max(min, Math.min(max, Number(event.target.value) || 0))))}/>
  </div>;
}

function PostProcessDialog({ project, onClose, notify, visualizerEnabled, visualizerRingCount, visualizerHue, visualizerLineWidth }: { project: Project; onClose: () => void; notify: (text: string, error?: boolean) => void; visualizerEnabled: boolean; visualizerRingCount: number; visualizerHue: number; visualizerLineWidth: number }) {
  const [params, setParams] = useState<PostProcessParams>(PP_DEFAULT_PARAMS);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [originalPeaks, setOriginalPeaks] = useState<number[]>([]);
  const [processedPeaks, setProcessedPeaks] = useState<number[]>([]);
  const [eqPreset, setEqPreset] = useState<string>('평탄');
  const [customPresets, setCustomPresets] = useState<Record<string, number[]>>({});
  const [postprocessPreset, setPostprocessPreset] = useState('');
  const [postprocessPresets, setPostprocessPresets] = useState<Record<string, PostProcessParams>>({});
  const [postprocessNameDialogOpen, setPostprocessNameDialogOpen] = useState(false);
  const [postprocessNameDraft, setPostprocessNameDraft] = useState('');
  const [activeTrack, setActiveTrack] = useState<'original' | 'processed' | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewVolume, setPreviewVolume] = useState(1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const decodedRef = useRef<AudioBuffer | null>(null);
  const processedRef = useRef<AudioBuffer | null>(null);
  const previewGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rateRef = useRef(1);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => { void loadCustomEqPresets().then(setCustomPresets); void loadPostprocessPresets().then(setPostprocessPresets); }, []);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => {
    let raf = 0;
    const points = 64;
    const ringCount = Math.max(1, visualizerRingCount);
    const rings = Array.from({ length: ringCount }, (_, i) => ({
      radiusFactor: 0.1 + (i / Math.max(1, ringCount - 1)) * 0.24,
      hue: (visualizerHue + ((i * 37) % 100)) % 360,
      offset: Math.floor((i * points) / ringCount),
    }));
    const tick = () => {
      const canvas = visualizerCanvasRef.current;
      const analyser = analyserRef.current;
      const ctx2d = canvas?.getContext('2d');
      if (canvas && ctx2d) {
        const { width, height } = canvas;
        ctx2d.clearRect(0, 0, width, height);
        const playing = visualizerEnabled && isPlayingRef.current;
        if (playing) {
          const cx = width / 2;
          const cy = height / 2;
          const data = new Uint8Array(analyser?.frequencyBinCount || points);
          if (analyser) analyser.getByteFrequencyData(data);
          for (const ring of rings) {
            const baseRadius = Math.min(width, height) * ring.radiusFactor;
            const nodes: { x: number; y: number }[] = [];
            for (let i = 0; i < points; i++) {
              const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
              const value = analyser ? data[Math.floor(((i + ring.offset) % points) * data.length / points)] / 255 : 0;
              const radius = baseRadius + value * baseRadius * 1.3;
              nodes.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
            }
            ctx2d.beginPath();
            const first = { x: (nodes[0].x + nodes[points - 1].x) / 2, y: (nodes[0].y + nodes[points - 1].y) / 2 };
            ctx2d.moveTo(first.x, first.y);
            for (let i = 0; i < points; i++) {
              const p0 = nodes[i];
              const p1 = nodes[(i + 1) % points];
              const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
              ctx2d.quadraticCurveTo(p0.x, p0.y, mid.x, mid.y);
            }
            ctx2d.closePath();
            ctx2d.strokeStyle = `hsla(${ring.hue}, 95%, 78%, 0.55)`;
            ctx2d.lineWidth = visualizerLineWidth;
            ctx2d.stroke();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visualizerEnabled, visualizerRingCount, visualizerHue, visualizerLineWidth]);

  async function renderProcessed(currentParams: PostProcessParams) {
    const decoded = decodedRef.current;
    if (!decoded) return;
    setRendering(true);
    try {
      const offlineCtx = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      const output = buildProcessingGraph(offlineCtx, source, currentParams);
      output.connect(offlineCtx.destination);
      source.start();
      const rendered = await offlineCtx.startRendering();
      processedRef.current = rendered;
      setProcessedPeaks(computeWaveformPeaks(rendered, 300));
    } catch { setErrorText('오디오 처리 중 오류가 발생했습니다.'); }
    finally { setRendering(false); }
  }

  useEffect(() => {
    let cancelled = false;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const gainNode = ctx.createGain();
    gainNode.gain.value = previewVolume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    gainNode.connect(analyser);
    analyser.connect(ctx.destination);
    previewGainRef.current = gainNode;
    analyserRef.current = analyser;
    (async () => {
      try {
        const response = await fetch(`/api/projects/${project.id}/audio`);
        if (!response.ok) throw new Error('load failed');
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        if (cancelled) return;
        decodedRef.current = decoded;
        setOriginalPeaks(computeWaveformPeaks(decoded, 300));
        setLoading(false);
        await renderProcessed(PP_DEFAULT_PARAMS);
      } catch { if (!cancelled) setErrorText('원본 오디오를 불러오지 못했습니다.'); }
    })();
    return () => { cancelled = true; void ctx.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  function scheduleRender(next: PostProcessParams) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { void renderProcessed(next); }, 350);
  }
  function updateEq(index: number, value: number) {
    setParams(previous => {
      const eq = previous.eq.slice();
      eq[index] = value;
      const next = { ...previous, eq };
      scheduleRender(next);
      return next;
    });
    setEqPreset(PP_CUSTOM_PRESET);
  }
  function updateParam<K extends keyof PostProcessParams>(key: K, value: PostProcessParams[K]) {
    setParams(previous => {
      const next = { ...previous, [key]: value };
      scheduleRender(next);
      return next;
    });
  }
  function applyEqPreset(name: string) {
    setEqPreset(name);
    const preset = PP_EQ_PRESETS[name] || customPresets[name];
    if (!preset) return;
    setParams(previous => {
      const next = { ...previous, eq: preset.slice() };
      scheduleRender(next);
      return next;
    });
  }
  async function saveCurrentAsPreset() {
    const name = window.prompt('저장할 프리셋 이름을 입력하세요', eqPreset === PP_CUSTOM_PRESET ? '' : eqPreset)?.trim();
    if (!name) return;
    if (PP_EQ_PRESET_NAMES.includes(name)) { notify('기본 프리셋과 같은 이름은 사용할 수 없습니다.', true); return; }
    try {
      const saved = await api<{ name: string; eq: number[] }>('/eq-presets', 'POST', { name, eq: params.eq });
      setCustomPresets(previous => ({ ...previous, [saved.name]: saved.eq }));
      setEqPreset(saved.name);
      notify(`"${saved.name}" 프리셋으로 저장했습니다.`);
    } catch (error) { notify((error as Error).message, true); }
  }
  async function deleteCustomPreset(name: string) {
    try {
      await api(`/eq-presets?name=${encodeURIComponent(name)}`, 'DELETE');
      setCustomPresets(previous => { const next = { ...previous }; delete next[name]; return next; });
      applyEqPreset('평탄');
    } catch (error) { notify((error as Error).message, true); }
  }
  function resetEq() { applyEqPreset('평탄'); }
  function resetFx() {
    setParams(previous => {
      const next = { ...previous, clarity: 0, spaciousness: 0, surround: 0, dynamicBoost: 0, bassBoost: 0 };
      scheduleRender(next);
      return next;
    });
  }
  function resetReverbEcho() {
    setParams(previous => {
      const next = { ...previous, reverbAmount: 0, reverbLength: 0, echoAmount: 0, echoDelayMs: 40 };
      scheduleRender(next);
      return next;
    });
  }

  function openSavePostprocessPresetDialog() {
    setPostprocessNameDraft(postprocessPreset || '');
    setPostprocessNameDialogOpen(true);
  }
  async function confirmSavePostprocessPreset() {
    const name = postprocessNameDraft.trim();
    if (!name) return;
    try {
      const saved = await api<{ name: string; params: PostProcessParams }>('/postprocess-settings', 'POST', { name, params });
      setPostprocessPresets(previous => ({ ...previous, [saved.name]: saved.params }));
      setPostprocessPreset(saved.name);
      setPostprocessNameDialogOpen(false);
      notify(`"${saved.name}" 프리셋으로 저장했습니다.`);
    } catch (error) { notify((error as Error).message, true); }
  }
  function applyPostprocessPreset(name: string) {
    setPostprocessPreset(name);
    const preset = postprocessPresets[name];
    if (!preset) return;
    setParams(preset);
    scheduleRender(preset);
    const matched = Object.entries({ ...PP_EQ_PRESETS, ...customPresets }).find(([, values]) => values.every((value, index) => value === preset.eq[index]));
    setEqPreset(matched ? matched[0] : PP_CUSTOM_PRESET);
  }
  async function deletePostprocessPreset(name: string) {
    try {
      await api(`/postprocess-settings?name=${encodeURIComponent(name)}`, 'DELETE');
      setPostprocessPresets(previous => { const next = { ...previous }; delete next[name]; return next; });
      setPostprocessPreset('');
    } catch (error) { notify((error as Error).message, true); }
  }

  function bufferFor(track: 'original' | 'processed') { return track === 'original' ? decodedRef.current : processedRef.current; }
  function currentPosition(): number {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlaying) return playOffsetRef.current;
    return playOffsetRef.current + (ctx.currentTime - playStartCtxTimeRef.current) * rateRef.current;
  }
  function pausePlayback() {
    if (isPlaying) playOffsetRef.current = currentPosition();
    currentSourceRef.current?.stop();
    currentSourceRef.current = null;
    setIsPlaying(false);
  }
  function playTrack(track: 'original' | 'processed', atPosition?: number) {
    const ctx = audioCtxRef.current;
    const buffer = bufferFor(track);
    if (!ctx || !buffer) return;
    const position = atPosition !== undefined ? atPosition : currentPosition();
    const clamped = Math.max(0, Math.min(position, Math.max(0, buffer.duration - 0.02)));
    currentSourceRef.current?.stop();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rateRef.current;
    source.connect(previewGainRef.current || ctx.destination);
    source.onended = () => { if (currentSourceRef.current === source) { currentSourceRef.current = null; setIsPlaying(false); playOffsetRef.current = 0; setPositionSeconds(0); } };
    source.start(0, clamped);
    currentSourceRef.current = source;
    playStartCtxTimeRef.current = ctx.currentTime;
    playOffsetRef.current = clamped;
    setPositionSeconds(clamped);
    setActiveTrack(track);
    setIsPlaying(true);
  }
  function handleTrackButtonClick(track: 'original' | 'processed') {
    if (activeTrack === track && isPlaying) { pausePlayback(); return; }
    playTrack(track);
  }
  function seekBy(deltaSeconds: number) {
    const track = activeTrack || 'original';
    const buffer = bufferFor(track);
    if (!buffer) return;
    const next = Math.max(0, Math.min(currentPosition() + deltaSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playTrack(track, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveTrack(track);
  }
  function cycleSpeed() {
    const next = playbackRate >= 2 ? 1 : 2;
    const pos = currentPosition();
    setPlaybackRate(next);
    if (isPlaying && activeTrack) { rateRef.current = next; playTrack(activeTrack, pos); return; }
    rateRef.current = next;
    playOffsetRef.current = pos;
    setPositionSeconds(pos);
  }
  function applyPreviewVolume(next: number) {
    setPreviewVolume(next);
    if (previewGainRef.current) previewGainRef.current.gain.value = next;
  }

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      setPositionSeconds(currentPosition());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  async function handleSave() {
    const buffer = processedRef.current;
    if (!buffer) return;
    setSaving(true);
    setErrorText('');
    try {
      const wavBlob = audioBufferToWavBlob(buffer);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(wavBlob);
      });
      const response = await fetch(`/api/projects/${project.id}/post-process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
      if (!response.ok) { const data = await response.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error || '후처리 저장에 실패했습니다.'); }
      const resultBlob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const suggestedName = match ? decodeURIComponent(match[1]) : `${project.title}-modified`;
      const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn }).showSaveFilePicker;
      if (typeof picker === 'function') {
        const handle = await picker({ suggestedName });
        const writable = await handle.createWritable();
        await writable.write(resultBlob);
        await writable.close();
        notify(`"${handle.name}" 파일로 저장했습니다.`);
      } else {
        const blobUrl = URL.createObjectURL(resultBlob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = suggestedName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
        notify(`"${suggestedName}" 파일을 다운로드했습니다.`);
      }
      onClose();
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      setErrorText((error as Error).message);
    } finally { setSaving(false); }
  }

  const activeBuffer = activeTrack ? bufferFor(activeTrack) : null;
  const playedFraction = activeBuffer ? Math.min(1, positionSeconds / activeBuffer.duration) : 0;

  return <>
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="studio-dialog postprocess-dialog">
      <DialogTitle>후처리 / EQ</DialogTitle>
      <div className="pp-description-row">
        <DialogDescription>"{project.title}"의 사본에 EQ와 효과를 적용한 뒤 원하는 위치에 저장하세요. 원본 파일은 바뀌지 않습니다.</DialogDescription>
        <div className="pp-settings-io">
          <select className="pp-preset-select" value={postprocessPreset} onChange={event => applyPostprocessPreset(event.target.value)} aria-label="전체 설정 프리셋">
            <option value="">전체 설정 불러오기</option>
            {Object.keys(postprocessPresets).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" className="pp-preset-btn" title="현재 전체 설정을 프리셋으로 저장" onClick={openSavePostprocessPresetDialog}><Save size={12}/></button>
          {postprocessPresets[postprocessPreset] && <button type="button" className="pp-preset-btn" title={`"${postprocessPreset}" 프리셋 삭제`} onClick={() => void deletePostprocessPreset(postprocessPreset)}><Trash2 size={12}/></button>}
        </div>
      </div>
      {loading ? <p className="field-hint">오디오를 불러오는 중...</p> : <>
        <div className="pp-layout">
          <div className="pp-eq-panel">
            <div className="pp-eq-header">
              <span className="pp-panel-title">10밴드 EQ (dB)</span>
              <div className="pp-preset-controls">
                <select className="pp-preset-select" value={eqPreset} onChange={event => applyEqPreset(event.target.value)} aria-label="EQ 프리셋">
                  {eqPreset === PP_CUSTOM_PRESET && <option value={PP_CUSTOM_PRESET}>{PP_CUSTOM_PRESET}</option>}
                  <optgroup label="기본 프리셋">{PP_EQ_PRESET_NAMES.map(name => <option key={name} value={name}>{name}</option>)}</optgroup>
                  {Object.keys(customPresets).length > 0 && <optgroup label="저장한 프리셋">{Object.keys(customPresets).map(name => <option key={name} value={name}>{name}</option>)}</optgroup>}
                </select>
                <button type="button" className="pp-preset-btn" title="현재 EQ 설정을 프리셋으로 저장" onClick={() => void saveCurrentAsPreset()}><Save size={12}/></button>
                {customPresets[eqPreset] && <button type="button" className="pp-preset-btn" title={`"${eqPreset}" 프리셋 삭제`} onClick={() => void deleteCustomPreset(eqPreset)}><Trash2 size={12}/></button>}
              </div>
            </div>
            <div className="pp-eq-bars">{PP_EQ_BANDS.map((_, index) => <EqBar key={PP_EQ_LABELS[index]} label={PP_EQ_LABELS[index]} value={params.eq[index]} onChange={value => updateEq(index, value)}/>)}</div>
            <div className="pp-eq-footer">
              <Knob label="전체 볼륨" value={params.masterVolume} min={0} max={150} onChange={value => updateParam('masterVolume', value)}/>
              {visualizerEnabled && <div className="pp-visualizer-wrap">
                <canvas ref={visualizerCanvasRef} className="pp-visualizer" width={220} height={180} aria-hidden="true"/>
                {!isPlaying && <span className="pp-visualizer-label">SOUND<br/>FX</span>}
              </div>}
              <div className="pp-eq-footer-right">
                <div className={params.eqEnabled ? 'pp-toggle-btn active' : 'pp-toggle-btn'}>
                  <button type="button" className="pp-toggle-reset" title="EQ 초기화" onClick={resetEq}><RotateCcw size={12}/></button>
                  <button type="button" className="pp-toggle-power" onClick={() => updateParam('eqEnabled', !params.eqEnabled)}><Power size={12}/>EQ</button>
                </div>
                <div className={params.fxEnabled ? 'pp-toggle-btn active' : 'pp-toggle-btn'}>
                  <button type="button" className="pp-toggle-reset" title="FX Sound 초기화" onClick={resetFx}><RotateCcw size={12}/></button>
                  <button type="button" className="pp-toggle-power" onClick={() => updateParam('fxEnabled', !params.fxEnabled)}><Power size={12}/>FX Sound</button>
                </div>
                <div className={params.reverbEchoEnabled ? 'pp-toggle-btn active' : 'pp-toggle-btn'}>
                  <button type="button" className="pp-toggle-reset" title="리버브/에코 초기화" onClick={resetReverbEcho}><RotateCcw size={12}/></button>
                  <button type="button" className="pp-toggle-power" onClick={() => updateParam('reverbEchoEnabled', !params.reverbEchoEnabled)}><Power size={12}/>리버브/에코</button>
                </div>
              </div>
            </div>
          </div>
          <div className="pp-fx-panel">
            <div className="pp-fx-header">
              <div className="pp-fx-legend">
                <span><i className="pp-legend-dot pp-legend-fx"/>FxSound</span>
                <span><i className="pp-legend-dot pp-legend-reverb"/>리버브/에코</span>
              </div>
            </div>
            <div className="pp-knob-grid">
              <Knob label="선명도" value={params.clarity} min={0} max={100} onChange={value => updateParam('clarity', value)} variant="fx"/>
              <Knob label="공간감" value={params.spaciousness} min={0} max={100} onChange={value => updateParam('spaciousness', value)} variant="fx"/>
              <Knob label="서라운드 사운드" value={params.surround} min={0} max={100} onChange={value => updateParam('surround', value)} variant="fx"/>
              <Knob label="다이내믹 부스트" value={params.dynamicBoost} min={0} max={100} onChange={value => updateParam('dynamicBoost', value)} variant="fx"/>
              <Knob label="베이스 부스트" value={params.bassBoost} min={0} max={100} onChange={value => updateParam('bassBoost', value)} variant="fx"/>
              <Knob label="리버브 양" value={params.reverbAmount} min={0} max={100} onChange={value => updateParam('reverbAmount', value)} variant="reverb"/>
              <Knob label="리버브 잔향 길이" value={params.reverbLength} min={0} max={100} onChange={value => updateParam('reverbLength', value)} variant="reverb"/>
              <Knob label="에코 양" value={params.echoAmount} min={0} max={100} onChange={value => updateParam('echoAmount', value)} variant="reverb"/>
              <Knob label="에코 지연 (ms)" value={params.echoDelayMs} min={40} max={600} onChange={value => updateParam('echoDelayMs', value)} variant="reverb"/>
            </div>
          </div>
        </div>
        <div className={`pp-waveform-row${activeTrack === 'original' && isPlaying ? ' pp-row-playing-original' : ''}`}>
          <button type="button" className="pp-waveform-label" title="원본" aria-label={activeTrack === 'original' && isPlaying ? '원본 일시정지' : '원본 선택 후 재생'} onClick={() => handleTrackButtonClick('original')}>{activeTrack === 'original' && isPlaying ? <Pause size={15}/> : <AudioLines size={15}/>}</button>
          <Waveform peaks={originalPeaks} playedFraction={activeTrack === 'original' ? playedFraction : undefined}/>
        </div>
        <div className={`pp-waveform-row${activeTrack === 'processed' && isPlaying ? ' pp-row-playing-processed' : ''}`}>
          <button type="button" className="pp-waveform-label" title="처리" aria-label={activeTrack === 'processed' && isPlaying ? '처리 결과 일시정지' : '처리 결과 선택 후 재생'} disabled={!processedPeaks.length || rendering} onClick={() => handleTrackButtonClick('processed')}>{rendering ? <LoaderCircle className="spin" size={13}/> : (activeTrack === 'processed' && isPlaying ? <Pause size={15}/> : <SlidersHorizontal size={15}/>)}</button>
          <Waveform peaks={processedPeaks} playedFraction={activeTrack === 'processed' ? playedFraction : undefined} variant="processed"/>
        </div>
        {errorText && <p className="field-hint warning">{errorText}</p>}
      </>}
      <div className="dialog-actions pp-dialog-actions">
        <div className="pp-transport">
          <Button variant="ghost" size="icon" aria-label="5초 뒤로" onClick={() => seekBy(-5)} disabled={loading}><Rewind size={15}/></Button>
          <Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={() => isPlaying ? pausePlayback() : playTrack(activeTrack || 'original')} disabled={loading}>{isPlaying ? <Pause size={15}/> : <Play size={15}/>}</Button>
          <Button variant="ghost" size="icon" aria-label="5초 앞으로" onClick={() => seekBy(5)} disabled={loading}><FastForward size={15}/></Button>
          <button type="button" className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed} disabled={loading}>{playbackRate}x</button>
          <Volume2 size={14}/>
          <input className="abc-player-volume" type="range" aria-label="미리듣기 볼륨" min={0} max={2} step={0.1} value={previewVolume} onChange={event => applyPreviewVolume(Number(event.target.value))} disabled={loading}/>
        </div>
        <div className="pp-dialog-actions-right">
          <Button variant="outline" onClick={() => { pausePlayback(); onClose(); }} disabled={saving}>취소</Button>
          <Button onClick={() => void handleSave()} disabled={loading || rendering || saving || !processedPeaks.length}>{saving ? <LoaderCircle className="spin"/> : <Save/>}저장</Button>
        </div>
      </div>
    </DialogContent>
    </Dialog>
    <Dialog open={postprocessNameDialogOpen} onOpenChange={setPostprocessNameDialogOpen}>
      <DialogContent className="studio-dialog">
        <DialogTitle>전체 설정 저장</DialogTitle>
        <DialogDescription>Setting/PostProcess 폴더에 저장할 프리셋 이름을 입력하세요.</DialogDescription>
        <Input value={postprocessNameDraft} onChange={event => setPostprocessNameDraft(event.target.value)} placeholder="프리셋 이름" maxLength={120} autoFocus onKeyDown={event => { if (event.key === 'Enter') void confirmSavePostprocessPreset(); }}/>
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setPostprocessNameDialogOpen(false)}>취소</Button>
          <Button onClick={() => void confirmSavePostprocessPreset()} disabled={!postprocessNameDraft.trim()}>저장</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

export default function Studio() {
  const [page, setPage] = useState<Page>('create');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [savedSettings, setSavedSettings] = useState<Settings>(initialSettings);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [sortOption, setSortOption] = useState<'date-desc' | 'date-asc' | 'title-asc' | 'title-desc'>('date-desc');
  const [randomizeSeed, setRandomizeSeed] = useState(loadRandomizeSeed);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [abcNotes, setAbcNotes] = useState<AbcNote[]>([]);
  const [abcEditTarget, setAbcEditTarget] = useState<AbcNote | null>(null);
  const [abcEditText, setAbcEditText] = useState('');
  const [currentAbcNoteId, setCurrentAbcNoteId] = useState<string | null>(null);
  const [draftAbcDialogOpen, setDraftAbcDialogOpen] = useState(false);
  const [draftAbcDraftText, setDraftAbcDraftText] = useState('');
  const [abcControlsSlot, setAbcControlsSlot] = useState<HTMLDivElement | null>(null);
  const [abcAiInstruction, setAbcAiInstruction] = useState('');
  const [abcSaveDialogOpen, setAbcSaveDialogOpen] = useState(false);
  const [abcSaveFolder, setAbcSaveFolder] = useState('');
  const [abcSaveFilename, setAbcSaveFilename] = useState('');
  const abcImportInputRef = useRef<HTMLInputElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [help, setHelp] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [examples, setExamples] = useState<Example[]>([]);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [selected, setSelected] = useState<Project | null>(null);
  const [notes, setNotes] = useState('');
  const [idea, setIdea] = useState('');
  const [suggestion, setSuggestion] = useState<{ task: 'lyrics' | 'style'; text: string } | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [postProcessTarget, setPostProcessTarget] = useState<Project | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<Project | null>(null);
  const [playlistPickerTarget, setPlaylistPickerTarget] = useState<Project | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [downloadFormats, setDownloadFormats] = useState<Set<SaveFormat>>(new Set());
  const [pythonWarningOpen, setPythonWarningOpen] = useState(false);
  const [gpuVramMb, setGpuVramMb] = useState<number | null>(null);
  const [queue, setQueue] = useState<Project[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [reversePlaying, setReversePlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const holdForwardTimer = useRef<number | null>(null);
  const reverseTimer = useRef<number | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverAudioInputRef = useRef<HTMLInputElement>(null);
  const coverTargetRef = useRef<{ type: 'project'; item: Project } | { type: 'abc-note'; item: AbcNote } | null>(null);
  const model = models.find(item => item.id === draft.modelId) || models[0];
  const update = (value: Partial<Draft>) => setDraft(previous => ({ ...previous, ...value }));
  const notify = (text: string, error = false) => setNotice({ text, error });
  const navigate = (target: Page) => { setPage(target); setMobileNav(false); setQuery(''); setTab('all'); setActivePlaylistId(null); };
  useEffect(() => {
    try { const cached = JSON.parse(localStorage.getItem('songyue2-composer') || 'null'); if (cached && typeof cached.lyrics === 'string') setDraft({ ...emptyDraft, ...cached }); } catch { /* Ignore invalid browser drafts. */ }
    setLoaded(true);
    api<Settings>('/settings').then(config => { setSettings(config); setSavedSettings(config); setOnline(true); }).catch(() => setOnline(false));
    api<Project[]>('/projects').then(setProjects).catch(() => {});
    api<Example[]>('/examples').then(setExamples).catch(() => {});
    api<Playlist[]>('/playlists').then(setPlaylists).catch(() => {});
    api<SystemInfo>('/system').then(info => setGpuVramMb(info.vramMb)).catch(() => {});
    api<AbcNote[]>('/abc-notes').then(setAbcNotes).catch(() => {});
    const poll = () => { void api<Inventory>('/models').then(setInventory).catch(() => {}); };
    poll(); const timer = setInterval(poll, 4000); return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (loaded) { try { localStorage.setItem('songyue2-composer', JSON.stringify(draft)); } catch { /* Explicit disk save remains available. */ } } }, [draft, loaded]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), notice.error ? 14000 : 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => { document.documentElement.style.setProperty('--visible-height', `${viewport?.height || window.innerHeight}px`); document.documentElement.style.setProperty('--visible-top', `${viewport?.offsetTop || 0}px`); };
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); };
  }, []);
  useEffect(() => {
    type ToolContext = { registerTool(tool: { name: string; title: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }): void | Promise<void> };
    const context = (document as Document & { modelContext?: ToolContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({ name: 'read_music_model_inventory', title: '음악 모델 상태 확인', description: '다운로드한 음악 모델 목록과 파일 준비 상태를 읽습니다. 모델을 실행하거나 설정을 바꾸지 않습니다.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async input => {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('입력은 빈 객체여야 합니다.');
        const status = await api<Inventory>('/models');
        return { state: status.state, completedBytes: status.completedBytes, totalBytes: status.totalBytes, repositories: status.repositories.map(repo => ({ id: repo.id, state: repo.state })) };
      } }, { signal: lifecycle.signal })).catch(() => {});
    } catch { /* Unsupported preview implementations do not block the studio. */ }
    return () => lifecycle.abort();
  }, []);
  async function saveDraft(generate = false) {
    if (!draft.lyrics.trim() || !draft.style.trim()) { notify('가사와 음악 스타일을 입력해 주세요. 예시를 불러와 시작해도 좋아요.', true); return; }
    if (!Number.isInteger(draft.seed) || draft.seed < 0 || draft.seed > 2147483647 || !Number.isInteger(draft.steps) || draft.steps < 1 || draft.steps > 100) { notify('시드는 0~2147483647, 추론 단계는 1~100 사이의 정수를 입력해 주세요.', true); return; }
    const usedSeed = generate && randomizeSeed ? Math.floor(Math.random() * 2147483648) : draft.seed;
    if (usedSeed !== draft.seed) update({ seed: usedSeed });
    setBusy(generate ? 'generate' : 'save');
    try {
      const item = await api<Project>('/projects', 'POST', { ...draft, seed: usedSeed, title: draft.title.trim() || '제목 없는 노래' }); setProjects(previous => [item, ...previous]);
      if (generate) {
        let poll: number | null = null;
        setGenerateProgress(0);
        try {
          poll = window.setInterval(() => {
            api<{ active: boolean; elapsedMs: number; expectedMs: number }>('/generate/status').then(status => {
              if (status.active && status.expectedMs > 0) setGenerateProgress(Math.min(96, Math.round(status.elapsedMs / status.expectedMs * 100)));
            }).catch(() => {});
          }, 1000);
          const completed = await api<Project>('/generate', 'POST', { projectId: item.id });
          setGenerateProgress(100);
          setProjects(previous => [completed, ...previous]);
          notify('노래가 완성되었습니다. 라이브러리에서 들어보세요.');
        } catch (error) { throw new Error(`초안은 저장했습니다. ${(error as Error).message}`); }
        finally { if (poll !== null) window.clearInterval(poll); setGenerateProgress(0); }
      } else notify('초안을 내 PC에 저장했습니다. 라이브러리에서 다시 열 수 있어요.');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function storeSettings(test = false) {
    setBusy(test ? 'test' : 'settings');
    try { const result = await api<Settings>('/settings', 'PUT', { provider: settings.provider, enginePath: settings.enginePath, pythonEnginePath: settings.pythonEnginePath, pythonScriptPath: settings.pythonScriptPath, pythonMemoryBudgetGib: settings.pythonMemoryBudgetGib, sheetSagePythonPath: settings.sheetSagePythonPath, settingPath: settings.settingPath, musicPath: settings.musicPath, examplesPath: settings.examplesPath, coversPath: settings.coversPath, abcNotesPath: settings.abcNotesPath, stylePresets: settings.stylePresets, visualizerEnabled: settings.visualizerEnabled, visualizerRingCount: settings.visualizerRingCount, visualizerHue: settings.visualizerHue, visualizerLineWidth: settings.visualizerLineWidth, saveFormat: settings.saveFormat }); setSettings(result); setSavedSettings(result); if (test) { await api('/llm/test', 'POST'); notify('연결을 확인했습니다. 작사 도우미를 사용할 수 있어요.'); } else notify('설정을 저장했습니다.'); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function selectProvider(id: Settings['provider']) {
    try { const result = await api<Settings>('/settings', 'PUT', { provider: id }); setSettings(result); setSavedSettings(result); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function setViewMode(mode: Settings['viewMode']) {
    setSettings(previous => ({ ...previous, viewMode: mode }));
    try { const result = await api<Settings>('/settings', 'PUT', { viewMode: mode }); setSettings(result); setSavedSettings(result); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function assist(task: 'lyrics' | 'style') {
    if (savedSettings.provider === 'none') { navigate('settings'); notify('작사 도우미로 사용할 LLM을 선택해 주세요. 직접 작성할 때는 필요하지 않아요.'); return; }
    if (!idea.trim() && !draft.style.trim() && !draft.lyrics.trim()) { notify('노래의 주제나 스타일을 먼저 적어 주세요.', true); return; }
    setBusy(task);
    try { const result = await api<{ text: string }>('/llm/assist', 'POST', { task, prompt: idea, lyrics: draft.lyrics, style: draft.style }); setSuggestion({ task, text: result.text }); setEditingSuggestion(false); } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function favorite(item: Project) { try { const result = await api<Project>(`/projects/${item.id}`, 'PATCH', { favorite: !item.favorite }); setProjects(previous => previous.map(project => project.id === item.id ? result : project)); } catch (error) { notify((error as Error).message, true); } }
  async function deleteProject(item: Project) {
    setBusy('delete');
    try {
      await api(`/projects/${item.id}`, 'DELETE');
      setProjects(previous => previous.filter(project => project.id !== item.id));
      if (selected?.id === item.id) setSelected(null);
      notify(`${item.title}을(를) 삭제했습니다.`);
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); setDeleteTarget(null); }
  }
  function loadProject(item: Project) { setDraft({ title: item.title, lyrics: item.lyrics, style: item.style, modelId: item.modelId, seed: item.seed, steps: item.steps, cot: item.cot, vocalGender: item.vocalGender || '', instrumental: item.instrumental || false, abc: item.abc || '', mode: item.mode }); setSelected(null); navigate('create'); notify('설정을 불러왔습니다. 다시 저장하면 새 버전으로 남습니다.'); }
  function requestGenerate() {
    const vramSufficient = gpuVramMb !== null && gpuVramMb >= PYTHON_MODEL_MIN_VRAM_MB;
    if (draft.modelId === 'yue2-original' && !vramSufficient) { setPythonWarningOpen(true); return; }
    void saveDraft(true);
  }
  function toggleRandomizeSeed(next: boolean) {
    setRandomizeSeed(next);
    try { localStorage.setItem(RANDOMIZE_SEED_KEY, next ? '1' : '0'); } catch { /* per-device convenience only */ }
  }
  function toggleVocal(part: 'male' | 'female') {
    const hasMale = draft.vocalGender === 'male' || draft.vocalGender === 'duet';
    const hasFemale = draft.vocalGender === 'female' || draft.vocalGender === 'duet';
    const nextMale = part === 'male' ? !hasMale : hasMale;
    const nextFemale = part === 'female' ? !hasFemale : hasFemale;
    const next = nextMale && nextFemale ? 'duet' : nextMale ? 'male' : nextFemale ? 'female' : '';
    update({ vocalGender: next });
  }
  // --- ABC score (symbolic plan) ---
  async function runPlan() {
    if (!draft.lyrics.trim() || !draft.style.trim()) { notify('가사와 음악 스타일을 입력해 주세요.', true); return; }
    if (draft.cot === 'off') { notify('심볼릭 작곡은 "멜로디 계획" 또는 "멜로디와 코드 계획"에서만 가능합니다.', true); return; }
    setBusy('plan');
    setGenerateProgress(0);
    let poll: number | null = null;
    try {
      poll = window.setInterval(() => {
        api<{ active: boolean; elapsedMs: number; expectedMs: number }>('/generate/status').then(status => {
          if (status.active && status.expectedMs > 0) setGenerateProgress(Math.min(96, Math.round(status.elapsedMs / status.expectedMs * 100)));
        }).catch(() => {});
      }, 500);
      const result = await api<{ abc: string }>('/plan', 'POST', { title: draft.title, lyrics: draft.lyrics, style: draft.style, cot: draft.cot, seed: draft.seed, vocalGender: draft.vocalGender, instrumental: draft.instrumental });
      update({ abc: result.abc });
      setCurrentAbcNoteId(null);
      notify('심볼릭 작곡을 만들었습니다. 아래 악보를 확인하고 필요하면 수정해 보세요.');
    } catch (error) { notify((error as Error).message, true); }
    finally { if (poll !== null) window.clearInterval(poll); setGenerateProgress(0); setBusy(''); }
  }
  async function handleCoverAudioFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('cover-transcribe');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await api<{ abc: string }>('/cover-transcribe', 'POST', { dataUrl, task: 'melody-full' });
      update({ abc: result.abc });
      setCurrentAbcNoteId(null);
      notify('오디오에서 멜로디를 추출했습니다. 아래 악보를 확인하고 필요하면 수정해 보세요.');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function checkAbc() {
    if (!draft.abc.trim()) { notify('검사할 악보가 없습니다.', true); return; }
    setBusy('abc-check');
    try {
      const result = await api<{ valid: boolean; error?: string }>('/abc-check', 'POST', { abc: draft.abc });
      if (result.valid) notify('악보가 유효합니다.'); else notify(`악보 오류: ${result.error}`, true);
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  function openAbcSaveDialog() {
    if (!draft.abc.trim()) { notify('저장할 악보가 없습니다.', true); return; }
    setAbcSaveFolder(settings.abcNotesPath || DEFAULT_ABC_NOTES_PATH);
    setAbcSaveFilename(draft.title.trim() || '악보');
    setAbcSaveDialogOpen(true);
  }
  async function confirmAbcSave() {
    setBusy('abc-save-file');
    try {
      const result = await api<{ ok: boolean; filename: string }>('/abc-file', 'POST', { abc: draft.abc, folder: abcSaveFolder, filename: abcSaveFilename, title: draft.title });
      setAbcSaveDialogOpen(false);
      notify(`"${result.filename}" 파일로 저장했습니다.`);
      try { setAbcNotes(await api<AbcNote[]>('/abc-notes')); } catch { /* best-effort list refresh */ }
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function saveAbcViaPicker() {
    if (!draft.abc.trim()) { notify('저장할 악보가 없습니다.', true); return; }
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn }).showSaveFilePicker;
    if (typeof picker !== 'function') { openAbcSaveDialog(); return; }
    try {
      const handle = await picker({ suggestedName: `${draft.title.trim() || '악보'}.abc`, types: [{ description: 'ABC 악보', accept: { 'text/plain': ['.abc'] } }] });
      const writable = await handle.createWritable();
      await writable.write(draft.abc.endsWith('\n') ? draft.abc : `${draft.abc}\n`);
      await writable.close();
      notify(`"${handle.name}" 파일로 저장했습니다.`);
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      notify('탐색기로 저장하지 못했습니다. 다른 방법으로 저장해 주세요.', true);
      openAbcSaveDialog();
    }
  }
  async function handleAbcImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      let abc = content;
      try {
        const parsed = JSON.parse(content) as { abc?: unknown };
        if (typeof parsed.abc === 'string') abc = parsed.abc;
      } catch { /* not JSON: use the file content as raw ABC text */ }
      if (!abc.trim()) { notify('파일에서 악보 내용을 찾을 수 없습니다.', true); return; }
      update({ abc });
      setCurrentAbcNoteId(null);
      notify(`"${file.name}" 파일을 불러왔습니다.`);
    } catch { notify('파일을 읽을 수 없습니다.', true); }
  }
  function loadAbcNote(note: AbcNote) { update({ abc: note.abc }); setCurrentAbcNoteId(note.id); setAbcEditTarget(null); navigate('create'); notify(`"${note.title}" 악보를 불러왔습니다.`); }
  async function deleteAbcNote(note: AbcNote) {
    try { await api(`/abc-notes/${note.id}`, 'DELETE'); setAbcNotes(previous => previous.filter(item => item.id !== note.id)); if (abcEditTarget?.id === note.id) setAbcEditTarget(null); if (currentAbcNoteId === note.id) setCurrentAbcNoteId(null); notify(`"${note.title}" 악보를 삭제했습니다.`); }
    catch (error) { notify((error as Error).message, true); }
  }
  function clearAbc() { update({ abc: '' }); setCurrentAbcNoteId(null); }
  function openDraftAbcEdit() { setDraftAbcDraftText(draft.abc); setAbcAiInstruction(''); setDraftAbcDialogOpen(true); }
  function cancelDraftAbcEdit() { setDraftAbcDialogOpen(false); }
  function saveDraftAbcEdit() {
    if (!draftAbcDraftText.trim()) { notify('악보 내용을 비울 수 없습니다.', true); return; }
    update({ abc: draftAbcDraftText });
    setDraftAbcDialogOpen(false);
  }
  async function checkDraftAbcEditText() {
    if (!draftAbcDraftText.trim()) { notify('검사할 악보가 없습니다.', true); return; }
    setBusy('abc-check');
    try {
      const result = await api<{ valid: boolean; error?: string }>('/abc-check', 'POST', { abc: draftAbcDraftText });
      if (result.valid) notify('악보가 유효합니다.'); else notify(`악보 오류: ${result.error}`, true);
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  function openAbcNote(note: AbcNote) { setAbcEditTarget(note); setAbcEditText(note.abc); setAbcAiInstruction(''); }
  function cancelAbcEdit() { setAbcEditTarget(null); }
  async function saveAbcEdit() {
    if (!abcEditTarget) return;
    if (!abcEditText.trim()) { notify('악보 내용을 비울 수 없습니다.', true); return; }
    setBusy('abc-save');
    try {
      const result = await api<AbcNote>(`/abc-notes/${abcEditTarget.id}`, 'PATCH', { abc: abcEditText });
      setAbcNotes(previous => previous.map(item => item.id === result.id ? result : item));
      setAbcEditTarget(null);
      notify('악보를 저장했습니다.');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function checkAbcEditText() {
    if (!abcEditText.trim()) { notify('검사할 악보가 없습니다.', true); return; }
    setBusy('abc-check');
    try {
      const result = await api<{ valid: boolean; error?: string }>('/abc-check', 'POST', { abc: abcEditText });
      if (result.valid) notify('악보가 유효합니다.'); else notify(`악보 오류: ${result.error}`, true);
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function applyAbcAiEdit(currentAbc: string, apply: (next: string) => void) {
    if (!abcAiInstruction.trim()) { notify('AI에게 전달할 지시사항을 입력해 주세요.', true); return; }
    if (!currentAbc.trim()) { notify('수정할 악보가 없습니다.', true); return; }
    setBusy('abc-ai');
    try {
      const result = await api<{ abc: string }>('/llm/abc-edit', 'POST', { abc: currentAbc, instruction: abcAiInstruction });
      apply(result.abc);
      notify('AI가 악보를 수정했습니다. 결과를 확인하고 필요하면 되돌리세요.');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  // --- playback queue ---
  function playQueue(songs: Project[], startIndex = 0) {
    const playable = songs.filter(song => song.status === 'completed');
    if (!playable.length) return;
    const clampedIndex = Math.max(0, Math.min(startIndex, playable.length - 1));
    setQueue(playable); setQueueIndex(clampedIndex); setIsPlaying(true);
  }
  useEffect(() => {
    const audio = audioRef.current;
    const song = queue[queueIndex];
    if (!audio || !song) return;
    stopHoldForward();
    stopReverse();
    audio.src = `/api/projects/${song.id}/audio`;
    audio.playbackRate = playbackRate;
    audio.volume = volume;
    if (isPlaying) void audio.play().catch(() => setIsPlaying(false));
  }, [queue, queueIndex]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !queue[queueIndex]) return;
    if (isPlaying) void audio.play().catch(() => setIsPlaying(false)); else audio.pause();
  }, [isPlaying]);
  useEffect(() => () => { stopHoldForward(); stopReverse(); }, []);
  function togglePlay() { if (!queue[queueIndex]) return; setIsPlaying(previous => !previous); }
  function playNext() { if (queueIndex + 1 < queue.length) setQueueIndex(previous => previous + 1); else setIsPlaying(false); }
  function playPrev() { if (queueIndex > 0) setQueueIndex(previous => previous - 1); }
  const nowPlaying = queue[queueIndex] || null;
  function coverUrl(item: Project) { return `/api/projects/${item.id}/cover?v=${encodeURIComponent(item.updatedAt || item.createdAt)}`; }
  function abcNoteCoverUrl(note: AbcNote) { return `/api/abc-notes/${note.id}/cover?v=${encodeURIComponent(note.updatedAt || note.createdAt)}`; }
  function formatTime(seconds: number) { if (!Number.isFinite(seconds) || seconds < 0) return '0:00'; const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${mins}:${String(secs).padStart(2, '0')}`; }
  function stopHoldForward() { if (holdForwardTimer.current !== null) { window.clearInterval(holdForwardTimer.current); holdForwardTimer.current = null; } }
  function stopReverse() { if (reverseTimer.current !== null) { window.clearInterval(reverseTimer.current); reverseTimer.current = null; } setReversePlaying(false); }
  function seekTo(time: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const clamped = Math.max(0, Math.min(time, playbackDuration || time));
    audio.currentTime = clamped;
    setPlaybackTime(clamped);
  }
  function seekBy(delta: number) { const audio = audioRef.current; if (audio) seekTo(audio.currentTime + delta); }
  function cycleSpeed() { const next = playbackRate >= 2 ? 1 : 2; setPlaybackRate(next); const audio = audioRef.current; if (audio) audio.playbackRate = next; }
  function changeVolume(next: number) { setVolume(next); const audio = audioRef.current; if (audio) audio.volume = next; }
  function startHoldForward() { seekBy(2); stopHoldForward(); holdForwardTimer.current = window.setInterval(() => seekBy(2), 200); }
  function toggleReverse() {
    const audio = audioRef.current;
    if (!audio) return;
    if (reversePlaying) { stopReverse(); if (isPlaying) void audio.play().catch(() => setIsPlaying(false)); return; }
    audio.pause();
    setReversePlaying(true);
    reverseTimer.current = window.setInterval(() => {
      if (audio.currentTime <= 0) { stopReverse(); return; }
      seekBy(-0.15);
    }, 100);
  }
  // --- download ---
  function openDownload(item: Project) { setDownloadTarget(item); setDownloadFormats(new Set([settings.saveFormat])); }
  function toggleDownloadFormat(format: SaveFormat) { setDownloadFormats(previous => { const next = new Set(previous); if (next.has(format)) next.delete(format); else next.add(format); return next; }); }
  function confirmDownload() {
    if (!downloadTarget) return;
    const formats = [...downloadFormats];
    formats.forEach((format, index) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = `/api/projects/${downloadTarget.id}/audio?format=${format}&download=1`;
        link.click();
      }, index * 400);
    });
    setDownloadTarget(null);
  }
  // --- cover art ---
  function openCoverPicker(item: Project) { coverTargetRef.current = { type: 'project', item }; coverInputRef.current?.click(); }
  function openAbcNoteCoverPicker(item: AbcNote) { coverTargetRef.current = { type: 'abc-note', item }; coverInputRef.current?.click(); }
  async function handleCoverFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const target = coverTargetRef.current;
    event.target.value = '';
    if (!file || !target) return;
    if (file.size > 20 * 1024 * 1024) { notify('이미지가 너무 큽니다. 20MB 이하로 줄여 주세요.', true); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file); });
    try {
      if (target.type === 'project') {
        const result = await api<Project>(`/projects/${target.item.id}/cover`, 'POST', { dataUrl });
        setProjects(previous => previous.map(project => project.id === target.item.id ? result : project));
      } else {
        const result = await api<AbcNote>(`/abc-notes/${target.item.id}/cover`, 'POST', { dataUrl });
        setAbcNotes(previous => previous.map(note => note.id === target.item.id ? result : note));
      }
      notify('커버 이미지를 등록했습니다.');
    } catch (error) { notify((error as Error).message, true); }
  }
  async function deleteCover(item: Project) {
    try { await api(`/projects/${item.id}/cover`, 'DELETE'); setProjects(previous => previous.map(project => project.id === item.id ? { ...project, coverPath: null } : project)); notify('커버 이미지를 삭제했습니다.'); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function deleteAbcNoteCover(item: AbcNote) {
    try { await api(`/abc-notes/${item.id}/cover`, 'DELETE'); setAbcNotes(previous => previous.map(note => note.id === item.id ? { ...note, coverPath: null } : note)); notify('커버 이미지를 삭제했습니다.'); }
    catch (error) { notify((error as Error).message, true); }
  }
  // --- playlists ---
  async function addToPlaylist(item: Project, playlist: Playlist) {
    if (playlist.songIds.includes(item.id)) { notify(`이미 "${playlist.name}"에 있어요.`); return; }
    try { const result = await api<Playlist>(`/playlists/${playlist.id}`, 'PATCH', { songIds: [...playlist.songIds, item.id] }); setPlaylists(previous => previous.map(list => list.id === result.id ? result : list)); notify(`"${playlist.name}"에 추가했습니다.`); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function createPlaylistWith(name: string, item?: Project) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await api<Playlist>('/playlists', 'POST', { name: trimmed });
      if (item) { const withSong = await api<Playlist>(`/playlists/${created.id}`, 'PATCH', { songIds: [item.id] }); setPlaylists(previous => [...previous, withSong]); }
      else setPlaylists(previous => [...previous, created]);
      setNewPlaylistName('');
      notify('재생목록을 만들었습니다.');
    } catch (error) { notify((error as Error).message, true); }
  }
  async function removeFromPlaylist(playlist: Playlist, songId: string) {
    try { const result = await api<Playlist>(`/playlists/${playlist.id}`, 'PATCH', { songIds: playlist.songIds.filter(id => id !== songId) }); setPlaylists(previous => previous.map(list => list.id === result.id ? result : list)); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function deletePlaylist(playlist: Playlist) {
    try { await api(`/playlists/${playlist.id}`, 'DELETE'); setPlaylists(previous => previous.filter(list => list.id !== playlist.id)); if (activePlaylistId === playlist.id) setActivePlaylistId(null); notify('재생목록을 삭제했습니다.'); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function renamePlaylist(playlist: Playlist) {
    const next = window.prompt('새 재생목록 이름을 입력하세요', playlist.name)?.trim();
    if (!next || next === playlist.name) return;
    try { const result = await api<Playlist>(`/playlists/${playlist.id}`, 'PATCH', { name: next }); setPlaylists(previous => previous.map(list => list.id === result.id ? result : list)); notify('재생목록 이름을 바꿨습니다.'); }
    catch (error) { notify((error as Error).message, true); }
  }
  function useExample(example: Example) { update({ title: example.title, style: example.style, lyrics: example.lyrics, mode: 'custom' }); setPresetOpen(false); navigate('create'); notify('예시 가사와 스타일을 불러왔습니다. 자유롭게 바꿔 보세요.'); }
  async function addAsExample(item: Project) {
    try { const result = await api<Example>('/examples', 'POST', { title: item.title, style: item.style, lyrics: item.lyrics }); setExamples(previous => [...previous, result]); notify(`${item.title}을(를) 예시로 추가했습니다.`); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function renameProject(item: Project) {
    const next = window.prompt('새 이름을 입력하세요', item.title)?.trim();
    if (!next || next === item.title) return;
    try { const result = await api<Project>(`/projects/${item.id}`, 'PATCH', { title: next }); setProjects(previous => previous.map(project => project.id === item.id ? result : project)); notify('이름을 바꿨습니다.'); }
    catch (error) { notify((error as Error).message, true); }
  }
  const stylePresets = settings.stylePresets.split('\n').map(line => line.trim()).filter(Boolean);
  const visibleProjects = projects.filter(item => (page !== 'library' || item.status === 'completed') && (page !== 'projects' || item.status === 'draft') && (page !== 'favorites' || item.favorite) && (tab !== 'favorites' || item.favorite) && (tab !== 'audio' || item.status === 'completed') && (tab !== 'projects' || item.status === 'draft') && `${item.title} ${item.style}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => {
    if (sortOption === 'title-asc') return a.title.localeCompare(b.title, 'ko');
    if (sortOption === 'title-desc') return b.title.localeCompare(a.title, 'ko');
    if (sortOption === 'date-asc') return a.createdAt.localeCompare(b.createdAt);
    return b.createdAt.localeCompare(a.createdAt);
  });
  const exampleWindow = examples.length > 3 ? [0, 1, 2].map(offset => examples[(exampleIndex + offset) % examples.length]) : examples;
  const activePlaylist = playlists.find(list => list.id === activePlaylistId) || null;
  const playlistSongs = activePlaylist ? activePlaylist.songIds.map(id => projects.find(project => project.id === id)).filter((item): item is Project => !!item) : [];
  const installed = (item: typeof models[number]) => inventory?.repositories?.some(repo => (item.id !== 'yue2-original' || repo.id === 'm-a-p/YuE2-3B') && repo.files?.some(file => file.path.endsWith(item.file) && file.state === 'complete'));
  function projectList() { return <>
    <div className="collection-toolbar"><div className="collection-tabs" aria-label="작업 필터">{([['all', '전체'], ['projects', '프로젝트'], ['audio', '완성된 곡'], ['favorites', '좋아요']] as const).map(([value, label]) => <button key={value} aria-pressed={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}{value === 'all' && <span>{projects.length}</span>}</button>)}</div><div className="collection-actions"><div className="search-field"><Search size={15}/><input aria-label="곡 검색" placeholder="곡 검색" value={query} onChange={event => setQuery(event.target.value)}/></div><select className="sort-select" aria-label="정렬 방식" value={sortOption} onChange={event => setSortOption(event.target.value as typeof sortOption)}><option value="date-desc">최신순</option><option value="date-asc">오래된순</option><option value="title-asc">이름 A-Z</option><option value="title-desc">이름 Z-A</option></select><Button variant="ghost" size="icon" aria-label={settings.viewMode === 'card' ? '목록 보기' : '카드 보기'} onClick={() => void setViewMode(settings.viewMode === 'card' ? 'list' : 'card')}>{settings.viewMode === 'card' ? <ListMusic/> : <LayoutGrid/>}</Button></div></div>
    {visibleProjects.length ? <div className={`project-list ${settings.viewMode === 'card' ? 'card-view' : ''}`}>{visibleProjects.map(item => <article className={`song-card ${item.status === 'completed' ? 'status-done' : 'status-draft'}`} key={item.id}><button className={`song-symbol ${item.status === 'completed' ? 'status-done' : 'status-draft'}`} aria-label={item.status === 'completed' ? `${item.title} 재생` : `${item.title} 설정 불러오기`} onClick={() => item.status === 'completed' ? playQueue(visibleProjects, visibleProjects.indexOf(item)) : loadProject(item)}>{item.coverPath ? <img className="song-cover" src={coverUrl(item)} alt=""/> : item.status === 'completed' ? <AudioLines size={24}/> : <FileText size={24}/>}</button><button className="song-info" onClick={() => item.status === 'completed' ? (setSelected(item), setNotes(item.notes || '')) : loadProject(item)}><strong>{item.title}</strong><p>{item.style}</p><div><span className="small-badge">{item.status === 'completed' ? '완성' : '초안'}</span><span>{models.find(m => m.id === item.modelId)?.name || item.modelId}</span><span>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span></div></button><Button variant="ghost" size="icon" aria-label={item.favorite ? `${item.title} 좋아요 취소` : `${item.title} 좋아요`} onClick={() => void favorite(item)} className={item.favorite ? 'hearted' : ''}><Heart fill={item.favorite ? 'currentColor' : 'none'}/></Button><Button variant="ghost" size="icon" aria-label={`${item.title} 설정 불러오기`} onClick={() => loadProject(item)}><ArrowRight/></Button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${item.title} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end">{item.status === 'completed' ? <><button className="song-menu-item" onClick={() => loadProject(item)}><RefreshCw size={15}/>리믹스(설정 재사용)</button><button className="song-menu-item" onClick={() => renameProject(item)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item" onClick={() => openDownload(item)}><Download size={15}/>다운로드</button><button className="song-menu-item" onClick={() => setPostProcessTarget(item)}><SlidersHorizontal size={15}/>후처리 / EQ</button><button className="song-menu-item" onClick={() => setPlaylistPickerTarget(item)}><ListPlus size={15}/>재생목록에 추가</button><button className="song-menu-item" onClick={() => openCoverPicker(item)}><ImageIcon size={15}/>커버 {item.coverPath ? '변경' : '등록'}</button>{item.coverPath && <button className="song-menu-item" onClick={() => void deleteCover(item)}><X size={15}/>커버 삭제</button>}<button className="song-menu-item" onClick={() => { setSelected(item); setNotes(item.notes || ''); }}><CircleHelp size={15}/>상세 정보</button></> : <><button className="song-menu-item" onClick={() => renameProject(item)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item" onClick={() => void addAsExample(item)}><Sparkles size={15}/>예시로 추가하기</button><button className="song-menu-item" onClick={() => openCoverPicker(item)}><ImageIcon size={15}/>커버 {item.coverPath ? '변경' : '등록'}</button></>}<button className="song-menu-item danger" onClick={() => setDeleteTarget(item)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover>{item.status === 'completed' && item.durationMs ? <span className="song-duration">{formatTime(item.durationMs / 1000)}</span> : null}</article>)}</div> : <div className="empty-library"><div className="empty-icon"><AudioLines size={42} strokeWidth={1.25}/></div><h2>{query ? '검색 결과가 없어요' : tab === 'audio' ? '완성된 노래가 아직 없어요' : page === 'favorites' || tab === 'favorites' ? '마음에 드는 곡을 모아 보세요' : '첫 번째 노래를 기다리고 있어요'}</h2><p>{query ? '다른 제목이나 스타일로 검색해 보세요.' : tab === 'audio' ? '노래 만들기로 곡을 생성하면 이곳에서 결과를 들을 수 있어요.' : page === 'favorites' || tab === 'favorites' ? '저장한 곡의 하트를 누르면 이곳에 나타나요.' : <>가사 한 줄, 떠오르는 분위기에서 시작해 보세요.<br/>저장한 초안과 완성된 곡이 이곳에 모입니다.</>}</p>{!query && tab === 'all' && page !== 'favorites' && <Button variant="outline" className="soft-button" onClick={() => setPresetOpen(true)}><Sparkles/>예시로 시작하기<ArrowRight/></Button>}</div>}
  </>; }
  function playlistPage() {
    if (activePlaylist) return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><button className="playlist-back" onClick={() => setActivePlaylistId(null)}><ChevronLeft size={15}/>재생목록</button><h1>{activePlaylist.name}</h1><p>{playlistSongs.length}곡</p></div><div className="playlist-detail-actions"><Button variant="ghost" size="icon" aria-label={settings.viewMode === 'card' ? '목록 보기' : '카드 보기'} onClick={() => void setViewMode(settings.viewMode === 'card' ? 'list' : 'card')}>{settings.viewMode === 'card' ? <ListMusic/> : <LayoutGrid/>}</Button><Button onClick={() => playQueue(playlistSongs, 0)} disabled={!playlistSongs.some(item => item.status === 'completed')}><Play/>전체 재생</Button></div></div>{playlistSongs.length ? <div className={`project-list ${settings.viewMode === 'card' ? 'card-view' : ''}`}>{playlistSongs.map(item => <article className={`song-card ${item.status === 'completed' ? 'status-done' : 'status-draft'}`} key={item.id}><button className={`song-symbol ${item.status === 'completed' ? 'status-done' : 'status-draft'}`} aria-label={`${item.title} 재생`} onClick={() => playQueue(playlistSongs, playlistSongs.indexOf(item))}>{item.coverPath ? <img className="song-cover" src={coverUrl(item)} alt=""/> : item.status === 'completed' ? <AudioLines size={24}/> : <FileText size={24}/>}</button><button className="song-info" onClick={() => { setSelected(item); setNotes(item.notes || ''); }}><strong>{item.title}</strong><p>{item.style}</p></button><Button variant="ghost" size="icon" aria-label={`${item.title} 재생목록에서 제거`} onClick={() => void removeFromPlaylist(activePlaylist, item.id)}><X/></Button></article>)}</div> : <div className="empty-library"><div className="empty-icon"><ListPlus size={42} strokeWidth={1.25}/></div><h2>아직 곡이 없어요</h2><p>노래의 &quot;...&quot; 메뉴에서 이 재생목록에 곡을 추가해 보세요.</p></div>}</section>;
    return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">연속 재생을 위한 모음</span><h1>재생목록</h1><p>라이브러리의 곡을 모아 이 PC에서 이어 들으세요.</p></div><Button onClick={() => void createPlaylistWith(`새 재생목록 ${playlists.length + 1}`)}><Plus/>새 재생목록</Button></div>{playlists.length ? <div className="playlist-grid">{playlists.map(list => <article className="playlist-card" key={list.id}><button onClick={() => setActivePlaylistId(list.id)}><ListPlus size={22}/><strong>{list.name}</strong><small>{list.songIds.length}곡</small></button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${list.name} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end"><button className="song-menu-item" onClick={() => void renamePlaylist(list)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item danger" onClick={() => void deletePlaylist(list)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover></article>)}</div> : <div className="empty-library"><div className="empty-icon"><ListPlus size={42} strokeWidth={1.25}/></div><h2>첫 재생목록을 만들어 보세요</h2><p>완성된 곡들을 모아 두면 이 PC에서 순서대로 이어 들을 수 있어요.</p></div>}</section>;
  }
  function abcNotePage() {
    return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">심볼릭 작곡 보관함</span><h1>ABC 악보</h1><p>열기로 검사·수정하고, 더블 클릭하면 지금 곡에 바로 불러옵니다.</p></div><div className="playlist-detail-actions"><Button variant="ghost" size="icon" aria-label={settings.viewMode === 'card' ? '목록 보기' : '카드 보기'} onClick={() => void setViewMode(settings.viewMode === 'card' ? 'list' : 'card')}>{settings.viewMode === 'card' ? <ListMusic/> : <LayoutGrid/>}</Button><Button onClick={() => navigate('create')}><Plus/>만들기로 이동</Button></div></div>{abcNotes.length ? <div className={`project-list ${settings.viewMode === 'card' ? 'card-view' : ''}`}>{abcNotes.map(note => <article className="song-card status-abc" key={note.id}><button className="song-symbol status-abc" aria-label={`${note.title} 열기`} onDoubleClick={() => loadAbcNote(note)} onClick={() => openAbcNote(note)}>{note.coverPath ? <img className="song-cover" src={abcNoteCoverUrl(note)} alt=""/> : <FileText size={24}/>}</button><button className="song-info" onDoubleClick={() => loadAbcNote(note)} onClick={() => openAbcNote(note)}><strong>{note.title}</strong><p>{new Date(note.createdAt).toLocaleDateString('ko-KR')}</p></button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${note.title} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end"><button className="song-menu-item" onClick={() => openAbcNote(note)}><Pencil size={15}/>열기</button><button className="song-menu-item" onClick={() => loadAbcNote(note)}><ArrowRight size={15}/>불러오기</button><button className="song-menu-item" onClick={() => openAbcNoteCoverPicker(note)}><ImageIcon size={15}/>커버 {note.coverPath ? '변경' : '등록'}</button>{note.coverPath && <button className="song-menu-item" onClick={() => void deleteAbcNoteCover(note)}><X size={15}/>커버 삭제</button>}<button className="song-menu-item danger" onClick={() => void deleteAbcNote(note)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover></article>)}</div> : <div className="empty-library"><div className="empty-icon"><FileText size={42} strokeWidth={1.25}/></div><h2>저장된 악보가 없어요</h2><p>만들기 화면에서 심볼릭 작곡을 만들고 "라이브러리에 저장"을 눌러 보세요.</p></div>}</section>;
  }
  return <div className="studio-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}><button className="brand" onClick={() => navigate('create')} aria-label="SongYUE2 만들기로 이동"><span className="brand-symbol"><AudioLines size={25}/></span><span>Song<b>YUE2</b><small>by madwind</small></span></button><div className="sidebar-main"><nav aria-label="주 메뉴">{([{ id: 'create', icon: Sparkles }, { id: 'home', icon: Home }, { id: 'projects', icon: Folder }, { id: 'library', icon: ListMusic }, { id: 'playlists', icon: ListPlus }, { id: 'abc', icon: FileText }, { id: 'favorites', icon: Heart }] as const).map(({ id, icon: Icon }) => <button className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)} key={id} aria-current={page === id ? 'page' : undefined}><Icon size={19}/><span>{titles[id]}</span>{id === 'create' && <Plus size={15} className="nav-plus"/>}</button>)}</nav><div className="sidebar-divider"/><div className="sidebar-subhead"><span>최근 프로젝트</span><button aria-label="프로젝트 보기" onClick={() => navigate('projects')}><Plus size={14}/></button></div>{(() => { const recentDrafts = projects.filter(item => item.status === 'draft').slice(0, 4); return recentDrafts.length ? recentDrafts.map(item => <button className="recent-item" key={item.id} onClick={() => loadProject(item)}><span className="recent-dot"/>{item.title}</button>) : <p className="sidebar-empty">새로운 아이디어가<br/>음악이 되는 곳.</p>; })()}</div><div className="sidebar-bottom"><nav aria-label="도구 메뉴"><button className={`nav-item ${page === 'models' ? 'active' : ''}`} onClick={() => navigate('models')}><Cpu size={18}/>모델 관리</button><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>설정</button><button className="nav-item" onClick={() => { setHelp(true); setMobileNav(false); }}><CircleHelp size={18}/>도움말</button></nav><div className="profile"><span className="avatar"><Headphones size={18}/></span><div>나의 스튜디오<small>로컬 워크스페이스</small></div><span className="version">0.1</span></div></div></aside>
    {mobileNav && <button className="nav-scrim" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)}/>}
    <main className="main-shell"><header className="topbar"><div className="topbar-title"><Button variant="ghost" size="icon" className="mobile-menu" aria-label="메뉴 열기" onClick={() => setMobileNav(true)}><Menu/></Button><span className="breadcrumb">작업 공간</span><ChevronRight size={14}/><strong>{titles[page]}</strong></div><Popover open={modelOpen} onOpenChange={setModelOpen}><PopoverTrigger render={<Button variant="outline" className="model-trigger" aria-label="음악 모델 선택"/>}><AudioLines size={17}/><span>{model.name}</span><span className="model-recommended">{model.id === 'yue2-q4' ? '추천' : model.engine}</span><ChevronDown size={15}/></PopoverTrigger><PopoverContent className="model-menu" align="start"><div className="menu-heading">음악 생성 모델<span>새 작업에 적용할 모델을 선택하세요</span></div>{models.map(item => <button key={item.id} className={`model-option ${draft.modelId === item.id ? 'selected' : ''}`} disabled={item.selectable === false} onClick={() => { if (item.selectable === false) return; update({ modelId: item.id }); setModelOpen(false); }}><Cpu size={18}/><span><strong>{item.name}<em>{item.badge}</em></strong><small>{item.detail} · {item.size}</small></span>{draft.modelId === item.id && <Check size={17}/>}</button>)}<div className="model-menu-footer">모델 파일과 실행 엔진의 준비 상태는 별도로 확인합니다.<button onClick={() => { navigate('models'); setModelOpen(false); }}>모델 관리 <ArrowRight size={13}/></button></div></PopoverContent></Popover><div className="device-status"><span className={`status-dot ${online ? '' : 'offline'}`}/><span>{online ? '로컬 연결됨' : '로컬 연결 대기'}</span><span className="device-divider"/><Cpu size={14}/><span>RTX 5070 <span className="muted">· 12 GB</span></span></div></header>
    {page === 'create' ? <div className="creation-layout"><section className="composer" aria-label="노래 편집기"><div className="composer-scroll"><div className="composer-heading"><div><h1>어떤 노래를 만들까요?</h1></div><Music2 size={24}/></div><div className="mode-switch" aria-label="제작 모드"><button className={draft.mode === 'simple' ? 'active' : ''} aria-pressed={draft.mode === 'simple'} onClick={() => update({ mode: 'simple' })}>간편 모드</button><button className={draft.mode === 'custom' ? 'active' : ''} aria-pressed={draft.mode === 'custom'} onClick={() => update({ mode: 'custom' })}>직접 만들기<SlidersHorizontal size={14}/></button></div><div className="mode-switch vocal-mode-switch" aria-label="보컬 여부"><button className={!draft.instrumental ? 'active' : ''} aria-pressed={!draft.instrumental} onClick={() => update({ instrumental: false })}><Mic size={14}/>보컬+악기</button><button className={draft.instrumental ? 'active' : ''} aria-pressed={draft.instrumental} onClick={() => update({ instrumental: true })}><Guitar size={14}/>악기만</button></div>
    {draft.mode === 'simple' && <div className="form-section idea-section"><label htmlFor="idea">떠오르는 아이디어</label><Textarea id="idea" value={idea} onChange={event => setIdea(event.target.value)} placeholder="친구에게 위로를 건네는 따뜻한 노래"/><Button variant="outline" onClick={() => void assist('lyrics')} disabled={!!busy}><WandSparkles/>아이디어로 가사 초안 만들기</Button><p className="field-hint">설정한 LLM이 가사 작성을 도와줘요. 직접 작성해도 좋아요.</p></div>}
    <div className="form-section"><div className="field-heading"><label htmlFor="lyrics"><FileText size={16}/>가사</label><button className="text-action" onClick={() => void assist('lyrics')} disabled={!!busy}><WandSparkles size={13}/>작사 도우미</button></div><div className="lyrics-box"><Textarea id="lyrics" value={draft.lyrics} onChange={event => update({ lyrics: event.target.value })} placeholder={'[Verse]\n이곳에 나만의 이야기를 적어 주세요.\n직접 쓴 가사를 붙여 넣어도 좋아요.\n\n[Chorus]\n마음에 남을 후렴을 들려주세요.'} maxLength={12000}/><div className="textarea-footer"><span>{draft.lyrics.length.toLocaleString()} / 12,000</span></div></div>{draft.instrumental && <p className="field-hint">{model.engine === 'Python' ? '"원본" 모델은 악기만 선택 시 악보의 보컬 성부를 자동으로 쉼표 처리해 생성합니다(악보가 없으면 먼저 심볼릭 작곡을 실행). 가사는 스타일 프롬프트에만 참고로 남고, 실제로 불려지지 않도록 구조적으로 처리됩니다.' : 'GGUF(Q4/Q8/BF16) 모델은 악보 기반 처리를 지원하지 않아, "instrumental, no vocals" 스타일 힌트만 추가됩니다 — 보컬이 완전히 사라진다고 보장되지는 않습니다. 확실한 악기만 생성을 원하면 "원본" 모델을 선택하세요.'}</p>}</div>
    <div className="form-section"><div className="field-heading"><label htmlFor="style"><AudioLines size={16}/>음악 스타일</label><button className="text-action" onClick={() => void assist('style')} disabled={!!busy}><Sparkles size={13}/>스타일 다듬기</button></div><Textarea id="style" className="style-input" value={draft.style} onChange={event => update({ style: event.target.value })} placeholder={'장르, 분위기, 악기, 목소리…\n예: 따뜻한 어쿠스틱 팝, 잔잔한 기타, 부드러운 보컬'} maxLength={4000}/><div className="style-tags">{stylePresets.map(tag => <button key={tag} onClick={() => update({ style: draft.style ? `${draft.style}, ${tag}` : tag })}><Plus size={11}/>{tag}</button>)}</div></div>
    <div className="form-section title-section"><div className="field-heading"><label htmlFor="song-title">곡 제목<span className="optional">선택</span></label></div><Input id="song-title" value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="이 노래의 이름을 지어 주세요" maxLength={120}/></div><div className="advanced-section"><button className="advanced-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><span><SlidersHorizontal size={16}/>고급 설정</span><ChevronDown size={15} className={advanced ? 'rotated' : ''}/></button>{advanced && <div className="advanced-fields"><label className="seed-field"><span className="seed-label-row">Seed<button type="button" className="dice-btn" aria-label="Seed 무작위로 바꾸기" onClick={() => update({ seed: Math.floor(Math.random() * 2147483648) })}><Dices size={14}/></button></span><Input type="number" min="0" max="2147483647" value={draft.seed} disabled={randomizeSeed} onChange={event => update({ seed: Number(event.target.value) })}/><span className="seed-randomize"><input type="checkbox" checked={randomizeSeed} onChange={event => toggleRandomizeSeed(event.target.checked)}/>매번 무작위(randomize)</span></label><label>추론 단계<Input type="number" min="1" max="100" value={draft.steps} onChange={event => update({ steps: Number(event.target.value) })}/></label><label className="wide-field">작곡 계획<select value={draft.cot} onChange={event => update({ cot: event.target.value })}><option value="full">멜로디와 코드 계획 (기본)</option><option value="melody">멜로디 계획</option><option value="off">계획 없이 생성</option></select></label>{draft.instrumental ? <div className="wide-field vocal-gender-field"><span className="field-label">보컬</span><span className="vocal-gender-hint">악기만 모드에서는 보컬 없이 생성됩니다.</span></div> : <div className="wide-field vocal-gender-field"><span className="field-label">보컬</span><div className="vocal-gender-toggle"><button type="button" className={`vocal-gender-btn${draft.vocalGender === 'male' || draft.vocalGender === 'duet' ? ' active' : ''}`} onClick={() => toggleVocal('male')}>남성</button><button type="button" className={`vocal-gender-btn${draft.vocalGender === 'female' || draft.vocalGender === 'duet' ? ' active' : ''}`} onClick={() => toggleVocal('female')}>여성</button></div>{draft.vocalGender === 'duet' && <span className="vocal-gender-hint">둘 다 선택하면 듀엣으로 만들어져요</span>}</div>}<div className="wide-field abc-score-field"><div className="abc-score-header"><span className="field-label">ABC 악보 (심볼릭 작곡)<span className="optional">선택</span></span><Button type="button" variant="outline" size="sm" onClick={() => navigate('abc')}><FileText size={14}/>라이브러리 열기</Button></div><Textarea className="abc-score-textarea" value={draft.abc} onChange={event => update({ abc: event.target.value })} placeholder="비워두면 가사와 스타일만으로 생성합니다. 심볼릭 작곡을 누르면 멜로디/코드 악보가 여기에 채워져요."/><AbcPreview abc={draft.abc}/><div className="abc-score-actions"><Button type="button" variant="outline" size="sm" onClick={() => void runPlan()} disabled={!!busy || !online}>{busy === 'plan' ? <LoaderCircle className="spin"/> : <WandSparkles size={14}/>}심볼릭 작곡</Button><Button type="button" variant="outline" size="sm" onClick={() => void checkAbc()} disabled={!!busy || !draft.abc.trim()}>{busy === 'abc-check' ? <LoaderCircle className="spin"/> : <ShieldCheck size={14}/>}검사</Button><Button type="button" variant="outline" size="sm" onClick={openDraftAbcEdit} disabled={!draft.abc.trim()}><Pencil size={14}/>편집</Button><Button type="button" variant="outline" size="sm" onClick={() => void saveAbcViaPicker()} disabled={!!busy || !draft.abc.trim()}>{busy === 'abc-save-file' ? <LoaderCircle className="spin"/> : <Save size={14}/>}저장</Button><Button type="button" variant="outline" size="sm" onClick={() => abcImportInputRef.current?.click()}><FolderOpen size={14}/>파일에서 가져오기</Button><Button type="button" variant="outline" size="sm" onClick={() => coverAudioInputRef.current?.click()} disabled={!!busy || !online}>{busy === 'cover-transcribe' ? <LoaderCircle className="spin"/> : <Upload size={14}/>}오디오에서 추출</Button><Button type="button" variant="ghost" size="sm" onClick={clearAbc} disabled={!draft.abc.trim()}><X size={14}/>삭제</Button></div>{busy === 'plan' && <div className="generate-progress"><Progress aria-label="심볼릭 작곡 진행률" value={generateProgress}/><span>작곡 중... {generateProgress}%</span></div>}</div><p className="field-hint wide-field">{['yue2-q4', 'yue2-q8'].includes(model.id) ? 'VAE: F16 · 메모리를 절약하는 조합' : 'VAE: F32 · 고용량 GPU 환경용'}<br/>설정과 모델 정보는 초안에 함께 저장됩니다.</p></div>}</div></div><div className="composer-footer"><div className="compose-actions"><Button variant="outline" onClick={() => void saveDraft()} disabled={!!busy || !online}>{busy === 'save' ? <LoaderCircle className="spin"/> : <Save/>}초안 저장</Button><Button className="generate-button" onClick={requestGenerate} disabled={!!busy || !online}>{busy === 'generate' ? <LoaderCircle className="spin"/> : <Sparkles/>}노래 만들기</Button></div>{busy === 'generate' && <div className="generate-progress"><Progress aria-label="생성 진행률" value={generateProgress}/><span>생성 중... {generateProgress}%</span></div>}</div></section>
    <section className="workspace" aria-label="내 작업"><div className="workspace-heading"><div><h2>내 작업<span className="count-label">{projects.length}</span></h2><p>오늘의 아이디어가 다음 노래가 되는 곳</p></div></div>{projectList()}<div className="inspiration-section"><div className="section-caption"><span><Sparkles size={15}/>어디서 시작할지 고민된다면</span><button onClick={() => setPresetOpen(true)}>예시 둘러보기<ChevronRight size={14}/></button></div><div className="inspiration-carousel">{examples.length > 3 && <Button variant="ghost" size="icon" aria-label="이전 예시" onClick={() => setExampleIndex(previous => (previous - 1 + examples.length) % examples.length)}><ChevronLeft/></Button>}<div className="inspiration-grid">{exampleWindow.map(example => <button key={example.id} className={`inspiration-card ${example.color || ''}`} onClick={() => useExample(example)}><div className="preset-top"><Music2 size={21}/><ArrowRight size={15}/></div><span className="genre-label">{example.genre || '예시'}</span><strong>{example.title}</strong><small>{example.caption}</small></button>)}</div>{examples.length > 3 && <Button variant="ghost" size="icon" aria-label="다음 예시" onClick={() => setExampleIndex(previous => (previous + 1) % examples.length)}><ChevronRight/></Button>}</div></div><div className="workspace-note"><ShieldCheck size={15}/><span>가사와 초안은 내 PC에 저장됩니다. 클라우드 LLM은 요청할 때만 연결됩니다.</span></div></section></div>
    : page === 'settings' ? <section className="settings-page page-scroll"><div className="page-heading"><span className="eyebrow">내 작업 방식에 맞게</span><h1>스튜디오 설정</h1><p>작사 도우미와 로컬 작업 환경을 설정하세요.</p></div><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><WandSparkles size={21}/></div><div><h2>작사 도우미</h2><p>가사와 스타일을 함께 다듬을 LLM을 선택하세요.</p></div><span className="small-badge">선택 기능</span></div><div className="provider-grid">{providers.map(provider => <button key={provider.id} className={`provider-card ${settings.provider === provider.id ? 'selected' : ''}`} aria-pressed={settings.provider === provider.id} onClick={() => void selectProvider(provider.id)}><span className="provider-mark">{provider.mark}</span><strong>{provider.label}</strong><small>{provider.description}</small>{settings.provider === provider.id && <Check className="provider-check" size={15}/>}</button>)}</div>
    {settings.provider !== 'none' ? <div className="settings-form"><label className="wide-field">연결 주소<Input value={settings.endpoint || '.env 파일에 값이 없습니다'} readOnly/></label><label>LLM 모델 이름<Input value={settings.llmModel || '.env 파일에 값이 없습니다'} readOnly/></label>{settings.provider !== 'ollama' && <label>API 키<Input value={settings.apiKey || '.env 파일에 값이 없습니다'} readOnly/></label>}<p className="field-hint wide-field">연결 주소, 모델 이름, API 키는 프로젝트 폴더의 .env 파일에서 읽어옵니다. .env.sample을 복사해 .env로 저장한 뒤 값을 입력하고 앱을 다시 실행해 주세요.<br/>연결 확인은 실제 짧은 요청을 전송합니다.</p></div> : <div className="inline-note"><Check size={17}/><span>LLM 없이도 직접 쓴 가사와 스타일로 작업할 수 있어요.</span></div>}
    <div className="settings-actions"><Button variant="outline" onClick={() => { setSettings(savedSettings); notify('저장된 설정으로 되돌렸습니다.'); }}>변경 취소</Button>{settings.provider !== 'none' && <Button variant="outline" disabled={!!busy} onClick={() => void storeSettings(true)}>{busy === 'test' ? <LoaderCircle className="spin"/> : <RefreshCw/>}저장 후 연결 확인</Button>}<Button disabled={!!busy} onClick={() => void storeSettings()}><Save/>설정 저장</Button></div></section><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><Cpu size={21}/></div><div><h2>로컬 실행 환경</h2><p>음악 생성 엔진과 라이브러리 폴더 위치입니다.</p></div></div><div className="settings-form"><label className="wide-field">audio.cpp 실행 파일 (GGUF 모델용)<Input value={settings.enginePath} onChange={event => setSettings({ ...settings, enginePath: event.target.value })} placeholder={DEFAULT_ENGINE_PATH}/></label><label className="wide-field">Python 실행 파일 (원본 모델용)<Input value={settings.pythonEnginePath} onChange={event => setSettings({ ...settings, pythonEnginePath: event.target.value })} placeholder="예: test\YuE2-source\.venv\Scripts\python.exe (24GB급 VRAM 권장)"/></label><label className="wide-field">Python 스크립트 (run_yue2.py)<Input value={settings.pythonScriptPath} onChange={event => setSettings({ ...settings, pythonScriptPath: event.target.value })} placeholder="예: test\YuE2-source\skills\yue2-music\scripts\run_yue2.py"/></label><label>Python 메모리 예산 (GiB)<Input type="number" min="1" max="64" value={settings.pythonMemoryBudgetGib} onChange={event => setSettings({ ...settings, pythonMemoryBudgetGib: Number(event.target.value) })}/></label><label className="wide-field">SheetSage2 Python 실행 파일 (제로샷 커버용, 별도 venv 필요)<Input value={settings.sheetSagePythonPath} onChange={event => setSettings({ ...settings, sheetSagePythonPath: event.target.value })} placeholder="예: test\YuE2-source\.venv-sheetsage2\Scripts\python.exe"/></label><label className="wide-field">Setting 폴더<Input value={settings.settingPath} onChange={event => setSettings({ ...settings, settingPath: event.target.value })} placeholder={DEFAULT_SETTING_PATH}/></label><label className="wide-field">Music 폴더<Input value={settings.musicPath} onChange={event => setSettings({ ...settings, musicPath: event.target.value })} placeholder={DEFAULT_MUSIC_PATH}/></label><label className="wide-field">예시 폴더<Input value={settings.examplesPath} onChange={event => setSettings({ ...settings, examplesPath: event.target.value })} placeholder={DEFAULT_EXAMPLES_PATH}/></label><label className="wide-field">커버 이미지 폴더<Input value={settings.coversPath} onChange={event => setSettings({ ...settings, coversPath: event.target.value })} placeholder={DEFAULT_COVERS_PATH}/></label><label className="wide-field">ABC 악보 폴더<Input value={settings.abcNotesPath} onChange={event => setSettings({ ...settings, abcNotesPath: event.target.value })} placeholder={DEFAULT_ABC_NOTES_PATH}/></label><label>저장 파일 형식<select value={settings.saveFormat} onChange={event => setSettings({ ...settings, saveFormat: event.target.value as Settings['saveFormat'] })}>{saveFormats.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label><label>보기 방식<select value={settings.viewMode} onChange={event => void setViewMode(event.target.value as Settings['viewMode'])}>{viewModes.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label><label className="wide-field">로그 폴더(읽기 전용)<Input value={settings.outputDirectory} readOnly/></label></div><p className="field-hint wide-field">실행 파일/스크립트/폴더는 모두 SongYUE2 폴더 기준 상대 경로입니다(절대 경로도 입력 가능). 비워두면 위 placeholder 경로가 사용되며, 폴더가 없으면 자동으로 만들어집니다. 메모리 예산은 원본 모델 생성 시 GPU VRAM 사용 한도(GiB)이며, 낮출수록 저사양 GPU에서도 동작할 가능성이 높아지지만 너무 낮으면 실패할 수 있습니다.</p><div className="settings-actions"><Button onClick={() => void storeSettings()} disabled={!!busy}><Save/>설정 저장</Button></div></section><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><Sparkles size={21}/></div><div><h2>Music style Presets</h2><p>만들기 화면의 음악 스타일 아래에 뜨는 빠른 태그 버튼입니다. 한 줄에 하나씩 입력하세요.</p></div></div><Textarea className="style-presets-textarea" value={settings.stylePresets} onChange={event => setSettings({ ...settings, stylePresets: event.target.value })} placeholder={DEFAULT_STYLE_PRESETS}/><div className="settings-actions"><Button onClick={() => void storeSettings()} disabled={!!busy}><Save/>설정 저장</Button></div></section><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><AudioLines size={21}/></div><div><h2>후처리 비주얼라이저</h2><p>후처리 / EQ 창의 원형 라이브 비주얼라이저 표시 여부와 모양입니다.</p></div></div><div className="settings-form"><label className="checkbox-label wide-field"><input type="checkbox" checked={settings.visualizerEnabled} onChange={event => setSettings({ ...settings, visualizerEnabled: event.target.checked })}/>비주얼라이저 표시</label><div className="wide-field visualizer-row"><label>라인 색상(색조 0~360)<Input type="number" min="0" max="359" value={settings.visualizerHue} onChange={event => setSettings({ ...settings, visualizerHue: Number(event.target.value) })}/></label><label>라인 개수<Input type="number" min="1" max="40" value={settings.visualizerRingCount} onChange={event => setSettings({ ...settings, visualizerRingCount: Number(event.target.value) })}/></label><label>라인 굵기<Input type="number" min="0.5" max="8" step="0.5" value={settings.visualizerLineWidth} onChange={event => setSettings({ ...settings, visualizerLineWidth: Number(event.target.value) })}/></label></div></div><p className="field-hint wide-field">기본값: 표시 켬 · 색조 {DEFAULT_VISUALIZER_HUE} · 라인 {DEFAULT_VISUALIZER_RING_COUNT}개 · 굵기 {DEFAULT_VISUALIZER_LINE_WIDTH}</p><div className="settings-actions"><Button onClick={() => void storeSettings()} disabled={!!busy}><Save/>설정 저장</Button></div></section></section>
    : page === 'models' ? <section className="models-page page-scroll"><div className="page-heading"><span className="eyebrow">내 스튜디오의 사운드 엔진</span><h1>모델 관리</h1><p>원본과 GGUF 모델을 보관하고, 상단에서 사용할 모델을 고르세요.</p></div><div className="download-overview"><div className="setting-icon"><ArrowDownToLine size={23}/></div><div className="download-copy"><h2>{inventory?.state === 'complete' ? '모델 다운로드 완료' : '모델 파일 준비 중'}</h2><p>{inventory ? `${gb(inventory.completedBytes)} / ${gb(inventory.totalBytes)}` : '로컬 다운로드 상태를 확인하고 있습니다.'}</p><Progress aria-label="전체 모델 다운로드" value={inventory?.totalBytes ? Math.min(100, inventory.completedBytes / inventory.totalBytes * 100) : 0}/></div><span className="small-badge">Hugging Face</span></div><div className="model-card-grid">{models.map(item => <article className={`model-detail-card ${draft.modelId === item.id ? 'selected' : ''}`} key={item.id}><div className="model-card-top"><Cpu size={23}/><span className="small-badge">{item.badge}</span></div><h2>{item.name}</h2><p>{item.detail}</p><div className="model-meta"><span>실행 방식<strong>{item.engine}</strong></span><span>본체 크기<strong>{item.size}</strong></span></div><div className="model-file-state"><span className={`status-dot ${installed(item) ? '' : 'amber'}`}/>{installed(item) ? '본체 다운로드됨' : '파일 준비 중'}<span>{item.engine === 'audio.cpp' ? '생성 지원' : '엔진 미지원'}</span></div><Button variant={draft.modelId === item.id ? 'default' : 'outline'} disabled={item.selectable === false} onClick={() => { update({ modelId: item.id }); notify(`${item.name} 모델을 선택했습니다.`); }}>{draft.modelId === item.id ? <><Check/>현재 선택한 모델</> : item.selectable === false ? '연결 대기' : '이 모델 선택'}</Button></article>)}</div><section className="repository-section"><h2>다운로드 보관함</h2>{inventory?.repositories?.map(repo => <div className="repository-row" key={repo.id}><Folder size={19}/><div><strong>{repo.id}</strong><small>{repo.files?.filter(file => file.state === 'complete').length || 0} / {repo.files?.length || 0}개 파일 · {gb(repo.completedBytes)} / {gb(repo.totalBytes)}</small></div><span className="small-badge">{repo.state === 'complete' ? '완료' : '다운로드 중'}</span></div>)}</section><div className="inline-note"><ShieldCheck size={18}/><span>모델 가중치 라이선스: CC BY-NC 4.0. 앱 배포 파일과 모델은 분리해 관리합니다. 다운로드와 실제 실행 가능 여부는 다릅니다.</span></div></section>
    : page === 'playlists' ? playlistPage()
    : page === 'abc' ? abcNotePage()
    : <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">나의 음악을 한곳에</span><h1>{titles[page]}</h1><p>{page === 'projects' ? '저장할 때마다 새 버전으로 남아, 이전 아이디어를 다시 꺼낼 수 있어요.' : '가사, 스타일, 설정까지 함께 보관하는 나만의 컬렉션.'}</p></div><Button onClick={() => navigate('create')}><Plus/>노래 만들기</Button></div>{projectList()}</section>}
    <audio ref={audioRef} onEnded={playNext} onTimeUpdate={event => setPlaybackTime(event.currentTarget.currentTime)} onLoadedMetadata={event => setPlaybackDuration(event.currentTarget.duration)} hidden/>
    <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void handleCoverFile(event)}/>
    <input ref={coverAudioInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/ogg" hidden onChange={event => void handleCoverAudioFile(event)}/>
    <input ref={abcImportInputRef} type="file" accept=".abc,.txt,.json,text/plain,application/json" hidden onChange={event => void handleAbcImportFile(event)}/>
    {nowPlaying ? <footer className="player-bar expanded"><div className="player-seek-row"><span className="player-time">{formatTime(playbackTime)}</span><input className="player-seek" type="range" aria-label="재생 위치" min={0} max={playbackDuration || 0} step={0.1} value={Math.min(playbackTime, playbackDuration || playbackTime)} onChange={event => seekTo(Number(event.target.value))}/><span className="player-time">{formatTime(playbackDuration)}</span></div><div className="player-main-row"><div className="player-art">{nowPlaying.coverPath ? <img className="song-cover" src={coverUrl(nowPlaying)} alt=""/> : <Music2 size={20}/>}</div><div className="player-copy"><strong>{nowPlaying.title}</strong><span>{nowPlaying.style}</span></div><div className="player-controls"><Button variant="ghost" size="icon" aria-label="이전 곡" onClick={playPrev} disabled={queueIndex === 0}><SkipBack/></Button><Button variant="ghost" size="icon" aria-label="10초 뒤로" onClick={() => seekBy(-10)}><Rewind/></Button><Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={togglePlay}>{isPlaying ? <Pause/> : <Play/>}</Button><Button variant="ghost" size="icon" aria-label="눌러서 앞으로 이동, 꾹 누르면 계속 이동" onMouseDown={startHoldForward} onMouseUp={stopHoldForward} onMouseLeave={stopHoldForward} onTouchStart={startHoldForward} onTouchEnd={stopHoldForward}><FastForward/></Button><Button variant="ghost" size="icon" aria-label="다음 곡" onClick={playNext} disabled={queueIndex + 1 >= queue.length}><SkipForward/></Button><Button variant="ghost" size="icon" aria-label="역재생" aria-pressed={reversePlaying} className={reversePlaying ? 'active' : ''} onClick={toggleReverse}><RotateCcw/></Button></div><div className="player-extra"><button className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed}>{playbackRate}x</button><Volume2 size={15}/><input className="player-volume" type="range" aria-label="볼륨" min={0} max={1} step={0.01} value={volume} onChange={event => changeVolume(Number(event.target.value))}/></div></div></footer>
    : <footer className="player-bar"><div className="player-art"><Music2 size={20}/></div><div className="player-copy"><strong>아직 재생할 노래가 없어요</strong><span>완성된 노래를 선택하면 이곳에서 재생됩니다.</span></div><div className="player-empty"><Headphones size={17}/><span>당신의 다음 곡을 기다리는 중</span></div><span className="player-time">— : —</span></footer>}</main>
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={19}/> : <Check size={19}/>}<span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="알림 닫기"><X size={16}/></button></div>}
    <Dialog open={presetOpen} onOpenChange={setPresetOpen}><DialogContent className="studio-dialog example-browser"><DialogTitle>어떤 분위기로 시작할까요?</DialogTitle><DialogDescription>직접 작성한 예시입니다. 카드를 선택하면 바로 편집기의 가사와 스타일이 바뀝니다.</DialogDescription><div className="dialog-scroll"><div className="example-card-grid">{examples.map(example => <button className={`inspiration-card ${example.color || ''}`} key={example.id} onClick={() => useExample(example)}><div className="preset-top"><Music2 size={21}/><ArrowRight size={15}/></div><span className="genre-label">{example.genre || '예시'}</span><strong>{example.title}</strong><small>{example.caption}</small></button>)}</div></div></DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="studio-dialog"><DialogTitle>나만의 음악 작업실 사용 안내</DialogTitle><DialogDescription>작은 아이디어를 노래로 만드는 과정</DialogDescription><div className="dialog-scroll help-content"><h3>01 · 상단에서 음악 모델 선택</h3><p>이 PC에서는 Q4와 F16 VAE 조합을 우선 검증할 예정입니다.</p><h3>02 · 가사와 분위기 작성</h3><p>직접 입력하거나 예시를 불러오세요. 작사 도우미는 설정에서 선택할 수 있습니다.</p><h3>03 · 초안 저장과 버전 비교</h3><p>라이브러리에서 설정을 다시 불러와 수정하세요. 저장할 때마다 새 버전이 남습니다.</p><div className="inline-note warning">설정에서 audio.cpp 실행 파일 경로를 지정하면 노래 만들기에서 실제 음악을 생성하고 바로 재생할 수 있습니다.</div></div></DialogContent></Dialog>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{selected?.title}</DialogTitle><DialogDescription>{selected?.status === 'completed' ? '완성된 곡 · 재생하고 메모를 남기세요.' : '저장된 초안 · 원본 가사와 설정은 그대로 보관됩니다.'}</DialogDescription>{selected?.status === 'completed' && <><audio controls className="detail-audio" src={`/api/projects/${selected.id}/audio`}/>{selected.saveError && <p className="detail-saved-path warning"><CircleHelp size={13}/>{selected.saveError}</p>}</>}<div className="dialog-scroll"><label>음악 스타일</label><p className="detail-style">{selected?.style}</p><label>가사</label><pre className="detail-lyrics">{selected?.lyrics}</pre><label htmlFor="project-notes">작업 메모</label><Textarea id="project-notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="다음 버전에서 바꾸고 싶은 점"/></div><div className="dialog-actions"><Button variant="outline" onClick={() => setSelected(null)}>취소</Button><Button variant="outline" onClick={() => { if (selected) window.location.assign(`/api/projects/${selected.id}/export`); }}><ArrowDownToLine/>내보내기</Button><Button variant="outline" onClick={() => { if (selected) loadProject(selected); }}>설정 불러오기</Button><Button disabled={!!busy} onClick={async () => { if (!selected) return; setBusy('notes'); try { const item = await api<Project>(`/projects/${selected.id}`, 'PATCH', { notes }); setProjects(previous => previous.map(project => project.id === item.id ? item : project)); setSelected(null); notify('메모를 저장했습니다.'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); } }}><Save/>메모 저장</Button></div></DialogContent></Dialog>
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTarget?.title}을(를) 삭제할까요?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.status === 'completed' ? '가사, 스타일, 생성된 음원이 모두 삭제되며 되돌릴 수 없습니다. 이 곡을 만든 프로젝트(초안)는 영향을 받지 않습니다.' : '가사와 스타일 설정이 삭제되며 되돌릴 수 없습니다. 이 프로젝트로 이미 만든 노래는 삭제되지 않고 라이브러리에 그대로 남습니다.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={!!busy}>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={!!busy} onClick={() => { if (deleteTarget) void deleteProject(deleteTarget); }}>{busy === 'delete' ? <LoaderCircle className="spin"/> : <Trash2/>}삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!downloadTarget} onOpenChange={open => { if (!open) setDownloadTarget(null); }}><DialogContent className="studio-dialog"><DialogTitle>{downloadTarget?.title} 다운로드</DialogTitle><DialogDescription>받을 파일 형식을 선택하세요. 여러 개를 함께 받을 수 있어요.</DialogDescription><div className="download-format-list">{saveFormats.map(format => <label key={format.id} className="download-format-item"><input type="checkbox" checked={downloadFormats.has(format.id)} onChange={() => toggleDownloadFormat(format.id)}/>{format.label}</label>)}</div><div className="dialog-actions"><Button variant="outline" onClick={() => setDownloadTarget(null)}>취소</Button><Button disabled={!downloadFormats.size} onClick={confirmDownload}><Download/>다운로드</Button></div></DialogContent></Dialog>
    <Dialog open={!!abcEditTarget} onOpenChange={open => { if (!open) cancelAbcEdit(); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{abcEditTarget?.title}</DialogTitle><DialogDescription>악보를 검사하거나 수정한 뒤 저장하세요. 저장하지 않고 닫으면 변경 내용이 사라집니다.</DialogDescription><div className="dialog-scroll"><Textarea className="abc-edit-textarea" value={abcEditText} onChange={event => setAbcEditText(event.target.value)}/><AbcPreview abc={abcEditText} large controlsSlot={abcControlsSlot}/></div><div className="abc-player-slot" ref={setAbcControlsSlot}/><div className="abc-ai-edit-row"><Input value={abcAiInstruction} onChange={event => setAbcAiInstruction(event.target.value)} placeholder="AI에게 지시 (예: 후렴을 더 밝게 바꿔줘)"/><Button variant="outline" onClick={() => void applyAbcAiEdit(abcEditText, setAbcEditText)} disabled={!!busy || !online}>{busy === 'abc-ai' ? <LoaderCircle className="spin"/> : <WandSparkles size={14}/>}AI 적용</Button></div><div className="dialog-actions"><Button variant="outline" onClick={() => void checkAbcEditText()} disabled={!!busy}>{busy === 'abc-check' ? <LoaderCircle className="spin"/> : <ShieldCheck/>}악보 검사</Button><Button variant="outline" onClick={() => { if (abcEditTarget) loadAbcNote({ ...abcEditTarget, abc: abcEditText }); }}><ArrowRight/>불러오기</Button><Button variant="outline" onClick={cancelAbcEdit} disabled={!!busy}>취소</Button><Button onClick={() => void saveAbcEdit()} disabled={!!busy}>{busy === 'abc-save' ? <LoaderCircle className="spin"/> : <Save/>}저장</Button></div></DialogContent></Dialog>
    <Dialog open={draftAbcDialogOpen} onOpenChange={open => { if (!open) cancelDraftAbcEdit(); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>악보 편집</DialogTitle><DialogDescription>지금 만들고 있는 곡의 악보를 검사하거나 수정한 뒤 저장하세요. 저장하지 않고 닫으면 변경 내용이 사라집니다.</DialogDescription><div className="dialog-scroll"><Textarea className="abc-edit-textarea" value={draftAbcDraftText} onChange={event => setDraftAbcDraftText(event.target.value)}/><AbcPreview abc={draftAbcDraftText} large controlsSlot={abcControlsSlot}/></div><div className="abc-player-slot" ref={setAbcControlsSlot}/><div className="abc-ai-edit-row"><Input value={abcAiInstruction} onChange={event => setAbcAiInstruction(event.target.value)} placeholder="AI에게 지시 (예: 후렴을 더 밝게 바꿔줘)"/><Button variant="outline" onClick={() => void applyAbcAiEdit(draftAbcDraftText, setDraftAbcDraftText)} disabled={!!busy || !online}>{busy === 'abc-ai' ? <LoaderCircle className="spin"/> : <WandSparkles size={14}/>}AI 적용</Button></div><div className="dialog-actions"><Button variant="outline" onClick={() => void checkDraftAbcEditText()} disabled={!!busy}>{busy === 'abc-check' ? <LoaderCircle className="spin"/> : <ShieldCheck/>}악보 검사</Button><Button variant="outline" onClick={cancelDraftAbcEdit} disabled={!!busy}>취소</Button><Button onClick={saveDraftAbcEdit} disabled={!!busy}><Save/>저장</Button></div></DialogContent></Dialog>
    <Dialog open={abcSaveDialogOpen} onOpenChange={setAbcSaveDialogOpen}><DialogContent className="studio-dialog"><DialogTitle>악보 저장</DialogTitle><DialogDescription>이 브라우저에서는 탐색기로 바로 저장할 수 없어, 저장할 폴더와 파일명을 직접 확인해 주세요.</DialogDescription><div className="dialog-scroll"><label>폴더<Input value={abcSaveFolder} onChange={event => setAbcSaveFolder(event.target.value)} placeholder={DEFAULT_ABC_NOTES_PATH}/></label><label>파일명<Input value={abcSaveFilename} onChange={event => setAbcSaveFilename(event.target.value)} placeholder="악보"/></label></div><div className="dialog-actions"><Button variant="outline" onClick={() => setAbcSaveDialogOpen(false)} disabled={busy === 'abc-save-file'}>취소</Button><Button onClick={() => void confirmAbcSave()} disabled={busy === 'abc-save-file'}>{busy === 'abc-save-file' ? <LoaderCircle className="spin"/> : <Save/>}저장</Button></div></DialogContent></Dialog>
    <Dialog open={!!playlistPickerTarget} onOpenChange={open => { if (!open) setPlaylistPickerTarget(null); }}><DialogContent className="studio-dialog"><DialogTitle>재생목록에 추가</DialogTitle><DialogDescription>{playlistPickerTarget?.title}을(를) 추가할 재생목록을 고르세요.</DialogDescription><div className="dialog-scroll playlist-picker-list">{playlists.map(list => <button key={list.id} className="playlist-picker-item" onClick={() => { if (playlistPickerTarget) void addToPlaylist(playlistPickerTarget, list); setPlaylistPickerTarget(null); }}><ListPlus size={16}/><span>{list.name}</span><small>{list.songIds.length}곡</small></button>)}</div><div className="playlist-picker-new"><Input value={newPlaylistName} onChange={event => setNewPlaylistName(event.target.value)} placeholder="새 재생목록 이름"/><Button variant="outline" disabled={!newPlaylistName.trim()} onClick={() => { const target = playlistPickerTarget; if (target) void createPlaylistWith(newPlaylistName, target); setPlaylistPickerTarget(null); }}><Plus/>만들기</Button></div><div className="dialog-actions"><Button variant="outline" onClick={() => setPlaylistPickerTarget(null)}>닫기</Button></div></DialogContent></Dialog>
    <AlertDialog open={pythonWarningOpen} onOpenChange={setPythonWarningOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>원본(Python) 모델로 생성할까요?</AlertDialogTitle><AlertDialogDescription>이 모델은 공식적으로 24GB급 VRAM을 권장합니다. {gpuVramMb !== null ? `이 PC에서 감지된 GPU 메모리는 약 ${(gpuVramMb / 1024).toFixed(0)}GB입니다.` : 'GPU 사양을 확인하지 못했습니다.'} 설정의 메모리 예산을 낮추면 짧은 곡은 더 적은 VRAM에서도 만들어질 수 있지만, 길거나 복잡한 곡은 여전히 실패할 수 있어요. 그래도 진행하시겠어요?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => { setPythonWarningOpen(false); void saveDraft(true); }}>그래도 진행</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!suggestion} onOpenChange={open => { if (!open) { setSuggestion(null); setEditingSuggestion(false); } }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{suggestion?.task === 'lyrics' ? '가사 제안' : '스타일 제안'}</DialogTitle><DialogDescription>내용을 확인한 뒤 적용하세요. 필요하면 편집한 뒤 적용할 수 있어요.</DialogDescription><div className="dialog-scroll">{editingSuggestion ? <Textarea className="detail-lyrics suggestion-textarea" value={suggestion?.text || ''} onChange={event => { if (suggestion) setSuggestion({ ...suggestion, text: event.target.value }); }}/> : <pre className="detail-lyrics">{suggestion?.text}</pre>}</div><div className="dialog-actions"><Button variant="outline" onClick={() => setEditingSuggestion(!editingSuggestion)}><Pencil size={14}/>{editingSuggestion ? '편집 완료' : '편집'}</Button><Button variant="outline" onClick={() => { setSuggestion(null); setEditingSuggestion(false); }}>취소</Button><Button onClick={() => { if (suggestion) update({ [suggestion.task]: suggestion.text }); setSuggestion(null); setEditingSuggestion(false); }}>편집기에 적용</Button></div></DialogContent></Dialog>
    {postProcessTarget && <PostProcessDialog project={postProcessTarget} onClose={() => setPostProcessTarget(null)} notify={notify} visualizerEnabled={settings.visualizerEnabled} visualizerRingCount={settings.visualizerRingCount} visualizerHue={settings.visualizerHue} visualizerLineWidth={settings.visualizerLineWidth}/>}
  </div>;
}
