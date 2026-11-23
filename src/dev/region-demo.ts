import { ACESFilmicToneMapping, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { AssetCache } from '../app/AssetCache';
import { InputRouter } from '../app/InputRouter';
import { SceneManager } from '../app/SceneManager';
import { makeSampleRegion, RegionScene, type CellInfo } from '../scenes/region';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;

const assets = new AssetCache();
const scenes = new SceneManager(renderer, assets);
const region = new RegionScene();
scenes.register('region', () => region);
new InputRouter(canvas, scenes);
addEventListener('keydown', (e) => { region.onKey(e); });

const infoEl = document.getElementById('info')!;
const show = (i: CellInfo | null) => {
  if (!i) { infoEl.textContent = '未选中'; return; }
  const lines = [`(${i.x}, ${i.y}) ${i.terrain}`, `通行耗费 ${isFinite(i.cost) ? i.cost : '不可通行'}`];
  if (i.location) lines.unshift(`【${i.location.name}】`);
  if (i.path) lines.push(`路径 ${i.path.length - 1} 格，耗费 ${i.pathCost}（再点一次前往）`);
  else if (i.cell === region.player) lines.push('你在这里');
  else lines.push('无法到达');
  infoEl.textContent = lines.join('\n');
};
region.onSelect = show;

const size = document.getElementById('size') as HTMLSelectElement;
let seed = 7;
const regen = () => scenes.goto('region', { region: makeSampleRegion(Number(size.value), seed++) }, { style: 'fold' });
document.getElementById('regen')!.onclick = regen;
size.onchange = regen;
for (const z of [0, 1, 2]) document.getElementById(`z${z}`)!.onclick = () => region.rig.setZoom(z);
document.getElementById('follow')!.onclick = () => { region.onKey(new KeyboardEvent('keydown', { key: 'f' })); };

// 地名标注
const labels = document.getElementById('labels')!;
const v = new Vector3();
function drawLabels(): void {
  const r = region.region;
  if (!r) return;
  if (labels.childElementCount !== r.locations.length) {
    labels.replaceChildren(...r.locations.map((l) => Object.assign(document.createElement('span'), { textContent: l.name })));
  }
  r.locations.forEach((l, i) => {
    region.cellCenter(l.cell, v); v.y = 1.6; v.z -= 0.2;
    v.project(region.rig.camera);
    const el = labels.children[i] as HTMLElement;
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    el.style.display = v.z < 1 ? '' : 'none';
  });
}

const resize = () => { renderer.setSize(innerWidth, innerHeight, false); scenes.resize(innerWidth, innerHeight); };
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000; last = now;
  scenes.update(dt);
  scenes.render(renderer);
  drawLabels();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void scenes.goto('region', { region: makeSampleRegion(24, seed++) });
Object.assign(window as object, { __region: region });
