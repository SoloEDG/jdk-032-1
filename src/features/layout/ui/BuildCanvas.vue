<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crosshair, MousePointer2 } from '@lucide/vue'
import type { ContactRecord, DominoDocument, Piece, PieceKind, ProfileVersion, SimulationRun } from '@/shared/document'
import { resolveVersion } from '@/features/profiles'

const props = defineProps<{
  document: DominoDocument; activeTool: PieceKind | null; selectedId: string | null
  run: SimulationRun | null; focusPieceId: string | null
}>()
const emit = defineEmits<{
  place: [PieceKind, number, number]; select: [string | null]; move: [string, number, number]
}>()
const svg = ref<SVGSVGElement | null>(null)
const view = { width: 1040, height: 510, margin: 35 }
const fallen = computed(() => new Set(props.run?.events.filter(event => event.kind === 'fall').map(event => event.pieceId) ?? []))
const failed = computed(() => props.run?.interruptedPieceId ?? null)
let dragging: string | null = null

function worldPoint(event: PointerEvent) {
  if (!svg.value) return { x: 0, y: 0 }
  const bounds = svg.value.getBoundingClientRect()
  const svgX = (event.clientX - bounds.left) / bounds.width * view.width
  const svgY = (event.clientY - bounds.top) / bounds.height * view.height
  return {
    x: Math.max(0, Math.min(props.document.scene.width,
      (svgX - view.margin) / (view.width - view.margin * 2) * props.document.scene.width)),
    y: Math.max(0, Math.min(props.document.scene.height,
      (svgY - view.margin) / (view.height - view.margin * 2) * props.document.scene.height)),
  }
}

function down(event: PointerEvent, piece: Piece) {
  event.stopPropagation()
  dragging = piece.id
  emit('select', piece.id)
  ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!dragging) return
  const point = worldPoint(event)
  emit('move', dragging, point.x, point.y)
}
function up() { dragging = null }
function boardClick(event: PointerEvent) {
  if (dragging) return
  const point = worldPoint(event)
  if (props.activeTool) emit('place', props.activeTool, point.x, point.y)
  else emit('select', null)
}
function pxX(x: number) { return view.margin + x / props.document.scene.width * (view.width - view.margin * 2) }
function pxY(y: number) { return view.margin + y / props.document.scene.height * (view.height - view.margin * 2) }
/** 世界 1 米对应的屏幕像素（取 x、y 比例的较小者，保证轮廓不变形） */
const meter = computed(() => Math.min(
  (view.width - view.margin * 2) / props.document.scene.width,
  (view.height - view.margin * 2) / props.document.scene.height,
))
/** 屏幕坐标 y 朝上：局部/世界 y 越大，屏幕 y 越小 */
function localX(worldX: number, localX: number) { return meter.value * localX }
function localY(localY: number) { return -meter.value * localY }
function pieceColor(piece: Piece) {
  if (piece.id === failed.value) return '#e88b69'
  if (fallen.value.has(piece.id)) return '#89c5a5'
  if (piece.kind === 'ramp') return '#8ca6a0'
  if (piece.kind === 'splitter') return '#e6bd68'
  if (piece.kind === 'trigger') return '#df8d70'
  return '#ead8b5'
}
function eventTime(pieceId: string) {
  const event = props.run?.events.find(item => item.pieceId === pieceId)
  return event ? event.time.toFixed(2) : ''
}

const versionCache = computed(() => {
  const map = new Map<string, ProfileVersion | null>()
  for (const piece of props.document.pieces) map.set(piece.id, resolveVersion(props.document, piece))
  return map
})
function versionOf(piece: Piece) { return versionCache.value.get(piece.id) ?? null }
function profilePath(piece: Piece, version: ProfileVersion) {
  return version.polygon
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${localX(piece.x, p.x).toFixed(2)} ${localY(p.y).toFixed(2)}`)
    .join(' ') + ' Z'
}
/** 当前回放聚焦的接触记录（用于高亮“先撞的是哪条边”） */
const activeContacts = computed<ContactRecord[]>(() =>
  props.run?.events.filter(e => e.kind === 'contact').map(e => e.contact!).filter(Boolean) ?? [])
function edgeIsActive(piece: Piece, edgeIndex: number, side: 'source' | 'target') {
  return activeContacts.value.some(record => {
    const refVersion = versionOf(piece)
    if (!refVersion) return false
    const edge = side === 'source' ? record.sourceEdge : record.targetEdge
    const ownerId = side === 'source' ? record.sourcePieceId : record.targetPieceId
    if (ownerId !== piece.id) return false
    return refVersion.edges[edgeIndex]?.a.x === edge.a.x && refVersion.edges[edgeIndex]?.a.y === edge.a.y
  })
}
function contactPointsFor(piece: Piece) {
  return activeContacts.value
    .filter(r => r.sourcePieceId === piece.id || r.targetPieceId === piece.id)
    .map(r => ({ x: pxX(r.point.x), y: pxY(r.point.y), dual: r.contactPointCount > 1 }))
}
</script>

<template>
  <section class="stage-panel" aria-label="骨牌构筑场景">
    <div class="stage-toolbar">
      <div class="stage-mode"><MousePointer2 :size="15" /><span>{{ activeTool ? '点击空位添加元件' : '编辑场景' }}</span></div>
      <div class="stage-readout"><span class="readout-dot"></span>{{ document.pieces.length }} 件元件 <span class="readout-sep">·</span> {{ document.scene.width }} × {{ document.scene.height }} 桌面</div>
    </div>
    <svg ref="svg" class="stage-svg" :viewBox="`0 0 ${view.width} ${view.height}`" role="img"
      aria-label="可编辑的多米诺场景。使用鼠标拖动或方向键微调选中元件。" @pointerup="up" @pointercancel="up"
      @pointermove="move" @pointerdown="boardClick">
      <defs>
        <pattern id="draft-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#3c5048" stroke-width=".65" opacity=".6" />
          <circle cx="0" cy="0" r="1" fill="#b9c3a5" opacity=".3" />
        </pattern>
        <pattern id="draft-fine" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".65" fill="#758376" opacity=".35" />
        </pattern>
        <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#101a17" flood-opacity=".38" />
        </filter>
      </defs>
      <rect x="0" y="0" :width="view.width" :height="view.height" rx="12" class="board-bg" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" class="board-surface" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" fill="url(#draft-fine)" pointer-events="none" />
      <path v-if="document.scene.showGrid" :d="`M ${view.margin} ${view.height/2} H ${view.width-view.margin} M ${view.width/2} ${view.margin} V ${view.height-view.margin}`" class="center-guide" pointer-events="none" />

      <g v-for="connection in document.connections.filter(link => link.enabled)" :key="connection.id" class="mechanism-link" pointer-events="none">
        <path :d="`M ${pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)} Q ${(pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)+pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0))/2} ${(pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)+pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0))/2-36} ${pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0)}`" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)" r="3" />
      </g>

      <g v-for="piece in document.pieces" :key="piece.id" class="scene-piece"
        :class="{ selected: selectedId === piece.id, focused: focusPieceId === piece.id, fallen: fallen.has(piece.id) }"
        :transform="`translate(${pxX(piece.x)} ${pxY(piece.y)}) rotate(${piece.angle})`"
        :tabindex="0" role="button" :aria-label="`${piece.label}，${piece.x.toFixed(1)}，${piece.y.toFixed(1)}`" :aria-pressed="selectedId === piece.id"
        @pointerdown="down($event, piece)" @keydown.enter.stop="emit('select', piece.id)" @keydown.space.stop.prevent="emit('select', piece.id)">
        <template v-if="piece.kind === 'ramp'">
          <path d="M-24 10 L22 10 L22 -10 Z" :fill="pieceColor(piece)" class="ramp-body" filter="url(#piece-shadow)" />
        </template>
        <template v-else-if="piece.kind === 'splitter'">
          <path d="M0-13 L13 0 L0 13 L-13 0 Z" :fill="pieceColor(piece)" class="splitter-body" filter="url(#piece-shadow)" />
        </template>
        <template v-else-if="piece.kind === 'trigger'">
          <circle r="11" :fill="pieceColor(piece)" class="trigger-body" filter="url(#piece-shadow)" />
        </template>
        <template v-else-if="versionOf(piece)">
          <ellipse cx="0" cy="7" :rx="meter * (versionOf(piece)!.bounds.maxX - versionOf(piece)!.bounds.minX) / 2" ry="7"
            class="piece-ground-shadow" />
          <path :d="profilePath(piece, versionOf(piece)!)" :fill="pieceColor(piece)" class="domino-body"
            filter="url(#piece-shadow)" />
          <!-- 边角色：接触边描亮色，支架边描暗色；回放命中边高亮 -->
          <line v-for="(edge, i) in versionOf(piece)!.edges" :key="i"
            :x1="localX(piece.x, edge.a.x)" :y1="localY(edge.a.y)"
            :x2="localX(piece.x, edge.b.x)" :y2="localY(edge.b.y)"
            :class="['profile-edge-line', edge.role, { active: edgeIsActive(piece, i, 'source') || edgeIsActive(piece, i, 'target') }]" />
          <circle :cx="localX(piece.x, versionOf(piece)!.centerOfMass.x)" :cy="localY(versionOf(piece)!.centerOfMass.y)"
            r="2.6" class="com-mark" />
        </template>
        <circle v-if="piece.id === document.startPieceId" cy="-28" r="4" class="start-marker" />
        <circle v-if="piece.id === failed" cy="-34" r="7" class="failure-marker" />
        <text y="32" text-anchor="middle" class="piece-label">{{ piece.label }}</text>
        <text v-if="eventTime(piece.id)" y="44" text-anchor="middle" class="piece-time">{{ eventTime(piece.id) }}s</text>
        <rect v-if="selectedId === piece.id || focusPieceId === piece.id" x="-18" y="-28" width="36" height="55" rx="8" class="selection-ring" />
      </g>

      <!-- 接触点标记：回放时指出“哪一边先撞上、撞在哪一点”，双触点用双环 -->
      <g v-for="(cp, i) in document.pieces.flatMap(p => contactPointsFor(p))" :key="`cp-${i}`" class="contact-marker"
        pointer-events="none" :transform="`translate(${cp.x} ${cp.y})`">
        <circle r="6" class="contact-ring" />
        <circle v-if="cp.dual" r="10" class="contact-ring dual" />
      </g>

      <g v-if="focusPieceId" class="focus-reticle" pointer-events="none">
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="25" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="32" />
      </g>
      <g class="board-scale" pointer-events="none"><path d="M 0 0 H 80 M 0 0 V -5 M 80 0 V -5" /><text x="40" y="15" text-anchor="middle">2 M</text></g>
    </svg>
    <div class="stage-footer"><span><Crosshair :size="13" /> 桌面定位</span><span>拖动摆放 <kbd>↑ ↓ ← →</kbd> 微调 <kbd>Shift</kbd> 加速</span></div>
  </section>
</template>
