const element = id => document.getElementById(id);
let snapshot = null;
let fetching = false;

const gapDescriptions = new Map([
  ['Dedicated input/status/clock or contextual route needs implementation; inspect action evidence and remaining_gap.', 'Controls or action behavior still need finishing.'],
  ['Actual running body/effect and paired receiving visual qualification pending.', 'Animation and collision still need checking together in the game.'],
  ['Action-specific production acceptance is incomplete; see linked scope before extending the result.', 'Remaining gameplay scenarios still need verification.'],
  ['Material floor/attachment visual failure remains; see actual reviewed capture evidence.', 'The pose still overlaps the floor or the held opponent.'],
  ['Separate production contact/branch proof remains beyond actual rendered entity or shared Matter evidence.', 'This hit or conditional branch still needs verification in a match.'],
]);

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function isComplete(action) {
  const progress = action.progress;
  return progress?.complete === true && progress.implementation === 'implemented' &&
    progress.visuals === 'accepted' && progress.runtime === 'verified' &&
    Array.isArray(progress.required_gaps) && progress.required_gaps.length === 0;
}

function renderActions() {
  if (!snapshot) return;
  const list = element('action-list');
  const expanded = new Set([...list.querySelectorAll('.action')]
    .filter(row => row.querySelector('details')?.open).map(row => row.dataset.action));
  const scrollTop = list.scrollTop;
  const filter = element('action-filter').value;
  const search = element('action-search').value.trim().toLowerCase();
  const actions = snapshot.actions.filter(action => {
    if (filter === 'remaining' && isComplete(action)) return false;
    if (filter === 'complete' && !isComplete(action)) return false;
    return !search || [action.id, ...(action.progress?.required_gaps ?? [])].join(' ').toLowerCase().includes(search);
  });
  const fragment = document.createDocumentFragment();
  for (const action of actions) {
    const row = document.createElement('article');
    row.className = 'action';
    row.dataset.action = action.id;
    row.append(textNode('h3', action.id.replace(/^pikachu\./, '').replaceAll('-', ' ')));
    const tags = textNode('div', '', 'tags');
    for (const [field, label, ready] of [
      ['implementation', 'Implementation', 'implemented'],
      ['visuals', 'Visuals', 'accepted'],
      ['runtime', 'Match checks', 'verified'],
    ]) {
      const status = action.progress?.[field] ?? 'awaiting reconciliation';
      const tag = textNode('span', `${label}: ${status}`, 'tag');
      tag.dataset.ready = String(status === ready);
      tags.append(tag);
    }
    row.append(tags);
    if (action.progress) {
      const gaps = action.progress.required_gaps ?? [];
      for (const gap of gaps) row.append(textNode('p', gapDescriptions.get(gap) ?? gap));
      if (!gaps.length && !isComplete(action)) row.append(textNode('p', 'Remaining acceptance checks have not all passed.'));
      if (isComplete(action)) row.append(textNode('p', 'Complete for the documented delivery scope.'));
    } else {
      row.append(textNode('p', action.remainingGap || 'Action completion is being reconciled against the evidence.'));
    }
    const details = document.createElement('details');
    details.open = expanded.has(action.id);
    details.append(textNode('summary', 'Evidence scope and source limitations'));
    for (const [label, value] of [['Implementation', action.implementation], ['Visual review', action.visuals], ['Gameplay', action.runtime], ['Source limitations', action.fidelityLimits]]) {
      if (value) details.append(textNode('p', `${label}: ${value}`));
    }
    for (const gap of action.progress?.required_gaps ?? []) details.append(textNode('p', `Required check: ${gap}`));
    row.append(details);
    fragment.append(row);
  }
  if (!actions.length) fragment.append(textNode('p', 'No actions match this filter.'));
  list.replaceChildren(fragment);
  list.scrollTop = scrollTop;
}

function renderSnapshot(data) {
  const reconciled = data.reconciled === data.total;
  const percent = data.total ? Math.floor(data.complete / data.total * 100) : 0;
  element('completion-label').textContent = reconciled ? 'Fully verified actions' : 'Completion reconciliation in progress';
  element('completion-count').textContent = `${data.complete} / ${data.total}${reconciled ? ` · ${percent}%` : ''}`;
  const bar = element('completion-bar');
  bar.max = data.total || 1;
  if (data.reconciled) bar.value = data.complete;
  else bar.removeAttribute('value');
  for (const [id, count] of [['implemented-count', data.counts.implemented], ['accepted-count', data.counts.accepted], ['verified-count', data.counts.verified]]) {
    element(id).textContent = data.reconciled ? `${count} / ${data.total}` : 'Reconciling';
  }
  element('art-count').textContent = data.art.cells.toLocaleString();
  element('art-caption').textContent = `Reviewed art cells · ${data.art.sheets} sheets`;
  element('remaining-summary').textContent = `What’s still missing · ${data.total - data.complete} actions`;
  element('updated-at').textContent = `Evidence updated ${new Date(data.updatedAt).toLocaleString()}. Refreshes every 5 seconds.${reconciled ? '' : ` ${data.reconciled} of ${data.total} action completion records reconciled.`}`;
  const match = element('open-match');
  if (data.build?.url && /^https?:\/\//.test(data.build.url)) {
    match.href = data.build.url;
    match.hidden = false;
    match.textContent = 'Play the latest character build';
  } else match.hidden = true;
  renderActions();
}

async function refresh() {
  if (fetching) return;
  fetching = true;
  try {
    const response = await fetch('/pikachu-progress.json', { cache: 'no-store', signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error('Progress temporarily unavailable');
    const data = await response.json();
    if (!Array.isArray(data.actions) || !data.counts || !data.art) throw new Error('Incomplete progress snapshot');
    const changed = snapshot?.revision !== data.revision;
    snapshot = data;
    if (changed) renderSnapshot(data);
    element('live-state').textContent = '● Live updates';
    element('live-state').dataset.state = 'live';
    element('progress-error').hidden = true;
  } catch {
    element('live-state').textContent = snapshot ? 'Updates paused' : 'Connecting…';
    element('live-state').dataset.state = 'stale';
    element('progress-error').hidden = false;
    element('progress-error').textContent = snapshot ? 'Showing the last received progress. Reconnecting automatically…' : 'Waiting for the live progress service. Retrying automatically…';
  } finally {
    fetching = false;
  }
}

element('action-search').addEventListener('input', renderActions);
element('action-filter').addEventListener('change', renderActions);
element('refresh-progress').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
