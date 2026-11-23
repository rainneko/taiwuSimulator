import {
  Color, DoubleSide, Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial,
  BufferGeometry, Float32BufferAttribute, RepeatWrapping, Texture, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { getFibreTexture } from '../render/paper';

export type TransitionStyle = 'fold' | 'dive' | 'rise' | 'tear';
export type PassStyle = TransitionStyle | 'cross';

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const MIX_FRAG = /* glsl */`
uniform sampler2D tA, tB, tNoise;
uniform float uP;
uniform int uStyle;
uniform vec2 uOrigin;
uniform float uAspect, uFar;
uniform vec3 uCore;   // 线性空间
varying vec2 vUv;
void main() {
  vec4 a = texture2D( tA, vUv ), b = texture2D( tB, vUv );
  if ( uStyle == 0 ) { gl_FragColor = mix( a, b, smoothstep( 0.0, 1.0, uP ) );
    #include <colorspace_fragment>
    return; }
  vec2 d = ( vUv - uOrigin ) * vec2( uAspect, 1.0 );
  float n = texture2D( tNoise, vUv * vec2( uAspect, 1.0 ) * 1.7 ).g;
  float m = length( d ) / uFar + ( n - 0.5 ) * 0.3;
  float edge = uP * 1.35 - 0.15;
  float core = smoothstep( edge - 0.02, edge, m ) * ( 1.0 - smoothstep( edge, edge + 0.004, m ) );
  float dark = smoothstep( edge, edge + 0.01, m ) * ( 1.0 - smoothstep( edge + 0.01, edge + 0.03, m ) );
  vec3 c = m < edge ? b.rgb : a.rgb * ( 1.0 - 0.25 * dark );
  gl_FragColor = vec4( mix( c, uCore, core ), 1.0 );
  #include <colorspace_fragment>
}`;

/** 折页背后的新画面：压暗 + 折线旁投影。 */
const BACK_FRAG = /* glsl */`
uniform sampler2D tB;
uniform float uP, uFoldX;
uniform int uHasB;
varying vec2 vUv;
void main() {
  vec3 b = uHasB == 1 ? texture2D( tB, vUv ).rgb : vec3( 0.12, 0.1, 0.08 );
  float k = 1.0 - uP;
  b *= 1.0 - 0.35 * k;
  b -= 0.3 * k * ( 1.0 - smoothstep( 0.0, 0.12, vUv.x - uFoldX ) );
  gl_FragColor = vec4( max( b, 0.0 ), 1.0 );
  #include <colorspace_fragment>
}`;

const PAGE_VERT = /* glsl */`
uniform float uW, uCurl, uPhi;
varying vec2 vUv;
varying float vShade;
void main() {
  vUv = uv;
  float s = position.x / uW;                    // 0 左缘 … 1 右缘
  // 卷曲：沿 x 累积弯曲角 a(s) = curl·s²，以弧长参数化积分得到位置（数值近似：解析积分简化为小角）
  float a = uCurl * s * s;
  float x = position.x * cos( a * 0.6667 );
  float z = -position.x * sin( a * 0.6667 );
  // 绕左缘竖轴转 φ，朝屏幕内（-z）
  float c = cos( uPhi ), sn = sin( uPhi );
  vec3 p = vec3( x * c + z * sn, position.y, -x * sn + z * c );
  vShade = 0.55 + 0.45 * cos( uPhi + a );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}`;
const PAGE_FRAG = /* glsl */`
uniform sampler2D tA;
varying vec2 vUv;
varying float vShade;
void main() {
  gl_FragColor = vec4( texture2D( tA, vUv ).rgb * vShade, 1.0 );
  #include <colorspace_fragment>
}`;

function fullscreenTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DEG = Math.PI / 180;

/** 四种纸幕转场 + 交叉淡化，单类管理。 */
export class TransitionPass {
  private style: PassStyle = 'cross';
  private rtA: WebGLRenderTarget | null = null;
  private origin = new Vector2(0.5, 0.5);
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mixScene = new Scene();
  private readonly mixMat: ShaderMaterial;
  private readonly foldScene = new Scene();
  private readonly foldCam = new PerspectiveCamera(30, 1, 0.1, 1000);
  private readonly backMat: ShaderMaterial;
  private readonly pageMat: ShaderMaterial;
  private readonly page: Mesh;
  private pageAspect = 0;
  private readonly blank: Texture;

  constructor() {
    const noise = getFibreTexture();
    noise.wrapS = noise.wrapT = RepeatWrapping;
    this.blank = new Texture();
    this.mixMat = new ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: MIX_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tA: { value: null }, tB: { value: null }, tNoise: { value: noise }, uP: { value: 0 }, uStyle: { value: 0 },
        uOrigin: { value: this.origin }, uAspect: { value: 1 }, uFar: { value: 1 }, uCore: { value: new Color(0xf4ecda) },
      },
    });
    const tri = new Mesh(fullscreenTriangle(), this.mixMat); tri.frustumCulled = false;
    this.mixScene.add(tri);

    this.backMat = new ShaderMaterial({
      vertexShader: FS_VERT, fragmentShader: BACK_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tB: { value: null }, uP: { value: 0 }, uFoldX: { value: 0 }, uHasB: { value: 0 } },
    });
    const back = new Mesh(fullscreenTriangle(), this.backMat); back.frustumCulled = false; back.renderOrder = 0;
    this.pageMat = new ShaderMaterial({
      vertexShader: PAGE_VERT, fragmentShader: PAGE_FRAG, depthTest: false, depthWrite: false, side: DoubleSide,
      uniforms: { tA: { value: null }, uW: { value: 1 }, uCurl: { value: 0 }, uPhi: { value: 0 } },
    });
    this.page = new Mesh(new PlaneGeometry(1, 1), this.pageMat); this.page.frustumCulled = false; this.page.renderOrder = 1;
    // 背景三角形用自己的正交投影：放进 fold 场景但着色器忽略相机矩阵
    this.foldScene.add(back, this.page);
  }

  begin(style: PassStyle, rtA: WebGLRenderTarget, opts: { origin?: [number, number] } = {}): void {
    this.style = style; this.rtA = rtA;
    const o = opts.origin ?? [0, 0];
    this.origin.set(o[0] * 0.5 + 0.5, o[1] * 0.5 + 0.5);
  }
  /** 半程时更换旧画面（dive / rise 在前半程末重新定格）。 */
  setA(rtA: WebGLRenderTarget): void { this.rtA = rtA; }

  /** progress ∈ [0,1]；输出到 target（null = 屏幕）。 */
  render(r: WebGLRenderer, rtB: WebGLRenderTarget | null, progress: number, target: WebGLRenderTarget | null = null): void {
    if (!this.rtA) return;
    const size = r.getDrawingBufferSize(new Vector2());
    const aspect = size.x / Math.max(1, size.y);
    const prevAuto = r.autoClear;
    r.setRenderTarget(target);
    r.autoClear = true;
    if (this.style === 'fold') this.renderFold(r, rtB, progress, aspect);
    else {
      const p2 = progress <= 0.5 ? 0 : (progress - 0.5) * 2;
      const u = this.mixMat.uniforms;
      u.tA.value = this.rtA.texture; u.tB.value = rtB?.texture ?? this.rtA.texture;
      u.uP.value = rtB ? p2 : 0;
      u.uStyle.value = this.style === 'tear' ? 1 : 0;
      u.uAspect.value = aspect;
      // 最远角距离（aspect 修正后）
      const ox = this.origin.x, oy = this.origin.y;
      u.uFar.value = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => Math.hypot((x - ox) * aspect, y - oy)));
      r.render(this.mixScene, this.ortho);
    }
    r.autoClear = prevAuto;
  }

  private renderFold(r: WebGLRenderer, rtB: WebGLRenderTarget | null, progress: number, aspect: number): void {
    const H = 2, W = H * aspect;
    if (this.pageAspect !== aspect) {
      this.pageAspect = aspect;
      this.page.geometry.dispose();
      const g = new PlaneGeometry(W, H, 24, 1); g.translate(W / 2, 0, 0);  // 左缘在原点
      this.page.geometry = g;
      this.page.position.set(-W / 2, 0, 0);
      this.foldCam.aspect = aspect;
      this.foldCam.position.set(0, 0, (H / 2) / Math.tan(15 * DEG));
      this.foldCam.lookAt(0, 0, 0);
      this.foldCam.updateProjectionMatrix();
    }
    let phi: number, curl: number, p2: number;
    if (progress <= 0.5) { const t = easeInOutCubic(progress * 2); phi = 8 * DEG * t; curl = 0.14 * t; p2 = 0; }
    else { p2 = (progress - 0.5) * 2; phi = (8 + 80 * easeInOutCubic(p2)) * DEG; curl = 0.14; }
    const pu = this.pageMat.uniforms;
    pu.tA.value = this.rtA!.texture; pu.uW.value = W; pu.uCurl.value = curl; pu.uPhi.value = phi;
    // 折线（右缘）在屏幕上的 x：投影右缘点
    const edge = new Vector3(W * Math.cos(phi), 0, -W * Math.sin(phi)).add(this.page.position).project(this.foldCam);
    const bu = this.backMat.uniforms;
    bu.tB.value = rtB?.texture ?? this.blank; bu.uHasB.value = rtB ? 1 : 0; bu.uP.value = p2;
    bu.uFoldX.value = edge.x * 0.5 + 0.5;
    r.render(this.foldScene, this.foldCam);
  }

  end(): void { this.rtA = null; }
  dispose(): void {
    this.mixMat.dispose(); this.backMat.dispose(); this.pageMat.dispose(); this.page.geometry.dispose();
  }
}
