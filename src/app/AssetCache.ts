import { Texture, TextureLoader } from 'three';

/** 最小资源缓存：按 artKey → URL 加载贴图；缺失返回 null（调用方用占位）。上下文恢复后 rebuild 重新上传。 */
export class AssetCache {
  private textures = new Map<string, Texture | null>();
  private json = new Map<string, unknown>();
  private loader = new TextureLoader();
  constructor(private resolve: (artKey: string) => string | null = () => null) {}

  async texture(key: string, signal?: AbortSignal): Promise<Texture | null> {
    if (this.textures.has(key)) return this.textures.get(key)!;
    const url = this.resolve(key);
    let tex: Texture | null = null;
    if (url) {
      try { tex = await this.loader.loadAsync(url); } catch { tex = null; }
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    this.textures.set(key, tex);
    return tex;
  }
  peekTexture(key: string): Texture | null { return this.textures.get(key) ?? null; }

  async loadJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
    if (this.json.has(url)) return this.json.get(url) as T;
    let v: T | null = null;
    try { const r = await fetch(url, { signal }); if (r.ok) v = await r.json() as T; } catch (e) { if (signal?.aborted) throw e; }
    this.json.set(url, v);
    return v;
  }

  rebuild(): void { for (const t of this.textures.values()) if (t) t.needsUpdate = true; }
  dispose(): void { for (const t of this.textures.values()) t?.dispose(); this.textures.clear(); }
}
