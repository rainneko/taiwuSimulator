import { h, type ComponentChildren } from 'preact';
import { setHover } from '../store';

export function PaperButton(p: { id?: string; onClick: () => void; children?: ComponentChildren; small?: boolean; disabled?: boolean;
  btnRef?: (el: HTMLButtonElement | null) => void }) {
  const hov = () => p.id && setHover({ type: 'menu', id: p.id });
  const out = () => p.id && setHover(null);
  return h('button', {
    ref: p.btnRef, class: `paper paper-lift paper-cut paper-btn${p.small ? ' small' : ''}`, disabled: p.disabled,
    onClick: p.onClick, onMouseEnter: hov, onFocus: hov, onMouseLeave: out, onBlur: out,
  }, p.children);
}
