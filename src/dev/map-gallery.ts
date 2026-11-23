import { effect } from '@preact/signals';
import { h, render } from 'preact';
import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';
import { AssetCache } from '../app/AssetCache';
import { InputRouter } from '../app/InputRouter';
import { LabelProjector } from '../app/LabelProjector';
import { SceneManager } from '../app/SceneManager';
import { services } from '../app/services';
import { ui } from '../app/store';
import { t } from '../app/strings';
import { LabelLayer } from '../app/ui/LabelLayer';
import { patchPCSS } from '../render/paper';
import { RegionScene } from '../scenes/region';
import { WORLD_HUD_CSS, WorldMapHud } from '../scenes/world/WorldMapHud';
import { WorldMapScene } from '../scenes/world/WorldMapScene';
import { worldUi } from '../scenes/world/worldData';

const params = new URLSearchParams(location.search);
const quality = (params.get('q') as 'high' | 'medium') || 'high';
ui.quality.value = quality;
(document.getElementById('q') as HTMLSelectElement).value = quality;
(document.getElementById('q') as HTMLSelectElement).onchange = (e) => {
  params.set('q', (e.target as HTMLSelectElement).value); location.search = params.toString();
};

const canvas = document.getElementById('scene') as HTMLCanvasElement;
if (quality === 'high') patchPCSS(null);   // 必须在任何材质编译之前
const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = ACESFilmicToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
if (quality === 'high') patchPCSS(renderer);

const style = document.createElement('style'); style.textContent = WORLD_HUD_CSS; document.head.appendChild(style);

const assets = new AssetCache();
const scenes = new SceneManager(renderer, assets);
const labels = new LabelProjector(document.getElementById('labels')!);
const input = new InputRouter(canvas, scenes);
Object.assign(services, { scenes, labels, input, assets });

const world = new WorldMapScene();
scenes.register('worldMap', () => world);
scenes.register('region', () => new RegionScene());

render(h(LabelLayer, null), document.getElementById('labels')!);
render(h(WorldMapHud, null), document.getElementById('hud')!);

const back = document.getElementById('back') as HTMLButtonElement;
back.textContent = t('map.back');
back.onclick = () => void scenes.goto('worldMap', { focus: worldUi.current.peek() }, { style: 'rise' });
effect(() => { back.style.display = ui.screen.value === 'region' && !ui.transition.value ? 'block' : 'none'; });

const pick = document.getElementById('pick') as HTMLInputElement;
pick.onchange = () => {
  void scenes.goto('worldMap', pick.checked
    ? { mode: 'pickOnly', allow: ['p0', 'p3', 'p4', 'p7', 'p12'], onPick: (id: string) => console.info('[pickOnly] onPick', id) }
    : { mode: 'normal' }, { style: 'fold' });
};

const resize = () => {
  const w = innerWidth, hh = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, hh, false);
  scenes.resize(w, hh);
};
addEventListener('resize', resize);
resize();

const stats = document.getElementById('stats')!;
let last = performance.now(), acc = 0, frames = 0;
function tick(now: number): void {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
  scenes.update(dt);
  scenes.render(renderer);
  labels.flush();
  acc += dt; frames++;
  if (acc > 0.5) {
    const i = renderer.info.render;
    stats.textContent = ` ${Math.round(frames / acc)} fps · ${i.calls} calls · ${(i.triangles / 1000).toFixed(1)}k tris`;
    acc = 0; frames = 0;
  }
}
requestAnimationFrame(tick);
if (import.meta.env.DEV) Object.assign(window as object, { __map: { scenes, world: () => world, ui, worldUi } });
void scenes.goto('worldMap');
