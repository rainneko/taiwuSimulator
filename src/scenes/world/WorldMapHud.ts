import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { setHover, setSelection, ui } from '../../app/store';
import { t } from '../../app/strings';
import { worldMapApi } from './WorldMapScene';
import { computeView, stubRoutes, worldUi, type LayerMode } from './worldData';

const routes = stubRoutes();

/** 省份信息卡：省名、恩义、三个地区行、「前往」。工单 §11。 */
function ProvinceCard() {
  const sel = ui.selection.value;
  const view = computeView(worldUi.layer.value, worldUi.current.value, worldUi.ap.value, routes);
  const pv = sel?.type === 'province' ? view.provinces.find((p) => p.id === sel.id) : null;
  const dest = worldUi.destRegion.value;
  if (!pv) return h('div', { class: 'wm-card', 'data-open': 'false' });
  const chosen = pv.regions.find((r) => r.id === dest) ?? pv.regions.find((r) => r.unlocked && r.apCost !== null);
  const ap = worldUi.ap.value;
  const canGo = !!chosen && chosen.apCost !== null && chosen.apCost <= ap && !worldUi.busy.value;
  return h('div', { class: 'wm-card paper', 'data-open': 'true', style: { '--accent': pv.accentColor } },
    h('h2', null, t(pv.nameKey)),
    h('div', { class: 'wm-goodwill' }, t('map.goodwill'), h('span', { class: 'wm-bar' }, h('i', { style: { width: `${pv.goodwill * 100}%` } }))),
    h('ul', { class: 'wm-regions' }, pv.regions.map((r) => {
      const ok = r.unlocked && r.apCost !== null && r.apCost <= ap;
      return h('li', {
        key: r.id, 'data-ok': String(ok), 'data-chosen': String(chosen?.id === r.id),
        onMouseEnter: () => setHover({ type: 'region', id: r.id }), onMouseLeave: () => setHover(null),
        onClick: () => { if (ok) worldUi.destRegion.value = r.id; },
      }, h('span', { class: `wm-kind wm-kind-${r.kind}` }), h('span', null, t(r.nameKey)),
      h('em', null, r.apCost === null || !r.unlocked ? t('map.unreached') : `${r.apCost} ${t('map.ap')}`));
    })),
    !canGo && chosen && chosen.apCost !== null && chosen.apCost > ap ? h('p', { class: 'wm-reason' }, t('map.apShort')) : null,
    h('button', { class: 'wm-go', disabled: !canGo, onClick: () => chosen && worldMapApi.travel(chosen.id) }, t('map.go')),
  );
}

function LayerToggle() {
  const cur = worldUi.layer.value;
  const modes: LayerMode[] = ['faction', 'goodwill', 'routes'];
  return h('div', { class: 'wm-layers' }, modes.map((m, i) => h('button', {
    key: m, 'data-on': String(cur === m), onClick: () => { worldUi.layer.value = m; }, title: `${i + 1}`,
  }, t(`map.layer.${m}`))));
}

function ZoomControls() {
  return h('div', { class: 'wm-zoom' },
    h('button', { onClick: () => worldMapApi.zoomBy(-2) }, '+'),
    h('button', { onClick: () => worldMapApi.zoomBy(2) }, '−'),
    h('button', { onClick: () => worldMapApi.focusCurrent() }, t('map.home')));
}

function Toast() {
  const toast = worldUi.toast.value;
  const [, tick] = useState(0);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => { worldUi.toast.value = null; tick((x) => x + 1); }, 1400); return () => clearTimeout(id); }, [toast]);
  if (!toast) return null;
  return h('div', { class: 'wm-toast', style: { left: `${toast.px[0]}px`, top: `${toast.px[1] - 36}px` } }, t(toast.key));
}

export function WorldMapHud() {
  if (ui.screen.value !== 'worldMap') return null;
  return h('div', { class: 'wm-hud' },
    h('div', { class: 'wm-top paper' }, `${t('map.ap')} `, h('b', null, worldUi.ap.value)),
    h(LayerToggle, null), h(ZoomControls, null), h(ProvinceCard, null), h(Toast, null),
    h('button', { class: 'wm-clear', hidden: true, onClick: () => setSelection(null) }));
}

export const WORLD_HUD_CSS = `
.wm-hud { position: absolute; inset: 0; pointer-events: none; font: 14px/1.5 "Songti SC", "STSong", serif; color: #3a2e22; }
.wm-hud button { font: inherit; cursor: pointer; }
.wm-hud > * { pointer-events: auto; }
.wm-top { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); padding: 4px 16px; background: #fbf7ee; box-shadow: 2px 3px 0 rgba(60,40,20,.18); }
.wm-layers { position: absolute; top: 12px; left: 12px; display: flex; gap: 4px; }
.wm-layers button, .wm-zoom button { background: #f3ead6; border: 1px solid #a89574; padding: 3px 10px; box-shadow: 1px 2px 0 rgba(60,40,20,.15); }
.wm-layers button[data-on=true] { background: #3a2e22; color: #fbf7ee; }
.wm-zoom { position: absolute; bottom: 16px; left: 12px; display: flex; flex-direction: column; gap: 4px; }
.wm-card { position: absolute; top: 64px; right: 16px; width: 260px; padding: 14px 16px; background: #fbf7ee; box-shadow: 3px 4px 0 rgba(60,40,20,.2);
  border-top: 6px solid var(--accent, #999); transform: translateX(120%); transition: transform 220ms cubic-bezier(.2,.8,.2,1); }
.wm-card[data-open=true] { transform: none; }
.wm-card h2 { margin: 0 0 6px; font-size: 20px; letter-spacing: .15em; }
.wm-bar { display: inline-block; width: 120px; height: 6px; margin-left: 8px; background: #e4d9c3; vertical-align: middle; }
.wm-bar i { display: block; height: 100%; background: var(--accent); }
.wm-regions { list-style: none; padding: 0; margin: 10px 0; }
.wm-regions li { display: flex; gap: 8px; align-items: center; padding: 4px 6px; cursor: pointer; }
.wm-regions li[data-ok=false] { opacity: .45; cursor: default; }
.wm-regions li[data-chosen=true] { background: #efe4cc; }
.wm-regions em { margin-left: auto; font-style: normal; font-size: 12px; }
.wm-kind { width: 10px; height: 10px; background: var(--accent); transform: rotate(45deg); }
.wm-kind-sect { border-radius: 50%; transform: none; }
.wm-kind-rural { background: #a89574; }
.wm-reason { font-size: 12px; color: #a2402f; margin: 0 0 6px; }
.wm-go { width: 100%; padding: 6px; background: #3a2e22; color: #fbf7ee; border: 0; letter-spacing: .3em; }
.wm-go:disabled { opacity: .4; cursor: default; }
.wm-toast { position: absolute; transform: translateX(-50%); background: #3a2e22; color: #fbf7ee; padding: 3px 10px; font-size: 12px; pointer-events: none; }
.label { pointer-events: none; padding: 1px 8px; background: rgba(251,247,238,.9); color: #3a2e22; font: 13px/1.5 "Songti SC", "STSong", serif; letter-spacing: .2em; box-shadow: 1px 2px 0 rgba(60,40,20,.18); white-space: nowrap; }
@media (max-width: 900px) { .wm-card { top: auto; bottom: 0; right: 0; left: 0; width: auto; transform: translateY(120%); } }
`;
