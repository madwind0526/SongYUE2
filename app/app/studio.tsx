'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './audio-compare.css';
import './timbre-transform.css';
import './audio-tools.css';
import * as ABCJS from 'abcjs';
import { AudioLines, ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Combine, Cpu, Dices, Disc3, Download, FastForward, FileText, Folder, FolderOpen, GitCompare, Guitar, Headphones, Heart, Home, Image as ImageIcon, Layers, LayoutGrid, ListMusic, ListPlus, LoaderCircle, Menu, Mic, MoreVertical, Music2, Pause, Pencil, Play, Plus, Power, RefreshCw, Rewind, RotateCcw, Save, Search, Settings2, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Square, Trash2, Upload, Volume2, WandSparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { api, emptyDraft, initialSettings, models, providers, saveFormats, viewModes, titles, gb, DEFAULT_SETTING_PATH, DEFAULT_MUSIC_PATH, DEFAULT_EXAMPLES_PATH, DEFAULT_COVERS_PATH, DEFAULT_ABC_NOTES_PATH, DEFAULT_MIDI_PATH, DEFAULT_STYLE_PRESETS, DEFAULT_VISUALIZER_RING_COUNT, DEFAULT_VISUALIZER_HUE, DEFAULT_VISUALIZER_LINE_WIDTH, DEFAULT_VISUALIZER_TRAIL, DEFAULT_VISUALIZER_SPIRAL, DEFAULT_VISUALIZER_RING_MODE, DEFAULT_VISUALIZER_TIME_STEP, DEFAULT_VISUALIZER_TIME_SKEW, DEFAULT_VISUALIZER_RING_STEP, DEFAULT_VISUALIZER_AMPLITUDE, DEFAULT_ENGINE_PATH, DEFAULT_COMFYUI_ENDPOINT, DEFAULT_COMFYUI_ENGINE_PATH, DEFAULT_DDSP_SVC_PATH, PYTHON_MODEL_MIN_VRAM_MB, type Page, type Draft, type Project, type Settings, type Inventory, type Example, type Playlist, type AbcNote, type SaveFormat, type SystemInfo } from './studio-data';

type SaveFilePickerFn = (options?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }> }>;
const RANDOMIZE_SEED_KEY = 'songyue2-randomize-seed';
function loadRandomizeSeed(): boolean {
  try { return localStorage.getItem(RANDOMIZE_SEED_KEY) === '1'; } catch { return false; }
}
// 모듈 공용: Blob(파일/재취득 응답)을 data: URL로 읽는다. 음색 변조/오디오 도구 업로드에 쓴다.
function readFileAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

async function saveProcessedBuffer(projectId: string, title: string, buffer: AudioBuffer, notify: (text: string, error?: boolean) => void): Promise<void> {
  const wavBlob = audioBufferToWavBlob(buffer);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(wavBlob);
  });
  const response = await fetch(`/api/projects/${projectId}/post-process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
  if (!response.ok) { const data = await response.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error || '후처리 저장에 실패했습니다.'); }
  const resultBlob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const suggestedName = match ? decodeURIComponent(match[1]) : `${title}-modified`;
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
}

async function mixBuffers(buffers: AudioBuffer[]): Promise<AudioBuffer> {
  const length = Math.max(...buffers.map(buffer => buffer.length));
  const channels = Math.max(...buffers.map(buffer => buffer.numberOfChannels));
  const sampleRate = buffers[0].sampleRate;
  const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
  for (const buffer of buffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start();
  }
  return offlineCtx.startRendering();
}

async function concatBuffers(buffers: AudioBuffer[]): Promise<AudioBuffer> {
  if (!buffers.length) throw new Error('이어붙일 오디오가 없습니다.');
  const channels = Math.max(...buffers.map(buffer => buffer.numberOfChannels));
  const sampleRate = buffers[0].sampleRate;
  const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
  let offset = 0;
  for (const buffer of buffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(offset / sampleRate);
    offset += buffer.length;
  }
  return offlineCtx.startRendering();
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

function formatSeekTime(seconds: number) { if (!Number.isFinite(seconds) || seconds < 0) return '0:00'; const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60); return `${mins}:${String(secs).padStart(2, '0')}`; }

function Waveform({ peaks, playedFraction, variant }: { peaks: number[]; playedFraction?: number; variant?: 'processed' | 'source' | 'reference' }) {
  return <div className={variant ? `pp-waveform pp-waveform-${variant}` : 'pp-waveform'}>{peaks.map((peak, index) => <span key={index} className={playedFraction !== undefined && index / peaks.length <= playedFraction ? 'played' : ''} style={{ height: `${Math.max(4, peak * 100)}%` }}/>)}</div>;
}

// In-place iterative radix-2 Cooley-Tukey FFT. `real`/`imag` length must be a power of 2.
function fft(real: Float32Array, imag: Float32Array) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1, curWi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = real[i + k], ui = imag[i + k];
        const vr = real[i + k + len / 2] * curWr - imag[i + k + len / 2] * curWi;
        const vi = real[i + k + len / 2] * curWi + imag[i + k + len / 2] * curWr;
        real[i + k] = ur + vr; imag[i + k] = ui + vi;
        real[i + k + len / 2] = ur - vr; imag[i + k + len / 2] = ui - vi;
        const nwr = curWr * wr - curWi * wi;
        const nwi = curWr * wi + curWi * wr;
        curWr = nwr; curWi = nwi;
      }
    }
  }
}


function CompareWaveform({ peaks, fraction, processed }: { peaks: number[]; fraction: number; processed: boolean }) {
  const progress = Math.max(0, Math.min(1, fraction));
  return <div className={`pp-waveform compare-waveform${processed ? ' pp-waveform-processed' : ''}`}>
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={`전체 음원 파형, 재생 위치 ${Math.round(progress * 100)}%`}>
      {peaks.map((peak, index) => {
        const x = (index + 0.5) / peaks.length * 1000;
        const height = Math.max(2, Math.min(1, peak) * 46);
        return <line key={index} x1={x} x2={x} y1={50 - height} y2={50 + height} stroke={index / peaks.length < progress ? (processed ? '#f2c94c' : '#add7a5') : '#596552'} strokeWidth={1.5}/>;
      })}
      {!!peaks.length && <line x1={progress * 1000} x2={progress * 1000} y1={0} y2={100} stroke="#fff" strokeWidth={1} vectorEffect="non-scaling-stroke"/>}
    </svg>
  </div>;
}

function CompareSpectrogram({ buffer, fraction }: { buffer: AudioBuffer | null; fraction: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendering, setRendering] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!buffer) { setRendering(false); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setRendering(true);
    const width = canvas.width, height = canvas.height, size = 2048;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const real = new Float32Array(size), imag = new Float32Array(size);
    const power = new Float64Array(size / 2);
    const window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
    const windowSum = window.reduce((a, b) => a + b, 0);
    const pixels = ctx.createImageData(width, height);
    const colors = [[0, 0, 0], [21, 0, 65], [85, 0, 126], [181, 0, 89], [241, 40, 16], [255, 163, 0], [255, 255, 170]];
    let x = 0;
    const drawChunk = () => {
      if (cancelled) return;
      const end = Math.min(width, x + 8);
      for (; x < end; x++) {
        power.fill(0);
        const frames = Math.max(1, Math.ceil(buffer.length / width / (size / 2)));
        // Cover each time bucket with overlapping windows, including long recordings.
        // Average channel power so opposite-phase stereo content does not disappear.
        for (let frame = 0; frame < frames; frame++) {
          const start = Math.round((x + (frame + 0.5) / frames) / width * buffer.length - size / 2);
          for (const channel of channels) {
            for (let i = 0; i < size; i++) { real[i] = (channel[start + i] || 0) * window[i]; imag[i] = 0; }
            fft(real, imag);
            for (let k = 0; k < power.length; k++) power[k] += (real[k] ** 2 + imag[k] ** 2) / (channels.length * frames);
          }
        }
        for (let y = 0; y < height; y++) {
          const low = Math.floor((height - 1 - y) / height * power.length);
          const high = Math.max(low + 1, Math.ceil((height - y) / height * power.length));
          let peakPower = 0;
          for (let k = low; k < Math.min(high, power.length); k++) peakPower = Math.max(peakPower, power[k]);
          // Fixed full-scale reference and range are shared by both tracks.
          const db = 10 * Math.log10(Math.max(1e-12, peakPower * 4 / (windowSum * windowSum)));
          const value = Math.max(0, Math.min(1, (db + 100) / 100)) * (colors.length - 1);
          const index = Math.min(colors.length - 2, Math.floor(value)), blend = value - index;
          const offset = (y * width + x) * 4;
          for (let c = 0; c < 3; c++) pixels.data[offset + c] = colors[index][c] * (1 - blend) + colors[index + 1][c] * blend;
          pixels.data[offset + 3] = 255;
        }
      }
      ctx.putImageData(pixels, 0, 0);
      if (x < width) timer = setTimeout(drawChunk, 0);
      else setRendering(false);
    };
    timer = setTimeout(drawChunk, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [buffer]);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return <div className="compare-spectrogram" aria-label="시간별 주파수 스펙트로그램" aria-busy={rendering}>
    <div className="compare-frequency-axis">{[1, 0.75, 0.5, 0.25, 0].map(t => <span key={t}>{buffer ? (t ? `${(buffer.sampleRate / 2000 * t).toFixed(1)} kHz` : '0 Hz') : (t === 1 ? '주파수' : t === 0 ? '0 Hz' : '')}</span>)}</div>
    <div className="compare-spectrogram-body">
      <div className="compare-spectrogram-plot">
        <canvas ref={canvasRef} width={768} height={256} role="img" aria-label="가로: 시간, 세로: 주파수, 밝은 색일수록 큰 음량"/>
        {buffer && <i className="compare-playhead" style={{ left: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}/>}
        {(!buffer || rendering) && <span className="compare-chart-status">{buffer ? '스펙트로그램 계산 중…' : '음원을 불러오세요'}</span>}
      </div>
      <div className="compare-time-axis">{ticks.map(t => <span key={t}>{formatSeekTime((buffer?.duration || 0) * t)}</span>)}</div>
    </div>
    <div className="compare-db-axis"><span>0</span><i/><span>−100</span><small>dBFS</small></div>
  </div>;
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

function PostProcessDialog({ project, onClose, notify, visualizerEnabled, visualizerRingCount, visualizerHue, visualizerLineWidth, visualizerTrail, visualizerSpiral, visualizerRingMode, visualizerTimeStep, visualizerTimeSkew, visualizerRingStep, visualizerAmplitude, sourceOverride, onSaveOverride, titleOverride }: { project: Project; onClose: () => void; notify: (text: string, error?: boolean) => void; visualizerEnabled: boolean; visualizerRingCount: number; visualizerHue: number; visualizerLineWidth: number; visualizerTrail: number; visualizerSpiral: number; visualizerRingMode: 'radial' | 'time'; visualizerTimeStep: number; visualizerTimeSkew: number; visualizerRingStep: number; visualizerAmplitude: number; sourceOverride?: { buffer: AudioBuffer; params: PostProcessParams }; onSaveOverride?: (buffer: AudioBuffer, params: PostProcessParams) => void; titleOverride?: string }) {
  const [params, setParams] = useState<PostProcessParams>(sourceOverride?.params || PP_DEFAULT_PARAMS);
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
  const presetImportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadCustomEqPresets().then(setCustomPresets); void loadPostprocessPresets().then(setPostprocessPresets); }, []);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => {
    let raf = 0;
    const points = 64;
    const ringCount = Math.max(1, visualizerRingCount);
    const rings = Array.from({ length: ringCount }, (_, i) => ({
      radiusFactor: 0.1 + i * (visualizerRingStep / 100),
      hue: (visualizerHue + ((i * 37) % 100)) % 360,
      offset: Math.floor((i * points) / ringCount * (visualizerSpiral / 100)),
    }));
    // Time mode: every ring is drawn at the same fixed radius; only which moment in the
    // past it shows differs (ring i = visualizerTimeStep * i seconds ago). Ring index is a
    // real time axis, not a second radius axis -- radial mode is unaffected and keeps its
    // per-ring radius/bin-offset behavior.
    const timeModeRadiusFactor = 0.22;
    let history: { t: number; data: Uint8Array }[] = [];
    const tick = () => {
      const canvas = visualizerCanvasRef.current;
      const analyser = analyserRef.current;
      const ctx2d = canvas?.getContext('2d');
      if (canvas && ctx2d) {
        // The canvas's CSS box (flex-sized width x fixed 90px height) doesn't match a fixed
        // internal resolution, which stretches circles into ellipses. Keep the drawing
        // buffer's pixel size exactly in sync with the rendered box instead.
        const displayWidth = Math.round(canvas.clientWidth);
        const displayHeight = Math.round(canvas.clientHeight);
        if (displayWidth > 0 && displayHeight > 0 && (canvas.width !== displayWidth || canvas.height !== displayHeight)) {
          canvas.width = displayWidth;
          canvas.height = displayHeight;
        }
        const { width, height } = canvas;
        const playing = visualizerEnabled && isPlayingRef.current;
        if (playing && visualizerTrail > 0) {
          ctx2d.globalCompositeOperation = 'destination-out';
          ctx2d.fillStyle = `rgba(0, 0, 0, ${1 - visualizerTrail / 100})`;
          ctx2d.fillRect(0, 0, width, height);
          ctx2d.globalCompositeOperation = 'source-over';
        } else {
          ctx2d.clearRect(0, 0, width, height);
        }
        if (playing) {
          const cx = width / 2;
          const cy = height / 2;
          const frame = new Uint8Array(analyser?.frequencyBinCount || points);
          if (analyser) analyser.getByteFrequencyData(frame);
          const now = performance.now();
          if (visualizerRingMode === 'time') {
            history.push({ t: now, data: frame });
            const maxAgeMs = Math.pow(Math.max(0, ringCount - 1), visualizerTimeSkew) * visualizerTimeStep * 1000 + 200;
            while (history.length > 1 && now - history[0].t > maxAgeMs) history.shift();
          }
          for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
            const ring = rings[ringIndex];
            // Mode 1 (radial): every ring reads the same current frame, offset by bin position,
            // at its own radius. Mode 2 (time): every ring shares one fixed radius; only which
            // moment it reads differs (ring i = visualizerTimeStep * i seconds in the past).
            let source: Uint8Array | undefined;
            if (visualizerRingMode === 'time') {
              const targetT = now - Math.pow(ringIndex, visualizerTimeSkew) * visualizerTimeStep * 1000;
              if (history.length && history[0].t <= targetT) {
                for (let h = history.length - 1; h >= 0; h--) {
                  if (history[h].t <= targetT) { source = history[h].data; break; }
                }
              }
            } else {
              source = frame;
            }
            if (!source) continue;
            const baseRadius = Math.min(width, height) * (visualizerRingMode === 'time' ? timeModeRadiusFactor : ring.radiusFactor);
            const nodes: { x: number; y: number }[] = [];
            // Real music has almost no energy in the top ~35% of a 0-Nyquist spectrum and often
            // saturates the very first bin(s); skip both flat extremes and only map the actively
            // varying middle range around the circle instead of the full bin array.
            const binMarginLow = 2;
            const binMarginHigh = Math.round(source.length * 0.35);
            const activeBins = Math.max(1, source.length - binMarginLow - binMarginHigh);
            for (let i = 0; i < points; i++) {
              const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
              const bin = binMarginLow + Math.floor(((i + ring.offset) % points) * activeBins / points);
              const value = source[bin] / 255;
              // Centered on the midpoint so quiet moments pull the radius inward (below
              // baseRadius) and loud moments push it outward, instead of only ever growing.
              // The inward pull is deliberately half as strong as the outward push.
              const centered = value - 0.5;
              const directional = centered >= 0 ? centered : centered * 0.5;
              const radius = Math.max(baseRadius * 0.1, baseRadius + directional * baseRadius * visualizerAmplitude);
              nodes.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
            }
            // Open curve: no segment connects the last point back to the first. With the
            // low/high bin margins excluded, those two ends read very different frequencies
            // and can jump sharply, which looked like a stray line when the loop was closed.
            ctx2d.beginPath();
            ctx2d.moveTo(nodes[0].x, nodes[0].y);
            for (let i = 1; i < points - 1; i++) {
              const p0 = nodes[i];
              const p1 = nodes[i + 1];
              const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
              ctx2d.quadraticCurveTo(p0.x, p0.y, mid.x, mid.y);
            }
            ctx2d.lineTo(nodes[points - 1].x, nodes[points - 1].y);
            ctx2d.strokeStyle = `hsla(${ring.hue}, 95%, 78%, 0.55)`;
            ctx2d.lineWidth = visualizerLineWidth;
            ctx2d.stroke();
          }
        } else {
          history = [];
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visualizerEnabled, visualizerRingCount, visualizerHue, visualizerLineWidth, visualizerTrail, visualizerSpiral, visualizerRingMode, visualizerTimeStep, visualizerTimeSkew, visualizerRingStep, visualizerAmplitude]);

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
        let decoded: AudioBuffer;
        if (sourceOverride) {
          decoded = sourceOverride.buffer;
        } else {
          const response = await fetch(`/api/projects/${project.id}/audio`);
          if (!response.ok) throw new Error('load failed');
          const arrayBuffer = await response.arrayBuffer();
          decoded = await ctx.decodeAudioData(arrayBuffer);
        }
        if (cancelled) return;
        decodedRef.current = decoded;
        setOriginalPeaks(computeWaveformPeaks(decoded, 300));
        setLoading(false);
        await renderProcessed(sourceOverride?.params || PP_DEFAULT_PARAMS);
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
  async function exportPresetsFile() {
    if (Object.keys(customPresets).length === 0 && Object.keys(postprocessPresets).length === 0) { notify('내보낼 저장된 프리셋이 없습니다.', true); return; }
    const payload = JSON.stringify({ eqPresets: customPresets, postprocessPresets }, null, 2);
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({ suggestedName: 'songyue2-presets.json', types: [{ description: 'SongYUE2 프리셋', accept: { 'application/json': ['.json'] } }] });
        const writable = await handle.createWritable();
        await writable.write(payload);
        await writable.close();
        notify(`"${handle.name}" 파일로 내보냈습니다.`);
        return;
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
      }
    }
    const blobUrl = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'songyue2-presets.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
    notify('프리셋 파일을 다운로드했습니다.');
  }
  async function handleImportPresetsFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    let parsed: { eqPresets?: Record<string, unknown>; postprocessPresets?: Record<string, unknown> };
    try { parsed = JSON.parse(await file.text()); } catch { notify('올바른 JSON 파일이 아닙니다.', true); return; }
    let eqImported = 0;
    let postprocessImported = 0;
    let skipped = 0;
    for (const [name, eq] of Object.entries(parsed.eqPresets || {})) {
      if (PP_EQ_PRESET_NAMES.includes(name) || !Array.isArray(eq) || eq.length !== 10 || !eq.every(value => typeof value === 'number' && Number.isFinite(value))) { skipped += 1; continue; }
      try {
        const saved = await api<{ name: string; eq: number[] }>('/eq-presets', 'POST', { name, eq });
        setCustomPresets(previous => ({ ...previous, [saved.name]: saved.eq }));
        eqImported += 1;
      } catch { skipped += 1; }
    }
    for (const [name, params] of Object.entries(parsed.postprocessPresets || {})) {
      if (!params || typeof params !== 'object' || Array.isArray(params)) { skipped += 1; continue; }
      try {
        const saved = await api<{ name: string; params: PostProcessParams }>('/postprocess-settings', 'POST', { name, params });
        setPostprocessPresets(previous => ({ ...previous, [saved.name]: saved.params }));
        postprocessImported += 1;
      } catch { skipped += 1; }
    }
    if (eqImported === 0 && postprocessImported === 0) { notify('가져올 프리셋을 찾지 못했습니다.', true); return; }
    notify(`EQ 프리셋 ${eqImported}개, 전체 설정 프리셋 ${postprocessImported}개를 가져왔습니다.${skipped ? ` (${skipped}개 건너뜀)` : ''}`);
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
  function seekTo(nextSeconds: number) {
    const track = activeTrack || 'original';
    const buffer = bufferFor(track);
    if (!buffer) return;
    const next = Math.max(0, Math.min(nextSeconds, Math.max(0, buffer.duration - 0.02)));
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
    if (onSaveOverride) { onSaveOverride(buffer, params); return; }
    setSaving(true);
    setErrorText('');
    try {
      await saveProcessedBuffer(project.id, project.title, buffer, notify);
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
      <DialogTitle>{titleOverride ? `후처리 / EQ — ${titleOverride}` : '후처리 / EQ'}</DialogTitle>
      <div className="pp-description-row">
        <DialogDescription>{onSaveOverride ? `"${titleOverride}" STEM에 EQ와 효과를 적용합니다. "저장"을 누르면 STEM 분리 화면으로 돌아가 이 상태가 반영됩니다.` : `"${project.title}"의 사본에 EQ와 효과를 적용한 뒤 원하는 위치에 저장하세요. 원본 파일은 바뀌지 않습니다.`}</DialogDescription>
        <div className="pp-settings-io">
          <select className="pp-preset-select" value={postprocessPreset} onChange={event => applyPostprocessPreset(event.target.value)} aria-label="전체 설정 프리셋">
            <option value="">전체 설정 불러오기</option>
            {Object.keys(postprocessPresets).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          <button type="button" className="pp-preset-btn" title="현재 전체 설정을 프리셋으로 저장" onClick={openSavePostprocessPresetDialog}><Save size={12}/></button>
          {postprocessPresets[postprocessPreset] && <button type="button" className="pp-preset-btn" title={`"${postprocessPreset}" 프리셋 삭제`} onClick={() => void deletePostprocessPreset(postprocessPreset)}><Trash2 size={12}/></button>}
          <button type="button" className="pp-preset-btn" title="저장한 프리셋을 파일로 내보내기" onClick={() => void exportPresetsFile()}><Download size={12}/></button>
          <button type="button" className="pp-preset-btn" title="파일에서 프리셋 가져오기" onClick={() => presetImportInputRef.current?.click()}><FolderOpen size={12}/></button>
          <input ref={presetImportInputRef} type="file" accept=".json,application/json" hidden onChange={event => void handleImportPresetsFile(event)}/>
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
              <Knob label="선명도" value={params.clarity} min={-100} max={100} onChange={value => updateParam('clarity', value)} variant="fx"/>
              <Knob label="공간감" value={params.spaciousness} min={0} max={100} onChange={value => updateParam('spaciousness', value)} variant="fx"/>
              <Knob label="서라운드 사운드" value={params.surround} min={-100} max={100} onChange={value => updateParam('surround', value)} variant="fx"/>
              <Knob label="다이내믹 부스트" value={params.dynamicBoost} min={0} max={100} onChange={value => updateParam('dynamicBoost', value)} variant="fx"/>
              <Knob label="베이스 부스트" value={params.bassBoost} min={-100} max={100} onChange={value => updateParam('bassBoost', value)} variant="fx"/>
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
        <div className="pp-seek-row">
          <span className="pp-seek-time">{formatSeekTime(positionSeconds)}</span>
          <input className="pp-seek-bar" type="range" aria-label="재생 위치" min={0} max={activeBuffer?.duration || 0} step={0.01} value={Math.min(positionSeconds, activeBuffer?.duration || 0)} onChange={event => seekTo(Number(event.target.value))} disabled={!activeBuffer}/>
          <span className="pp-seek-time">{formatSeekTime(activeBuffer?.duration || 0)}</span>
        </div>
        {errorText && <p className="field-hint warning">{errorText}</p>}
      </>}
      <div className="dialog-actions pp-dialog-actions">
        <div className="pp-transport">
          <Button variant="ghost" size="icon" aria-label="5초 뒤로" onClick={() => seekBy(-5)} disabled={loading}><Rewind size={15}/></Button>
          <Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={() => isPlaying ? pausePlayback() : playTrack(activeTrack || 'original')} disabled={loading}>{isPlaying ? <Pause size={15}/> : <Play size={15}/>}</Button>
          <Button variant="ghost" size="icon" aria-label="5초 앞으로" onClick={() => seekBy(5)} disabled={loading}><FastForward size={15}/></Button>
          <button type="button" className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed} disabled={loading}>{playbackRate}x</button>
          <Volume2 size={14} className="pp-volume-icon"/>
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

const STEM_MODE_CONFIG = {
  channel: { stems: ['left', 'right'] as const, menuSub: '왼쪽+오른쪽 채널', description: '왼쪽·오른쪽 채널 2갈래(AI 분리 모델 없이 순수 채널 분리)', dialogTitle: '채널 분리', failureHint: '채널 분리에 실패했습니다. ffmpeg가 설치되어 있는지, 원본이 스테레오인지 확인해 주세요.' },
  full: { stems: ['vocals', 'drums', 'bass', 'other'] as const, menuSub: '보컬+드럼+베이스+기타', description: '보컬·드럼·베이스·기타 악기 4갈래', dialogTitle: 'STEM 분리', failureHint: 'STEM 분리에 실패했습니다. audio.cpp가 해당 분리 모델을 포함해 빌드되어 있는지, 모델 파일이 있는지 확인해 주세요.' },
  vocal: { stems: ['vocals', 'instrumental'] as const, menuSub: '보컬+악기', description: '보컬·악기 2갈래(보컬 누출이 적은 분리 모델)', dialogTitle: 'STEM 분리', failureHint: 'STEM 분리에 실패했습니다. audio.cpp가 해당 분리 모델을 포함해 빌드되어 있는지, 모델 파일이 있는지 확인해 주세요.' },
};
type StemMode = keyof typeof STEM_MODE_CONFIG;
type StemName = typeof STEM_MODE_CONFIG[StemMode]['stems'][number];
const STEM_LABELS: Record<StemName, string> = { vocals: '보컬', drums: '드럼', bass: '베이스', other: '기타 악기', instrumental: '악기', left: '왼쪽 채널', right: '오른쪽 채널' };

function StemDialog({ project, mode, onClose, notify, visualizerEnabled, visualizerRingCount, visualizerHue, visualizerLineWidth, visualizerTrail, visualizerSpiral, visualizerRingMode, visualizerTimeStep, visualizerTimeSkew, visualizerRingStep, visualizerAmplitude }: { project: Project; mode: StemMode; onClose: () => void; notify: (text: string, error?: boolean) => void; visualizerEnabled: boolean; visualizerRingCount: number; visualizerHue: number; visualizerLineWidth: number; visualizerTrail: number; visualizerSpiral: number; visualizerRingMode: 'radial' | 'time'; visualizerTimeStep: number; visualizerTimeSkew: number; visualizerRingStep: number; visualizerAmplitude: number }) {
  const stemOrder = STEM_MODE_CONFIG[mode].stems as readonly StemName[];
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [merging, setMerging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [merged, setMerged] = useState(false);
  const [editingStem, setEditingStem] = useState<StemName | null>(null);
  const [audibleStems, setAudibleStems] = useState<Set<StemName>>(() => new Set(stemOrder));
  const [stemPeaks, setStemPeaks] = useState<Partial<Record<StemName, number[]>>>({});
  const [processedStems, setProcessedStems] = useState<Partial<Record<StemName, boolean>>>({});
  const [combinedPeaks, setCombinedPeaks] = useState<number[]>([]);
  const [previewPeaks, setPreviewPeaks] = useState<number[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewVolume, setPreviewVolume] = useState(1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewGainRef = useRef<GainNode | null>(null);
  const currentBuffersRef = useRef<Partial<Record<StemName, AudioBuffer>>>({});
  const stemParamsRef = useRef<Partial<Record<StemName, PostProcessParams>>>({});
  const combinedOriginalRef = useRef<AudioBuffer | null>(null);
  const combinedPreviewRef = useRef<AudioBuffer | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rateRef = useRef(1);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  function bufferForKey(key: string | null): AudioBuffer | null {
    if (!key) return null;
    if (key === 'combined-original') return combinedOriginalRef.current;
    if (key === 'combined-preview') return combinedPreviewRef.current;
    return currentBuffersRef.current[key as StemName] || null;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api(`/projects/${project.id}/stems`, 'POST', { mode });
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const gainNode = ctx.createGain();
        gainNode.gain.value = previewVolume;
        gainNode.connect(ctx.destination);
        previewGainRef.current = gainNode;
        const peaks: Partial<Record<StemName, number[]>> = {};
        for (const name of stemOrder) {
          const response = await fetch(`/api/projects/${project.id}/stems/${name}`);
          if (!response.ok) throw new Error('load failed');
          const arrayBuffer = await response.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arrayBuffer);
          currentBuffersRef.current[name] = decoded;
          peaks[name] = computeWaveformPeaks(decoded, 160);
        }
        if (cancelled) return;
        setStemPeaks(peaks);
        const combined = await mixBuffers(stemOrder.map(name => currentBuffersRef.current[name]!));
        if (cancelled) return;
        combinedOriginalRef.current = combined;
        combinedPreviewRef.current = combined;
        setCombinedPeaks(computeWaveformPeaks(combined, 300));
        setPreviewPeaks(computeWaveformPeaks(combined, 300));
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error && error.message && error.message !== 'load failed' ? error.message : STEM_MODE_CONFIG[mode].failureHint;
        setErrorText(message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      void api(`/projects/${project.id}/stems`, 'DELETE').catch(() => {});
      void audioCtxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, mode]);

  async function refreshPreview() {
    const included = stemOrder.filter(name => audibleStems.has(name));
    const buffers = included.map(name => currentBuffersRef.current[name]).filter((buffer): buffer is AudioBuffer => !!buffer);
    if (buffers.length !== included.length) return;
    if (!buffers.length) { combinedPreviewRef.current = null; setPreviewPeaks([]); return; }
    const combined = await mixBuffers(buffers);
    combinedPreviewRef.current = combined;
    setPreviewPeaks(computeWaveformPeaks(combined, 300));
  }
  // STEM4(보컬/드럼/베이스/기타)에서 체크박스로 어떤 트랙을 들을지/저장할지 고를 수 있게 한다 --
  // 체크 해제된 트랙은 "미리듣기"(및 그걸 그대로 쓰는 "저장")에서만 빠지고, "원본"은 항상 4개 전부를
  // 담은 고정 기준선으로 남긴다(다른 STEM 편집과 같은 "원본 vs 미리듣기" 비교 관례를 그대로 따름).
  useEffect(() => {
    if (mode !== 'full' || loading) return;
    void (async () => {
      await refreshPreview();
      setMerged(false);
      if (isPlayingRef.current && activeKey === 'combined-preview') playKey('combined-preview', currentPosition());
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audibleStems]);
  function toggleStemAudible(name: StemName) {
    setAudibleStems(previous => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function handleStemSaved(name: StemName, buffer: AudioBuffer, params: PostProcessParams) {
    currentBuffersRef.current[name] = buffer;
    stemParamsRef.current[name] = params;
    setProcessedStems(previous => ({ ...previous, [name]: true }));
    setStemPeaks(previous => ({ ...previous, [name]: computeWaveformPeaks(buffer, 160) }));
    setEditingStem(null);
    setMerged(false);
    void refreshPreview();
  }

  function pausePlayback() {
    if (isPlaying) playOffsetRef.current = currentPosition();
    currentSourceRef.current?.stop();
    currentSourceRef.current = null;
    setIsPlaying(false);
  }
  function currentPosition(): number {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return playOffsetRef.current;
    return playOffsetRef.current + (ctx.currentTime - playStartCtxTimeRef.current) * rateRef.current;
  }
  function playKey(key: string, atPosition?: number) {
    const ctx = audioCtxRef.current;
    const buffer = bufferForKey(key);
    if (!ctx || !buffer) return;
    // A suspended context (created after an await) stays silent until resumed from a
    // user gesture. Every play click is such a gesture, so resume before starting.
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
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
    setActiveKey(key);
    setIsPlaying(true);
  }
  function handleKeyClick(key: string) {
    if (activeKey === key && isPlaying) { pausePlayback(); return; }
    playKey(key);
  }
  // "원본"/"미리듣기" 둘 다 4트랙 전체를 듣는 자리라, STEM4에서 여기를 누르면 체크박스도
  // "전부 켜짐"으로 되돌려서 지금 듣고 있는 것(전체 믹스)과 화면 상태가 어긋나지 않게 한다.
  function handleCombinedRowClick(key: string) {
    if (mode === 'full') setAudibleStems(new Set(stemOrder));
    handleKeyClick(key);
  }
  function stopPlayback() { pausePlayback(); setActiveKey(null); setPositionSeconds(0); }
  function seekBy(deltaSeconds: number) {
    const key = activeKey || 'combined-original';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(currentPosition() + deltaSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function seekTo(nextSeconds: number) {
    const key = activeKey || 'combined-original';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(nextSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function cycleSpeed() {
    const next = playbackRate >= 2 ? 1 : 2;
    const pos = currentPosition();
    setPlaybackRate(next);
    rateRef.current = next;
    if (isPlaying && activeKey) { playKey(activeKey, pos); return; }
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
    const tick = () => { setPositionSeconds(currentPosition()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  async function handleMerge() {
    setMerging(true);
    try { await refreshPreview(); setMerged(true); }
    catch { setErrorText('오디오를 합치지 못했습니다.'); }
    finally { setMerging(false); }
  }
  async function handleSave() {
    const buffer = combinedPreviewRef.current;
    if (!buffer) return;
    setSaving(true);
    try {
      stopPlayback();
      await saveProcessedBuffer(project.id, project.title, buffer, notify);
      onClose();
    } catch (error) { setErrorText((error as Error).message); }
    finally { setSaving(false); }
  }

  const activeBuffer = bufferForKey(activeKey);
  const playedFraction = activeBuffer ? Math.min(1, positionSeconds / activeBuffer.duration) : 0;
  const rowClass = (key: string, kind: 'dry' | 'wet', base: string) => `${base}${activeKey === key && isPlaying ? (kind === 'wet' ? ' pp-row-playing-processed' : ' pp-row-playing-original') : ''}`;

  return <>
    {!editingStem && <Dialog open onOpenChange={open => { if (!open) { stopPlayback(); onClose(); } }}>
      <DialogContent className="studio-dialog stem-dialog">
        <DialogTitle>{STEM_MODE_CONFIG[mode].dialogTitle} ({STEM_MODE_CONFIG[mode].menuSub})</DialogTitle>
        <DialogDescription>"{project.title}"을(를) {STEM_MODE_CONFIG[mode].description}로 분리했습니다. 각 트랙을 후처리한 뒤 합쳐서 저장하세요.</DialogDescription>
        {loading ? <div className="stem-loading"><LoaderCircle className="spin"/>{STEM_MODE_CONFIG[mode].dialogTitle} 중...</div> : errorText ? <p className="field-hint warning">{errorText}</p> : <>
          <div className="stem-list">
            {stemOrder.map(name => <div key={name} className={rowClass(name, processedStems[name] ? 'wet' : 'dry', 'stem-row')}>
              {mode === 'full'
                ? <label className="stem-audible-checkbox" title={audibleStems.has(name) ? `${STEM_LABELS[name]} 끄기` : `${STEM_LABELS[name]} 켜기`}><input type="checkbox" checked={audibleStems.has(name)} onChange={() => toggleStemAudible(name)}/></label>
                : <button type="button" className="pp-waveform-label" aria-label={activeKey === name && isPlaying ? `${STEM_LABELS[name]} 일시정지` : `${STEM_LABELS[name]} 재생`} onClick={() => handleKeyClick(name)}>{activeKey === name && isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>}
              <span className="stem-label">{STEM_LABELS[name]}{processedStems[name] && <span className="small-badge">처리됨</span>}</span>
              <Waveform peaks={stemPeaks[name] || []} playedFraction={playedFraction} variant={processedStems[name] ? 'processed' : undefined}/>
              <Button variant="outline" size="sm" onClick={() => setEditingStem(name)}><SlidersHorizontal size={14}/>후처리</Button>
            </div>)}
          </div>
          <div className="stem-combined">
            <div className={rowClass('combined-original', 'dry', 'pp-waveform-row')}>
              <button type="button" className="pp-waveform-label" title="원본 합본" aria-label={activeKey === 'combined-original' && isPlaying ? '원본 합본 일시정지' : '원본 합본 재생'} onClick={() => handleCombinedRowClick('combined-original')}>{activeKey === 'combined-original' && isPlaying ? <Pause size={15}/> : <AudioLines size={15}/>}</button>
              <Waveform peaks={combinedPeaks} playedFraction={playedFraction}/>
            </div>
            <div className={rowClass('combined-preview', 'wet', 'pp-waveform-row')}>
              <button type="button" className="pp-waveform-label" title="현재 미리듣기" aria-label={activeKey === 'combined-preview' && isPlaying ? '미리듣기 일시정지' : '미리듣기 재생'} onClick={() => handleCombinedRowClick('combined-preview')}>{activeKey === 'combined-preview' && isPlaying ? <Pause size={15}/> : <Combine size={15}/>}</button>
              <Waveform peaks={previewPeaks} playedFraction={playedFraction} variant="processed"/>
            </div>
          </div>
          <div className="pp-seek-row">
            <span className="pp-seek-time">{formatSeekTime(positionSeconds)}</span>
            <input className="pp-seek-bar" type="range" aria-label="재생 위치" min={0} max={activeBuffer?.duration || 0} step={0.01} value={Math.min(positionSeconds, activeBuffer?.duration || 0)} onChange={event => seekTo(Number(event.target.value))} disabled={!activeBuffer}/>
            <span className="pp-seek-time">{formatSeekTime(activeBuffer?.duration || 0)}</span>
          </div>
        </>}
        {errorText && !loading && <p className="field-hint warning">{errorText}</p>}
        <div className="dialog-actions pp-dialog-actions">
          <div className="pp-transport">
            <Button variant="ghost" size="icon" aria-label="5초 뒤로" onClick={() => seekBy(-5)} disabled={loading}><Rewind size={15}/></Button>
            <Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={() => handleKeyClick(activeKey || (mode === 'full' ? 'combined-preview' : 'combined-original'))} disabled={loading}>{isPlaying ? <Pause size={15}/> : <Play size={15}/>}</Button>
            <Button variant="ghost" size="icon" aria-label="5초 앞으로" onClick={() => seekBy(5)} disabled={loading}><FastForward size={15}/></Button>
            <button type="button" className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed} disabled={loading}>{playbackRate}x</button>
            <Volume2 size={14} className="pp-volume-icon"/>
            <input className="abc-player-volume" type="range" aria-label="미리듣기 볼륨" min={0} max={2} step={0.1} value={previewVolume} onChange={event => applyPreviewVolume(Number(event.target.value))} disabled={loading}/>
          </div>
          <div className="pp-dialog-actions-right">
            <Button variant="outline" onClick={() => { stopPlayback(); onClose(); }} disabled={saving}>취소</Button>
            <Button onClick={() => void handleMerge()} disabled={loading || !!errorText || merging || (mode === 'full' && audibleStems.size === 0)}>{merging ? <LoaderCircle className="spin"/> : <Combine size={15}/>}합치기</Button>
            <Button onClick={() => void handleSave()} disabled={!merged || saving}>{saving ? <LoaderCircle className="spin"/> : <Save size={15}/>}저장</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>}
    {editingStem && <PostProcessDialog
      key={editingStem}
      project={project}
      onClose={() => setEditingStem(null)}
      notify={notify}
      visualizerEnabled={visualizerEnabled} visualizerRingCount={visualizerRingCount} visualizerHue={visualizerHue} visualizerLineWidth={visualizerLineWidth} visualizerTrail={visualizerTrail} visualizerSpiral={visualizerSpiral} visualizerRingMode={visualizerRingMode} visualizerTimeStep={visualizerTimeStep} visualizerTimeSkew={visualizerTimeSkew} visualizerRingStep={visualizerRingStep} visualizerAmplitude={visualizerAmplitude}
      titleOverride={STEM_LABELS[editingStem]}
      sourceOverride={{ buffer: currentBuffersRef.current[editingStem]!, params: stemParamsRef.current[editingStem] || PP_DEFAULT_PARAMS }}
      onSaveOverride={(buffer, params) => handleStemSaved(editingStem, buffer, params)}
    />}
  </>;
}

type MidiNote = { id: number; pitch: number; start: number; end: number; instrument: string };
const MIDI_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiPitchName(pitch: number) { return `${MIDI_NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`; }
const MIDI_INSTRUMENT_OPTIONS: { id: string; label: string }[] = [
  { id: 'acoustic_piano', label: '어쿠스틱 피아노' }, { id: 'electric_piano', label: '일렉트릭 피아노' },
  { id: 'acoustic_guitar', label: '어쿠스틱 기타' }, { id: 'electric_guitar', label: '일렉트릭 기타' },
  { id: 'electric_bass', label: '베이스' }, { id: 'violin', label: '바이올린' }, { id: 'cello', label: '첼로' },
  { id: 'strings', label: '스트링 앙상블' }, { id: 'trumpet', label: '트럼펫' }, { id: 'sax', label: '색소폰' },
  { id: 'flute', label: '플루트' }, { id: 'organ', label: '오르간' }, { id: 'synth_lead', label: '신스 리드' },
  { id: 'synth_pad', label: '신스 패드' }, { id: 'voice', label: '보컬' }, { id: 'drums', label: '드럼' },
];
const MIDI_INSTRUMENT_LABELS: Record<string, string> = Object.fromEntries(MIDI_INSTRUMENT_OPTIONS.map(option => [option.id, option.label]));
// MuScriptor can tag notes with instrument names outside our fixed MIDI_INSTRUMENT_COLORS palette
// (e.g. "clarinet", "tenor_sax") -- falling back to one flat color for all of them would make the
// legend useless, so unknown instruments get a stable hash-derived hue instead of a shared default.
function midiInstrumentColor(instrument: string): string {
  const known = MIDI_INSTRUMENT_COLORS[instrument];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < instrument.length; i++) hash = (hash * 31 + instrument.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 55%, 62%)`;
}
const MIDI_INSTRUMENT_COLORS: Record<string, string> = {
  acoustic_piano: '#7fb069', electric_piano: '#6fa8dc', acoustic_guitar: '#e0a458', electric_guitar: '#e0665e',
  electric_bass: '#a37ee0', violin: '#e0c458', cello: '#d18ec9', strings: '#8ecdd1', trumpet: '#e08e4b',
  sax: '#c9a3e0', flute: '#8ce08c', organ: '#e0d58e', synth_lead: '#5ee0c8', synth_pad: '#8ea3e0',
  voice: '#e08eae', drums: '#b0b0b0',
};
const MIDI_PX_PER_SECOND_DEFAULT = 90;
const MIDI_ZOOM_MIN = 40;
const MIDI_ZOOM_MAX = 300;
const MIDI_MIN_HIT_WIDTH = 12;
const MIDI_MUTED_COLOR = '#565f56';
const MIDI_ROW_HEIGHT_DEFAULT = 13;
const MIDI_ROW_ZOOM_MIN = 6;
const MIDI_ROW_ZOOM_MAX = 30;
const MIDI_MIN_NOTE_SECONDS = 0.08;
const MIDI_NEW_NOTE_SECONDS = 0.5;
const MIDI_SNAP_SECONDS = 1 / 16;
function midiSnap(seconds: number) { return Math.round(seconds / MIDI_SNAP_SECONDS) * MIDI_SNAP_SECONDS; }
function midiPitchToFrequency(pitch: number) { return 440 * Math.pow(2, (pitch - 69) / 12); }
const MIDI_INSTRUMENT_WAVEFORMS: Record<string, OscillatorType> = {
  acoustic_piano: 'triangle', electric_piano: 'triangle', acoustic_guitar: 'sawtooth', electric_guitar: 'sawtooth',
  electric_bass: 'sine', violin: 'sawtooth', cello: 'sawtooth', strings: 'sawtooth', trumpet: 'square', sax: 'square',
  flute: 'sine', organ: 'square', synth_lead: 'sawtooth', synth_pad: 'triangle', voice: 'sine', drums: 'square',
};

function MidiEditorDialog({ project, onClose, notify }: { project: Project; onClose: () => void; notify: (text: string, error?: boolean) => void }) {
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<MidiNote[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [newNoteInstrument, setNewNoteInstrument] = useState('acoustic_piano');
  const [pxPerSecond, setPxPerSecond] = useState(MIDI_PX_PER_SECOND_DEFAULT);
  const [rowHeight, setRowHeight] = useState(MIDI_ROW_HEIGHT_DEFAULT);
  const [mutedInstruments, setMutedInstruments] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [midiSaveDialogOpen, setMidiSaveDialogOpen] = useState(false);
  const [midiSaveFolder, setMidiSaveFolder] = useState(DEFAULT_MIDI_PATH);
  const [midiSaveFilename, setMidiSaveFilename] = useState('');
  const [midiSaving, setMidiSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const nextIdRef = useRef(0);
  const rollScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollLeftRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: number; mode: 'move' | 'resize-left' | 'resize-right'; startClientX: number; startClientY: number; startStart: number; startEnd: number; startPitch: number } | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeNodesRef = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);
  const instrumentGainsRef = useRef<Map<string, GainNode>>(new Map());
  const playStartCtxTimeRef = useRef(0);
  const playRafRef = useRef<number | null>(null);
  const playEndTimerRef = useRef<number | null>(null);

  function stopPlayback(resetPosition = true) {
    const ctx = audioCtxRef.current;
    for (const { osc, gain } of activeNodesRef.current) {
      try {
        if (ctx) { gain.gain.cancelScheduledValues(ctx.currentTime); gain.gain.setValueAtTime(0, ctx.currentTime); }
        osc.stop();
      } catch { /* already stopped */ }
    }
    activeNodesRef.current = [];
    if (playRafRef.current !== null) cancelAnimationFrame(playRafRef.current);
    if (playEndTimerRef.current !== null) window.clearTimeout(playEndTimerRef.current);
    playRafRef.current = null;
    playEndTimerRef.current = null;
    setIsPlaying(false);
    if (resetPosition) setPlayheadSeconds(0);
  }
  const previewDuration = notes.length ? Math.max(0.5, ...notes.map(note => note.end)) : 0;
  function playPreview(startOffset = 0) {
    if (!notes.length) return;
    stopPlayback(false);
    const ctx = audioCtxRef.current || new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === 'suspended') void ctx.resume();
    const startCtxTime = ctx.currentTime + 0.06;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.22;
    masterGain.connect(ctx.destination);
    // Every note is scheduled regardless of current mute state -- muting only sets that instrument's
    // shared gain to 0, never removes the oscillator. That's what lets toggling mute mid-playback take
    // effect immediately on already-scheduled/sounding notes instead of only future playPreview() calls.
    instrumentGainsRef.current = new Map();
    function instrumentGainFor(instrument: string): GainNode {
      let node = instrumentGainsRef.current.get(instrument);
      if (!node) {
        node = ctx.createGain();
        node.gain.value = mutedInstruments.has(instrument) ? 0 : 1;
        node.connect(masterGain);
        instrumentGainsRef.current.set(instrument, node);
      }
      return node;
    }
    const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
    for (const note of notes) {
      if (note.end <= startOffset) continue;
      const effectiveStart = Math.max(note.start, startOffset);
      const duration = Math.max(0.05, note.end - effectiveStart);
      const noteStart = startCtxTime + (effectiveStart - startOffset);
      const noteEnd = noteStart + duration;
      const attack = Math.min(0.02, duration / 4);
      const release = Math.min(0.08, duration / 3);
      const osc = ctx.createOscillator();
      osc.type = MIDI_INSTRUMENT_WAVEFORMS[note.instrument] || 'triangle';
      osc.frequency.value = midiPitchToFrequency(note.pitch);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(0.9, noteStart + attack);
      gain.gain.setValueAtTime(0.9, Math.max(noteStart + attack, noteEnd - release));
      gain.gain.linearRampToValueAtTime(0, noteEnd);
      osc.connect(gain);
      gain.connect(instrumentGainFor(note.instrument));
      osc.start(noteStart);
      osc.stop(noteEnd + 0.02);
      nodes.push({ osc, gain });
    }
    activeNodesRef.current = nodes;
    playStartCtxTimeRef.current = startCtxTime;
    setIsPlaying(true);
    setPlayheadSeconds(startOffset);
    const totalSeconds = previewDuration - startOffset + 0.2;
    playEndTimerRef.current = window.setTimeout(() => stopPlayback(), Math.max(0, totalSeconds) * 1000);
    const tick = () => {
      const current = audioCtxRef.current;
      if (!current) return;
      setPlayheadSeconds(startOffset + Math.max(0, current.currentTime - startCtxTime));
      playRafRef.current = requestAnimationFrame(tick);
    };
    playRafRef.current = requestAnimationFrame(tick);
  }
  function seekPreview(seconds: number) {
    const next = Math.max(0, Math.min(seconds, previewDuration));
    if (isPlaying) { playPreview(next); return; }
    setPlayheadSeconds(next);
  }
  // Applied straight to the live per-instrument gain nodes so toggling mute takes effect immediately
  // on whatever's already scheduled/sounding, not just on the next playPreview() call.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    for (const [instrument, node] of instrumentGainsRef.current) {
      const target = mutedInstruments.has(instrument) ? 0 : 1;
      node.gain.cancelScheduledValues(ctx.currentTime);
      node.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.03);
    }
  }, [mutedInstruments]);
  useEffect(() => () => stopPlayback(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api<{ notes: MidiNote[] }>(`/projects/${project.id}/midi/notes`);
        if (cancelled) return;
        setNotes(response.notes);
        nextIdRef.current = response.notes.reduce((max, note) => Math.max(max, note.id + 1), 0);
        if (response.notes.length) {
          const counts = new Map<string, number>();
          for (const note of response.notes) counts.set(note.instrument, (counts.get(note.instrument) || 0) + 1);
          setNewNoteInstrument([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
        }
        setLoading(false);
      } catch (error) {
        if (cancelled) return;
        setErrorText((error as Error).message || 'MIDI 노트를 불러오지 못했습니다.');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [project.id]);

  const usedInstruments = [...new Set(notes.map(note => note.instrument))];
  const minPitch = notes.length ? Math.max(0, Math.min(...notes.map(n => n.pitch)) - 2) : 48;
  const maxPitch = notes.length ? Math.min(127, Math.max(...notes.map(n => n.pitch)) + 2) : 84;
  const durationSeconds = Math.max(10, ...notes.map(n => n.end + 2));
  const rollWidth = durationSeconds * pxPerSecond;
  const rollHeight = (maxPitch - minPitch + 1) * rowHeight;
  const rowY = (pitch: number) => (maxPitch - pitch) * rowHeight;

  function updateNote(id: number, patch: Partial<MidiNote>) {
    setNotes(previous => previous.map(note => note.id === id ? { ...note, ...patch } : note));
  }
  function deleteSelected() {
    if (selectedId === null) return;
    stopPlayback();
    setNotes(previous => previous.filter(note => note.id !== selectedId));
    setSelectedId(null);
  }
  function toggleInstrumentMuted(instrument: string) {
    const willMute = !mutedInstruments.has(instrument);
    setMutedInstruments(previous => {
      const next = new Set(previous);
      if (willMute) next.add(instrument); else next.delete(instrument);
      return next;
    });
    if (willMute && selectedId !== null) {
      const selectedNote = notes.find(note => note.id === selectedId);
      if (selectedNote && selectedNote.instrument === instrument) setSelectedId(null);
    }
  }
  function addNoteAt(seconds: number, pitch: number) {
    stopPlayback();
    const start = Math.max(0, midiSnap(seconds));
    const id = nextIdRef.current++;
    const note: MidiNote = { id, pitch: Math.max(0, Math.min(127, pitch)), start, end: start + MIDI_NEW_NOTE_SECONDS, instrument: newNoteInstrument };
    setNotes(previous => [...previous, note]);
    setSelectedId(id);
  }
  function onBackgroundPointerDown(event: React.PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const seconds = (event.clientX - rect.left) / pxPerSecond;
    const pitch = maxPitch - Math.floor((event.clientY - rect.top) / rowHeight);
    addNoteAt(seconds, pitch);
  }
  // React's onWheel prop is attached as a passive listener, so event.preventDefault() inside it
  // silently fails (and logs a console warning) -- the roll would scroll AND zoom at once. Attaching
  // a plain DOM listener with {passive:false} is the only way to actually suppress the native scroll.
  // Plain wheel zooms time (X); Shift+wheel zooms pitch-row height (Y) -- kept on a separate modifier
  // so one doesn't fight the other, matching how piano-roll editors usually split the two axes.
  useEffect(() => {
    const el = rollScrollRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      if (event.shiftKey) {
        const cursorOffsetInContent = el.scrollTop + (event.clientY - rect.top);
        setRowHeight(previous => {
          const next = Math.max(MIDI_ROW_ZOOM_MIN, Math.min(MIDI_ROW_ZOOM_MAX, previous - Math.round(event.deltaY / 20)));
          if (next !== previous) {
            const pitchRowAtCursor = cursorOffsetInContent / previous;
            pendingScrollTopRef.current = pitchRowAtCursor * next - (event.clientY - rect.top);
          }
          return next;
        });
        return;
      }
      const cursorOffsetInContent = el.scrollLeft + (event.clientX - rect.left);
      setPxPerSecond(previous => {
        const next = Math.max(MIDI_ZOOM_MIN, Math.min(MIDI_ZOOM_MAX, previous - Math.round(event.deltaY / 4)));
        if (next !== previous) {
          const timeAtCursor = cursorOffsetInContent / previous;
          pendingScrollLeftRef.current = timeAtCursor * next - (event.clientX - rect.left);
        }
        return next;
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [loading, errorText]);
  // Runs synchronously after the SVG's new size is committed to the DOM but before paint, so the
  // scroll jump that keeps the cursor's time/pitch position fixed never flashes on screen.
  useLayoutEffect(() => {
    if (pendingScrollLeftRef.current === null || !rollScrollRef.current) return;
    rollScrollRef.current.scrollLeft = Math.max(0, pendingScrollLeftRef.current);
    pendingScrollLeftRef.current = null;
  }, [pxPerSecond]);
  useLayoutEffect(() => {
    if (pendingScrollTopRef.current === null || !rollScrollRef.current) return;
    rollScrollRef.current.scrollTop = Math.max(0, pendingScrollTopRef.current);
    pendingScrollTopRef.current = null;
  }, [rowHeight]);
  function onNotePointerDown(event: React.PointerEvent<SVGRectElement>, note: MidiNote, mode: 'move' | 'resize-left' | 'resize-right') {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    stopPlayback();
    setSelectedId(note.id);
    dragRef.current = { id: note.id, mode, startClientX: event.clientX, startClientY: event.clientY, startStart: note.start, startEnd: note.end, startPitch: note.pitch };
  }
  function onNotePointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaSeconds = (event.clientX - drag.startClientX) / pxPerSecond;
    if (drag.mode === 'move') {
      const deltaPitch = -Math.round((event.clientY - drag.startClientY) / rowHeight);
      const duration = drag.startEnd - drag.startStart;
      const start = Math.max(0, midiSnap(drag.startStart + deltaSeconds));
      updateNote(drag.id, { start, end: start + duration, pitch: Math.max(0, Math.min(127, drag.startPitch + deltaPitch)) });
    } else if (drag.mode === 'resize-left') {
      const start = Math.max(0, Math.min(drag.startEnd - MIDI_MIN_NOTE_SECONDS, midiSnap(drag.startStart + deltaSeconds)));
      updateNote(drag.id, { start });
    } else {
      const end = Math.max(drag.startStart + MIDI_MIN_NOTE_SECONDS, midiSnap(drag.startEnd + deltaSeconds));
      updateNote(drag.id, { end });
    }
  }
  function onNotePointerUp() { dragRef.current = null; }

  async function save() {
    setSaving(true);
    try {
      await api(`/projects/${project.id}/midi`, 'POST', { notes: notes.map(({ pitch, start, end, instrument }) => ({ pitch, start, end, instrument })) });
      notify('MIDI를 저장했습니다.');
      stopPlayback();
      onClose();
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }
  async function downloadViaPicker() {
    setDownloading(true);
    try {
      // Renders whatever's on screen right now (possibly unsaved edits), independent of "저장" --
      // download and save are separate actions so either can be used without the other.
      const response = await fetch(`/api/projects/${project.id}/midi/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: notes.map(({ pitch, start, end, instrument }) => ({ pitch, start, end, instrument })) }) });
      if (!response.ok) throw new Error('MIDI 파일을 생성하지 못했습니다.');
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const suggestedName = match ? decodeURIComponent(match[1]) : `${project.title}.mid`;
      const blob = await response.blob();
      const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn }).showSaveFilePicker;
      if (typeof picker === 'function') {
        const handle = await picker({ suggestedName, types: [{ description: 'MIDI 파일', accept: { 'audio/midi': ['.mid'] } }] });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        notify(`"${handle.name}" 파일로 저장했습니다.`);
      } else {
        openMidiSaveDialog();
      }
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return;
      notify('탐색기로 저장하지 못했습니다. 다른 방법으로 저장해 주세요.', true);
      openMidiSaveDialog();
    } finally {
      setDownloading(false);
    }
  }
  function openMidiSaveDialog() {
    setMidiSaveFolder(DEFAULT_MIDI_PATH);
    setMidiSaveFilename(project.title.trim() || 'midi');
    setMidiSaveDialogOpen(true);
  }
  async function confirmMidiSave() {
    setMidiSaving(true);
    try {
      const result = await api<{ filename: string }>(`/projects/${project.id}/midi/save-to-folder`, 'POST', { folder: midiSaveFolder, filename: midiSaveFilename, notes: notes.map(({ pitch, start, end, instrument }) => ({ pitch, start, end, instrument })) });
      setMidiSaveDialogOpen(false);
      notify(`"${result.filename}" 파일로 저장했습니다.`);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setMidiSaving(false);
    }
  }
  function closeDialog() {
    stopPlayback();
    onClose();
  }

  const octavePitches: number[] = [];
  for (let pitch = minPitch; pitch <= maxPitch; pitch++) if (pitch % 12 === 0) octavePitches.push(pitch);
  const beatLines: number[] = [];
  for (let second = 0; second <= durationSeconds; second++) beatLines.push(second);

  return <>
    <Dialog open onOpenChange={open => { if (!open) closeDialog(); }}>
    <DialogContent className="studio-dialog detail-dialog midi-editor-dialog">
      <DialogTitle>{project.title} · MIDI 편집기</DialogTitle>
      <DialogDescription>MuScriptor가 추출한 음표를 확인하고, 옮기거나 늘이거나 지우거나 추가후 저장. (빈 공간을 클릭하면 새 음표 추가 · 몸통을 끌면 이동, 가장자리를 끌면 길이 조절, 마우스 휠로 줌인/줌아웃 (X) (shift+마우스 휠 (Y)))</DialogDescription>
      {loading ? <div className="midi-editor-loading"><LoaderCircle className="spin"/>음표를 불러오는 중…</div>
      : errorText ? <div className="inline-note warning"><CircleHelp size={17}/><span>{errorText}</span></div>
      : <>
        <div className="midi-editor-toolbar">
          <div className="midi-editor-legend">
            {usedInstruments.map(id => {
              const muted = mutedInstruments.has(id);
              return <button key={id} type="button" className={`midi-editor-legend-item${muted ? ' muted' : ''}`} onClick={() => toggleInstrumentMuted(id)} title={muted ? `${MIDI_INSTRUMENT_LABELS[id] || id} 켜기` : `${MIDI_INSTRUMENT_LABELS[id] || id} 끄기`}>
                <i className="midi-editor-legend-swatch" style={{ background: muted ? MIDI_MUTED_COLOR : midiInstrumentColor(id) }}/>{MIDI_INSTRUMENT_LABELS[id] || id}
              </button>;
            })}
          </div>
          <div className="midi-editor-toolbar-right">
            <label>새 음표 악기
              <select value={newNoteInstrument} onChange={event => setNewNoteInstrument(event.target.value)}>
                {MIDI_INSTRUMENT_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="dialog-scroll midi-roll-scroll" ref={rollScrollRef}>
          <svg className="midi-roll-svg" width={rollWidth} height={rollHeight} onPointerMove={onNotePointerMove} onPointerUp={onNotePointerUp}>
            <rect className="midi-roll-bg" x={0} y={0} width={rollWidth} height={rollHeight} onPointerDown={onBackgroundPointerDown}/>
            {octavePitches.map(pitch => <g key={pitch}>
              <line className="midi-roll-octave-line" x1={0} y1={rowY(pitch) + rowHeight} x2={rollWidth} y2={rowY(pitch) + rowHeight}/>
              <text className="midi-roll-pitch-label" x={3} y={rowY(pitch) + rowHeight - 3}>{midiPitchName(pitch)}</text>
            </g>)}
            {beatLines.map(second => <line key={second} className="midi-roll-beat-line" x1={second * pxPerSecond} y1={0} x2={second * pxPerSecond} y2={rollHeight}/>)}
            {notes.map(note => {
              const muted = mutedInstruments.has(note.instrument);
              const x = note.start * pxPerSecond;
              const width = Math.max(4, (note.end - note.start) * pxPerSecond);
              const y = rowY(note.pitch);
              const hitWidth = Math.max(width, MIDI_MIN_HIT_WIDTH);
              const hitX = x - (hitWidth - width) / 2;
              const handleWidth = Math.min(6, hitWidth / 3);
              return <g key={note.id}>
                <rect className={`midi-note${selectedId === note.id ? ' selected' : ''}${muted ? ' muted' : ''}`} x={x} y={y + 1} width={width} height={rowHeight - 2} rx={2} style={{ fill: muted ? MIDI_MUTED_COLOR : midiInstrumentColor(note.instrument) }} pointerEvents="none"/>
                {!muted && <>
                  <rect className="midi-note-hit" x={hitX} y={y + 1} width={hitWidth} height={rowHeight - 2} onPointerDown={event => onNotePointerDown(event, note, 'move')}/>
                  <rect className="midi-note-handle" x={hitX} y={y + 1} width={handleWidth} height={rowHeight - 2} onPointerDown={event => onNotePointerDown(event, note, 'resize-left')}/>
                  <rect className="midi-note-handle" x={hitX + hitWidth - handleWidth} y={y + 1} width={handleWidth} height={rowHeight - 2} onPointerDown={event => onNotePointerDown(event, note, 'resize-right')}/>
                </>}
              </g>;
            })}
            {isPlaying && <line className="midi-roll-playhead" x1={playheadSeconds * pxPerSecond} y1={0} x2={playheadSeconds * pxPerSecond} y2={rollHeight}/>}
          </svg>
        </div>
        {!notes.length && <p className="midi-editor-empty-hint">추출된 음표가 없어요. 빈 공간을 클릭해 새 음표를 추가할 수 있어요.</p>}
        {!!notes.length && <div className="pp-seek-row">
          <span className="pp-seek-time">{formatSeekTime(playheadSeconds)}</span>
          <input className="pp-seek-bar" type="range" aria-label="미리듣기 위치" min={0} max={previewDuration} step={0.01} value={Math.min(playheadSeconds, previewDuration)} onChange={event => seekPreview(Number(event.target.value))}/>
          <span className="pp-seek-time">{formatSeekTime(previewDuration)}</span>
        </div>}
      </>}
      <div className="dialog-actions pp-dialog-actions">
        <div className="midi-editor-actions-left">
          <Button variant="outline" size="sm" onClick={() => isPlaying ? stopPlayback() : playPreview(playheadSeconds)} disabled={!notes.length}>{isPlaying ? <><Square size={13}/>정지</> : <><Play size={13}/>미리듣기</>}</Button>
          <Button variant="outline" size="sm" onClick={deleteSelected} disabled={selectedId === null}><Trash2 size={13}/>삭제하기</Button>
        </div>
        <div className="pp-dialog-actions-right">
          <Button variant="outline" onClick={closeDialog} disabled={saving}>취소</Button>
          <Button onClick={() => void save()} disabled={saving || loading || !!errorText}>{saving ? <LoaderCircle className="spin"/> : <Save size={14}/>}저장</Button>
          <Button onClick={() => void downloadViaPicker()} disabled={downloading}>{downloading ? <LoaderCircle className="spin"/> : <Download size={14}/>}다운로드</Button>
        </div>
      </div>
    </DialogContent>
    </Dialog>
    <Dialog open={midiSaveDialogOpen} onOpenChange={setMidiSaveDialogOpen}>
      <DialogContent className="studio-dialog">
        <DialogTitle>MIDI 저장</DialogTitle>
        <DialogDescription>이 브라우저에서는 탐색기로 바로 저장할 수 없어, 저장할 폴더와 파일명을 직접 확인해 주세요.</DialogDescription>
        <div className="dialog-scroll">
          <label>폴더<Input value={midiSaveFolder} onChange={event => setMidiSaveFolder(event.target.value)} placeholder={DEFAULT_MIDI_PATH}/></label>
          <label>파일명<Input value={midiSaveFilename} onChange={event => setMidiSaveFilename(event.target.value)} placeholder="midi"/></label>
        </div>
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setMidiSaveDialogOpen(false)} disabled={midiSaving}>취소</Button>
          <Button onClick={() => void confirmMidiSave()} disabled={midiSaving}>{midiSaving ? <LoaderCircle className="spin"/> : <Save size={14}/>}저장</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

// Shared preview transport state for source, reference, and transformed audio rows.
// The four timbre engines all play one keyed buffer at a time, so this keeps
// playback, seeking, speed, and volume behavior consistent across tabs.
function useAudioTransport() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewVolume, setPreviewVolume] = useState(1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewGainRef = useRef<GainNode | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rateRef = useRef(1);
  const isPlayingRef = useRef(false);
  const buffersRef = useRef<Record<string, AudioBuffer | null>>({});
  const [peaksMap, setPeaksMap] = useState<Record<string, number[]>>({});
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  function ensureAudioContext(): AudioContext {
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') return audioCtxRef.current;
    audioCtxRef.current = null;
    previewGainRef.current = null;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const gainNode = ctx.createGain();
    gainNode.gain.value = previewVolume;
    gainNode.connect(ctx.destination);
    previewGainRef.current = gainNode;
    return ctx;
  }
  function setBuffer(key: string, buffer: AudioBuffer | null) {
    buffersRef.current[key] = buffer;
    setPeaksMap(previous => ({ ...previous, [key]: buffer ? computeWaveformPeaks(buffer, 300) : [] }));
  }
  function bufferForKey(key: string | null): AudioBuffer | null { return key ? buffersRef.current[key] || null : null; }
  function peaksForKey(key: string): number[] { return peaksMap[key] || []; }
  function pausePlayback() {
    if (isPlaying) playOffsetRef.current = currentPosition();
    currentSourceRef.current?.stop();
    currentSourceRef.current = null;
    setIsPlaying(false);
  }
  function currentPosition(): number {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return playOffsetRef.current;
    return playOffsetRef.current + (ctx.currentTime - playStartCtxTimeRef.current) * rateRef.current;
  }
  function playKey(key: string, atPosition?: number) {
    const ctx = ensureAudioContext();
    const buffer = bufferForKey(key);
    if (!buffer) return;
    // A suspended context (created after an await) stays silent until resumed from a
    // user gesture. Every play click is such a gesture, so resume before starting.
    if (ctx.state !== 'running') void ctx.resume();
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
    setActiveKey(key);
    setIsPlaying(true);
  }
  function handleKeyClick(key: string) {
    if (activeKey === key && isPlaying) { pausePlayback(); return; }
    playKey(key);
  }
  function stopPlayback() { pausePlayback(); setActiveKey(null); setPositionSeconds(0); }
  function seekBy(deltaSeconds: number) {
    const key = activeKey || 'source';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(currentPosition() + deltaSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function seekTo(nextSeconds: number) {
    const key = activeKey || 'source';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(nextSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function cycleSpeed() {
    const next = playbackRate >= 2 ? 1 : 2;
    const pos = currentPosition();
    setPlaybackRate(next);
    rateRef.current = next;
    if (isPlaying && activeKey) { playKey(activeKey, pos); return; }
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
    const tick = () => { setPositionSeconds(currentPosition()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  const activeBuffer = bufferForKey(activeKey);
  const playedFraction = activeBuffer ? Math.min(1, positionSeconds / activeBuffer.duration) : 0;
  const rowClass = (key: string, base: string) => `${base}${activeKey === key && isPlaying ? ' pp-row-playing-original' : ''}`;
  function closeContext() {
    currentSourceRef.current?.stop();
    currentSourceRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    previewGainRef.current = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
  }
  return {
    activeKey, isPlaying, positionSeconds, playbackRate, previewVolume, activeBuffer, playedFraction, rowClass,
    ensureAudioContext, setBuffer, bufferForKey, peaksForKey, handleKeyClick, stopPlayback, seekBy, seekTo, cycleSpeed, applyPreviewVolume,
    closeContext,
  };
}
type AudioTransport = ReturnType<typeof useAudioTransport>;
function SeekRow({ t }: { t: AudioTransport }) {
  return <div className="pp-seek-row">
    <span className="pp-seek-time">{formatSeekTime(t.positionSeconds)}</span>
    <input className="pp-seek-bar" type="range" aria-label="재생 위치" min={0} max={t.activeBuffer?.duration || 0} step={0.01} value={Math.min(t.positionSeconds, t.activeBuffer?.duration || 0)} onChange={event => t.seekTo(Number(event.target.value))} disabled={!t.activeBuffer}/>
    <span className="pp-seek-time">{formatSeekTime(t.activeBuffer?.duration || 0)}</span>
  </div>;
}
// Keep only the controls here so close/save can sit in the same action row.
// SeekRow stays above it, matching the existing preview dialogs.
function TransportControls({ t, disabled }: { t: AudioTransport; disabled: boolean }) {
  return <div className="pp-transport">
    <Button variant="ghost" size="icon" aria-label="5초 뒤로" onClick={() => t.seekBy(-5)} disabled={disabled}><Rewind size={15}/></Button>
    <Button variant="ghost" size="icon" aria-label={t.isPlaying ? '일시정지' : '재생'} onClick={() => t.handleKeyClick(t.activeKey || 'source')} disabled={disabled}>{t.isPlaying ? <Pause size={15}/> : <Play size={15}/>}</Button>
    <Button variant="ghost" size="icon" aria-label="5초 앞으로" onClick={() => t.seekBy(5)} disabled={disabled}><FastForward size={15}/></Button>
    <button type="button" className="speed-btn" aria-label="재생 속도" onClick={t.cycleSpeed} disabled={disabled}>{t.playbackRate}x</button>
    <Volume2 size={14} className="pp-volume-icon"/>
    <input className="abc-player-volume" type="range" aria-label="미리듣기 볼륨" min={0} max={2} step={0.1} value={t.previewVolume} onChange={event => t.applyPreviewVolume(Number(event.target.value))} disabled={disabled}/>
  </div>;
}


// Audio Tools TTS runs on audio.cpp (Qwen3-TTS / VoxCPM2 / Chatterbox ...); the backend splits long
// text into sentence segments and joins them. `mode` selects which model variants apply: 'design'
// (voice from a text description) only exists for Qwen3-TTS VoiceDesign.
type TtsPrecisionInfo = { precision: string; sizeMb: number; installed: boolean; download: { state: string; receivedBytes: number; totalBytes: number; error: string | null } | null };
type TtsVariantInfo = { mode: 'design' | 'ref' | 'preset' | 'asr'; size: string; precisions: TtsPrecisionInfo[] };
type TtsFamilyInfo = { id: string; label: string; languages?: string[]; voices?: { id: string; label: string }[]; variants: TtsVariantInfo[] };
const TTS_PRECISION_LABELS: Record<string, string> = { q8_0: 'INT8 (Q8_0)', bf16: 'BF16', f16: 'FP16', f32: 'FP32', orig: '원본(FP32)' };
function ttsVariantsFor(families: TtsFamilyInfo[], familyId: string, mode: 'design' | 'ref' | 'preset') {
  // Families with a native voice-design variant (Qwen3, VoxCPM2, OmniVoice) use it in the design tab;
  // the others use their reference variants and the backend builds a stand-in reference clip.
  const variants = families.find(family => family.id === familyId)?.variants || [];
  const wanted = mode === 'preset' ? 'preset' : variants.some(variant => variant.mode === mode) ? mode : 'ref';
  return variants.filter(variant => variant.mode === wanted);
}
// Keeps family/size/precision a valid combination for the mode (falls back to the first valid entry).
function normalizeTtsSelection(families: TtsFamilyInfo[], mode: 'design' | 'ref' | 'preset', familyId: string, size: string, precision: string) {
  const family = families.find(item => item.id === familyId && ttsVariantsFor(families, item.id, mode).length)
    || families.find(item => ttsVariantsFor(families, item.id, mode).length);
  if (!family) return { familyId, size, precision };
  const variants = ttsVariantsFor(families, family.id, mode);
  const variant = variants.find(item => item.size === size) || variants[variants.length - 1];
  const precisionInfo = variant.precisions.find(item => item.precision === precision) || variant.precisions[0];
  return { familyId: family.id, size: variant.size, precision: precisionInfo.precision };
}
const AUDIO_TOOL_CATEGORIES = [
  { id: 'tts', label: 'TTS 생성' },
  { id: 'asr', label: '음성 인식 (STT)' },
  { id: 'edit', label: '대사 편집' },
  { id: 'sfx', label: '효과음 생성' },
  { id: 'adjust', label: '음성 조절' },
  { id: 'vc', label: '음색 변조' },
];
const TTS_TOOLS = [
  { id: 'voice-description-tts', label: 'TTS (T2S)', description: 'Text를 음색 설명에 맞는 목소리(sound)로 변경합니다.' },
  { id: 'voice-cloning', label: 'TTS 생성 (Ref-T2S)', description: 'Text를 참조 목소리(sound)로 변경합니다.' },
  { id: 'preset-tts', label: 'TTS (프리셋 목소리)', description: 'Text를 내장 프리셋 목소리로 빠르게 읽습니다.' },
];
const TYPECAST_EMOTIONS: [string, string][] = [['smart', '스마트(문맥에서 자동)'], ['normal', '보통'], ['happy', '기쁨'], ['sad', '슬픔'], ['angry', '화남'], ['whisper', '속삭임'], ['toneup', '톤 올림'], ['tonedown', '톤 내림']];
type TypecastVoice = { id: string; name: string; gender: string | null; age: string | null; names: { eng?: string; kor?: string } | null; preview: string | null; useCases: string[] };
const TYPECAST_AGES: [string, string][] = [['child', '어린이'], ['teenager', '청소년'], ['young_adult', '청년'], ['middle_age', '중년'], ['elder', '노년']];
const TYPECAST_USE_CASES: [string, string][] = [['Conversational', '대화'], ['E-learning/Explainer', '교육·설명'], ['Audiobook/Storytelling', '오디오북·낭독'], ['Documentary', '다큐멘터리'], ['Ads/Promotion', '광고·홍보'], ['Radio/Podcast', '라디오·팟캐스트'], ['TikTok/Reels/Shorts', '숏폼'], ['Announcer', '아나운서'], ['News Reporter', '뉴스'], ['Voicemail/Voice Assistant', '음성안내·비서'], ['Game', '게임'], ['Anime', '애니메이션'], ['Rapper', '랩']];
const TYPECAST_AGE_LABEL = Object.fromEntries(TYPECAST_AGES);
const TYPECAST_USE_LABEL = Object.fromEntries(TYPECAST_USE_CASES);

// 사이드바 "오디오 도구" 페이지 -- 완성곡과 무관하게 audio.cpp 기반의 TTS/음성 인식(Qwen3-ASR)과
// ffmpeg 기반 음성 조절을 독립적으로 실행한다. 조건 입력은 좌측 30%, 결과는 우측 70%에 "음원 비교"
// 스타일(파형+스펙트로그램+seek bar+재생 컨트롤+취소/저장)로 표시한다.
function AudioToolsPage({ notify }: { notify: (text: string, error?: boolean) => void }) {
  const t = useAudioTransport();
  const [categoryId, setCategoryId] = useState(AUDIO_TOOL_CATEGORIES[0].id);
  const [toolId, setToolId] = useState(TTS_TOOLS[0].id);
  const tool = TTS_TOOLS.find(item => item.id === toolId) || TTS_TOOLS[0];
  const [ttsDescription, setTtsDescription] = useState('');
  const [ttsText, setTtsText] = useState('');
  const [speechLanguage, setSpeechLanguage] = useState<'auto' | 'en' | 'ko'>('auto');
  const [ttsModels, setTtsModels] = useState<TtsFamilyInfo[]>([]);
  const [asrModels, setAsrModels] = useState<TtsFamilyInfo[]>([]);
  const [ttsFamily, setTtsFamily] = useState('qwen3');
  const [ttsSize, setTtsSize] = useState('1.7B');
  const [ttsPrecision, setTtsPrecision] = useState('q8_0');
  const [referenceText, setReferenceText] = useState('');
  const [ttsVoice, setTtsVoice] = useState('F1');
  const [ttsStyle, setTtsStyle] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [typecastVoices, setTypecastVoices] = useState<TypecastVoice[]>([]);
  const [typecastConfigured, setTypecastConfigured] = useState<boolean | null>(null);
  const [typecastPlan, setTypecastPlan] = useState<{ plan: string; cloneAvailable: boolean; creditsLeft: number | null; creditsTotal: number | null } | null>(null);
  const [typecastVoice, setTypecastVoice] = useState('');
  const [typecastEmotion, setTypecastEmotion] = useState('smart');
  const [typecastGender, setTypecastGender] = useState('');
  const [typecastAge, setTypecastAge] = useState('');
  const [typecastUse, setTypecastUse] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [asrFamily, setAsrFamily] = useState('qwen3asr');
  const [asrSize, setAsrSize] = useState('1.7B');
  const [asrPrecision, setAsrPrecision] = useState('q8_0');
  const [asrLanguage, setAsrLanguage] = useState<'auto' | 'ko' | 'en' | 'ja' | 'zh'>('ko');
  const [transcript, setTranscript] = useState<string | null>(null);
  // Speech editing (DotTTS Edit): transcript of the source + a list of word edits
  const [editModels, setEditModels] = useState<TtsFamilyInfo[]>([]);
  const [alignModels, setAlignModels] = useState<TtsFamilyInfo[]>([]);
  const [editPrecise, setEditPrecise] = useState(true);
  // Sound-effect generation (Stable Audio 3 SFX)
  const [sfxModels, setSfxModels] = useState<TtsFamilyInfo[]>([]);
  const [sfxPrecision, setSfxPrecision] = useState('q8_0');
  const [sfxPrompt, setSfxPrompt] = useState('');
  const [sfxNegative, setSfxNegative] = useState('');
  const [sfxDuration, setSfxDuration] = useState('5');
  const [sfxSteps, setSfxSteps] = useState('8');
  const [sfxSeed, setSfxSeed] = useState('');
  const [editPrecision, setEditPrecision] = useState('q8_0');
  const [editLanguage, setEditLanguage] = useState<'auto' | 'ko' | 'en' | 'ja' | 'zh'>('ko');
  const [editSourceText, setEditSourceText] = useState('');
  const [editItems, setEditItems] = useState<{ op: 'sub' | 'del' | 'ins' | 'apd'; find: string; text: string; all: boolean }[]>([{ op: 'sub', find: '', text: '', all: false }]);
  const [transcribing, setTranscribing] = useState(false);
  const [pitch, setPitch] = useState('0');
  const [speed, setSpeed] = useState('1');
  const [volumeDb, setVolumeDb] = useState('0');
  const [denoise, setDenoise] = useState(false);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [sourceFromMic, setSourceFromMic] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [warningText, setWarningText] = useState('');
  const [audioPickerOpen, setAudioPickerOpen] = useState(false);
  // Speech voice conversion (MeanVC2): reference voice slot + microphone recorder
  const [vcModels, setVcModels] = useState<TtsFamilyInfo[]>([]);
  const [meanvcPrecision, setMeanvcPrecision] = useState<'q4_k' | 'fp32'>('q4_k');
  const [refName, setRefName] = useState<string | null>(null);
  const [refPickerOpen, setRefPickerOpen] = useState(false);
  const refBlobRef = useRef<Blob | null>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [micPanelOpen, setMicPanelOpen] = useState(false);
  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>([]);
  const [micId, setMicId] = useState('');
  const [recState, setRecState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStateRef = useRef<'idle' | 'recording' | 'paused'>('idle');
  const micCanvasRef = useRef<HTMLCanvasElement>(null);
  const micSpectrumRef = useRef<HTMLCanvasElement>(null);
  const [micGain, setMicGain] = useState<'auto' | number>('auto');
  const micGainRef = useRef<'auto' | number>('auto');
  micGainRef.current = micGain;
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micDeviceInUseRef = useRef('');
  const audioBlobRef = useRef<Blob | null>(null);
  const resultDataUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultBuffer = t.bufferForKey('output');
  const sourceBuffer = t.bufferForKey('source');
  const atRowClass = (key: string, kind: 'dry' | 'wet') => `at-result-row${t.activeKey === key && t.isPlaying ? (kind === 'wet' ? ' pp-row-playing-processed' : ' pp-row-playing-original') : ''}`;
  useEffect(() => () => t.closeContext(), [] /* eslint-disable-line react-hooks/exhaustive-deps */);

  const isTts = categoryId === 'tts';
  const isAsr = categoryId === 'asr';
  const ttsMode: 'design' | 'ref' | 'preset' = toolId === 'voice-description-tts' ? 'design' : toolId === 'preset-tts' ? 'preset' : 'ref';
  // Typecast is always offered (paid plans can clone); on plans without custom voice slots the server answers with a paid-plan error shown below the run button.
  const typecastAvailable = ttsMode !== 'preset';
  const isTypecast = isTts && ttsFamily === 'typecast' && ttsMode !== 'preset' && typecastAvailable;
  const typecastFiltered = typecastVoices.filter(voice => (!typecastGender || voice.gender === typecastGender) && (!typecastAge || voice.age === typecastAge) && (!typecastUse || voice.useCases.includes(typecastUse)));
  const isVc = categoryId === 'vc';
  const isEdit = categoryId === 'edit';
  const isSfx = categoryId === 'sfx';
  const needsAudio = isAsr || isEdit || categoryId === 'adjust' || isVc || (isTts && ttsMode === 'ref');
  const audioLabel = isTts ? '참조 목소리' : isAsr ? '인식할 오디오' : isEdit ? '편집할 오디오' : isVc ? '원본 오디오' : '조절할 오디오';
  const sfxVariant = sfxModels.find(family => family.id === 'stablesfx')?.variants[0];
  const sfxPrecisionInfo = sfxVariant?.precisions.find(item => item.precision === sfxPrecision);
  const editVariant = editModels.find(family => family.id === 'dotsedit')?.variants[0];
  const editPrecisionInfo = editVariant?.precisions.find(item => item.precision === editPrecision);
  const alignInfo = alignModels.find(family => family.id === 'qwen3align')?.variants[0]?.precisions[0];
  const meanvcInfo = vcModels.find(family => family.id === 'meanvc2')?.variants[0]?.precisions.find(item => item.precision === meanvcPrecision);
  const ttsVariant = ttsVariantsFor(ttsModels, ttsFamily, ttsMode).find(variant => variant.size === ttsSize);
  const ttsVariantMode = ttsVariant?.mode || 'ref';
  const ttsNativeDesign = ttsMode === 'design' && ttsVariantMode === 'design';
  const ttsPrecisionInfo = ttsVariant?.precisions.find(item => item.precision === ttsPrecision);
  const asrFamilyInfo = asrModels.find(family => family.id === asrFamily) || asrModels[0];
  const asrVariant = asrFamilyInfo?.variants.find(variant => variant.size === asrSize);
  const asrPrecisionInfo = asrVariant?.precisions.find(item => item.precision === asrPrecision);
  const anyDownloading = [...ttsModels, ...asrModels, ...editModels, ...alignModels, ...sfxModels].some(family => family.variants.some(variant => variant.precisions.some(item => item.download?.state === 'running')));
  async function refreshModels() {
    try {
      const result = await api<{ families: TtsFamilyInfo[]; asr: TtsFamilyInfo[]; vc?: TtsFamilyInfo[]; edit?: TtsFamilyInfo[]; align?: TtsFamilyInfo[]; sfx?: TtsFamilyInfo[] }>('/audio-tools/tts/models');
      setTtsModels(result.families);
      setAsrModels(result.asr || []);
      setVcModels(result.vc || []);
      setEditModels(result.edit || []);
      setAlignModels(result.align || []);
      setSfxModels(result.sfx || []);
    } catch { /* backend may be restarting */ }
  }
  useEffect(() => { void refreshModels(); }, []);
  useEffect(() => {
    if (!isTts || typecastConfigured !== null) return;
    api<{ configured: boolean; voices: TypecastVoice[]; subscription?: typeof typecastPlan }>('/audio-tools/typecast/voices')
      .then(result => { setTypecastConfigured(result.configured); setTypecastPlan(result.subscription ?? null); setTypecastVoices(result.voices); if (result.voices[0]) setTypecastVoice(previous => previous || result.voices[0].id); })
      .catch(error => { setTypecastConfigured(true); setErrorText((error as Error).message); });
  }, [isTts, typecastConfigured]);
  useEffect(() => {
    if (!anyDownloading) return;
    const timer = window.setInterval(() => void refreshModels(), 2000);
    return () => window.clearInterval(timer);
  }, [anyDownloading]);
  useEffect(() => {
    // Keep the ASR selection valid when the family changes (sizes/precisions/languages differ per family).
    if (!asrFamilyInfo) return;
    if (asrFamilyInfo.id !== asrFamily) { setAsrFamily(asrFamilyInfo.id); return; }
    const variant = asrFamilyInfo.variants.find(item => item.size === asrSize) || asrFamilyInfo.variants[asrFamilyInfo.variants.length - 1];
    if (variant.size !== asrSize) { setAsrSize(variant.size); return; }
    if (!variant.precisions.some(item => item.precision === asrPrecision)) setAsrPrecision(variant.precisions[0].precision);
    if (asrLanguage !== 'auto' && asrFamilyInfo.languages && !asrFamilyInfo.languages.includes(asrLanguage)) setAsrLanguage('auto');
  }, [asrModels, asrFamily, asrSize, asrPrecision, asrLanguage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const voices = ttsModels.find(family => family.id === ttsFamily)?.voices;
    if (voices?.length && !voices.some(voice => voice.id === ttsVoice)) setTtsVoice(voices[0].id);
  }, [ttsModels, ttsFamily, ttsVoice]);
  useEffect(() => {
    if (!ttsModels.length) return;
    if (ttsFamily === 'typecast' && ttsMode !== 'preset' && typecastAvailable) return;
    const next = normalizeTtsSelection(ttsModels, ttsMode, ttsFamily, ttsSize, ttsPrecision);
    if (next.familyId !== ttsFamily) setTtsFamily(next.familyId);
    if (next.size !== ttsSize) setTtsSize(next.size);
    if (next.precision !== ttsPrecision) setTtsPrecision(next.precision);
  }, [ttsModels, ttsMode, ttsFamily, ttsSize, ttsPrecision, typecastAvailable]);
  async function previewPresetVoice() {
    setPreviewing(true);
    setErrorText('');
    try {
      const result = await api<{ dataUrl: string }>('/audio-tools/tts/preview', 'POST', { family: ttsFamily, size: ttsSize, precision: ttsPrecision, voiceId: ttsVoice });
      previewAudioRef.current?.pause();
      previewAudioRef.current = new Audio(result.dataUrl);
      await previewAudioRef.current.play();
    } catch (error) { setErrorText((error as Error).message); }
    finally { setPreviewing(false); }
  }
  async function downloadModel(family: string, mode: string, size: string, precision: string) {
    try {
      await api('/audio-tools/tts/download', 'POST', { family, mode, size, precision });
      await refreshModels();
    } catch (error) { setErrorText((error as Error).message); }
  }

  function selectCategory(nextCategoryId: string) {
    if (micPanelOpen) closeMicPanel();
    setCategoryId(nextCategoryId);
    setErrorText('');
    setWarningText('');
  }
  async function pickFromLibrary(relPath: string) {
    try {
      const response = await fetch(`/api/library/file?path=${encodeURIComponent(relPath)}`);
      if (!response.ok) throw new Error('파일을 불러오지 못했습니다.');
      applyPickedAudio(await response.blob(), relPath.split('/').pop() || relPath);
    } catch (error) { setErrorText((error as Error).message); }
  }
  function handlePickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) applyPickedAudio(file, file.name);
  }
  function applyPickedAudio(file: Blob, name: string, fromMic = false) {
    // Choosing a file/library source replaces the microphone: close the recorder panel (and its input stream).
    if (!fromMic && micPanelOpen) closeMicPanel();
    audioBlobRef.current = file;
    setAudioName(name);
    setSourceFromMic(fromMic);
    const ctx = t.ensureAudioContext();
    file.arrayBuffer().then(bytes => ctx.decodeAudioData(bytes)).then(decoded => t.setBuffer('source', decoded)).catch(() => {});
  }
  async function showResult(dataUrl: string) {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error('결과 오디오를 내려받지 못했습니다.');
    t.setBuffer('output', await t.ensureAudioContext().decodeAudioData(await response.arrayBuffer()));
    resultDataUrlRef.current = dataUrl;
  }
  function applyPickedReference(file: Blob, name: string) {
    refBlobRef.current = file;
    setRefName(name);
    const ctx = t.ensureAudioContext();
    file.arrayBuffer().then(bytes => ctx.decodeAudioData(bytes)).then(decoded => t.setBuffer('reference', decoded)).catch(() => {});
  }
  async function pickReferenceFromLibrary(relPath: string) {
    try {
      const response = await fetch(`/api/library/file?path=${encodeURIComponent(relPath)}`);
      if (!response.ok) throw new Error('파일을 불러오지 못했습니다.');
      applyPickedReference(await response.blob(), relPath.split('/').pop() || relPath);
    } catch (error) { setErrorText((error as Error).message); }
  }
  function handlePickRefFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) applyPickedReference(file, file.name);
  }
  // ---- microphone recorder (source input for voice conversion) ----
  async function refreshMics() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(device => device.kind === 'audioinput').map((device, index) => ({ id: device.deviceId, label: device.label || `마이크 ${index + 1}` }));
    setMicDevices(inputs);
    setMicId(previous => (inputs.some(device => device.id === previous) ? previous : inputs[0]?.id || ''));
  }
  // One persistent input stream feeds both the live waveform (AnalyserNode, not routed to the speakers, so no echo)
  // and the recorder; it is (re)opened for the chosen device and closed with the panel.
  function closeMicStream() {
    micSourceRef.current?.disconnect();
    micSourceRef.current = null;
    micAnalyserRef.current = null;
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    micStreamRef.current = null;
    micDeviceInUseRef.current = '';
  }
  async function ensureMicStream(deviceId: string): Promise<MediaStream> {
    if (micStreamRef.current && micDeviceInUseRef.current === deviceId) return micStreamRef.current;
    closeMicStream();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false } });
    micStreamRef.current = stream;
    micDeviceInUseRef.current = deviceId;
    const ctx = t.ensureAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    micSourceRef.current = source;
    micAnalyserRef.current = analyser;
    return stream;
  }
  async function openMicPanel() {
    setMicPanelOpen(true);
    setErrorText('');
    try {
      // Opening the stream first also unlocks the device labels (only exposed after the user allowed the microphone).
      await ensureMicStream(micId);
      await refreshMics();
    } catch { setErrorText('마이크를 사용할 수 없습니다. 브라우저의 마이크 권한을 허용했는지 확인해 주세요.'); }
  }
  function closeMicPanel() {
    if (recStateRef.current !== 'idle') { recorderRef.current?.stop(); setRec('idle'); }
    closeMicStream();
    setMicPanelOpen(false);
  }
  // Switching the input device while idle re-opens the monitor on the new device.
  useEffect(() => {
    if (!micPanelOpen || recState !== 'idle' || !micId || micDeviceInUseRef.current === micId) return;
    void ensureMicStream(micId).catch(() => setErrorText('선택한 입력 장치를 열 수 없습니다.'));
  }, [micId, micPanelOpen, recState]); // eslint-disable-line react-hooks/exhaustive-deps
  // Live oscilloscope: the time-domain signal of the microphone, red while recording.
  useEffect(() => {
    if (!micPanelOpen) return;
    let frame = 0;
    let smoothedPeak = 0.05; // slow-decaying peak used by the automatic sensitivity
    let smoothedSpectrumPeak = 0.2;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const canvas = micCanvasRef.current;
      if (!canvas) return;
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      const width = canvas.clientWidth * (window.devicePixelRatio || 1);
      const height = canvas.clientHeight * (window.devicePixelRatio || 1);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      ctx2d.clearRect(0, 0, width, height);
      ctx2d.strokeStyle = 'rgba(120,140,120,0.35)';
      ctx2d.beginPath();
      ctx2d.moveTo(0, height / 2);
      ctx2d.lineTo(width, height / 2);
      ctx2d.stroke();
      const analyser = micAnalyserRef.current;
      if (!analyser) return;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      // Display sensitivity: automatic (scale so the recent peak fills ~80% of the height, never amplifying pure noise
      // beyond x30) or a fixed multiplier. This only scales the picture, never the recorded audio.
      let peak = 0;
      for (let index = 0; index < data.length; index += 1) peak = Math.max(peak, Math.abs(data[index] - 128) / 128);
      smoothedPeak = Math.max(peak, smoothedPeak * 0.985);
      const gain = micGainRef.current === 'auto' ? Math.min(30, Math.max(1, 0.8 / Math.max(smoothedPeak, 0.03))) : micGainRef.current;
      ctx2d.lineWidth = 2 * (window.devicePixelRatio || 1);
      ctx2d.strokeStyle = recStateRef.current === 'recording' ? '#f87171' : recStateRef.current === 'paused' ? '#a3a3a3' : '#7ee787';
      ctx2d.beginPath();
      for (let index = 0; index < data.length; index += 1) {
        const x = (index / (data.length - 1)) * width;
        const y = Math.min(height, Math.max(0, height / 2 - ((data[index] - 128) / 128) * gain * (height / 2)));
        if (index === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
      }
      ctx2d.stroke();

      // Frequency view: X = frequency (0-8 kHz, where speech lives), Y = magnitude of each frequency band.
      const specCanvas = micSpectrumRef.current;
      const specCtx = specCanvas?.getContext('2d');
      if (!specCanvas || !specCtx) return;
      const ratio = window.devicePixelRatio || 1;
      const sw = specCanvas.clientWidth * ratio;
      const sh = specCanvas.clientHeight * ratio;
      if (specCanvas.width !== sw) specCanvas.width = sw;
      if (specCanvas.height !== sh) specCanvas.height = sh;
      specCtx.clearRect(0, 0, sw, sh);
      const axisHeight = 16 * ratio;
      const plotHeight = sh - axisHeight;
      const freq = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freq);
      const binHz = (micSourceRef.current?.context.sampleRate || 48000) / analyser.fftSize;
      const maxHz = 8000;
      const maxBin = Math.min(freq.length - 1, Math.floor(maxHz / binHz));
      let specPeak = 0;
      for (let bin = 1; bin <= maxBin; bin += 1) specPeak = Math.max(specPeak, freq[bin] / 255);
      smoothedSpectrumPeak = Math.max(specPeak, smoothedSpectrumPeak * 0.985);
      const specGain = micGainRef.current === 'auto' ? Math.min(30, Math.max(1, 0.85 / Math.max(smoothedSpectrumPeak, 0.05))) : micGainRef.current;
      specCtx.fillStyle = recStateRef.current === 'recording' ? '#f87171' : recStateRef.current === 'paused' ? '#a3a3a3' : '#7ee787';
      const barWidth = Math.max(1, sw / 160);
      for (let x = 0; x < sw; x += barWidth) {
        const bin = Math.max(1, Math.round((x / sw) * maxBin));
        const magnitude = Math.min(1, (freq[bin] / 255) * (micGainRef.current === 'auto' ? specGain : Math.sqrt(specGain)));
        specCtx.fillRect(x, plotHeight - magnitude * plotHeight, Math.max(1, barWidth - 1), magnitude * plotHeight);
      }
      // frequency axis
      specCtx.fillStyle = 'rgba(160,175,160,0.9)';
      specCtx.strokeStyle = 'rgba(120,140,120,0.35)';
      specCtx.font = `${10 * ratio}px sans-serif`;
      specCtx.textBaseline = 'top';
      for (let hz = 0; hz <= maxHz; hz += 1000) {
        const x = (hz / maxHz) * (sw - 1);
        specCtx.beginPath();
        specCtx.moveTo(x, plotHeight);
        specCtx.lineTo(x, plotHeight + 3 * ratio);
        specCtx.stroke();
        specCtx.textAlign = hz === 0 ? 'left' : hz === maxHz ? 'right' : 'center';
        specCtx.fillText(hz === 0 ? '0' : `${hz / 1000}k`, x, plotHeight + 4 * ratio);
      }
      specCtx.textAlign = 'right';
      specCtx.fillText('Hz', sw, 0);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [micPanelOpen]);
  function setRec(next: 'idle' | 'recording' | 'paused') { recStateRef.current = next; setRecState(next); }
  async function startRecording() {
    setErrorText('');
    try {
      const stream = await ensureMicStream(micId);
      const recorder = new MediaRecorder(stream);
      recChunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size) recChunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        // Decode and re-encode as WAV so the backend gets a format it accepts.
        blob.arrayBuffer().then(bytes => t.ensureAudioContext().decodeAudioData(bytes)).then(decoded => applyPickedAudio(audioBufferToWavBlob(decoded), '마이크 녹음.wav', true)).catch(() => setErrorText('녹음을 처리하지 못했습니다.'));
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setRecSeconds(0);
      setRec('recording');
      t.stopPlayback();
    } catch { setErrorText('녹음을 시작하지 못했습니다. 마이크 권한과 입력 장치를 확인해 주세요.'); }
  }
  function pauseRecording() {
    if (recStateRef.current === 'recording') { recorderRef.current?.pause(); setRec('paused'); }
    else if (recStateRef.current === 'paused') { recorderRef.current?.resume(); setRec('recording'); }
  }
  function stopRecording() {
    if (recStateRef.current !== 'idle') { recorderRef.current?.stop(); setRec('idle'); }
  }
  useEffect(() => {
    if (recState !== 'recording') return;
    const timer = window.setInterval(() => setRecSeconds(previous => previous + 0.25), 250);
    return () => window.clearInterval(timer);
  }, [recState]);
  useEffect(() => () => { try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); } catch { /* ignore */ } closeMicStream(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Fills the transcript box using the speech-recognition model chosen in the STT tab.
  async function transcribeSource() {
    if (!audioBlobRef.current) { setErrorText(`${audioLabel}를 먼저 선택해 주세요.`); return; }
    setTranscribing(true);
    setErrorText('');
    try {
      const result = await api<{ transcript: string }>('/audio-tools/asr', 'POST', { audioDataUrl: await readFileAsDataUrl(audioBlobRef.current), language: editLanguage === 'auto' ? '' : editLanguage, family: asrFamily, size: asrSize, precision: asrPrecision });
      setEditSourceText(result.transcript || '');
    } catch (error) { setErrorText((error as Error).message); }
    finally { setTranscribing(false); }
  }
  function updateEditItem(index: number, patch: Partial<{ op: 'sub' | 'del' | 'ins' | 'apd'; find: string; text: string; all: boolean }>) {
    setEditItems(items => items.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  }
  async function run() {
    if (needsAudio && !audioBlobRef.current) { setErrorText(`${audioLabel}를 먼저 선택해 주세요.`); return; }
    if (isVc && !refBlobRef.current) { setErrorText('목표 목소리의 참조 오디오를 먼저 선택해 주세요.'); return; }
    if (recStateRef.current !== 'idle') { setErrorText('녹음을 먼저 정지해 주세요.'); return; }
    if (isTts && !ttsText.trim()) { setErrorText("'말할 내용'을 입력해 주세요."); return; }
    if (isSfx && !sfxPrompt.trim()) { setErrorText('만들 효과음을 영어로 설명해 주세요.'); return; }
    if (isEdit && !editItems.some(item => item.find.trim())) { setErrorText('편집할 부분(찾을 말)을 하나 이상 입력해 주세요.'); return; }
    if (isTts && !isTypecast && ttsMode === 'design' && !ttsDescription.trim()) { setErrorText("'음색 설명'을 입력해 주세요."); return; }
    setRunning(true);
    setErrorText('');
    setWarningText('');
    t.stopPlayback();
    try {
      const audioDataUrl = audioBlobRef.current ? await readFileAsDataUrl(audioBlobRef.current) : undefined;
      if (isSfx) {
        const result = await api<{ dataUrl: string }>('/audio-tools/sfx', 'POST', { prompt: sfxPrompt, negativePrompt: sfxNegative, durationSeconds: Number(sfxDuration) || 5, steps: Number(sfxSteps) || 8, seed: sfxSeed.trim() === '' ? null : Number(sfxSeed), precision: sfxPrecision });
        await showResult(result.dataUrl);
      } else if (isEdit) {
        const result = await api<{ dataUrl: string; sourceText: string }>('/audio-tools/edit', 'POST', { audioDataUrl, sourceText: editSourceText, language: editLanguage === 'auto' ? '' : editLanguage, precision: editPrecision, precise: editPrecise && !!alignInfo?.installed, asrFamily, asrSize, asrPrecision, edits: editItems.filter(item => item.find.trim()) });
        setEditSourceText(result.sourceText);
        await showResult(result.dataUrl);
      } else if (isVc) {
        const referenceDataUrl = await readFileAsDataUrl(refBlobRef.current as Blob);
        const result = await api<{ dataUrl: string }>('/audio-tools/vc', 'POST', { audioDataUrl, referenceDataUrl, precision: meanvcPrecision });
        await showResult(result.dataUrl);
      } else if (isTypecast) {
        const result = await api<{ dataUrl: string; segmentCount: number; voiceName?: string }>('/audio-tools/typecast', 'POST', { mode: ttsMode, voiceId: typecastVoice, description: ttsDescription, referenceDataUrl: ttsMode === 'ref' ? audioDataUrl : undefined, text: ttsText, language: 'auto', emotion: typecastEmotion === 'smart' ? 'smart' : 'preset', emotionPreset: typecastEmotion });
        setWarningText([result.voiceName ? `설명에 맞춰 Typecast 목소리 "${result.voiceName}"를 자동 선택했습니다.` : '', result.segmentCount > 1 ? `긴 텍스트를 ${result.segmentCount}개 조각으로 나눠 생성한 뒤 이어붙였습니다.` : ''].filter(Boolean).join(' '));
        await showResult(result.dataUrl);
      } else if (isTts) {
        const result = await api<{ dataUrl: string; segmentCount: number; referenceText?: string }>('/audio-tools/tts', 'POST', { family: ttsFamily, mode: ttsMode, size: ttsSize, precision: ttsPrecision, text: ttsText, description: ttsDescription, voiceId: ttsVoice, style: ttsStyle, language: speechLanguage, referenceDataUrl: ttsMode === 'ref' ? audioDataUrl : undefined, referenceText: ttsMode === 'ref' ? referenceText : undefined });
        if (result.referenceText) setReferenceText(result.referenceText);
        if (result.segmentCount > 1) setWarningText(`긴 텍스트를 ${result.segmentCount}개 문장 조각으로 나눠 생성한 뒤 이어붙였습니다.`);
        await showResult(result.dataUrl);
      } else if (isAsr) {
        const result = await api<{ transcript: string }>('/audio-tools/asr', 'POST', { audioDataUrl, language: asrLanguage === 'auto' ? '' : asrLanguage, family: asrFamily, size: asrSize, precision: asrPrecision });
        setTranscript(result.transcript || '(인식된 내용이 없습니다)');
      } else {
        const result = await api<{ dataUrl: string }>('/audio-tools/adjust', 'POST', { audioDataUrl, pitchSemitones: Number(pitch) || 0, speed: Number(speed) || 1, volumeDb: Number(volumeDb) || 0, denoise });
        await showResult(result.dataUrl);
      }
    } catch (error) { setErrorText((error as Error).message); }
    finally { setRunning(false); }
  }
  function handleCancel() {
    t.stopPlayback();
    t.setBuffer('output', null);
    resultDataUrlRef.current = null;
    setTranscript(null);
  }
  // Save opens the OS "save as" dialog so the user picks the location and file name; browsers
  // without the File System Access API fall back to a normal download.
  async function saveBlob(blob: Blob, suggestedName: string) {
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePickerFn }).showSaveFilePicker;
    if (typeof picker === 'function') {
      const handle = await picker({ suggestedName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      notify(`"${handle.name}" 파일로 저장했습니다.`);
    } else {
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = suggestedName;
      link.click();
      URL.revokeObjectURL(blobUrl);
      notify(`"${suggestedName}" 파일을 내려받았습니다.`);
    }
  }
  // Saves the microphone recording itself (only offered when the source came from the microphone).
  async function handleSaveSource() {
    if (!audioBlobRef.current) return;
    setSaving(true);
    try { await saveBlob(audioBlobRef.current, '마이크 녹음.wav'); }
    catch (error) { if ((error as { name?: string }).name !== 'AbortError') setErrorText((error as Error).message); }
    finally { setSaving(false); }
  }
  async function handleSave() {
    setSaving(true);
    try {
      if (isAsr && transcript) await saveBlob(new Blob([transcript], { type: 'text/plain;charset=utf-8' }), `${(audioName || '음성인식').replace(/\.[^.]+$/, '')}.txt`);
      else if (resultDataUrlRef.current) await saveBlob(await (await fetch(resultDataUrlRef.current)).blob(), `${isTts ? tool.label : isVc ? '음색변조' : isEdit ? '대사편집' : isSfx ? '효과음' : '음성조절'}.wav`.replace(/[\\/:*?"<>|()\s]+/g, '_'));
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') setErrorText((error as Error).message);
    } finally { setSaving(false); }
  }
  function renderModelStatus(info: TtsPrecisionInfo | undefined, family: string, mode: string, size: string, precision: string) {
    if (!info) return null;
    if (info.installed) return <span className="field-hint">설치됨 · 사용 준비 완료</span>;
    if (info.download?.state === 'running') return <span className="field-hint">내려받는 중… {info.download.totalBytes ? Math.round(info.download.receivedBytes / info.download.totalBytes * 100) : 0}% ({Math.round(info.download.receivedBytes / 1e6)} / {info.download.totalBytes ? Math.round(info.download.totalBytes / 1e6) : info.sizeMb} MB)</span>;
    return <div className="voice-convert-topbar"><Button variant="outline" onClick={() => void downloadModel(family, mode, size, precision)} disabled={running}><Download size={14}/>모델 받기 (약 {info.sizeMb} MB)</Button>{info.download?.error && <span className="field-hint warning">{info.download.error}</span>}</div>;
  }
  const hasResult = isAsr ? transcript !== null : !!resultBuffer;
  const canSave = !saving && hasResult;

  return <section className="library-page page-scroll">
    <div className="page-heading library-heading">
      <div><span className="eyebrow">audio.cpp 기반</span><h1>Audio Tools</h1><p>완성곡과 무관하게 텍스트→음성 생성, 음성 인식(STT), 대사 편집, 효과음 생성, 피치·속도·음량 조절, 말소리 음색 변조(마이크 녹음 지원)를 바로 실행합니다.</p></div>
    </div>
    <div className="audio-tools-tabs" role="tablist" aria-label="도구 카테고리">
      {AUDIO_TOOL_CATEGORIES.map(category => <button key={category.id} type="button" className={categoryId === category.id ? 'active' : ''} aria-pressed={categoryId === category.id} onClick={() => selectCategory(category.id)}>{category.label}</button>)}
    </div>
    <div className="audio-tools-panel">
      <div className="audio-tools-inputs">
        {isTts && <>
          <div className="at-section-head">Function 선택</div>
          <div className="at-function-row" role="group" aria-label="기능 선택">
            {TTS_TOOLS.map(item => <label key={item.id} className="at-function"><input type="checkbox" checked={toolId === item.id} onChange={() => { setToolId(item.id); setErrorText(''); }} disabled={running}/>{item.label}</label>)}
          </div>
        </>}
        {isTts && <>
          <div className="at-section-head">모델 선택</div>
          <div className="audio-tools-model-switch two-rows" role="group" aria-label="TTS 모델">
            {[...ttsModels.filter(family => ttsVariantsFor(ttsModels, family.id, ttsMode).length > 0), ...(ttsMode !== 'preset' && typecastAvailable ? [{ id: 'typecast', label: 'Typecast (클라우드)' }] : [])].map(family => <button key={family.id} type="button" className={ttsFamily === family.id ? 'active' : ''} aria-pressed={ttsFamily === family.id} onClick={() => setTtsFamily(family.id)} disabled={running}>{family.label}</button>)}
          </div>
          {!isTypecast && <>
          <div className="runtime-options">
            <label>크기<select value={ttsSize} onChange={event => setTtsSize(event.target.value)} disabled={running} aria-label="TTS 모델 크기">{ttsVariantsFor(ttsModels, ttsFamily, ttsMode).map(variant => <option key={variant.size} value={variant.size}>{variant.size}</option>)}</select></label>
            <label>정밀도<select value={ttsPrecision} onChange={event => setTtsPrecision(event.target.value)} disabled={running} aria-label="TTS 모델 정밀도">{(ttsVariant?.precisions || []).map(item => <option key={item.precision} value={item.precision}>{TTS_PRECISION_LABELS[item.precision] || item.precision}{item.installed ? '' : ' · 받기 필요'}</option>)}</select></label>
          </div>
          {renderModelStatus(ttsPrecisionInfo, ttsFamily, ttsVariantMode, ttsSize, ttsPrecision)}
          <span className="field-hint">{ttsMode === 'preset' ? '모델에 내장된 목소리를 골라 미리듣기로 확인한 뒤 읽습니다(Supertonic 3, Qwen3 CustomVoice, MagpieTTS). 참조 음성이 필요 없고 한국어를 지원합니다.' : ttsMode === 'design' ? (ttsNativeDesign ? '이 모델은 음색 설명만으로 목소리를 직접 만듭니다(VoxCPM2는 영어 설명이 가장 잘 먹힙니다).' : 'Chatterbox는 참조 목소리가 필요해, 음색 설명으로 Qwen3-TTS VoiceDesign(1.7B INT8)이 짧은 참조 음성을 먼저 만든 뒤 그 목소리로 말합니다. Qwen3 VoiceDesign 모델도 설치되어 있어야 합니다.') : '참조 목소리 복제: VoxCPM2와 Fish Audio가 텍스트 정확도가 높았고(한영 혼합 포함), Qwen3-TTS는 한국어/영어 단일 언어에 강합니다. 정밀도가 높을수록 정확하지만 더 크고 느립니다.'}</span>
          </>}
        </>}
        {isTypecast && <>
          {typecastConfigured === false ? <p className="field-hint warning">Typecast API 키가 없습니다. 프로젝트 폴더의 .env 파일에 <b>TYPECAST_API_KEY=발급받은키</b> 를 추가하고 백엔드를 재시작해 주세요. 키는 https://studio.typecast.ai/developers/api 에서 발급합니다(API 요금제 필요).</p> : <>
            {ttsMode === 'design' && <div className="runtime-options">
              <label>성별<select value={typecastGender} onChange={event => { setTypecastGender(event.target.value); setTypecastVoice(''); }} disabled={running} aria-label="Typecast 성별"><option value="">전체</option><option value="female">여성</option><option value="male">남성</option></select></label>
              <label>나이<select value={typecastAge} onChange={event => { setTypecastAge(event.target.value); setTypecastVoice(''); }} disabled={running} aria-label="Typecast 나이"><option value="">전체</option>{TYPECAST_AGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
              <label>용도<select value={typecastUse} onChange={event => { setTypecastUse(event.target.value); setTypecastVoice(''); }} disabled={running} aria-label="Typecast 용도"><option value="">전체</option>{TYPECAST_USE_CASES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            </div>}
            {ttsMode === 'design' && <label className="at-field">목소리
              <div className="voice-convert-topbar">
                <select value={typecastVoice} onChange={event => setTypecastVoice(event.target.value)} disabled={running} aria-label="Typecast 목소리"><option value="">음색 설명으로 자동 추천</option>{typecastFiltered.map(voice => <option key={voice.id} value={voice.id}>{voice.names?.kor || voice.name}{voice.gender ? ` · ${voice.gender === 'female' ? '여' : voice.gender === 'male' ? '남' : voice.gender}` : ''}{voice.age ? ` · ${TYPECAST_AGE_LABEL[voice.age] || voice.age}` : ''}{voice.useCases[0] ? ` · ${voice.useCases.slice(0, 2).map(use => TYPECAST_USE_LABEL[use] || use).join('/')}` : ''}</option>)}</select>
                <Button variant="outline" size="sm" disabled={!typecastVoice} onClick={() => { const voice = typecastVoices.find(item => item.id === typecastVoice); if (!voice?.preview) return; previewAudioRef.current?.pause(); previewAudioRef.current = new Audio(voice.preview); void previewAudioRef.current.play().catch(() => notify('미리듣기를 재생하지 못했습니다.', true)); }}><Play size={13}/>미리듣기</Button>
              </div>
              <span className="field-hint">조건에 맞는 목소리 {typecastFiltered.length}개 / 전체 {typecastVoices.length}개(중복 없음). 직접 고르지 않으면 "음색 설명"에 가장 잘 맞는 목소리를 자동으로 골라 씁니다. 언어는 텍스트에서 자동으로 감지되며(한국어·영어·일본어·혼합 확인), 목소리는 특정 언어에 묶여 있지 않습니다. 미리듣기와 결과를 들어 확인해 주세요.</span>
            </label>}
            {ttsMode === 'ref' && <span className="field-hint">참조 오디오(5~150초, WAV/MP3)로 Typecast 즉시 목소리 복제를 만들어 읽고, 끝나면 임시 목소리를 삭제해 슬롯을 비웁니다.</span>}
            {typecastPlan && <span className="field-hint">Typecast 플랜: {typecastPlan.plan}{typecastPlan.creditsLeft !== null ? ` · 남은 크레딧 ${typecastPlan.creditsLeft.toLocaleString()}${typecastPlan.creditsTotal ? ` / ${typecastPlan.creditsTotal.toLocaleString()}` : ''}` : ''}{!typecastPlan.cloneAvailable ? ' · 현재 플랜은 목소리 복제 불가(유료 플랜 필요)' : ''}</span>}
            <label className="at-field">감정<select value={typecastEmotion} onChange={event => setTypecastEmotion(event.target.value)} disabled={running}>{TYPECAST_EMOTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><span className="field-hint">스마트는 앞뒤 문장을 보고 감정을 자동으로 정합니다. 텍스트는 Typecast 클라우드 서버로 전송되며 사용량만큼 크레딧이 차감됩니다. 목소리별로 지원하는 감정이 다를 수 있습니다.</span></label>
          </>}
        </>}
        {isAsr && <>
          <div className="at-section-head">모델 선택</div>
          <div className="audio-tools-model-switch" role="group" aria-label="음성 인식 (STT) 모델">
            {asrModels.map(family => <button key={family.id} type="button" className={asrFamily === family.id ? 'active' : ''} aria-pressed={asrFamily === family.id} onClick={() => setAsrFamily(family.id)} disabled={running}>{family.label}</button>)}
          </div>
          <div className="runtime-options">
            <label>크기<select value={asrSize} onChange={event => setAsrSize(event.target.value)} disabled={running} aria-label="음성 인식 (STT) 모델 크기">{(asrFamilyInfo?.variants || []).map(variant => <option key={variant.size} value={variant.size}>{variant.size}</option>)}</select></label>
            <label>정밀도<select value={asrPrecision} onChange={event => setAsrPrecision(event.target.value)} disabled={running} aria-label="음성 인식 (STT) 모델 정밀도">{(asrVariant?.precisions || []).map(item => <option key={item.precision} value={item.precision}>{TTS_PRECISION_LABELS[item.precision] || item.precision}{item.installed ? '' : ' · 받기 필요'}</option>)}</select></label>
          </div>
          {renderModelStatus(asrPrecisionInfo, asrFamily, 'asr', asrSize, asrPrecision)}
          {(asrFamilyInfo?.languages?.length ?? 1) > 0 && <label className="at-field">인식 언어<select value={asrLanguage} onChange={event => setAsrLanguage(event.target.value as typeof asrLanguage)} disabled={running}>{[['ko', '한국어'], ['en', 'English'], ['ja', '日本語'], ['zh', '中文']].filter(([id]) => !asrFamilyInfo?.languages || asrFamilyInfo.languages.includes(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="auto">자동 감지</option></select><span className="field-hint">언어를 직접 지정하면 정확도가 더 높습니다. 모델마다 지원 언어 목록이 다릅니다.</span></label>}
          <span className="field-hint">모델 크기가 클수록 정확하지만 느리고 VRAM을 더 씁니다. VibeVoice-ASR는 약 10GB라 다른 GPU 작업과 함께 쓰면 메모리가 부족할 수 있습니다.</span>
        </>}
        {isSfx && <>
          <div className="at-section-head">모델 선택 (Stable Audio 3 SFX)</div>
          <div className="runtime-options" style={{ gridTemplateColumns: '1fr' }}>
            <label>정밀도<select value={sfxPrecision} onChange={event => setSfxPrecision(event.target.value)} disabled={running} aria-label="효과음 모델 정밀도">{(sfxVariant?.precisions || []).map(item => <option key={item.precision} value={item.precision}>{TTS_PRECISION_LABELS[item.precision] || item.precision}{item.installed ? '' : ' · 받기 필요'}</option>)}</select></label>
          </div>
          {renderModelStatus(sfxPrecisionInfo, 'stablesfx', 'sfx', 'Small', sfxPrecision)}
          <span className="field-hint">글로 설명한 소리(발소리, 문 닫는 소리, 비, 폭발 등)를 짧은 효과음으로 만듭니다. 이 모델은 영어 설명만 이해합니다. 음악은 만들지 못하고 최대 30초까지 지원합니다.</span>
          <label className="at-field">효과음 설명 (영어)<Textarea rows={3} className="at-textarea" value={sfxPrompt} onChange={event => setSfxPrompt(event.target.value)} placeholder="예) footsteps on gravel, close perspective, crisp natural stone texture" disabled={running}/></label>
          <label className="at-field">빼고 싶은 소리 (선택, 영어)<Input type="text" value={sfxNegative} onChange={event => setSfxNegative(event.target.value)} placeholder="예) music, voices, noise" disabled={running}/></label>
          <div className="runtime-options">
            <label>길이(초)<Input type="number" min={1} max={30} step={1} value={sfxDuration} onChange={event => setSfxDuration(event.target.value)} disabled={running}/></label>
            <label>생성 단계<Input type="number" min={1} max={50} step={1} value={sfxSteps} onChange={event => setSfxSteps(event.target.value)} disabled={running}/></label>
          </div>
          <label className="at-field">시드 (선택)<Input type="text" inputMode="numeric" value={sfxSeed} onChange={event => setSfxSeed(event.target.value.replace(/[^0-9]/g, ''))} placeholder="비우면 매번 다르게 생성" disabled={running}/><span className="field-hint">같은 설명과 시드는 같은 소리를 만듭니다. 생성 단계가 많을수록 다듬어지지만 느립니다(기본 8).</span></label>
        </>}
        {isEdit && <>
          <div className="at-section-head">모델 선택 (DotTTS Edit)</div>
          <div className="runtime-options">
            <label>정밀도<select value={editPrecision} onChange={event => setEditPrecision(event.target.value)} disabled={running} aria-label="대사 편집 모델 정밀도">{(editVariant?.precisions || []).map(item => <option key={item.precision} value={item.precision}>{TTS_PRECISION_LABELS[item.precision] || item.precision}{item.installed ? '' : ' · 받기 필요'}</option>)}</select></label>
            <label>언어<select value={editLanguage} onChange={event => setEditLanguage(event.target.value as typeof editLanguage)} disabled={running} aria-label="대사 편집 언어"><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option><option value="auto">자동 감지</option></select></label>
          </div>
          {renderModelStatus(editPrecisionInfo, 'dotsedit', 'edit', '기본', editPrecision)}
          <span className="field-hint">녹음된 말소리에서 일부 단어만 바꾸거나 지우거나 넣습니다(나머지 목소리·억양은 유지). 노래에는 쓸 수 없습니다. 긴 녹음은 무음 기준으로 문장을 나눠 편집할 문장만 다시 만들기 때문에 다른 문장은 원본 그대로 유지됩니다. 언어를 직접 지정하면 결과가 달라질 수 있으니 두 가지를 모두 들어 보세요. 지우기·넣기는 안정적이고, 바꾸기는 한 글자짜리 짧은 단어에서 발음이 어긋날 수 있습니다. 정밀도가 높을수록 정확하지만 더 큽니다.</span>
          <label className="at-function" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={editPrecise} onChange={event => setEditPrecise(event.target.checked)} disabled={running}/>단어 단위 정밀 편집 (권장)</label>
          {editPrecise && renderModelStatus(alignInfo, 'qwen3align', 'align', '0.6B', 'q8_0')}
          <span className="field-hint">단어별 시간 정렬 모델(Qwen3 Forced Aligner, 약 1.1GB)로 바꿀 단어와 앞뒤 단어만 잘라 다시 만들고 나머지는 원본 그대로 둡니다. 체크를 끄거나 모델이 없으면 문장 단위로 편집하며, 이때는 문장 안의 다른 단어가 깨질 수 있습니다. 시간이 조금 더 걸립니다.</span>
          <div className="at-section-head" style={{ marginTop: 18 }}>원문 (말한 내용) <span style={{ fontWeight: 400, opacity: 0.7 }}>(선택 사항)</span></div>
          <Textarea rows={3} className="at-textarea" value={editSourceText} onChange={event => setEditSourceText(event.target.value)} placeholder="원본 오디오가 말하는 문장을 정확히 적어 주세요. 비워 두면 실행할 때 음성 인식(STT)으로 자동 입력합니다. 쉬는 구간이 있는 긴 녹음은 문장별로 나눠 각각 받아쓰고, 편집이 필요한 문장만 다시 만들어 붙이니 원문을 적지 않아도 됩니다(문장이 하나뿐일 때만 여기에 적은 원문을 씁니다)." disabled={running}/>
          <div className="voice-convert-topbar" style={{ justifyContent: 'flex-start' }}><Button variant="outline" size="sm" onClick={() => void transcribeSource()} disabled={running || transcribing || !audioName}>{transcribing ? <LoaderCircle className="spin" size={13}/> : <Sparkles size={13}/>}받아쓰기 (STT)</Button><span className="field-hint">STT 탭에서 고른 음성 인식 모델을 씁니다.</span></div>
          <div className="at-section-head" style={{ marginTop: 18 }}>편집 내용</div>
          {editItems.map((item, index) => <div key={index} className="voice-convert-topbar" style={{ justifyContent: 'flex-start', gap: 6, flexWrap: 'nowrap' }}>
            <select value={item.op} onChange={event => updateEditItem(index, { op: event.target.value as 'sub' | 'del' | 'ins' | 'apd' })} disabled={running} aria-label="편집 종류"><option value="sub">바꾸기</option><option value="del">지우기</option><option value="ins">앞에 넣기</option><option value="apd">뒤에 넣기</option></select>
            <Input type="text" value={item.find} onChange={event => updateEditItem(index, { find: event.target.value })} placeholder={item.op === 'ins' ? '이 말 앞에' : item.op === 'apd' ? '이 말 뒤에' : '원문의 이 말을'} disabled={running} style={{ flex: 1, minWidth: 0 }}/>
            {item.op !== 'del' && <Input type="text" value={item.text} onChange={event => updateEditItem(index, { text: event.target.value })} placeholder={item.op === 'ins' || item.op === 'apd' ? '넣을 말' : '바꿀 말'} disabled={running} style={{ flex: 1, minWidth: 0 }}/>}
            <label className="at-function" title="같은 말이 여러 번 나오면 전부 적용" style={{ flex: 'none', display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', padding: '6px 9px' }}><input type="checkbox" checked={item.all} onChange={event => updateEditItem(index, { all: event.target.checked })} disabled={running}/>모두</label>
            <Button variant="outline" size="sm" aria-label="편집 항목 삭제" title="삭제" onClick={() => setEditItems(items => (items.length > 1 ? items.filter((_, position) => position !== index) : [{ op: 'sub', find: '', text: '', all: false }]))} disabled={running}><X size={13}/></Button>
          </div>)}
          <div className="voice-convert-topbar" style={{ justifyContent: 'flex-start' }}><Button variant="outline" size="sm" onClick={() => setEditItems(items => [...items, { op: 'sub', find: '', text: '', all: false }])} disabled={running || editItems.length >= 20}>+ 편집 항목 추가</Button></div>
          <span className="field-hint">"찾을 말"은 원문에 있는 그대로 적어야 하고, 같은 말이 여러 번 나오면 기본은 첫 번째만 편집하고, "모두"를 체크하면 전부 편집합니다. "모두"를 체크하면 주변의 단어나 문장이 깨질 수 있습니다.</span>
        </>}
        {categoryId === 'adjust' && <>
          <div className="at-section-head">조절 값</div>
          <label className="at-field">피치(반음)<Input type="number" step="0.5" min={-24} max={24} value={pitch} onChange={event => setPitch(event.target.value)} disabled={running}/><span className="field-hint">양수는 높게, 음수는 낮게. 속도는 그대로 유지합니다.</span></label>
          <label className="at-field">속도(배)<Input type="number" step="0.05" min={0.25} max={4} value={speed} onChange={event => setSpeed(event.target.value)} disabled={running}/><span className="field-hint">1.25면 25% 빠르게. 피치는 그대로 유지합니다.</span></label>
          <label className="at-field">음량(dB)<Input type="number" step="1" min={-40} max={40} value={volumeDb} onChange={event => setVolumeDb(event.target.value)} disabled={running}/></label>
          <label className="at-function"><input type="checkbox" checked={denoise} onChange={event => setDenoise(event.target.checked)} disabled={running}/>배경 노이즈 줄이기 (FFT 방식)</label>
        </>}
        {isVc && <>
          <div className="at-section-head">모델 (MeanVC2)</div>
          <div className="runtime-options" style={{ gridTemplateColumns: '1fr' }}><label>정밀도<select value={meanvcPrecision} onChange={event => setMeanvcPrecision(event.target.value as 'q4_k' | 'fp32')} disabled={running}><option value="q4_k">Q4 (342MB)</option><option value="fp32">FP32 (1.6GB)</option></select></label></div>
          {renderModelStatus(meanvcInfo, 'meanvc2', 'vc', '120ms/40ms', meanvcPrecision)}
          <span className="field-hint">참조 음성의 목소리로 말소리를 바꾸는 제로샷 변환입니다(언어 무관). 참조 음성은 앞 20초만 사용합니다. 말소리용이라 노래는 깨질 수 있어, 노래는 음색 변조 메뉴(Seed-VC·Vevo·RVC 등)를 쓰세요.</span>
        </>}
        {needsAudio && <div>
          <div className="at-section-head" style={{ marginTop: 18 }}>{audioLabel} 선택</div>
          <div className="voice-convert-topbar" style={{ justifyContent: 'flex-start' }}>
            <Button variant="outline" className="voice-convert-file-btn" onClick={() => fileInputRef.current?.click()} disabled={running} title={audioName || undefined}>
              <Upload size={14}/><span className="voice-convert-file-name">{audioName || `${audioLabel} 선택`}</span>
            </Button>
            <Button variant="outline" onClick={() => setAudioPickerOpen(true)} disabled={running}><FolderOpen size={14}/>라이브러리</Button>
            {isVc && <Button variant="outline" style={{ marginLeft: 'auto' }} onClick={() => void openMicPanel()} disabled={running}><Mic size={14}/>마이크 입력 (녹음)</Button>}
            <input ref={fileInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/ogg" hidden onChange={handlePickFile}/>
          </div>
          {isVc && <>
            <div className="at-section-head" style={{ marginTop: 18 }}>참조 목소리 선택 (목표 음색)</div>
            <div className="voice-convert-topbar">
              <Button variant="outline" className="voice-convert-file-btn" onClick={() => refInputRef.current?.click()} disabled={running} title={refName || undefined}>
                <Upload size={14}/><span className="voice-convert-file-name">{refName || '참조 목소리 선택'}</span>
              </Button>
              <Button variant="outline" onClick={() => setRefPickerOpen(true)} disabled={running}><FolderOpen size={14}/>라이브러리</Button>
              <input ref={refInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/ogg" hidden onChange={handlePickRefFile}/>
            </div>
          </>}
        </div>}
        {isTts && <>
          {!isTypecast && (ttsMode !== 'preset' || ttsFamily === 'qwen3') && <label className="at-field">스타일 지시 (선택)<Input type="text" value={ttsStyle} onChange={event => setTtsStyle(event.target.value)} placeholder={ttsFamily === 'voxcpm2' ? '예) gentle and slow, whispering softly' : '예) Very happy.'} disabled={running || !(ttsFamily === 'voxcpm2' || (ttsFamily === 'qwen3' && ttsMode === 'preset'))}/><span className="field-hint">{ttsFamily === 'voxcpm2' || (ttsFamily === 'qwen3' && ttsMode === 'preset') ? '말투·감정을 글로 지시합니다(예: 천천히, 속삭이듯, 기쁘게). 영어 지시가 가장 잘 먹히며, 한국어 문장에서 반영 정도는 직접 들어보고 확인해 주세요.' : '이 모델은 스타일 지시를 지원하지 않습니다. VoxCPM2 또는 Qwen3-TTS 프리셋 목소리를 선택하면 사용할 수 있습니다.'}</span></label>}
          {!isTypecast && ttsMode === 'preset' && <label className="at-field">프리셋 목소리
            <div className="voice-convert-topbar">
              <select value={ttsVoice} onChange={event => setTtsVoice(event.target.value)} disabled={running} aria-label="프리셋 목소리">{(ttsModels.find(family => family.id === ttsFamily)?.voices || []).map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</select>
              <Button variant="outline" size="sm" disabled={running || previewing || !ttsPrecisionInfo?.installed} onClick={() => void previewPresetVoice()}>{previewing ? <LoaderCircle className="spin" size={13}/> : <Play size={13}/>}미리듣기</Button>
            </div>
            <span className="field-hint">미리듣기는 짧은 샘플 문장을 한 번 생성해 저장해 두며, 같은 목소리는 다음부터 바로 재생됩니다. 모델이 설치되어 있어야 합니다.</span>
          </label>}
          {!isTypecast && ttsMode === 'design' && <label className="at-field">음색 설명<Input type="text" value={ttsDescription} onChange={event => setTtsDescription(event.target.value)} placeholder="예) 따뜻하고 부드러운 남성 재즈 보컬" disabled={running}/></label>}
          <label className="at-field">말할 내용<Textarea rows={5} className="at-textarea" value={ttsText} onChange={event => setTtsText(event.target.value)} placeholder="여러 줄로 입력해 주세요. 실제 발화할 텍스트입니다." disabled={running}/></label>
          {!isTypecast && ttsMode === 'ref' && <label className="at-field">참조 목소리 텍스트 (선택)<Input type="text" value={referenceText} onChange={event => setReferenceText(event.target.value)} placeholder="참조 오디오에서 말하는 내용" disabled={running}/><span className="field-hint">비워 두면 Qwen3는 참조 오디오를 Qwen3-ASR로 자동으로 받아써서 채웁니다(ASR 모델이 없으면 목소리 특징만 추출). CosyVoice3는 비워 둘 때 cross_lingual 방식으로 동작하며 깨끗한 참조에서 더 안정적입니다.</span></label>}
          {!isTypecast && <label className="at-field">발화 언어<select value={speechLanguage} onChange={event => setSpeechLanguage(event.target.value as 'auto' | 'en' | 'ko')} disabled={running}><option value="auto">자동 (내용 문자에 맞춤)</option><option value="ko">한국어</option><option value="en">English</option></select><span className="field-hint">긴 텍스트는 문장 단위로 나눠 생성한 뒤 이어붙입니다. Qwen3-TTS는 한국어를 고르면 섞인 영어 문장을 생략할 수 있으니 혼합 문장은 자동을 권장합니다.</span></label>}
          <p className="field-hint at-run-summary">실행: {tool.description}</p>
        </>}
        <Button onClick={() => void run()} disabled={running}>{running ? <LoaderCircle className="spin"/> : <Sparkles size={14}/>}{running ? '작업 중...' : '실행'}</Button>
        {warningText && <p className="field-hint warning">{warningText}</p>}
        {errorText && <p className="field-hint warning">{errorText}</p>}
      </div>
      <div className="audio-tools-result">
        {isVc && micPanelOpen && <div className="at-result-row" style={{ border: '1px solid #3b493d', borderRadius: 10, padding: 10, marginBottom: 10, marginLeft: 'var(--chart-left)', marginRight: 'var(--chart-right)' }}>
          <div className="audio-compare-toolbar" style={{ flexWrap: 'wrap', gap: 8, marginLeft: 0, marginRight: 0 }}>
            <Mic size={16} style={{ color: recState === 'recording' ? '#f87171' : undefined }}/>
            <select value={micId} onChange={event => setMicId(event.target.value)} disabled={recState !== 'idle'} aria-label="입력 장치" style={{ flex: 1, minWidth: 140, background: '#232b23', color: '#e4ece0', border: '1px solid #3b493d', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>{micDevices.length === 0 && <option value="">입력 장치 없음</option>}{micDevices.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select>
            <Button variant="outline" size="sm" aria-label="녹음 시작" title="녹음 시작" onClick={() => void startRecording()} disabled={recState !== 'idle' || running}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: '#f87171' }}/></Button>
            <Button variant="outline" size="sm" aria-label={recState === 'paused' ? '녹음 계속' : '일시정지'} title={recState === 'paused' ? '녹음 계속' : '일시정지'} onClick={pauseRecording} disabled={recState === 'idle'}>{recState === 'paused' ? <Play size={13}/> : <Pause size={13}/>}</Button>
            <Button variant="outline" size="sm" aria-label="정지" title="정지하고 원본으로 사용" onClick={stopRecording} disabled={recState === 'idle'}><Square size={13}/></Button>
            <select value={String(micGain)} onChange={event => setMicGain(event.target.value === 'auto' ? 'auto' : Number(event.target.value))} aria-label="파형 감도" title="파형 감도(화면 표시만 키움, 녹음에는 영향 없음)" style={{ background: '#232b23', color: '#e4ece0', border: '1px solid #3b493d', borderRadius: 6, padding: '5px 6px', fontSize: 12 }}><option value="auto">감도 자동</option><option value="1">×1</option><option value="2">×2</option><option value="4">×4</option><option value="8">×8</option><option value="16">×16</option></select>
            <span className="pp-seek-time" style={{ minWidth: 48, textAlign: 'right', color: recState === 'recording' ? '#f87171' : undefined }}>{formatSeekTime(recSeconds)}</span>
            <Button variant="outline" size="sm" aria-label="마이크 닫기" title="마이크 닫기" onClick={closeMicPanel} disabled={running}><X size={13}/></Button>
          </div>
          <canvas ref={micCanvasRef} aria-label="마이크 실시간 파형(시간)" style={{ width: '100%', height: 90, marginTop: 8, borderRadius: 8, background: '#161d12', border: '1px solid #2b352b' }}/>
          <canvas ref={micSpectrumRef} aria-label="마이크 주파수 스펙트럼" style={{ width: '100%', height: 110, marginTop: 8, borderRadius: 8, background: '#161d12', border: '1px solid #2b352b' }}/>
          <span className="field-hint">{recState === 'recording' ? '녹음 중… 말한 뒤 정지를 누르면 아래 원본 파형으로 들어갑니다.' : recState === 'paused' ? '일시정지됨. 재생 아이콘으로 이어서 녹음합니다.' : '말하면 위 파형이 움직입니다(입력 레벨 확인). 준비되면 녹음 버튼(●)을 누르세요. 정지하면 원본 오디오가 됩니다.'}</span>
        </div>}
        {!sourceBuffer && !resultBuffer && transcript === null && !(isVc && micPanelOpen) ? <div className="audio-tools-result-empty"><CircleHelp size={18}/><p>왼쪽에서 조건을 입력하고 "실행"을 누르면<br/>결과가 이곳에 표시됩니다.</p></div> : <>
          {sourceBuffer && needsAudio && <div className={atRowClass('source', 'dry')}>
            <div className="audio-compare-toolbar">
              <button type="button" className="pp-waveform-label" aria-label="원본 재생/일시정지" onClick={() => t.handleKeyClick('source')}>{t.activeKey === 'source' && t.isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
              <span className="stem-label audio-compare-label"><strong>{isTts ? '참조' : '원본'}</strong>{audioName && <small title={audioName}>{audioName}</small>}<span className="small-badge">입력</span></span>
              <span className="pp-seek-time audio-compare-duration">{formatSeekTime(sourceBuffer.duration)}</span>
            </div>
            <div className="audio-compare-charts">
              <CompareWaveform peaks={t.peaksForKey('source')} fraction={t.positionSeconds / (sourceBuffer.duration || 1)} processed={false}/>
              <CompareSpectrogram buffer={sourceBuffer} fraction={t.positionSeconds / (sourceBuffer.duration || 1)}/>
            </div>
          </div>}
          {isVc && t.bufferForKey('reference') && <div className={atRowClass('reference', 'dry')}>
            <div className="audio-compare-toolbar">
              <button type="button" className="pp-waveform-label" aria-label="참조 재생/일시정지" onClick={() => t.handleKeyClick('reference')}>{t.activeKey === 'reference' && t.isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
              <span className="stem-label audio-compare-label"><strong>참조</strong>{refName && <small title={refName}>{refName}</small>}<span className="small-badge">목표 음색</span></span>
              <span className="pp-seek-time audio-compare-duration">{formatSeekTime(t.bufferForKey('reference')!.duration)}</span>
            </div>
            <div className="audio-compare-charts">
              <CompareWaveform peaks={t.peaksForKey('reference')} fraction={t.positionSeconds / (t.bufferForKey('reference')!.duration || 1)} processed={false}/>
            </div>
          </div>}
          {isAsr ? <div className="at-field">
            <span className="at-field-label">인식된 텍스트</span>
            <Textarea rows={12} className="at-textarea" value={transcript ?? ''} onChange={event => setTranscript(event.target.value)} placeholder="실행하면 인식된 텍스트가 이곳에 표시됩니다."/>
          </div> : <div className={atRowClass('output', 'wet')}>
            <div className="audio-compare-toolbar">
              <button type="button" className="pp-waveform-label" aria-label="처리본 재생/일시정지" onClick={() => t.handleKeyClick('output')} disabled={!resultBuffer}>{t.activeKey === 'output' && t.isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
              <span className="stem-label audio-compare-label"><strong>처리본</strong><small>{isTts ? tool.label : isVc ? '음색 변조' : isEdit ? '대사 편집' : isSfx ? '효과음 생성' : '음성 조절'}</small>{resultBuffer ? <span className="small-badge">완료</span> : <span className="small-badge">대기</span>}</span>
              {resultBuffer && <span className="pp-seek-time audio-compare-duration">{formatSeekTime(resultBuffer.duration)}</span>}
            </div>
            <div className="audio-compare-charts">
              <CompareWaveform peaks={t.peaksForKey('output')} fraction={t.positionSeconds / (resultBuffer?.duration || 1)} processed/>
              <CompareSpectrogram buffer={resultBuffer} fraction={t.positionSeconds / (resultBuffer?.duration || 1)}/>
            </div>
            {!resultBuffer && <span className="field-hint audio-tools-pending-hint">아직 결과가 없습니다. 왼쪽에서 "실행"을 누르면 처리본이 여기에 표시됩니다.</span>}
          </div>}
          <SeekRow t={t}/>
          <div className="dialog-actions pp-dialog-actions">
            <TransportControls t={t} disabled={!sourceBuffer && !resultBuffer}/>
            <div className="pp-dialog-actions-right">
              <Button variant="outline" onClick={handleCancel} disabled={saving}>취소</Button>
              {isVc && sourceFromMic && <Button variant="outline" onClick={() => void handleSaveSource()} disabled={saving}><Save size={15}/>원본 저장</Button>}
              <Button onClick={() => void handleSave()} disabled={!canSave}>{saving ? <LoaderCircle className="spin"/> : <Save size={15}/>}저장</Button>
            </div>
          </div>
        </>}
      </div>
    </div>
    <MultiFileLibraryPicker open={refPickerOpen} onClose={() => setRefPickerOpen(false)} onConfirm={paths => paths[0] && void pickReferenceFromLibrary(paths[0])} title="참조 목소리 선택" description="목표 음색이 되는 참조 오디오를 라이브러리에서 고릅니다."/>
    <MultiFileLibraryPicker open={audioPickerOpen} onClose={() => setAudioPickerOpen(false)} onConfirm={paths => paths[0] && void pickFromLibrary(paths[0])} title={`${audioLabel} 선택`} description="라이브러리에서 오디오 파일을 고릅니다."/>
  </section>;
}

type DdspJobStatus = { id: string; projectId: string; status: string; targetStep: number; currentStep: number; currentLoss: number | null; featureEncoder?: string | null; pitchExtractor?: string | null; vocoder?: string | null; createdAt: number; updatedAt: number; skippedRefs: string[]; error: string | null };

// 라이브러리 파일 선택기 -- multiple=false(기본, 원본/참조 audio 선택용)면 더블클릭 한 번으로 바로
// 확정되고, multiple=true(DDSP-SVC 레퍼런스 여러 개 선택용)면 체크박스로 여러 개 고른 뒤 "완료"를
// 눌러야 확정된다. 폴더 이동 시 선택은 초기화한다(v1 단순화).
function MultiFileLibraryPicker({ open, onClose, onConfirm, multiple = false, title, description }: { open: boolean; onClose: () => void; onConfirm: (relPaths: string[]) => void; multiple?: boolean; title?: string; description?: string }) {
  const [browsePath, setBrowsePath] = useState('audio-ref');
  const [browseEntries, setBrowseEntries] = useState<{ name: string; type: 'dir' | 'file' }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function loadBrowsePath(relPath: string, fallbackToRoot = false) {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const result = await api<{ path: string; entries: { name: string; type: 'dir' | 'file' }[] }>(`/library/browse?path=${encodeURIComponent(relPath)}`);
      setBrowsePath(result.path);
      setBrowseEntries(result.entries);
      setSelected(new Set());
    } catch (error) {
      if (fallbackToRoot && relPath !== '') { await loadBrowsePath('', false); return; }
      setBrowseError((error as Error).message);
      setBrowseEntries([]);
    } finally { setBrowseLoading(false); }
  }
  useEffect(() => { if (open) void loadBrowsePath(browsePath || 'audio-ref', true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  function navigateInto(name: string) { void loadBrowsePath(browsePath ? `${browsePath}/${name}` : name); }
  function navigateUp() {
    if (!browsePath) return;
    const parts = browsePath.split('/');
    parts.pop();
    void loadBrowsePath(parts.join('/'));
  }
  function toggle(name: string) {
    if (!multiple) { onConfirm([browsePath ? `${browsePath}/${name}` : name]); onClose(); return; }
    setSelected(previous => { const next = new Set(previous); if (next.has(name)) next.delete(name); else next.add(name); return next; });
  }
  function confirm() {
    onConfirm([...selected].map(name => (browsePath ? `${browsePath}/${name}` : name)));
    onClose();
  }

  return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <DialogContent className="studio-dialog voice-convert-browser-dialog">
      <DialogTitle>{title || (multiple ? '레퍼런스 음색 파일 선택 (여러 개 가능)' : '오디오 파일 선택')}</DialogTitle>
      <DialogDescription>{description || (multiple ? 'library 폴더 안의 오디오 파일을 여러 개 골라 주세요. DDSP-SVC 학습에 쓰일 목표 음색 클립들입니다.' : 'library 폴더 안의 오디오 파일을 골라 주세요.')}</DialogDescription>
      <div className="voice-convert-browser-path">
        <Button variant="ghost" size="icon" aria-label="상위 폴더로" onClick={navigateUp} disabled={!browsePath || browseLoading}><ChevronLeft size={15}/></Button>
        <span className="voice-convert-browser-path-text">library/{browsePath}</span>
      </div>
      <div className="voice-convert-browser-list">
        {browseLoading ? <div className="stem-loading"><LoaderCircle className="spin"/>불러오는 중...</div>
        : browseError ? <p className="field-hint warning">{browseError}</p>
        : !browseEntries.length ? <p className="voice-convert-browser-empty">파일이 없습니다.</p>
        : browseEntries.map(entry => <button key={entry.name} type="button" className={`voice-convert-browser-item${selected.has(entry.name) ? ' selected' : ''}`} onClick={() => entry.type === 'dir' ? navigateInto(entry.name) : toggle(entry.name)}>
          {entry.type === 'dir' ? <Folder size={14}/> : multiple ? <input type="checkbox" checked={selected.has(entry.name)} onChange={() => toggle(entry.name)} onClick={event => event.stopPropagation()}/> : <Music2 size={14}/>}
          <span>{entry.name}</span>
        </button>)}
      </div>
      <div className="dialog-actions">
        <Button variant="outline" onClick={onClose}>취소</Button>
        {multiple && <Button onClick={confirm} disabled={!selected.size}>{<Check size={14}/>}완료 ({selected.size}개)</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}

const DDSP_STATUS_LABEL: Record<string, string> = {
  preparing: '준비 중...', preprocessing: '데이터 전처리 중...', training: '학습 중', inferring: '변환 중...', postprocessing: '후처리 중...', completed: '완료', failed: '실패', cancelled: '취소됨',
};


type TimbreEngine = 'seed_vc' | 'vevo2' | 'rvc' | 'ddsp';
const TIMBRE_ENGINES: { id: TimbreEngine; label: string }[] = [
  { id: 'rvc', label: 'RVC' },
  { id: 'seed_vc', label: 'Seed-VC' },
  { id: 'vevo2', label: 'Vevo' },
  { id: 'ddsp', label: 'DDSP-SVC' },
];
function TimbreTransformDialog({ onClose, notify, onCreated, ddspActiveJobs, onDdspJobStarted, onDdspJobCleared }: {
  onClose: () => void; notify: (text: string, error?: boolean) => void; onCreated: (project: Project) => void;
  ddspActiveJobs: Record<string, string>; onDdspJobStarted: (previewId: string, jobId: string) => void; onDdspJobCleared: (previewId: string) => void;
}) {
  const t = useAudioTransport();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState<string | null>(null);
  const referenceBlobRef = useRef<Blob | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [engine, setEngine] = useState<TimbreEngine>('rvc');
  const [chunkSeconds, setChunkSeconds] = useState(10);
  const [overlapSeconds, setOverlapSeconds] = useState(2);
  const [seedF0Condition, setSeedF0Condition] = useState(true);
  const [seedAutoF0Adjust, setSeedAutoF0Adjust] = useState(true);
  const [seedInferenceSteps, setSeedInferenceSteps] = useState(80);
  const [vcModels, setVcModels] = useState<TtsFamilyInfo[]>([]);
  const [rvcPreviewing, setRvcPreviewing] = useState(false);
  const [rvcSearch, setRvcSearch] = useState('');
  const [rvcSearchOpen, setRvcSearchOpen] = useState(false);
  const [rvcManageOpen, setRvcManageOpen] = useState(false);
  const [rvcSearching, setRvcSearching] = useState(false);
  const [rvcResults, setRvcResults] = useState<{ repo: string; downloads: number; license: string }[] | null>(null);
  const [rvcDownloads, setRvcDownloads] = useState<Record<string, { state: string; receivedBytes: number; totalBytes: number; error: string | null; repo: string }>>({});
  const [rvcInstalled, setRvcInstalled] = useState<{ id: string; slug: string; name: string; repo: string; hasIndex: boolean }[]>([]);
  const rvcPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [rvcVoice, setRvcVoice] = useState('default');
  const [rvcSemitone, setRvcSemitone] = useState('0');
  const [rvcRetrieval, setRvcRetrieval] = useState('0');
  const [vevoRoute, setVevoRoute] = useState<'style_preserved_svc' | 'style_preserved_vc'>('style_preserved_svc');
  const [ddspReferencePaths, setDdspReferencePaths] = useState<string[]>([]);
  const [ddspTargetStep, setDdspTargetStep] = useState(40000);
  const [ddspFeatureEncoder, setDdspFeatureEncoder] = useState<'contentvec' | 'hubertsoft'>('contentvec');
  const [ddspPitchExtractor, setDdspPitchExtractor] = useState<'rmvpe' | 'fcpe'>('rmvpe');
  const [ddspVocoder, setDdspVocoder] = useState<'nsf_hifigan' | 'pc_nsf_hifigan'>('nsf_hifigan');
  const [ddspPickerOpen, setDdspPickerOpen] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [warningText, setWarningText] = useState('');
  // 앱에서 만든 곡이면 오디오 옆 {제목}.json에 그대로 저장된 가사가 있다 -- 표시 용도로만 쓴다.
  const [sourceLyrics, setSourceLyrics] = useState<string | null>(null);
  const [ddspJob, setDdspJob] = useState<DdspJobStatus | null>(null);
  const [separatingRef, setSeparatingRef] = useState(false);
  const [refVocalError, setRefVocalError] = useState<string | null>(null);
  const referenceSepTokenRef = useRef(0);
  const ddspResultLoadedRef = useRef<string | null>(null);
  useEffect(() => () => t.closeContext(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const ddspActiveJobId = previewId ? ddspActiveJobs[previewId] || null : null;
  useEffect(() => {
    if (!ddspActiveJobId) { setDdspJob(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const jobs = await api<DdspJobStatus[]>('/ddsp-jobs');
        if (cancelled) return;
        const found = jobs.find(item => item.id === ddspActiveJobId);
        if (!found) return;
        setDdspJob(found);
        if (found.status === 'failed') { setErrorText(found.error || 'DDSP-SVC 학습이 실패했습니다.'); onDdspJobCleared(found.projectId); }
      } catch { /* 네트워크 일시 오류는 다음 폴링에서 재시도 */ }
    };
    void poll();
    const interval = window.setInterval(poll, 3000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [ddspActiveJobId, onDdspJobCleared]);
  // 학습이 completed로 바뀌면 결과 스템을 한 번만 불러와 오른쪽 결과 영역을 채운다.
  useEffect(() => {
    if (!ddspJob || ddspJob.status !== 'completed' || !previewId || ddspResultLoadedRef.current === ddspJob.id) return;
    ddspResultLoadedRef.current = ddspJob.id;
    (async () => {
      try {
        const ctx = t.ensureAudioContext();
        const [vocalsResponse, instrumentalResponse] = await Promise.all([
          fetch(`/api/timbre-transform/${previewId}/stems/vocals`),
          fetch(`/api/timbre-transform/${previewId}/stems/instrumental`),
        ]);
        if (!vocalsResponse.ok || !instrumentalResponse.ok) throw new Error('load failed');
        const [vocalsBuffer, instrumentalBuffer] = await Promise.all([
          ctx.decodeAudioData(await vocalsResponse.arrayBuffer()),
          ctx.decodeAudioData(await instrumentalResponse.arrayBuffer()),
        ]);
        const mixed = await mixBuffers([vocalsBuffer, instrumentalBuffer]);
        t.setBuffer('result', mixed);
        onDdspJobCleared(previewId);
      } catch { setErrorText('학습 결과를 불러오지 못했습니다.'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddspJob, previewId]);

  async function pickSource(relPath: string) {
    setErrorText('');
    t.setBuffer('result', null); t.setBuffer('source-vocal', null); t.setBuffer('source-instrumental', null);
    t.setBuffer('result-vocal', null); t.setBuffer('result-instrumental', null);
    setPreviewId(null);
    setDdspJob(null);
    ddspResultLoadedRef.current = null;
    setPreparing(true);
    setSourceLyrics(null);
    // 앱에서 만든 저장곡이면 오디오와 나란한 {제목}.json에 가사가 있다 -- 있으면 그 가사를 표시한다.
    const jsonPath = relPath.replace(/\.[^.]+$/, '.json');
    api<{ lyrics: string | null }>(`/library/meta?path=${encodeURIComponent(jsonPath)}`).then(meta => { if (meta.lyrics) setSourceLyrics(meta.lyrics); }).catch(() => {});
    try {
      const response = await fetch(`/api/library/file?path=${encodeURIComponent(relPath)}`);
      if (!response.ok) throw new Error('파일을 불러오지 못했습니다.');
      const blob = await response.blob();
      setSourceName(relPath.split('/').pop() || relPath);
      const ctx = t.ensureAudioContext();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      t.setBuffer('source', buffer);
      const dataUrl = await readFileAsDataUrl(blob);
      const prepared = await api<{ previewId: string }>('/timbre-transform/prepare', 'POST', { sourceDataUrl: dataUrl });
      setPreviewId(prepared.previewId);
      const [vocalsResponse, instrumentalResponse] = await Promise.all([
        fetch(`/api/timbre-transform/${prepared.previewId}/stems/vocals`),
        fetch(`/api/timbre-transform/${prepared.previewId}/stems/instrumental`),
      ]);
      if (vocalsResponse.ok && instrumentalResponse.ok) {
        const [vocalsBuffer, instrumentalBuffer] = await Promise.all([
          ctx.decodeAudioData(await vocalsResponse.arrayBuffer()),
          ctx.decodeAudioData(await instrumentalResponse.arrayBuffer()),
        ]);
        t.setBuffer('source-vocal', vocalsBuffer);
        t.setBuffer('source-instrumental', instrumentalBuffer);
      }
    } catch (error) { setErrorText((error as Error).message || '원본 오디오 준비에 실패했습니다.'); }
    finally { setPreparing(false); }
  }

  async function pickReference(relPath: string) {
    setErrorText('');
    try {
      const response = await fetch(`/api/library/file?path=${encodeURIComponent(relPath)}`);
      if (!response.ok) throw new Error('파일을 불러오지 못했습니다.');
      const blob = await response.blob();
      referenceBlobRef.current = blob;
      setReferenceName(relPath.split('/').pop() || relPath);
      try {
        const ctx = t.ensureAudioContext();
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        t.setBuffer('reference', buffer);
      } catch { t.setBuffer('reference', null); }
      void separateReferenceVocal(blob);
    } catch (error) { setErrorText((error as Error).message); }
  }
  // "참조 보컬" 행용: 참조 오디오를 서버에서 STEM 분리해 vocals만 로드한다. 분리 실패는 치명적이지
  // 않으므로 조용히 참조 보컬 행만 비워 두고, 연속 클릭 시 마지막 선택만 적용되도록 토큰으로 거른다.
  async function separateReferenceVocal(blob: Blob) {
    const token = ++referenceSepTokenRef.current;
    t.setBuffer('reference-vocal', null);
    setRefVocalError(null);
    setSeparatingRef(true);
    try {
      const dataUrl = await readFileAsDataUrl(blob);
      const result = await api<{ vocalsDataUrl: string }>('/timbre-transform/reference/separate', 'POST', { referenceDataUrl: dataUrl });
      if (token !== referenceSepTokenRef.current) return;
      const ctx = t.ensureAudioContext();
      const buffer = await ctx.decodeAudioData(await (await fetch(result.vocalsDataUrl)).arrayBuffer());
      t.setBuffer('reference-vocal', buffer);
    } catch (error) {
      if (token !== referenceSepTokenRef.current) return;
      t.setBuffer('reference-vocal', null);
      setRefVocalError((error as Error).message || '참조 보컬 분리에 실패했습니다.');
    }
    finally { if (token === referenceSepTokenRef.current) setSeparatingRef(false); }
  }

  // Seed-VC/Vevo2 적용은 서버가 실시간 %를 안 주므로(DDSP-SVC처럼 스텝 단위 진행이 없음),
  // "노래 만들기"와 같은 방식(POST /generate/status의 elapsedMs/expectedMs 추정치)을 그대로 재사용한다.
  function withEstimatedProgress<T>(run: () => Promise<T>): Promise<T> {
    setApplyProgress(0);
    const poll = window.setInterval(() => {
      api<{ active: boolean; elapsedMs: number; expectedMs: number; progress?: number }>('/generate/status').then(status => {
        if (!status.active) return;
        if (Number.isFinite(status.progress)) setApplyProgress(Math.min(96, Math.max(0, Math.round(status.progress as number))));
        else if (status.expectedMs > 0) setApplyProgress(Math.min(96, Math.round(status.elapsedMs / status.expectedMs * 100)));
      }).catch(() => {});
    }, 500);
    return run().finally(() => { window.clearInterval(poll); setApplyProgress(100); });
  }

  async function previewRvcVoice(voiceId: string = rvcVoice) {
    if (!previewId) return;
    setRvcPreviewing(true);
    setErrorText('');
    try {
      const result = await api<{ dataUrl: string }>(`/timbre-transform/${previewId}/rvc-preview`, 'POST', { rvcVoice: voiceId, rvcSemitone: Number(rvcSemitone) || 0, rvcRetrieval: Number(rvcRetrieval) || 0 });
      rvcPreviewAudioRef.current?.pause();
      rvcPreviewAudioRef.current = new Audio(result.dataUrl);
      await rvcPreviewAudioRef.current.play();
    } catch (error) { setErrorText((error as Error).message); }
    finally { setRvcPreviewing(false); }
  }
  async function refreshRvcVoices() {
    try {
      const result = await api<{ installed: typeof rvcInstalled; downloads: typeof rvcDownloads }>('/rvc-voices');
      setRvcInstalled(result.installed);
      setRvcDownloads(result.downloads);
      await refreshVcModels();
    } catch { /* backend may be restarting */ }
  }
  async function searchRvcOnline() {
    setRvcSearching(true);
    setErrorText('');
    try { setRvcResults((await api<{ results: { repo: string; downloads: number; license: string }[] }>(`/rvc-voices/search?q=${encodeURIComponent(rvcSearch)}`)).results); }
    catch (error) { setErrorText((error as Error).message); }
    finally { setRvcSearching(false); }
  }
  async function downloadRvcOnline(repo: string, license: string) {
    try { await api('/rvc-voices/download', 'POST', { repo, license }); await refreshRvcVoices(); }
    catch (error) { setErrorText((error as Error).message); }
  }
  async function deleteRvcOnline(id: string) {
    try { await api('/rvc-voices/delete', 'POST', { id }); if (rvcVoice === id) setRvcVoice('default'); await refreshRvcVoices(); }
    catch (error) { setErrorText((error as Error).message); }
  }
  useEffect(() => { void refreshRvcVoices(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rvcDownloading = Object.values(rvcDownloads).some(item => item.state === 'running');
  useEffect(() => {
    if (!rvcDownloading) return;
    const timer = window.setInterval(() => void refreshRvcVoices(), 1500);
    return () => window.clearInterval(timer);
  }, [rvcDownloading]); // eslint-disable-line react-hooks/exhaustive-deps
  async function refreshVcModels() {
    try { setVcModels((await api<{ vc: TtsFamilyInfo[] }>('/audio-tools/tts/models')).vc || []); } catch { /* backend may be restarting */ }
  }
  async function downloadVcModel() {
    if (!vcFamilyId) return;
    try {
      await api('/audio-tools/tts/download', 'POST', { family: vcFamilyId, mode: 'vc', size: '기본', precision: 'f16' });
      await refreshVcModels();
    } catch (error) { setErrorText((error as Error).message); }
  }
  useEffect(() => { void refreshVcModels(); }, []);
  const vcDownloading = vcModels.some(family => family.variants.some(variant => variant.precisions.some(item => item.download?.state === 'running')));
  useEffect(() => {
    if (!vcDownloading) return;
    const timer = window.setInterval(() => void refreshVcModels(), 2000);
    return () => window.clearInterval(timer);
  }, [vcDownloading]);
  async function applyLegacy() {
    if (!previewId || (engine !== 'rvc' && !referenceBlobRef.current)) return;
    setApplying(true);
    setErrorText('');
    setWarningText('');
    try {
      await withEstimatedProgress(async () => {
        const dataUrl = referenceBlobRef.current ? await readFileAsDataUrl(referenceBlobRef.current) : undefined;
        const result = await api<{ ok: boolean; warning: string | null }>(`/timbre-transform/${previewId}/legacy/apply`, 'POST', { dataUrl, engine, seedF0Condition, seedAutoF0Adjust, seedInferenceSteps, vevoRoute, rvcVoice, rvcSemitone: Number(rvcSemitone) || 0, rvcRetrieval: Number(rvcRetrieval) || 0, chunkSeconds, overlapSeconds });
        setWarningText(result.warning || '');
        const ctx = t.ensureAudioContext();
        const [vocalsResponse, instrumentalResponse] = await Promise.all([
          fetch(`/api/timbre-transform/${previewId}/stems/vocals`),
          fetch(`/api/timbre-transform/${previewId}/stems/instrumental`),
        ]);
        if (!vocalsResponse.ok || !instrumentalResponse.ok) throw new Error('load failed');
        const [vocalsBuffer, instrumentalBuffer] = await Promise.all([
          ctx.decodeAudioData(await vocalsResponse.arrayBuffer()),
          ctx.decodeAudioData(await instrumentalResponse.arrayBuffer()),
        ]);
        t.setBuffer('result-vocal', vocalsBuffer);
        t.setBuffer('result-instrumental', instrumentalBuffer);
        const mixed = await mixBuffers([vocalsBuffer, instrumentalBuffer]);
        t.setBuffer('result', mixed);
      });
    } catch (error) {
      const message = error instanceof Error && error.message && error.message !== 'load failed' ? error.message : '보컬 음색 변환에 실패했습니다. audio.cpp가 Seed-VC/Vevo2 모델을 포함해 빌드되어 있는지, 모델 파일이 있는지 확인해 주세요.';
      setErrorText(message);
    } finally { setApplying(false); }
  }

  async function startDdspTraining() {
    if (!previewId || !ddspReferencePaths.length) return;
    setStarting(true);
    setErrorText('');
    ddspResultLoadedRef.current = null;
    setDdspJob(null);
    try {
      const referenceDataUrls = await Promise.all(ddspReferencePaths.map(async relPath => {
        const response = await fetch(`/api/library/file?path=${encodeURIComponent(relPath)}`);
        if (!response.ok) throw new Error(`파일을 불러오지 못했습니다: ${relPath}`);
        return readFileAsDataUrl(await response.blob());
      }));
      const result = await api<{ jobId: string }>(`/timbre-transform/${previewId}/ddsp/start`, 'POST', { referenceDataUrls, targetStep: ddspTargetStep, featureEncoder: ddspFeatureEncoder, pitchExtractor: ddspPitchExtractor, vocoder: ddspVocoder });
      onDdspJobStarted(previewId, result.jobId);
      notify('DDSP-SVC 학습을 시작했습니다. 창을 닫아도 계속 진행됩니다.');
    } catch (error) { setErrorText((error as Error).message); }
    finally { setStarting(false); }
  }

  async function handleSave() {
    const buffer = t.bufferForKey('result');
    if (!buffer || !sourceName) return;
    setSaving(true);
    try {
      t.stopPlayback();
      const wavBlob = audioBufferToWavBlob(buffer);
      const dataUrl = await readFileAsDataUrl(wavBlob);
      const base = sourceName.replace(/\.[^.]+$/, '');
      const engineLabel = TIMBRE_ENGINES.find(item => item.id === engine)?.label || engine;
      const completed = await api<Project>('/audio-save', 'POST', { dataUrl, title: `${base} (${engineLabel} 음색 변조)` });
      onCreated(completed);
      notify('음색을 변환해 라이브러리에 추가했습니다.');
    } catch (error) { setErrorText((error as Error).message); }
    finally { setSaving(false); }
  }

  const isLegacy = engine !== 'ddsp';
  const vcFamilyId = engine === 'rvc' ? engine : null;
  const vcFamily = vcModels.find(family => family.id === vcFamilyId);
  const vcPrecisionInfo = vcFamily?.variants[0]?.precisions.find(item => item.precision === 'f16');
  const vcModelReady = !vcFamilyId || !!vcPrecisionInfo?.installed;
  const isTraining = !!ddspJob && !['completed', 'failed', 'cancelled'].includes(ddspJob.status);
  const busy = preparing || applying || starting;
  const canApply = engine === 'ddsp' ? !!ddspReferencePaths.length && !!previewId && !isTraining
    : engine === 'rvc' ? !!previewId && vcModelReady
    : !!previewId && !!referenceName && vcModelReady;
  const resultBuffer = t.bufferForKey('result');
  const ddspProgress = ddspJob?.targetStep ? Math.min(100, Math.round(ddspJob.currentStep / ddspJob.targetStep * 100)) : 0;
  // 레거시 목록은 원곡/참고곡/변환곡을 색으로 구분하므로, 재생 중 글로우도 그 가족 색을 따르게 한다.
  const legacyRowClass = (key: string, base: string) => {
    const family = key === 'source' || key === 'source-vocal' || key === 'source-instrumental' ? 'source' : key === 'reference' || key === 'reference-vocal' ? 'reference' : 'processed';
    return `${base}${t.activeKey === key && t.isPlaying ? ` pp-row-playing-${family}` : ''}`;
  };

  return <Dialog open onOpenChange={next => { if (!next) onClose(); }}>
    <DialogContent className="studio-dialog audio-compare-dialog timbre-transform-dialog">
      <DialogTitle>음색 변조 (평가중)</DialogTitle>
      <DialogDescription>라이브러리에서 원본과 참조 audio를 고르고, 모델을 골라 음색을 바꿔 보세요.</DialogDescription>
      <div className="timbre-transform-body">
        <div className="timbre-left-panel">
          <div className="timbre-section-heading">Audio 선택</div>
          <Button variant="outline" className="voice-convert-file-btn" onClick={() => setSourcePickerOpen(true)} disabled={busy} title={sourceName || undefined}>
            <Upload size={14}/><span className="voice-convert-file-name">{sourceName || '원본 audio 선택'}</span>
          </Button>
          <Button variant="outline" className={`voice-convert-file-btn${engine === 'rvc' ? ' disabled' : ''}`} onClick={() => setReferencePickerOpen(true)} disabled={busy || engine === 'rvc'} title={engine === 'rvc' ? 'RVC는 참조 audio 없이 내장 목소리를 씁니다.' : referenceName || undefined}>
            <Upload size={14}/><span className="voice-convert-file-name">{referenceName || '참조 audio 선택'}</span>
          </Button>

          <div className="timbre-section-heading">모델 Selection</div>
          <div className="timbre-model-grid" role="group" aria-label="음색 변조 모델">
            {TIMBRE_ENGINES.map(item => <button key={item.id} type="button" className={`timbre-model-btn${engine === item.id ? ' active' : ''}`} onClick={() => setEngine(item.id)} disabled={busy}>{item.label}</button>)}
          </div>

          {engine !== 'ddsp' && engine !== 'rvc' && <div className="timbre-engine-options">
            <div className="timbre-option-head" style={{ marginTop: 16 }}>긴 보컬 자동 분할 기준</div>
            <div className="runtime-options" style={{ gridTemplateColumns: '1fr 1fr' }}><label>청크(초)<Input type="number" min={1} max={120} value={chunkSeconds} onChange={event => setChunkSeconds(Math.max(1, Math.min(120, Number(event.target.value) || 10)))} disabled={busy}/></label><label>겹침(초)<Input type="number" min={0} value={overlapSeconds} onChange={event => setOverlapSeconds(Math.max(0, Math.min(Math.floor(chunkSeconds / 2), Number(event.target.value) || 0)))} disabled={busy}/></label></div>
            <p className="field-hint">긴 보컬은 청크(초) 단위로 나눠 순차 처리하고 겹침(초)만큼 겹친 뒤 연결합니다. 겹침은 청크의 절반 이하로 자동 조정되며, 겹친 양쪽을 겹침의 절반만큼 잘라 이어붙입니다.</p>
          </div>}

          {engine === 'seed_vc' && <div className="timbre-engine-options">
            <div className="timbre-option-head" style={{ marginTop: 18 }}>Seed-VC 실행 옵션</div>
            <label className="timbre-option-check"><input type="checkbox" checked={seedF0Condition} onChange={event => setSeedF0Condition(event.target.checked)} disabled={busy}/>원곡 음정선 사용 (F0 condition)</label>
            <label className="timbre-option-check"><input type="checkbox" checked={seedAutoF0Adjust} onChange={event => setSeedAutoF0Adjust(event.target.checked)} disabled={busy}/>참조 목소리에 맞춰 음정 자동 조절</label>
            <div className="runtime-options"><label>추론 스텝<Input type="number" min={1} max={200} value={seedInferenceSteps} onChange={event => setSeedInferenceSteps(Math.max(1, Math.min(200, Number(event.target.value) || 80)))} disabled={busy}/></label></div>
            <p className="field-hint">기본값은 노래 변환용으로 확인한 F0 사용 · 자동 음정 조절 · 80스텝입니다.</p>
          </div>}

          {vcFamilyId && <div className="timbre-engine-options">
            <div className="timbre-option-head" style={{ marginTop: 18 }}>RVC 목소리</div>
            {engine === 'rvc' && <>
              <div className="runtime-options" style={{ gridTemplateColumns: '1fr' }}><label>내장 목소리<div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}><select style={{ flex: 1, minWidth: 0 }} value={rvcVoice} onChange={event => setRvcVoice(event.target.value)} disabled={busy}>{(vcFamily?.voices || [{ id: 'default', label: 'default' }]).map(voice => <option key={voice.id} value={voice.id} style={voice.id.startsWith('user:') ? { color: '#7ee787' } : undefined}>{voice.label}</option>)}</select><Button variant="outline" size="sm" aria-label="목소리 듣기" title="원본 보컬 앞 8초를 이 목소리로 바꿔 들어봅니다" disabled={busy || rvcPreviewing || !previewId || !vcModelReady} onClick={() => void previewRvcVoice(rvcVoice)}>{rvcPreviewing ? <LoaderCircle className="spin" size={13}/> : <Play size={13}/>}</Button></div></label>
                </div>
              <div className="runtime-options" style={{ gridTemplateColumns: '1fr 1fr' }}><label>음높이(반음)<Input type="text" inputMode="decimal" value={rvcSemitone} onChange={event => setRvcSemitone(event.target.value)} onBlur={() => setRvcSemitone(String(Math.max(-24, Math.min(24, Math.round(Number(rvcSemitone)) || 0))))} disabled={busy}/></label><label>검색 블렌딩(0~1)<Input type="text" inputMode="decimal" title={rvcVoice === 'default' ? 'default 목소리는 검색 인덱스가 없어 블렌딩을 쓸 수 없습니다(0으로 처리).' : undefined} value={(rvcVoice === 'default' || vcFamily?.voices?.find(voice => voice.id === rvcVoice && (voice as { hasIndex?: boolean }).hasIndex === false) !== undefined) ? '0' : rvcRetrieval} onChange={event => setRvcRetrieval(event.target.value)} onBlur={() => setRvcRetrieval(String(Math.max(0, Math.min(1, Number(rvcRetrieval) || 0))))} disabled={busy || (rvcVoice === 'default' || vcFamily?.voices?.find(voice => voice.id === rvcVoice && (voice as { hasIndex?: boolean }).hasIndex === false) !== undefined)}/></label></div>
              <Button variant="outline" size="sm" onClick={() => setRvcManageOpen(true)} disabled={busy} style={{ marginTop: 8 }}><Trash2 size={13}/>목소리 관리 ({rvcInstalled.length})</Button>
              <Button variant="outline" size="sm" onClick={() => { setRvcSearchOpen(true); if (!rvcResults) void searchRvcOnline(); }} disabled={busy} style={{ marginTop: 4 }}><Search size={13}/>온라인에서 RVC 목소리 찾기</Button>
              <p className="field-hint">받은 목소리는 위 "내장 목소리" 목록에 "이름 · 다운로드"로 추가됩니다. 인덱스 파일이 함께 있는 목소리만 검색 블렌딩을 쓸 수 있습니다. 개인 용도로 쓰되, 실존 인물의 목소리로 타인을 속이는 용도에는 쓰지 마세요.</p>
              <p className="field-hint">RVC는 참조 audio가 아니라 목소리 하나를 골라 바꿉니다(기본 제공 4개와 온라인에서 받은 목소리). 원곡과 음역이 다르면 음높이(반음)로 맞추세요. 검색 블렌딩은 인덱스가 있는 목소리에서만 쓸 수 있고, default와 인덱스가 없는 목소리에서는 자동으로 꺼집니다.</p>
            </>}
            {vcPrecisionInfo && (vcPrecisionInfo.installed
              ? <span className="field-hint">모델 설치됨 · 사용 준비 완료</span>
              : vcPrecisionInfo.download?.state === 'running'
                ? <span className="field-hint">내려받는 중… {vcPrecisionInfo.download.totalBytes ? Math.round(vcPrecisionInfo.download.receivedBytes / vcPrecisionInfo.download.totalBytes * 100) : 0}%</span>
                : <div className="voice-convert-topbar"><Button variant="outline" size="sm" onClick={() => void downloadVcModel()} disabled={busy}><Download size={13}/>모델 받기 (약 {vcPrecisionInfo.sizeMb} MB)</Button>{vcPrecisionInfo.download?.error && <span className="field-hint warning">{vcPrecisionInfo.download.error}</span>}</div>)}
          </div>}

          {engine === 'vevo2' && <div className="timbre-engine-options">
            <div className="timbre-option-head" style={{ marginTop: 18 }}>Vevo 변환 라우트</div>
            <div className="runtime-options"><label>변환 방식<select value={vevoRoute} onChange={event => setVevoRoute(event.target.value as typeof vevoRoute)} disabled={busy}><option value="style_preserved_svc">노래 스타일 유지 SVC (권장)</option><option value="style_preserved_vc">발화 스타일 유지 VC</option></select></label></div>
            <p className="field-hint">노래에는 SVC가 적합합니다. VC는 말소리용이라 넓은 음정 변화가 손상될 수 있습니다.</p>
          </div>}

          {engine === 'ddsp' && <div className="timbre-engine-options">
            <Button variant="outline" className="voice-convert-file-btn" onClick={() => setDdspPickerOpen(true)} disabled={isTraining || starting}>
              <Upload size={14}/><span className="voice-convert-file-name">{ddspReferencePaths.length ? `레퍼런스 ${ddspReferencePaths.length}개 선택됨` : '레퍼런스 선택 (여러 개, 참조 audio와 별개)'}</span>
            </Button>
            <div className="timbre-option-head" style={{ marginTop: 10 }}>DDSP-SVC 구성 요소</div>
            <div className="runtime-options">
              <label>특징 인코더<select value={ddspFeatureEncoder} onChange={event => setDdspFeatureEncoder(event.target.value as typeof ddspFeatureEncoder)} disabled={isTraining || starting}><option value="contentvec">ContentVec (권장)</option><option value="hubertsoft">HubertSoft</option></select></label>
              <label>음정 추출기<select value={ddspPitchExtractor} onChange={event => setDdspPitchExtractor(event.target.value as typeof ddspPitchExtractor)} disabled={isTraining || starting}><option value="rmvpe">RMVPE (권장)</option><option value="fcpe">FCPE</option></select></label>
              <label>보코더<select value={ddspVocoder} onChange={event => setDdspVocoder(event.target.value as typeof ddspVocoder)} disabled={isTraining || starting}><option value="nsf_hifigan">NSF-HiFiGAN (권장)</option><option value="pc_nsf_hifigan">PC-NSF-HiFiGAN</option></select></label>
            </div>
            <label className="field-hint">목표 스텝<Input type="number" min={100} max={500000} step={1000} value={ddspTargetStep} onChange={event => setDdspTargetStep(Number(event.target.value))} disabled={isTraining || starting}/></label>
            <Button onClick={() => void startDdspTraining()} disabled={!canApply || starting}>{starting ? <LoaderCircle className="spin"/> : <Sparkles size={14}/>}학습 시작</Button>
            <p className="field-hint">기본값 40,000스텝은 이 환경 기준 약 1시간 35분 소요(초당 7~10스텝).</p>
          </div>}

          {engine !== 'ddsp' && <div className="timbre-apply-row">
            <Button onClick={() => void applyLegacy()} disabled={!canApply || applying}>{applying ? <LoaderCircle className="spin"/> : <Mic size={14}/>}적용</Button>
          </div>}
          {applying && engine !== 'ddsp' && <div className="timbre-progress-block"><span>적용 중 ({applyProgress}%)</span><Progress value={applyProgress}/></div>}
          {starting && engine === 'ddsp' && <div className="timbre-progress-block"><span>학습 준비 중...</span><Progress value={8}/></div>}
          {ddspJob && <div className="stem-loading">
            {isTraining && <LoaderCircle className="spin"/>}
            {DDSP_STATUS_LABEL[ddspJob.status] || ddspJob.status}
            {ddspJob.status === 'training' && ` (${ddspProgress}%, ${ddspJob.currentStep}/${ddspJob.targetStep} 스텝${ddspJob.currentLoss !== null ? `, loss ${ddspJob.currentLoss.toFixed(3)}` : ''})`}
            {ddspJob.skippedRefs.length > 0 && ` -- ${ddspJob.skippedRefs.length}개 클립은 2초 미만이라 제외됨`}
          </div>}
          {ddspJob?.status === 'training' && <div className="timbre-progress-block"><Progress value={ddspProgress}/></div>}
          {preparing && <div className="stem-loading"><LoaderCircle className="spin"/>원본 오디오 준비 중(보컬/악기 분리)...</div>}
          {errorText && <p className="field-hint warning">{errorText}</p>}
          {warningText && <p className="field-hint warning">{warningText}</p>}
          {sourceLyrics && <p className="field-hint">원곡 가사 (저장된 가사): {sourceLyrics}</p>}
        </div>

        <div className="timbre-main-panel">
          {!sourceName ? <p className="field-hint">왼쪽에서 "원본 audio"를 먼저 골라 주세요.</p> : <>
            {isLegacy ? <div className="stem-list timbre-legacy-list">
              <div className={legacyRowClass('source', 'stem-row')}>
                <button type="button" className="pp-waveform-label" aria-label="원곡 재생/일시정지" onClick={() => t.handleKeyClick('source')} disabled={!t.peaksForKey('source').length}>{t.activeKey === 'source' && t.isPlaying ? <Pause size={15}/> : <AudioLines size={15}/>}</button>
                <span className="stem-label">원곡</span>
                <Waveform peaks={t.peaksForKey('source')} playedFraction={t.playedFraction} variant="source"/>
              </div>
              <div className={legacyRowClass('source-vocal', 'stem-row stem-row-sub')}>
                <button type="button" className="pp-waveform-label" aria-label="원곡 보컬 재생/일시정지" onClick={() => t.handleKeyClick('source-vocal')} disabled={!t.peaksForKey('source-vocal').length}>{t.activeKey === 'source-vocal' && t.isPlaying ? <Pause size={15}/> : <Mic size={15}/>}</button>
                <span className="stem-label">원곡 보컬</span>
                <Waveform peaks={t.peaksForKey('source-vocal')} playedFraction={t.playedFraction} variant="source"/>
              </div>
              <div className={legacyRowClass('source-instrumental', 'stem-row stem-row-sub')}>
                <button type="button" className="pp-waveform-label" aria-label="원곡 악기 재생/일시정지" onClick={() => t.handleKeyClick('source-instrumental')} disabled={!t.peaksForKey('source-instrumental').length}>{t.activeKey === 'source-instrumental' && t.isPlaying ? <Pause size={15}/> : <Guitar size={15}/>}</button>
                <span className="stem-label">원곡 악기</span>
                <Waveform peaks={t.peaksForKey('source-instrumental')} playedFraction={t.playedFraction} variant="source"/>
              </div>
              <div className={legacyRowClass('reference', 'stem-row')}>
                <button type="button" className="pp-waveform-label" aria-label="참고곡 재생/일시정지" onClick={() => t.handleKeyClick('reference')} disabled={!t.peaksForKey('reference').length}>{t.activeKey === 'reference' && t.isPlaying ? <Pause size={15}/> : <Mic size={15}/>}</button>
                <span className="stem-label">참고곡</span>
                <Waveform peaks={t.peaksForKey('reference')} playedFraction={t.playedFraction} variant="reference"/>
              </div>
              <div className={legacyRowClass('reference-vocal', 'stem-row stem-row-sub')}>
                <button type="button" className="pp-waveform-label" aria-label="참조 보컬 재생/일시정지" onClick={() => t.handleKeyClick('reference-vocal')} disabled={!t.peaksForKey('reference-vocal').length}>{t.activeKey === 'reference-vocal' && t.isPlaying ? <Pause size={15}/> : <Mic size={15}/>}</button>
                <span className="stem-label">참조 보컬</span>
                {separatingRef && !t.peaksForKey('reference-vocal').length ? <span className="stem-separating-note"><LoaderCircle className="spin"/>보컬 분리 중...</span>
                  : refVocalError ? <span className="stem-separating-note stem-separating-error"><X size={13}/>{refVocalError}</span>
                  : <Waveform peaks={t.peaksForKey('reference-vocal')} playedFraction={t.playedFraction} variant="reference"/>}
              </div>
              <div className={legacyRowClass('result', 'stem-row')}>
                <button type="button" className="pp-waveform-label" aria-label="변환곡 재생/일시정지" onClick={() => t.handleKeyClick('result')} disabled={!t.peaksForKey('result').length}>{t.activeKey === 'result' && t.isPlaying ? <Pause size={15}/> : <Combine size={15}/>}</button>
                <span className="stem-label">변환곡</span>
                <Waveform peaks={t.peaksForKey('result')} playedFraction={t.playedFraction} variant="processed"/>
              </div>
              <div className={legacyRowClass('result-vocal', 'stem-row stem-row-sub')}>
                <button type="button" className="pp-waveform-label" aria-label="변환곡 보컬 재생/일시정지" onClick={() => t.handleKeyClick('result-vocal')} disabled={!t.peaksForKey('result-vocal').length}>{t.activeKey === 'result-vocal' && t.isPlaying ? <Pause size={15}/> : <Mic size={15}/>}</button>
                <span className="stem-label">변환곡 보컬</span>
                <Waveform peaks={t.peaksForKey('result-vocal')} playedFraction={t.playedFraction} variant="processed"/>
              </div>
            </div> : <div className="stem-list">
              <div className={t.rowClass('source', 'stem-row')}>
                <div className="audio-compare-toolbar">
                  <button type="button" className="pp-waveform-label" aria-label="원곡 재생/일시정지" onClick={() => t.handleKeyClick('source')} disabled={!t.peaksForKey('source').length}>{t.activeKey === 'source' && t.isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
                  <span className="stem-label audio-compare-label"><strong>원곡</strong></span>
                </div>
                <div className="audio-compare-charts">
                  <CompareWaveform peaks={t.peaksForKey('source')} fraction={t.positionSeconds / (t.bufferForKey('source')?.duration || 1)} processed={false}/>
                  <CompareSpectrogram buffer={t.bufferForKey('source')} fraction={t.positionSeconds / (t.bufferForKey('source')?.duration || 1)}/>
                </div>
              </div>
              <div className={t.rowClass('reference', 'stem-row')}>
                <div className="audio-compare-toolbar">
                  <button type="button" className="pp-waveform-label" aria-label="참고곡 재생/일시정지" onClick={() => t.handleKeyClick('reference')} disabled={!t.peaksForKey('reference').length}>{t.activeKey === 'reference' && t.isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
                  <span className="stem-label audio-compare-label"><strong>참고곡</strong></span>
                </div>
                <div className="audio-compare-charts">
                  <CompareWaveform peaks={t.peaksForKey('reference')} fraction={t.positionSeconds / (t.bufferForKey('reference')?.duration || 1)} processed={false}/>
                  <CompareSpectrogram buffer={t.bufferForKey('reference')} fraction={t.positionSeconds / (t.bufferForKey('reference')?.duration || 1)}/>
                </div>
              </div>
              <div className={t.rowClass('result', 'stem-row')}>
                <div className="audio-compare-toolbar">
                  <button type="button" className="pp-waveform-label" aria-label="결과 재생/일시정지" onClick={() => t.handleKeyClick('result')} disabled={!resultBuffer}>{t.activeKey === 'result' && t.isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
                  <span className="stem-label audio-compare-label"><strong>결과</strong></span>
                </div>
                <div className="audio-compare-charts">
                  <CompareWaveform peaks={t.peaksForKey('result')} fraction={t.positionSeconds / (resultBuffer?.duration || 1)} processed={true}/>
                  <CompareSpectrogram buffer={resultBuffer} fraction={t.positionSeconds / (resultBuffer?.duration || 1)}/>
                </div>
              </div>
            </div>}
            <SeekRow t={t}/>
            <div className="dialog-actions pp-dialog-actions">
              <TransportControls t={t} disabled={!t.peaksForKey('source').length}/>
              <div className="pp-dialog-actions-right">
                <Button variant="outline" onClick={onClose} disabled={saving}>닫기</Button>
                <Button onClick={() => void handleSave()} disabled={!resultBuffer || saving}>{saving ? <LoaderCircle className="spin"/> : <Save size={15}/>}저장</Button>
              </div>
            </div>
          </>}
        </div>
      </div>
    </DialogContent>
    <MultiFileLibraryPicker open={sourcePickerOpen} onClose={() => setSourcePickerOpen(false)} onConfirm={paths => paths[0] && void pickSource(paths[0])} title="원본 audio 선택" description="음색을 바꿀 원본 오디오 파일을 골라 주세요."/>
    <MultiFileLibraryPicker open={referencePickerOpen} onClose={() => setReferencePickerOpen(false)} onConfirm={paths => paths[0] && void pickReference(paths[0])} title="참조 audio 선택" description="목표 음색의 참조 오디오 파일을 골라 주세요."/>
    <Dialog open={rvcManageOpen} onOpenChange={setRvcManageOpen}>
      <DialogContent className="studio-dialog voice-convert-browser-dialog" style={{ width: 520 }}>
        <DialogTitle>받은 RVC 목소리 관리</DialogTitle>
        <DialogDescription>온라인에서 받은 목소리입니다. 삭제하면 "내장 목소리" 목록에서도 사라집니다.</DialogDescription>
        <div style={{ display: 'grid', gap: 6, maxHeight: 380, overflowY: 'auto' }}>
          {rvcInstalled.length === 0 && <span className="field-hint">받은 목소리가 없습니다. "온라인에서 RVC 목소리 찾기"로 받을 수 있습니다.</span>}
          {rvcInstalled.map(voice => {
            // Title only: underscores become spaces and long names are cut with an ellipsis (full text in the tooltip).
            const title = voice.name.replace(/_+/g, ' ').trim();
            const shown = title.length > 28 ? `${title.slice(0, 28)}…` : title;
            return <div key={voice.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#7ee787', fontWeight: 600 }} title={`${voice.name}
${voice.repo}`}>{shown}</span>
              <Button variant="outline" size="sm" aria-label="삭제" title="이 목소리 삭제" onClick={() => void deleteRvcOnline(voice.id)} disabled={busy}><Trash2 size={13}/></Button>
            </div>;
          })}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={rvcSearchOpen} onOpenChange={setRvcSearchOpen}>
      <DialogContent className="studio-dialog voice-convert-browser-dialog" style={{ width: 560 }}>
        <DialogTitle>온라인에서 RVC 목소리 찾기</DialogTitle>
        <DialogDescription>HuggingFace에 공개된 RVC 목소리를 검색해 받습니다. 받은 목소리는 ▶로 바로 들어 보고 마음에 안 들면 휴지통으로 지울 수 있습니다(미리듣기는 원본 audio를 먼저 선택해야 합니다). 유지하면 "내장 목소리" 목록에 초록색으로 추가됩니다.</DialogDescription>
              <div style={{ display: 'flex', gap: 6 }}>
                <Input type="text" placeholder="예) anime, korean, singer (비우면 인기순)" value={rvcSearch} onChange={event => setRvcSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void searchRvcOnline(); }} disabled={busy}/>
                <Button variant="outline" size="sm" aria-label="검색" disabled={busy || rvcSearching} onClick={() => void searchRvcOnline()}>{rvcSearching ? <LoaderCircle className="spin" size={13}/> : <Search size={13}/>}</Button>
              </div>
              {rvcResults && <div className="timbre-rvc-results" style={{ maxHeight: 380, overflowY: 'auto', display: 'grid', gap: 4 }}>
                {rvcResults.length === 0 && <span className="field-hint">검색 결과가 없습니다.</span>}
                {rvcResults.map(item => {
                  const slug = item.repo.toLowerCase().replace(/[^a-z0-9._-]+/g, '__').slice(0, 80);
                  const installedItem = rvcInstalled.find(voice => voice.slug === slug);
                  const download = rvcDownloads[slug];
                  return <div key={item.repo} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${item.repo} · 라이선스 ${item.license || '표기 없음'} · 다운로드 ${item.downloads}`}><span style={installedItem ? { color: '#7ee787', fontWeight: 600 } : undefined}>{item.repo}</span><small style={{ opacity: 0.6 }}> · {item.license || '라이선스 없음'}</small>{installedItem && <small style={{ color: '#7ee787' }}> · 받음</small>}</span>
                    {installedItem ? <>
                        <Button variant="outline" size="sm" aria-label="미리듣기" title={previewId ? '원본 보컬 앞 8초를 이 목소리로 바꿔 들어봅니다' : '원본 audio를 먼저 선택하면 미리듣기를 할 수 있습니다'} onClick={() => void previewRvcVoice(installedItem.id)} disabled={busy || rvcPreviewing || !previewId || !vcModelReady}>{rvcPreviewing ? <LoaderCircle className="spin" size={13}/> : <Play size={13}/>}</Button>
                        <Button variant="outline" size="sm" aria-label="삭제" title="설치됨 · 눌러서 삭제" onClick={() => void deleteRvcOnline(installedItem.id)} disabled={busy}><Trash2 size={13}/></Button>
                      </>
                      : download?.state === 'running' ? <span className="field-hint">{download.totalBytes ? Math.round(download.receivedBytes / download.totalBytes * 100) : 0}%</span>
                      : <Button variant="outline" size="sm" aria-label="받기" onClick={() => void downloadRvcOnline(item.repo, item.license)} disabled={busy}><Download size={13}/></Button>}
                    {download?.state === 'failed' && <span className="field-hint warning" title={download.error || ''}>실패</span>}
                  </div>;
                })}
              </div>}
        <p className="field-hint">인덱스 파일이 함께 있는 목소리만 검색 블렌딩을 쓸 수 있습니다. 개인 용도로 쓰되, 실존 인물의 목소리로 타인을 속이는 용도에는 쓰지 마세요.</p>
      </DialogContent>
    </Dialog>
    <MultiFileLibraryPicker open={ddspPickerOpen} onClose={() => setDdspPickerOpen(false)} onConfirm={setDdspReferencePaths} multiple/>
  </Dialog>;
}

function AudioRestoreDialog({ file, onClose, notify, onCreated }: { file: File; onClose: () => void; notify: (text: string, error?: boolean) => void; onCreated: (project: Project) => void }) {
  const [title, setTitle] = useState(file.name.replace(/\.[^./]+$/, ''));
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [originalPeaks, setOriginalPeaks] = useState<number[]>([]);
  const [restoredPeaks, setRestoredPeaks] = useState<number[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewVolume, setPreviewVolume] = useState(1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewGainRef = useRef<GainNode | null>(null);
  const originalBufferRef = useRef<AudioBuffer | null>(null);
  const restoredBufferRef = useRef<AudioBuffer | null>(null);
  const previewIdRef = useRef<string | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rateRef = useRef(1);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  function bufferForKey(key: string | null): AudioBuffer | null {
    if (key === 'original') return originalBufferRef.current;
    if (key === 'restored') return restoredBufferRef.current;
    return null;
  }

  function ensureAudioContext(): AudioContext {
    if (audioCtxRef.current) return audioCtxRef.current;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const gainNode = ctx.createGain();
    gainNode.gain.value = previewVolume;
    gainNode.connect(ctx.destination);
    previewGainRef.current = gainNode;
    return ctx;
  }

  useEffect(() => {
    if (!loading) return;
    const poll = window.setInterval(() => {
      api<{ active: boolean; elapsedMs: number; expectedMs: number }>('/generate/status').then(status => {
        if (status.active && status.expectedMs > 0) setProgress(Math.min(96, Math.round(status.elapsedMs / status.expectedMs * 100)));
      }).catch(() => {});
    }, 1000);
    return () => window.clearInterval(poll);
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const result = await api<{ id: string; durationMs: number }>('/audiosr-restore/preview', 'POST', { dataUrl });
        if (cancelled) return;
        previewIdRef.current = result.id;
        const ctx = ensureAudioContext();
        const [originalResponse, restoredResponse] = await Promise.all([
          fetch(`/api/audiosr-restore/preview/${result.id}/original`),
          fetch(`/api/audiosr-restore/preview/${result.id}/restored`),
        ]);
        if (!originalResponse.ok || !restoredResponse.ok) throw new Error('load failed');
        const [originalBuffer, restoredBuffer] = await Promise.all([
          ctx.decodeAudioData(await originalResponse.arrayBuffer()),
          ctx.decodeAudioData(await restoredResponse.arrayBuffer()),
        ]);
        if (cancelled) return;
        originalBufferRef.current = originalBuffer;
        restoredBufferRef.current = restoredBuffer;
        setOriginalPeaks(computeWaveformPeaks(originalBuffer, 300));
        setRestoredPeaks(computeWaveformPeaks(restoredBuffer, 300));
      } catch (error) {
        if (!cancelled) setErrorText(error instanceof Error && error.message && error.message !== 'load failed' ? error.message : '오디오 복원에 실패했습니다. audio.cpp가 AudioSR 모델을 포함해 빌드되어 있는지, 모델 파일이 있는지 확인해 주세요.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (previewIdRef.current) void api(`/audiosr-restore/preview/${previewIdRef.current}`, 'DELETE').catch(() => {});
      void audioCtxRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pausePlayback() {
    if (isPlaying) playOffsetRef.current = currentPosition();
    currentSourceRef.current?.stop();
    currentSourceRef.current = null;
    setIsPlaying(false);
  }
  function currentPosition(): number {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return playOffsetRef.current;
    return playOffsetRef.current + (ctx.currentTime - playStartCtxTimeRef.current) * rateRef.current;
  }
  function playKey(key: string, atPosition?: number) {
    const ctx = audioCtxRef.current || ensureAudioContext();
    const buffer = bufferForKey(key);
    if (!buffer) return;
    // A suspended context (created after an await) stays silent until resumed from a
    // user gesture. Every play click is such a gesture, so resume before starting.
    if (ctx.state !== 'running') void ctx.resume();
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
    setActiveKey(key);
    setIsPlaying(true);
  }
  function handleKeyClick(key: string) {
    if (activeKey === key && isPlaying) { pausePlayback(); return; }
    playKey(key);
  }
  function stopPlayback() { pausePlayback(); setActiveKey(null); setPositionSeconds(0); }
  function seekBy(deltaSeconds: number) {
    const key = activeKey || 'original';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(currentPosition() + deltaSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function seekTo(nextSeconds: number) {
    const key = activeKey || 'original';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(nextSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function cycleSpeed() {
    const next = playbackRate >= 2 ? 1 : 2;
    const pos = currentPosition();
    setPlaybackRate(next);
    rateRef.current = next;
    if (isPlaying && activeKey) { playKey(activeKey, pos); return; }
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
    const tick = () => { setPositionSeconds(currentPosition()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  async function handleSave() {
    if (!previewIdRef.current) return;
    setSaving(true);
    try {
      stopPlayback();
      const completed = await api<Project>(`/audiosr-restore/preview/${previewIdRef.current}/save`, 'POST', { title: title.trim() });
      previewIdRef.current = null;
      onCreated(completed);
      notify('오디오를 복원해 라이브러리에 추가했습니다.');
      onClose();
    } catch (error) { setErrorText((error as Error).message); }
    finally { setSaving(false); }
  }

  const activeBuffer = bufferForKey(activeKey);
  const rowClass = (key: string, kind: 'dry' | 'wet', base: string) => `${base}${activeKey === key && isPlaying ? (kind === 'wet' ? ' pp-row-playing-processed' : ' pp-row-playing-original') : ''}`;

  return <Dialog open onOpenChange={open => { if (!open) { stopPlayback(); onClose(); } }}>
    <DialogContent className="studio-dialog audio-restore-dialog audio-compare-dialog">
      <DialogTitle>음원 복원</DialogTitle>
      <DialogDescription>저음질 오디오를 AudioSR로 복원했습니다. 원본과 비교해 들어보고 저장할지 정하세요.</DialogDescription>
      <div className="form-section idea-section">
        <label htmlFor="restore-dialog-title">제목<span className="optional">선택</span></label>
        <Input id="restore-dialog-title" value={title} onChange={event => setTitle(event.target.value)} placeholder="비워두면 파일 이름을 사용합니다" maxLength={120}/>
      </div>
      {errorText && <p className="field-hint warning">{errorText}</p>}
      {loading && <div className="stem-loading"><LoaderCircle className="spin"/>오디오 복원 중... ({progress}%)</div>}
      <div className="stem-list">
        <div className={rowClass('original', 'dry', 'stem-row')}>
          <div className="audio-compare-toolbar">
            <button type="button" className="pp-waveform-label" aria-label={activeKey === 'original' && isPlaying ? '원본 일시정지' : '원본 재생'} onClick={() => handleKeyClick('original')} disabled={!originalPeaks.length}>{activeKey === 'original' && isPlaying ? <Pause size={15}/> : <AudioLines size={15}/>}</button>
            <span className="stem-label audio-compare-label"><strong>원본</strong></span>
          </div>
          <div className="audio-compare-charts">
            <CompareWaveform peaks={originalPeaks} fraction={positionSeconds / (originalBufferRef.current?.duration || 1)} processed={false}/>
            <CompareSpectrogram buffer={originalBufferRef.current} fraction={positionSeconds / (originalBufferRef.current?.duration || 1)}/>
          </div>
        </div>
        <div className={rowClass('restored', 'wet', 'stem-row')}>
          <div className="audio-compare-toolbar">
            <button type="button" className="pp-waveform-label" aria-label={activeKey === 'restored' && isPlaying ? '복원 일시정지' : '복원 재생'} onClick={() => handleKeyClick('restored')} disabled={!restoredPeaks.length}>{activeKey === 'restored' && isPlaying ? <Pause size={15}/> : <RefreshCw size={15}/>}</button>
            <span className="stem-label audio-compare-label"><strong>복원</strong></span>
          </div>
          <div className="audio-compare-charts">
            <CompareWaveform peaks={restoredPeaks} fraction={positionSeconds / (restoredBufferRef.current?.duration || 1)} processed={true}/>
            <CompareSpectrogram buffer={restoredBufferRef.current} fraction={positionSeconds / (restoredBufferRef.current?.duration || 1)}/>
          </div>
        </div>
      </div>
      <div className="pp-seek-row">
        <span className="pp-seek-time">{formatSeekTime(positionSeconds)}</span>
        <input className="pp-seek-bar" type="range" aria-label="재생 위치" min={0} max={activeBuffer?.duration || 0} step={0.01} value={Math.min(positionSeconds, activeBuffer?.duration || 0)} onChange={event => seekTo(Number(event.target.value))} disabled={!activeBuffer}/>
        <span className="pp-seek-time">{formatSeekTime(activeBuffer?.duration || 0)}</span>
      </div>
      <div className="dialog-actions pp-dialog-actions">
        <div className="pp-transport">
          <Button variant="ghost" size="icon" aria-label="5초 뒤로" onClick={() => seekBy(-5)} disabled={!originalPeaks.length}><Rewind size={15}/></Button>
          <Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={() => handleKeyClick(activeKey || 'original')} disabled={!originalPeaks.length}>{isPlaying ? <Pause size={15}/> : <Play size={15}/>}</Button>
          <Button variant="ghost" size="icon" aria-label="5초 앞으로" onClick={() => seekBy(5)} disabled={!originalPeaks.length}><FastForward size={15}/></Button>
          <button type="button" className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed} disabled={!originalPeaks.length}>{playbackRate}x</button>
          <Volume2 size={14} className="pp-volume-icon"/>
          <input className="abc-player-volume" type="range" aria-label="미리듣기 볼륨" min={0} max={2} step={0.1} value={previewVolume} onChange={event => applyPreviewVolume(Number(event.target.value))} disabled={!originalPeaks.length}/>
        </div>
        <div className="pp-dialog-actions-right">
          <Button variant="outline" onClick={() => { stopPlayback(); onClose(); }} disabled={saving}>취소</Button>
          <Button onClick={() => void handleSave()} disabled={!restoredPeaks.length || saving}>{saving ? <LoaderCircle className="spin"/> : <Save size={15}/>}저장</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

function AudioCompareDialog({ onClose, notify, onCreated }: { onClose: () => void; notify: (text: string, error?: boolean) => void; onCreated: (project: Project) => void }) {
  const [row1Name, setRow1Name] = useState('');
  const [row2Name, setRow2Name] = useState('');
  const [row1Peaks, setRow1Peaks] = useState<number[]>([]);
  const [row2Peaks, setRow2Peaks] = useState<number[]>([]);
  const [row1Processed, setRow1Processed] = useState(false);
  const [row2Processed, setRow2Processed] = useState(false);
  const [editingRow, setEditingRow] = useState<1 | 2 | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [previewVolume, setPreviewVolume] = useState(1);
  const [saving1, setSaving1] = useState(false);
  const [saving2, setSaving2] = useState(false);
  const [errorText, setErrorText] = useState('');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewGainRef = useRef<GainNode | null>(null);
  const row1BufferRef = useRef<AudioBuffer | null>(null);
  const row2BufferRef = useRef<AudioBuffer | null>(null);
  const row1ParamsRef = useRef<PostProcessParams>(PP_DEFAULT_PARAMS);
  const row2ParamsRef = useRef<PostProcessParams>(PP_DEFAULT_PARAMS);
  const row1InputRef = useRef<HTMLInputElement>(null);
  const row2InputRef = useRef<HTMLInputElement>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartCtxTimeRef = useRef(0);
  const playOffsetRef = useRef(0);
  const rateRef = useRef(1);
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  function bufferForKey(key: string | null): AudioBuffer | null {
    if (key === 'row1') return row1BufferRef.current;
    if (key === 'row2') return row2BufferRef.current;
    return null;
  }

  useEffect(() => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const gainNode = ctx.createGain();
    gainNode.gain.value = previewVolume;
    gainNode.connect(ctx.destination);
    previewGainRef.current = gainNode;
    return () => { void ctx.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePickFile(row: 1 | 2, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      if (activeKey === `row${row}`) stopPlayback();
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      const peaks = computeWaveformPeaks(decoded, 300);
      if (row === 1) { row1BufferRef.current = decoded; row1ParamsRef.current = PP_DEFAULT_PARAMS; setRow1Peaks(peaks); setRow1Name(file.name); setRow1Processed(false); }
      else { row2BufferRef.current = decoded; row2ParamsRef.current = PP_DEFAULT_PARAMS; setRow2Peaks(peaks); setRow2Name(file.name); setRow2Processed(false); }
      setErrorText('');
    } catch { setErrorText('오디오 파일을 불러오지 못했습니다.'); }
  }

  function handleRowProcessed(row: 1 | 2, buffer: AudioBuffer, params: PostProcessParams) {
    const peaks = computeWaveformPeaks(buffer, 300);
    if (row === 1) { row1BufferRef.current = buffer; row1ParamsRef.current = params; setRow1Peaks(peaks); setRow1Processed(true); }
    else { row2BufferRef.current = buffer; row2ParamsRef.current = params; setRow2Peaks(peaks); setRow2Processed(true); }
    setEditingRow(null);
  }

  function pausePlayback() {
    if (isPlaying) playOffsetRef.current = currentPosition();
    currentSourceRef.current?.stop();
    currentSourceRef.current = null;
    setIsPlaying(false);
  }
  function currentPosition(): number {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlayingRef.current) return playOffsetRef.current;
    return playOffsetRef.current + (ctx.currentTime - playStartCtxTimeRef.current) * rateRef.current;
  }
  function playKey(key: string, atPosition?: number) {
    const ctx = audioCtxRef.current;
    const buffer = bufferForKey(key);
    if (!ctx || !buffer) return;
    // A suspended context (created after an await) stays silent until resumed from a
    // user gesture. Every play click is such a gesture, so resume before starting.
    if (ctx.state !== 'running') void ctx.resume();
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
    setActiveKey(key);
    setIsPlaying(true);
  }
  function handleKeyClick(key: string) {
    if (activeKey === key && isPlaying) { pausePlayback(); return; }
    playKey(key);
  }
  function stopPlayback() { pausePlayback(); setActiveKey(null); setPositionSeconds(0); }
  function seekBy(deltaSeconds: number) {
    const key = activeKey || 'row1';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(currentPosition() + deltaSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function seekTo(nextSeconds: number) {
    const key = activeKey || 'row1';
    const buffer = bufferForKey(key);
    if (!buffer) return;
    const next = Math.max(0, Math.min(nextSeconds, Math.max(0, buffer.duration - 0.02)));
    if (isPlaying) { playKey(key, next); return; }
    playOffsetRef.current = next;
    setPositionSeconds(next);
    setActiveKey(key);
  }
  function cycleSpeed() {
    const next = playbackRate >= 2 ? 1 : 2;
    const pos = currentPosition();
    setPlaybackRate(next);
    rateRef.current = next;
    if (isPlaying && activeKey) { playKey(activeKey, pos); return; }
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
    const tick = () => { setPositionSeconds(currentPosition()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  async function handleSaveRow(row: 1 | 2) {
    const buffer = row === 1 ? row1BufferRef.current : row2BufferRef.current;
    if (!buffer) return;
    const processed = row === 1 ? row1Processed : row2Processed;
    const name = (row === 1 ? row1Name : row2Name).replace(/\.[^./]+$/, '') || `음원-${row}`;
    const setSaving = row === 1 ? setSaving1 : setSaving2;
    setSaving(true);
    try {
      const wavBlob = audioBufferToWavBlob(buffer);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(wavBlob);
      });
      const title = processed ? `${name} (후처리)` : name;
      const completed = await api<Project>('/audio-save', 'POST', { dataUrl, title });
      onCreated(completed);
      notify(`"${title}"을(를) 라이브러리에 추가했습니다.`);
    } catch (error) { setErrorText((error as Error).message); }
    finally { setSaving(false); }
  }

  const activeBuffer = bufferForKey(activeKey);
  const playedFraction = activeBuffer ? Math.min(1, positionSeconds / activeBuffer.duration) : 0;
  const rowClass = (key: string, kind: 'dry' | 'wet', base: string) => `${base}${activeKey === key && isPlaying ? (kind === 'wet' ? ' pp-row-playing-processed' : ' pp-row-playing-original') : ''}`;
  const anyLoaded = !!row1BufferRef.current || !!row2BufferRef.current;

  return <>
    {!editingRow && <Dialog open onOpenChange={open => { if (!open) { stopPlayback(); onClose(); } }}>
      <DialogContent className="studio-dialog audio-compare-dialog">
        <DialogTitle>음원 비교</DialogTitle>
        <DialogDescription>두 오디오를 각각 불러와 원본과 후처리 결과를 번갈아 들으며 비교하세요. 저장1/저장2를 누르면 그 상태 그대로 라이브러리에 추가됩니다.</DialogDescription>
        {errorText && <p className="field-hint warning">{errorText}</p>}
        <div className="stem-list">
          <div className={rowClass('row1', row1Processed ? 'wet' : 'dry', 'stem-row')}>
            <div className="audio-compare-toolbar">
            <button type="button" className="pp-waveform-label" aria-label={activeKey === 'row1' && isPlaying ? '음원-1 일시정지' : '음원-1 재생'} onClick={() => handleKeyClick('row1')} disabled={!row1Peaks.length}>{activeKey === 'row1' && isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
            <button type="button" className="audio-compare-load-btn" aria-label="음원-1 파일 불러오기" title="음원-1 파일 불러오기" onClick={() => row1InputRef.current?.click()}><Upload size={13}/></button>
            <span className="stem-label audio-compare-label"><strong>음원-1</strong>{row1Name && <small title={row1Name}>({row1Name})</small>}{row1Processed && <span className="small-badge">처리됨</span>}</span>
            <Button variant="outline" size="sm" onClick={() => setEditingRow(1)} disabled={!row1BufferRef.current}><SlidersHorizontal size={14}/>후처리</Button>
            </div>
            <div className="audio-compare-charts">
              <CompareWaveform peaks={row1Peaks} fraction={positionSeconds / (row1BufferRef.current?.duration || 1)} processed={row1Processed}/>
              <CompareSpectrogram buffer={row1BufferRef.current} fraction={positionSeconds / (row1BufferRef.current?.duration || 1)}/>
            </div>
          </div>
          <div className={rowClass('row2', row2Processed ? 'wet' : 'dry', 'stem-row')}>
            <div className="audio-compare-toolbar">
            <button type="button" className="pp-waveform-label" aria-label={activeKey === 'row2' && isPlaying ? '음원-2 일시정지' : '음원-2 재생'} onClick={() => handleKeyClick('row2')} disabled={!row2Peaks.length}>{activeKey === 'row2' && isPlaying ? <Pause size={15}/> : <Play size={15}/>}</button>
            <button type="button" className="audio-compare-load-btn" aria-label="음원-2 파일 불러오기" title="음원-2 파일 불러오기" onClick={() => row2InputRef.current?.click()}><Upload size={13}/></button>
            <span className="stem-label audio-compare-label"><strong>음원-2</strong>{row2Name && <small title={row2Name}>({row2Name})</small>}{row2Processed && <span className="small-badge">처리됨</span>}</span>
            <Button variant="outline" size="sm" onClick={() => setEditingRow(2)} disabled={!row2BufferRef.current}><SlidersHorizontal size={14}/>후처리</Button>
            </div>
            <div className="audio-compare-charts">
              <CompareWaveform peaks={row2Peaks} fraction={positionSeconds / (row2BufferRef.current?.duration || 1)} processed={row2Processed}/>
              <CompareSpectrogram buffer={row2BufferRef.current} fraction={positionSeconds / (row2BufferRef.current?.duration || 1)}/>
            </div>
          </div>
        </div>
        <div className="pp-seek-row">
          <span className="pp-seek-time">{formatSeekTime(positionSeconds)}</span>
          <input className="pp-seek-bar" type="range" aria-label="재생 위치" min={0} max={activeBuffer?.duration || 0} step={0.01} value={Math.min(positionSeconds, activeBuffer?.duration || 0)} onChange={event => seekTo(Number(event.target.value))} disabled={!activeBuffer}/>
          <span className="pp-seek-time">{formatSeekTime(activeBuffer?.duration || 0)}</span>
        </div>
        <div className="dialog-actions pp-dialog-actions">
          <div className="pp-transport">
            <Button variant="ghost" size="icon" aria-label="5초 뒤로" onClick={() => seekBy(-5)} disabled={!activeBuffer}><Rewind size={15}/></Button>
            <Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={() => handleKeyClick(activeKey || 'row1')} disabled={!anyLoaded}>{isPlaying ? <Pause size={15}/> : <Play size={15}/>}</Button>
            <Button variant="ghost" size="icon" aria-label="5초 앞으로" onClick={() => seekBy(5)} disabled={!activeBuffer}><FastForward size={15}/></Button>
            <button type="button" className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed} disabled={!activeBuffer}>{playbackRate}x</button>
            <Volume2 size={14} className="pp-volume-icon"/>
            <input className="abc-player-volume" type="range" aria-label="미리듣기 볼륨" min={0} max={2} step={0.1} value={previewVolume} onChange={event => applyPreviewVolume(Number(event.target.value))}/>
          </div>
          <div className="pp-dialog-actions-right">
            <Button variant="outline" onClick={() => { stopPlayback(); onClose(); }}>취소</Button>
            <Button variant="outline" onClick={() => void handleSaveRow(1)} disabled={!row1BufferRef.current || saving1}>{saving1 ? <LoaderCircle className="spin"/> : <Save size={15}/>}저장1</Button>
            <Button variant="outline" onClick={() => void handleSaveRow(2)} disabled={!row2BufferRef.current || saving2}>{saving2 ? <LoaderCircle className="spin"/> : <Save size={15}/>}저장2</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>}
    <input ref={row1InputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/ogg" hidden onChange={event => void handlePickFile(1, event)}/>
    <input ref={row2InputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/ogg" hidden onChange={event => void handlePickFile(2, event)}/>
    {editingRow && <PostProcessDialog
      key={editingRow}
      project={{ id: `compare-row${editingRow}`, title: editingRow === 1 ? (row1Name || '음원-1') : (row2Name || '음원-2') } as unknown as Project}
      onClose={() => setEditingRow(null)}
      notify={notify}
      visualizerEnabled={false}
      visualizerRingCount={1}
      visualizerHue={0}
      visualizerLineWidth={1}
      visualizerTrail={0}
      visualizerSpiral={0}
      visualizerRingMode="radial"
      visualizerTimeStep={0.1}
      visualizerTimeSkew={1}
      visualizerRingStep={1}
      visualizerAmplitude={1}
      titleOverride={editingRow === 1 ? (row1Name || '음원-1') : (row2Name || '음원-2')}
      sourceOverride={{ buffer: (editingRow === 1 ? row1BufferRef.current : row2BufferRef.current)!, params: editingRow === 1 ? row1ParamsRef.current : row2ParamsRef.current }}
      onSaveOverride={(buffer, params) => handleRowProcessed(editingRow, buffer, params)}
    />}
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
  const [coverPendingProject, setCoverPendingProject] = useState<Project | null>(null);
  const [postProcessTarget, setPostProcessTarget] = useState<Project | null>(null);
  const [stemTarget, setStemTarget] = useState<{ project: Project; mode: StemMode } | null>(null);
  const [midiEditorTarget, setMidiEditorTarget] = useState<Project | null>(null);
  const [timbreTransformOpen, setTimbreTransformOpen] = useState(false);
  // previewId(음색 변조 팝업이 열릴 때마다 생기는 세션 id, 더 이상 project.id가 아님) -> DDSP-SVC job id.
  // TimbreTransformDialog를 닫아도 학습을 계속 추적하려고 다이얼로그 바깥(App)에 둔다. 마운트 시
  // GET /api/ddsp-jobs로 하이드레이션하고, 완료/실패로 바뀌면 다이얼로그가 닫혀 있어도 토스트를 띄운다.
  const [ddspActiveJobs, setDdspActiveJobs] = useState<Record<string, string>>({});
  const ddspNotifiedRef = useRef<Set<string>>(new Set());
  // 마운트 시 서버가 이미 추적 중인(창을 닫았다 새로고침해도 살아있는) DDSP-SVC job을 복원.
  useEffect(() => {
    void api<DdspJobStatus[]>('/ddsp-jobs').then(jobs => {
      const running = jobs.filter(job => !['completed', 'failed', 'cancelled'].includes(job.status));
      if (running.length) setDdspActiveJobs(previous => { const next = { ...previous }; for (const job of running) next[job.projectId] = job.id; return next; });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ddspActiveJobs에 뭐가 있는 동안 폴링해서, TimbreTransformDialog가 닫혀 있어도 완료/실패 시
  // 토스트를 띄운다(다이얼로그가 열려 있을 때의 진행률 표시는 DdspTabPanel이 따로 폴링).
  useEffect(() => {
    const jobIds = Object.values(ddspActiveJobs);
    if (!jobIds.length) return;
    const poll = async () => {
      try {
        const jobs = await api<DdspJobStatus[]>('/ddsp-jobs');
        for (const job of jobs) {
          if (!jobIds.includes(job.id)) continue;
          if ((job.status === 'completed' || job.status === 'failed') && !ddspNotifiedRef.current.has(job.id)) {
            ddspNotifiedRef.current.add(job.id);
            notify(job.status === 'completed' ? 'DDSP-SVC 학습이 끝났습니다 -- 음색 변조 팝업에서 결과를 확인하세요.' : `DDSP-SVC 학습이 실패했습니다 -- ${job.error || ''}`, job.status === 'failed');
            setDdspActiveJobs(previous => { const next = { ...previous }; delete next[job.projectId]; return next; });
          }
        }
      } catch { /* 일시적 네트워크 오류, 다음 폴링에서 재시도 */ }
    };
    void poll();
    const interval = window.setInterval(poll, 5000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ddspActiveJobs]);
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
  const mainWaveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mainAudioCtxRef = useRef<AudioContext | null>(null);
  const mainAnalyserRef = useRef<AnalyserNode | null>(null);
  const mainIsPlayingRef = useRef(false);
  const mainWaveHistoryRef = useRef<{ t: number; data: Uint8Array }[]>([]);
  useEffect(() => { mainIsPlayingRef.current = isPlaying; }, [isPlaying]);
  // A MediaElementAudioSourceNode can only ever be created once per <audio> element for its
  // whole lifetime (a second call throws), so build the graph lazily on first play and reuse
  // it for every song afterward instead of tying it to this component's mount/unmount.
  function ensureMainAnalyser() {
    if (mainAnalyserRef.current) { if (mainAudioCtxRef.current?.state === 'suspended') void mainAudioCtxRef.current.resume(); return; }
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      mainAudioCtxRef.current = ctx;
      mainAnalyserRef.current = analyser;
    } catch { /* Web Audio unavailable; the player-bar waveform just stays blank. */ }
  }
  const coverInputRef = useRef<HTMLInputElement>(null);
  const coverAudioInputRef = useRef<HTMLInputElement>(null);
  const coverTargetRef = useRef<{ type: 'project'; item: Project } | { type: 'abc-note'; item: AbcNote } | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const model = models.find(item => item.id === draft.modelId) || models[0];
  const update = (value: Partial<Draft>) => setDraft(previous => ({ ...previous, ...value }));
  const notify = (text: string, error = false) => setNotice({ text, error });
  const navigate = (target: Page) => { setPage(target); setMobileNav(false); setQuery(''); setTab('all'); setActivePlaylistId(null); };
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('songyue2-composer') || 'null');
      if (cached && typeof cached.lyrics === 'string') {
        setDraft({ ...emptyDraft, ...cached });
      }
    } catch { /* Ignore invalid browser drafts. */ }
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
    try { const result = await api<Settings>('/settings', 'PUT', { provider: settings.provider, enginePath: settings.enginePath, pythonEnginePath: settings.pythonEnginePath, pythonScriptPath: settings.pythonScriptPath, pythonMemoryBudgetGib: settings.pythonMemoryBudgetGib, sheetSagePythonPath: settings.sheetSagePythonPath, comfyUiEndpoint: settings.comfyUiEndpoint, comfyUiEnginePath: settings.comfyUiEnginePath, ddspSvcPath: settings.ddspSvcPath, settingPath: settings.settingPath, musicPath: settings.musicPath, examplesPath: settings.examplesPath, coversPath: settings.coversPath, abcNotesPath: settings.abcNotesPath, stylePresets: settings.stylePresets, visualizerEnabled: settings.visualizerEnabled, visualizerRingCount: settings.visualizerRingCount, visualizerHue: settings.visualizerHue, visualizerLineWidth: settings.visualizerLineWidth, visualizerTrail: settings.visualizerTrail, visualizerSpiral: settings.visualizerSpiral, visualizerRingMode: settings.visualizerRingMode, visualizerTimeStep: settings.visualizerTimeStep, visualizerTimeSkew: settings.visualizerTimeSkew, visualizerRingStep: settings.visualizerRingStep, visualizerAmplitude: settings.visualizerAmplitude, saveFormat: settings.saveFormat }); setSettings(result); setSavedSettings(result); if (test) { await api('/llm/test', 'POST'); notify('연결을 확인했습니다. 작사 도우미를 사용할 수 있어요.'); } else notify('설정을 저장했습니다.'); }
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
  function loadProject(item: Project) { setDraft({ title: item.title, lyrics: item.lyrics, style: item.style, modelId: item.modelId, seed: item.seed, steps: item.steps, cot: item.cot, vocalGender: item.vocalGender || '', instrumental: Boolean(item.instrumental), abc: item.abc || '', mode: item.mode }); setSelected(null); navigate('create'); notify('설정을 불러왔습니다. 다시 저장하면 새 버전으로 남습니다.'); }
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
  function handleRestoreAudioFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setRestoreFile(file);
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
    ensureMainAnalyser();
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
  useEffect(() => {
    // Same rendering as the post-process dialog's circular visualizer (same settings, same
    // per-point bin-margin/amplitude math) -- only the coordinate mapping differs: instead of
    // extending each ring around 0-360 degrees, extend it along a straight x=0..width line.
    const points = 64;
    let raf = 0;
    const tick = () => {
      const canvas = mainWaveCanvasRef.current;
      const analyser = mainAnalyserRef.current;
      const ctx2d = canvas?.getContext('2d');
      if (canvas && ctx2d) {
        const displayWidth = Math.round(canvas.clientWidth);
        const displayHeight = Math.round(canvas.clientHeight);
        if (displayWidth > 0 && displayHeight > 0 && (canvas.width !== displayWidth || canvas.height !== displayHeight)) {
          canvas.width = displayWidth;
          canvas.height = displayHeight;
        }
        const { width, height } = canvas;
        const playing = settings.visualizerEnabled && mainIsPlayingRef.current;
        if (playing && settings.visualizerTrail > 0) {
          ctx2d.globalCompositeOperation = 'destination-out';
          ctx2d.fillStyle = `rgba(0, 0, 0, ${1 - settings.visualizerTrail / 100})`;
          ctx2d.fillRect(0, 0, width, height);
          ctx2d.globalCompositeOperation = 'source-over';
        } else {
          ctx2d.clearRect(0, 0, width, height);
        }
        if (playing && width > 0 && height > 0) {
          const cy = height / 2;
          const frame = new Uint8Array(analyser?.frequencyBinCount || points);
          if (analyser) analyser.getByteFrequencyData(frame);
          const now = performance.now();
          const ringCount = Math.max(1, Math.min(30, Math.round(settings.visualizerRingCount)));
          if (settings.visualizerRingMode === 'time') {
            const history = mainWaveHistoryRef.current;
            history.push({ t: now, data: frame });
            const maxAgeMs = Math.pow(Math.max(0, ringCount - 1), settings.visualizerTimeSkew) * settings.visualizerTimeStep * 1000 + 200;
            while (history.length > 1 && now - history[0].t > maxAgeMs) history.shift();
          }
          for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
            const radiusFactor = 0.1 + ringIndex * (settings.visualizerRingStep / 100);
            const hue = (settings.visualizerHue + ((ringIndex * 37) % 100)) % 360;
            const offset = Math.floor((ringIndex * points) / ringCount * (settings.visualizerSpiral / 100));
            let source: Uint8Array | undefined;
            if (settings.visualizerRingMode === 'time') {
              const targetT = now - Math.pow(ringIndex, settings.visualizerTimeSkew) * settings.visualizerTimeStep * 1000;
              const history = mainWaveHistoryRef.current;
              if (history.length && history[0].t <= targetT) {
                for (let h = history.length - 1; h >= 0; h--) { if (history[h].t <= targetT) { source = history[h].data; break; } }
              }
            } else {
              source = frame;
            }
            if (!source) continue;
            // The circle's baseRadius (how far a ring sits from the shared center) becomes how
            // far this ring's line sits from the shared vertical center, alternating above/below
            // it -- the closest a single line has to "concentric" on one axis instead of two.
            const baseOffset = Math.min(width, height) * (settings.visualizerRingMode === 'time' ? 0.22 : radiusFactor);
            const centerY = cy + (ringIndex % 2 === 0 ? -baseOffset : baseOffset);
            const binMarginLow = 2;
            const binMarginHigh = Math.round(source.length * 0.35);
            const activeBins = Math.max(1, source.length - binMarginLow - binMarginHigh);
            const nodes: { x: number; y: number }[] = [];
            for (let i = 0; i < points; i++) {
              const x = (i / (points - 1)) * width;
              const bin = binMarginLow + Math.floor(((i + offset) % points) * activeBins / points);
              const value = source[bin] / 255;
              const centered = value - 0.5;
              const directional = centered >= 0 ? centered : centered * 0.5;
              const y = centerY - directional * baseOffset * settings.visualizerAmplitude;
              nodes.push({ x, y });
            }
            ctx2d.beginPath();
            ctx2d.moveTo(nodes[0].x, nodes[0].y);
            for (let i = 1; i < points - 1; i++) {
              const p0 = nodes[i];
              const p1 = nodes[i + 1];
              const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
              ctx2d.quadraticCurveTo(p0.x, p0.y, mid.x, mid.y);
            }
            ctx2d.lineTo(nodes[points - 1].x, nodes[points - 1].y);
            ctx2d.strokeStyle = `hsla(${hue}, 95%, 78%, 0.55)`;
            ctx2d.lineWidth = settings.visualizerLineWidth;
            ctx2d.stroke();
          }
        } else if (!playing) {
          mainWaveHistoryRef.current = [];
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [settings.visualizerEnabled, settings.visualizerRingCount, settings.visualizerHue, settings.visualizerLineWidth, settings.visualizerTrail, settings.visualizerSpiral, settings.visualizerRingMode, settings.visualizerTimeStep, settings.visualizerTimeSkew, settings.visualizerRingStep, settings.visualizerAmplitude]);
  function togglePlay() { if (!queue[queueIndex]) return; ensureMainAnalyser(); setIsPlaying(previous => !previous); }
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
    try { await api(`/projects/${item.id}/cover`, 'DELETE'); setProjects(previous => previous.map(project => project.id === item.id ? { ...project, coverPath: null } : project)); notify('앨범 표지를 삭제했습니다.'); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function deleteAbcNoteCover(item: AbcNote) {
    try { await api(`/abc-notes/${item.id}/cover`, 'DELETE'); setAbcNotes(previous => previous.map(note => note.id === item.id ? { ...note, coverPath: null } : note)); notify('앨범 표지를 삭제했습니다.'); }
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
  function coverFromProject(item: Project) {
    // Only ask when the composer already has something to lose -- with an empty draft there is
    // nothing to keep, so just load this song's settings the same way "replace" would.
    if (draft.lyrics.trim() || draft.style.trim()) { setCoverPendingProject(item); return; }
    void runCover(item, true);
  }
  async function runCover(item: Project, useItemSettings: boolean) {
    setCoverPendingProject(null);
    setBusy('cover-transcribe');
    try {
      const audioResponse = await fetch(`/api/projects/${item.id}/audio`);
      if (!audioResponse.ok) throw new Error('커버할 곡의 오디오를 불러오지 못했습니다.');
      const blob = await audioResponse.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const result = await api<{ abc: string }>('/cover-transcribe', 'POST', { dataUrl, task: 'melody-full' });
      // modelId is deliberately left untouched -- both engines can now use the ABC we're about
      // to set, so there's no reason to override whichever model the composer already picked.
      if (useItemSettings) update({ lyrics: item.lyrics, style: item.style, seed: item.seed, steps: item.steps, cot: item.cot, vocalGender: item.vocalGender || '', instrumental: Boolean(item.instrumental), abc: result.abc });
      else update({ abc: result.abc });
      setCurrentAbcNoteId(null);
      navigate('create');
      notify(`"${item.title}"의 멜로디를 추출해 커버 준비를 마쳤습니다.`);
    } catch (error) { notify((error as Error).message, true); }
    finally { setBusy(''); }
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
    {visibleProjects.length ? <div className={`project-list ${settings.viewMode === 'card' ? 'card-view' : ''}`}>{visibleProjects.map(item => <article className={`song-card ${item.status === 'completed' ? 'status-done' : 'status-draft'}${nowPlaying?.id === item.id && isPlaying ? ' now-playing' : ''}`} key={item.id}><button className={`song-symbol ${item.status === 'completed' ? 'status-done' : 'status-draft'}`} aria-label={item.status === 'completed' ? `${item.title} 재생` : `${item.title} 설정 불러오기`} onClick={() => item.status === 'completed' ? playQueue(visibleProjects, visibleProjects.indexOf(item)) : loadProject(item)}>{item.coverPath ? <img className="song-cover" src={coverUrl(item)} alt=""/> : item.status === 'completed' ? <AudioLines size={24}/> : <FileText size={24}/>}</button><button className="song-info" onClick={() => item.status === 'completed' ? (setSelected(item), setNotes(item.notes || '')) : loadProject(item)}><strong>{item.title}</strong><p>{item.style}</p><div><span className="small-badge">{item.status === 'completed' ? '완성' : '초안'}</span><span>{models.find(m => m.id === item.modelId)?.name || item.modelId}</span><span>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span></div></button><Button variant="ghost" size="icon" aria-label={item.favorite ? `${item.title} 좋아요 취소` : `${item.title} 좋아요`} onClick={() => void favorite(item)} className={item.favorite ? 'hearted' : ''}><Heart fill={item.favorite ? 'currentColor' : 'none'}/></Button><Button variant="ghost" size="icon" aria-label={`${item.title} 설정 불러오기`} onClick={() => loadProject(item)}><ArrowRight/></Button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${item.title} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end">{item.status === 'completed' ? <><button className="song-menu-item" onClick={() => loadProject(item)}><RefreshCw size={15}/>리믹스(설정 재사용)</button><button className="song-menu-item" onClick={() => coverFromProject(item)}><Disc3 size={15}/>커버</button><button className="song-menu-item" onClick={() => renameProject(item)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item" onClick={() => openDownload(item)}><Download size={15}/>다운로드</button><button className="song-menu-item" onClick={() => setMidiEditorTarget(item)}><Music2 size={15}/>MIDI로 내보내기</button><button className="song-menu-item" onClick={() => setPostProcessTarget(item)}><SlidersHorizontal size={15}/>후처리 / EQ</button><button className="song-menu-item" onClick={() => setStemTarget({ project: item, mode: 'channel' })}><Layers size={15}/><span className="stem-menu-item-text">채널 분리<small>{STEM_MODE_CONFIG.channel.menuSub}</small></span></button><button className="song-menu-item" onClick={() => setStemTarget({ project: item, mode: 'vocal' })}><Layers size={15}/><span className="stem-menu-item-text">STEM 분리<small>{STEM_MODE_CONFIG.vocal.menuSub}</small></span></button><button className="song-menu-item" onClick={() => setStemTarget({ project: item, mode: 'full' })}><Layers size={15}/><span className="stem-menu-item-text">STEM 분리<small>{STEM_MODE_CONFIG.full.menuSub}</small></span></button><button className="song-menu-item" onClick={() => setPlaylistPickerTarget(item)}><ListPlus size={15}/>재생목록에 추가</button><button className="song-menu-item" onClick={() => openCoverPicker(item)}><ImageIcon size={15}/>앨범 표지 {item.coverPath ? '변경' : '등록'}</button>{item.coverPath && <button className="song-menu-item" onClick={() => void deleteCover(item)}><X size={15}/>앨범 표지 삭제</button>}<button className="song-menu-item" onClick={() => { setSelected(item); setNotes(item.notes || ''); }}><CircleHelp size={15}/>상세 정보</button></> : <><button className="song-menu-item" onClick={() => renameProject(item)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item" onClick={() => void addAsExample(item)}><Sparkles size={15}/>예시로 추가하기</button><button className="song-menu-item" onClick={() => openCoverPicker(item)}><ImageIcon size={15}/>앨범 표지 {item.coverPath ? '변경' : '등록'}</button></>}<button className="song-menu-item danger" onClick={() => setDeleteTarget(item)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover>{item.status === 'completed' && item.durationMs ? <span className="song-duration">{formatTime(item.durationMs / 1000)}</span> : null}</article>)}</div> : <div className="empty-library"><div className="empty-icon"><AudioLines size={42} strokeWidth={1.25}/></div><h2>{query ? '검색 결과가 없어요' : tab === 'audio' ? '완성된 노래가 아직 없어요' : page === 'favorites' || tab === 'favorites' ? '마음에 드는 곡을 모아 보세요' : '첫 번째 노래를 기다리고 있어요'}</h2><p>{query ? '다른 제목이나 스타일로 검색해 보세요.' : tab === 'audio' ? '노래 만들기로 곡을 생성하면 이곳에서 결과를 들을 수 있어요.' : page === 'favorites' || tab === 'favorites' ? '저장한 곡의 하트를 누르면 이곳에 나타나요.' : <>가사 한 줄, 떠오르는 분위기에서 시작해 보세요.<br/>저장한 초안과 완성된 곡이 이곳에 모입니다.</>}</p>{!query && tab === 'all' && page !== 'favorites' && <Button variant="outline" className="soft-button" onClick={() => setPresetOpen(true)}><Sparkles/>예시로 시작하기<ArrowRight/></Button>}</div>}
  </>; }
  function playlistPage() {
    if (activePlaylist) return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><button className="playlist-back" onClick={() => setActivePlaylistId(null)}><ChevronLeft size={15}/>재생목록</button><h1>{activePlaylist.name}</h1><p>{playlistSongs.length}곡</p></div><div className="playlist-detail-actions"><Button variant="ghost" size="icon" aria-label={settings.viewMode === 'card' ? '목록 보기' : '카드 보기'} onClick={() => void setViewMode(settings.viewMode === 'card' ? 'list' : 'card')}>{settings.viewMode === 'card' ? <ListMusic/> : <LayoutGrid/>}</Button><Button onClick={() => playQueue(playlistSongs, 0)} disabled={!playlistSongs.some(item => item.status === 'completed')}><Play/>전체 재생</Button></div></div>{playlistSongs.length ? <div className={`project-list ${settings.viewMode === 'card' ? 'card-view' : ''}`}>{playlistSongs.map(item => <article className={`song-card ${item.status === 'completed' ? 'status-done' : 'status-draft'}${nowPlaying?.id === item.id && isPlaying ? ' now-playing' : ''}`} key={item.id}><button className={`song-symbol ${item.status === 'completed' ? 'status-done' : 'status-draft'}`} aria-label={`${item.title} 재생`} onClick={() => playQueue(playlistSongs, playlistSongs.indexOf(item))}>{item.coverPath ? <img className="song-cover" src={coverUrl(item)} alt=""/> : item.status === 'completed' ? <AudioLines size={24}/> : <FileText size={24}/>}</button><button className="song-info" onClick={() => { setSelected(item); setNotes(item.notes || ''); }}><strong>{item.title}</strong><p>{item.style}</p></button><Button variant="ghost" size="icon" aria-label={`${item.title} 재생목록에서 제거`} onClick={() => void removeFromPlaylist(activePlaylist, item.id)}><X/></Button></article>)}</div> : <div className="empty-library"><div className="empty-icon"><ListPlus size={42} strokeWidth={1.25}/></div><h2>아직 곡이 없어요</h2><p>노래의 &quot;...&quot; 메뉴에서 이 재생목록에 곡을 추가해 보세요.</p></div>}</section>;
    return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">연속 재생을 위한 모음</span><h1>재생목록</h1><p>라이브러리의 곡을 모아 이 PC에서 이어 들으세요.</p></div><Button onClick={() => void createPlaylistWith(`새 재생목록 ${playlists.length + 1}`)}><Plus/>새 재생목록</Button></div>{playlists.length ? <div className="playlist-grid">{playlists.map(list => <article className="playlist-card" key={list.id}><button onClick={() => setActivePlaylistId(list.id)}><ListPlus size={22}/><strong>{list.name}</strong><small>{list.songIds.length}곡</small></button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${list.name} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end"><button className="song-menu-item" onClick={() => void renamePlaylist(list)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item danger" onClick={() => void deletePlaylist(list)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover></article>)}</div> : <div className="empty-library"><div className="empty-icon"><ListPlus size={42} strokeWidth={1.25}/></div><h2>첫 재생목록을 만들어 보세요</h2><p>완성된 곡들을 모아 두면 이 PC에서 순서대로 이어 들을 수 있어요.</p></div>}</section>;
  }
  function restorePage() {
    return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">AudioSR로 고음질 복원</span><h1>음원 복원<span className="small-badge">실험적</span></h1><p>저음질(손실 압축 등으로 디테일이 소실된) 오디오 파일을 업로드하면 복원 결과를 미리 들어보고 라이브러리에 추가할 수 있습니다.</p></div></div><div className="inline-note warning"><CircleHelp size={17}/><span>실험적 기능입니다 — audio.cpp의 AudioSR이 클릭/틱 잡음을 만들어낼 수 있음을 확인했습니다(모델 자체의 한계로 추정, 좌우 채널 분리와는 무관). 결과물을 재생해 잡음이 들리면 저장하지 말고 취소해 주세요.</span></div><div className="form-section idea-section"><Button onClick={() => restoreInputRef.current?.click()} disabled={!!busy || !online}><Upload/>오디오 파일 선택</Button><p className="field-hint">MP3/WAV/FLAC/M4A/OGG 지원, 100MB 이하. 모노·스테레오 오디오만 가능합니다(3채널 이상은 지원하지 않음). 스테레오는 왼쪽·오른쪽 채널을 각각 복원한 뒤 다시 합쳐서, 복원 후에도 스테레오가 유지됩니다. 파일을 선택하면 원본/복원 미리듣기 창이 열리고, 저장을 눌러야 라이브러리에 추가됩니다.</p></div></section>;
  }
  function abcNotePage() {
    return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">심볼릭 작곡 보관함</span><h1>ABC 악보</h1><p>열기로 검사·수정하고, 더블 클릭하면 지금 곡에 바로 불러옵니다.</p></div><div className="playlist-detail-actions"><Button variant="ghost" size="icon" aria-label={settings.viewMode === 'card' ? '목록 보기' : '카드 보기'} onClick={() => void setViewMode(settings.viewMode === 'card' ? 'list' : 'card')}>{settings.viewMode === 'card' ? <ListMusic/> : <LayoutGrid/>}</Button><Button onClick={() => navigate('create')}><Plus/>만들기로 이동</Button></div></div>{abcNotes.length ? <div className={`project-list ${settings.viewMode === 'card' ? 'card-view' : ''}`}>{abcNotes.map(note => <article className="song-card status-abc" key={note.id}><button className="song-symbol status-abc" aria-label={`${note.title} 열기`} onDoubleClick={() => loadAbcNote(note)} onClick={() => openAbcNote(note)}>{note.coverPath ? <img className="song-cover" src={abcNoteCoverUrl(note)} alt=""/> : <FileText size={24}/>}</button><button className="song-info" onDoubleClick={() => loadAbcNote(note)} onClick={() => openAbcNote(note)}><strong>{note.title}</strong><p>{new Date(note.createdAt).toLocaleDateString('ko-KR')}</p></button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${note.title} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end"><button className="song-menu-item" onClick={() => openAbcNote(note)}><Pencil size={15}/>열기</button><button className="song-menu-item" onClick={() => loadAbcNote(note)}><ArrowRight size={15}/>불러오기</button><button className="song-menu-item" onClick={() => openAbcNoteCoverPicker(note)}><ImageIcon size={15}/>앨범 표지 {note.coverPath ? '변경' : '등록'}</button>{note.coverPath && <button className="song-menu-item" onClick={() => void deleteAbcNoteCover(note)}><X size={15}/>앨범 표지 삭제</button>}<button className="song-menu-item danger" onClick={() => void deleteAbcNote(note)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover></article>)}</div> : <div className="empty-library"><div className="empty-icon"><FileText size={42} strokeWidth={1.25}/></div><h2>저장된 악보가 없어요</h2><p>만들기 화면에서 심볼릭 작곡을 만들고 "라이브러리에 저장"을 눌러 보세요.</p></div>}</section>;
  }
  return <div className="studio-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}><button className="brand" onClick={() => navigate('create')} aria-label="SongYUE2 만들기로 이동"><span className="brand-symbol"><AudioLines size={25}/></span><span>Song<b>YUE2</b><small>by madwind</small></span></button><div className="sidebar-main"><nav aria-label="주 메뉴">{([{ id: 'create', icon: Sparkles }, { id: 'home', icon: Home }, { id: 'projects', icon: Folder }, { id: 'library', icon: ListMusic }, { id: 'playlists', icon: ListPlus }, { id: 'abc', icon: FileText }, { id: 'favorites', icon: Heart }] as const).map(({ id, icon: Icon }) => <button className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)} key={id} aria-current={page === id ? 'page' : undefined}><Icon size={19}/><span>{titles[id]}</span>{id === 'create' && <Plus size={15} className="nav-plus"/>}</button>)}</nav><div className="sidebar-divider"/><div className="sidebar-subhead"><span>최근 프로젝트</span><button aria-label="프로젝트 보기" onClick={() => navigate('projects')}><Plus size={14}/></button></div>{(() => { const recentDrafts = projects.filter(item => item.status === 'draft').slice(0, 4); return recentDrafts.length ? recentDrafts.map(item => <button className="recent-item" key={item.id} onClick={() => loadProject(item)}><span className="recent-dot"/>{item.title}</button>) : <p className="sidebar-empty">새로운 아이디어가<br/>음악이 되는 곳.</p>; })()}</div><div className="sidebar-bottom"><nav aria-label="도구 메뉴"><button className="nav-item" onClick={() => { setCompareOpen(true); setMobileNav(false); }}><GitCompare size={18}/>음원 비교</button><button className={`nav-item ${page === 'restore' ? 'active' : ''}`} onClick={() => navigate('restore')}><Upload size={18}/>음원 복원 (실험적)</button><button className="nav-item" onClick={() => { setTimbreTransformOpen(true); setMobileNav(false); }}><WandSparkles size={18}/>음색 변조 (평가중)</button><button className={`nav-item ${page === 'tools' ? 'active' : ''}`} onClick={() => navigate('tools')}><SlidersHorizontal size={18}/>Audio Tools</button><button className={`nav-item ${page === 'models' ? 'active' : ''}`} onClick={() => navigate('models')}><Cpu size={18}/>모델 관리</button><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>설정</button><button className="nav-item" onClick={() => { setHelp(true); setMobileNav(false); }}><CircleHelp size={18}/>도움말</button></nav><div className="profile"><span className="avatar"><Headphones size={18}/></span><div>나의 스튜디오<small>로컬 워크스페이스</small></div><span className="version">0.1</span></div></div></aside>
    {mobileNav && <button className="nav-scrim" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)}/>}
    <main className="main-shell"><header className="topbar"><div className="topbar-title"><Button variant="ghost" size="icon" className="mobile-menu" aria-label="메뉴 열기" onClick={() => setMobileNav(true)}><Menu/></Button><span className="breadcrumb">작업 공간</span><ChevronRight size={14}/><strong>{titles[page]}</strong></div><Popover open={modelOpen} onOpenChange={setModelOpen}><PopoverTrigger render={<Button variant="outline" className="model-trigger" aria-label="음악 모델 선택"/>}><AudioLines size={17}/><span>{model.name}</span><span className="model-recommended">{model.id === 'yue2-q4' ? '추천' : model.engine}</span><ChevronDown size={15}/></PopoverTrigger><PopoverContent className="model-menu" align="start"><div className="menu-heading">음악 생성 모델<span>새 작업에 적용할 모델을 선택하세요</span></div>{models.map(item => <button key={item.id} className={`model-option ${draft.modelId === item.id ? 'selected' : ''}`} disabled={item.selectable === false} onClick={() => { if (item.selectable === false) return; update({ modelId: item.id }); setModelOpen(false); }}><Cpu size={18}/><span><strong>{item.name}<em>{item.badge}</em></strong><small>{item.detail} · {item.size}</small></span>{draft.modelId === item.id && <Check size={17}/>}</button>)}<div className="model-menu-footer">모델 파일과 실행 엔진의 준비 상태는 별도로 확인합니다.<button onClick={() => { navigate('models'); setModelOpen(false); }}>모델 관리 <ArrowRight size={13}/></button></div></PopoverContent></Popover><div className="device-status"><span className={`status-dot ${online ? '' : 'offline'}`}/><span>{online ? '로컬 연결됨' : '로컬 연결 대기'}</span><span className="device-divider"/><Cpu size={14}/><span>RTX 5070 <span className="muted">· 12 GB</span></span></div></header>
    {page === 'create' ? <div className="creation-layout"><section className="composer" aria-label="노래 편집기"><div className="composer-scroll"><div className="composer-heading"><div><h1>어떤 노래를 만들까요?</h1></div><Music2 size={24}/></div><div className="mode-switch" aria-label="제작 모드"><button className={draft.mode === 'simple' ? 'active' : ''} aria-pressed={draft.mode === 'simple'} onClick={() => update({ mode: 'simple' })}>간편 모드</button><button className={draft.mode === 'custom' ? 'active' : ''} aria-pressed={draft.mode === 'custom'} onClick={() => update({ mode: 'custom' })}>직접 만들기<SlidersHorizontal size={14}/></button></div><div className="mode-switch vocal-mode-switch" aria-label="보컬 여부"><button className={!draft.instrumental ? 'active' : ''} aria-pressed={!draft.instrumental} onClick={() => update({ instrumental: false })}><Mic size={14}/>보컬+악기</button><button className={draft.instrumental ? 'active' : ''} aria-pressed={draft.instrumental} onClick={() => update({ instrumental: true })}><Guitar size={14}/>악기만</button></div>
    {draft.mode === 'simple' && <div className="form-section idea-section"><label htmlFor="idea">떠오르는 아이디어</label><Textarea id="idea" value={idea} onChange={event => setIdea(event.target.value)} placeholder="친구에게 위로를 건네는 따뜻한 노래"/><Button variant="outline" onClick={() => void assist('lyrics')} disabled={!!busy}><WandSparkles/>아이디어로 가사 초안 만들기</Button><p className="field-hint">설정한 LLM이 가사 작성을 도와줘요. 직접 작성해도 좋아요.</p></div>}
    <div className="form-section"><div className="field-heading"><label htmlFor="lyrics"><FileText size={16}/>가사</label><button className="text-action" onClick={() => void assist('lyrics')} disabled={!!busy}><WandSparkles size={13}/>작사 도우미</button></div><div className="lyrics-box"><Textarea id="lyrics" value={draft.lyrics} onChange={event => update({ lyrics: event.target.value })} placeholder={'[Verse]\n이곳에 나만의 이야기를 적어 주세요.\n직접 쓴 가사를 붙여 넣어도 좋아요.\n\n[Chorus]\n마음에 남을 후렴을 들려주세요.'} maxLength={12000}/><div className="textarea-footer"><span>{draft.lyrics.length.toLocaleString()} / 12,000</span></div></div>{draft.instrumental && <p className="field-hint">악기만 선택 시 악보의 보컬 성부를 자동으로 쉼표 처리해 생성합니다(악보가 없으면 먼저 심볼릭 작곡을 실행). 가사는 스타일 프롬프트에만 참고로 남고, 실제로 불려지지 않도록 구조적으로 처리됩니다.</p>}</div>
    <div className="form-section"><div className="field-heading"><label htmlFor="style"><AudioLines size={16}/>음악 스타일</label><button className="text-action" onClick={() => void assist('style')} disabled={!!busy}><Sparkles size={13}/>스타일 다듬기</button></div><Textarea id="style" className="style-input" value={draft.style} onChange={event => update({ style: event.target.value })} placeholder={'장르, 분위기, 악기, 목소리…\n예: 따뜻한 어쿠스틱 팝, 잔잔한 기타, 부드러운 보컬'} maxLength={4000}/><div className="style-tags">{stylePresets.map(tag => <button key={tag} onClick={() => update({ style: draft.style ? `${draft.style}, ${tag}` : tag })}><Plus size={11}/>{tag}</button>)}</div></div>
    <div className="form-section title-section"><div className="field-heading"><label htmlFor="song-title">곡 제목<span className="optional">선택</span></label></div><Input id="song-title" value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="이 노래의 이름을 지어 주세요" maxLength={120}/></div><div className="advanced-section"><button className="advanced-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><span><SlidersHorizontal size={16}/>고급 설정</span><ChevronDown size={15} className={advanced ? 'rotated' : ''}/></button>{advanced && <div className="advanced-fields"><label className="seed-field"><span className="seed-label-row">Seed<button type="button" className="dice-btn" aria-label="Seed 무작위로 바꾸기" onClick={() => update({ seed: Math.floor(Math.random() * 2147483648) })}><Dices size={14}/></button></span><Input type="number" min="0" max="2147483647" value={draft.seed} disabled={randomizeSeed} onChange={event => update({ seed: Number(event.target.value) })}/><span className="seed-randomize"><input type="checkbox" checked={randomizeSeed} onChange={event => toggleRandomizeSeed(event.target.checked)}/>매번 무작위(randomize)</span></label><label>추론 단계<Input type="number" min="1" max="100" value={draft.steps} onChange={event => update({ steps: Number(event.target.value) })}/></label><label className="wide-field">작곡 계획<select value={draft.cot} onChange={event => update({ cot: event.target.value })}><option value="full">멜로디와 코드 계획 (기본)</option><option value="melody">멜로디 계획</option><option value="off">계획 없이 생성</option></select></label>{draft.instrumental ? <div className="wide-field vocal-gender-field"><span className="field-label">보컬</span><span className="vocal-gender-hint">악기만 모드에서는 보컬 없이 생성됩니다.</span></div> : <div className="wide-field vocal-gender-field"><span className="field-label">보컬</span><div className="vocal-gender-toggle"><button type="button" className={`vocal-gender-btn${draft.vocalGender === 'male' || draft.vocalGender === 'duet' ? ' active' : ''}`} onClick={() => toggleVocal('male')}>남성</button><button type="button" className={`vocal-gender-btn${draft.vocalGender === 'female' || draft.vocalGender === 'duet' ? ' active' : ''}`} onClick={() => toggleVocal('female')}>여성</button></div>{draft.vocalGender === 'duet' && <span className="vocal-gender-hint">둘 다 선택하면 듀엣으로 만들어져요</span>}</div>}<div className="wide-field abc-score-field"><div className="abc-score-header"><span className="field-label">ABC 악보 (심볼릭 작곡)<span className="optional">선택</span></span><Button type="button" variant="outline" size="sm" onClick={() => navigate('abc')}><FileText size={14}/>라이브러리 열기</Button></div><Textarea className="abc-score-textarea" value={draft.abc} onChange={event => update({ abc: event.target.value })} placeholder="비워두면 가사와 스타일만으로 생성합니다. 심볼릭 작곡을 누르면 멜로디/코드 악보가 여기에 채워져요."/><AbcPreview abc={draft.abc}/><div className="abc-score-actions"><Button type="button" variant="outline" size="sm" onClick={() => void runPlan()} disabled={!!busy || !online}>{busy === 'plan' ? <LoaderCircle className="spin"/> : <WandSparkles size={14}/>}심볼릭 작곡</Button><Button type="button" variant="outline" size="sm" onClick={() => void checkAbc()} disabled={!!busy || !draft.abc.trim()}>{busy === 'abc-check' ? <LoaderCircle className="spin"/> : <ShieldCheck size={14}/>}검사</Button><Button type="button" variant="outline" size="sm" onClick={openDraftAbcEdit} disabled={!draft.abc.trim()}><Pencil size={14}/>편집</Button><Button type="button" variant="outline" size="sm" onClick={() => void saveAbcViaPicker()} disabled={!!busy || !draft.abc.trim()}>{busy === 'abc-save-file' ? <LoaderCircle className="spin"/> : <Save size={14}/>}저장</Button><Button type="button" variant="outline" size="sm" onClick={() => abcImportInputRef.current?.click()}><FolderOpen size={14}/>파일에서 가져오기</Button><Button type="button" variant="outline" size="sm" onClick={() => coverAudioInputRef.current?.click()} disabled={!!busy || !online}>{busy === 'cover-transcribe' ? <LoaderCircle className="spin"/> : <Upload size={14}/>}오디오에서 추출</Button><Button type="button" variant="ghost" size="sm" onClick={clearAbc} disabled={!draft.abc.trim()}><X size={14}/>삭제</Button></div>{busy === 'plan' && <div className="generate-progress"><Progress aria-label="심볼릭 작곡 진행률" value={generateProgress}/><span>작곡 중... {generateProgress}%</span></div>}</div><p className="field-hint wide-field">{['yue2-q4', 'yue2-q8'].includes(model.id) ? 'VAE: F16 · 메모리를 절약하는 조합' : 'VAE: F32 · 고용량 GPU 환경용'}<br/>설정과 모델 정보는 초안에 함께 저장됩니다.</p></div>}</div></div><div className="composer-footer"><div className="compose-actions"><Button variant="outline" onClick={() => void saveDraft()} disabled={!!busy || !online}>{busy === 'save' ? <LoaderCircle className="spin"/> : <Save/>}초안 저장</Button><Button className="generate-button" onClick={requestGenerate} disabled={!!busy || !online}>{busy === 'generate' ? <LoaderCircle className="spin"/> : <Sparkles/>}노래 만들기</Button></div>{busy === 'generate' && <div className="generate-progress"><Progress aria-label="생성 진행률" value={generateProgress}/><span>생성 중... {generateProgress}%</span></div>}</div></section>
    <section className="workspace" aria-label="내 작업"><div className="workspace-heading"><div><h2>내 작업<span className="count-label">{projects.length}</span></h2><p>오늘의 아이디어가 다음 노래가 되는 곳</p></div></div>{projectList()}<div className="inspiration-section"><div className="section-caption"><span><Sparkles size={15}/>어디서 시작할지 고민된다면</span><button onClick={() => setPresetOpen(true)}>예시 둘러보기<ChevronRight size={14}/></button></div><div className="inspiration-carousel">{examples.length > 3 && <Button variant="ghost" size="icon" aria-label="이전 예시" onClick={() => setExampleIndex(previous => (previous - 1 + examples.length) % examples.length)}><ChevronLeft/></Button>}<div className="inspiration-grid">{exampleWindow.map(example => <button key={example.id} className={`inspiration-card ${example.color || ''}`} onClick={() => useExample(example)}><div className="preset-top"><Music2 size={21}/><ArrowRight size={15}/></div><span className="genre-label">{example.genre || '예시'}</span><strong>{example.title}</strong><small>{example.caption}</small></button>)}</div>{examples.length > 3 && <Button variant="ghost" size="icon" aria-label="다음 예시" onClick={() => setExampleIndex(previous => (previous + 1) % examples.length)}><ChevronRight/></Button>}</div></div><div className="workspace-note"><ShieldCheck size={15}/><span>가사와 초안은 내 PC에 저장됩니다. 클라우드 LLM은 요청할 때만 연결됩니다.</span></div></section></div>
    : page === 'settings' ? <section className="settings-page page-scroll"><div className="page-heading"><span className="eyebrow">내 작업 방식에 맞게</span><h1>스튜디오 설정</h1><p>작사 도우미와 로컬 작업 환경을 설정하세요.</p></div><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><WandSparkles size={21}/></div><div><h2>작사 도우미</h2><p>가사와 스타일을 함께 다듬을 LLM을 선택하세요.</p></div><span className="small-badge">선택 기능</span></div><div className="provider-grid">{providers.map(provider => <button key={provider.id} className={`provider-card ${settings.provider === provider.id ? 'selected' : ''}`} aria-pressed={settings.provider === provider.id} onClick={() => void selectProvider(provider.id)}><span className="provider-mark">{provider.mark}</span><strong>{provider.label}</strong><small>{provider.description}</small>{settings.provider === provider.id && <Check className="provider-check" size={15}/>}</button>)}</div>
    {settings.provider !== 'none' ? <div className="settings-form"><label className="wide-field">연결 주소<Input value={settings.endpoint || '.env 파일에 값이 없습니다'} readOnly/></label><label>LLM 모델 이름<Input value={settings.llmModel || '.env 파일에 값이 없습니다'} readOnly/></label>{settings.provider !== 'ollama' && <label>API 키<Input value={settings.apiKey || '.env 파일에 값이 없습니다'} readOnly/></label>}<p className="field-hint wide-field">연결 주소, 모델 이름, API 키는 프로젝트 폴더의 .env 파일에서 읽어옵니다. .env.sample을 복사해 .env로 저장한 뒤 값을 입력하고 앱을 다시 실행해 주세요.<br/>연결 확인은 실제 짧은 요청을 전송합니다.</p></div> : <div className="inline-note"><Check size={17}/><span>LLM 없이도 직접 쓴 가사와 스타일로 작업할 수 있어요.</span></div>}
    <div className="settings-actions"><Button variant="outline" onClick={() => { setSettings(savedSettings); notify('저장된 설정으로 되돌렸습니다.'); }}>변경 취소</Button>{settings.provider !== 'none' && <Button variant="outline" disabled={!!busy} onClick={() => void storeSettings(true)}>{busy === 'test' ? <LoaderCircle className="spin"/> : <RefreshCw/>}저장 후 연결 확인</Button>}<Button disabled={!!busy} onClick={() => void storeSettings()}><Save/>설정 저장</Button></div></section><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><Cpu size={21}/></div><div><h2>로컬 실행 환경</h2><p>음악 생성 엔진과 라이브러리 폴더 위치입니다.</p></div></div><div className="settings-form"><label className="wide-field">audio.cpp 실행 파일 (GGUF 모델용)<Input value={settings.enginePath} onChange={event => setSettings({ ...settings, enginePath: event.target.value })} placeholder={DEFAULT_ENGINE_PATH}/></label><label className="wide-field">Python 실행 파일 (원본 모델용)<Input value={settings.pythonEnginePath} onChange={event => setSettings({ ...settings, pythonEnginePath: event.target.value })} placeholder="예: test\YuE2-source\.venv\Scripts\python.exe (24GB급 VRAM 권장)"/></label><label className="wide-field">Python 스크립트 (run_yue2.py)<Input value={settings.pythonScriptPath} onChange={event => setSettings({ ...settings, pythonScriptPath: event.target.value })} placeholder="예: test\YuE2-source\skills\yue2-music\scripts\run_yue2.py"/></label><label>Python 메모리 예산 (GiB)<Input type="number" min="1" max="64" value={settings.pythonMemoryBudgetGib} onChange={event => setSettings({ ...settings, pythonMemoryBudgetGib: Number(event.target.value) })}/></label><label className="wide-field">SheetSage2 Python 실행 파일 (제로샷 커버용, 별도 venv 필요)<Input value={settings.sheetSagePythonPath} onChange={event => setSettings({ ...settings, sheetSagePythonPath: event.target.value })} placeholder="예: test\YuE2-source\.venv-sheetsage2\Scripts\python.exe"/></label><label className="wide-field">ComfyUI 연결 주소 (INT8 ConvRot 모델용)<Input value={settings.comfyUiEndpoint} onChange={event => setSettings({ ...settings, comfyUiEndpoint: event.target.value })} placeholder={DEFAULT_COMFYUI_ENDPOINT}/></label><label className="wide-field">ComfyUI 설치 폴더 (필요 시 자동 실행)<Input value={settings.comfyUiEnginePath} onChange={event => setSettings({ ...settings, comfyUiEnginePath: event.target.value })} placeholder={DEFAULT_COMFYUI_ENGINE_PATH}/></label><label className="wide-field">DDSP-SVC 설치 폴더 (음색 변조 - DDSP-SVC 탭)<Input value={settings.ddspSvcPath} onChange={event => setSettings({ ...settings, ddspSvcPath: event.target.value })} placeholder={DEFAULT_DDSP_SVC_PATH}/></label><label className="wide-field">Setting 폴더<Input value={settings.settingPath} onChange={event => setSettings({ ...settings, settingPath: event.target.value })} placeholder={DEFAULT_SETTING_PATH}/></label><label className="wide-field">Music 폴더<Input value={settings.musicPath} onChange={event => setSettings({ ...settings, musicPath: event.target.value })} placeholder={DEFAULT_MUSIC_PATH}/></label><label className="wide-field">예시 폴더<Input value={settings.examplesPath} onChange={event => setSettings({ ...settings, examplesPath: event.target.value })} placeholder={DEFAULT_EXAMPLES_PATH}/></label><label className="wide-field">앨범 표지 폴더<Input value={settings.coversPath} onChange={event => setSettings({ ...settings, coversPath: event.target.value })} placeholder={DEFAULT_COVERS_PATH}/></label><label className="wide-field">ABC 악보 폴더<Input value={settings.abcNotesPath} onChange={event => setSettings({ ...settings, abcNotesPath: event.target.value })} placeholder={DEFAULT_ABC_NOTES_PATH}/></label><label>저장 파일 형식<select value={settings.saveFormat} onChange={event => setSettings({ ...settings, saveFormat: event.target.value as Settings['saveFormat'] })}>{saveFormats.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label><label>보기 방식<select value={settings.viewMode} onChange={event => void setViewMode(event.target.value as Settings['viewMode'])}>{viewModes.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label><label className="wide-field">로그 폴더(읽기 전용)<Input value={settings.outputDirectory} readOnly/></label></div><p className="field-hint wide-field">실행 파일/스크립트/폴더는 모두 SongYUE2 폴더 기준 상대 경로입니다(절대 경로도 입력 가능). 비워두면 위 placeholder 경로가 사용되며, 폴더가 없으면 자동으로 만들어집니다. 메모리 예산은 원본 모델 생성 시 GPU VRAM 사용 한도(GiB)이며, 낮출수록 저사양 GPU에서도 동작할 가능성이 높아지지만 너무 낮으면 실패할 수 있습니다.</p><div className="settings-actions"><Button onClick={() => void storeSettings()} disabled={!!busy}><Save/>설정 저장</Button></div></section><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><Sparkles size={21}/></div><div><h2>Music style Presets</h2><p>만들기 화면의 음악 스타일 아래에 뜨는 빠른 태그 버튼입니다. 한 줄에 하나씩 입력하세요.</p></div></div><Textarea className="style-presets-textarea" value={settings.stylePresets} onChange={event => setSettings({ ...settings, stylePresets: event.target.value })} placeholder={DEFAULT_STYLE_PRESETS}/><div className="settings-actions"><Button onClick={() => void storeSettings()} disabled={!!busy}><Save/>설정 저장</Button></div></section><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><AudioLines size={21}/></div><div><h2>후처리 비주얼라이저</h2><p>후처리 / EQ 창의 원형 라이브 비주얼라이저 표시 여부와 모양입니다.</p></div></div><div className="settings-form"><label className="checkbox-label wide-field"><input type="checkbox" checked={settings.visualizerEnabled} onChange={event => setSettings({ ...settings, visualizerEnabled: event.target.checked })}/>비주얼라이저 표시</label><div className="wide-field visualizer-row"><label>라인 모드<select value={settings.visualizerRingMode} onChange={event => setSettings({ ...settings, visualizerRingMode: event.target.value as Settings['visualizerRingMode'] })}><option value="radial">1: 회전(R) 방향 — 같은 순간을 링마다 다른 각도로 표시</option><option value="time">2: 시간축 — 링마다 다른 과거 시점의 소리를 표시</option></select></label>{settings.visualizerRingMode === 'radial' ? <label>R 간격<Input type="number" min="0.1" max="20" step="0.1" value={settings.visualizerRingStep} onChange={event => setSettings({ ...settings, visualizerRingStep: Number(event.target.value) })}/></label> : <><label>시간 간격(초)<Input type="number" min="0.02" max="2" step="0.1" value={settings.visualizerTimeStep} onChange={event => setSettings({ ...settings, visualizerTimeStep: Number(event.target.value) })}/></label><label>가속도<Input type="number" min="0.2" max="4" step="0.1" value={settings.visualizerTimeSkew} onChange={event => setSettings({ ...settings, visualizerTimeSkew: Number(event.target.value) })}/></label></>}</div><div className="wide-field visualizer-row"><label>라인 색상(색조 0~360)<Input type="number" min="0" max="359" value={settings.visualizerHue} onChange={event => setSettings({ ...settings, visualizerHue: Number(event.target.value) })}/></label><label>라인 개수<Input type="number" min="1" max="40" value={settings.visualizerRingCount} onChange={event => setSettings({ ...settings, visualizerRingCount: Number(event.target.value) })}/></label><label>라인 굵기<Input type="number" min="0.5" max="8" step="0.5" value={settings.visualizerLineWidth} onChange={event => setSettings({ ...settings, visualizerLineWidth: Number(event.target.value) })}/></label><label>변동폭<Input type="number" min="0.1" max="10" step="0.1" value={settings.visualizerAmplitude} onChange={event => setSettings({ ...settings, visualizerAmplitude: Number(event.target.value) })}/></label><label>잔상(0~95)<Input type="number" min="0" max="95" value={settings.visualizerTrail} onChange={event => setSettings({ ...settings, visualizerTrail: Number(event.target.value) })}/></label><label>나선 정도(0~100)<Input type="number" min="0" max="100" value={settings.visualizerSpiral} onChange={event => setSettings({ ...settings, visualizerSpiral: Number(event.target.value) })}/></label></div></div><p className="field-hint wide-field">기본값: 표시 켬 · 라인 모드 1(회전) · R 간격 {DEFAULT_VISUALIZER_RING_STEP} · 시간 간격 {DEFAULT_VISUALIZER_TIME_STEP}초 · 가속도 {DEFAULT_VISUALIZER_TIME_SKEW} · 색조 {DEFAULT_VISUALIZER_HUE} · 라인 {DEFAULT_VISUALIZER_RING_COUNT}개 · 굵기 {DEFAULT_VISUALIZER_LINE_WIDTH} · 변동폭 {DEFAULT_VISUALIZER_AMPLITUDE} · 잔상 {DEFAULT_VISUALIZER_TRAIL} · 나선 정도 {DEFAULT_VISUALIZER_SPIRAL}. 라인 모드 1(회전)은 모든 링이 같은 순간의 소리를 각각 다른 반지름·각도로 보여줍니다 — R 간격은 링 사이의 반지름 차이입니다. 라인 모드 2(시간축)는 모든 링이 같은 반지름에서 서로 다른 과거 시점의 소리를 보여줍니다 — 시간 간격은 링 사이의 기본 시간 간격(초), 가속도는 그 간격이 링이 오래될수록 점점 벌어지는(&gt;1) 또는 점점 좁아지는(&lt;1) 정도입니다(1=일정한 간격). 변동폭은 소리 크기에 따라 반지름이 기본 반지름을 중심으로 얼마나 늘었다 줄었다 하는지입니다(중간 음량이면 기본 반지름 그대로, 조용하면 안쪽으로 줄어들고 크면 바깥으로 부풀어 오름 — 줄어드는 폭은 늘어나는 폭의 절반) — 키울수록 안팎으로 더 역동적으로 움직입니다. 잔상은 이전 프레임이 사라지는 속도를 늦춰 꼬리를 남깁니다(0=꼬리 없음, 높을수록 길게 남음). 나선 정도는 두 모드 모두에서 링마다 반지름과 함께 회전 위상이 어긋나는 정도입니다(0=완전한 동심원, 100=나선형).</p><div className="settings-actions"><Button onClick={() => void storeSettings()} disabled={!!busy}><Save/>설정 저장</Button></div></section></section>
    : page === 'models' ? <section className="models-page page-scroll"><div className="page-heading"><span className="eyebrow">내 스튜디오의 사운드 엔진</span><h1>모델 관리</h1><p>원본과 GGUF 모델을 보관하고, 상단에서 사용할 모델을 고르세요.</p></div><div className="download-overview"><div className="setting-icon"><ArrowDownToLine size={23}/></div><div className="download-copy"><h2>{inventory?.state === 'complete' ? '모델 다운로드 완료' : '모델 파일 준비 중'}</h2><p>{inventory ? `${gb(inventory.completedBytes)} / ${gb(inventory.totalBytes)}` : '로컬 다운로드 상태를 확인하고 있습니다.'}</p><Progress aria-label="전체 모델 다운로드" value={inventory?.totalBytes ? Math.min(100, inventory.completedBytes / inventory.totalBytes * 100) : 0}/></div><span className="small-badge">Hugging Face</span></div><div className="model-card-grid">{models.map(item => <article className={`model-detail-card ${draft.modelId === item.id ? 'selected' : ''}`} key={item.id}><div className="model-card-top"><Cpu size={23}/><span className="small-badge">{item.badge}</span></div><h2>{item.name}</h2><p>{item.detail}</p><div className="model-meta"><span>실행 방식<strong>{item.engine}</strong></span><span>본체 크기<strong>{item.size}</strong></span></div><div className="model-file-state"><span className={`status-dot ${installed(item) ? '' : 'amber'}`}/>{installed(item) ? '본체 다운로드됨' : '파일 준비 중'}<span>{item.engine === 'audio.cpp' ? '생성 지원' : '엔진 미지원'}</span></div><Button variant={draft.modelId === item.id ? 'default' : 'outline'} disabled={item.selectable === false} onClick={() => { update({ modelId: item.id }); notify(`${item.name} 모델을 선택했습니다.`); }}>{draft.modelId === item.id ? <><Check/>현재 선택한 모델</> : item.selectable === false ? '연결 대기' : '이 모델 선택'}</Button></article>)}</div><section className="repository-section"><h2>다운로드 보관함</h2>{inventory?.repositories?.map(repo => <div className="repository-row" key={repo.id}><Folder size={19}/><div><strong>{repo.id}</strong><small>{repo.files?.filter(file => file.state === 'complete').length || 0} / {repo.files?.length || 0}개 파일 · {gb(repo.completedBytes)} / {gb(repo.totalBytes)}</small></div><span className="small-badge">{repo.state === 'complete' ? '완료' : '다운로드 중'}</span></div>)}</section><div className="inline-note"><ShieldCheck size={18}/><span>모델 가중치 라이선스: CC BY-NC 4.0. 앱 배포 파일과 모델은 분리해 관리합니다. 다운로드와 실제 실행 가능 여부는 다릅니다.</span></div></section>
    : page === 'playlists' ? playlistPage()
    : page === 'abc' ? abcNotePage()
    : page === 'restore' ? restorePage()
    : page === 'tools' ? <AudioToolsPage notify={notify}/>
    : <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">나의 음악을 한곳에</span><h1>{titles[page]}</h1><p>{page === 'projects' ? '저장할 때마다 새 버전으로 남아, 이전 아이디어를 다시 꺼낼 수 있어요.' : '가사, 스타일, 설정까지 함께 보관하는 나만의 컬렉션.'}</p></div><Button onClick={() => navigate('create')}><Plus/>노래 만들기</Button></div>{projectList()}</section>}
    <audio ref={audioRef} onEnded={playNext} onTimeUpdate={event => setPlaybackTime(event.currentTarget.currentTime)} onLoadedMetadata={event => setPlaybackDuration(event.currentTarget.duration)} hidden/>
    <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void handleCoverFile(event)}/>
    <input ref={coverAudioInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/ogg" hidden onChange={event => void handleCoverAudioFile(event)}/>
    <input ref={restoreInputRef} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp4,audio/ogg" hidden onChange={event => void handleRestoreAudioFile(event)}/>
    <input ref={abcImportInputRef} type="file" accept=".abc,.txt,.json,text/plain,application/json" hidden onChange={event => void handleAbcImportFile(event)}/>
    {nowPlaying ? <footer className="player-bar expanded"><div className="player-seek-row"><span className="player-time">{formatTime(playbackTime)}</span><input className="player-seek" type="range" aria-label="재생 위치" min={0} max={playbackDuration || 0} step={0.1} value={Math.min(playbackTime, playbackDuration || playbackTime)} onChange={event => seekTo(Number(event.target.value))}/><span className="player-time">{formatTime(playbackDuration)}</span></div><div className="player-main-row"><div className="player-art">{nowPlaying.coverPath ? <img className="song-cover" src={coverUrl(nowPlaying)} alt=""/> : <Music2 size={20}/>}</div><div className="player-copy"><strong>{nowPlaying.title}</strong><span>{nowPlaying.style}</span></div><div className="player-controls"><Button variant="ghost" size="icon" aria-label="이전 곡" onClick={playPrev} disabled={queueIndex === 0}><SkipBack/></Button><Button variant="ghost" size="icon" aria-label="10초 뒤로" onClick={() => seekBy(-10)}><Rewind/></Button><Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={togglePlay}>{isPlaying ? <Pause/> : <Play/>}</Button><Button variant="ghost" size="icon" aria-label="눌러서 앞으로 이동, 꾹 누르면 계속 이동" onMouseDown={startHoldForward} onMouseUp={stopHoldForward} onMouseLeave={stopHoldForward} onTouchStart={startHoldForward} onTouchEnd={stopHoldForward}><FastForward/></Button><Button variant="ghost" size="icon" aria-label="다음 곡" onClick={playNext} disabled={queueIndex + 1 >= queue.length}><SkipForward/></Button><Button variant="ghost" size="icon" aria-label="역재생" aria-pressed={reversePlaying} className={reversePlaying ? 'active' : ''} onClick={toggleReverse}><RotateCcw/></Button></div><div className="player-wave"><canvas ref={mainWaveCanvasRef} className="player-wave-canvas" aria-hidden="true"/></div><div className="player-extra"><button className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed}>{playbackRate}x</button><Volume2 size={15}/><input className="player-volume" type="range" aria-label="볼륨" min={0} max={1} step={0.01} value={volume} onChange={event => changeVolume(Number(event.target.value))}/></div></div></footer>
    : <footer className="player-bar"><div className="player-art"><Music2 size={20}/></div><div className="player-copy"><strong>아직 재생할 노래가 없어요</strong><span>완성된 노래를 선택하면 이곳에서 재생됩니다.</span></div><div className="player-empty"><Headphones size={17}/><span>당신의 다음 곡을 기다리는 중</span></div><span className="player-time">— : —</span></footer>}</main>
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={19}/> : <Check size={19}/>}<span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="알림 닫기"><X size={16}/></button></div>}
    <Dialog open={presetOpen} onOpenChange={setPresetOpen}><DialogContent className="studio-dialog example-browser"><DialogTitle>어떤 분위기로 시작할까요?</DialogTitle><DialogDescription>직접 작성한 예시입니다. 카드를 선택하면 바로 편집기의 가사와 스타일이 바뀝니다.</DialogDescription><div className="dialog-scroll"><div className="example-card-grid">{examples.map(example => <button className={`inspiration-card ${example.color || ''}`} key={example.id} onClick={() => useExample(example)}><div className="preset-top"><Music2 size={21}/><ArrowRight size={15}/></div><span className="genre-label">{example.genre || '예시'}</span><strong>{example.title}</strong><small>{example.caption}</small></button>)}</div></div></DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="studio-dialog"><DialogTitle>나만의 음악 작업실 사용 안내</DialogTitle><DialogDescription>작은 아이디어를 노래로 만드는 과정</DialogDescription><div className="dialog-scroll help-content"><h3>01 · 상단에서 음악 모델 선택</h3><p>이 PC에서는 Q4와 F16 VAE 조합을 우선 검증할 예정입니다.</p><h3>02 · 가사와 분위기 작성</h3><p>직접 입력하거나 예시를 불러오세요. 작사 도우미는 설정에서 선택할 수 있습니다.</p><h3>03 · 초안 저장과 버전 비교</h3><p>라이브러리에서 설정을 다시 불러와 수정하세요. 저장할 때마다 새 버전이 남습니다.</p><div className="inline-note warning">설정에서 audio.cpp 실행 파일 경로를 지정하면 노래 만들기에서 실제 음악을 생성하고 바로 재생할 수 있습니다.</div></div></DialogContent></Dialog>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{selected?.title}</DialogTitle><DialogDescription>{selected?.status === 'completed' ? '완성된 곡 · 재생하고 메모를 남기세요.' : '저장된 초안 · 원본 가사와 설정은 그대로 보관됩니다.'}</DialogDescription>{selected?.status === 'completed' && <><audio controls className="detail-audio" src={`/api/projects/${selected.id}/audio`}/>{selected.saveError && <p className="detail-saved-path warning"><CircleHelp size={13}/>{selected.saveError}</p>}</>}<div className="dialog-scroll"><label>음악 스타일</label><p className="detail-style">{selected?.style}</p><label>가사</label><pre className="detail-lyrics">{selected?.lyrics}</pre><label htmlFor="project-notes">작업 메모</label><Textarea id="project-notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="다음 버전에서 바꾸고 싶은 점"/></div><div className="dialog-actions"><Button variant="outline" onClick={() => setSelected(null)}>취소</Button><Button variant="outline" onClick={() => { if (selected) window.location.assign(`/api/projects/${selected.id}/export`); }}><ArrowDownToLine/>내보내기</Button><Button variant="outline" onClick={() => { if (selected) loadProject(selected); }}>설정 불러오기</Button><Button disabled={!!busy} onClick={async () => { if (!selected) return; setBusy('notes'); try { const item = await api<Project>(`/projects/${selected.id}`, 'PATCH', { notes }); setProjects(previous => previous.map(project => project.id === item.id ? item : project)); setSelected(null); notify('메모를 저장했습니다.'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); } }}><Save/>메모 저장</Button></div></DialogContent></Dialog>
    <AlertDialog open={!!coverPendingProject} onOpenChange={open => { if (!open) setCoverPendingProject(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>이미 작성 중인 가사/스타일이 있어요</AlertDialogTitle><AlertDialogDescription>"{coverPendingProject?.title}"의 멜로디로 커버를 만들 때, 지금 작성 중인 가사·스타일·설정을 유지할까요, 아니면 이 곡에 저장된 설정으로 바꿀까요? 어느 쪽이든 ABC 악보는 이 곡의 멜로디로 채워집니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={!!busy}>취소</AlertDialogCancel><AlertDialogAction variant="outline" disabled={!!busy} onClick={() => { if (coverPendingProject) void runCover(coverPendingProject, false); }}>{busy === 'cover-transcribe' ? <LoaderCircle className="spin"/> : null}현재 설정 유지</AlertDialogAction><AlertDialogAction disabled={!!busy} onClick={() => { if (coverPendingProject) void runCover(coverPendingProject, true); }}>{busy === 'cover-transcribe' ? <LoaderCircle className="spin"/> : null}이 곡 설정 사용</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTarget?.title}을(를) 삭제할까요?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.status === 'completed' ? '가사, 스타일, 생성된 음원이 모두 삭제되며 되돌릴 수 없습니다. 이 곡을 만든 프로젝트(초안)는 영향을 받지 않습니다.' : '가사와 스타일 설정이 삭제되며 되돌릴 수 없습니다. 이 프로젝트로 이미 만든 노래는 삭제되지 않고 라이브러리에 그대로 남습니다.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={!!busy}>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={!!busy} onClick={() => { if (deleteTarget) void deleteProject(deleteTarget); }}>{busy === 'delete' ? <LoaderCircle className="spin"/> : <Trash2/>}삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!downloadTarget} onOpenChange={open => { if (!open) setDownloadTarget(null); }}><DialogContent className="studio-dialog"><DialogTitle>{downloadTarget?.title} 다운로드</DialogTitle><DialogDescription>받을 파일 형식을 선택하세요. 여러 개를 함께 받을 수 있어요.</DialogDescription><div className="download-format-list">{saveFormats.map(format => <label key={format.id} className="download-format-item"><input type="checkbox" checked={downloadFormats.has(format.id)} onChange={() => toggleDownloadFormat(format.id)}/>{format.label}</label>)}</div><div className="dialog-actions"><Button variant="outline" onClick={() => setDownloadTarget(null)}>취소</Button><Button disabled={!downloadFormats.size} onClick={confirmDownload}><Download/>다운로드</Button></div></DialogContent></Dialog>
    <Dialog open={!!abcEditTarget} onOpenChange={open => { if (!open) cancelAbcEdit(); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{abcEditTarget?.title}</DialogTitle><DialogDescription>악보를 검사하거나 수정한 뒤 저장하세요. 저장하지 않고 닫으면 변경 내용이 사라집니다.</DialogDescription><div className="dialog-scroll"><Textarea className="abc-edit-textarea" value={abcEditText} onChange={event => setAbcEditText(event.target.value)}/><AbcPreview abc={abcEditText} large controlsSlot={abcControlsSlot}/></div><div className="abc-player-slot" ref={setAbcControlsSlot}/><div className="abc-ai-edit-row"><Input value={abcAiInstruction} onChange={event => setAbcAiInstruction(event.target.value)} placeholder="AI에게 지시 (예: 후렴을 더 밝게 바꿔줘)"/><Button variant="outline" onClick={() => void applyAbcAiEdit(abcEditText, setAbcEditText)} disabled={!!busy || !online}>{busy === 'abc-ai' ? <LoaderCircle className="spin"/> : <WandSparkles size={14}/>}AI 적용</Button></div><div className="dialog-actions"><Button variant="outline" onClick={() => void checkAbcEditText()} disabled={!!busy}>{busy === 'abc-check' ? <LoaderCircle className="spin"/> : <ShieldCheck/>}악보 검사</Button><Button variant="outline" onClick={() => { if (abcEditTarget) loadAbcNote({ ...abcEditTarget, abc: abcEditText }); }}><ArrowRight/>불러오기</Button><Button variant="outline" onClick={cancelAbcEdit} disabled={!!busy}>취소</Button><Button onClick={() => void saveAbcEdit()} disabled={!!busy}>{busy === 'abc-save' ? <LoaderCircle className="spin"/> : <Save/>}저장</Button></div></DialogContent></Dialog>
    <Dialog open={draftAbcDialogOpen} onOpenChange={open => { if (!open) cancelDraftAbcEdit(); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>악보 편집</DialogTitle><DialogDescription>지금 만들고 있는 곡의 악보를 검사하거나 수정한 뒤 저장하세요. 저장하지 않고 닫으면 변경 내용이 사라집니다.</DialogDescription><div className="dialog-scroll"><Textarea className="abc-edit-textarea" value={draftAbcDraftText} onChange={event => setDraftAbcDraftText(event.target.value)}/><AbcPreview abc={draftAbcDraftText} large controlsSlot={abcControlsSlot}/></div><div className="abc-player-slot" ref={setAbcControlsSlot}/><div className="abc-ai-edit-row"><Input value={abcAiInstruction} onChange={event => setAbcAiInstruction(event.target.value)} placeholder="AI에게 지시 (예: 후렴을 더 밝게 바꿔줘)"/><Button variant="outline" onClick={() => void applyAbcAiEdit(draftAbcDraftText, setDraftAbcDraftText)} disabled={!!busy || !online}>{busy === 'abc-ai' ? <LoaderCircle className="spin"/> : <WandSparkles size={14}/>}AI 적용</Button></div><div className="dialog-actions"><Button variant="outline" onClick={() => void checkDraftAbcEditText()} disabled={!!busy}>{busy === 'abc-check' ? <LoaderCircle className="spin"/> : <ShieldCheck/>}악보 검사</Button><Button variant="outline" onClick={cancelDraftAbcEdit} disabled={!!busy}>취소</Button><Button onClick={saveDraftAbcEdit} disabled={!!busy}><Save/>저장</Button></div></DialogContent></Dialog>
    <Dialog open={abcSaveDialogOpen} onOpenChange={setAbcSaveDialogOpen}><DialogContent className="studio-dialog"><DialogTitle>악보 저장</DialogTitle><DialogDescription>이 브라우저에서는 탐색기로 바로 저장할 수 없어, 저장할 폴더와 파일명을 직접 확인해 주세요.</DialogDescription><div className="dialog-scroll"><label>폴더<Input value={abcSaveFolder} onChange={event => setAbcSaveFolder(event.target.value)} placeholder={DEFAULT_ABC_NOTES_PATH}/></label><label>파일명<Input value={abcSaveFilename} onChange={event => setAbcSaveFilename(event.target.value)} placeholder="악보"/></label></div><div className="dialog-actions"><Button variant="outline" onClick={() => setAbcSaveDialogOpen(false)} disabled={busy === 'abc-save-file'}>취소</Button><Button onClick={() => void confirmAbcSave()} disabled={busy === 'abc-save-file'}>{busy === 'abc-save-file' ? <LoaderCircle className="spin"/> : <Save/>}저장</Button></div></DialogContent></Dialog>
    <Dialog open={!!playlistPickerTarget} onOpenChange={open => { if (!open) setPlaylistPickerTarget(null); }}><DialogContent className="studio-dialog"><DialogTitle>재생목록에 추가</DialogTitle><DialogDescription>{playlistPickerTarget?.title}을(를) 추가할 재생목록을 고르세요.</DialogDescription><div className="dialog-scroll playlist-picker-list">{playlists.map(list => <button key={list.id} className="playlist-picker-item" onClick={() => { if (playlistPickerTarget) void addToPlaylist(playlistPickerTarget, list); setPlaylistPickerTarget(null); }}><ListPlus size={16}/><span>{list.name}</span><small>{list.songIds.length}곡</small></button>)}</div><div className="playlist-picker-new"><Input value={newPlaylistName} onChange={event => setNewPlaylistName(event.target.value)} placeholder="새 재생목록 이름"/><Button variant="outline" disabled={!newPlaylistName.trim()} onClick={() => { const target = playlistPickerTarget; if (target) void createPlaylistWith(newPlaylistName, target); setPlaylistPickerTarget(null); }}><Plus/>만들기</Button></div><div className="dialog-actions"><Button variant="outline" onClick={() => setPlaylistPickerTarget(null)}>닫기</Button></div></DialogContent></Dialog>
    <AlertDialog open={pythonWarningOpen} onOpenChange={setPythonWarningOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>원본(Python) 모델로 생성할까요?</AlertDialogTitle><AlertDialogDescription>이 모델은 공식적으로 24GB급 VRAM을 권장합니다. {gpuVramMb !== null ? `이 PC에서 감지된 GPU 메모리는 약 ${(gpuVramMb / 1024).toFixed(0)}GB입니다.` : 'GPU 사양을 확인하지 못했습니다.'} 설정의 메모리 예산을 낮추면 짧은 곡은 더 적은 VRAM에서도 만들어질 수 있지만, 길거나 복잡한 곡은 여전히 실패할 수 있어요. 그래도 진행하시겠어요?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => { setPythonWarningOpen(false); void saveDraft(true); }}>그래도 진행</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!suggestion} onOpenChange={open => { if (!open) { setSuggestion(null); setEditingSuggestion(false); } }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{suggestion?.task === 'lyrics' ? '가사 제안' : '스타일 제안'}</DialogTitle><DialogDescription>내용을 확인한 뒤 적용하세요. 필요하면 편집한 뒤 적용할 수 있어요.</DialogDescription><div className="dialog-scroll">{editingSuggestion ? <Textarea className="detail-lyrics suggestion-textarea" value={suggestion?.text || ''} onChange={event => { if (suggestion) setSuggestion({ ...suggestion, text: event.target.value }); }}/> : <pre className="detail-lyrics">{suggestion?.text}</pre>}</div><div className="dialog-actions"><Button variant="outline" onClick={() => setEditingSuggestion(!editingSuggestion)}><Pencil size={14}/>{editingSuggestion ? '편집 완료' : '편집'}</Button><Button variant="outline" onClick={() => { setSuggestion(null); setEditingSuggestion(false); }}>취소</Button><Button onClick={() => { if (suggestion) update({ [suggestion.task]: suggestion.text }); setSuggestion(null); setEditingSuggestion(false); }}>편집기에 적용</Button></div></DialogContent></Dialog>
    {postProcessTarget && <PostProcessDialog project={postProcessTarget} onClose={() => setPostProcessTarget(null)} notify={notify} visualizerEnabled={settings.visualizerEnabled} visualizerRingCount={settings.visualizerRingCount} visualizerHue={settings.visualizerHue} visualizerLineWidth={settings.visualizerLineWidth} visualizerTrail={settings.visualizerTrail} visualizerSpiral={settings.visualizerSpiral} visualizerRingMode={settings.visualizerRingMode} visualizerTimeStep={settings.visualizerTimeStep} visualizerTimeSkew={settings.visualizerTimeSkew} visualizerRingStep={settings.visualizerRingStep} visualizerAmplitude={settings.visualizerAmplitude}/>}
    {stemTarget && <StemDialog project={stemTarget.project} mode={stemTarget.mode} onClose={() => setStemTarget(null)} notify={notify} visualizerEnabled={settings.visualizerEnabled} visualizerRingCount={settings.visualizerRingCount} visualizerHue={settings.visualizerHue} visualizerLineWidth={settings.visualizerLineWidth} visualizerTrail={settings.visualizerTrail} visualizerSpiral={settings.visualizerSpiral} visualizerRingMode={settings.visualizerRingMode} visualizerTimeStep={settings.visualizerTimeStep} visualizerTimeSkew={settings.visualizerTimeSkew} visualizerRingStep={settings.visualizerRingStep} visualizerAmplitude={settings.visualizerAmplitude}/>}
    {midiEditorTarget && <MidiEditorDialog project={midiEditorTarget} onClose={() => setMidiEditorTarget(null)} notify={notify}/>}
    {timbreTransformOpen && <TimbreTransformDialog onClose={() => setTimbreTransformOpen(false)} notify={notify} onCreated={item => setProjects(previous => [item, ...previous])} ddspActiveJobs={ddspActiveJobs} onDdspJobStarted={(previewId, jobId) => setDdspActiveJobs(previous => ({ ...previous, [previewId]: jobId }))} onDdspJobCleared={previewId => setDdspActiveJobs(previous => { const next = { ...previous }; delete next[previewId]; return next; })}/>}
    {restoreFile && <AudioRestoreDialog file={restoreFile} onClose={() => setRestoreFile(null)} notify={notify} onCreated={item => setProjects(previous => [item, ...previous])}/>}
    {compareOpen && <AudioCompareDialog onClose={() => setCompareOpen(false)} notify={notify} onCreated={item => setProjects(previous => [item, ...previous])}/>}
  </div>;
}
