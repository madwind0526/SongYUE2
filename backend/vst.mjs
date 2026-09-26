// VST3 plugins for "AI 곡 다듬기": search (vst-host --scan), the plugin's own settings window (vst-host --gui, state saved to a file
// when the window is closed) and the state files. vst-host.exe (HOT-Step, MIT) lives in engine/vst-host/ and always runs as a separate process.
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const vstHostExe = (root) => path.join(root, 'engine', 'vst-host', 'vst-host.exe');
// Plugins that are put next to the host (the host itself only searches the standard VST3 folders)
export const vstLocalDir = (root) => path.join(root, 'engine', 'vst-host', 'plugins');
export const VST_SCAN_TIMEOUT_MS = 90 * 1000;
export const VST_EDITOR_MAX_MS = 60 * 60 * 1000;
const SCAN_CACHE_MS = 5 * 60 * 1000;

const exists = (file) => access(file).then(() => true, () => false);
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// One state file per plugin (by its path), kept in Setting/VST-states
export const stateFileFor = (statesDir, pluginPath) => path.join(statesDir, `${createHash('sha1').update(path.resolve(pluginPath).toLowerCase()).digest('hex').slice(0, 16)}.vststate`);

// The scan prints its log to stderr and a JSON array (name, vendor, version, path, uid, subcategories) to stdout
export function parseScanOutput(text) {
  // the JSON array starts at a line of its own ("[" then a newline or "{"); log lines such as "[vst-host] ..." are skipped
  const start = String(text).search(/^\[\s*[\]{]/m);
  const end = String(text).lastIndexOf(']');
  if (start < 0 || end < start) return [];
  let list;
  try { list = JSON.parse(String(text).slice(start, end + 1)); } catch { return []; }
  const seen = new Set();
  const plugins = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item.path !== 'string' || typeof item.name !== 'string') continue;
    const key = `${item.path.toLowerCase()}|${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plugins.push({ name: item.name, vendor: String(item.vendor || ''), version: String(item.version || ''), path: item.path, uid: String(item.uid || ''), category: String(item.subcategories || '') });
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

// .vst3 files or bundle folders inside `dir` (up to 3 levels down; a bundle is never searched inside). The name is the file name.
export async function findLocalPlugins(dir, depth = 3) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (/\.vst3$/i.test(entry.name)) found.push({ name: entry.name.replace(/\.vst3$/i, ''), vendor: '', version: '', path: full, uid: '', category: '폴더에 넣은 플러그인', local: true });
    else if (entry.isDirectory() && depth > 1) found.push(...await findLocalPlugins(full, depth - 1));
  }
  return found;
}

export function createVstManager({ root, statesDir, spawnImpl, host = null, localDir = vstLocalDir(root), now = () => Date.now() }) {
  const command = () => host || { exe: vstHostExe(root), args: [] };
  let scanned = null; // { at, plugins }
  let scanning = null;
  let editor = null; // { child, path, startedAt, timer }

  const hostReady = () => exists(command().exe);

  function runScan() {
    return new Promise((resolve, reject) => {
      const { exe, args } = command();
      const chunks = [];
      const child = spawnImpl(exe, [...args, '--scan'], { windowsHide: true });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } reject(new Error('플러그인 검색이 시간 안에 끝나지 않았습니다.')); }, VST_SCAN_TIMEOUT_MS);
      child.stdout?.on('data', (chunk) => chunks.push(chunk));
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', () => { clearTimeout(timer); resolve(parseScanOutput(Buffer.concat(chunks).toString('utf8'))); });
    });
  }

  // The installed VST3 plugins (cached for a few minutes; `refresh` searches again)
  async function scan({ refresh = false } = {}) {
    if (!(await hostReady())) return { hostReady: false, plugins: [] };
    if (!refresh && scanned && now() - scanned.at < SCAN_CACHE_MS) return { hostReady: true, plugins: scanned.plugins };
    scanning ||= runScan().finally(() => { scanning = null; });
    const installed = await scanning;
    // the plugins in the app's own folder come first-hand from the folder; a plugin that is in both lists is shown once
    const seen = new Set(installed.map((plugin) => path.resolve(plugin.path).toLowerCase()));
    const local = (await findLocalPlugins(localDir)).filter((plugin) => !seen.has(path.resolve(plugin.path).toLowerCase()));
    const plugins = [...installed, ...local].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    scanned = { at: now(), plugins };
    return { hostReady: true, plugins };
  }

  // Only plugins the scan found are ever loaded (a path from the browser is never handed to the host as it is)
  async function requireKnown(pluginPaths) {
    const { plugins } = await scan();
    const known = new Set(plugins.map((plugin) => plugin.path.toLowerCase()));
    for (const pluginPath of pluginPaths) if (!known.has(path.resolve(pluginPath).toLowerCase())) throw Object.assign(new Error('검색되지 않은 플러그인입니다. 플러그인을 다시 검색해 주세요.'), { status: 400 });
  }

  async function withStates(list) {
    return Promise.all(list.map(async (plugin) => ({ ...plugin, hasState: await exists(stateFileFor(statesDir, plugin.path)) })));
  }

  // path -> state file, for the plugins that have one (given to vst-host as the chain's "state")
  async function stateMap(pluginPaths) {
    const states = {};
    for (const pluginPath of pluginPaths) { const file = stateFileFor(statesDir, pluginPath); if (await exists(file)) states[pluginPath] = file; }
    return states;
  }

  const editorStatus = () => (editor ? { running: true, path: editor.path, startedAt: editor.startedAt } : { running: false });

  // Opens the plugin's own window; the state is written to its state file when the window is closed
  async function openEditor(pluginPath) {
    if (editor) throw Object.assign(new Error('다른 플러그인 설정 창이 이미 열려 있습니다. 먼저 닫아 주세요.'), { status: 409 });
    if (!(await hostReady())) throw Object.assign(new Error('VST3 호스트(engine/vst-host/vst-host.exe)를 찾을 수 없습니다.'), { status: 409 });
    await requireKnown([pluginPath]);
    await mkdir(statesDir, { recursive: true });
    const stateFile = stateFileFor(statesDir, pluginPath);
    const { exe, args } = command();
    const child = spawnImpl(exe, [...args, '--gui', '--plugin', pluginPath, '--state', stateFile], { stdio: 'ignore' });
    const entry = { child, path: pluginPath, startedAt: now(), timer: null };
    // a window nobody closes must not keep the process (and the plugin) alive forever
    entry.timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, VST_EDITOR_MAX_MS);
    const finish = () => { clearTimeout(entry.timer); if (editor === entry) editor = null; };
    child.once('error', finish);
    child.once('close', finish);
    editor = entry;
    return { stateFile };
  }

  function closeEditor() {
    if (!editor) return false;
    // A plain kill loses the state that is only written on a normal close, so the user is asked to close the window itself; this is the emergency exit
    try { editor.child.kill('SIGKILL'); } catch { /* already gone */ }
    clearTimeout(editor.timer);
    editor = null;
    return true;
  }

  async function stateInfo(pluginPath) {
    const info = await stat(stateFileFor(statesDir, pluginPath)).catch(() => null);
    return info ? { saved: true, savedAt: info.mtime.toISOString() } : { saved: false };
  }

  return { command, hostReady, scan, requireKnown, withStates, stateMap, editorStatus, openEditor, closeEditor, stateInfo };
}
