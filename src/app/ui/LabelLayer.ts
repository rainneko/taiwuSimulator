import { h } from 'preact';
import { services } from '../services';
import { t } from '../strings';

/** 按 LabelProjector.labels 渲染内容；位置由 projector.flush 每帧直接写。 */
export function LabelLayer() {
  const lp = services.labels;
  return h('div', null, lp.labels.value.map((l) => h('div', {
    key: l.id, class: 'label', ref: (el: HTMLElement | null) => lp.bind(l.id, el),
  }, t(l.textKey ?? l.id))));
}
