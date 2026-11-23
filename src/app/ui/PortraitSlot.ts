import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { PortraitSubject } from '../PortraitStage';
import { services } from '../services';

/** DOM 占位：注册到 PortraitStage，纸偶画在 #scene 上对应矩形内。 */
export function PortraitSlot(p: { subject: PortraitSubject; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!; return services.portraits.mount(el, p.subject);
  }, []);
  useEffect(() => { if (ref.current) services.portraits.setSubject(ref.current, p.subject); },
    [p.subject.bodyArtKey, p.subject.pose, p.subject.overlayArtKeys.join('|')]);
  return h('div', { ref, class: `portrait-slot passthrough ${p.class ?? ''}` });
}
