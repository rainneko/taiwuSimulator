import { spine } from '../spine-webgl-3.8';

export interface SpineAssets {
  skeletonData: spine.SkeletonData;
  atlas: spine.TextureAtlas;
}

/** 原版 Spine 数据所在目录（dev 服务器下项目根即站点根）。 */
export const SPINE_BASE = `${import.meta.env.BASE_URL}assets/spine/`;

/**
 * 加载原版骨骼。atlas 文件的 `size: 4096,4096` 原样保留（严禁改成 2048）。
 *
 * 注意：spine-ts 3.8 的 TextureAtlas 在加载贴图后会用 **png 的真实像素** 覆盖 page.width/height
 * （`page.width = texture.getImage().width`），于是 UV = x/2048 会超过 1、部件全部错位/不可见。
 * 这里在读骨骼 JSON 之前，按 atlas 声明的 size 把每个 region 的 UV 重新归一化回 4096 空间。
 */
export function fixAtlasDeclaredSize(atlas: spine.TextureAtlas, atlasText: string): void {
  // 依次取每页的 size 行（页名行之后紧跟 size:）
  const sizes = [...atlasText.matchAll(/^size:\s*(\d+)\s*,\s*(\d+)/gm)].map((m) => [+m[1], +m[2]]);
  atlas.pages.forEach((page, i) => {
    const decl = sizes[i];
    if (!decl || (decl[0] === page.width && decl[1] === page.height)) return;
    const sx = page.width / decl[0], sy = page.height / decl[1];
    // MeshAttachment.updateUVs 也直接用 texture.getImage().width 换算 offset/original 尺寸，
    // 给 region 换一个原型委托的贴图壳：绑定/绘制仍走原 GLTexture，只把 getImage() 的尺寸报成声明值。
    const orig = page.texture;
    const declImg = { width: decl[0], height: decl[1] };
    const shell = Object.create(orig, { getImage: { value: () => declImg } }) as spine.Texture;
    for (const r of atlas.regions) {
      if (r.page !== page) continue;
      r.u *= sx; r.u2 *= sx; r.v *= sy; r.v2 *= sy;
      r.texture = shell;
    }
    page.width = decl[0];
    page.height = decl[1];
  });
}

export function loadSpineData(
  context: spine.webgl.ManagedWebGLRenderingContext,
  scale = 1,
  base = SPINE_BASE,
): Promise<SpineAssets> {
  const am = new spine.webgl.AssetManager(context, base);
  am.loadTextureAtlas('skeleton.atlas');
  am.loadText('skeleton.json');
  // 再取一份 atlas 原文读声明的 size（AssetManager 不暴露原文；加查询串避免与图集资源同键）
  am.loadText('skeleton.atlas?declared', undefined, undefined);
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (am.hasErrors()) return reject(new Error('Spine 资源加载失败: ' + JSON.stringify(am.getErrors())));
      if (!am.isLoadingComplete()) return void requestAnimationFrame(poll);
      const atlas = am.get('skeleton.atlas') as spine.TextureAtlas;
      fixAtlasDeclaredSize(atlas, am.get('skeleton.atlas?declared') as string);
      const json = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
      json.scale = scale;
      const skeletonData = json.readSkeletonData(am.get('skeleton.json') as string);
      resolve({ skeletonData, atlas });
    };
    poll();
  });
}
