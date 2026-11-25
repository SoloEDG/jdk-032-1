export { bakeProfile, edgeKey, checksumOf, unionOutline } from './lib/bake'
export {
  applyProfileToPieces, ensureBaked, ensureProfiles, resolveDef, resolveVersion,
  saveProfileDef, newProfileDef, builtinProfiles,
  DEFAULT_PROFILE_ID, NOTCH_PROFILE_ID, FOOT_PROFILE_ID, LEGACY_PROFILE_ID,
} from './lib/catalog'
export { propagateWithProfiles } from './lib/propagate'
export {
  computePivot, findFirstContact, rampShape, rampSlope, staticTargetOf, sweptPolygon,
  angularVelocity, timeToAngle, circumRadius,
} from './lib/solver'
export { polygonContact, transformPolygon, clusterContactPoints } from './lib/geometry2d'
export { useProfiles } from './model/useProfiles'
export { default as ProfilePanel } from './ui/ProfilePanel.vue'
