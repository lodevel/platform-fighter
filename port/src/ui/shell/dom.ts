/** DOM helpers shared by every screen. */

type Child = Node | string | null | undefined | false;

/** Tiny element builder: `el('button.btn.primary', { onclick }, 'Go')`. */
export function el<K extends keyof HTMLElementTagNameMap = 'div'>(
  spec: string, props: Partial<Record<string, unknown>> = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag = 'div', ...classes] = spec.split('.');
  const node = document.createElement(tag) as HTMLElementTagNameMap[K];
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') (node as unknown as Record<string, unknown>)[key] = value;
    else if (key in node && typeof value !== 'string') (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

/** Screen header: eyebrow, title, subtitle. */
export function header(eyebrow: string, title: string, sub?: string, aside?: Child): HTMLElement {
  return el('header.head', {},
    el('div', {}, el('p.eyebrow', {}, eyebrow), el('h1.title', {}, title), sub && el('p.sub', {}, sub)),
    aside);
}

/**
 * Footer hint bar. Keys are written `Space`, `Esc`, … for the keyboard and
 * `(A)`, `(B)`, `(X)`, `(Y)`, `(Start)` for pad buttons.
 */
export function hints(...items: Array<[keys: string[], label: string]>): HTMLElement {
  return el('footer.hints', {}, ...items.map(([keys, label]) => el('span.hint', {},
    ...keys.map((k) => {
      const pad = /^\((.+)\)$/.exec(k)?.[1];
      return pad ? el(`span.pad.${pad.toLowerCase()}`, {}, pad) : el('kbd', {}, k);
    }), label)));
}

/** Keyboard/pad focus over a list of elements, with wrap-around. */
export class FocusList {
  index = 0;
  constructor(private readonly items: () => HTMLElement[], private readonly columns = 1) {}

  move(action: string): boolean {
    const n = this.items().length;
    if (!n) return false;
    const step = action === 'up' ? -this.columns : action === 'down' ? this.columns
      : action === 'left' ? -1 : action === 'right' ? 1 : 0;
    if (!step) return false;
    this.set((this.index + step + n) % n);
    return true;
  }

  set(index: number): void {
    this.index = index;
    this.items().forEach((item, i) => item.classList.toggle('is-focused', i === index));
  }

  get current(): HTMLElement | undefined {
    return this.items()[this.index];
  }
}

/** Hex colour number → CSS. */
export const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
