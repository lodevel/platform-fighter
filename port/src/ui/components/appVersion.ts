export interface AppVersionIdentity {
  readonly version: string;
  readonly buildIdentity: string;
}

/** Persistent shell identity so players can compare builds across computers. */
export function createAppVersionBadge(host: HTMLElement, { version, buildIdentity }: AppVersionIdentity) {
  const prefix = 'platform-fighter-sha256-';
  const shortBuild = buildIdentity.startsWith(prefix) ? buildIdentity.slice(prefix.length, prefix.length + 8) : buildIdentity;
  const fullIdentity = `Version ${version} · Build ${buildIdentity}`;
  const node = host.ownerDocument.createElement('div');
  node.className = 'app-version-badge';
  node.textContent = `v${version} · ${shortBuild}`;
  node.title = fullIdentity;
  node.setAttribute('role', 'note');
  node.setAttribute('aria-label', fullIdentity);
  host.append(node);
  return { dispose(): void { node.remove(); } };
}
