/** Validate supplied fresh Link drawing/geometry data at the loader boundary.
 * Missing motions remain separate integration dependencies. This parser proves
 * structure, not source fidelity, inspected pixels or match acceptance.
 * All geometry is ROOT-relative world pixels and is authored facing right.
 */

/** WORLD px relative to the drawing's source ROOT, authored facing right. */
export interface LinkPoint {readonly x:number;readonly y:number;}
export type LinkAnatomicalRegion='head'|'torso'|'arm'|'leg'|'foot';
export interface LinkHeadContact {readonly point:LinkPoint;readonly reviewKey:string;}
export interface LinkReceivingCapsule {readonly id:string;readonly region?:LinkAnatomicalRegion;readonly start:LinkPoint;readonly end:LinkPoint;readonly radius:number;}
/** Native unit-axis projection, facing RIGHT, angle measured from world +X. */
export interface LinkAttachmentAxisDirection {readonly angleDegrees:number;readonly inPlaneLength:number;}
export type LinkAttachmentAxisDirections = Readonly<Partial<Record<'y'|'z',LinkAttachmentAxisDirection>>>;
export interface LinkAttachment {readonly role:'item'|'sword'|'shield'|'bow'|'ancient-bow'|'ancient-arrow-release'|'arrow-release'|'boomerang-release'|'bomb-root'|'parasail-root'|'capture-anchor'|'waist';
  /** Relative angle from the facing axis; the consumer flips its art once. */
  readonly point:LinkPoint;readonly angleDegrees?:number;readonly axisDirections?:LinkAttachmentAxisDirections;}
/** Identity of an article already drawn into these exact body pixels. */
export type LinkBakedArticle={readonly role:'bow-generated-primary-arrow';readonly phase:'loaded'}|{readonly role:'bow-own';readonly phase:'have'|'back'};
/** Current-drawing pixel/support review, in actor BODY-CENTRE world pixels. */
export interface LinkCaptureSupport {readonly reviewedBottom:number;readonly clearance:number;readonly reviewKey:string;}
/** One drawing's receiving, sockets and registration (Final victim profiles). */
export interface LinkDrawingGeometry {
  readonly receiving:readonly LinkReceivingCapsule[];readonly attachments:readonly LinkAttachment[];
  readonly bakedArticles?:readonly LinkBakedArticle[];
  readonly captureSupport?:LinkCaptureSupport|null;
  readonly headContact?:LinkHeadContact;
  readonly originX:number;readonly originY:number;
}
export interface LinkBodyRenderMetrics {
  readonly sheet:string;readonly frameWidth:number;readonly frameHeight:number;readonly scaleToWorld:number;readonly bodyCentreFromRootY:number;
}

function invalid(path: string, expected: string): never {
  throw new TypeError(`Invalid Link body profile ${path}: expected ${expected}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid(path, 'an object');
  return value as Record<string, unknown>;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return invalid(path, 'a finite number');
  return value;
}

function positive(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result <= 0) return invalid(path, 'a positive finite number');
  return result;
}

function integer(value: unknown, path: string, minimum: number): number {
  const result = finite(value, path);
  if (!Number.isSafeInteger(result) || result < minimum)
    return invalid(path, `a safe integer >= ${minimum}`);
  return result;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    return invalid(path, 'a nonempty string');
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return invalid(path, 'an array');
  return value;
}

function point(value: unknown, path: string): LinkPoint {
  const row = record(value, path);
  return Object.freeze({ x: finite(row.x, `${path}.x`), y: finite(row.y, `${path}.y`) });
}

function receiving(value: unknown, path: string): LinkReceivingCapsule {
  const row = record(value, path);
  if(row.region!==undefined&&!['head','torso','arm','leg','foot'].includes(row.region as string))return invalid(`${path}.region`,'declared anatomical region');
  return Object.freeze({
    ...(row.region===undefined?{}:{region:row.region as LinkReceivingCapsule['region']}),
    id: text(row.id, `${path}.id`),
    start: point(row.start, `${path}.start`),
    end: point(row.end, `${path}.end`),
    radius: positive(row.radius, `${path}.radius`),
  });
}

function attachment(value: unknown, path: string): LinkAttachment {
  const row = record(value, path);
  const role = text(row.role, `${path}.role`);
  if (!['item', 'sword', 'shield', 'bow', 'ancient-bow', 'ancient-arrow-release', 'arrow-release', 'boomerang-release', 'bomb-root', 'parasail-root', 'capture-anchor', 'waist'].includes(role))
    return invalid(`${path}.role`, 'a declared Link attachment role');
  const angleDegrees = row.angleDegrees === undefined ? undefined : finite(row.angleDegrees, `${path}.angleDegrees`);
  if (angleDegrees === undefined && role !== 'item' && role !== 'waist' && role !== 'bomb-root' && role !== 'capture-anchor')
    return invalid(`${path}.angleDegrees`, 'actual supplied orientation for this equipment role');
  let axisDirections: LinkAttachmentAxisDirections | undefined;
  if (row.axisDirections !== undefined) {
    const axes = record(row.axisDirections, `${path}.axisDirections`);
    const parsed: Partial<Record<'y'|'z', {readonly angleDegrees:number;readonly inPlaneLength:number}>> = {};
    if (Object.keys(axes).length === 0) return invalid(`${path}.axisDirections`, 'one or more actual projected item axes');
    for (const [axis, raw] of Object.entries(axes)) {
      if (axis !== 'y' && axis !== 'z') return invalid(`${path}.axisDirections.${axis}`, 'supported item axis y or z');
      const dir = record(raw, `${path}.axisDirections.${axis}`);
      const length = finite(dir.inPlaneLength, `${path}.axisDirections.${axis}.inPlaneLength`);
      if (length < 0 || length > 1 + 1e-6)
        return invalid(`${path}.axisDirections.${axis}.inPlaneLength`, 'a native unit-axis projection in [0,1] within float precision');
      parsed[axis] = Object.freeze({angleDegrees:finite(dir.angleDegrees, `${path}.axisDirections.${axis}.angleDegrees`),inPlaneLength:length});
    }
    axisDirections = Object.freeze(parsed);
  }
  return Object.freeze({
    role: role as LinkAttachment['role'],
    point: point(row.point, `${path}.point`),
    ...(angleDegrees === undefined ? {} : {angleDegrees}),
    ...(axisDirections === undefined ? {} : {axisDirections}),
  });
}
function bakedArticle(value: unknown, path: string): LinkBakedArticle {
  const row = record(value, path);
  if(row.role==='bow-own'&&(row.phase==='have'||row.phase==='back'))return Object.freeze({role:'bow-own',phase:row.phase});
  if (row.role !== 'bow-generated-primary-arrow' || row.phase !== 'loaded')
    return invalid(path, 'the loaded generated primary Arrow identity; picked/secondary articles are separate');
  return Object.freeze({role: 'bow-generated-primary-arrow', phase: 'loaded'});
}

/** Common current-pixel geometry boundary for ordinary and composed poses.
 * It validates no source clock and does not invent a single native sample
 * when an authored composed rig has independent lower/upper samples.
 */
export function parseLinkDrawingGeometry(value: unknown, path = 'drawing'): LinkDrawingGeometry {
  const row = record(value, path);
  const capsules = array(row.receiving, `${path}.receiving`).map((v, i) =>
    receiving(v, `${path}.receiving[${i}]`));
  if (capsules.length === 0)
    return invalid(`${path}.receiving`, 'posed body geometry; protection is a separate runtime policy');
  if (new Set(capsules.map(c => c.id)).size !== capsules.length)
    return invalid(`${path}.receiving`, 'unique region IDs within this drawing');
  const attachments = array(row.attachments, `${path}.attachments`).map((v, i) =>
    attachment(v, `${path}.attachments[${i}]`));
  if (new Set(attachments.map(a => a.role)).size !== attachments.length)
    return invalid(`${path}.attachments`, 'one unambiguous socket per equipment role');
  const bakedArticles = row.bakedArticles === undefined ? undefined :
    array(row.bakedArticles, `${path}.bakedArticles`).map((v, i) => bakedArticle(v, `${path}.bakedArticles[${i}]`));
  if (bakedArticles && new Set(bakedArticles.map(article => article.role)).size !== bakedArticles.length)
    return invalid(`${path}.bakedArticles`, 'one declaration per actual baked article identity');
  let captureSupport:LinkDrawingGeometry['captureSupport'];
  if(row.captureSupport===null)captureSupport=null;
  else if(row.captureSupport!==undefined){
    const support=record(row.captureSupport,`${path}.captureSupport`);
    if(Object.keys(support).some(key=>!['reviewedBottom','clearance','reviewKey'].includes(key)))
      return invalid(`${path}.captureSupport`,'only reviewedBottom, clearance and reviewKey');
    const clearance=finite(support.clearance,`${path}.captureSupport.clearance`);
    if(clearance<0)return invalid(`${path}.captureSupport.clearance`,'nonnegative reviewed clearance');
    captureSupport=Object.freeze({reviewedBottom:finite(support.reviewedBottom,`${path}.captureSupport.reviewedBottom`),clearance,
      reviewKey:text(support.reviewKey,`${path}.captureSupport.reviewKey`)});
  }
  return Object.freeze({
    receiving: Object.freeze(capsules),
    attachments: Object.freeze(attachments),
    ...(bakedArticles === undefined ? {} : { bakedArticles: Object.freeze(bakedArticles) }),
    ...(row.headContact===undefined?{}:{headContact:(()=>{const h=record(row.headContact,`${path}.headContact`);
      if(Object.keys(h).length!==2||!Object.hasOwn(h,'point')||!Object.hasOwn(h,'reviewKey'))return invalid(`${path}.headContact`,'exact point/reviewKey');
      return Object.freeze({point:point(h.point,`${path}.headContact.point`),reviewKey:text(h.reviewKey,`${path}.headContact.reviewKey`)});})()}),
    ...(captureSupport === undefined ? {} : {captureSupport}),
    // Phaser supports origins outside the canvas; do not clamp a real root.
    originX: finite(row.originX, `${path}.originX`),
    originY: finite(row.originY, `${path}.originY`),
  });
}

export function parseLinkBodyRenderMetrics(value: unknown, path = 'metrics'): LinkBodyRenderMetrics {
  const row = record(value, path);
  return Object.freeze({
    sheet: text(row.sheet, `${path}.sheet`),
    frameWidth: integer(row.frameWidth, `${path}.frameWidth`, 1),
    frameHeight: integer(row.frameHeight, `${path}.frameHeight`, 1),
    scaleToWorld: positive(row.scaleToWorld, `${path}.scaleToWorld`),
    bodyCentreFromRootY: finite(row.bodyCentreFromRootY, `${path}.bodyCentreFromRootY`),
  });
}
