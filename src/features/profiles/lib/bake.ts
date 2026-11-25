import type { EdgeRole, ProfileDef, ProfileEdge, ProfileVersion, SegmentSpec, Vec2 } from '@/shared/document'
import {
  boundsOf, cross, dist, normalize, perp, polygonCentroid, rotate, signedArea, sub,
} from './geometry2d'

interface Rect { x0: number; x1: number; y0: number; y1: number; spec: SegmentSpec }

const EPS = 1e-9
const key = (n: number) => Math.round(n * 1e6) / 1e6

function toRect(spec: SegmentSpec): Rect {
  const y0 = spec.offsetY ?? 0
  return {
    x0: spec.offsetX - spec.width / 2,
    x1: spec.offsetX + spec.width / 2,
    y0,
    y1: y0 + spec.height,
    spec,
  }
}

interface BoundarySeg { a: Vec2; b: Vec2 }

function dedupeSegs(segs: BoundarySeg[]): BoundarySeg[] {
  const seen = new Set<string>()
  const out: BoundarySeg[] = []
  for (const s of segs) {
    const k = [s.a.x, s.a.y, s.b.x, s.b.y].map(n => key(n)).join(',')
    const rk = [s.b.x, s.b.y, s.a.x, s.a.y].map(n => key(n)).join(',')
    if (seen.has(k) || seen.has(rk)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/**
 * 求若干轴对齐矩形的并集边界。
 * 只有当另一个矩形的“内部”严格包含某条边时才裁剪（共面外表面保留），
 * 裁完后把共线相接/重叠的段合并，再缝合成单一环（允许内凹）。
 */
export function unionOutline(segments: SegmentSpec[]): Vec2[] {
  const rects = segments.map(toRect)
  const boundary: BoundarySeg[] = []

  for (const r of rects) {
    // 竖直边：仅当 c 严格落在另一矩形 x 区间内部时，对应 y 段才被覆盖
    for (const c of [r.x0, r.x1]) {
      let spans: Array<[number, number]> = [[r.y0, r.y1]]
      for (const other of rects) {
        if (other === r) continue
        if (other.x0 + EPS < c && c < other.x1 - EPS) {
          spans = clipSpans(spans, other.y0, other.y1)
        }
      }
      for (const [y0, y1] of spans) {
        if (y1 - y0 > EPS) boundary.push({ a: { x: c, y: y0 }, b: { x: c, y: y1 } })
      }
    }
    // 水平边：仅当 c 严格落在另一矩形 y 区间内部时才裁剪
    for (const c of [r.y0, r.y1]) {
      let spans: Array<[number, number]> = [[r.x0, r.x1]]
      for (const other of rects) {
        if (other === r) continue
        if (other.y0 + EPS < c && c < other.y1 - EPS) {
          spans = clipSpans(spans, other.x0, other.x1)
        }
      }
      for (const [x0, x1] of spans) {
        if (x1 - x0 > EPS) boundary.push({ a: { x: x0, y: c }, b: { x: x1, y: c } })
      }
    }
  }

  const segs = mergeCollinear(dedupeSegs(boundary))
  const loops = stitchLoops(segs)
  if (loops.length !== 1) {
    throw new Error(`剖面必须是连通的单一轮廓，当前得到 ${loops.length} 个环，请让各木片互相搭接。`)
  }
  const loop = loops[0]
  if (signedArea(loop) < 0) loop.reverse()
  return loop
}

/** 合并同一直线上相接或重叠的轮廓段（含共面外表面去重）。Map 一律用原始数字作键。 */
function mergeCollinear(segs: BoundarySeg[]): BoundarySeg[] {
  const vertical = new Map<number, Array<[number, number]>>()
  const horizontal = new Map<number, Array<[number, number]>>()
  for (const s of segs) {
    if (Math.abs(s.a.x - s.b.x) < EPS) {
      const list = vertical.get(s.a.x) ?? []
      list.push([Math.min(s.a.y, s.b.y), Math.max(s.a.y, s.b.y)])
      vertical.set(s.a.x, list)
    } else if (Math.abs(s.a.y - s.b.y) < EPS) {
      const list = horizontal.get(s.a.y) ?? []
      list.push([Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)])
      horizontal.set(s.a.y, list)
    }
  }
  const out: BoundarySeg[] = []
  for (const [x, intervals] of vertical) {
    for (const [lo, hi] of unionIntervals(intervals)) {
      out.push({ a: { x, y: lo }, b: { x, y: hi } })
    }
  }
  for (const [y, intervals] of horizontal) {
    for (const [lo, hi] of unionIntervals(intervals)) {
      out.push({ a: { x: lo, y }, b: { x: hi, y } })
    }
  }
  return out
}

function unionIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = intervals.map(([a, b]) => [a, b] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = []
  for (const [lo, hi] of sorted) {
    const last = merged.at(-1)
    if (last && lo <= last[1] + EPS) last[1] = Math.max(last[1], hi)
    else merged.push([lo, hi])
  }
  return merged
}

function clipSpans(spans: Array<[number, number]>, cover0: number, cover1: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const [lo, hi] of spans) {
    if (cover1 <= lo + EPS || cover0 >= hi - EPS) {
      out.push([lo, hi])
    } else {
      if (cover0 > lo + EPS) out.push([lo, Math.max(lo, cover0)])
      if (cover1 < hi - EPS) out.push([Math.min(hi, cover1), hi])
    }
  }
  return out
}

const samePoint = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS

/** 容差缝合：把无向轮廓段按端点就近连接成闭合环（自动翻转反向段，保证单一绕行方向）。 */
function stitchLoops(segs: BoundarySeg[]): Vec2[][] {
  const remaining = segs.map(s => ({ a: { ...s.a }, b: { ...s.b } }))
  const loops: Vec2[][] = []
  while (remaining.length) {
    const first = remaining.shift()!
    const loop: Vec2[] = [first.a, first.b]
    let guard = 0
    for (;;) {
      if (++guard > segs.length + 2) throw new Error('剖面轮廓缝合失败：存在开口或重叠边。')
      const tail = loop[loop.length - 1]
      if (samePoint(tail, loop[0])) {
        loop.pop()
        break
      }
      let bestIdx = -1
      let bestD = Infinity
      let reverse = false
      for (let i = 0; i < remaining.length; i++) {
        const da = Math.hypot(remaining[i].a.x - tail.x, remaining[i].a.y - tail.y)
        const db = Math.hypot(remaining[i].b.x - tail.x, remaining[i].b.y - tail.y)
        if (da < bestD) { bestD = da; bestIdx = i; reverse = false }
        if (db < bestD) { bestD = db; bestIdx = i; reverse = true }
      }
      if (bestIdx < 0 || bestD > 1e-6) {
        throw new Error('剖面轮廓不闭合：木片之间可能只点接触，请加宽搭接。')
      }
      const next = remaining.splice(bestIdx, 1)[0]
      loop.push(reverse ? next.a : next.b)
    }
    loops.push(loop)
  }
  return loops
}

/** 边的稳定几何键：中点 + 外法线，与顶点编号无关。 */
export function edgeKey(edge: ProfileEdge): string {
  const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 }
  const n = edge.normal
  return `m${key(mid.x)},${key(mid.y)}|n${key(n.x)},${key(n.y)}`
}

function buildEdges(polygon: Vec2[], centroid: Vec2, overrides: Record<string, EdgeRole>): ProfileEdge[] {
  const edges: ProfileEdge[] = []
  // 只有贴着整体基线（全局最低 y）的水平朝下边才算落地支架边；凹槽等内凹下壁仍是接触边
  const groundY = Math.min(...polygon.map(p => p.y))
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    let normal = normalize(perp(sub(b, a))) // CCW 下 perp 指向内
    normal = { x: -normal.x, y: -normal.y } // 取外法线
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if (dot2(normal, sub(mid, centroid)) < 0) {
      normal = { x: -normal.x, y: -normal.y }
    }
    const isGroundEdge = normal.y < -0.9 && Math.abs(mid.y - groundY) < 1e-6
    const provisional: ProfileEdge = { a, b, normal, role: 'contact' }
    const k = edgeKey(provisional)
    const override = overrides[k]
    const role: EdgeRole = override ?? (isGroundEdge ? 'support' : 'contact')
    edges.push({ ...provisional, role })
  }
  return edges
}

function dot2(a: Vec2, b: Vec2) { return a.x * b.x + a.y * b.y }

/** FNV-1a 32 位，对剖面定义做内容寻址。 */
export function checksumOf(def: Pick<ProfileDef, 'segments' | 'edgeOverrides'>): string {
  const canonical = JSON.stringify({
    segments: def.segments
      .map(s => ({ ...s }))
      .sort((a, b) => a.offsetX - b.offsetX || a.height - b.height),
    edgeOverrides: Object.fromEntries(Object.entries(def.edgeOverrides).sort(([a], [b]) => a.localeCompare(b))),
  })
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export interface BakeResult {
  version: ProfileVersion
  /** 本次烘焙中生效/未生效的覆盖项，便于编辑器提示 */
  unmatchedOverrides: string[]
}

/** 把可编辑剖面定义烘焙成不可变版本（轮廓、边、重心、惯量、包围盒）。 */
export function bakeProfile(def: ProfileDef, revision: number, bakedAt = Date.now()): BakeResult {
  if (!def.segments.length) throw new Error('剖面至少需要一段木片。')
  for (const s of def.segments) {
    if (!(s.width > 0) || !(s.height > 0)) throw new Error(`木片「${s.label}」的宽度和高度都必须为正数。`)
    if (!(s.density > 0)) throw new Error(`木片「${s.label}」的密度必须为正数。`)
  }
  const polygon = unionOutline(def.segments)
  const rects = def.segments.map(toRect)

  // 面积加权重心（考虑各段密度）
  let mass = 0
  let comX = 0
  let comY = 0
  for (const r of rects) {
    const area = (r.x1 - r.x0) * (r.y1 - r.y0)
    const m = area * r.spec.density
    mass += m
    comX += m * (r.x0 + r.x1) / 2
    comY += m * (r.y0 + r.y1) / 2
  }
  const centerOfMass: Vec2 = { x: comX / mass, y: comY / mass }

  // 单位质量绕重心的极转动惯量（平行轴定理）
  let inertiaWeighted = 0
  for (const r of rects) {
    const w = r.x1 - r.x0
    const h = r.y1 - r.y0
    const area = w * h
    const m = area * r.spec.density
    const cx = (r.x0 + r.x1) / 2
    const cy = (r.y0 + r.y1) / 2
    const own = area * (w * w + h * h) / 12
    inertiaWeighted += r.spec.density * (own + area * ((cx - centerOfMass.x) ** 2 + (cy - centerOfMass.y) ** 2))
  }
  const inertia = inertiaWeighted / mass
  const area = rects.reduce((sum, r) => sum + (r.x1 - r.x0) * (r.y1 - r.y0), 0)

  const polyCentroid = polygonCentroid(polygon)
  const edges = buildEdges(polygon, polyCentroid, def.edgeOverrides)
  const matched = new Set(edges.map(e => edgeKey(e)))
  const unmatchedOverrides = Object.keys(def.edgeOverrides).filter(k => !matched.has(k))

  const version: ProfileVersion = {
    checksum: checksumOf(def),
    profileId: def.id,
    name: def.name,
    revision,
    bakedAt,
    segments: def.segments.map(s => ({ ...s })),
    polygon,
    edges,
    centerOfMass,
    inertia,
    area,
    bounds: boundsOf(polygon),
  }
  return { version, unmatchedOverrides }
}

/** 最低的支撑边（落地面）。 */
export function supportEdges(version: ProfileVersion): ProfileEdge[] {
  return version.edges.filter(e => e.role === 'support')
}

/** 世界坐标下某姿态的支脚点：所有支撑边里最低的一点；可被坡面抬高。 */
export function lowestSupportPoint(version: ProfileVersion, position: Vec2, angleRad: number): { point: Vec2; local: Vec2 } {
  let bestLocal = version.polygon[0]
  let bestY = Infinity
  for (const edge of supportEdges(version)) {
    for (const local of [edge.a, edge.b]) {
      const world = { x: position.x + rotate(local, angleRad).x, y: position.y + rotate(local, angleRad).y }
      if (world.y < bestY) {
        bestY = world.y
        bestLocal = local
      }
    }
  }
  return { point: { x: position.x + rotate(bestLocal, angleRad).x, y: bestY }, local: bestLocal }
}

/** 局部轮廓上相对重心偏移给定时的世界坐标工具。 */
export function comWorld(version: ProfileVersion, position: Vec2, angleRad: number): Vec2 {
  return {
    x: position.x + rotate(version.centerOfMass, angleRad).x,
    y: position.y + rotate(version.centerOfMass, angleRad).y,
  }
}

export function cross2(a: Vec2, b: Vec2) { return cross(a, b) }
export function dist2(a: Vec2, b: Vec2) { return dist(a, b) }
