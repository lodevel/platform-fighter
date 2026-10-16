/** Compatibility exports. Gameplay socket selection is owned by the pinned
 * legacy pose provider, independently of visual routes and display clocks. */
export { selectHeldItemSocket } from '../characterPresentation/legacy/poseProvider';
export { heldItemMuzzle, HELD_ITEM_MIN_FORESHORTENING } from '../characterPresentation/legacy/heldItemPoseData';
export type { HeldItemSocket, ItemAttachmentPose, ItemSocketAxis } from '../characterPresentation/legacy/heldItemPoseData';
