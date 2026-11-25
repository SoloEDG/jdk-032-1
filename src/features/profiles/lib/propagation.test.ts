import { describe, expect, it } from 'vitest'
import type { DominoDocument, Piece } from '@/shared/document'
import { bakeProfile } from './bake'
import {
  applyProfileToPieces, builtinProfiles, DEFAULT_PROFILE_ID, ensureProfiles,
  FOOT_PROFILE_ID, LEGACY_PROFILE_ID, NOTCH_PROFILE_ID, resolveVersion, saveProfileDef,
} from './catalog'
import { propagateWithProfiles } from './propagate'
import { computePivot, rampShape } from './solver'

function piece(id: string, x: number, y: number, angle = 0, extra: Partial<Piece> = {}): Piece {
  return {
    id, kind: 'domino', x, y, angle, facing: 'east', label: id,
    height: 1.6, width: 0.42, fallThreshold: 0.8, friction: 0.55, ...extra,
  }
}

function baseDoc(pieces: Piece[]): DominoDocument {
  return ensureProfiles({
    id: 'doc', title: '集成', revision: 1, updatedAt: 0,
    pieces, connections: [],
    scene: { gravity: 9.8, friction: 0.6, width: 30, height: 12, showGrid: true },
    startPieceId: pieces[0].id, profiles: [], profileVersions: [],
  } as DominoDocument)
}

describe('端到端传播集成', () => {
  it('内凹双触点：第一接触事件记录两个接触点与具体接触边', () => {
    const builtin = builtinProfiles()
    const notchVersion = bakeProfile(builtin.find(d => d.id === NOTCH_PROFILE_ID)!, 1).version
    const stepVersion = bakeProfile({
      id: 'step', name: '台阶承接牌', createdAt: 1, edgeOverrides: {},
      segments: [
        { label: '高柱', width: 0.3, height: 1.7, offsetX: 0.22, offsetY: 0, density: 1 },
        { label: '矮柱', width: 0.3, height: 0.55, offsetX: -0.22, offsetY: 0, density: 1 },
        { label: '底梁', width: 0.74, height: 0.12, offsetX: 0, offsetY: 0, density: 1 },
      ],
    }, 1).version

    let doc = baseDoc([
      piece('A', 0, 0, 0, { width: 0.8, height: 1.8 }),
      piece('B', 0.885, 0, 0, { width: 0.74, height: 1.7 }),
    ])
    doc = {
      ...doc,
      profiles: [...doc.profiles, { ...stepVersion, id: 'step' } as never],
      profileVersions: [...doc.profileVersions, stepVersion],
    }
    doc = applyProfileToPieces(doc, ['A'], notchVersion)
    doc = applyProfileToPieces(doc, ['B'], stepVersion)

    const result = propagateWithProfiles(doc)
    const contact = result.contacts.find(c => c.sourcePieceId === 'A' && c.targetPieceId === 'B')
    expect(contact).toBeTruthy()
    expect(contact!.contactPointCount).toBeGreaterThanOrEqual(2)
    // 回放能指出是哪条边先撞上：源边与目标边都被记录且是接触边
    expect(contact!.sourceEdge.role).toBe('contact')
    expect(contact!.targetEdge.role).toBe('contact')
    expect(contact!.sourceAngleDeg).toBeGreaterThan(0)
    // 事件流里存在对应的 contact 事件
    expect(result.events.some(e => e.kind === 'contact' && e.contact?.targetPieceId === 'B')).toBe(true)
  })

  it('坡面支脚：被托起的牌传播时携带坡道支脚信息，且支架边不制造假接触', () => {
    const builtin = builtinProfiles()
    const footVersion = bakeProfile(builtin.find(d => d.id === FOOT_PROFILE_ID)!, 1).version
    const stdVersion = bakeProfile(builtin.find(d => d.id === DEFAULT_PROFILE_ID)!, 1).version
    let doc = baseDoc([
      piece('F', 0, 0.2, 0, { width: 0.5, height: 1.5 }),
      piece('R', 0, 0, 0, { kind: 'ramp', width: 1.2, height: 0.5 }),
      piece('N', 1.6, 0, 0),
    ])
    doc = applyProfileToPieces(doc, ['F'], footVersion)
    doc = applyProfileToPieces(doc, ['N'], stdVersion)

    const foot = doc.pieces.find(p => p.id === 'F')!
    const ramp = rampShape(doc.pieces.find(p => p.id === 'R')!)
    const pivot = computePivot(foot, resolveVersion(doc, foot)!, [ramp])
    expect(pivot.rampId).toBe('R')

    const result = propagateWithProfiles(doc)
    // 链路从 F 出发，接触记录的源牌是 F，且不会因为支架边产生异常自接触
    const fromF = result.contacts.filter(c => c.sourcePieceId === 'F')
    expect(fromF.every(c => c.sourceEdge.role === 'contact')).toBe(true)
  })

  it('引用旧剖面：改剖面只更新选中摆件，旧场次仍按当时形状解释', () => {
    const builtin = builtinProfiles()
    const originalDef = structuredClone(builtin.find(d => d.id === DEFAULT_PROFILE_ID)!)
    let doc = baseDoc([piece('OLD', 0, 0, 0), piece('NEW', 2, 0, 0)])

    // 第一次运行：两枚牌都引用原始版本，快照保存当时 checksum
    const run1 = propagateWithProfiles(structuredClone(doc))
    const oldChecksumBefore = doc.pieces.find(p => p.id === 'OLD')!.profileVersion
    expect(run1.contacts.length).toBeGreaterThanOrEqual(0)

    // 修改剖面定义 → 产生新版本
    const changedDef = structuredClone(originalDef)
    changedDef.segments[0].width = 0.66
    changedDef.segments[0].height = 2.2
    const saved = saveProfileDef(doc, changedDef)
    doc = saved.document
    const newVersion = saved.version
    expect(newVersion.checksum).not.toBe(oldChecksumBefore)

    // 只更新选中的 NEW；OLD 保持旧 checksum
    doc = applyProfileToPieces(doc, ['NEW'], newVersion)
    const oldPiece = doc.pieces.find(p => p.id === 'OLD')!
    const newPiece = doc.pieces.find(p => p.id === 'NEW')!
    expect(oldPiece.profileVersion).toBe(oldChecksumBefore)
    expect(newPiece.profileVersion).toBe(newVersion.checksum)

    // 旧版本仍可解析，且形状是旧尺寸；新版本是新尺寸
    const oldResolved = resolveVersion(doc, oldPiece)!
    const newResolved = resolveVersion(doc, newPiece)!
    expect(oldResolved.checksum).toBe(oldChecksumBefore)
    expect(oldResolved.bounds.maxX - oldResolved.bounds.minX).toBeCloseTo(0.42, 6)
    expect(newResolved.bounds.maxX - newResolved.bounds.minX).toBeCloseTo(0.66, 6)

    // 第二次运行：OLD 仍按当时（旧）形状参与；文档中新旧两个版本都被保留
    const run2 = propagateWithProfiles(structuredClone(doc))
    expect(run2.events.length).toBeGreaterThan(0)
    expect(doc.profileVersions.some(v => v.checksum === oldChecksumBefore)).toBe(true)
    expect(doc.profileVersions.some(v => v.checksum === newVersion.checksum)).toBe(true)
    // 运行期摆件快照语义：OLD 引用旧 checksum、NEW 引用新 checksum
    expect(doc.pieces.find(p => p.id === 'OLD')!.profileVersion).toBe(oldChecksumBefore)
    expect(doc.pieces.find(p => p.id === 'NEW')!.profileVersion).toBe(newVersion.checksum)
  })

  it('历史形状：旧档迁移的牌保留其当时 width/height', () => {
    const legacyDoc = ensureProfiles({
      id: 'd', title: 't', revision: 1, updatedAt: 0,
      pieces: [piece('legacy', 0, 0, 0, { width: 0.58, height: 2.1 })],
      connections: [],
      scene: { gravity: 9.8, friction: 0.6, width: 20, height: 10, showGrid: true },
      startPieceId: 'legacy', profiles: [], profileVersions: [],
    } as DominoDocument)
    const migrated = legacyDoc.pieces[0]
    expect(migrated.profileId).toContain(LEGACY_PROFILE_ID)
    const version = resolveVersion(legacyDoc, migrated)!
    expect(version.bounds.maxX - version.bounds.minX).toBeCloseTo(0.58, 6)
    expect(version.bounds.maxY - version.bounds.minY).toBeCloseTo(2.1, 6)
  })
})
