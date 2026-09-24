// Builds backend/adapter-catalog.json: the curated list of YuE2 LoRAs shown in the "카탈로그" tab of the LoRA page.
// The entries (what each one is, in plain Korean, the strength its author recommends and how to trigger it) are written
// here by hand from the public model cards; the file sizes and the commit each download is pinned to are read from
// Hugging Face so a catalog entry always names bytes that exist. Run: node scripts/build-adapter-catalog.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'adapter-catalog.json');

// stage: which half of the model the file changes (ar = composition, nar = sound), checked by loading each file in yue-server.
// kind: style | artist | composition | sound | slider.  scales: the author's recommended strength of the composition (ar) and sound (nar) halves.
const ENTRIES = [
  { id: 'industrial-rock', stage: 'both', kind: 'style', repo: 'monsterovich/yue2-industrial-rock-lora', scales: { ar: 1, nar: 0.5 },
    name: '인더스트리얼 록', description: '묵직한 기계 리듬과 왜곡된 기타. 곡의 구성과 소리를 모두 바꿉니다.',
    files: ['adapter-ar-179/lora.safetensors', 'adapter-nar-179-v2/lora.safetensors'] },
  { id: 'epic-trailer', stage: 'both', kind: 'style', repo: 'monsterovich/yue2-steps-from-hell', scales: { ar: 0.5, nar: 0.375 },
    name: '에픽 트레일러', description: '영화 예고편 음악 같은 웅장한 오케스트라. 합창, 금관, 큰 북이 특징입니다.',
    files: ['adapter-ar-195/lora.safetensors', 'adapter-nar-194/lora.safetensors'] },
  { id: 'dream-pop', stage: 'both', kind: 'style', repo: 'atomtanstudio/lora-library', trigger: 'sv_dreampop', scales: { ar: 1, nar: 1 },
    name: '드림 팝', description: '몽환적인 리버브 기타와 떠다니는 보컬. 작곡 계획을 끄고 쓰는 것을 권장합니다.',
    tip: '스타일 앞에 sv_dreampop 을 붙이고, 작곡 계획은 "계획 없이 생성", 추론 단계는 32로 시작하세요.',
    files: ['yue2/dreampop/dreampop_sv_dreampop.safetensors'] },
  { id: 'old-school-hiphop', stage: 'both', kind: 'style', repo: 'atomtanstudio/lora-library', trigger: 'sv_oldschoolhiphop', scales: { ar: 1, nar: 1 },
    name: '올드스쿨 힙합', description: '붐뱁 드럼, 먼지 낀 샘플, 90년대 플로우. 작곡 계획을 끄고 쓰는 것을 권장합니다.',
    tip: '스타일 앞에 sv_oldschoolhiphop 을 붙이고, 작곡 계획은 "계획 없이 생성"으로 시작하세요.',
    files: ['yue2/oldschoolhiphop/sv_oldschoolhiphop.safetensors'] },
  { id: 'sv-billie', stage: 'both', kind: 'artist', repo: 'HaileyStorm/sv-billie-yue2-lora', trigger: 'sv_billie', scales: { ar: 1, nar: 1 },
    name: 'SV Billie', description: '아티스트 LoRA. 숨소리 섞인 낮고 친밀한 보컬, 묵직한 저음의 침실 팝.',
    tip: '스타일 앞에 "sv_billie, in the style of sv_billie." 를 붙이면 잘 반응합니다. 길이는 넉넉하게 잡으세요.',
    files: ['sv_billie.safetensors'] },
  { id: 'instrumental', stage: 'ar', kind: 'composition', repo: 'Mothersuperior/YuE2-instrumental-cot-full-loras', scales: { ar: 1, nar: 1 },
    name: '연주곡 (Instrumental)', description: '보컬 없는 연주곡을 구간 계획과 함께 만듭니다. 작곡 계획은 "멜로디와 코드 계획"으로 쓰세요.',
    tip: '가사에는 [instrumental] 또는 [intro] [verse] [chorus] 같은 구간 태그만 적으세요.',
    files: ['ar_lora_inst_v3abc.bf16.safetensors'] },
  { id: 'real-audio', stage: 'nar', kind: 'sound', repo: 'Mothersuperior/yue2-mothersuperior-realaudio-tokenizer-v4', scales: { ar: 1, nar: 1 },
    name: '리얼 오디오 (v9)', description: '실제 녹음으로 사운드 쪽을 다시 학습시킨 것. 더 꽉 찬 믹스와 자연스러운 음색, 작곡은 그대로입니다.',
    files: ['nar_lora_joint_v9.safetensors'] },
];

// ntc-ai particle sliders: tiny (12 MB) genre / voice nudges for the composition half, strength 0..1.
const SLIDERS = [
  ['acoustic-folk', '어쿠스틱 포크', '따뜻한 어쿠스틱 기타의 포크 색깔'], ['afrobeats', '아프로비트', '아프리카 리듬의 경쾌한 그루브'],
  ['country', '컨트리', '컨트리 특유의 기타와 보컬 표현'], ['disco-funk', '디스코 펑크', '리듬감 있는 디스코·펑크 그루브'],
  ['female', '여성 보컬', '성인 여성 리드 보컬, 곡의 프레이징은 유지'], ['male', '남성 보컬', '성인 남성 리드 보컬, 곡의 프레이징은 유지'],
  ['hiphop', '힙합', '힙합 비트와 랩 스타일'], ['house', '하우스', '4/4 킥의 하우스 댄스 리듬'], ['indie-rock', '인디 록', '인디 록의 기타와 질감'],
  ['kpop', '케이팝', '케이팝 스타일의 훅과 편곡'], ['lofi', '로파이', '차분하고 먼지 낀 로파이 분위기'], ['metal', '메탈', '강한 디스토션의 메탈'],
  ['pop-punk', '팝 펑크', '빠르고 신나는 팝 펑크'], ['pop', '팝', '분명한 훅, 또렷한 드럼, 다듬어진 후렴'], ['reggaeton', '레게톤', '레게톤 리듬'], ['rnb', 'R&B', '부드러운 R&B 그루브'],
].map(([key, name, description]) => ({
  id: `slider-${key}`, stage: 'ar', kind: 'slider', repo: 'ntc-ai/yue2-particle-sliders', scales: { ar: 0.5, nar: 0 }, name, description,
  tip: '슬라이더는 0~1 사이에서 살짝 섞어 쓰는 용도입니다. 다른 LoRA와 함께 써 보세요.',
  files: [`distilled-rank8-v1/native/${key}_distilled_refined_rank8.safetensors`],
}));

const repoCache = new Map();
async function repoInfo(repo) {
  if (!repoCache.has(repo)) {
    const response = await fetch(`https://huggingface.co/api/models/${repo}?blobs=true`);
    if (!response.ok) throw new Error(`${repo}: ${response.status}`);
    repoCache.set(repo, await response.json());
  }
  return repoCache.get(repo);
}

const catalog = [];
for (const entry of [...ENTRIES, ...SLIDERS]) {
  const info = await repoInfo(entry.repo);
  const files = entry.files.map((file) => {
    const sibling = info.siblings.find((item) => item.rfilename === file);
    if (!sibling) throw new Error(`${entry.repo} has no ${file}`);
    return { path: file, bytes: sibling.size };
  });
  catalog.push({ ...entry, author: entry.repo.split('/')[0], page: `https://huggingface.co/${entry.repo}`, license: String(info.cardData?.license || (info.tags || []).find((tag) => tag.startsWith('license:'))?.slice(8) || ''), revision: info.sha, files });
  console.log(entry.id, files.map((file) => `${(file.bytes / 1e6).toFixed(0)}MB`).join('+'), info.sha.slice(0, 8));
}
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), entries: catalog }, null, 1), 'utf8');
console.log('wrote', OUT, catalog.length, 'entries');
