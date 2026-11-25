import { computed, type Ref } from 'vue'
import type {
  DominoDocument, EdgeRole, Piece, ProfileDef, ProfileVersion, SegmentSpec,
} from '@/shared/document'
import {
  applyProfileToPieces, edgeKey as edgeKeyOf, ensureProfiles, resolveDef, resolveVersion,
  saveProfileDef,
} from '../index'
import { bakeProfile } from '../lib/bake'

/** 剖面编辑与版本化：改剖面产生新版本，旧版本保留；可只把新版本应用到选中摆件。 */
export function useProfiles(document: Ref<DominoDocument>, changed: () => void) {
  const profiles = computed(() => ensureProfiles(document.value).profiles)
  const versions = computed(() => ensureProfiles(document.value).profileVersions)

  function versionsOf(profileId: string): ProfileVersion[] {
    return ensureProfiles(document.value).profileVersions
      .filter(v => v.profileId === profileId)
      .sort((a, b) => a.bakedAt - b.bakedAt || a.revision - b.revision)
  }

  function versionOfPiece(piece: Piece): ProfileVersion | null {
    return resolveVersion(ensureProfiles(document.value), piece)
  }

  /** 保存编辑后的剖面定义：内容寻址生成新版本，旧版本原样保留。 */
  function saveDef(def: ProfileDef): { version: ProfileVersion; unmatchedOverrides: string[] } {
    const ready = ensureProfiles(document.value)
    const result = saveProfileDef(ready, def)
    document.value = result.document
    changed()
    return { version: result.version, unmatchedOverrides: result.unmatchedOverrides }
  }

  /**
   * 只更新选中的摆件到指定剖面版本；未选中的牌保持各自旧版本引用。
   * 旧场次仍引用旧 checksum，按当时形状解释。
   */
  function applyToSelected(pieceIds: readonly string[], version: ProfileVersion) {
    const ready = ensureProfiles(document.value)
    document.value = applyProfileToPieces(ready, pieceIds, version)
    changed()
  }

  /** 切换某条边的角色（接触/支架），写回定义并烘焙新版本。 */
  function toggleEdgeRole(def: ProfileDef, version: ProfileVersion, edgeIndex: number): ProfileDef {
    const edge = version.edges[edgeIndex]
    const key = edgeKeyOf(edge)
    const next: ProfileDef = structuredClone(def)
    const current = next.edgeOverrides[key] ?? edge.role
    next.edgeOverrides[key] = (current === 'contact' ? 'support' : 'contact') as EdgeRole
    return next
  }

  /** 新增一段木片到剖面草稿。 */
  function addSegment(def: ProfileDef): ProfileDef {
    const next = structuredClone(def)
    const index = next.segments.length + 1
    const segment: SegmentSpec = {
      label: `木片 ${index}`, width: 0.3, height: 1.2, offsetX: 0, offsetY: 0, density: 1,
    }
    next.segments.push(segment)
    return next
  }

  function removeSegment(def: ProfileDef, index: number): ProfileDef {
    const next = structuredClone(def)
    next.segments.splice(index, 1)
    return next
  }

  /** 预览烘焙（不落库），供编辑器实时显示轮廓/重心。 */
  function preview(def: ProfileDef): ProfileVersion | null {
    try {
      const revision = versionsOf(def.id).length + 1
      return bakeProfile(def, revision).version
    } catch {
      return null
    }
  }

  function defOf(profileId: string): ProfileDef | null {
    return resolveDef(ensureProfiles(document.value), profileId)
  }

  return {
    profiles, versions, versionsOf, versionOfPiece, defOf, preview,
    saveDef, applyToSelected, toggleEdgeRole, addSegment, removeSegment,
  }
}
