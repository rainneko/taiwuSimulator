import type { WebGLRenderer, WebGLRenderTarget } from 'three';
import type { AssetCache } from '../app/AssetCache';
import type { ScenePointerEvent } from '../app/InputRouter';
import type { IScene } from '../app/SceneManager';
import { services } from '../app/services';
import type { Screen } from '../app/store';
import { initCombat, step, type CombatAction, type CombatConfig, type CombatEvent, type CombatState, type WeaponDef } from '../core/combat';
import { BARE_HANDS } from '../core/character/Character';
import { CombatRenderer } from '../render/combat';

export interface CombatEnterParams {
  config?: CombatConfig;
  returnTo?: Screen;
  returnParams?: unknown;
}

const STEP = 1 / 60;

function defaultConfig(): CombatConfig {
  const player = services.player;
  const db = services.db;
  const playerConfig = player
    ? player.toFighterConfig()
    : { id: 'player', name: '太吾', weapons: [BARE_HANDS] };
  if (playerConfig.weapons.length === 0) playerConfig.weapons = [BARE_HANDS];

  const npcTemplate = db?.npcs?.find(n => n.id === 'bandit');
  const enemyWeapons: WeaponDef[] = npcTemplate
    ? npcTemplate.equipment.weapons.flatMap(wid => { const w = db.items.getAs(wid, 'weapon'); return w ? [w] : []; })
    : [];
  if (enemyWeapons.length === 0) enemyWeapons.push(BARE_HANDS);
  const enemyAi = npcTemplate?.ai ?? { difficulty: 1 };

  return {
    seed: BigInt(Math.floor(Math.random() * 1e9)),
    fighters: [
      playerConfig,
      { id: 'enemy', name: npcTemplate?.name ?? '山贼', weapons: enemyWeapons },
    ],
    arts: db?.loaded ? db.artRegistry() : undefined,
    ai: [{ difficulty: 2 }, enemyAi],
  };
}

/**
 * IScene adapter for the DOM-based CombatRenderer.
 * The three.js renderer is unused — combat has its own canvas pair.
 * A transparent overlay div sits on top of the main canvas during combat.
 */
export class CombatScene implements IScene {
  id: Screen = 'combat';
  private overlay: HTMLDivElement | null = null;
  private renderer: CombatRenderer | null = null;
  private state: CombatState | null = null;
  private pending: CombatAction[] = [];
  private acc = 0;
  private loaded = false;
  private returnTo: Screen = 'region';
  private returnParams: unknown = undefined;
  private ended = false;
  private endTimer = 0;

  async preload(_assets: AssetCache, _signal: AbortSignal): Promise<void> {
    // CombatRenderer.load() is called in enter() since it needs the DOM overlay
  }

  enter(params: unknown, _from: Screen | null): void {
    const p = (params ?? {}) as CombatEnterParams;
    this.returnTo = p.returnTo ?? 'region';
    this.returnParams = p.returnParams;
    this.ended = false;
    this.endTimer = 0;
    this.acc = 0;
    this.pending = [];

    // Create overlay
    const root = document.getElementById('root')!;
    this.overlay = document.createElement('div');
    Object.assign(this.overlay.style, {
      position: 'absolute', inset: '0', zIndex: '50',
      background: '#1d1912',
    });
    root.appendChild(this.overlay);

    this.renderer = new CombatRenderer(this.overlay, {
      bgSet: Math.floor(Math.random() * 3),
      skins: ['doll', 'doll'],
      onPauseToggle: () => this.togglePause(),
    });

    const config = p.config ?? defaultConfig();
    this.state = initCombat(config);

    void this.renderer.load().then(() => {
      if (!this.renderer || !this.state) return;
      this.renderer.bind(this.state);
      this.loaded = true;
    });
  }

  private togglePause(): void {
    if (!this.state) return;
    this.pending.push({ type: this.state.phase === 'paused' ? 'resume' : 'pause' });
  }

  update(dt: number): void {
    if (!this.loaded || !this.state || !this.renderer) return;

    if (this.ended) {
      this.endTimer += dt;
      if (this.endTimer > 3) {
        void services.scenes?.goto(this.returnTo, this.returnParams, { style: 'tear' });
        this.ended = false; // prevent re-trigger
      }
      this.renderer.renderFrame(this.state, dt);
      return;
    }

    const events: CombatEvent[] = [];
    if (!this.renderer.frozen) {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        events.push(...step(this.state, this.pending));
        this.pending = [];
      }
    }
    this.renderer.renderFrame(this.state, dt, events);

    if (events.some(e => e.type === 'end')) {
      this.ended = true;
    }
  }

  render(_r: WebGLRenderer, _target: WebGLRenderTarget | null): void {
    // Combat uses its own canvases; three.js render is a no-op
  }

  onPointer(_e: ScenePointerEvent): void {}

  onKey(e: KeyboardEvent): boolean {
    if (!this.state) return false;
    if (e.code === 'Space') { e.preventDefault(); this.togglePause(); return true; }
    if (e.code === 'Escape' && this.ended) {
      void services.scenes?.goto(this.returnTo, this.returnParams, { style: 'tear' });
      this.ended = false;
      return true;
    }
    return false;
  }

  exit(_to: Screen): void {
    this.loaded = false;
    this.state = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.overlay?.remove();
    this.overlay = null;
  }

  dispose(): void { this.exit('mainMenu' as Screen); }

  resize(): void {
    // CombatRenderer has its own ResizeObserver
  }

  isIdle(): boolean { return !this.loaded; }
}
