import type {
  ContactRecord, DominoDocument, Piece, ProfileVersion, SimulationEvent,
} from '@/shared/document'
import {
  computePivot, findFirstContact, rampShape, staticTargetOf, timeToAngle,
  type RampShape, type StaticTarget,
} from './solver'
import { resolveVersion } from './catalog'

interface Scheduled {
  pieceId: string
  time: number
  causeId: string | null
  detail: string
  contact?: ContactRecord
}

export interface PropagationResult {
  events: SimulationEvent[]
  interruptedPieceId: string | null
  interruptionReason: string | null
  reachedTrigger: boolean
  status: 'complete' | 'interrupted' | 'empty'
  duration: number
  contacts: ContactRecord[]
}

/**
 * 基于真实外轮廓与边角色的传播模拟。
 * 每个倒下的牌绕其支脚转动（支脚可被坡道托起），用真实轮廓扫掠求第一接触；
 * 接触必须同时发生在两张牌的 contact 边上，support 边只承重不传播。
 */
export function propagateWithProfiles(document: DominoDocument): PropagationResult {
  const queue: Scheduled[] = [
    { pieceId: document.startPieceId, time: 0, causeId: null, detail: '手动触发' },
  ]
  const fallen = new Set<string>()
  const events: SimulationEvent[] = []
  const contacts: ContactRecord[] = []
  let interruptedPieceId: string | null = null
  let interruptionReason: string | null = null
  let reachedTrigger = false

  const pieceById = new Map(document.pieces.map(p => [p.id, p]))
  const versionCache = new Map<string, ProfileVersion | null>()
  const versionOf = (piece: Piece) => {
    if (!versionCache.has(piece.id)) versionCache.set(piece.id, resolveVersion(document, piece))
    return versionCache.get(piece.id)!
  }
  const ramps: RampShape[] = document.pieces.filter(p => p.kind === 'ramp').map(rampShape)
  const staticTargets = (): StaticTarget[] =>
    document.pieces
      .filter(p => !fallen.has(p.id) && p.id)
      .filter(p => p.kind !== 'ramp')
      .map(piece => {
        const version = versionOf(piece)
        return version ? staticTargetOf(piece, version) : null
      })
      .filter((t): t is StaticTarget => t !== null)

  const eventCap = document.pieces.length * 3
  while (queue.length && events.length < eventCap) {
    queue.sort((a, b) => a.time - b.time || a.pieceId.localeCompare(b.pieceId)
      || (a.causeId ?? '').localeCompare(b.causeId ?? ''))
    const next = queue.shift()!
    const piece = pieceById.get(next.pieceId)
    if (!piece || fallen.has(piece.id)) continue

    if (piece.kind === 'trigger') {
      const event: SimulationEvent = {
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
        causeId: next.causeId, kind: 'mechanism', detail: `触发器响应 · ${next.detail}`,
        contact: next.contact,
      }
      events.push(event)
      reachedTrigger = true
      for (const link of document.connections.filter(l => l.from === piece.id && l.enabled)) {
        queue.push({ pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线' })
      }
      continue
    }

    fallen.add(piece.id)
    const event: SimulationEvent = {
      id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
      causeId: next.causeId,
      kind: piece.kind === 'splitter' ? 'mechanism' : 'fall',
      detail: piece.kind === 'splitter' ? `分岔展开 · ${next.detail}`
        : piece.kind === 'ramp' ? `坡面传递 · ${next.detail}` : `受力倒下 · ${next.detail}`,
      contact: next.contact,
    }
    events.push(event)
    if (next.contact) {
      contacts.push(next.contact)
      events.push({
        id: `event-${events.length + 1}`,
        pieceId: piece.id,
        time: next.time + 0.001,
        causeId: event.id,
        kind: 'contact',
        detail: describeContact(next.contact, pieceById),
        contact: next.contact,
      })
    }

    for (const link of document.connections.filter(l => l.from === piece.id && l.enabled)) {
      queue.push({ pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线' })
    }

    // 坡道是静态支撑物，不主动扫掠
    if (piece.kind === 'ramp') continue

    const version = versionOf(piece)
    if (!version) continue
    const pivot = computePivot(piece, version, ramps)
    const candidates = staticTargets().filter(t => t.piece.id !== piece.id)
    const first = findFirstContact(piece, version, pivot, candidates, document.scene.gravity)

    if (first) {
      const travel = timeToAngle(version, pivot, first.theta, document.scene.gravity)
      const targetPiece = pieceById.get(first.targetPieceId)!
      const lead = first.points[0]
      const record: ContactRecord = {
        sourcePieceId: piece.id,
        targetPieceId: targetPiece.id,
        sourceAngleDeg: first.thetaDeg,
        point: lead.point,
        normal: lead.normal,
        sourceEdge: lead.sourceEdge,
        targetEdge: lead.targetEdge,
        contactPointCount: first.contactPointCount,
      }
      queue.push({
        pieceId: targetPiece.id,
        time: next.time + Math.max(0.08, travel),
        causeId: event.id,
        detail: contactDetail(record, pieceById),
        contact: record,
      })
    }

    const hasConnection = document.connections.some(l => l.from === piece.id && l.enabled)
    if (!first && !hasConnection && interruptedPieceId === null) {
      interruptedPieceId = piece.id
      interruptionReason = pivot.rampId
        ? '支脚被坡面托起后，真实轮廓扫掠范围内没有可触达的接触边，链路在此停止。'
        : '倒下方向内没有可触达的接触边（支架边不传播），链路在此停止。'
      events.push({
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time + 0.05,
        causeId: event.id, kind: 'interrupted', detail: interruptionReason,
      })
    }
  }

  return {
    events,
    interruptedPieceId,
    interruptionReason,
    reachedTrigger,
    status: events.length === 0 ? 'empty'
      : interruptedPieceId || !reachedTrigger ? 'interrupted' : 'complete',
    duration: events.at(-1)?.time ?? 0,
    contacts,
  }
}

function contactDetail(record: ContactRecord, pieceById: Map<string, Piece>): string {
  const source = pieceById.get(record.sourcePieceId)?.label ?? record.sourcePieceId
  const target = pieceById.get(record.targetPieceId)?.label ?? record.targetPieceId
  const dual = record.contactPointCount > 1 ? `内凹双触点（${record.contactPointCount} 点同时）· ` : ''
  return `${dual}${source} 的接触边先撞上 ${target} 的接触边`
}

function describeContact(record: ContactRecord, pieceById: Map<string, Piece>): string {
  const source = pieceById.get(record.sourcePieceId)?.label ?? record.sourcePieceId
  const target = pieceById.get(record.targetPieceId)?.label ?? record.targetPieceId
  const edgeText = (edge: { role: string }) => (edge.role === 'support' ? '支架边' : '接触边')
  return `${source} ${edgeText(record.sourceEdge)} → ${target} ${edgeText(record.targetEdge)} · 倾角 ${record.sourceAngleDeg.toFixed(1)}°`
}
