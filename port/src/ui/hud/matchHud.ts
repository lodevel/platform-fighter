import { formatTimeLimitLabel } from '../../../../src/scenes/modeSelect';
import { damagePercentColor, formatDamagePercent } from '../../../../src/ui/damageHudFormat';
import type { HudPlayerView, HudView } from '../../../../src/sim/hudView';
import { paintFighterArt } from '../assets/fighterArt';
import { fighterShortName } from '../model/fighterNames';
import { el } from '../shell/dom';
import { CPU_COLOUR, slotColour } from '../shell/players';
import './hud.css';

const MAX_STOCK_ICONS = 5;
/** One heart per life left. */
const HEART = '♥';

/**
 * The in-match HUD in HTML: one plate per fighter along the bottom (portrait,
 * damage % in the game's colour ramp, stocks, Final Smash meter) and the
 * clock in time mode. Draws whatever `HudView` says and keeps no game state.
 */
export class MatchHud {
  readonly root = el('div.hud', { 'aria-live': 'polite' });
  private readonly clock = el('div.hud-clock', { hidden: true });
  private readonly row = el('div.hud-row');
  private readonly plates = new Map<number, ReturnType<typeof plate>>();

  constructor() {
    this.root.append(this.clock, this.row);
  }

  update(view: HudView): void {
    this.clock.hidden = view.secondsLeft === null && !view.suddenDeath;
    this.clock.textContent = view.suddenDeath ? 'SUDDEN DEATH' : formatTimeLimitLabel(view.secondsLeft ?? 0);
    for (const p of view.players) {
      let entry = this.plates.get(p.playerIndex);
      if (!entry) {
        entry = plate(p);
        this.plates.set(p.playerIndex, entry);
        this.row.append(entry.node);
      }
      entry.update(p, view.mode);
    }
  }
}

function plate(initial: HudPlayerView) {
  const art = el('span.hud-art');
  paintFighterArt(art, initial.characterId, initial.paletteIndex);
  const damage = el('span.hud-damage');
  const stocks = el('span.hud-stocks');
  const meter = el('span.hud-meter', { role: 'progressbar', 'aria-label': 'Final Smash meter',
    'aria-valuemin': '0', 'aria-valuemax': '100' }, el('i'));
  const node = el('div.hud-plate', { style: { '--pc': initial.cpu ? CPU_COLOUR : slotColour(initial.slotIndex) } },
    art,
    el('span.hud-tag', {}, `${initial.cpu ? 'CPU' : `P${initial.slotIndex}`} · ${fighterShortName(initial.characterId)}`),
    damage, stocks, meter);
  let lastDamage = initial.damage;
  return {
    node,
    update(p: HudPlayerView, mode: HudView['mode']) {
      node.classList.toggle('out', p.eliminated);
      damage.textContent = formatDamagePercent(p.damage);
      damage.style.color = `#${damagePercentColor(p.damage).toString(16).padStart(6, '0')}`;
      if (p.damage > lastDamage) {
        // Shake on every hit, harder for bigger hits.
        damage.style.setProperty('--kick', `${Math.min(10, 2 + (p.damage - lastDamage) / 3)}px`);
        damage.classList.remove('hit');
        void damage.offsetWidth;
        damage.classList.add('hit');
      }
      lastDamage = p.damage;
      stocks.textContent = mode === 'time' ? `${p.score >= 0 ? '+' : ''}${p.score}`
        : p.stocks > MAX_STOCK_ICONS ? `${HEART}×${p.stocks}` : HEART.repeat(Math.max(0, p.stocks));
      meter.hidden = !p.final?.meterVisible;
      meter.classList.toggle('ready', Boolean(p.final?.ready));
      const fill = Math.round((p.final?.fillRatio ?? 0) * 100);
      meter.setAttribute('aria-valuenow', String(fill));
      meter.setAttribute('aria-label', p.final?.ready ? 'Final Smash ready' : 'Final Smash meter');
      (meter.firstChild as HTMLElement).style.width = `${fill}%`;
    },
  };
}
