import { describe, expect, it } from 'vitest'
import type { Piece, ProfileDef, ProfileVersion } from '@/shared/document'
import { bakeProfile } from './bake'
import {
  builtinProfiles, DEFAULT_PROFILE_ID, ensureProfiles, FOOT_PROFILE_ID,
  LEGACY_PROFILE_ID, NOTCH_PROFILE_ID, resolveVersion,
} from './catalog'
import {
  computePivot, findFirstContact, rampShape, staticTargetOf, sweptPolygon,
} from './solver'
import { polygonContact, v } from './geometry2d'

function bake(def: ProfileDef): ProfileVersion {
  return bakeProfile(def, 1, 1).version
}
const builtin = builtinProfiles()
const versionOf = (id: string) => bake(builtin.find(d => d.id === id)!)

function piece(id: string, x: number, y: number, angle = 0, extra: Partial<Piece> = {}): Piece {
  return {
    id, kind: 'domino', x, y, angle, facing: 'east', label: id,
    height: 1.6, width: 0.42, fallThreshold: 0.8, friction: 0.55, ...extra,
  }
}

describe('剖面烘焙', () => {
  it('单段木片烘焙出矩形轮廓与四条边，底边为支架边', () => {
    const version = versionOf(DEFAULT_PROFILE_ID)
    expect(version.polygon.length).toBe(4)
    expect(version.edges.filter(e => e.role === 'support')).toHaveLength(1)
    expect(version.edges.filter(e => e.role === 'contact')).toHaveLength(3)
    expect(version.centerOfMass.x).toBeCloseTo(0, 6)
    expect(version.centerOfMass.y).toBeCloseTo(0.8, 6)
    expect(version.inertia).toBeGreaterThan(0)
  })

  it('内凹双触点件的轮廓是凹多边形且带凹槽', () => {
    const version = versionOf(NOTCH_PROFILE_ID)
    // 凹多边形：沿环走向存在叉积符号与总体（逆时针为正）相反的凹顶点
    const poly = version.polygon
    let hasReflex = false
    for (let i = 0; i < poly.length; i++) {
      const p = poly[(i - 1 + poly.length) % poly.length]
      const q = poly[i]
      const r = poly[(i + 1) % poly.length]
      const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x)
      if (cross < -1e-9) hasReflex = true
    }
    expect(hasReflex).toBe(true)
    expect(version.edges.length).toBeGreaterThan(4)
    expect(version.centerOfMass.y).toBeGreaterThan(0)
    // 凹腔内壁被标为支架边，叉齿前缘竖边仍是接触边
    expect(version.edges.some(e => e.role === 'support' && Math.abs(e.normal.y + 1) < 1e-9 && e.a.y > 0.1)).toBe(true)
    expect(version.edges.filter(e => e.role === 'contact' && Math.abs(e.normal.x) > 0.9).length).toBeGreaterThanOrEqual(2)
  })

  it('坡面支脚件重心随偏置部件移动', () => {
    const version = versionOf(FOOT_PROFILE_ID)
    // 主体偏右（+0.12），重心 x 应明显偏正
    expect(version.centerOfMass.x).toBeGreaterThan(0.05)
  })

  it('内容寻址：相同定义得到相同 checksum，改任意字段产生新版本', () => {
    const def = structuredClone(builtin.find(d => d.id === DEFAULT_PROFILE_ID)!)
    const a = bake(def).checksum
    const b = bake(structuredClone(def)).checksum
    expect(a).toBe(b)
    const changed = structuredClone(def)
    changed.segments[0].height = 1.8
    expect(bake(changed).checksum).not.toBe(a)
  })
})

/** 台阶目标：高柱在右、矮柱在左、底部连通；两个承接竖面前后错开。 */
function steppedTargetVersion(): ProfileVersion {
  return bake({
    id: 'step', name: '台阶承接牌', createdAt: 1, edgeOverrides: {},
    segments: [
      { label: '高柱', width: 0.3, height: 1.7, offsetX: 0.22, offsetY: 0, density: 1 },
      { label: '矮柱', width: 0.3, height: 0.55, offsetX: -0.22, offsetY: 0, density: 1 },
      { label: '底梁', width: 0.74, height: 0.12, offsetX: 0, offsetY: 0, density: 1 },
    ],
  })
}

describe('真实轮廓接触（拒绝包围盒误判）', () => {
  it('不能把包围盒最靠近的那一边误认为第一个接触点', () => {
    // 内凹 C 牌 A 向右倒，台阶目标 B 承接。
    // 包围盒最靠近的是上叉齿的水平顶面，但真实第一接触由叉齿“竖直接触边”产生；
    // 求解器必须报告竖直边（法线近似水平），而不是那条离得更近的水平边。
    const notch = versionOf(NOTCH_PROFILE_ID)
    const step = steppedTargetVersion()
    const a = piece('A', 0, 0, 0, { width: 0.8, height: 1.8 })
    const b = piece('B', 0.885, 0, 0, { width: 0.74, height: 1.7 })
    const pivot = computePivot(a, notch, [])
    const contact = findFirstContact(a, notch, pivot, [staticTargetOf(b, step)], 9.8)
    expect(contact).not.toBeNull()
    expect(contact!.targetPieceId).toBe('B')
    for (const p of contact!.points) {
      // 首先接触的是叉齿的竖直接触边（法线近似水平），而非包围盒最近的水平顶面
      expect(Math.abs(p.sourceEdge.normal.x)).toBeGreaterThan(0.9)
      expect(p.sourceEdge.role).toBe('contact')
      expect(p.targetEdge.role).toBe('contact')
    }
  })

  it('内凹轮廓在台阶目标上产生双接触点（两叉齿同时撞上两个承接面）', () => {
    const notch = versionOf(NOTCH_PROFILE_ID)
    const step = steppedTargetVersion()
    const a = piece('A', 0, 0, 0, { width: 0.8, height: 1.8 })
    const b = piece('B', 0.885, 0, 0, { width: 0.74, height: 1.7 })
    const pivot = computePivot(a, notch, [])
    // 先确认初始姿态两牌分离（不是预先穿透）
    const initial = polygonContact(
      sweptPolygon(notch, pivot, 0, 0, -1),
      staticTargetOf(b, step).polygon,
    )
    expect(initial.collided).toBe(false)
    const contact = findFirstContact(a, notch, pivot, [staticTargetOf(b, step)], 9.8)
    expect(contact).not.toBeNull()
    expect(contact!.contactPointCount).toBeGreaterThanOrEqual(2)
    // 两个接触点在空间上明显分离，分别来自上、下叉齿
    const [p1, p2] = contact!.points
    expect(Math.hypot(p1.point.x - p2.point.x, p1.point.y - p2.point.y)).toBeGreaterThan(0.3)
  })

  it('支架边不传播：仅支架边相碰时不产生接触事件', () => {
    // 矮牌底边为 support；微小目标放在支脚后方地面的“支架边专属扫掠区”，
    // 两条竖接触边的扫掠弧线都从它上方越过，只有 support 底边会扫到 → 不产生传播
    const low = bake({
      id: 'low', name: '矮牌', createdAt: 1, edgeOverrides: {},
      segments: [{ label: 'm', width: 0.5, height: 0.5, offsetX: 0, offsetY: 0, density: 1 }],
    })
    const tiny = bake({
      id: 'tiny', name: '微小目标', createdAt: 1, edgeOverrides: {},
      segments: [{ label: 't', width: 0.04, height: 0.04, offsetX: 0, offsetY: 0, density: 1 }],
    })
    const a = piece('A', 0, 0, 0, { width: 0.5, height: 0.5 })
    const target = piece('LOW', 0.15, -0.05, 0, { width: 0.04, height: 0.04 })
    const pivot = computePivot(a, low, [])
    const initial = polygonContact(sweptPolygon(low, pivot, 0, 0, -1), staticTargetOf(target, tiny).polygon)
    expect(initial.collided).toBe(false)
    const contact = findFirstContact(a, low, pivot, [staticTargetOf(target, tiny)], 9.8)
    expect(contact).toBeNull()
  })

  it('真实轮廓先碰到几何上先相交者，而不是按包围盒/中心距排序', () => {
    const notch = versionOf(NOTCH_PROFILE_ID)
    const step = steppedTargetVersion()
    const a = piece('A', 0, 0, 0, { width: 0.8, height: 1.8 })
    const pivot = computePivot(a, notch, [])
    // 两个相同台阶承接牌，C 近、D 远。
    const c = piece('C', 0.885, 0, 0, { width: 0.74, height: 1.7 })
    const d = piece('D', 1.3, 0, 0, { width: 0.74, height: 1.7 })
    // 单独计算各自的真实第一接触角
    const angleC = findFirstContact(a, notch, pivot, [staticTargetOf(c, step)], 9.8)
    const angleD = findFirstContact(a, notch, pivot, [staticTargetOf(d, step)], 9.8)
    expect(angleC).not.toBeNull()
    expect(angleD).not.toBeNull()
    expect(angleC!.theta).toBeLessThan(angleD!.theta)
    // 同时在场时，求解器按真实接触角选 C，且命中的是竖直接触边而非包围盒最近的水平边
    const winner = findFirstContact(
      a, notch, pivot,
      [staticTargetOf(c, step), staticTargetOf(d, step)], 9.8,
    )
    expect(winner!.targetPieceId).toBe('C')
    expect(winner!.points.every(p => Math.abs(p.sourceEdge.normal.x) > 0.9)).toBe(true)
  })

  it('多边形接触检测对相交与分离给出正确判定', () => {
    const hit = polygonContact([v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
      [v(0.5, 0.5), v(1.5, 0.5), v(1.5, 1.5), v(0.5, 1.5)])
    expect(hit.collided).toBe(true)
    const miss = polygonContact([v(0, 0), v(1, 0), v(1, 1), v(0, 1)],
      [v(2, 2), v(3, 2), v(3, 3), v(2, 3)])
    expect(miss.collided).toBe(false)
  })
})

describe('坡面托起的支脚', () => {
  it('支脚落在坡面上时支点被抬高，并记录坡道 id', () => {
    const foot = versionOf(FOOT_PROFILE_ID)
    // 脚的支撑边（基线）与坡道斜面相交，交点成为被托起的支脚
    const onRamp = piece('F', 0, 0.2, 0, { width: 0.5, height: 1.5 })
    const rampPiece = piece('R', 0, 0, 0, { kind: 'ramp', width: 1.2, height: 0.5 })
    const ramp = rampShape(rampPiece)
    const pivot = computePivot(onRamp, foot, [ramp])
    expect(pivot.rampId).toBe('R')
    expect(pivot.point.y).toBeGreaterThan(0.05)
  })

  it('没有坡面时支脚落在地面 y=0', () => {
    const standard = versionOf(DEFAULT_PROFILE_ID)
    const pivot = computePivot(piece('A', 1, 0, 0), standard, [])
    expect(pivot.point.y).toBeCloseTo(0, 6)
    expect(pivot.rampId).toBeNull()
  })
})

describe('引用旧剖面与历史形状', () => {
  it('旧档迁移后，旧牌按当时 width/height 得到专属历史剖面', () => {
    const legacyDef = builtin.find(d => d.id === LEGACY_PROFILE_ID)!
    const oldPiece = piece('old1', 0, 0, 0, { width: 0.6, height: 2.0 })
    const doc = ensureProfiles({
      id: 'doc', title: 't', revision: 1, updatedAt: 0,
      pieces: [oldPiece],
      connections: [], scene: { gravity: 9.8, friction: 0.6, width: 20, height: 10, showGrid: true },
      startPieceId: 'old1', profiles: [], profileVersions: [],
    } as never)
    const migrated = doc.pieces[0]
    expect(migrated.profileId).toContain(LEGACY_PROFILE_ID)
    const version = resolveVersion(doc, migrated)!
    expect(version).toBeTruthy()
    expect(version.bounds.maxX - version.bounds.minX).toBeCloseTo(0.6, 6)
    expect(version.bounds.maxY - version.bounds.minY).toBeCloseTo(2.0, 6)
    void legacyDef
  })

  it('修改剖面只产生新版本，旧 checksum 的版本仍被保留', () => {
    const def = structuredClone(builtin.find(d => d.id === DEFAULT_PROFILE_ID)!)
    const v1 = bake(def)
    const changed = structuredClone(def)
    changed.segments[0].width = 0.55
    const v2 = bake(changed)
    expect(v1.checksum).not.toBe(v2.checksum)
    // 旧牌继续引用 v1 时，轮廓宽度不变
    const oldPiece = piece('old', 0, 0, 0, { profileVersion: v1.checksum, profileId: def.id })
    const doc = ensureProfiles({
      id: 'doc', title: 't', revision: 1, updatedAt: 0,
      pieces: [oldPiece], connections: [],
      scene: { gravity: 9.8, friction: 0.6, width: 20, height: 10, showGrid: true },
      startPieceId: 'old', profiles: [def, changed], profileVersions: [v1, v2],
    } as never)
    expect(resolveVersion(doc, oldPiece)!.checksum).toBe(v1.checksum)
  })
})

describe('姿态变换', () => {
  it('绕支脚转动后，轮廓以支脚为固定点旋转', () => {
    const standard = versionOf(DEFAULT_PROFILE_ID)
    const domino = piece('A', 0, 0, 0)
    const pivot = computePivot(domino, standard, [])
    const at0 = sweptPolygon(standard, pivot, 0, 0)
    const at90 = sweptPolygon(standard, pivot, 0, Math.PI / 2)
    // 支脚在两次姿态下保持不动
    const pivotAt90 = at90.find(p => Math.abs(p.x - pivot.point.x) < 1e-9 && Math.abs(p.y - pivot.point.y) < 1e-9)
    expect(pivotAt90).toBeTruthy()
    // 原本竖直向上的牌，转 90° 后最高点大幅下降
    const top0 = Math.max(...at0.map(p => p.y))
    const top90 = Math.max(...at90.map(p => p.y))
    expect(top90).toBeLessThan(top0 - 0.5)
  })
})
