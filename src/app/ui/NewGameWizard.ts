import { h } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { services } from '../services';
import { t } from '../strings';
import { PaperButton } from './PaperButton';
import { PortraitSlot } from './PortraitSlot';

/** newgame.schema.json：字段由内容包驱动，界面不写死。 */
export type FieldSpec =
  | { id: string; type: 'text'; labelKey: string; default?: string; maxLength?: number }
  | { id: string; type: 'radio' | 'select'; labelKey: string; options: Array<{ value: string; labelKey: string; artKey?: string }>; default?: string }
  | { id: string; type: 'slider'; labelKey: string; min: number; max: number; step?: number; default?: number }
  | { id: string; type: 'points'; labelKey: string; budget: number; min: number; max: number; keys: Array<{ id: string; labelKey: string }> };
export interface NewGameSchema { steps: { char: FieldSpec[]; world: FieldSpec[] }; portrait?: { bodyArtKey: string; overlayFrom?: string[] } }
export type NewGameParams = Record<string, unknown>;

export const DEFAULT_SCHEMA: NewGameSchema = {
  steps: {
    char: [
      { id: 'surname', type: 'text', labelKey: 'field.surname', default: '太吾', maxLength: 2 },
      { id: 'given', type: 'text', labelKey: 'field.given', default: '', maxLength: 2 },
      { id: 'gender', type: 'radio', labelKey: 'field.gender', options: [{ value: 'm', labelKey: 'gender.m' }, { value: 'f', labelKey: 'gender.f' }], default: 'm' },
      { id: 'look', type: 'radio', labelKey: 'field.look', options: [{ value: 'a', labelKey: 'look.a', artKey: 'char.overlay.cloth' }, { value: 'b', labelKey: 'look.b', artKey: 'char.overlay.sword' }], default: 'a' },
      { id: 'age', type: 'slider', labelKey: 'field.age', min: 16, max: 40, default: 16 },
      { id: 'attrs', type: 'points', labelKey: 'field.attrs', budget: 10, min: 0, max: 5,
        keys: [{ id: 'str', labelKey: 'attr.str' }, { id: 'agi', labelKey: 'attr.agi' }, { id: 'int', labelKey: 'attr.int' }, { id: 'con', labelKey: 'attr.con' }] },
    ],
    world: [
      { id: 'difficulty', type: 'select', labelKey: 'field.difficulty', options: [{ value: 'easy', labelKey: 'diff.easy' }, { value: 'normal', labelKey: 'diff.normal' }, { value: 'hard', labelKey: 'diff.hard' }], default: 'normal' },
      { id: 'worldSize', type: 'select', labelKey: 'field.worldSize', options: [{ value: 'small', labelKey: 'size.small' }, { value: 'medium', labelKey: 'size.medium' }, { value: 'large', labelKey: 'size.large' }], default: 'medium' },
    ],
  },
  portrait: { bodyArtKey: 'char.body.default', overlayFrom: ['look'] },
};

export function defaultsOf(fields: FieldSpec[]): NewGameParams {
  const o: NewGameParams = {};
  for (const f of fields) {
    if (f.type === 'points') o[f.id] = Object.fromEntries(f.keys.map((k) => [k.id, f.min]));
    else if (f.type === 'slider') o[f.id] = f.default ?? f.min;
    else if (f.type === 'text') o[f.id] = f.default ?? '';
    else o[f.id] = f.default ?? f.options[0]?.value;
  }
  return o;
}

/** core 侧 StartNewGame 不在本工单：打印参数的桩。 */
function dispatchStartNewGame(params: NewGameParams): void { console.info('[stub] StartNewGame', params); }

function Field(p: { f: FieldSpec; value: unknown; set: (v: unknown) => void }) {
  const { f, value, set } = p;
  let ctl;
  switch (f.type) {
    case 'text':
      ctl = h('input', { type: 'text', value: value as string, maxLength: f.maxLength, onInput: (e: Event) => set((e.target as HTMLInputElement).value) });
      break;
    case 'radio':
      ctl = h('div', { class: 'radios' }, f.options.map((o) =>
        h('button', { key: o.value, class: value === o.value ? 'on' : '', onClick: () => set(o.value) }, t(o.labelKey))));
      break;
    case 'select':
      ctl = h('select', { value: value as string, onChange: (e: Event) => set((e.target as HTMLSelectElement).value) },
        f.options.map((o) => h('option', { key: o.value, value: o.value }, t(o.labelKey))));
      break;
    case 'slider':
      ctl = h('div', { class: 'row' },
        h('input', { type: 'range', min: f.min, max: f.max, step: f.step ?? 1, value: value as number, style: { flex: 1 },
          onInput: (e: Event) => set(Number((e.target as HTMLInputElement).value)) }),
        h('span', null, String(value)));
      break;
    case 'points': {
      const v = value as Record<string, number>;
      const used = Object.values(v).reduce((a, b) => a + b, 0), left = f.budget - used;
      const add = (k: string, d: number) => {
        const n = v[k] + d;
        if (n < f.min || n > f.max || (d > 0 && left <= 0)) return;
        set({ ...v, [k]: n });
      };
      ctl = h('div', { class: 'points' },
        h('div', null, `${t('points.left')}：${left}`),
        f.keys.map((k) => h('div', { key: k.id, class: 'pt' },
          h('span', null, t(k.labelKey)),
          h('button', { onClick: () => add(k.id, -1) }, '−'), h('span', { style: { textAlign: 'center' } }, String(v[k.id])),
          h('button', { onClick: () => add(k.id, 1) }, '+'))));
      break;
    }
  }
  return h('div', { class: 'field' }, h('label', null, t(f.labelKey)), ctl);
}

const STEP_KEYS = ['wizard.step.char', 'wizard.step.birth', 'wizard.step.world'];

export function NewGameWizard() {
  const [schema, setSchema] = useState<NewGameSchema>(DEFAULT_SCHEMA);
  useEffect(() => {
    void services.assets.loadJson<NewGameSchema>(`${import.meta.env.BASE_URL}content/newgame.schema.json`).then((s) => { if (s?.steps) setSchema(s); });
  }, []);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<NewGameParams>(() => ({ ...defaultsOf(DEFAULT_SCHEMA.steps.char), ...defaultsOf(DEFAULT_SCHEMA.steps.world), birth: null }));
  useEffect(() => { setValues((v) => ({ ...defaultsOf(schema.steps.char), ...defaultsOf(schema.steps.world), ...v })); }, [schema]);
  const set = (id: string) => (x: unknown) => setValues((v) => ({ ...v, [id]: x }));

  // 实时预览：overlayFrom 指定的字段若选项带 artKey，则挂到纸偶上
  const overlays = useMemo(() => {
    const out: string[] = [];
    for (const fid of schema.portrait?.overlayFrom ?? []) {
      const f = [...schema.steps.char, ...schema.steps.world].find((x) => x.id === fid);
      if (f && (f.type === 'radio' || f.type === 'select')) {
        const o = f.options.find((o) => o.value === values[fid]); if (o?.artKey) out.push(o.artKey);
      }
    }
    return out;
  }, [schema, values]);
  const subject = { bodyArtKey: schema.portrait?.bodyArtKey ?? 'char.body.default', overlayArtKeys: overlays, pose: String(values.gender ?? '') };

  const fields = step === 0 ? schema.steps.char : step === 2 ? schema.steps.world : [];
  const finish = () => { dispatchStartNewGame(values); void services.scenes.goto('worldMap'); };

  return h('div', { class: 'wizard passthrough' },
    h('div', { class: 'stage passthrough' }, step === 0 ? h(PortraitSlot, { subject }) : null),
    h('div', { class: 'form paper paper-cut' },
      h('div', { class: 'steps' }, STEP_KEYS.map((k, i) => h('span', { key: k, class: i === step ? 'on' : '' }, `${i + 1}. ${t(k)}`))),
      step === 1
        ? h('div', { class: 'placeholder' }, t('wizard.birth.placeholder'))
        : fields.map((f) => h(Field, { key: f.id, f, value: values[f.id], set: set(f.id) })),
      h('div', { class: 'nav' },
        h(PaperButton, { small: true, onClick: () => (step === 0 ? services.scenes.retarget('mainMenu') : setStep(step - 1)) }, step === 0 ? t('common.back') : t('common.prev')),
        step < 2 ? h(PaperButton, { small: true, onClick: () => setStep(step + 1) }, t('common.next')) : h(PaperButton, { small: true, onClick: finish }, t('common.finish')))));
}
