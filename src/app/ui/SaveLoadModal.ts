import { h } from 'preact';
import { useState } from 'preact/hooks';
import { services } from '../services';
import type { SaveMeta } from '../SaveManager';
import { popModal, ui } from '../store';
import { t } from '../strings';
import { PaperButton } from './PaperButton';

/** 判断当前是否处于游戏中（有活跃的角色和世界数据）。 */
function isInGame(): boolean {
  return !!services.player && !!services.world;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

function slotLabel(slotId: string): string {
  if (slotId === 'auto') return t('save.slotAuto');
  const n = slotId.replace('slot', '');
  return `${t('save.slot')} ${n}`;
}

export function SaveLoadModal() {
  const sm = services.saveManager;
  // 用 counter 触发重渲染
  const [rev, setRev] = useState(0);
  const refresh = () => setRev((r) => r + 1);

  const metas = sm.list();
  const metaMap = new Map<string, SaveMeta>();
  for (const m of metas) metaMap.set(m.slotId, m);

  const inGame = isInGame();
  const slots = sm.allSlots;

  const handleSave = (slotId: string) => {
    if (!inGame) return;
    sm.save(slotId);
    refresh();
  };

  const handleLoad = (slotId: string) => {
    if (!sm.load(slotId)) return;
    popModal();
    void services.scenes.goto('worldMap');
  };

  const handleDelete = (slotId: string) => {
    sm.delete(slotId);
    refresh();
  };

  return h('div', { class: 'save-load-list' },
    slots.map((slotId) => {
      const meta = metaMap.get(slotId);
      const isAuto = slotId === 'auto';
      return h('div', { key: `${slotId}-${rev}`, class: 'save-slot row' },
        h('div', { class: 'save-slot-info', style: { flex: 1 } },
          h('strong', null, slotLabel(slotId)),
          meta
            ? h('span', { class: 'save-slot-meta' },
                ` — ${meta.playerName} | ${meta.worldTime} | ${formatDate(meta.date)}`)
            : h('span', { class: 'save-slot-empty' }, ` — ${t('save.empty')}`)),
        h('div', { class: 'save-slot-actions' },
          // 自动槽不允许手动保存
          !isAuto && inGame
            ? h(PaperButton, { small: true, onClick: () => handleSave(slotId) }, t('save.save'))
            : null,
          meta
            ? h(PaperButton, { small: true, onClick: () => handleLoad(slotId) }, t('save.load'))
            : null,
          meta && !isAuto
            ? h(PaperButton, { small: true, onClick: () => handleDelete(slotId) }, t('save.delete'))
            : null,
        ),
      );
    }),
  );
}
