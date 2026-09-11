import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const processes = [];
const stop = () => { for (const child of processes) if (child.exitCode === null) child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
process.on('exit', stop);
async function alive(url) { try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); return response.ok; } catch { return false; } }
function run(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  processes.push(child);
  child.on('error', () => { console.error('앱 실행에 실패했습니다. Node.js와 설치 상태를 확인해 주세요.'); stop(); process.exitCode = 1; });
  child.on('exit', code => { if (code) { stop(); process.exitCode = code; } });
}
if (!await alive('http://127.0.0.1:4311/api/health')) run(['backend/server.mjs'], root);
if (!await alive('http://127.0.0.1:5173/')) run(['node_modules/vinext/dist/cli.js', 'dev'], path.join(root, 'app'));
console.log('음악 작업실: http://127.0.0.1:5173/');
