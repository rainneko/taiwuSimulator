import { h, type FunctionComponent } from 'preact';
import { ui } from '../store';
import { MainMenu } from './MainMenu';
import { NewGameWizard } from './NewGameWizard';

/** #panels 根：按 ui.screen 切换屏幕 DOM。 */
export const Panels: FunctionComponent = () => {
  const s = ui.screen.value;
  if (ui.transition.value) return null;
  if (s === 'mainMenu') return h(MainMenu, {});
  if (s === 'newGame') return h(NewGameWizard, {});
  return null;
}
