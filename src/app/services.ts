import type { AssetCache } from './AssetCache';
import type { InputRouter } from './InputRouter';
import type { LabelProjector } from './LabelProjector';
import type { PortraitStage } from './PortraitStage';
import type { SceneManager } from './SceneManager';

/** 启动时填充的单例服务（组件通过它拿 SceneManager 等）。 */
export const services = {} as {
  scenes: SceneManager; portraits: PortraitStage; labels: LabelProjector; input: InputRouter; assets: AssetCache;
  manifest: { name: string; version: string };
};
