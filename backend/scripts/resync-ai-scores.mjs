// One-off maintenance script: after recomputing library/AI-MusicProbe/*.json's totalScore/scoreInfo
// (e.g. with ai-music-probe's scripts/recompute_totals.py, following a Total combination method
// change), each song's own compact `aiScore` field - the one the UI actually reads - is still frozen
// with the old numbers. This re-derives it from the already-updated report, exactly the way
// scoreProjectAudio() in server.mjs builds it fresh, but reading from disk instead of calling the
// AI Music Probe API again. `scoredAt` is left untouched: the acoustic measurement itself didn't
// change, only how its detector scores were combined.
//
//   node backend/scripts/resync-ai-scores.mjs
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const AI_MUSIC_PROBE_DETECTOR_LABELS = { sonics: 'SONICS (SpecTTTra)', lofcz: 'lofcz vocoder fakeprint', artifactnet: 'ArtifactNet v9.4' };
const AI_MUSIC_PROBE_METHOD_LABELS = {
  'detector-geometric-mean-v1': '기하평균',
  'detector-arithmetic-mean-v1': '산술평균',
  'detector-median-v1': '중앙값',
  'detector-weighted-geometric-mean-v1': '가중 기하평균',
  'detector-robust-mean-v1': '이상치 제외 평균',
};

async function readJson(file) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function buildAiScore(result, previous) {
  const outliersExcluded = result.scoreInfo?.components?.outliersExcluded || [];
  return {
    status: 'completed',
    total: Number.isFinite(result.totalScore) ? Math.round(result.totalScore * 10) / 10 : null,
    confidence: Number.isFinite(result.confidence) ? Math.round(result.confidence * 10) / 10 : null,
    conclusion: result.conclusion || null,
    method: AI_MUSIC_PROBE_METHOD_LABELS[result.scoreInfo?.components?.method] || result.scoreInfo?.components?.method || null,
    outliersExcluded: outliersExcluded.map((name) => AI_MUSIC_PROBE_DETECTOR_LABELS[name] || name),
    detectors: (result.detectors || []).map((detector) => ({ name: detector.name, label: AI_MUSIC_PROBE_DETECTOR_LABELS[detector.name] || detector.name, score: Number.isFinite(detector.score) ? Math.round(detector.score * 1000) / 10 : null })),
    reportFile: previous.reportFile,
    scoredAt: previous.scoredAt,
    error: null,
  };
}

async function main() {
  const dirs = [path.join(root, 'library', 'music'), path.join(root, 'library', 'setting')];
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  for (const dir of dirs) {
    const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json'));
    for (const name of names) {
      const file = path.join(dir, name);
      const project = await readJson(file);
      if (!project?.aiScore?.reportFile) continue;
      scanned += 1;
      const reportFile = path.join(root, ...project.aiScore.reportFile.split('/'));
      const result = await readJson(reportFile);
      if (!result) { console.warn(`건너뜀 (리포트 없음): ${project.aiScore.reportFile}`); skipped += 1; continue; }
      const nextAiScore = buildAiScore(result, project.aiScore);
      const before = JSON.stringify(project.aiScore);
      const after = JSON.stringify(nextAiScore);
      if (before === after) continue;
      const updatedProject = { ...project, aiScore: nextAiScore };
      await writeFile(file, `${JSON.stringify(updatedProject, null, 2)}\n`, 'utf8');
      updated += 1;
      console.log(`${project.title}: ${project.aiScore.total}% -> ${nextAiScore.total}%`);
    }
  }
  console.log(`확인 ${scanned}곡 · 갱신 ${updated}곡 · 리포트 없어 건너뜀 ${skipped}곡`);
}

await main();
