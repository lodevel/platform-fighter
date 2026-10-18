import { PACKAGE_SCHEMA, type CharacterPackage, type Schedule, type Window } from './types';

/** Every problem found, each prefixed with the path of the offending value. Empty means valid. */
export function validatePackage(value: unknown): string[] {
  const errors: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  if (!isObject(value)) return ['package: not an object'];
  const pkg = value as unknown as CharacterPackage;

  allowKeys(value, ['schema', 'id', 'revision', 'pages', 'drawings', 'actions', 'provenance', 'extensions'], 'package', fail);
  if (pkg.schema !== PACKAGE_SCHEMA) fail('schema', `expected ${PACKAGE_SCHEMA}`);
  if (!isText(pkg.id)) fail('id', 'missing');
  if (typeof pkg.revision !== 'string') fail('revision', 'missing');
  if (pkg.extensions !== undefined && !isObject(pkg.extensions)) fail('extensions', 'not an object');
  if (!isObject(pkg.provenance) || !isObject(pkg.provenance.sources)) fail('provenance.sources', 'missing');
  else allowKeys(pkg.provenance, ['importer', 'sources'], 'provenance', fail);

  const pages = records(pkg.pages, 'pages', fail);
  for (const [id, page] of pages) {
    const path = `pages.${id}`;
    allowKeys(page, ['file', 'width', 'height', 'sha256'], path, fail);
    if (!isText(page.file) || page.file.startsWith('/') || page.file.split('/').includes('..')) fail(`${path}.file`, 'must be a relative path inside the package');
    if (!isCount(page.width) || !isCount(page.height)) fail(path, 'width and height must be positive integers');
    if (typeof page.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(page.sha256)) fail(`${path}.sha256`, 'must be 64 lowercase hex digits');
  }

  const usedPages = new Set<string>();
  const drawings = records(pkg.drawings, 'drawings', fail);
  for (const [id, drawing] of drawings) {
    const path = `drawings.${id}`;
    allowKeys(drawing, ['page', 'rect', 'anchor', 'scale'], path, fail);
    const page = isObject(pkg.pages) ? pkg.pages[drawing.page] : undefined;
    if (!page) { fail(`${path}.page`, `unknown page ${drawing.page}`); continue; }
    usedPages.add(drawing.page);
    const [x, y, w, h] = Array.isArray(drawing.rect) ? drawing.rect : [];
    if (![x, y].every(isIndex) || ![w, h].every(isCount)) fail(`${path}.rect`, 'must be [x, y, width, height] integers with a positive size');
    else if (x! + w! > page.width || y! + h! > page.height) fail(`${path}.rect`, `outside page ${drawing.page}`);
    if (!Array.isArray(drawing.anchor) || drawing.anchor.length !== 2 || !drawing.anchor.every(Number.isFinite)) fail(`${path}.anchor`, 'must be two finite numbers');
    if (!(Number.isFinite(drawing.scale) && drawing.scale > 0)) fail(`${path}.scale`, 'must be positive');
  }
  for (const [id] of pages) if (!usedPages.has(id)) fail(`pages.${id}`, 'no drawing uses this page');

  const usedDrawings = new Set<string>();
  const actions = records(pkg.actions, 'actions', fail);
  if (actions.length === 0) fail('actions', 'a package needs at least one action');
  for (const [id, action] of actions) {
    const path = `actions.${id}`;
    allowKeys(action, ['bodyCentreFromRootY', 'drawings', 'sockets', 'source'], path, fail);
    if (!Number.isFinite(action.bodyCentreFromRootY)) fail(`${path}.bodyCentreFromRootY`, 'must be a finite number');
    checkSchedule(action.drawings, `${path}.drawings`, ['drawing', 'sample'], fail, (window, at) => {
      if (!isObject(pkg.drawings) || !pkg.drawings[window.drawing]) fail(`${at}.drawing`, `unknown drawing ${window.drawing}`);
      else usedDrawings.add(window.drawing);
      if (window.sample !== undefined && !isIndex(window.sample)) fail(`${at}.sample`, 'must be a non-negative integer');
    });
    if (action.source !== undefined) {
      allowKeys(action.source, ['game', 'move'], `${path}.source`, fail);
      if (!isText(action.source.game) || !isText(action.source.move)) fail(`${path}.source`, 'needs game and move');
    }
    for (const [name, socket] of action.sockets === undefined ? [] : records(action.sockets, `${path}.sockets`, fail)) {
      const at = `${path}.sockets.${name}`;
      allowKeys(socket, ['space', 'schedule'], at, fail);
      if (socket.space !== 'body-centre' && socket.space !== 'root') fail(`${at}.space`, 'must be body-centre or root');
      checkSchedule(socket.schedule, `${at}.schedule`, ['x', 'y', 'angle', 'length'], fail, (window, where) => {
        if (!Number.isFinite(window.x) || !Number.isFinite(window.y)) fail(where, 'x and y must be finite');
        if (window.angle !== undefined && !Number.isFinite(window.angle)) fail(`${where}.angle`, 'must be finite');
        if (window.length !== undefined && !(window.length >= 0 && window.length <= 1)) fail(`${where}.length`, 'must be between 0 and 1');
      });
    }
  }
  for (const [id] of drawings) if (!usedDrawings.has(id)) fail(`drawings.${id}`, 'no action shows this drawing');
  return errors;
}

type Fail = (path: string, message: string) => void;

function checkSchedule<W extends Window>(schedule: Schedule<W>, path: string, fields: readonly string[], fail: Fail, each: (window: W, path: string) => void): void {
  if (!isObject(schedule)) { fail(path, 'missing'); return; }
  allowKeys(schedule, ['after', 'windows'], path, fail);
  if (!['loop', 'hold', 'stop'].includes(schedule.after)) fail(`${path}.after`, 'must be loop, hold or stop');
  if (!Array.isArray(schedule.windows) || schedule.windows.length === 0) { fail(`${path}.windows`, 'needs at least one window'); return; }
  let expected = 0;
  schedule.windows.forEach((window, i) => {
    const at = `${path}.windows[${i}]`;
    if (typeof window !== 'object' || window === null) { fail(at, 'not an object'); return; }
    allowKeys(window, ['start', 'end', ...fields], at, fail);
    if (!isIndex(window.start) || !isIndex(window.end) || window.end <= window.start) fail(at, 'start and end must be integers with end > start');
    else if (window.start !== expected) fail(at, `starts at ${window.start}, expected ${expected} (windows must be contiguous from 0)`);
    if (isIndex(window.end)) expected = window.end;
    each(window, at);
  });
}

function records<T>(value: Readonly<Record<string, T>> | undefined, path: string, fail: Fail): [string, T][] {
  if (!isObject(value)) { fail(path, 'missing'); return []; }
  return Object.entries(value).filter(([key, entry]) => {
    if (!isText(key)) fail(path, 'empty key');
    if (!isObject(entry)) { fail(`${path}.${key}`, 'not an object'); return false; }
    return true;
  });
}

function allowKeys(value: object, allowed: readonly string[], path: string, fail: Fail): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
}

const isObject = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
