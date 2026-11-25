import type { Piece, ProfileEdge, ProfileVersion, Vec2 } from '@/shared/document'
import {
  boundsOf, closestPointOnSegment, dist, normalize, pointInPolygon, polygonContact,
  rotate, segmentIntersection, sub, transformPolygon,
} from './geometry2d'
import { supportEdges } from './bake'

/**
 * 倒下物理：牌被视为绕“支脚”转动的刚体。
 * 支脚是最低支撑点；若该支撑边搭在坡道斜面上，则由坡面托起（支点抬高）。
 * 角速度用重力势能守恒求解，接触判定全部基于真实外轮廓扫掠，
 * 包围盒只做粗筛，绝不参与第一接触点裁决。
 */

export interface RampShape {
  piece: Piece
  polygon: Vec2[]
  edges: ProfileEdge[]
}

export interface Pivot {
  /** 支脚世界坐标 */
  point: Vec2
  /** 支脚在牌局部坐标中的位置 */
  local: Vec2
  /** 托起该支脚的坡道 id（若有） */
  rampId: string | null
  /** 坡面接触法线 */
  normal: Vec2
}

const deg = (r: number) => (r * 180) / Math.PI
const rad = (d: number) => (d * Math.PI) / 180

/** 生成坡道的静态三角轮廓与边（索引 1 即坡面斜边，contact 边）。 */
export function rampShape(piece: Piece): RampShape {
  const w = piece.width
  const h = piece.height
  const angle = rad(piece.angle)
  const bl: Vec2 = { x: -w / 2, y: 0 }
  const br: Vec2 = { x: w / 2, y: 0 }
  const tr: Vec2 = { x: w / 2, y: h }
  const local = [bl, br, tr]
  const polygon = transformPolygon(local, { x: piece.x, y: piece.y }, angle)
  const edges: ProfileEdge[] = [
    { a: bl, b: br, role: 'support', normal: { x: 0, y: -1 } },
    // 坡面：从顶端到左下，外法线指向坡外（左上）
    { a: tr, b: bl, role: 'contact', normal: normalize({ x: -h, y: w }) },
    { a: br, b: tr, role: 'contact', normal: { x: 1, y: 0 } },
  ]
  return { piece, polygon, edges }
}

/** 坡道斜边（世界坐标端点 + 局部边）。 */
export function rampSlope(ramp: RampShape) {
  const slopeLocal = ramp.edges[1]
  const angle = rad(ramp.piece.angle)
  return {
    a: { x: ramp.piece.x + rotate(slopeLocal.a, angle).x, y: ramp.piece.y + rotate(slopeLocal.a, angle).y },
    b: { x: ramp.piece.x + rotate(slopeLocal.b, angle).x, y: ramp.piece.y + rotate(slopeLocal.b, angle).y },
    local: slopeLocal,
  }
}

/**
 * 计算支脚。默认取最低支撑点；若某条支撑边与坡道斜面相交，
 * 取最高交点作为被坡面托起的抬高支点（牌被抬离地面，绕该点转动）。
 */
export function computePivot(
  piece: Piece,
  version: ProfileVersion,
  ramps: RampShape[],
): Pivot {
  const angle = rad(piece.angle)
  const position = { x: piece.x, y: piece.y }
  const fallSign = fallDirection(piece)
  // 倒下方向（朝向）的单位向量；顺时针倒下时，支脚取朝向一侧、且贴地的支撑顶点
  const facing = rotate({ x: 1, y: 0 }, angle)
  const ground = supportEdges(version)
  const supportVerts: Array<{ local: Vec2; world: Vec2 }> = []
  for (const edge of ground) {
    for (const local of [edge.a, edge.b]) {
      supportVerts.push({
        local,
        world: { x: position.x + rotate(local, angle).x, y: position.y + rotate(local, angle).y },
      })
    }
  }
  const minY = Math.min(...supportVerts.map(s => s.world.y))
  const onGround = supportVerts.filter(s => Math.abs(s.world.y - minY) < 1e-9)
  // 在贴地支撑点里取朝向投影最大者（倒下一侧的角点）
  const chosen = onGround.sort((p, q) => {
    const dp = facing.x * p.local.x + facing.y * p.local.y
    const dq = facing.x * q.local.x + facing.y * q.local.y
    return dq - dp
  })[0]
  const bestLocal = chosen.local
  const fallback: Pivot = {
    point: chosen.world,
    local: bestLocal,
    rampId: null,
    normal: { x: 0, y: 1 },
  }

  let lifted: Pivot | null = null
  for (const edge of ground) {
    const a = { x: position.x + rotate(edge.a, angle).x, y: position.y + rotate(edge.a, angle).y }
    const b = { x: position.x + rotate(edge.b, angle).x, y: position.y + rotate(edge.b, angle).y }
    for (const ramp of ramps) {
      const slope = rampSlope(ramp)
      const hit = segmentIntersection(a, b, slope.a, slope.b)
      if (hit && (!lifted || hit.point.y > lifted.point.y)) {
        const rel = sub(hit.point, position)
        lifted = {
          point: hit.point,
          local: rotate(rel, -angle),
          rampId: ramp.piece.id,
          normal: rotate(slope.local.normal, rad(ramp.piece.angle)),
        }
      }
    }
  }
  // 支撑边与坡面相交即表示该脚被坡道托起：取交点为支点（替代地面）。
  // 要求交点处坡面位于基线之上（真的“托起”），而不是仅在地面入口相切。
  if (lifted && lifted.point.y >= fallback.point.y - 1e-9 && lifted.point.y > 1e-6) {
    return lifted
  }
  return fallback
}

/** 倒下方向：沿朝向（facing）倒下时为顺时针，返回 -1；反向为 +1。默认顺时针。 */
export function fallDirection(piece: Piece): number {
  // facing 目前统一为 east，angle 表示绕 z 的姿态；倒向始终取朝向一侧（顺时针）
  return -1
}

/** 绕支脚转动 theta（弧度，theta>=0，按 fallSign 决定顺/逆时针）后的世界轮廓。 */
export function sweptPolygon(
  version: ProfileVersion,
  pivot: Pivot,
  baseAngleRad: number,
  theta: number,
  fallSign = -1,
): Vec2[] {
  const signed = theta * fallSign
  return version.polygon.map(local => {
    const rel = sub(local, pivot.local)
    const turned = rotate(rel, signed)
    return { x: pivot.point.x + turned.x, y: pivot.point.y + turned.y }
  })
}

/** 给定 theta 时重心世界坐标（theta>=0，按 fallSign 决定方向）。 */
export function comAt(version: ProfileVersion, pivot: Pivot, theta: number, fallSign = -1): Vec2 {
  const rel = sub(version.centerOfMass, pivot.local)
  const turned = rotate(rel, theta * fallSign)
  return { x: pivot.point.x + turned.x, y: pivot.point.y + turned.y }
}

/**
 * 能量守恒下的角速度：1/2 (I + d²) ω² = g Δh。
 * d 为重心到支脚距离，Δh 为重心相对初始位置下降的高度。
 */
export function angularVelocity(
  version: ProfileVersion,
  pivot: Pivot,
  theta: number,
  gravity: number,
): number {
  const com0 = comAt(version, pivot, 0)
  const comT = comAt(version, pivot, theta)
  const drop = com0.y - comT.y
  const d = dist(version.centerOfMass, pivot.local)
  const moment = version.inertia + d * d
  const effective = Math.max(0, drop)
  return Math.sqrt((2 * gravity * effective) / moment)
}

/** 倒下到 theta 所需时间：数值积分 dt = dθ / ω(θ)，起始给一个极小推动角速度。 */
export function timeToAngle(
  version: ProfileVersion,
  pivot: Pivot,
  theta: number,
  gravity: number,
  pushOmega = 0.35,
): number {
  const d = dist(version.centerOfMass, pivot.local)
  const moment = version.inertia + d * d
  const com0 = comAt(version, pivot, 0)
  const steps = Math.max(16, Math.ceil(theta / 0.01))
  let time = 0
  for (let i = 0; i < steps; i++) {
    const t0 = (theta * i) / steps
    const t1 = (theta * (i + 1)) / steps
    const omega = (th: number) => {
      const drop = com0.y - comAt(version, pivot, th).y
      const fromEnergy = Math.sqrt(Math.max(0, (2 * gravity * Math.max(0, drop)) / moment))
      return Math.max(pushOmega, fromEnergy)
    }
    time += (t1 - t0) / Math.max(1e-6, (omega(t0) + omega(t1)) / 2)
  }
  return time
}

export interface StaticTarget {
  piece: Piece
  version: ProfileVersion
  polygon: Vec2[]
  edges: ProfileEdge[]
  bounds: ReturnType<typeof boundsOf>
}

/** 把一枚静止摆件按其引用的剖面版本烘焙成世界轮廓目标。 */
export function staticTargetOf(piece: Piece, version: ProfileVersion): StaticTarget {
  const polygon = transformPolygon(version.polygon, { x: piece.x, y: piece.y }, rad(piece.angle))
  return {
    piece,
    version,
    polygon,
    edges: version.edges,
    bounds: boundsOf(polygon),
  }
}

export interface FirstContact {
  targetPieceId: string
  theta: number
  thetaDeg: number
  points: Array<{ point: Vec2; normal: Vec2; sourceEdge: ProfileEdge; targetEdge: ProfileEdge }>
  contactPointCount: number
}

/**
 * 对全部静止候选做真实轮廓扫掠，返回最先发生的“可传播”接触。
 * 接触必须同时落在两张牌的 contact 边上；support 边（支架/坡面）不传播倒下。
 * 同一时刻出现两个接触点时全部保留（内凹双触点）。
 */
export function findFirstContact(
  piece: Piece,
  version: ProfileVersion,
  pivot: Pivot,
  candidates: StaticTarget[],
  gravity: number,
): FirstContact | null {
  const baseAngle = rad(piece.angle)
  const facing = rotate({ x: 1, y: 0 }, baseAngle)
  const reach = circumRadius(version, pivot.local)
  const broad = candidates.filter(target => {
    const delta = sub(target.piece, piece)
    const forward = delta.x * facing.x + delta.y * facing.y
    if (forward < -Math.max(version.bounds.maxX, 0.4)) return false
    const targetReach = circumRadius(target.version, { x: 0, y: 0 })
    return dist(piece, target.piece) <= reach + targetReach + 0.5
  })
  if (!broad.length) return null

  const maxTheta = rad(92)
  const coarseSteps = 184
  const fallSign = fallDirection(piece)
  let winner: FirstContact | null = null

  for (const target of broad) {
    const hit = sweepForTarget(piece, version, pivot, target, maxTheta, coarseSteps, fallSign)
    if (hit === null) continue
    const candidate = buildContact(version, target, hit)
    if (!winner || candidate.theta < winner.theta - 1e-9) {
      winner = candidate
    } else if (Math.abs(candidate.theta - winner.theta) <= rad(1.5)) {
      // 同一时刻：保留接触点更多者（内凹双触点优先），否则维持稳定顺序
      if (candidate.contactPointCount > winner.contactPointCount) winner = candidate
    }
  }
  return winner
}

function sweepForTarget(
  piece: Piece,
  version: ProfileVersion,
  pivot: Pivot,
  target: StaticTarget,
  maxTheta: number,
  coarseSteps: number,
  fallSign: number,
): SweepHit | null {
  const base = rad(piece.angle)
  const firstCollision = (theta: number) => {
    const poly = sweptPolygon(version, pivot, base, theta, fallSign)
    const contact = polygonContact(poly, target.polygon, boundsOf(poly), target.bounds)
    if (!contact.collided) return null
    return contact
  }

  let crossedAt = -1
  for (let i = 1; i <= coarseSteps; i++) {
    const theta = (maxTheta * i) / coarseSteps
    if (firstCollision(theta)) {
      crossedAt = theta
      break
    }
  }
  if (crossedAt < 0) return null

  // 二分细化到边级精度
  let lo = Math.max(0, crossedAt - maxTheta / coarseSteps)
  let hi = crossedAt
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (firstCollision(mid)) hi = mid
    else lo = mid
  }
  const theta = hi

  // 在第一接触角附近的小窗口内收集“近乎同时”的全部接触簇，
  // 让内凹轮廓在同一倾倒角分别撞上两个台阶面时被识别为双触点，
  // 而不是只保留二分数值上最早的那一个点。
  const window = rad(1.5)
  const clusters = new Map<string, { theta: number; sourceEdge: number; targetEdge: number; point: Vec2; normal: Vec2 }>()
  const probeSteps = 12
  for (let i = 0; i <= probeSteps; i++) {
    const probe = theta + (window * i) / probeSteps
    const poly = sweptPolygon(version, pivot, base, probe, fallSign)
    const contact = polygonContact(poly, target.polygon, boundsOf(poly), target.bounds)
    for (const p of contact.points) {
      const se = version.edges[p.sourceEdge]
      const te = target.edges[p.targetEdge]
      if (!se || !te || se.role !== 'contact' || te.role !== 'contact') continue
      const k = `${p.sourceEdge}:${p.targetEdge}`
      const existing = clusters.get(k)
      if (!existing || probe < existing.theta) {
        clusters.set(k, { theta: probe, sourceEdge: p.sourceEdge, targetEdge: p.targetEdge, point: p.point, normal: p.normal })
      }
    }
  }
  if (!clusters.size) return null
  // 只保留发生在最早接触时刻附近（窗口内）的簇
  const earliest = Math.min(...Array.from(clusters.values()).map(c => c.theta))
  const near = [...clusters.values()].filter(c => c.theta <= earliest + window)
  return { theta: earliest, clusters: near }
}

interface SweepHit {
  theta: number
  clusters: Array<{ theta: number; sourceEdge: number; targetEdge: number; point: Vec2; normal: Vec2 }>
}

function buildContact(version: ProfileVersion, target: StaticTarget, hit: SweepHit): FirstContact {
  const points = hit.clusters.map(c => ({
    point: c.point,
    normal: c.normal,
    sourceEdge: version.edges[c.sourceEdge],
    targetEdge: target.edges[c.targetEdge],
  })).filter(p => p.sourceEdge && p.targetEdge)
  return {
    targetPieceId: target.piece.id,
    theta: hit.theta,
    thetaDeg: deg(hit.theta),
    points,
    contactPointCount: points.length,
  }
}

/** 轮廓上离给定参考点最远的距离，用于宽相裁剪。 */
export function circumRadius(version: ProfileVersion, reference: Vec2): number {
  let max = 0
  for (const p of version.polygon) max = Math.max(max, dist(p, reference))
  return max
}

/** 重心是否已越过支脚（用于判断无推动时是否会自行倾倒）。 */
export function comBeyondPivot(version: ProfileVersion, pivot: Pivot): boolean {
  const rel = sub(version.centerOfMass, pivot.local)
  return rel.x > 1e-6
}

/** 工具：点是否在某姿态轮廓内。 */
export function insideProfile(version: ProfileVersion, position: Vec2, angleRad: number, point: Vec2): boolean {
  return pointInPolygon(point, transformPolygon(version.polygon, position, angleRad))
}
