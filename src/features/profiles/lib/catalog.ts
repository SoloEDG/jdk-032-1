import type {
  DominoDocument, EdgeRole, Piece, ProfileDef, ProfileVersion, SegmentSpec,
} from '@/shared/document'
import { bakeProfile, checksumOf } from './bake'

export const DEFAULT_PROFILE_ID = 'pf-standard'
export const NOTCH_PROFILE_ID = 'pf-notch-dual'
export const FOOT_PROFILE_ID = 'pf-ramp-foot'
export const LEGACY_PROFILE_ID = 'pf-legacy'

function def(id: string, name: string, segments: SegmentSpec[], edgeOverrides: Record<string, EdgeRole> = {}): ProfileDef {
  return { id, name, createdAt: 0, segments, edgeOverrides }
}

/** 内置剖面库：矩形标准件、内凹双触点件、坡面支脚件、旧档兼容件。 */
export function builtinProfiles(): ProfileDef[] {
  return [
    def(DEFAULT_PROFILE_ID, '标准单片骨牌', [
      { label: '主木片', width: 0.42, height: 1.6, offsetX: 0, offsetY: 0, density: 1 },
    ]),
    def(NOTCH_PROFILE_ID, '内凹双触点骨牌', [
      // C 形剖面：落地竖直背板作为支脚；上下叉齿关于支脚高度方向等距、前缘齐平，
      // 叉齿间留出朝向前方（倒下方向）的凹口。绕背板支脚顺时针倒下时，
      // 上下叉齿的前缘到支脚距离相等，在同一倾倒角同步贴上目标竖面 → 内凹双触点。
      { label: '背板支脚', width: 0.2, height: 1.8, offsetX: -0.3, offsetY: 0, density: 1 },
      { label: '下叉齿', width: 0.6, height: 0.22, offsetX: 0.0, offsetY: 0.35, density: 1 },
      { label: '上叉齿', width: 0.6, height: 0.22, offsetX: 0.0, offsetY: 1.23, density: 1 },
    ], {
      // 凹腔内壁（下齿顶面、上齿底面）只是结构/支架面，不向相邻牌传播倒下；
      // 真正向外的接触由两根叉齿的前缘竖边承担。
      'm0.05,0.57|n0,-1': 'support',
      'm0.05,1.45|n0,-1': 'support',
    }),
    def(FOOT_PROFILE_ID, '坡面支脚骨牌', [
      // 主体偏后，前侧只有一条窄支架脚；支架脚可被坡道斜面托起（与主体正向搭接成单环）
      { label: '主体', width: 0.4, height: 1.5, offsetX: 0.12, offsetY: 0, density: 1 },
      { label: '前支脚', width: 0.16, height: 0.42, offsetX: -0.15, offsetY: 0, density: 1 },
    ]),
    def(LEGACY_PROFILE_ID, '旧版矩形（历史形状）', [
      { label: '旧木片', width: 0.42, height: 1.6, offsetX: 0, offsetY: 0, density: 1 },
    ]),
  ]
}

/** 把一份 ProfileDef 烘焙并登记进文档，返回新文档与版本（已存在则直接复用）。 */
export function ensureBaked(
  document: DominoDocument,
  profileDef: ProfileDef,
  revision: number,
): { document: DominoDocument; version: ProfileVersion; unmatchedOverrides: string[] } {
  const checksum = checksumOf(profileDef)
  const existing = document.profileVersions.find(v => v.checksum === checksum && v.profileId === profileDef.id)
  if (existing) return { document, version: existing, unmatchedOverrides: [] }
  const { version, unmatchedOverrides } = bakeProfile(profileDef, revision)
  return {
    document: { ...document, profileVersions: [...document.profileVersions, version] },
    version,
    unmatchedOverrides,
  }
}

/** 确保文档带剖面库；旧档自动迁移，不改变旧牌的视觉尺寸。幂等。 */
export function ensureProfiles(document: DominoDocument): DominoDocument {
  const defs = builtinProfiles()
  let next: DominoDocument = {
    ...document,
    profiles: document.profiles?.length ? document.profiles : defs,
    profileVersions: [...(document.profileVersions ?? [])],
  }
  // 1) 内置剖面全部烘焙（已存在则复用）
  let revision = next.profileVersions.length + 1
  for (const profileDef of defs) {
    const baked = ensureBaked(next, profileDef, revision++)
    next = baked.document
  }
  // 2) 逐摆件确保其引用的剖面版本存在；旧牌按当时 width/height 生成专属历史形状
  const migratedPieces: Piece[] = []
  for (const piece of next.pieces) {
    if (piece.profileId && piece.profileVersion
      && next.profileVersions.some(v => v.checksum === piece.profileVersion
        && (!piece.profileId || v.profileId === piece.profileId))) {
      migratedPieces.push(piece)
      continue
    }
    const legacy = legacyDefFor(piece)
    const checksum = checksumOf(legacy)
    if (!next.profileVersions.some(v => v.checksum === checksum && v.profileId === legacy.id)) {
      const { version } = bakeProfile(legacy, revision++)
      next = {
        ...next,
        profiles: next.profiles.some(p => p.id === legacy.id) ? next.profiles : [...next.profiles, legacy],
        profileVersions: [...next.profileVersions, version],
      }
    }
    migratedPieces.push({ ...piece, profileId: legacy.id, profileVersion: checksum })
  }
  return { ...next, pieces: migratedPieces }
}

/** 旧牌的历史剖面：尺寸取当时的 width/height，命名带其 id 以便辨认。 */
function legacyDefFor(piece: Piece): ProfileDef {
  const id = `${LEGACY_PROFILE_ID}-${piece.id}`
  const segments: SegmentSpec[] = [{
    label: '历史木片',
    width: piece.width || 0.42,
    height: piece.height || 1.6,
    offsetX: 0,
    offsetY: 0,
    density: 1,
  }]
  return { id, name: `历史形状 · ${piece.label || piece.id}`, createdAt: 0, segments, edgeOverrides: {} }
}

export function resolveVersion(document: DominoDocument, piece: Piece): ProfileVersion | null {
  if (!piece.profileVersion) return null
  return document.profileVersions.find(v => v.checksum === piece.profileVersion
    && (!piece.profileId || v.profileId === piece.profileId)) ?? null
}

export function resolveDef(document: DominoDocument, profileId: string): ProfileDef | null {
  return document.profiles.find(p => p.id === profileId) ?? null
}

/** 编辑剖面定义：生成新版本并登记；旧版本原样保留，旧场次仍按当时形状解释。 */
export function saveProfileDef(document: DominoDocument, profileDef: ProfileDef): {
  document: DominoDocument
  version: ProfileVersion
  unmatchedOverrides: string[]
} {
  const defs = document.profiles.some(p => p.id === profileDef.id)
    ? document.profiles.map(p => (p.id === profileDef.id ? profileDef : p))
    : [...document.profiles, profileDef]
  const revision = (document.profileVersions.filter(v => v.profileId === profileDef.id).length) + 1
  const prepared: DominoDocument = { ...document, profiles: defs }
  const baked = ensureBaked(prepared, profileDef, revision)
  return { document: baked.document, version: baked.version, unmatchedOverrides: baked.unmatchedOverrides }
}

/**
 * 只更新选中的摆件到指定剖面版本；未选中的牌保持各自引用的旧版本。
 * 这就是“改了剖面后只更新选中的摆件”。
 */
export function applyProfileToPieces(
  document: DominoDocument,
  pieceIds: readonly string[],
  version: ProfileVersion,
): DominoDocument {
  const set = new Set(pieceIds)
  return {
    ...document,
    pieces: document.pieces.map(piece => set.has(piece.id)
      ? { ...piece, profileId: version.profileId, profileVersion: version.checksum }
      : piece),
  }
}

/** 新建一份可编辑的剖面定义草稿（复制现有定义或从空白开始）。 */
export function newProfileDef(name: string, segments: SegmentSpec[] = []): ProfileDef {
  return {
    id: `pf-${crypto.randomUUID().slice(0, 8)}`,
    name,
    createdAt: Date.now(),
    segments: segments.length ? segments : [{ label: '木片 1', width: 0.4, height: 1.4, offsetX: 0, offsetY: 0, density: 1 }],
    edgeOverrides: {},
  }
}
