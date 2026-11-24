import { h, type FunctionComponent } from 'preact';
import { services } from '../services';
import { ui } from '../store';
import { t } from '../strings';
import { PaperButton } from './PaperButton';
import { MainMenu } from './MainMenu';
import { NewGameWizard } from './NewGameWizard';
import { WorldMapHud } from '../../scenes/world/WorldMapHud';

function RegionHud() {
  return h('div', { class: 'region-hud passthrough' },
    h(PaperButton, { small: true, onClick: () => void services.scenes.goto('worldMap', undefined, { style: 'rise' }) }, t('map.back')),
    h(PaperButton, { small: true, onClick: () => void services.scenes.goto('combat', {}, { style: 'tear' }) }, '遭遇战'),
  );
}

/** #panels 根：按 ui.screen 切换屏幕 DOM。 */
export const Panels: FunctionComponent = () => {
  const s = ui.screen.value;
  if (ui.transition.value) return null;
  if (s === 'mainMenu') return h(MainMenu, {});
  if (s === 'newGame') return h(NewGameWizard, {});
  if (s === 'worldMap') return h(WorldMapHud, {});
  if (s === 'region') return h(RegionHud, {});
  return null;
}
