/** Join a genuine absolute ThrowSpec release to its own physical throw-entry
 * admission and accepted capture. No synthetic normal move IDs or actor state. */
export function linkThrowReleaseContactMatches(event, wanted, sample) {
  const r=event?.throwRelease,packet=event?.packet?.combatThrowRelease,
    owner=event?.producer?.ownerReceipt,origin=owner?.admission,capture=r?.capture,damage=r?.damageSource;
  if(event?.kind!=='hit'||event.reason!=='throw-release'||event.result?.outcome!=='absolute-release-applied'||r?.kind!=='accepted-capture-throw-release'||
    !packet||JSON.stringify(packet)!==JSON.stringify(r)||owner?.family!=='throw'||origin?.method!=='throw-entry'||
    origin.direction!==r.direction||origin.cargo!==r.cargo||origin.frame!==r.throwEntryFrame||
    origin.generation!==r.producerGeneration||origin.playerIndex!==r.producerPlayerIndex||
    event.frame!==r.releaseFrame||r.releaseFrame<r.throwEntryFrame||!Number.isSafeInteger(r.releaseElapsed)||r.releaseElapsed<1||
    event.producerIndex!==r.producerPlayerIndex||event.producer?.playerIndex!==r.producerPlayerIndex||
    event.producer.generation!==r.producerGeneration||event.victim?.playerIndex!==r.targetPlayerIndex||
    event.victim.generation!==r.targetGeneration||wanted.producerIndex!==r.producerPlayerIndex||wanted.victimIndex!==r.targetPlayerIndex||
    event.captureId!==capture?.captureId||!Number.isSafeInteger(capture?.captureId)||capture.captureId<1||
    capture.targetPlayerIndex!==r.targetPlayerIndex||capture.targetGeneration!==r.targetGeneration||
    capture.captorPlayerIndex!==r.producerPlayerIndex||capture.captorGeneration!==r.producerGeneration||
    !origin.capture||['captureId','targetPlayerIndex','targetGeneration','captorPlayerIndex','captorGeneration']
      .some(key=>origin.capture[key]!==capture[key])||!r.grabId||!r.descriptor||
    !damage||!Number.isFinite(damage.baseDamage)||damage.baseDamage<0||!Number.isFinite(damage.staleMultiplier)||damage.staleMultiplier<=0||
    damage.baseDamage!==r.descriptor.damage||!damage.transactionKey||
    damage.queueMoveId!==`${r.grabId}.throw.${r.cargo?'cargo.':''}${r.direction}`||
    event.packet.baseDamage!==damage.baseDamage||event.packet.staleMultiplier!==damage.staleMultiplier||
    event.packet.damage!==damage.baseDamage*damage.staleMultiplier||JSON.stringify(event.packet.knockback)!==JSON.stringify(r.descriptor.knockback)||
    sample.observerEpoch!==event.observerEpoch||sample.frame<r.releaseFrame)return false;
  const currentProducer=sample.actors.find(a=>a.playerIndex===r.producerPlayerIndex),
    currentVictim=sample.actors.find(a=>a.playerIndex===r.targetPlayerIndex),currentOrigin=currentProducer?.ownerReceipt?.admission;
  if(currentProducer?.generation!==r.producerGeneration||currentVictim?.generation!==r.targetGeneration||
    currentProducer.ownerReceipt?.family!=='throw'||currentOrigin?.key!==origin.key||currentOrigin.frame!==r.throwEntryFrame)return false;
  // A later different capture in the same stock must not borrow this release.
  if(currentVictim.recipient?.templateIdentity&&['captureId','targetPlayerIndex','targetGeneration','captorPlayerIndex','captorGeneration']
    .some(key=>currentVictim.recipient.templateIdentity[key]!==capture[key]))return false;
  return true;
}
