'use client';
import { useEffect, useRef, useState } from 'react';
import { AudioLines, ArrowDownToLine, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Cpu, Download, FastForward, FileText, Folder, Headphones, Heart, Home, Image as ImageIcon, LayoutGrid, ListMusic, ListPlus, LoaderCircle, Menu, MoreVertical, Music2, Pause, Pencil, Play, Plus, RefreshCw, Rewind, RotateCcw, Save, Search, Settings2, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Trash2, Volume2, WandSparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { api, emptyDraft, initialSettings, models, providers, saveFormats, viewModes, titles, gb, DEFAULT_SETTING_PATH, DEFAULT_MUSIC_PATH, DEFAULT_EXAMPLES_PATH, DEFAULT_ENGINE_PATH, PYTHON_MODEL_MIN_VRAM_MB, type Page, type Draft, type Project, type Settings, type Inventory, type Example, type Playlist, type SaveFormat, type SystemInfo } from './studio-data';

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
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
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
  const coverTargetRef = useRef<Project | null>(null);
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
    setBusy(generate ? 'generate' : 'save');
    try {
      const item = await api<Project>('/projects', 'POST', { ...draft, title: draft.title.trim() || '제목 없는 노래' }); setProjects(previous => [item, ...previous]);
      if (generate) {
        try {
          const completed = await api<Project>('/generate', 'POST', { projectId: item.id });
          setProjects(previous => [completed, ...previous]);
          notify('노래가 완성되었습니다. 라이브러리에서 들어보세요.');
        } catch (error) { throw new Error(`초안은 저장했습니다. ${(error as Error).message}`); }
      } else notify('초안을 내 PC에 저장했습니다. 라이브러리에서 다시 열 수 있어요.');
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  async function storeSettings(test = false) {
    setBusy(test ? 'test' : 'settings');
    try { const result = await api<Settings>('/settings', 'PUT', { provider: settings.provider, enginePath: settings.enginePath, pythonEnginePath: settings.pythonEnginePath, pythonScriptPath: settings.pythonScriptPath, settingPath: settings.settingPath, musicPath: settings.musicPath, examplesPath: settings.examplesPath, saveFormat: settings.saveFormat }); setSettings(result); setSavedSettings(result); if (test) { await api('/llm/test', 'POST'); notify('연결을 확인했습니다. 작사 도우미를 사용할 수 있어요.'); } else notify('설정을 저장했습니다.'); }
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
    try { const result = await api<{ text: string }>('/llm/assist', 'POST', { task, prompt: idea, lyrics: draft.lyrics, style: draft.style }); setSuggestion({ task, text: result.text }); } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
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
  function loadProject(item: Project) { setDraft({ title: item.title, lyrics: item.lyrics, style: item.style, modelId: item.modelId, seed: item.seed, steps: item.steps, cot: item.cot, vocalGender: item.vocalGender || '', mode: item.mode }); setSelected(null); navigate('create'); notify('설정을 불러왔습니다. 다시 저장하면 새 버전으로 남습니다.'); }
  function requestGenerate() {
    const vramSufficient = gpuVramMb !== null && gpuVramMb >= PYTHON_MODEL_MIN_VRAM_MB;
    if (draft.modelId === 'yue2-original' && !vramSufficient) { setPythonWarningOpen(true); return; }
    void saveDraft(true);
  }
  function toggleVocal(part: 'male' | 'female') {
    const hasMale = draft.vocalGender === 'male' || draft.vocalGender === 'duet';
    const hasFemale = draft.vocalGender === 'female' || draft.vocalGender === 'duet';
    const nextMale = part === 'male' ? !hasMale : hasMale;
    const nextFemale = part === 'female' ? !hasFemale : hasFemale;
    const next = nextMale && nextFemale ? 'duet' : nextMale ? 'male' : nextFemale ? 'female' : '';
    update({ vocalGender: next });
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
  function openCoverPicker(item: Project) { coverTargetRef.current = item; coverInputRef.current?.click(); }
  async function handleCoverFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const item = coverTargetRef.current;
    event.target.value = '';
    if (!file || !item) return;
    if (file.size > 6 * 1024 * 1024) { notify('이미지가 너무 큽니다. 6MB 이하로 줄여 주세요.', true); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsDataURL(file); });
    try { const result = await api<Project>(`/projects/${item.id}/cover`, 'POST', { dataUrl }); setProjects(previous => previous.map(project => project.id === item.id ? result : project)); notify('커버 이미지를 등록했습니다.'); }
    catch (error) { notify((error as Error).message, true); }
  }
  async function deleteCover(item: Project) {
    try { await api(`/projects/${item.id}/cover`, 'DELETE'); setProjects(previous => previous.map(project => project.id === item.id ? { ...project, coverPath: null } : project)); notify('커버 이미지를 삭제했습니다.'); }
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
  const visibleProjects = projects.filter(item => (page !== 'library' || item.status === 'completed') && (page !== 'projects' || item.status === 'draft') && (page !== 'favorites' || item.favorite) && (tab !== 'favorites' || item.favorite) && (tab !== 'audio' || item.status === 'completed') && (tab !== 'projects' || item.status === 'draft') && `${item.title} ${item.style}`.toLowerCase().includes(query.toLowerCase()));
  const exampleWindow = examples.length > 3 ? [0, 1, 2].map(offset => examples[(exampleIndex + offset) % examples.length]) : examples;
  const activePlaylist = playlists.find(list => list.id === activePlaylistId) || null;
  const playlistSongs = activePlaylist ? activePlaylist.songIds.map(id => projects.find(project => project.id === id)).filter((item): item is Project => !!item) : [];
  const installed = (item: typeof models[number]) => inventory?.repositories?.some(repo => (item.id !== 'yue2-original' || repo.id === 'm-a-p/YuE2-3B') && repo.files?.some(file => file.path.endsWith(item.file) && file.state === 'complete'));
  function projectList() { return <>
    <div className="collection-toolbar"><div className="collection-tabs" aria-label="작업 필터">{([['all', '전체'], ['projects', '프로젝트'], ['audio', '완성된 곡'], ['favorites', '좋아요']] as const).map(([value, label]) => <button key={value} aria-pressed={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}{value === 'all' && <span>{projects.length}</span>}</button>)}</div><div className="collection-actions"><div className="search-field"><Search size={15}/><input aria-label="곡 검색" placeholder="곡 검색" value={query} onChange={event => setQuery(event.target.value)}/></div><Button variant="ghost" size="icon" aria-label={settings.viewMode === 'card' ? '목록 보기' : '카드 보기'} onClick={() => void setViewMode(settings.viewMode === 'card' ? 'list' : 'card')}>{settings.viewMode === 'card' ? <ListMusic/> : <LayoutGrid/>}</Button></div></div>
    {visibleProjects.length ? <div className={`project-list ${settings.viewMode === 'card' ? 'card-view' : ''}`}>{visibleProjects.map(item => <article className="song-card" key={item.id}><button className="song-symbol" aria-label={item.status === 'completed' ? `${item.title} 재생` : `${item.title} 설정 불러오기`} onClick={() => item.status === 'completed' ? playQueue(visibleProjects, visibleProjects.indexOf(item)) : loadProject(item)}>{item.coverPath ? <img className="song-cover" src={`/api/projects/${item.id}/cover`} alt=""/> : item.status === 'completed' ? <AudioLines size={24}/> : <FileText size={24}/>}</button><button className="song-info" onClick={() => item.status === 'completed' ? (setSelected(item), setNotes(item.notes || '')) : loadProject(item)}><strong>{item.title}</strong><p>{item.style}</p><div><span className="small-badge">{item.status === 'completed' ? '완성' : '초안'}</span><span>{models.find(m => m.id === item.modelId)?.name || item.modelId}</span><span>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span></div></button><Button variant="ghost" size="icon" aria-label={item.favorite ? `${item.title} 좋아요 취소` : `${item.title} 좋아요`} onClick={() => void favorite(item)} className={item.favorite ? 'hearted' : ''}><Heart fill={item.favorite ? 'currentColor' : 'none'}/></Button><Button variant="ghost" size="icon" aria-label={`${item.title} 설정 불러오기`} onClick={() => loadProject(item)}><ArrowRight/></Button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${item.title} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end">{item.status === 'completed' ? <><button className="song-menu-item" onClick={() => loadProject(item)}><RefreshCw size={15}/>리믹스(설정 재사용)</button><button className="song-menu-item" onClick={() => renameProject(item)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item" onClick={() => openDownload(item)}><Download size={15}/>다운로드</button><button className="song-menu-item" onClick={() => setPlaylistPickerTarget(item)}><ListPlus size={15}/>재생목록에 추가</button><button className="song-menu-item" onClick={() => openCoverPicker(item)}><ImageIcon size={15}/>커버 {item.coverPath ? '변경' : '등록'}</button>{item.coverPath && <button className="song-menu-item" onClick={() => void deleteCover(item)}><X size={15}/>커버 삭제</button>}<button className="song-menu-item" onClick={() => { setSelected(item); setNotes(item.notes || ''); }}><CircleHelp size={15}/>상세 정보</button></> : <><button className="song-menu-item" onClick={() => renameProject(item)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item" onClick={() => void addAsExample(item)}><Sparkles size={15}/>예시로 추가하기</button><button className="song-menu-item" onClick={() => openCoverPicker(item)}><ImageIcon size={15}/>커버 {item.coverPath ? '변경' : '등록'}</button></>}<button className="song-menu-item danger" onClick={() => setDeleteTarget(item)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover></article>)}</div> : <div className="empty-library"><div className="empty-icon"><AudioLines size={42} strokeWidth={1.25}/></div><h2>{query ? '검색 결과가 없어요' : tab === 'audio' ? '완성된 노래가 아직 없어요' : page === 'favorites' || tab === 'favorites' ? '마음에 드는 곡을 모아 보세요' : '첫 번째 노래를 기다리고 있어요'}</h2><p>{query ? '다른 제목이나 스타일로 검색해 보세요.' : tab === 'audio' ? '노래 만들기로 곡을 생성하면 이곳에서 결과를 들을 수 있어요.' : page === 'favorites' || tab === 'favorites' ? '저장한 곡의 하트를 누르면 이곳에 나타나요.' : <>가사 한 줄, 떠오르는 분위기에서 시작해 보세요.<br/>저장한 초안과 완성된 곡이 이곳에 모입니다.</>}</p>{!query && tab === 'all' && page !== 'favorites' && <Button variant="outline" className="soft-button" onClick={() => setPresetOpen(true)}><Sparkles/>예시로 시작하기<ArrowRight/></Button>}</div>}
  </>; }
  function playlistPage() {
    if (activePlaylist) return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><button className="playlist-back" onClick={() => setActivePlaylistId(null)}><ChevronLeft size={15}/>재생목록</button><h1>{activePlaylist.name}</h1><p>{playlistSongs.length}곡</p></div><Button onClick={() => playQueue(playlistSongs, 0)} disabled={!playlistSongs.some(item => item.status === 'completed')}><Play/>전체 재생</Button></div>{playlistSongs.length ? <div className="project-list">{playlistSongs.map(item => <article className="song-card" key={item.id}><button className="song-symbol" aria-label={`${item.title} 재생`} onClick={() => playQueue(playlistSongs, playlistSongs.indexOf(item))}>{item.coverPath ? <img className="song-cover" src={`/api/projects/${item.id}/cover`} alt=""/> : item.status === 'completed' ? <AudioLines size={24}/> : <FileText size={24}/>}</button><button className="song-info" onClick={() => { setSelected(item); setNotes(item.notes || ''); }}><strong>{item.title}</strong><p>{item.style}</p></button><Button variant="ghost" size="icon" aria-label={`${item.title} 재생목록에서 제거`} onClick={() => void removeFromPlaylist(activePlaylist, item.id)}><X/></Button></article>)}</div> : <div className="empty-library"><div className="empty-icon"><ListPlus size={42} strokeWidth={1.25}/></div><h2>아직 곡이 없어요</h2><p>노래의 &quot;...&quot; 메뉴에서 이 재생목록에 곡을 추가해 보세요.</p></div>}</section>;
    return <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">연속 재생을 위한 모음</span><h1>재생목록</h1><p>라이브러리의 곡을 모아 이 PC에서 이어 들으세요.</p></div><Button onClick={() => void createPlaylistWith(`새 재생목록 ${playlists.length + 1}`)}><Plus/>새 재생목록</Button></div>{playlists.length ? <div className="playlist-grid">{playlists.map(list => <article className="playlist-card" key={list.id}><button onClick={() => setActivePlaylistId(list.id)}><ListPlus size={22}/><strong>{list.name}</strong><small>{list.songIds.length}곡</small></button><Popover><PopoverTrigger render={<Button variant="ghost" size="icon" aria-label={`${list.name} 더보기`}/>}><MoreVertical/></PopoverTrigger><PopoverContent className="song-menu" align="end"><button className="song-menu-item" onClick={() => void renamePlaylist(list)}><Pencil size={15}/>이름 변경</button><button className="song-menu-item danger" onClick={() => void deletePlaylist(list)}><Trash2 size={15}/>삭제</button></PopoverContent></Popover></article>)}</div> : <div className="empty-library"><div className="empty-icon"><ListPlus size={42} strokeWidth={1.25}/></div><h2>첫 재생목록을 만들어 보세요</h2><p>완성된 곡들을 모아 두면 이 PC에서 순서대로 이어 들을 수 있어요.</p></div>}</section>;
  }
  return <div className="studio-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}><button className="brand" onClick={() => navigate('create')} aria-label="SongYUE2 만들기로 이동"><span className="brand-symbol"><AudioLines size={25}/></span><span>Song<b>YUE2</b><small>나만의 음악 작업실</small></span></button><div className="sidebar-main"><span className="nav-caption">작업 공간</span><nav aria-label="주 메뉴">{([{ id: 'create', icon: Sparkles }, { id: 'home', icon: Home }, { id: 'projects', icon: Folder }, { id: 'library', icon: ListMusic }, { id: 'playlists', icon: ListPlus }, { id: 'favorites', icon: Heart }] as const).map(({ id, icon: Icon }) => <button className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)} key={id} aria-current={page === id ? 'page' : undefined}><Icon size={19}/><span>{titles[id]}</span>{id === 'create' && <Plus size={15} className="nav-plus"/>}</button>)}</nav><div className="sidebar-divider"/><div className="sidebar-subhead"><span>최근 프로젝트</span><button aria-label="프로젝트 보기" onClick={() => navigate('projects')}><Plus size={14}/></button></div>{projects.length ? projects.slice(0, 4).map(item => <button className="recent-item" key={item.id} onClick={() => loadProject(item)}><span className="recent-dot"/>{item.title}</button>) : <p className="sidebar-empty">새로운 아이디어가<br/>음악이 되는 곳.</p>}</div><div className="sidebar-bottom"><div className="local-card"><span className="status-dot"/><strong>내 PC 작업 공간</strong><p>아이디어는 자유롭게.<br/>음악은 나의 공간에.</p></div><nav aria-label="도구 메뉴"><button className={`nav-item ${page === 'models' ? 'active' : ''}`} onClick={() => navigate('models')}><Cpu size={18}/>모델 관리</button><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18}/>설정</button><button className="nav-item" onClick={() => { setHelp(true); setMobileNav(false); }}><CircleHelp size={18}/>도움말</button></nav><div className="profile"><span className="avatar"><Headphones size={18}/></span><div>나의 스튜디오<small>로컬 워크스페이스</small></div><span className="version">0.1</span></div></div></aside>
    {mobileNav && <button className="nav-scrim" aria-label="메뉴 닫기" onClick={() => setMobileNav(false)}/>}
    <main className="main-shell"><header className="topbar"><div className="topbar-title"><Button variant="ghost" size="icon" className="mobile-menu" aria-label="메뉴 열기" onClick={() => setMobileNav(true)}><Menu/></Button><span className="breadcrumb">작업 공간</span><ChevronRight size={14}/><strong>{titles[page]}</strong></div><Popover open={modelOpen} onOpenChange={setModelOpen}><PopoverTrigger render={<Button variant="outline" className="model-trigger" aria-label="음악 모델 선택"/>}><AudioLines size={17}/><span>{model.name}</span><span className="model-recommended">{model.id === 'yue2-q4' ? '추천' : model.engine}</span><ChevronDown size={15}/></PopoverTrigger><PopoverContent className="model-menu" align="start"><div className="menu-heading">음악 생성 모델<span>새 작업에 적용할 모델을 선택하세요</span></div>{models.map(item => <button key={item.id} className={`model-option ${draft.modelId === item.id ? 'selected' : ''}`} onClick={() => { update({ modelId: item.id }); setModelOpen(false); }}><Cpu size={18}/><span><strong>{item.name}<em>{item.badge}</em></strong><small>{item.detail} · {item.size}</small></span>{draft.modelId === item.id && <Check size={17}/>}</button>)}<div className="model-menu-footer">모델 파일과 실행 엔진의 준비 상태는 별도로 확인합니다.<button onClick={() => { navigate('models'); setModelOpen(false); }}>모델 관리 <ArrowRight size={13}/></button></div></PopoverContent></Popover><div className="device-status"><span className={`status-dot ${online ? '' : 'offline'}`}/><span>{online ? '로컬 연결됨' : '로컬 연결 대기'}</span><span className="device-divider"/><Cpu size={14}/><span>RTX 5070 <span className="muted">· 12 GB</span></span></div></header>
    {page === 'create' ? <div className="creation-layout"><section className="composer" aria-label="노래 편집기"><div className="composer-scroll"><div className="composer-heading"><div><span className="eyebrow">작은 아이디어, 나만의 음악</span><h1>어떤 노래를 만들까요?</h1></div><Music2 size={24}/></div><div className="mode-switch" aria-label="제작 모드"><button className={draft.mode === 'simple' ? 'active' : ''} aria-pressed={draft.mode === 'simple'} onClick={() => update({ mode: 'simple' })}>간편 모드</button><button className={draft.mode === 'custom' ? 'active' : ''} aria-pressed={draft.mode === 'custom'} onClick={() => update({ mode: 'custom' })}>직접 만들기<SlidersHorizontal size={14}/></button></div>
    {draft.mode === 'simple' && <div className="form-section idea-section"><label htmlFor="idea">떠오르는 아이디어</label><Textarea id="idea" value={idea} onChange={event => setIdea(event.target.value)} placeholder="친구에게 위로를 건네는 따뜻한 노래"/><Button variant="outline" onClick={() => void assist('lyrics')} disabled={!!busy}><WandSparkles/>아이디어로 가사 초안 만들기</Button><p className="field-hint">설정한 LLM이 가사 작성을 도와줘요. 직접 작성해도 좋아요.</p></div>}
    <div className="form-section"><div className="field-heading"><label htmlFor="lyrics"><FileText size={16}/>가사</label><button className="text-action" onClick={() => void assist('lyrics')} disabled={!!busy}><WandSparkles size={13}/>작사 도우미</button></div><div className="lyrics-box"><Textarea id="lyrics" value={draft.lyrics} onChange={event => update({ lyrics: event.target.value })} placeholder={'[Verse]\n이곳에 나만의 이야기를 적어 주세요.\n직접 쓴 가사를 붙여 넣어도 좋아요.\n\n[Chorus]\n마음에 남을 후렴을 들려주세요.'} maxLength={12000}/><div className="textarea-footer"><button onClick={() => update({ lyrics: `${draft.lyrics}${draft.lyrics ? '\n\n' : ''}[Chorus]\n` })}><Plus size={12}/>후렴 추가</button><span>{draft.lyrics.length.toLocaleString()} / 12,000</span></div></div></div>
    <div className="form-section"><div className="field-heading"><label htmlFor="style"><AudioLines size={16}/>음악 스타일</label><button className="text-action" onClick={() => void assist('style')} disabled={!!busy}><Sparkles size={13}/>스타일 다듬기</button></div><Textarea id="style" className="style-input" value={draft.style} onChange={event => update({ style: event.target.value })} placeholder={'장르, 분위기, 악기, 목소리…\n예: 따뜻한 어쿠스틱 팝, 잔잔한 기타, 부드러운 보컬'} maxLength={4000}/><div className="style-tags">{['어쿠스틱', '시티 팝', '발라드', '로파이', '재즈'].map(tag => <button key={tag} onClick={() => update({ style: draft.style ? `${draft.style}, ${tag}` : tag })}><Plus size={11}/>{tag}</button>)}</div></div>
    <div className="form-section title-section"><div className="field-heading"><label htmlFor="song-title">곡 제목<span className="optional">선택</span></label></div><Input id="song-title" value={draft.title} onChange={event => update({ title: event.target.value })} placeholder="이 노래의 이름을 지어 주세요" maxLength={120}/></div><div className="advanced-section"><button className="advanced-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}><span><SlidersHorizontal size={16}/>고급 설정</span><ChevronDown size={15} className={advanced ? 'rotated' : ''}/></button>{advanced && <div className="advanced-fields"><label>시드<Input type="number" min="0" max="2147483647" value={draft.seed} onChange={event => update({ seed: Number(event.target.value) })}/></label><label>추론 단계<Input type="number" min="1" max="100" value={draft.steps} onChange={event => update({ steps: Number(event.target.value) })}/></label><label className="wide-field">작곡 계획<select value={draft.cot} onChange={event => update({ cot: event.target.value })}><option value="full">멜로디와 코드 계획 (기본)</option><option value="melody">멜로디 계획</option><option value="off">계획 없이 생성</option></select></label><div className="wide-field vocal-gender-field"><span className="field-label">보컬</span><div className="vocal-gender-toggle"><button type="button" className={`vocal-gender-btn${draft.vocalGender === 'male' || draft.vocalGender === 'duet' ? ' active' : ''}`} onClick={() => toggleVocal('male')}>남성</button><button type="button" className={`vocal-gender-btn${draft.vocalGender === 'female' || draft.vocalGender === 'duet' ? ' active' : ''}`} onClick={() => toggleVocal('female')}>여성</button></div>{draft.vocalGender === 'duet' && <span className="vocal-gender-hint">둘 다 선택하면 듀엣으로 만들어져요</span>}</div><p className="field-hint wide-field">{['yue2-q4', 'yue2-q8'].includes(model.id) ? 'VAE: F16 · 메모리를 절약하는 조합' : 'VAE: F32 · 고용량 GPU 환경용'}<br/>설정과 모델 정보는 초안에 함께 저장됩니다.</p></div>}</div></div><div className="composer-footer"><div className="compose-actions"><Button variant="outline" onClick={() => void saveDraft()} disabled={!!busy || !online}>{busy === 'save' ? <LoaderCircle className="spin"/> : <Save/>}초안 저장</Button><Button className="generate-button" onClick={requestGenerate} disabled={!!busy || !online}>{busy === 'generate' ? <LoaderCircle className="spin"/> : <Sparkles/>}노래 만들기</Button></div><p><span className="status-dot amber"/>노래 만들기를 누르면 실제 음악이 생성됩니다</p></div></section>
    <section className="workspace" aria-label="내 작업"><div className="workspace-heading"><div><h2>내 작업<span className="count-label">{projects.length}</span></h2><p>오늘의 아이디어가 다음 노래가 되는 곳</p></div></div>{projectList()}<div className="inspiration-section"><div className="section-caption"><span><Sparkles size={15}/>어디서 시작할지 고민된다면</span><button onClick={() => setPresetOpen(true)}>예시 둘러보기<ChevronRight size={14}/></button></div><div className="inspiration-carousel">{examples.length > 3 && <Button variant="ghost" size="icon" aria-label="이전 예시" onClick={() => setExampleIndex(previous => (previous - 1 + examples.length) % examples.length)}><ChevronLeft/></Button>}<div className="inspiration-grid">{exampleWindow.map(example => <button key={example.id} className={`inspiration-card ${example.color || ''}`} onClick={() => useExample(example)}><div className="preset-top"><Music2 size={21}/><ArrowRight size={15}/></div><span className="genre-label">{example.genre || '예시'}</span><strong>{example.title}</strong><small>{example.caption}</small></button>)}</div>{examples.length > 3 && <Button variant="ghost" size="icon" aria-label="다음 예시" onClick={() => setExampleIndex(previous => (previous + 1) % examples.length)}><ChevronRight/></Button>}</div></div><div className="workspace-note"><ShieldCheck size={15}/><span>가사와 초안은 내 PC에 저장됩니다. 클라우드 LLM은 요청할 때만 연결됩니다.</span></div></section></div>
    : page === 'settings' ? <section className="settings-page page-scroll"><div className="page-heading"><span className="eyebrow">내 작업 방식에 맞게</span><h1>스튜디오 설정</h1><p>작사 도우미와 로컬 작업 환경을 설정하세요.</p></div><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><WandSparkles size={21}/></div><div><h2>작사 도우미</h2><p>가사와 스타일을 함께 다듬을 LLM을 선택하세요.</p></div><span className="small-badge">선택 기능</span></div><div className="provider-grid">{providers.map(provider => <button key={provider.id} className={`provider-card ${settings.provider === provider.id ? 'selected' : ''}`} aria-pressed={settings.provider === provider.id} onClick={() => void selectProvider(provider.id)}><span className="provider-mark">{provider.mark}</span><strong>{provider.label}</strong><small>{provider.description}</small>{settings.provider === provider.id && <Check className="provider-check" size={15}/>}</button>)}</div>
    {settings.provider !== 'none' ? <div className="settings-form"><label className="wide-field">연결 주소<Input value={settings.endpoint || '.env 파일에 값이 없습니다'} readOnly/></label><label>LLM 모델 이름<Input value={settings.llmModel || '.env 파일에 값이 없습니다'} readOnly/></label>{settings.provider !== 'ollama' && <label>API 키<Input value={settings.apiKey || '.env 파일에 값이 없습니다'} readOnly/></label>}<p className="field-hint wide-field">연결 주소, 모델 이름, API 키는 프로젝트 폴더의 .env 파일에서 읽어옵니다. .env.sample을 복사해 .env로 저장한 뒤 값을 입력하고 앱을 다시 실행해 주세요.<br/>연결 확인은 실제 짧은 요청을 전송합니다.</p></div> : <div className="inline-note"><Check size={17}/><span>LLM 없이도 직접 쓴 가사와 스타일로 작업할 수 있어요.</span></div>}
    <div className="settings-actions"><Button variant="outline" onClick={() => { setSettings(savedSettings); notify('저장된 설정으로 되돌렸습니다.'); }}>변경 취소</Button>{settings.provider !== 'none' && <Button variant="outline" disabled={!!busy} onClick={() => void storeSettings(true)}>{busy === 'test' ? <LoaderCircle className="spin"/> : <RefreshCw/>}저장 후 연결 확인</Button>}<Button disabled={!!busy} onClick={() => void storeSettings()}><Save/>설정 저장</Button></div></section><section className="settings-section"><div className="settings-section-heading"><div className="setting-icon"><Cpu size={21}/></div><div><h2>로컬 실행 환경</h2><p>음악 생성 엔진과 라이브러리 폴더 위치입니다.</p></div></div><div className="settings-form"><label className="wide-field">audio.cpp 실행 파일 (GGUF 모델용)<Input value={settings.enginePath} onChange={event => setSettings({ ...settings, enginePath: event.target.value })} placeholder={DEFAULT_ENGINE_PATH}/></label><label className="wide-field">Python 실행 파일 (원본 모델용)<Input value={settings.pythonEnginePath} onChange={event => setSettings({ ...settings, pythonEnginePath: event.target.value })} placeholder="예: test\YuE2-source\.venv\Scripts\python.exe (24GB급 VRAM 권장)"/></label><label className="wide-field">Python 스크립트 (generate.py)<Input value={settings.pythonScriptPath} onChange={event => setSettings({ ...settings, pythonScriptPath: event.target.value })} placeholder="예: test\YuE2-source\examples\generate.py"/></label><label className="wide-field">Setting 폴더<Input value={settings.settingPath} onChange={event => setSettings({ ...settings, settingPath: event.target.value })} placeholder={DEFAULT_SETTING_PATH}/></label><label className="wide-field">Music 폴더<Input value={settings.musicPath} onChange={event => setSettings({ ...settings, musicPath: event.target.value })} placeholder={DEFAULT_MUSIC_PATH}/></label><label className="wide-field">예시 폴더<Input value={settings.examplesPath} onChange={event => setSettings({ ...settings, examplesPath: event.target.value })} placeholder={DEFAULT_EXAMPLES_PATH}/></label><label>저장 파일 형식<select value={settings.saveFormat} onChange={event => setSettings({ ...settings, saveFormat: event.target.value as Settings['saveFormat'] })}>{saveFormats.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label><label>보기 방식<select value={settings.viewMode} onChange={event => void setViewMode(event.target.value as Settings['viewMode'])}>{viewModes.map(mode => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label><label className="wide-field">로그 폴더(읽기 전용)<Input value={settings.outputDirectory} readOnly/></label></div><p className="field-hint wide-field">실행 파일/스크립트/Setting/Music/예시 폴더는 모두 SongYUE2 폴더 기준 상대 경로입니다(절대 경로도 입력 가능). 비워두면 위 placeholder 경로가 사용되며, 폴더가 없으면 자동으로 만들어집니다.</p><div className="settings-actions"><Button onClick={() => void storeSettings()} disabled={!!busy}><Save/>설정 저장</Button></div></section></section>
    : page === 'models' ? <section className="models-page page-scroll"><div className="page-heading"><span className="eyebrow">내 스튜디오의 사운드 엔진</span><h1>모델 관리</h1><p>원본과 GGUF 모델을 보관하고, 상단에서 사용할 모델을 고르세요.</p></div><div className="download-overview"><div className="setting-icon"><ArrowDownToLine size={23}/></div><div className="download-copy"><h2>{inventory?.state === 'complete' ? '모델 다운로드 완료' : '모델 파일 준비 중'}</h2><p>{inventory ? `${gb(inventory.completedBytes)} / ${gb(inventory.totalBytes)}` : '로컬 다운로드 상태를 확인하고 있습니다.'}</p><Progress aria-label="전체 모델 다운로드" value={inventory?.totalBytes ? Math.min(100, inventory.completedBytes / inventory.totalBytes * 100) : 0}/></div><span className="small-badge">Hugging Face</span></div><div className="model-card-grid">{models.map(item => <article className={`model-detail-card ${draft.modelId === item.id ? 'selected' : ''}`} key={item.id}><div className="model-card-top"><Cpu size={23}/><span className="small-badge">{item.badge}</span></div><h2>{item.name}</h2><p>{item.detail}</p><div className="model-meta"><span>실행 방식<strong>{item.engine}</strong></span><span>본체 크기<strong>{item.size}</strong></span></div><div className="model-file-state"><span className={`status-dot ${installed(item) ? '' : 'amber'}`}/>{installed(item) ? '본체 다운로드됨' : '파일 준비 중'}<span>{item.engine === 'audio.cpp' ? '생성 지원' : '엔진 미지원'}</span></div><Button variant={draft.modelId === item.id ? 'default' : 'outline'} onClick={() => { update({ modelId: item.id }); notify(`${item.name} 모델을 선택했습니다.`); }}>{draft.modelId === item.id ? <><Check/>현재 선택한 모델</> : '이 모델 선택'}</Button></article>)}</div><section className="repository-section"><h2>다운로드 보관함</h2>{inventory?.repositories?.map(repo => <div className="repository-row" key={repo.id}><Folder size={19}/><div><strong>{repo.id}</strong><small>{repo.files?.filter(file => file.state === 'complete').length || 0} / {repo.files?.length || 0}개 파일 · {gb(repo.completedBytes)} / {gb(repo.totalBytes)}</small></div><span className="small-badge">{repo.state === 'complete' ? '완료' : '다운로드 중'}</span></div>)}</section><div className="inline-note"><ShieldCheck size={18}/><span>모델 가중치 라이선스: CC BY-NC 4.0. 앱 배포 파일과 모델은 분리해 관리합니다. 다운로드와 실제 실행 가능 여부는 다릅니다.</span></div></section>
    : page === 'playlists' ? playlistPage()
    : <section className="library-page page-scroll"><div className="page-heading library-heading"><div><span className="eyebrow">나의 음악을 한곳에</span><h1>{titles[page]}</h1><p>{page === 'projects' ? '저장할 때마다 새 버전으로 남아, 이전 아이디어를 다시 꺼낼 수 있어요.' : '가사, 스타일, 설정까지 함께 보관하는 나만의 컬렉션.'}</p></div><Button onClick={() => navigate('create')}><Plus/>노래 만들기</Button></div>{projectList()}</section>}
    <audio ref={audioRef} onEnded={playNext} onTimeUpdate={event => setPlaybackTime(event.currentTarget.currentTime)} onLoadedMetadata={event => setPlaybackDuration(event.currentTarget.duration)} hidden/>
    <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void handleCoverFile(event)}/>
    {nowPlaying ? <footer className="player-bar expanded"><div className="player-seek-row"><span className="player-time">{formatTime(playbackTime)}</span><input className="player-seek" type="range" aria-label="재생 위치" min={0} max={playbackDuration || 0} step={0.1} value={Math.min(playbackTime, playbackDuration || playbackTime)} onChange={event => seekTo(Number(event.target.value))}/><span className="player-time">{formatTime(playbackDuration)}</span></div><div className="player-main-row"><div className="player-art">{nowPlaying.coverPath ? <img className="song-cover" src={`/api/projects/${nowPlaying.id}/cover`} alt=""/> : <Music2 size={20}/>}</div><div className="player-copy"><strong>{nowPlaying.title}</strong><span>{nowPlaying.style}</span></div><div className="player-controls"><Button variant="ghost" size="icon" aria-label="이전 곡" onClick={playPrev} disabled={queueIndex === 0}><SkipBack/></Button><Button variant="ghost" size="icon" aria-label="10초 뒤로" onClick={() => seekBy(-10)}><Rewind/></Button><Button variant="ghost" size="icon" aria-label={isPlaying ? '일시정지' : '재생'} onClick={togglePlay}>{isPlaying ? <Pause/> : <Play/>}</Button><Button variant="ghost" size="icon" aria-label="눌러서 앞으로 이동, 꾹 누르면 계속 이동" onMouseDown={startHoldForward} onMouseUp={stopHoldForward} onMouseLeave={stopHoldForward} onTouchStart={startHoldForward} onTouchEnd={stopHoldForward}><FastForward/></Button><Button variant="ghost" size="icon" aria-label="다음 곡" onClick={playNext} disabled={queueIndex + 1 >= queue.length}><SkipForward/></Button><Button variant="ghost" size="icon" aria-label="역재생" aria-pressed={reversePlaying} className={reversePlaying ? 'active' : ''} onClick={toggleReverse}><RotateCcw/></Button></div><div className="player-extra"><button className="speed-btn" aria-label="재생 속도" onClick={cycleSpeed}>{playbackRate}x</button><Volume2 size={15}/><input className="player-volume" type="range" aria-label="볼륨" min={0} max={1} step={0.01} value={volume} onChange={event => changeVolume(Number(event.target.value))}/></div></div></footer>
    : <footer className="player-bar"><div className="player-art"><Music2 size={20}/></div><div className="player-copy"><strong>아직 재생할 노래가 없어요</strong><span>완성된 노래를 선택하면 이곳에서 재생됩니다.</span></div><div className="player-empty"><Headphones size={17}/><span>당신의 다음 곡을 기다리는 중</span></div><span className="player-time">— : —</span></footer>}</main>
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={19}/> : <Check size={19}/>}<span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="알림 닫기"><X size={16}/></button></div>}
    <Dialog open={presetOpen} onOpenChange={setPresetOpen}><DialogContent className="studio-dialog example-browser"><DialogTitle>어떤 분위기로 시작할까요?</DialogTitle><DialogDescription>직접 작성한 예시입니다. 카드를 선택하면 바로 편집기의 가사와 스타일이 바뀝니다.</DialogDescription><div className="dialog-scroll"><div className="example-card-grid">{examples.map(example => <button className={`inspiration-card ${example.color || ''}`} key={example.id} onClick={() => useExample(example)}><div className="preset-top"><Music2 size={21}/><ArrowRight size={15}/></div><span className="genre-label">{example.genre || '예시'}</span><strong>{example.title}</strong><small>{example.caption}</small></button>)}</div></div></DialogContent></Dialog>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="studio-dialog"><DialogTitle>나만의 음악 작업실 사용 안내</DialogTitle><DialogDescription>작은 아이디어를 노래로 만드는 과정</DialogDescription><div className="dialog-scroll help-content"><h3>01 · 상단에서 음악 모델 선택</h3><p>이 PC에서는 Q4와 F16 VAE 조합을 우선 검증할 예정입니다.</p><h3>02 · 가사와 분위기 작성</h3><p>직접 입력하거나 예시를 불러오세요. 작사 도우미는 설정에서 선택할 수 있습니다.</p><h3>03 · 초안 저장과 버전 비교</h3><p>라이브러리에서 설정을 다시 불러와 수정하세요. 저장할 때마다 새 버전이 남습니다.</p><div className="inline-note warning">설정에서 audio.cpp 실행 파일 경로를 지정하면 노래 만들기에서 실제 음악을 생성하고 바로 재생할 수 있습니다.</div></div></DialogContent></Dialog>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{selected?.title}</DialogTitle><DialogDescription>{selected?.status === 'completed' ? '완성된 곡 · 재생하고 메모를 남기세요.' : '저장된 초안 · 원본 가사와 설정은 그대로 보관됩니다.'}</DialogDescription>{selected?.status === 'completed' && <><audio controls className="detail-audio" src={`/api/projects/${selected.id}/audio`}/>{selected.saveError && <p className="detail-saved-path warning"><CircleHelp size={13}/>{selected.saveError}</p>}</>}<div className="dialog-scroll"><label>음악 스타일</label><p className="detail-style">{selected?.style}</p><label>가사</label><pre className="detail-lyrics">{selected?.lyrics}</pre><label htmlFor="project-notes">작업 메모</label><Textarea id="project-notes" value={notes} onChange={event => setNotes(event.target.value)} placeholder="다음 버전에서 바꾸고 싶은 점"/></div><div className="dialog-actions"><Button variant="outline" onClick={() => setSelected(null)}>취소</Button><Button variant="outline" onClick={() => { if (selected) window.location.assign(`/api/projects/${selected.id}/export`); }}><ArrowDownToLine/>내보내기</Button><Button variant="outline" onClick={() => { if (selected) loadProject(selected); }}>설정 불러오기</Button><Button disabled={!!busy} onClick={async () => { if (!selected) return; setBusy('notes'); try { const item = await api<Project>(`/projects/${selected.id}`, 'PATCH', { notes }); setProjects(previous => previous.map(project => project.id === item.id ? item : project)); setSelected(null); notify('메모를 저장했습니다.'); } catch (error) { notify((error as Error).message, true); } finally { setBusy(''); } }}><Save/>메모 저장</Button></div></DialogContent></Dialog>
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTarget?.title}을(를) 삭제할까요?</AlertDialogTitle><AlertDialogDescription>가사, 스타일, 생성된 음원이 모두 삭제되며 되돌릴 수 없습니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={!!busy}>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={!!busy} onClick={() => { if (deleteTarget) void deleteProject(deleteTarget); }}>{busy === 'delete' ? <LoaderCircle className="spin"/> : <Trash2/>}삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!downloadTarget} onOpenChange={open => { if (!open) setDownloadTarget(null); }}><DialogContent className="studio-dialog"><DialogTitle>{downloadTarget?.title} 다운로드</DialogTitle><DialogDescription>받을 파일 형식을 선택하세요. 여러 개를 함께 받을 수 있어요.</DialogDescription><div className="download-format-list">{saveFormats.map(format => <label key={format.id} className="download-format-item"><input type="checkbox" checked={downloadFormats.has(format.id)} onChange={() => toggleDownloadFormat(format.id)}/>{format.label}</label>)}</div><div className="dialog-actions"><Button variant="outline" onClick={() => setDownloadTarget(null)}>취소</Button><Button disabled={!downloadFormats.size} onClick={confirmDownload}><Download/>다운로드</Button></div></DialogContent></Dialog>
    <Dialog open={!!playlistPickerTarget} onOpenChange={open => { if (!open) setPlaylistPickerTarget(null); }}><DialogContent className="studio-dialog"><DialogTitle>재생목록에 추가</DialogTitle><DialogDescription>{playlistPickerTarget?.title}을(를) 추가할 재생목록을 고르세요.</DialogDescription><div className="dialog-scroll playlist-picker-list">{playlists.map(list => <button key={list.id} className="playlist-picker-item" onClick={() => { if (playlistPickerTarget) void addToPlaylist(playlistPickerTarget, list); setPlaylistPickerTarget(null); }}><ListPlus size={16}/><span>{list.name}</span><small>{list.songIds.length}곡</small></button>)}</div><div className="playlist-picker-new"><Input value={newPlaylistName} onChange={event => setNewPlaylistName(event.target.value)} placeholder="새 재생목록 이름"/><Button variant="outline" disabled={!newPlaylistName.trim()} onClick={() => { const target = playlistPickerTarget; if (target) void createPlaylistWith(newPlaylistName, target); setPlaylistPickerTarget(null); }}><Plus/>만들기</Button></div><div className="dialog-actions"><Button variant="outline" onClick={() => setPlaylistPickerTarget(null)}>닫기</Button></div></DialogContent></Dialog>
    <AlertDialog open={pythonWarningOpen} onOpenChange={setPythonWarningOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>원본(Python) 모델로 생성할까요?</AlertDialogTitle><AlertDialogDescription>이 모델은 24GB급 VRAM을 요구합니다. {gpuVramMb !== null ? `이 PC에서 감지된 GPU 메모리는 약 ${(gpuVramMb / 1024).toFixed(0)}GB로 부족할 수 있어요.` : 'GPU 사양을 확인하지 못했습니다.'} 생성이 실패하거나 매우 오래 걸릴 수 있어요. 그래도 진행하시겠어요?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction onClick={() => { setPythonWarningOpen(false); void saveDraft(true); }}>그래도 진행</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={!!suggestion} onOpenChange={open => { if (!open) setSuggestion(null); }}><DialogContent className="studio-dialog detail-dialog"><DialogTitle>{suggestion?.task === 'lyrics' ? '가사 제안' : '스타일 제안'}</DialogTitle><DialogDescription>내용을 확인한 뒤 적용하세요. 해당 입력을 바꿉니다.</DialogDescription><div className="dialog-scroll"><pre className="detail-lyrics">{suggestion?.text}</pre></div><div className="dialog-actions"><Button variant="outline" onClick={() => setSuggestion(null)}>취소</Button><Button onClick={() => { if (suggestion) update({ [suggestion.task]: suggestion.text }); setSuggestion(null); }}>편집기에 적용</Button></div></DialogContent></Dialog>
  </div>;
}
