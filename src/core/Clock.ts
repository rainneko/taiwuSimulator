/** 固定步长时钟：逻辑 60fps，与渲染帧率解耦。 */
export class Clock {
  readonly fps = 60;
  readonly dt = 1 / 60;
  private accumulator = 0;
  private _frame = 0;

  get frame(): number { return this._frame; }

  /** 传入真实 deltaTime（秒），返回本次需执行的逻辑步数。单次最多吃 0.1s 防螺旋。 */
  update(realDt: number): number {
    this.accumulator += Math.min(Math.max(0, realDt), 0.1);
    let steps = 0;
    // 加一个极小容差，避免 1/60 浮点累加误差导致丢帧
    while (this.accumulator + 1e-9 >= this.dt) {
      this.accumulator = Math.max(0, this.accumulator - this.dt);
      this._frame++;
      steps++;
    }
    return steps;
  }

  /** 插值因子 [0,1)，渲染层用于两逻辑帧间平滑 */
  get alpha(): number { return this.accumulator / this.dt; }

  reset(): void { this.accumulator = 0; this._frame = 0; }
}
