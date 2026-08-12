import { applicationId } from "./toolbelt-basic-save-model.js";

/**
 * Stable identity for one authoritative Toolbelt save instance.
 * Includes saveFingerprint so Hero Point / rerolls publish as a new result.
 *
 * @param {{ integrationId?: string, applicationId?: string, toolbeltTargetKey?: string, saveFingerprint?: string|null }} args
 * @returns {string|null}
 */
export function buildBasicSaveTargetResultId(args = {}) {
  const appId =
    typeof args.applicationId === "string" && args.applicationId.trim()
      ? args.applicationId.trim()
      : typeof args.integrationId === "string" && typeof args.toolbeltTargetKey === "string"
        ? applicationId(args.integrationId, args.toolbeltTargetKey)
        : null;
  if (!appId) return null;
  const fingerprint =
    typeof args.saveFingerprint === "string" && args.saveFingerprint.trim()
      ? args.saveFingerprint.trim()
      : "unknown";
  return `${appId}:fp:${fingerprint}`;
}
