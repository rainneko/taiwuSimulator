import { initCombat, step, WEAPON_SPEED_CLASS, type CombatAction, type CombatConfig, type CombatEvent, type CombatState, type WeaponDef } from '../core/combat';
import { BG_SETS, CombatRenderer } from '../render/combat';

const SWORD: WeaponDef = {
  id: 'sword', weaponClass: 'sword', baseSpeed: WEAPON_SPEED_CLASS.normal, weight: 3,
  rangeMin: 2.0, rangeMax: 6.0, power: 1000, wheel: ['chop', 'stab', 'flick', 'chop', 'stab', 'wild'],
};
const BLADE: WeaponDef = {
  id: 'blade', weaponClass: 'blade', baseSpeed: WEAPON_SPEED_CLASS.normal, weight: 4,
  rangeMin: 2.0, rangeMax: 5.5, power: 1100, wheel: ['chop', 'crash', 'lift', 'chop', 'crash', 'lift'],
};
const SPEAR: WeaponDef = {
  id: 'spear', weaponClass: 'polearm', baseSpeed: WEAPON_SPEED_CLASS.slow, weight: 6,
  rangeMin: 4.0, rangeMax: 9.0, power: 1400, wheel: ['stab', 'sweep', 'lift', 'stab', 'sweep', 'lift'],
};

const params = new URLSearchParams(location.search);
const bgSel = document.getElementById('bg') as HTMLSelectElement;
BG_SETS.forEach((n, i) => bgSel.add(new Option(`${i} ${n}`, String(i))));
bgSel.value = params.get('bg') ?? '0';

const config = (): CombatConfig => (<CombatConfig>{
  seed: BigInt(Math.floor(Math.random() * 1e9)),
  fighters: [
    { id: 'a', name: '太吾', weapons: [SWORD, SPEAR] },
    { id: 'b', name: '山贼', weapons: [BLADE, SPEAR] },
  ],
  // 玩家侧默认也交给 AI，方便看完整一场；?manual 关闭
  // ai 字段随 WO3 加入；旧版 CombatConfig 无此字段时被忽略
  ai: [params.has('manual') ? null : { difficulty: 2 }, { difficulty: 2 }],
});

const renderer = new CombatRenderer(document.getElementById('app')!, {
  bgSet: Number(bgSel.value),
  skins: ['doll', 'female'],
  onPauseToggle: () => togglePause(),
});
(window as unknown as { combat: unknown }).combat = { renderer, get state() { return state; } };

let state: CombatState;
let pending: CombatAction[] = [];
const togglePause = () => pending.push({ type: state.phase === 'paused' ? 'resume' : 'pause' });

function restart() {
  state = initCombat(config());
  renderer.bind(state);
}

addEventListener('keydown', (e) => {
  const d = { KeyA: -0.1, KeyD: 0.1, KeyQ: -0.5, KeyE: 0.5 }[e.code];
  if (d !== undefined) pending.push({ type: 'setTargetDistance', actorId: 'a', delta: d });
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
});
bgSel.onchange = () => renderer.setBackground(Number(bgSel.value));
document.getElementById('restart')!.onclick = restart;
const info = document.getElementById('info')!;


const STEP = 1 / 60;
let acc = 0, last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const events: CombatEvent[] = [];
  // 顿帧期间逻辑也停（打击感），否则按 60Hz 定步长推进
  if (!renderer.frozen) {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      events.push(...step(state, pending));
      pending = [];
    }
  }
  renderer.renderFrame(state, dt, events);
  info.textContent = ` frame ${state.frame} · ${state.phase}`;
  requestAnimationFrame(frame);
}
void renderer.load().then(() => { restart(); requestAnimationFrame(frame); });
