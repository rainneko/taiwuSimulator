import { batch, computed, signal } from '@preact/signals';

export type Screen = 'boot' | 'mainMenu' | 'newGame' | 'worldMap' | 'region' | 'town' | 'combat';
export type PanelId = string;
export type ModalId = 'settings' | 'saveLoad' | 'credits' | (string & {});
export type Selection =
  | { type: 'province'; id: string }
  | { type: 'region'; id: string }
  | { type: 'cell'; id: string }
  | { type: 'char'; id: string }
  | { type: 'menu'; id: string };
export type Quality = 'high' | 'medium' | 'low';

/** 游戏态占位类型：真正的结构由 core 工单定义。 */
export type TimeState = Record<string, unknown>;
export type CharacterState = Record<string, unknown>;
export type WorldState = Record<string, unknown>;
export type TownState = Record<string, unknown>;

export const ui = {
  screen: signal<Screen>('boot'),
  transition: signal<{ from: Screen; to: Screen; progress: number } | null>(null),
  panel: signal<PanelId | null>(null),
  drawer: signal<PanelId | null>(null),
  modalStack: signal<ModalId[]>([]),
  selection: signal<Selection | null>(null),
  hover: signal<Selection | null>(null),
  quality: signal<Quality>('high'),
  reducedMotion: signal<boolean>(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  menuReady: signal(false),
  dragPayload: signal<unknown>(null),
  loading: signal<{ visible: boolean; ratio: number; retry: (() => void) | null; cancel?: (() => void) | null }>({ visible: false, ratio: 0, retry: null }),
};

export const game = {
  time: signal<TimeState | null>(null),
  player: signal<CharacterState | null>(null),
  world: signal<WorldState | null>(null),
  town: signal<TownState | null>(null),
};

export const inputLocked = computed(() => ui.transition.value !== null);

export function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return a === b || (!!a && !!b && a.type === b.type && a.id === b.id);
}
/** 写入前比较相等，避免每帧触发重渲染。 */
export function setHover(s: Selection | null): void { if (!sameSelection(ui.hover.peek(), s)) ui.hover.value = s; }
export function setSelection(s: Selection | null): void { if (!sameSelection(ui.selection.peek(), s)) ui.selection.value = s; }

export function pushModal(m: ModalId): void { ui.modalStack.value = [...ui.modalStack.peek(), m]; }
export function popModal(): void { ui.modalStack.value = ui.modalStack.peek().slice(0, -1); }

/** Esc：模态 → 抽屉 → 主面板 → 取消选择。 */
export function closeTopmost(): boolean {
  if (ui.modalStack.peek().length) { popModal(); return true; }
  if (ui.drawer.peek() !== null) { ui.drawer.value = null; return true; }
  if (ui.panel.peek() !== null) { ui.panel.value = null; return true; }
  if (ui.selection.peek() !== null) { ui.selection.value = null; return true; }
  return false;
}

/** 同类面板替换；不同类则旧的进抽屉位（最多一层）。类别 = id 中 ':' 之前的部分。 */
export function openPanel(p: PanelId): void {
  const cur = ui.panel.peek();
  if (cur === p) return;
  const kind = (id: string) => id.split(':')[0];
  batch(() => {
    if (cur !== null && kind(cur) !== kind(p)) ui.drawer.value = cur;
    ui.panel.value = p;
  });
}
