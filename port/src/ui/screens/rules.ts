import { findAssetEntry } from '../../../../src/assets/manifest';
import { GAME_CONFIG } from '../../../../src/engine/constants';
import { ITEM_CATALOG } from '../../../../src/items/itemCatalog';
import { buildMatchConfigFromState, formatModeLabel, formatQuantityLabel } from '../../../../src/scenes/modeSelect';
import { FLAT_STAGE } from '../../../../src/stages/stageDefinitions';
import { el, header, hints } from '../shell/dom';
import type { App, FlowData, Screen } from '../shell/app';
import {
  cycleItemFrequency, cycleRulesMode, cycleRulesQuantity, isItemEnabled, rulesConfigFields, rulesFromConfig, toggleFinalMeter,
  toggleItem, type MatchRules,
} from '../../../../src/scenes/matchRules';

const FREQUENCY_LABEL = { off: 'Off', low: 'Low', med: 'Medium', high: 'High' } as const;
const itemName = (type: string) => {
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const itemIcon = (entry: (typeof ITEM_CATALOG)[number]): string | undefined => {
  const key = (entry as { visual?: { spriteKey?: string } }).visual?.spriteKey;
  const asset = key ? findAssetEntry(key) : undefined;
  return asset && 'url' in asset ? asset.url : undefined;
};

/** Match rules (ModeSelectScene): stock/time, items, Final Smash, Item Switch. */
export function rulesScreen(app: App, data: FlowData = {}): Screen {
  app.backdrop({ stage: 'flat', mood: 'day' });
  let rules: MatchRules = rulesFromConfig(data.pending);
  let row = 0;
  let itemCursor = 0;
  let navIndex = 1;

  const stepper = (onStep: (d: number) => void) => {
    const value = el('span.value');
    const node = el('div.stepper', {},
      el('button.arrow', { type: 'button', 'aria-label': 'Previous', onclick: (e: Event) => { e.stopPropagation(); onStep(-1); } }, '‹'),
      value,
      el('button.arrow', { type: 'button', 'aria-label': 'Next', onclick: (e: Event) => { e.stopPropagation(); onStep(1); } }, '›'));
    return { node, value };
  };
  const set = (next: MatchRules) => { rules = next; render(); };
  const mode = stepper((d) => set(cycleRulesMode(rules, d)));
  const quantity = stepper((d) => set(cycleRulesQuantity(rules, d)));
  const items = stepper((d) => set(cycleItemFrequency(rules, d)));
  const meter = stepper(() => set(toggleFinalMeter(rules)));
  const chips = ITEM_CATALOG.map((entry, i) => {
    const icon = itemIcon(entry);
    return el('button.item-chip', {
      type: 'button', title: itemName(entry.type),
      onclick: (e: Event) => { e.stopPropagation(); row = 4; itemCursor = i; set(toggleItem(rules, entry.type)); },
    }, icon && el('img', { src: icon, alt: '' }), el('span', {}, itemName(entry.type)));
  });
  const quantityLabel = el('span.label');
  const rows = [
    el('div.rule', {}, el('span.label', {}, 'Match'), mode.node),
    el('div.rule', {}, quantityLabel, quantity.node),
    el('div.rule', {}, el('span.label', {}, 'Items'), items.node),
    el('div.rule', {}, el('span.label', {}, 'Final Smash meter'), meter.node),
    el('div.rule', {}, el('span.label', {}, 'Item Switch'), el('div.switch-grid', {}, ...chips)),
  ];
  rows.forEach((r, i) => r.addEventListener('mouseenter', () => { row = i; render(); }));
  const back = el('button.btn', { type: 'button', onclick: () => cancel() }, 'Back');
  const next = el('button.btn.primary', { type: 'button', onclick: () => confirm() }, 'Choose fighters');
  const navButtons = [back, next];

  function render(): void {
    mode.value.textContent = formatModeLabel(rules.shape.mode);
    quantityLabel.textContent = rules.shape.mode === 'stocks' ? 'Stocks' : 'Time limit';
    quantity.value.textContent = formatQuantityLabel(rules.shape);
    items.value.textContent = FREQUENCY_LABEL[rules.itemFrequency];
    meter.value.textContent = rules.finalRules.meterEnabled ? 'On' : 'Off';
    rows.forEach((r, i) => r.classList.toggle('is-focused', i === row));
    chips.forEach((c, i) => {
      c.classList.toggle('off', !isItemEnabled(rules, ITEM_CATALOG[i]!.type));
      c.classList.toggle('is-cursor', row === 4 && i === itemCursor);
      c.setAttribute('aria-pressed', String(isItemEnabled(rules, ITEM_CATALOG[i]!.type)));
    });
    navButtons.forEach((b, i) => b.classList.toggle('is-focused', row === rows.length && i === navIndex));
  }

  function confirm(): void {
    const pending = {
      ...data.pending,
      ...buildMatchConfigFromState(rules.shape, {
        stageId: data.pending?.stageId ?? FLAT_STAGE.id,
        players: data.pending?.players ?? [],
        rngSeed: data.pending?.rngSeed ?? GAME_CONFIG.defaultRngSeed,
      }),
      ...rulesConfigFields(rules),
    };
    app.go('fighters', { ...data, pending });
  }
  const cancel = () => app.go('title');

  function step(d: number): void {
    if (row === 0) set(cycleRulesMode(rules, d));
    else if (row === 1) set(cycleRulesQuantity(rules, d));
    else if (row === 2) set(cycleItemFrequency(rules, d));
    else if (row === 3) set(toggleFinalMeter(rules));
    else if (row === 4) { itemCursor = (itemCursor + d + chips.length) % chips.length; render(); }
    else { navIndex = (navIndex + d + 2) % 2; render(); }
  }

  render();
  return {
    root: el('section.screen', {},
      header('Versus · Rules', 'Match rules', 'Pick the match shape. Fighters and arena come next.'),
      el('div.body', {}, el('div.rules.panel', {}, ...rows, el('div.rule', {}, el('span'), el('div.nav-row', {}, ...navButtons)))),
      hints([['↑', '↓'], 'rule'], [['←', '→'], 'change'], [['Space', '(A)'], 'toggle item / continue'], [['Enter', '(Start)'], 'fighters'], [['Esc', '(B)'], 'back'])),
    onAction({ action }) {
      if (action === 'up' || action === 'down') { row = (row + (action === 'up' ? -1 : 1) + rows.length + 1) % (rows.length + 1); render(); }
      else if (action === 'left' || action === 'right') step(action === 'left' ? -1 : 1);
      else if (action === 'confirm') {
        if (row === 4) set(toggleItem(rules, ITEM_CATALOG[itemCursor]!.type));
        else if (row === rows.length && navIndex === 0) cancel();
        else confirm();
      } else if (action === 'start') confirm();
      else if (action === 'back') cancel();
    },
  };
}
