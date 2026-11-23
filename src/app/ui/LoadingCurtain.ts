import { h } from 'preact';
import { ui } from '../store';
import { t } from '../strings';
import { PaperButton } from './PaperButton';

export function LoadingCurtain() {
  const l = ui.loading.value;
  if (!l.visible) return null;
  return h('div', { class: 'loading' }, h('div', { class: 'box paper paper-cut' },
    h('span', null, l.retry ? '加载失败' : t('loading')),
    l.retry ? h(PaperButton, { small: true, onClick: l.retry }, t('common.retry')) : null,
    l.cancel ? h(PaperButton, { small: true, onClick: l.cancel }, t('common.cancel')) : null));
}
