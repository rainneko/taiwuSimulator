import { signal } from '@preact/signals';
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { services } from '../services';
import { pushModal, ui } from '../store';
import { t } from '../strings';
import { PaperButton } from './PaperButton';

export const muted = signal(false);

interface MenuItem { id: string; labelKey: string; visible?: () => boolean; onSelect: () => void }

/** 存档工单接入前的桩。 */
function hasAnySave(): boolean { try { return !!localStorage.getItem('taiwu.save.latest'); } catch { return false; } }
function continueLatest(): void { console.info('[stub] continueLatest'); }

const items: MenuItem[] = [
  { id: 'continue', labelKey: 'menu.continue', visible: hasAnySave, onSelect: continueLatest },
  { id: 'new', labelKey: 'menu.new', onSelect: () => services.scenes.retarget('newGame') },
  { id: 'load', labelKey: 'menu.load', onSelect: () => pushModal('saveLoad') },
  { id: 'settings', labelKey: 'menu.settings', onSelect: () => pushModal('settings') },
  { id: 'credits', labelKey: 'menu.credits', onSelect: () => pushModal('credits') },
];

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.();
}

export function MainMenu() {
  const ready = ui.menuReady.value;
  const visible = items.filter((i) => !i.visible || i.visible());
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => { if (ready && !ui.modalStack.peek().length) refs.current[0]?.focus(); }, [ready]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = refs.current.indexOf(document.activeElement as HTMLButtonElement);
    const n = visible.length, j = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
    refs.current[j]?.focus();
  };
  const m = services.manifest;
  return h('div', { class: 'passthrough' },
    h('nav', { class: `main-menu${ready ? ' ready' : ''}`, onKeyDown: onKey, style: ready ? undefined : { pointerEvents: 'none' } },
      visible.map((it, i) => h(PaperButton, { key: it.id, id: it.id, onClick: it.onSelect, btnRef: (el) => (refs.current[i] = el) }, t(it.labelKey)))),
    h('div', { class: 'corner' },
      h('span', null, `${m.name} v${m.version}`),
      h(PaperButton, { small: true, onClick: toggleFullscreen }, '全屏'),
      h(PaperButton, { small: true, onClick: () => { muted.value = !muted.value; } }, muted.value ? '已静音' : '静音')),
  );
}
