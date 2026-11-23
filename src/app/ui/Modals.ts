import { h, type FunctionComponent, type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { popModal, ui, type ModalId, type Quality } from '../store';
import { t } from '../strings';
import { PaperButton } from './PaperButton';

const Settings: FunctionComponent = () => {
  const q = ui.quality.value;
  return h('div', null,
    h('div', { class: 'row' }, h('label', null, t('settings.quality')),
      h('div', { class: 'radios' }, (['high', 'medium', 'low'] as Quality[]).map((k) =>
        h('button', { key: k, class: q === k ? 'on' : '', onClick: () => { ui.quality.value = k; } }, t(`quality.${k}`))))),
    h('div', { class: 'row' }, h('label', null, t('settings.motion')),
      h('input', { type: 'checkbox', checked: ui.reducedMotion.value, onChange: (e: Event) => { ui.reducedMotion.value = (e.target as HTMLInputElement).checked; } })),
    h('div', { class: 'row' }, h('label', null, t('settings.volume')), h('input', { type: 'range', min: 0, max: 100, value: 80, disabled: true })),
  );
}

const SaveLoad: FunctionComponent = () => {
  return h('div', { class: 'placeholder' }, t('saveLoad.empty'));
}

const Credits: FunctionComponent = () => {
  const [text, setText] = useState('…');
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}content/credits.md`).then((r) => (r.ok && !r.headers.get('content-type')?.includes('html') ? r.text() : null))
      .then((s) => setText(s ?? FALLBACK_CREDITS)).catch(() => setText(FALLBACK_CREDITS));
  }, []);
  return h('div', { class: 'scroll' }, text);
}

const FALLBACK_CREDITS = `太吾绘卷 WebGL 复刻（同人学习项目）

第三方代码：
· three.js — MIT License
· Preact / @preact/signals — MIT License
· papertrails — MIT License
  Permission is hereby granted, free of charge, to any person obtaining a copy of this software … (完整文本见内容包 credits.md)`;

const BODY: Record<string, { title: string; body: () => VNode<any> }> = {
  settings: { title: 'settings.title', body: () => h(Settings, null) },
  saveLoad: { title: 'saveLoad.title', body: () => h(SaveLoad, null) },
  credits: { title: 'credits.title', body: () => h(Credits, null) },
};

export function Modals() {
  const stack = ui.modalStack.value;
  return h('div', null, stack.map((id: ModalId, i) => {
    const def = BODY[id];
    return h('div', { key: `${id}-${i}`, class: 'modal-mask', onClick: (e: MouseEvent) => { if (e.target === e.currentTarget) popModal(); } },
      h('div', { class: 'modal paper paper-cut', role: 'dialog' },
        h('h2', null, def ? t(def.title) : id),
        def ? def.body() : null,
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h(PaperButton, { small: true, onClick: popModal }, t('common.close')))));
  }));
}
