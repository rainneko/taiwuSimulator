import {
  ACESFilmicToneMapping, CanvasTexture, Color, DirectionalLight, HemisphereLight, LinearMipmapLinearFilter, Mesh,
  MeshLambertMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3,
  WebGLRenderer,
} from 'three';
import {
  BlobShadows, createPaperMaterial, fitPCSSLight, makeCardGeometry, PaperBatch, PaperCard, paperGlobals, patchPCSS,
  unpatchPCSS, type Atlas, type AtlasFrame, type PaperLocals,
} from '../render/paper';

type Quality = 'high' | 'medium' | 'low';
const params = new URLSearchParams(location.search);
let quality: Quality = (params.get('q') as Quality) || 'high';

// ── 程序画一张图集：几种剪影（山、树、人形、牌坊、圆牌），带 alpha 羽化 ──
function makeAtlas(): Atlas {
  const S = 512, cell = 128, pad = 6;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const frames: AtlasFrame[] = [];
  const palette = ['#7c8f6a', '#a35d3f', '#4f6378', '#c9a25b', '#6d5a7c', '#8a3b34', '#5f7a74', '#b08a5a'];
  const shapes: ((x: number, y: number, w: number, h: number) => void)[] = [
    (x, y, w, h) => { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w * 0.35, y + h * 0.15); g.lineTo(x + w * 0.55, y + h * 0.45); g.lineTo(x + w * 0.75, y + h * 0.05); g.lineTo(x + w, y + h); g.fill(); },
    (x, y, w, h) => { g.beginPath(); g.ellipse(x + w / 2, y + h * 0.38, w * 0.42, h * 0.36, 0, 0, 7); g.fill(); g.fillRect(x + w * 0.44, y + h * 0.6, w * 0.12, h * 0.4); },
    (x, y, w, h) => { g.beginPath(); g.arc(x + w / 2, y + h * 0.16, w * 0.15, 0, 7); g.fill(); g.beginPath(); g.moveTo(x + w * 0.2, y + h); g.lineTo(x + w * 0.3, y + h * 0.34); g.lineTo(x + w * 0.7, y + h * 0.34); g.lineTo(x + w * 0.8, y + h); g.fill(); },
    (x, y, w, h) => { g.fillRect(x + w * 0.12, y + h * 0.2, w * 0.12, h * 0.8); g.fillRect(x + w * 0.76, y + h * 0.2, w * 0.12, h * 0.8); g.fillRect(x, y + h * 0.1, w, h * 0.12); g.fillRect(x + w * 0.08, y + h * 0.34, w * 0.84, h * 0.08); },
    (x, y, w, h) => { g.beginPath(); g.roundRect(x + w * 0.05, y + h * 0.05, w * 0.9, h * 0.9, w * 0.2); g.fill(); },
  ];
  let i = 0;
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++, i++) {
    const x = col * cell + pad, y = row * cell + pad, w = cell - pad * 2, h = cell - pad * 2;
    const shape = i % shapes.length;
    g.fillStyle = palette[i % palette.length];
    g.filter = 'blur(1.2px)';                 // alpha 羽化 ≈ 2px，白边靠它
    shapes[shape](x + 3, y + 3, w - 6, h - 6);
    g.filter = 'none';
    // 一点水墨：深色笔触
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(30,24,20,0.35)';
    g.fillRect(x, y + h * 0.82, w, h * 0.18);
    g.globalCompositeOperation = 'source-over';
    const aspect = shape === 2 ? 1.6 : shape === 0 ? 0.8 : 1.2;
    frames.push({ name: `f${i}`, rect: [col * cell + pad, row * cell + pad, w, h], size: [0.6, 0.6 * aspect] });
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return { texture: tex, json: { image: 'procedural', size: [S, S], feather: 2, padding: pad * 2, frames } };
}

// ── 渲染器 ──
const canvas = document.getElementById('scene') as HTMLCanvasElement;
if (quality === 'high') patchPCSS(null);    // 必须在任何材质编译之前
const renderer = new WebGLRenderer({ canvas, antialias: quality !== 'low' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;

const scene = new Scene();
scene.background = new Color('#e9dfcb');
const camera = new PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 3.2, 7.5);
camera.lookAt(0, 0.6, 0);

const hemi = new HemisphereLight('#fff6e6', '#9b8a6e', 0.9);
const key = new DirectionalLight('#fff1d6', 2.4);
scene.add(hemi, key, key.target);

// 地面纸（世界空间纤维）
const ground = new Mesh(new PlaneGeometry(30, 30).rotateX(-Math.PI / 2), createPaperMaterial({ color: '#efe4cc', doubleSided: false, fibre: 0.3 }));
ground.receiveShadow = true;
scene.add(ground);

const atlas = makeAtlas();

// 单张立牌一排（前景，演示铰链 + 四种效果）
const cards: PaperCard[] = [];
const cardMats: MeshLambertMaterial[] = [];
for (let i = 0; i < 5; i++) {
  const f = atlas.json.frames[i];
  const [W, H] = atlas.json.size;
  const [x, y, w, h] = f.rect;
  const geo = makeCardGeometry({ width: 1.0, height: 1.0 * (h / w) * (i === 2 ? 1.4 : 1), uv: [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H] });
  const mat = i === 4 ? createPaperMaterial({ color: '#c94f3d' }) : createPaperMaterial({ map: atlas.texture });
  const c = new PaperCard(geo, mat);
  c.position.set((i - 2) * 1.35, 0, 1.4);
  c.yaw = (i - 2) * -0.08;
  c.receiveShadow = true;
  scene.add(c);
  cards.push(c); cardMats.push(mat);
}

// 合批：后场 600 张
const COLS = 40, ROWS = 15;
const batch = new PaperBatch(atlas, { cards: COLS * ROWS, frames: atlas.json.frames.length });
const handles: { h: number; d: number }[] = [];
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const p = new Vector3((c - COLS / 2) * 0.42 + (r % 2) * 0.21, 0, -1.2 - r * 0.42);
  const tint = new Color().setHSL(0.08 + Math.random() * 0.05, 0.25, 0.8 + Math.random() * 0.2);
  const h = batch.add({ frame: `f${(r * COLS + c) % 16}`, position: p, scale: 0.55, yaw: (Math.random() - 0.5) * 0.3, tint });
  handles.push({ h, d: p.distanceTo(new Vector3(0, 0, -1.2)) });
}
scene.add(batch.mesh);
const allMats = [...cardMats, batch.material, ground.material];

// low 档 blob
const blobs = new BlobShadows(cards.length);
scene.add(blobs.mesh);

function applyQuality(q: Quality): void {
  const wasHigh = quality === 'high';
  quality = q;
  if (q === 'high') patchPCSS(renderer); else if (wasHigh) unpatchPCSS(scene);
  renderer.shadowMap.enabled = q !== 'low';
  if (q === 'medium') renderer.shadowMap.type = PCFSoftShadowMap;
  key.castShadow = q !== 'low';
  blobs.mesh.visible = q === 'low';
  key.shadow.map?.dispose(); key.shadow.map = null;
  if (q === 'high') fitPCSSLight(key, 9, { mapSize: 2048, lightSize: 0.3 });
  else {
    fitPCSSLight(key, 9, { mapSize: 1024 });
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  }
  allMats.forEach((m) => (m.needsUpdate = true));
  renderer.shadowMap.needsUpdate = true;
}

// ── 控件 ──
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => parseFloat($<HTMLInputElement>(id).value);
$('rise').onclick = () => cards.forEach((c, i) => c.rise(i * 0.08));
$('fall').onclick = () => cards.forEach((c, i) => c.fall(i * 0.05));
$('half').onclick = () => cards.forEach((c) => c.setHalf());
$('nudge').onclick = () => cards.forEach((c) => c.nudge(-3));
$('ripple').onclick = () => handles.forEach(({ h, d }) => batch.rise(h, d * 0.035));
$('rippleFall').onclick = () => handles.forEach(({ h, d }) => batch.fall(h, d * 0.02));
$<HTMLSelectElement>('q').value = quality;
$<HTMLSelectElement>('q').onchange = (e) => applyQuality((e.target as HTMLSelectElement).value as Quality);

function syncUniforms(): void {
  for (const m of allMats) {
    const u = m.userData.paper as PaperLocals;
    u.uPaperFibre.value = num('fibre');
    if (m !== ground.material) { u.uPaperFlash.value = num('flash'); u.uPaperFade.value = num('fade'); }
  }
  paperGlobals.uPaperLight.value.set(num('wrap'), num('trans'));
  const az = num('az') * Math.PI / 180, el = num('el') * Math.PI / 180;
  key.position.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(30);
}

function resize(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
applyQuality(quality);

// ── 主循环 ──
let last = performance.now(), t = 0, frames = 0, acc = 0;
const stats = $('stats');
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now; t += dt;
  syncUniforms();
  if ($<HTMLInputElement>('slide').checked) cards[4].position.x = 2.7 + Math.sin(t) * 0.5;
  for (const c of cards) c.update(dt);
  batch.update(dt);
  if (quality === 'low') cards.forEach((c, i) => {
    const k = Math.sin(c.hinge.theta);
    blobs.set(i, c.position.x, c.position.z - 0.05, 0.55, 0.12 + 0.18 * k, k);
  });
  renderer.render(scene, camera);
  frames++; acc += dt;
  if (acc > 0.5) {
    stats.textContent = `${Math.round(frames / acc)} fps · draw ${renderer.info.render.calls} · batch active ${batch.active.size}`;
    frames = 0; acc = 0;
  }
});

// 进场：前景依次起立，后场波纹
setTimeout(() => { $('rise').click(); $('ripple').click(); }, 300);
(window as unknown as Record<string, unknown>).__paper = { renderer, scene, cards, batch, applyQuality };
