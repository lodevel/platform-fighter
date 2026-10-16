import { describe, expect, it, vi } from 'vitest';
import { createAppVersionBadge } from './appVersion';

function host() {
  const node = { className: '', textContent: '', title: '', setAttribute: vi.fn(), remove: vi.fn() };
  const element = { ownerDocument: { createElement: vi.fn(() => node) }, append: vi.fn() };
  return { node, element: element as unknown as HTMLElement, append: element.append };
}

describe('persistent app version badge', () => {
  it('shows package version and the first eight source-hash characters, retaining full identity for comparison', () => {
    const { node, element, append } = host();
    const buildIdentity = 'platform-fighter-sha256-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    createAppVersionBadge(element, { version: '0.1.23', buildIdentity });
    expect(node.className).toBe('app-version-badge');
    expect(node.textContent).toBe('v0.1.23 · 01234567');
    expect(node.title).toBe(`Version 0.1.23 · Build ${buildIdentity}`);
    expect(node.setAttribute).toHaveBeenCalledWith('aria-label', node.title);
    expect(node.setAttribute).toHaveBeenCalledWith('role', 'note');
    expect(append).toHaveBeenCalledWith(node);
  });

  it('keeps a named development identity readable and removes only its own badge when disposed', () => {
    const { node, element } = host();
    const badge = createAppVersionBadge(element, { version: '0.2.0-dev', buildIdentity: 'development' });
    expect(node.textContent).toBe('v0.2.0-dev · development');
    expect(node.title).toBe('Version 0.2.0-dev · Build development');
    badge.dispose();
    expect(node.remove).toHaveBeenCalledOnce();
  });
});
