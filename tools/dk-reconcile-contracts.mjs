import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = 'docs/review/2026-09-25/donkeykong-character';
const inventoryPath = `${directory}/inventory.json`;
const mappingPath = `${directory}/audit-2026-10-08/runtime/action-mapping.json`;
const mechanicsPath = `${directory}/completion-2026-10-08/mechanics/row-source-input-proposals.json`;
const contextPath = `${directory}/completion-2026-10-08/mechanics/context-row-source-proposals.json`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [inventory, mapping, mechanics, context] = await Promise.all([inventoryPath, mappingPath, mechanicsPath, contextPath].map(async file => JSON.parse(await readFile(file, 'utf8'))));
const mapped = new Map(mapping.actions.map(row => [row.id, row]));
const proposals = [
  ...mechanics.proposals.map(row => ({ ...row, proposalPath: mechanicsPath })),
  ...context.proposals.map(row => ({ ...row, source_records: row.sources, proposalPath: contextPath })),
];
const proposed = new Map(proposals.map(row => [row.id, row]));
if (mapped.size !== mapping.actions.length || proposed.size !== proposals.length) throw new Error('Duplicate action mapping or source proposal');
if (mapped.size !== inventory.actions.length || inventory.actions.some(row => !mapped.has(row.id))) throw new Error('Runtime mapping does not cover exact canonical inventory');
if (proposed.size !== inventory.actions.length || inventory.actions.some(row => !proposed.has(row.id))) throw new Error('Source proposals do not cover exact canonical inventory');
const sourceHashes = new Map();
for (const proposal of proposed.values()) {
  if (!mapped.has(proposal.id)) throw new Error(`Unknown source proposal: ${proposal.id}`);
  for (const source of proposal.source_records ?? []) {
    if (!sourceHashes.has(source.path)) sourceHashes.set(source.path, hash(await readFile(source.path)));
    if (sourceHashes.get(source.path) !== source.sha256) throw new Error(`Source changed: ${source.path}`);
  }
  const route = mapped.get(proposal.id);
  if (proposal.proposalPath === contextPath && proposal.native_motion_selector !== route.native_motion_selector) throw new Error(`Context source/runtime selector differs: ${proposal.id}`);
  if (proposal.native_motion_names?.length && !proposal.native_motion_names.includes(route.native_motion_selector)) throw new Error(`Combat source/runtime selector differs: ${proposal.id}`);
  if (proposal.native_motion_files && JSON.stringify([...proposal.native_motion_files].sort()) !== JSON.stringify([...route.native_motion_files].sort())) throw new Error(`Source/runtime motion files differ: ${proposal.id}`);
}
for (const row of inventory.actions) {
  const route = mapped.get(row.id), source = proposed.get(row.id);
  row.entry_state = source?.entry_state ?? route.input_and_entry;
  row.input = source?.input ?? route.input_and_entry;
  row.source_contract = {
    runtime_mapping: mappingPath,
    mechanics_proposal: source.proposalPath,
    native_motion_selector: route.native_motion_selector,
    native_motion_files: route.native_motion_files,
    native_scripts: source?.native_scripts ?? [],
    source_records: source?.source_records ?? [],
    native_attack_records: source?.native_attack_records ?? [],
    selected_phase: source?.selected_phase ?? null,
    native_motion_fields: source.native_motion_fields ?? null,
    native_motion_record: source.native_motion_record ?? null,
    item_action: source.action ?? null,
    native_item_events: source.source_events ?? [],
    native_item_throw_parameters: source.throw_parameters ?? null,
    common_item_status_contract: source.common_status_contract ?? null,
    vertical_source_contract: source.vertical_source_contract ?? null,
    workbook_vertical_cells: source.workbook_vertical_cells ?? null,
    selected_vertical_consumer: source.selected_vertical_consumer ?? null,
    selected_vertical_contract: source.selected_vertical_contract ?? null,
    selected_excess_fall_contract: source.selected_excess_fall_contract ?? null,
    footstool_repeat_contract: source.footstool_repeat_contract ?? null,
    source_repeat_rules: source.source_repeat_rules ?? null,
    selected_full_footstool_basis: source.selected_full_footstool_basis ?? null,
    native_status_source_contract: source.native_status_source_contract ?? null,
    native_status_contract: source.native_status_contract ?? null,
    heavy_runtime_contract: source.heavy_runtime_contract ?? null,
    heavy_rate_availability_receipt: source.heavy_rate_availability_receipt ?? null,
    numeric_fidelity: 'Per-field source audit remains separate from input/route mapping.',
  };
  if (source?.source_urls) row.source_urls = [...new Set([...row.source_urls, ...source.source_urls])];
  row.provenance = source.proposalPath === contextPath
    ? 'pinned_native_motion_and_capabilities_with_explicit_context_adapters'
    : 'pinned_native_commands_and_UFD_with_authored_body_adaptation';
  row.runtime_contract = { animation_key: route.animation_key,
    entry_route: route.runtime_entry_route, receiving_consumer: route.runtime_receiving_consumer,
    entry_route_present: route.implemented_entry, unresolved_implementation: route.unresolved_implementation };
  const supersededChargeLimit = 'Project hold-to-charge/release-to-fire and shield-bank adapter differs from native press-to-start sustained windup; no native controller parity claimed';
  const retainedLimits = row.fidelity_limits.filter(limit =>
    !(row.mechanics_fidelity_limits ?? []).includes(limit) &&
    !(source && limit === supersededChargeLimit));
  row.mechanics_fidelity_limits = source?.fidelity_limits ?? [];
  row.fidelity_limits = [...new Set([...retainedLimits, ...row.mechanics_fidelity_limits])];
  // Source/input evidence is progress, but it does not promote implementation,
  // images, or final game acceptance. Those remain independently qualified.
}
inventory.active_work = {
  ...inventory.active_work,
  source_input_mappings: mapped.size,
  pinned_combat_source_contracts: mechanics.proposals.length,
  pinned_context_source_contracts: context.proposals.length,
  pinned_source_contracts: proposed.size,
  entry_routes_without_mapping_gaps: mapping.actions.filter(row => row.implemented_entry).length,
  focused_mechanics_checks: inventory.active_work?.focused_mechanics_checks ?? 0,
  mechanics_receipt: inventory.active_work?.mechanics_receipt ?? null,
  description: inventory.active_work?.description ?? 'Action contracts mapped; final implementation, art and match qualification remain in progress.',
};
await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ actions: mapped.size, pinnedCombatContracts: mechanics.proposals.length, pinnedContextContracts: context.proposals.length, uniqueSourceFilesVerified: sourceHashes.size, finalQualificationChanged: false }));
