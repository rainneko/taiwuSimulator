import { spine } from '../spine-webgl-3.8';
import { DESIGN_H, DESIGN_W } from './ParallaxBg';
import type { SpineActor } from './SpineActor';

/** spine-webgl 画布：透明背景，叠在 three.js 背景之上，与背景共用设计像素坐标系。 */
export class SpineLayer {
  readonly context: spine.webgl.ManagedWebGLRenderingContext;
  readonly scene: spine.webgl.SceneRenderer;
  readonly actors: SpineActor[] = [];

  constructor(readonly canvas: HTMLCanvasElement) {
    // 贴图是直通 alpha，画布也用直通 alpha 合成，避免描边发黑/发亮
    this.context = new spine.webgl.ManagedWebGLRenderingContext(canvas, { alpha: true, premultipliedAlpha: false });
    this.scene = new spine.webgl.SceneRenderer(canvas, this.context, true);
    const cam = this.scene.camera;
    cam.position.set(DESIGN_W / 2, DESIGN_H / 2, 0);
    cam.viewportWidth = DESIGN_W;
    cam.viewportHeight = DESIGN_H;
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.context.gl.viewport(0, 0, w, h);
  }

  render(dt: number) {
    const gl = this.context.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const a of this.actors) a.update(dt);
    this.scene.begin();
    for (const a of this.actors) this.scene.drawSkeleton(a.skeleton, false);
    this.scene.end();
  }
}
