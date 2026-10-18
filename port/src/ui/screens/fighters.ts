import {
  SELECTABLE_CHARACTER_SPECS, buildCharacterPortraitGrid, buildSlotPaletteSwatches, canConfirmMatch,
} from '../../../../src/scenes/characterSelect';
import {
  addCpuToNextEmptySlot, buildPlayerSlotsFromHandCursor, cycleSlotAiDifficulty, joinNextEmptySlot,
  keyboardInputTypeForSlot, selectAtCursor, setHandPosition, setHoveredTarget, setSlotInputType, setSlotMode, setSlotPalette,
  toCharacterSelectState, unselectSlot, HOVERED_TARGET_NONE, type HandCursorState, type HoveredTarget,
} from '../../../../src/scenes/handCursorState';
import { InputProfileStore } from '../../../../src/input/InputProfileStore';
import { applyControlsProfilesToRoster } from '../../../../src/scenes/controlsProfileHandoff';
import type { HandCursorSlotState } from '../../../../src/scenes/handCursorState';
import type { ParticipantInputDevice, PlayerSlot } from '../../../../src/types';
import type { DeviceId } from '../shell/input';
import { css, el, header, hints } from '../shell/dom';
import type { App, FlowData, Screen } from '../shell/app';
import { paintFighterArt } from '../assets/fighterArt';
import { fighterShortName } from '../model/fighterNames';
import { CPU_COLOUR, slotColour } from '../shell/players';
import { restoreSelectionHand, restoreSelectionOwners, type SelectionOwner } from '../model/selectionDevices';
import { createMatchControlsOverlay, type MatchControlsOverlay } from '../components/matchControlsOverlay';
import { FighterArtHold } from '../../fighters/artHold';
import { frameDeltaMs } from '../../engine/frameDelta';

type SlotIndex = 1 | 2 | 3 | 4;
const SLOTS: readonly SlotIndex[] = [1, 2, 3, 4];
const STICK_SPEED_PX_S = 900;
const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' } as const;
const INPUT_LABEL: Record<string, string> = { keyboard_p1: 'Keyboard (WASD)', keyboard_p2: 'Keyboard (arrows)', gamepad: 'Gamepad' };

/**
 * Character select (CharacterSelectScene) on the game's hand-cursor model:
 * each human player moves a hand over portraits and card tiles; the model
 * (`handCursorState.ts`) decides what a press does. Hover targets are found
 * by hit-testing the DOM under each hand.
 */
/** The device a human slot plays with, for profile lookup (pads by the device that claimed the slot). */
function slotDevice(slot: HandCursorSlotState, padIndex: number | undefined): Exclude<ParticipantInputDevice, { kind: 'ai' }> {
  if (slot.inputType === 'gamepad') return { kind: 'gamepad', gamepadIndex: padIndex ?? -1 };
  return { kind: 'keyboard', layout: slot.inputType === 'keyboard_p2' ? 'keyboard_p2' : 'keyboard_p1' };
}

export function fightersScreen(app: App, data: FlowData = {}): Screen {
  app.backdrop({ stage: 'lava' });
  let profiles = new InputProfileStore();
  let hand: HandCursorState = restoreSelectionHand(data.hand, data.pending?.players);
  /** Which slot each device drives. The keyboard (and mouse) drive one slot at a time. */
  const restored = restoreSelectionOwners(hand, data.pending?.players, data.selectionOwners, app.input.pads());
  const owners = new Map<DeviceId, SlotIndex>(restored.map(owner => [owner.device, owner.slot]));
  const padIds = new Map(restored.filter(owner => owner.padId).map(owner => [owner.device, owner.padId!]));
  let controls: MatchControlsOverlay | null = null;
  const status = el('p.status', { role: 'status' });
  /** The picked fighters' art loads in the background while players choose. */
  const pickedArt = new FighterArtHold();

  // ---------- roster ----------
  const portraits = SELECTABLE_CHARACTER_SPECS.map((spec, i) => {
    const art = el('span.art');
    paintFighterArt(art, spec.id);
    const marks = el('span.marks');
    const node = el('button.portrait', { type: 'button', 'data-target': `portrait:${i}`, 'aria-label': spec.displayName },
      art, marks, el('span.name', {}, fighterShortName(spec.id)));
    return { node, marks };
  });

  // ---------- player cards ----------
  const cards = SLOTS.map((s) => {
    const modeBtn = el('button.mode-btn', { type: 'button', 'data-target': `mode:${s}` });
    const art = el('span.art');
    const name = el('span.fighter-name');
    const input = el('span');
    const swatches = el('span.swatches', { role: 'group', 'aria-label': `P${s} colours` });
    const difficulty = el('button.mode-btn', { type: 'button', hidden: true, 'data-target': `difficulty:${s}` });
    const profile = el('button.mode-btn', { type: 'button', hidden: true, title: 'Choose a saved controls profile', 'data-target': `profile:${s}` });
    const editControls = el('button.mode-btn', { type: 'button', hidden: true, 'data-target': `controls:${s}` }, 'Controls');
    const prevFighter = el('button.arrow', { type: 'button', hidden: true, 'data-target': `prev:${s}`, 'aria-label': 'Previous fighter' }, '‹');
    const nextFighter = el('button.arrow', { type: 'button', hidden: true, 'data-target': `next:${s}`, 'aria-label': 'Next fighter' }, '›');
    const node = el('article.card', { 'data-slot': s, style: { '--pc': slotColour(s) } },
      el('div.tag', {}, el('span.pn', {}, `P${s}`), modeBtn),
      art,
      el('div', { style: { alignSelf: 'end', position: 'relative', display: 'flex', alignItems: 'center', gap: '6px' } }, prevFighter, name, nextFighter),
      el('div.meta', {}, el('span.card-controls', {}, input, difficulty, profile, editControls), swatches));
    return { node, modeBtn, art, name, input, swatches, difficulty, profile, editControls, prevFighter, nextFighter, paletteKey: '' };
  });

  const readyBar = el('div.ready-bar', { hidden: true }, 'Ready to fight!', el('span.pad.start', {}, 'Start'), el('kbd', {}, 'Enter'));
  const hands = SLOTS.map((s) => el('div.hand', { hidden: true, 'data-slot': s, 'aria-hidden': 'true' },
    svgHand(slotColour(s)), el('b', {}, `P${s}`)));

  function svgHand(color: string): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 44 44');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M6 4 L38 18 L24 22 L30 38 L22 41 L16 25 L6 34 Z');
    path.setAttribute('fill', color);
    path.setAttribute('stroke', '#0a0714');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }

  // ---------- model helpers ----------
  const bounds = () => ({ minX: 0, maxX: innerWidth, minY: 0, maxY: innerHeight });
  const centre = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  function targetSpecAt(x: number, y: number): string | undefined {
    const hit = document.elementsFromPoint(x, y).find((n) => n instanceof HTMLElement && n.closest('[data-target]'));
    return hit ? (hit as HTMLElement).closest<HTMLElement>('[data-target]')?.dataset.target : undefined;
  }

  function targetAt(x: number, y: number): HoveredTarget {
    const spec = targetSpecAt(x, y);
    const [kind, raw] = spec?.split(':') ?? [];
    const n = Number(raw);
    if (kind === 'portrait') return { kind: 'portrait', portraitIndex: n };
    if (kind === 'mode') return { kind: 'slot-tile-mode', slotIndex: n as SlotIndex };
    if (kind === 'palette') return { kind: 'slot-tile-palette', slotIndex: n as SlotIndex };
    return HOVERED_TARGET_NONE;
  }

  function moveHandTo(s: SlotIndex, x: number, y: number): void {
    hand = setHandPosition(hand, s, { x, y }, bounds());
    const at = hand.slots[s - 1]!.cursor;
    hand = setHoveredTarget(hand, s, targetAt(at.x, at.y));
  }

  /** Snap a hand to the nearest target in a direction (d-pad / arrow keys). */
  function snapHand(s: SlotIndex, action: string): void {
    const from = hand.slots[s - 1]!.cursor;
    const [dx, dy] = action === 'left' ? [-1, 0] : action === 'right' ? [1, 0] : action === 'up' ? [0, -1] : [0, 1];
    let best: { x: number; y: number } | null = null, bestScore = Infinity;
    root.querySelectorAll('[data-target]').forEach((node) => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height || node.matches(':disabled')) return;
      const c = centre(node);
      const along = (c.x - from.x) * dx + (c.y - from.y) * dy;
      if (along <= 8) return;
      const across = Math.abs((c.x - from.x) * dy - (c.y - from.y) * dx);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = c; }
    });
    if (best) moveHandTo(s, (best as { x: number }).x, (best as { y: number }).y);
  }

  function claim(device: DeviceId, s: SlotIndex): void {
    if ([...owners].some(([other, slot]) => slot === s && other !== device)) return;
    owners.set(device, s);
    if (device !== 'keyboard') {
      const pad = app.input.pads().find(pad => `pad${pad.index}` === device);
      if (pad) padIds.set(device, pad.id);
    }
    const at = hand.slots[s - 1]!.cursor;
    if (at.x || at.y) return;
    const first = portraits[0]?.node;
    if (first) { const c = centre(first); moveHandTo(s, c.x, c.y); }
  }

  function join(device: DeviceId): void {
    const waiting = hand.slots.find(slot => slot.mode === 'human'
      && (device === 'keyboard' ? slot.inputType !== 'gamepad' : slot.inputType === 'gamepad')
      && ![...owners.values()].includes(slot.index));
    if (waiting) { claim(device, waiting.index); return; }
    const result = joinNextEmptySlot(hand, device === 'keyboard' ? 'keyboard_p1' : 'gamepad');
    if (result.slotIndex === null) { status.textContent = 'All four player slots are taken.'; return; }
    hand = result.state;
    claim(device, result.slotIndex);
  }

  /** Keyboard digits: drive that card, joining it as a keyboard player if empty. */
  function focusSlot(s: SlotIndex): void {
    const slot = hand.slots[s - 1]!;
    if (slot.inputType === 'gamepad' && slot.mode === 'human') { status.textContent = `P${s} belongs to a gamepad.`; return; }
    if (slot.mode === 'empty') {
      hand = setSlotInputType(hand, s, keyboardInputTypeForSlot(hand, s) ?? 'keyboard_p1');
      hand = setSlotMode(hand, s, 'human');
    }
    if (hand.slots[s - 1]!.mode === 'human') claim('keyboard', s);
  }

  function release(device: DeviceId): void {
    const s = owners.get(device);
    if (!s) return;
    hand = unselectSlot(hand, s);
    owners.delete(device);
    padIds.delete(device);
  }

  const padOf = (s: SlotIndex) => { const d = [...owners].find(([, v]) => v === s)?.[0]; return d && d !== 'keyboard' ? Number(d.slice(3)) : undefined; };
  const profileFor = (s: SlotIndex) => {
    const slot = hand.slots[s - 1]!;
    const device = slotDevice(slot, padOf(s));
    const chosen = slot.bindingProfileId ? profiles.get(slot.bindingProfileId) : undefined;
    return chosen?.deviceKind === device.kind ? chosen : profiles.defaultForDevice(device);
  };
  /** Cycle a human player's saved controls profile (edited on the Controls screen). */
  function cycleProfile(s: SlotIndex): void {
    const slot = hand.slots[s - 1]!;
    if (slot.mode !== 'human') return;
    const options = profiles.list(slotDevice(slot, padOf(s)).kind);
    const current = options.findIndex((p) => p.id === profileFor(s).id);
    const next = options[(current + 1) % options.length];
    if (next) update(applyControlsProfilesToRoster(hand, [{ index: s, bindingProfileId: next.id }]));
  }

  function playerFor(s: SlotIndex): PlayerSlot | undefined {
    return buildPlayerSlotsFromHandCursor(hand).find(player => player.index === s);
  }

  /** Y always opens the owner's controls, even while their hand is on a portrait. */
  function editControls(s: SlotIndex): void {
    const slot = hand.slots[s - 1]!;
    if (slot.mode !== 'human' || controls) return;
    if (slot.inputType === 'gamepad' && padOf(s) === undefined) {
      status.textContent = `Press (A) on a controller to join P${s} before editing its controls.`;
      return;
    }
    const selected = playerFor(s) ?? { index: s, characterId: SELECTABLE_CHARACTER_SPECS[0]!.id,
      paletteIndex: slot.paletteIndex, inputType: slot.inputType, bindingProfileId: slot.bindingProfileId };
    app.input.suspended = true;
    controls = createMatchControlsOverlay([{ ...selected, inputDevice: slotDevice(slot, padOf(s)) }], (players) => {
      controls = null;
      app.input.suspended = false;
      profiles = new InputProfileStore();
      hand = applyControlsProfilesToRoster(hand, players.filter(player => player.bindingProfileId)
        .map(player => ({ index: player.index, bindingProfileId: player.bindingProfileId! })));
      render();
    }, { title: `P${s} · Fighter settings`, backLabel: 'Back to fighters',
      sharedProfileIds: hand.slots.filter(other => other.mode === 'human' && other.index !== s)
        .flatMap(other => other.bindingProfileId ? [other.bindingProfileId] : []) });
    root.append(controls.node);
  }

  function activate(s: SlotIndex, spec?: string): void {
    const at = hand.slots[s - 1]!.cursor;
    hand = setHoveredTarget(hand, s, targetAt(at.x, at.y));
    const [kind, raw, palette] = (spec ?? targetSpecAt(at.x, at.y))?.split(':') ?? [];
    const target = Number(raw) as SlotIndex;
    if (kind === 'palette' && palette !== undefined) hand = setSlotPalette(hand, target, Number(palette));
    else if (kind === 'profile') cycleProfile(target);
    else if (kind === 'controls') editControls(target);
    else if (kind === 'difficulty') hand = cycleSlotAiDifficulty(hand, target);
    else if (kind === 'prev' || kind === 'next') cycleBotFighter(target, kind === 'prev' ? -1 : 1);
    else hand = selectAtCursor(hand, s);
  }

  /** CPU fighters have no hand: hover a portrait on their behalf and select it. */
  function cycleBotFighter(s: SlotIndex, d: number): void {
    const slot = hand.slots[s - 1]!;
    if (slot.mode !== 'bot') return;
    const n = SELECTABLE_CHARACTER_SPECS.length;
    const current = Math.max(0, SELECTABLE_CHARACTER_SPECS.findIndex((c) => c.id === slot.pickedCharacterId));
    const keep = slot.hovered;
    hand = setHoveredTarget(hand, s, { kind: 'portrait', portraitIndex: (current + d + n) % n });
    hand = setHoveredTarget(selectAtCursor(hand, s), s, keep);
    render();
  }

  function update(next: HandCursorState): void {
    hand = next;
    for (const [device, s] of owners) {
      if (hand.slots[s - 1]!.mode !== 'human') { owners.delete(device); padIds.delete(device); }
    }
    render();
  }

  function confirmMatch(): void {
    const projected = toCharacterSelectState(hand);
    if (!canConfirmMatch(projected)) { status.textContent = 'Every player needs a fighter and their own colour.'; return; }
    const pads = new Map([...owners].filter(([d]) => d !== 'keyboard').map(([d, s]) => [s, Number(d.slice(3))]));
    const players: PlayerSlot[] = buildPlayerSlotsFromHandCursor(hand).map((slot) => ({
      ...slot,
      participantId: `player-${slot.index}`,
      inputDevice: slot.inputType === 'ai' ? { kind: 'ai' as const }
        : slot.inputType === 'gamepad' ? { kind: 'gamepad' as const, gamepadIndex: pads.get(slot.index) ?? -1,
          gamepadId: padIds.get([...owners].find(([, index]) => index === slot.index)?.[0] ?? 'keyboard') }
          : { kind: 'keyboard' as const, layout: slot.inputType },
    }));
    if (players.length < 2) { status.textContent = 'A match needs at least two fighters. Press C or (X) to add a CPU.'; return; }
    // Binding profiles are attached when the match launches (step 6).
    const selectionOwners: SelectionOwner[] = [...owners].map(([device, slot]) => ({ device, slot, padId: padIds.get(device) }));
    app.go('stages', { ...data, pending: { ...data.pending, players }, hand, selectionOwners });
  }

  // ---------- rendering ----------
  function render(): void {
    const projected = toCharacterSelectState(hand);
    const grid = buildCharacterPortraitGrid(projected);
    grid.forEach((cell, i) => {
      const p = portraits[i];
      if (!p) return;
      p.node.style.setProperty('--tone', css(cell.primaryColor));
      p.node.classList.toggle('is-hovered', cell.hoveredBySlots.length > 0);
      p.marks.replaceChildren(...cell.selectedBySlots.map((s) => el('span.mark', { style: { background: slotColour(s) } }, `P${s}`)));
    });
    SLOTS.forEach((s, i) => {
      const slot = hand.slots[i]!;
      const card = cards[i]!;
      const empty = slot.mode === 'empty';
      const bot = slot.mode === 'bot';
      card.node.classList.toggle('empty', empty);
      card.node.style.setProperty('--pc', bot ? CPU_COLOUR : slotColour(s));
      card.modeBtn.textContent = empty ? 'Off' : bot ? 'CPU' : 'Player';
      paintFighterArt(card.art, empty ? null : slot.pickedCharacterId, slot.paletteIndex);
      card.name.textContent = empty ? 'Press (A) / Space' : slot.pickedCharacterId ? fighterShortName(slot.pickedCharacterId) : 'Choosing…';
      card.input.textContent = empty ? '' : bot ? 'CPU' : INPUT_LABEL[slot.inputType] ?? slot.inputType;
      card.difficulty.hidden = !bot;
      card.profile.hidden = slot.mode !== 'human';
      card.editControls.hidden = slot.mode !== 'human';
      if (slot.mode === 'human') {
        const canCycle = profiles.list(slotDevice(slot, padOf(s)).kind).length > 1;
        card.profile.toggleAttribute('disabled', !canCycle);
        card.profile.textContent = `${profileFor(s).name}${canCycle ? ' ↻' : ''}`;
      }
      card.difficulty.textContent = bot ? `${DIFFICULTY_LABEL[slot.aiDifficulty ?? 'medium']} ↻` : '';
      card.prevFighter.hidden = card.nextFighter.hidden = !bot;
      const palette = empty ? [] : buildSlotPaletteSwatches(projected.slots[i]!);
      const paletteKey = palette.map(sw => `${sw.index}:${sw.primaryColor}:${sw.displayName}`).join('|');
      // Keep hit targets alive from pointerdown through click and while pads move.
      if (card.paletteKey !== paletteKey) {
        card.paletteKey = paletteKey;
        card.swatches.replaceChildren(...palette.map(sw => el('button.swatch', {
          type: 'button', title: sw.displayName, 'aria-label': `P${s} ${sw.displayName}`,
          'data-target': `palette:${s}:${sw.index}`, style: { background: css(sw.primaryColor) },
        })));
      }
      palette.forEach((sw, n) => {
        const button = card.swatches.children[n] as HTMLButtonElement;
        button.classList.toggle('on', sw.active);
        button.setAttribute('aria-pressed', String(sw.active));
      });
      card.node.dataset.palette = String(slot.paletteIndex);
      const owned = [...owners.values()].includes(s) && slot.mode === 'human';
      const h = hands[i]!;
      h.hidden = !owned || Boolean(controls);
      h.dataset.device = [...owners].find(([, slot]) => slot === s)?.[0] ?? '';
      if (owned) h.style.transform = `translate(${slot.cursor.x}px, ${slot.cursor.y}px)`;
    });
    readyBar.hidden = !canConfirmMatch(projected) || buildPlayerSlotsFromHandCursor(hand).length < 2;
    pickedArt.hold(hand.slots.flatMap(slot => slot.mode !== 'empty' && slot.pickedCharacterId ? [slot.pickedCharacterId] : []));
  }

  // ---------- pointer ----------
  const root = el('section.screen.fighters', {
    onpointermove: (e: PointerEvent) => {
      if (controls) return;
      const s = owners.get('keyboard');
      if (s && hand.slots[s - 1]!.mode === 'human') { moveHandTo(s, e.clientX, e.clientY); render(); }
    },
    onclick: (e: MouseEvent) => {
      if (controls) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-target]');
      if (!target) return;
      // Card settings can be edited with the pointer without joining another player.
      const [kind, raw] = target.dataset.target!.split(':');
      if (kind !== 'portrait' && kind !== 'mode') {
        activate(owners.get('keyboard') ?? Number(raw) as SlotIndex, target.dataset.target);
        update(hand);
        return;
      }
      if (!owners.get('keyboard')) join('keyboard');
      const s = owners.get('keyboard')!;
      moveHandTo(s, e.clientX, e.clientY);
      activate(s, target.dataset.target);
      update(hand);
    },
  },
  header('Versus · Fighters', 'Choose your fighter', 'Join with (A) or Space. Pick a portrait; add CPUs with C or (X).'),
  el('nav.roster', { 'aria-label': 'Fighters' }, ...portraits.map((p) => p.node)),
  el('div', { style: { display: 'grid', gap: '10px', alignSelf: 'end' } }, readyBar, status, el('div.cards', {}, ...cards.map((c) => c.node))),
  hints([['Space', '(A)'], 'join / pick'], [['Esc', '(B)'], 'leave'], [['C', '(X)'], 'add CPU'], [['V', '(Y)'], 'CPU level / edit controls'],
    [['1–4'], 'keyboard card'], [['Enter', '(Start)'], 'fight']),
  ...hands);

  render();
  let last = performance.now();
  return {
    root,
    onAction({ device, action, source }) {
      if (controls) return;
      if (source === 'stick') return;
      status.textContent = '';
      const s = owners.get(device);
      if (action.startsWith('slot')) { focusSlot(Number(action.slice(4)) as SlotIndex); render(); return; }
      if (action === 'x') { const r = addCpuToNextEmptySlot(hand); if (r.slotIndex === null) status.textContent = 'No free slot for a CPU.'; update(r.state); return; }
      if (action === 'start') { if (s || device === 'keyboard') confirmMatch(); else join(device); render(); return; }
      if (!s) {
        if (action === 'confirm') join(device);
        else if (action === 'back') app.go('rules', data);
        render();
        return;
      }
      if (action === 'confirm') activate(s);
      else if (action === 'back') release(device);
      else if (action === 'y') {
        const at = hand.slots[s - 1]!.cursor;
        const node = document.elementsFromPoint(at.x, at.y).find(node => node.closest('.card[data-slot]'));
        const card = Number(node?.closest<HTMLElement>('.card[data-slot]')?.dataset.slot) as SlotIndex;
        // On a CPU card: its level. Else edit this device's human controls.
        if (card && hand.slots[card - 1]!.mode === 'bot') hand = cycleSlotAiDifficulty(hand, card);
        else editControls(s);
      } else snapHand(s, action);
      update(hand);
    },
    onFrame(now) {
      const dt = frameDeltaMs(now, last, 50) / 1000;
      last = now;
      if (controls) { controls.poll(now, app.input.pads()); return; }
      let moved = false;
      for (const [device, s] of owners) {
        const initial = hand.slots[s - 1]!.cursor;
        if (!initial.x && !initial.y) { claim(device, s); moved = true; }
        if (device === 'keyboard') continue;
        const { x, y } = app.input.stick(device);
        if (!x && !y) continue;
        const at = hand.slots[s - 1]!.cursor;
        moveHandTo(s, at.x + x * STICK_SPEED_PX_S * dt, at.y + y * STICK_SPEED_PX_S * dt);
        moved = true;
      }
      if (moved) render();
    },
    leave() { controls?.dispose(); controls = null; app.input.suspended = false; pickedArt.dispose(); },
  };
}
