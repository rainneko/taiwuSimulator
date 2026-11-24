import { render, h } from 'preact';
import { WebGLRenderer, SRGBColorSpace } from 'three';
import { makeFibreData } from '../render/paper';
import { CombatScene } from '../scenes/CombatScene';
import { MenuScene } from '../scenes/MenuScene';
import { RegionScene } from '../scenes/region';
import { WorldMapScene } from '../scenes/world/WorldMapScene';
import { gameDB, STUB_BUNDLE } from '../data';
import { AssetCache } from './AssetCache';
import { InputRouter } from './InputRouter';
import { LabelProjector } from './LabelProjector';
import { PortraitStage } from './PortraitStage';
import { RenderLoop } from './RenderLoop';
import { SceneManager } from './SceneManager';
import { services } from './services';
import { ui } from './store';
import { Panels } from './ui/App';
import { LabelLayer } from './ui/LabelLayer';
import { LoadingCurtain } from './ui/LoadingCurtain';
import { Modals } from './ui/Modals';
import './tokens.css';
import './paper.css';

/** DOM 纸纹与场景同源：128px 纤维图 → blob URL。 */
async function installFibreCss(): Promise<void> {
  const size = 128, data = makeFibreData(size);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!, img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // 纸色上叠纤维：G 长纤维 + R 细颗粒，压到很低的对比度
    const v = (data[i * 4] - 128) * 0.08 + (data[i * 4 + 1] - 128) * 0.12;
    img.data[i * 4] = 251 + v; img.data[i * 4 + 1] = 247 + v; img.data[i * 4 + 2] = 238 + v * 1.1; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res));
  if (blob) document.documentElement.style.setProperty('--fibre', `url(${URL.createObjectURL(blob)})`);
}

function el(id: string): HTMLElement { return document.getElementById(id)!; }

async function boot(): Promise<void> {
  void installFibreCss();
  const root = el('root'), canvas = el('scene') as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;

  const assets = new AssetCache(() => null);   // 内容包解析器接入前：全部走占位
  const scenes = new SceneManager(renderer, assets);
  const portraits = new PortraitStage(assets);
  const labels = new LabelProjector(el('labels'));
  const input = new InputRouter(canvas, scenes);
  gameDB.loadFromBundle(STUB_BUNDLE);
  Object.assign(services, { scenes, portraits, labels, input, assets, manifest: { name: '占位内容包', version: '0.0.0' }, db: gameDB, player: null, world: null, clock: null, turns: null });
  void assets.loadJson<{ name: string; version: string }>(`${import.meta.env.BASE_URL}content/manifest.json`).then((m) => { if (m?.name) services.manifest = m; });

  const applySize = () => {
    const w = root.clientWidth, h = root.clientHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, ui.quality.peek() === 'low' ? 1 : 2));
    renderer.setSize(w, h, false);
    scenes.resize(w, h);
  };
  new ResizeObserver(applySize).observe(root);
  ui.quality.subscribe(applySize);
  applySize();

  render(h(Panels, null), el('panels'));
  render(h(Modals, null), el('modals'));
  render(h(LoadingCurtain, null), el('curtain'));
  render(h(LabelLayer, null), el('labels'));

  scenes.register('mainMenu', () => new MenuScene(), ['newGame']);
  scenes.register('worldMap', () => new WorldMapScene());
  scenes.register('region', () => new RegionScene());
  scenes.register('combat', () => new CombatScene());
  const loop = new RenderLoop(renderer, scenes, portraits, labels, input);
  loop.onContextRestored = () => { assets.rebuild(); void scenes.reenter(); };
  loop.start();
  if (import.meta.env.DEV) Object.assign(window as object, { __app: { services, ui, renderer } });
  await scenes.goto('mainMenu');
}

void boot();
