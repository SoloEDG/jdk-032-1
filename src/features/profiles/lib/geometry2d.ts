import type { Vec2 } from '@/shared/document'

/** 纯数学 2D 几何工具。统一使用 y 轴朝上的右手坐标系。 */

export const v = (x: number, y: number): Vec2 => ({ x, y })
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const dist = (a: Vec2, b: Vec2): number => len(sub(a, b))

export function normalize(a: Vec2): Vec2 {
  const l = len(a)
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l }
}
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y })

export function rotate(a: Vec2, rad: number): Vec2 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

/** 有符号面积：正值表示逆时针（y 朝上）。 */
export function signedArea(poly: readonly Vec2[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    sum += cross(p, q)
  }
  return sum / 2
}

/** 多边形重心（非凸也成立，按面积加权）。 */
export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  let area2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const f = cross(p, q)
    area2 += f
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  if (Math.abs(area2) < 1e-12) {
    const mean = poly.reduce((acc, p) => add(acc, p), v(0, 0))
    return scale(mean, 1 / poly.length)
  }
  return { x: cx / (3 * area2), y: cy / (3 * area2) }
}

export function boundsOf(poly: readonly Vec2[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

/** 点是否在多边形内或边界上（射线法，适用于非凸多边形）。 */
export function pointInPolygon(point: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (pointOnSegment(point, a, b)) return true
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

export function pointOnSegment(point: Vec2, a: Vec2, b: Vec2, eps = 1e-9): boolean {
  const ab = sub(b, a)
  const ap = sub(point, a)
  if (Math.abs(cross(ab, ap)) > eps * Math.max(1, len(ab))) return false
  return dot(ap, sub(b, point)) >= -eps
}

/** 点到线段的最近点与距离。 */
export function closestPointOnSegment(point: Vec2, a: Vec2, b: Vec2): { point: Vec2; distance: number; t: number } {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(point, a), ab) / l2))
  const closest = add(a, scale(ab, t))
  return { point: closest, distance: dist(point, closest), t }
}

export interface SegmentHit {
  point: Vec2
  /** 第一条线段上的参数 t */
  t1: number
  /** 第二条线段上的参数 t */
  t2: number
}

/** 两条线段求交（含端点相接），平行/共线重叠时返回第一个重叠端点。 */
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): SegmentHit | null {
  const r = sub(a2, a1)
  const s = sub(b2, b1)
  const rxs = cross(r, s)
  const qp = sub(b1, a1)
  if (Math.abs(rxs) > 1e-10) {
    const t = cross(qp, s) / rxs
    const u = cross(qp, r) / rxs
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
      return { point: add(a1, scale(r, Math.max(0, Math.min(1, t)))), t1: t, t2: u }
    }
    return null
  }
  if (Math.abs(cross(qp, r)) > 1e-9) return null
  // 共线：找参数区间重叠
  const r2 = dot(r, r)
  if (r2 < 1e-12) return pointOnSegment(a1, b1, b2) ? { point: a1, t1: 0, t2: 0 } : null
  const t0 = dot(sub(b1, a1), r) / r2
  const t1 = dot(sub(b2, a1), r) / r2
  const lo = Math.max(0, Math.min(t0, t1))
  const hi = Math.min(1, Math.max(t0, t1))
  if (lo > hi + 1e-9) return null
  return { point: add(a1, scale(r, lo)), t1: lo, t2: 0 }
}

export interface EdgeSegment {
  a: Vec2
  b: Vec2
  edgeIndex: number
}

export function edgeSegments(poly: readonly Vec2[]): EdgeSegment[] {
  return poly.map((point, i) => ({ a: point, b: poly[(i + 1) % poly.length], edgeIndex: i }))
}

export interface ContactPoint {
  point: Vec2
  /** 源多边形边索引（若由该边产生） */
  sourceEdge: number
  /** 目标多边形边索引 */
  targetEdge: number
  normal: Vec2
}

export interface PolygonContact {
  collided: boolean
  /** 去重后的真实接触点（内凹轮廓可以同时有两个，即“内凹双触点”） */
  points: ContactPoint[]
  /** 穿透深度估计（SAT），未接触为 0 */
  penetration: number
}

/**
 * 两个（可非凸）多边形的接触检测。
 * 先用包围盒粗筛——包围盒只用于加速，真正的接触判定全部基于真实边/顶点几何。
 * 接触点由“边-边相交”和“顶点落在对方边界上”两类证据合并去重得到，
 * 因此不会把包围盒最靠近的那一边误认为第一接触点。
 */
export function polygonContact(
  source: readonly Vec2[],
  target: readonly Vec2[],
  sourceBounds?: ReturnType<typeof boundsOf>,
  targetBounds?: ReturnType<typeof boundsOf>,
): PolygonContact {
  const sb = sourceBounds ?? boundsOf(source)
  const tb = targetBounds ?? boundsOf(target)
  if (sb.maxX < tb.minX - 1e-9 || sb.minX > tb.maxX + 1e-9
    || sb.maxY < tb.minY - 1e-9 || sb.minY > tb.maxY + 1e-9) {
    return { collided: false, points: [], penetration: 0 }
  }

  const sEdges = edgeSegments(source)
  const tEdges = edgeSegments(target)
  const points: ContactPoint[] = []

  const pushPoint = (point: Vec2, sIdx: number, tIdx: number, normal: Vec2) => {
    if (!points.some(p => dist(p.point, point) < 1e-7)) {
      points.push({ point, sourceEdge: sIdx, targetEdge: tIdx, normal })
    }
  }

  for (const se of sEdges) {
    for (const te of tEdges) {
      const hit = segmentIntersection(se.a, se.b, te.a, te.b)
      if (hit) {
        const n = normalize(perp(sub(te.b, te.a)))
        pushPoint(hit.point, se.edgeIndex, te.edgeIndex, n)
      }
    }
  }

  // 顶点贴在对方边上（贴合但尚未横切的情形）
  for (const se of sEdges) {
    for (const vertex of [se.a, se.b]) {
      if (pointInPolygon(vertex, target)) {
        let best: { point: Vec2; distance: number; t: number } | null = null
        let bestIdx = -1
        for (const te of tEdges) {
          const cand = closestPointOnSegment(vertex, te.a, te.b)
          if (!best || cand.distance < best.distance) {
            best = cand
            bestIdx = te.edgeIndex
          }
        }
        if (best && best.distance < 1e-7) {
          const te = tEdges[bestIdx]
          pushPoint(best.point, se.edgeIndex, bestIdx, normalize(perp(sub(te.b, te.a))))
        }
      }
    }
  }
  for (const te of tEdges) {
    for (const vertex of [te.a, te.b]) {
      if (pointInPolygon(vertex, source)) {
        let best: { point: Vec2; distance: number; t: number } | null = null
        let bestIdx = -1
        for (const se of sEdges) {
          const cand = closestPointOnSegment(vertex, se.a, se.b)
          if (!best || cand.distance < best.distance) {
            best = cand
            bestIdx = se.edgeIndex
          }
        }
        if (best && best.distance < 1e-7) {
          const se = sEdges[bestIdx]
          pushPoint(best.point, bestIdx, te.edgeIndex, normalize(perp(sub(se.b, se.a))))
        }
      }
    }
  }

  const penetration = points.length ? satOverlap(source, target) : 0
  return { collided: points.length > 0, points: clusterContactPoints(points), penetration }
}

/**
 * 把边-边贴合产生的近邻原始接触点聚成“接触簇”。
 * 同一簇代表同一个接触位置（取质心）；空间上分离的簇各自独立计数，
 * 因此内凹轮廓同时撞上两个台阶面时会得到两个接触簇（内凹双触点）。
 */
export function clusterContactPoints(points: ContactPoint[], tolerance = 0.06): ContactPoint[] {
  const clusters: ContactPoint[][] = []
  for (const p of points) {
    const idx = clusters.findIndex(cluster =>
      cluster.some(q => dist(q.point, p.point) <= tolerance))
    if (idx >= 0) clusters[idx].push(p)
    else clusters.push([p])
  }
  return clusters.map(cluster => {
    const centroid = scale(cluster.reduce((acc, p) => add(acc, p.point), v(0, 0)), 1 / cluster.length)
    // 优先保留角色信息最明确（法线非零）的成员作为代表
    const representative = cluster.find(p => len(p.normal) > 0.5) ?? cluster[0]
    return {
      point: centroid,
      sourceEdge: representative.sourceEdge,
      targetEdge: representative.targetEdge,
      normal: representative.normal,
    }
  })
}

/** SAT 穿透深度：沿两边全部法线求最小分离（用于接触法线与排序，不参与“是否接触”的最终裁决）。 */
export function satOverlap(source: readonly Vec2[], target: readonly Vec2[]): number {
  let minOverlap = Infinity
  for (const poly of [source, target]) {
    for (let i = 0; i < poly.length; i++) {
      const normal = normalize(perp(sub(poly[(i + 1) % poly.length], poly[i])))
      if (len(normal) === 0) continue
      let sMin = Infinity
      let sMax = -Infinity
      let tMin = Infinity
      let tMax = -Infinity
      for (const p of source) {
        const d = dot(p, normal)
        sMin = Math.min(sMin, d)
        sMax = Math.max(sMax, d)
      }
      for (const p of target) {
        const d = dot(p, normal)
        tMin = Math.min(tMin, d)
        tMax = Math.max(tMax, d)
      }
      const overlap = Math.min(sMax, tMax) - Math.max(sMin, tMin)
      minOverlap = Math.min(minOverlap, overlap)
    }
  }
  return Math.max(0, minOverlap)
}

/** 刚体姿态：把局部点变换到世界坐标。y 朝上，angle 为弧度、逆时针为正。 */
export function toWorld(local: Vec2, position: Vec2, angleRad: number): Vec2 {
  return add(position, rotate(local, angleRad))
}

export function transformPolygon(poly: readonly Vec2[], position: Vec2, angleRad: number): Vec2[] {
  return poly.map(p => toWorld(p, position, angleRad))
}
