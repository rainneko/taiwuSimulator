import { spine } from '../spine-webgl-3.8';

export interface StrikeTiming {
  /** 命中时刻（秒）：动画里的 hit 事件；没有就取 act0，再没有取时长 60% */
  hitTime: number;
  duration: number;
  /** 命中时刻腰骨相对根骨骼的前移量（世界单位，朝右为正）：动画自带的前冲 */
  waistAtHit: number;
}

const cache = new WeakMap<spine.SkeletonData, { skeleton: spine.Skeleton; timings: Map<string, StrikeTiming> }>();

function findEventTime(anim: spine.Animation, name: string): number {
  for (const tl of anim.timelines) {
    if (!(tl instanceof spine.EventTimeline)) continue;
    for (let i = 0; i < tl.events.length; i++) if (tl.events[i].data.name === name) return tl.frames[i];
  }
  return -1;
}

/** 从骨骼数据里量出一个出手动画的命中时刻与自带前冲（结果缓存）。 */
export function strikeTiming(data: spine.SkeletonData, name: string): StrikeTiming {
  let c = cache.get(data);
  if (!c) { c = { skeleton: new spine.Skeleton(data), timings: new Map() }; cache.set(data, c); }
  const hit = c.timings.get(name);
  if (hit) return hit;

  const anim = data.findAnimation(name);
  let t: StrikeTiming = { hitTime: 0.3, duration: 0.5, waistAtHit: 0 };
  if (anim) {
    let hitTime = findEventTime(anim, 'hit');
    if (hitTime < 0) hitTime = findEventTime(anim, 'act0');
    if (hitTime < 0) hitTime = anim.duration * 0.6;
    const sk = c.skeleton;
    sk.x = 0; sk.y = 0; sk.scaleX = 1; sk.scaleY = 1;
    sk.setToSetupPose();
    anim.apply(sk, 0, hitTime, false, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
    sk.updateWorldTransform();
    const waist = sk.findBone('waist');
    t = { hitTime, duration: anim.duration, waistAtHit: waist ? waist.worldX - sk.x : 0 };
  }
  c.timings.set(name, t);
  return t;
}
