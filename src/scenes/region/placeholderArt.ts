import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import type { Atlas, AtlasFrame } from '../../render/paper';
import { FRAMES } from './regionArt';

/**
 * 素材到位前的占位图集：按 artKey 类别程序画剪影，帧尺寸取 FRAMES（米）。
 * 真实图集（region-terrain / region-detail）由 AssetCache 加载后替换。
 */
const PX_PER_M = 150, PAD = 6, SIZE = 1024;

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

const tree = (leaf: string, trunk = '#5b4030'): Painter => (g, w, h) => {
  g.fillStyle = trunk; g.fillRect(w * 0.44, h * 0.55, w * 0.12, h * 0.45);
  g.fillStyle = leaf;
  g.beginPath(); g.ellipse(w / 2, h * 0.38, w * 0.46, h * 0.36, 0, 0, 7); g.fill();
  g.fillStyle = 'rgba(0,0,0,.18)';
  g.beginPath(); g.ellipse(w * 0.62, h * 0.48, w * 0.28, h * 0.2, 0, 0, 7); g.fill();
};
const conifer = (leaf: string): Painter => (g, w, h) => {
  g.fillStyle = '#4b3628'; g.fillRect(w * 0.45, h * 0.8, w * 0.1, h * 0.2);
  g.fillStyle = leaf;
  for (let i = 0; i < 3; i++) {
    const y0 = h * (0.05 + i * 0.25), y1 = h * (0.45 + i * 0.18), s = 0.3 + i * 0.12;
    g.beginPath(); g.moveTo(w / 2, y0); g.lineTo(w * (0.5 + s), y1); g.lineTo(w * (0.5 - s), y1); g.fill();
  }
};
const peak = (rock: string, snow = false): Painter => (g, w, h) => {
  g.fillStyle = rock;
  g.beginPath(); g.moveTo(0, h); g.lineTo(w * 0.42, h * 0.04); g.lineTo(w * 0.62, h * 0.4); g.lineTo(w * 0.78, h * 0.22); g.lineTo(w, h); g.fill();
  g.fillStyle = 'rgba(0,0,0,.22)';
  g.beginPath(); g.moveTo(w * 0.42, h * 0.04); g.lineTo(w * 0.62, h * 0.4); g.lineTo(w * 0.55, h); g.lineTo(w * 0.42, h); g.fill();
  if (snow) { g.fillStyle = '#f2efe6'; g.beginPath(); g.moveTo(w * 0.42, h * 0.04); g.lineTo(w * 0.5, h * 0.2); g.lineTo(w * 0.34, h * 0.2); g.fill(); }
};
const mound = (c: string): Painter => (g, w, h) => {
  g.fillStyle = c; g.beginPath(); g.ellipse(w / 2, h, w * 0.5, h * 0.95, 0, Math.PI, 0); g.fill();
};
const blades = (c: string, tall = 1): Painter => (g, w, h) => {
  g.strokeStyle = c; g.lineWidth = Math.max(2, w * 0.06); g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const x = w * (0.12 + i * 0.12);
    g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (i - 3) * w * 0.03, h * 0.5, x + (i - 3) * w * 0.06, h * (1 - tall * (0.7 + (i % 3) * 0.1)));
    g.stroke();
  }
};
const house = (wall: string, roof: string): Painter => (g, w, h) => {
  g.fillStyle = wall; g.fillRect(w * 0.12, h * 0.45, w * 0.76, h * 0.55);
  g.fillStyle = roof;
  g.beginPath(); g.moveTo(0, h * 0.5); g.lineTo(w * 0.2, h * 0.12); g.lineTo(w * 0.8, h * 0.12); g.lineTo(w, h * 0.5); g.fill();
  g.fillStyle = '#3a2a20'; g.fillRect(w * 0.43, h * 0.7, w * 0.14, h * 0.3);
};
const blob = (c: string): Painter => (g, w, h) => {
  g.fillStyle = c;
  g.beginPath();
  for (let i = 0; i <= 10; i++) {
    const a = i / 10 * Math.PI * 2, r = 0.38 + 0.08 * Math.sin(i * 2.3);
    const x = w / 2 + Math.cos(a) * w * r, y = h / 2 + Math.sin(a) * h * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.fill();
};

function painterFor(key: string): Painter {
  const p = key.split('.');
  if (p[0] === 'terrain') {
    switch (p[2]) {
      case 'woods': return p[3] === '0' ? tree('#4f7a3c') : conifer('#3d6634');
      case 'jungle': return p[3] === '0' ? tree('#2f5a2c') : conifer('#2a4f2a');
      case 'mulberry': return tree('#6e9a46');
      case 'garden': return p[3] === '0' ? tree('#7da05a') : conifer('#5f8a50');
      case 'vale': return tree('#e2a7b4', '#6a4a3a');
      case 'herbGarden': return mound('#7fa058');
      case 'mountain': return peak('#7b7768', true);
      case 'stoneForest': return peak('#8d8a80');
      case 'canyon': case 'cave': return peak('#8a7356');
      case 'abyss': return peak('#3c3640');
      case 'waste': return p[3] === '0' ? tree('#9a8a5a', '#5a4a3a') : mound('#a89a72');
      case 'hill': return mound('#93955f');
      case 'lake': case 'marsh': return blades('#6c8a5a', 1);
      case 'farmland': return mound('#c9a85a');
      default: return blades('#8aa860', 0.8);
    }
  }
  if (p[0] === 'loc' && p[1] === 'prop') return p[2] === 'tree' ? tree('#5f8a4c') : house('#b8a88a', '#6a5a4a');
  if (p[0] === 'loc' || p[0] === 'poi') {
    const roof = ({ city: '#7a3a2e', sectSeat: '#3e4f6e', town: '#6a5040', fort: '#4a4a3e', village: '#8a6a40' } as Record<string, string>)[p[1]] ?? '#5a4a5a';
    return house('#d8ccb0', roof);
  }
  if (p[0] === 'house') {
    const c = ({ cottage: ['#cdb48a', '#8a7448'], tile: ['#ece4d2', '#4a5560'], long: ['#c8b08a', '#7a6646'],
      shop: ['#b89870', '#5a4a3a'], tower: ['#8a6a48', '#5a4630'], hall: ['#b0463a', '#3e4652'] } as Record<string, [string, string]>)[p[1]] ?? ['#d8ccb0', '#6a5a4a'];
    return house(c[0], c[1]);
  }
  if (p[0] === 'filler') {
    switch (p[1]) {
      case 'bush': return tree(p[2] === '1' ? '#6f9a50' : '#4f7a3c', '#4f7a3c');
      case 'fern': case 'tuft': case 'reeds': case 'herbs': case 'bamboo': return blades(p[1] === 'reeds' ? '#8a9a5a' : '#5f8f45', 1);
      case 'flowers': return blob(p[2] === '1' ? '#d9b04a' : '#d88a9a');
      case 'rock': return mound('#8c887c');
      case 'mushrooms': return mound('#b05a40');
      case 'stump': case 'log': case 'deadwood': return mound('#6a503a');
      case 'thorn': return blades('#6a5a3a', 0.9);
    }
  }
  if (p[0] === 'ground') {
    const c = ({ dirt: '#9a7a52', leaves: '#7a6a2a', moss: '#5a7a3a', pebbles: '#a09a8a', petals: '#e0b0b8', puddle: '#7a9aa8',
      roots: '#6a4a30', cracks: '#5a4a3a', needles: '#6a5a30', grass: '#7a9a4a' } as Record<string, string>)[p[2]] ?? '#888';
    return blob(c);
  }
  return blob('#888');
}

export function makePlaceholderAtlas(): Atlas {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d')!;
  const frames: AtlasFrame[] = [];
  let x = 0, y = 0, rowH = 0;
  for (const [name, [wm, hm]] of Object.entries(FRAMES)) {
    const w = Math.min(300, Math.ceil(wm * PX_PER_M)), h = Math.min(300, Math.ceil(hm * PX_PER_M));
    if (x + w + PAD * 2 > SIZE) { x = 0; y += rowH; rowH = 0; }
    const ox = x + PAD, oy = y + PAD;
    g.save(); g.translate(ox, oy);
    g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.filter = 'blur(0.8px)';
    painterFor(name)(g, w, h);
    g.restore();
    frames.push({ name, rect: [ox, oy, w, h], size: [wm, hm] });
    x += w + PAD * 2; rowH = Math.max(rowH, h + PAD * 2);
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return { texture: tex, json: { image: 'placeholder', size: [SIZE, SIZE], feather: 1, padding: PAD * 2, frames } };
}
