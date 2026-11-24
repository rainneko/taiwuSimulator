import { spine } from '../spine-webgl-3.8';

export type SpineSkin = 'doll' | 'female';

/** 一个 Spine 骨骼小黑人。 */
export class SpineActor {
  readonly skeleton: spine.Skeleton;
  readonly animationState: spine.AnimationState;
  readonly stateData: spine.AnimationStateData;
  /** 槽位 → 挂件名（每帧动画 apply 后重新套用，防止动画的 attachment 时间轴把武器换掉） */
  private weapons = new Map<string, string | null>();
  private flashLeft = 0;

  constructor(readonly data: spine.SkeletonData, skin: SpineSkin = 'doll') {
    this.skeleton = new spine.Skeleton(data);
    this.setSkin(skin);
    this.stateData = new spine.AnimationStateData(data);
    this.stateData.defaultMix = 0.15;
    this.animationState = new spine.AnimationState(this.stateData);
  }

  setSkin(skin: SpineSkin) {
    this.skeleton.setSkinByName(skin);
    this.skeleton.setSlotsToSetupPose();
  }

  hasAnimation(name: string): boolean {
    return !!this.data.findAnimation(name);
  }

  setPosition(x: number, y: number, flipX: boolean, scaleY = 1) {
    this.skeleton.x = x;
    this.skeleton.y = y;
    this.skeleton.scaleX = flipX ? -1 : 1;
    this.skeleton.scaleY = scaleY;
  }

  /** 腰骨世界坐标 x（update 之后有效）：身体实际所在位置，影子跟它走 */
  get bodyX(): number {
    return this.skeleton.findBone('waist')?.worldX ?? this.skeleton.x;
  }

  playAnimation(name: string, loop = false, track = 0): spine.TrackEntry | null {
    if (!this.hasAnimation(name)) return null;
    return this.animationState.setAnimation(track, name, loop);
  }

  queueAnimation(name: string, loop: boolean, delay = 0, track = 0): spine.TrackEntry | null {
    if (!this.hasAnimation(name)) return null;
    return this.animationState.addAnimation(track, name, loop, delay);
  }

  /** 设置武器挂件；attachmentName = null 清空槽位。 */
  setWeapon(slotName: string, attachmentName: string | null) {
    this.weapons.set(slotName, attachmentName);
    this.applyWeapons();
  }

  private applyWeapons() {
    for (const [slotName, att] of this.weapons) {
      const slot = this.skeleton.findSlot(slotName);
      if (!slot) continue;
      slot.setAttachment((att === null ? null : this.skeleton.getAttachmentByName(slotName, att)) as spine.Attachment);
    }
  }

  /** 受击白闪：借 two-color tint 的 darkColor 把黑色剪影抬成白色。 */
  flash(frames: number) {
    this.flashLeft = Math.max(this.flashLeft, frames);
  }

  update(dt: number) {
    this.animationState.update(dt);
    this.animationState.apply(this.skeleton);
    this.applyWeapons();
    const on = this.flashLeft > 0;
    if (on) this.flashLeft--;
    for (const slot of this.skeleton.slots) {
      if (on) (slot.darkColor ??= new spine.Color()).set(1, 1, 1, 1);
      else if (slot.darkColor) {
        if (slot.data.darkColor) slot.darkColor.setFromColor(slot.data.darkColor);
        else slot.darkColor = null as unknown as spine.Color;
      }
    }
    this.skeleton.updateWorldTransform();
  }
}
