export async function guardedHealthRestore({
  resolveToken,
  healthSnapshot,
  restoreHealth,
  targetTokenUuid,
  targetActorUuid,
  preApplication,
  postApplication,
}) {
  const token = await resolveToken(targetTokenUuid);
  const actor = token?.actor;
  if (!actor || actor.uuid !== targetActorUuid) return { ok: false, reason: "target-unavailable" };
  const current = healthSnapshot(actor);
  if (
    !current ||
    current.hp !== postApplication?.hp ||
    current.tempHp !== postApplication?.tempHp
  ) {
    return { ok: false, reason: "health-changed" };
  }
  await restoreHealth(actor, preApplication);
  return { ok: true, reason: null };
}
