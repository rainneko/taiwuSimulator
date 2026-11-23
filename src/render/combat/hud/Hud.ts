import { h, render } from 'preact';
import { signal, type Signal } from '@preact/signals';

export interface HudFighter {
  name: string;
  inner: number; // 0..1
  outer: number; // 0..1
  guard: number; // 0..1
}

export interface HudState {
  fighters: [HudFighter, HudFighter];
  distance: number;
  paused: boolean;
  ended: string | null;
}

export const hudState: Signal<HudState> = signal({
  fighters: [
    { name: '', inner: 0, outer: 0, guard: 0 },
    { name: '', inner: 0, outer: 0, guard: 0 },
  ],
  distance: 0,
  paused: false,
  ended: null,
});

const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

function Bar(props: { value: number; color: string; right: boolean; label: string }) {
  return h('div', { class: 'cb-bar' + (props.right ? ' cb-right' : '') },
    h('span', { class: 'cb-bar-label' }, props.label),
    h('div', { class: 'cb-bar-track' },
      h('div', { class: 'cb-bar-fill', style: { width: pct(props.value), background: props.color } })),
  );
}

function FighterPanel(props: { f: HudFighter; right: boolean }) {
  const { f, right } = props;
  return h('div', { class: 'cb-panel' + (right ? ' cb-right' : '') },
    h('div', { class: 'cb-name' }, f.name),
    h(Bar, { value: f.inner, color: '#5a6fb0', right, label: '内伤' }),
    h(Bar, { value: f.outer, color: '#b0423a', right, label: '外伤' }),
    h(Bar, { value: f.guard, color: '#f4efe2', right, label: '守御' }),
  );
}

function Hud(props: { onPause: () => void }) {
  const s = hudState.value;
  return h('div', { class: 'cb-hud' },
    h(FighterPanel, { f: s.fighters[0], right: false }),
    h('button', { class: 'cb-pause', onClick: props.onPause, title: '暂停 (空格)' }, s.paused ? '▶' : '⏸'),
    h(FighterPanel, { f: s.fighters[1], right: true }),
    h('div', { class: 'cb-distance' }, s.distance.toFixed(1)),
    s.ended ? h('div', { class: 'cb-ended' }, s.ended) : null,
  );
}

const CSS = `
.cb-hud{position:absolute;inset:0;pointer-events:none;font:14px/1.3 "Songti SC","STSong",serif;color:#2b2218}
.cb-panel{position:absolute;top:3%;left:3%;width:30%;padding:8px 12px;background:rgba(244,236,218,.86);
  border:1px solid #8c7a5c;box-shadow:2px 3px 0 rgba(60,40,20,.2)}
.cb-panel.cb-right{left:auto;right:3%;text-align:right}
.cb-name{font-size:18px;margin-bottom:4px}
.cb-bar{display:flex;align-items:center;gap:6px;margin:3px 0}
.cb-bar.cb-right{flex-direction:row-reverse}
.cb-bar-label{font-size:12px;width:2.5em;flex:none}
.cb-bar-track{flex:1;height:9px;background:rgba(60,40,20,.18);border:1px solid rgba(60,40,20,.35);display:flex}
.cb-bar.cb-right .cb-bar-track{justify-content:flex-end}
.cb-bar-fill{height:100%;transition:width .15s}
.cb-pause{pointer-events:auto;position:absolute;top:3%;left:50%;transform:translateX(-50%);width:52px;height:52px;
  border-radius:50%;border:2px solid #5b4a33;background:#f4ecda;font-size:20px;cursor:pointer;box-shadow:2px 3px 0 rgba(60,40,20,.25)}
.cb-distance{position:absolute;bottom:6%;left:50%;transform:translateX(-50%);padding:2px 18px;font-size:22px;
  background:repeating-linear-gradient(90deg,#f4ecda 0 9px,#e6dac0 9px 10px);border:1px solid #8c7a5c}
.cb-ended{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);font-size:44px;color:#7a1f18;
  text-shadow:0 0 8px #f4ecda,0 0 2px #f4ecda}
`;

export function mountHud(container: HTMLElement, onPause: () => void): () => void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  container.appendChild(root);
  render(h(Hud, { onPause }), root);
  return () => { render(null, root); root.remove(); style.remove(); };
}
