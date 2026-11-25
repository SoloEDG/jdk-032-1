<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Layers, Save, MousePointerClick, AlertTriangle } from '@lucide/vue'
import type { DominoDocument, EdgeRole, ProfileDef, ProfileVersion, SegmentSpec } from '@/shared/document'
import { useProfiles } from '../model/useProfiles'

const props = defineProps<{
  document: DominoDocument
  selectedPieceIds: readonly string[]
}>()
const emit = defineEmits<{ changed: [] }>()

const profilesApi = useProfiles(computed(() => props.document), () => emit('changed'))
const activeId = ref('')
const draft = ref<ProfileDef | null>(null)
const message = ref('')

onMounted(() => {
  const first = profilesApi.profiles.value[0]
  if (first) selectProfile(first.id)
})

const activeDef = computed(() => profilesApi.defOf(activeId.value))
const previewVersion = computed<ProfileVersion | null>(() => (draft.value ? profilesApi.preview(draft.value) : null))
const savedVersions = computed(() => (activeId.value ? profilesApi.versionsOf(activeId.value) : []))

function selectProfile(id: string) {
  activeId.value = id
  const def = profilesApi.defOf(id)
  draft.value = def ? structuredClone(def) : null
  message.value = ''
}
function ensureDraft() {
  if (!draft.value && activeDef.value) draft.value = structuredClone(activeDef.value)
}
function updateSegment(index: number, patch: Partial<SegmentSpec>) {
  ensureDraft()
  if (!draft.value) return
  draft.value.segments[index] = { ...draft.value.segments[index], ...patch }
  draft.value = { ...draft.value }
}
function addSegment() {
  ensureDraft()
  if (!draft.value) return
  draft.value = profilesApi.addSegment(draft.value)
}
function removeSegment(index: number) {
  ensureDraft()
  if (!draft.value) return
  draft.value = profilesApi.removeSegment(draft.value, index)
}
function toggleEdge(edgeIndex: number) {
  ensureDraft()
  if (!draft.value || !previewVersion.value) return
  draft.value = profilesApi.toggleEdgeRole(draft.value, previewVersion.value, edgeIndex)
}
function save() {
  if (!draft.value) return
  try {
    const { version, unmatchedOverrides } = profilesApi.saveDef(draft.value)
    message.value = `已烘焙新版本 ${version.checksum}（R${version.revision}）`
      + (unmatchedOverrides.length ? `；${unmatchedOverrides.length} 个边覆盖已失效` : '')
    draft.value = structuredClone(profilesApi.defOf(version.profileId)!)
  } catch (error) {
    message.value = error instanceof Error ? error.message : '烘焙失败'
  }
}
function applyToSelected() {
  if (!previewVersion.value || !props.selectedPieceIds.length) {
    message.value = '请先在场景里选中至少一个摆件。'
    return
  }
  // 先保存最新版本，再只应用到选中摆件
  const { version } = profilesApi.saveDef(draft.value!)
  profilesApi.applyToSelected(props.selectedPieceIds, version)
  message.value = `已把 ${version.checksum} 只应用到 ${props.selectedPieceIds.length} 个选中摆件；其它牌保持旧版本。`
}

// 轮廓预览坐标：局部 y 朝上（米）→ SVG y 朝下
const view = { size: 220, pad: 18 }
const scene = computed(() => previewVersion.value?.bounds ?? { minX: -0.5, maxX: 0.5, minY: 0, maxY: 1.6 })
const scale = computed(() => {
  const w = scene.value.maxX - scene.value.minX || 1
  const h = scene.value.maxY - scene.value.minY || 1
  return (view.size - view.pad * 2) / Math.max(w, h)
})
function sx(x: number) {
  const cx = (scene.value.minX + scene.value.maxX) / 2
  return view.size / 2 + (x - cx) * scale.value
}
function sy(y: number) {
  const cy = (scene.value.minY + scene.value.maxY) / 2
  return view.size / 2 - (y - cy) * scale.value
}
const polygonPath = computed(() => {
  const v = previewVersion.value
  if (!v) return ''
  return v.polygon.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ') + ' Z'
})
</script>

<template>
  <section class="profile-panel">
    <div class="section-kicker"><span>06 / PROFILES</span><h2>骨牌剖面</h2></div>

    <label class="field-label">选择剖面
      <select :value="activeId" @change="selectProfile(($event.target as HTMLSelectElement).value)">
        <option v-for="def in profilesApi.profiles.value" :key="def.id" :value="def.id">{{ def.name }}</option>
      </select>
    </label>

    <div v-if="previewVersion" class="profile-preview">
      <svg :viewBox="`0 0 ${view.size} ${view.size}`" role="img" aria-label="剖面外轮廓预览">
        <path :d="polygonPath" class="profile-polygon" />
        <line v-for="(edge, i) in previewVersion.edges" :key="i"
          :x1="sx(edge.a.x)" :y1="sy(edge.a.y)" :x2="sx(edge.b.x)" :y2="sy(edge.b.y)"
          :class="['profile-edge', edge.role]" stroke-width="3" @click="toggleEdge(i)" />
        <circle :cx="sx(previewVersion.centerOfMass.x)" :cy="sy(previewVersion.centerOfMass.y)" r="4"
          class="com-dot" />
        <text :x="sx(previewVersion.centerOfMass.x) + 7" :y="sy(previewVersion.centerOfMass.y) + 3"
          class="com-label">重心</text>
      </svg>
      <div class="edge-legend">
        <span><i class="dot contact"></i>接触边（可碰倒邻牌）</span>
        <span><i class="dot support"></i>支架边（只承重）</span>
      </div>
    </div>

    <div class="segment-list">
      <div class="segment-head" v-if="draft">
        <span>木片段（{{ draft.segments.length }}）</span>
        <button class="mini-button" @click="addSegment"><Layers :size="13" /> 加一段</button>
      </div>
      <div v-for="(seg, i) in draft?.segments ?? []" :key="i" class="segment-row">
        <input class="seg-name" :value="seg.label" @change="updateSegment(i, { label: ($event.target as HTMLInputElement).value })" />
        <label>宽<input type="number" step="0.02" min="0.02" :value="seg.width"
          @change="updateSegment(i, { width: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label>高<input type="number" step="0.02" min="0.02" :value="seg.height"
          @change="updateSegment(i, { height: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label>X<input type="number" step="0.02" :value="seg.offsetX"
          @change="updateSegment(i, { offsetX: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label>Y<input type="number" step="0.02" :value="seg.offsetY"
          @change="updateSegment(i, { offsetY: Number(($event.target as HTMLInputElement).value) })" /></label>
        <button class="mini-button danger" @click="removeSegment(i)">删</button>
      </div>
    </div>

    <div class="profile-actions">
      <button class="secondary-button" @click="save"><Save :size="14" /> 烘焙新版本</button>
      <button class="run-button" @click="applyToSelected"><MousePointerClick :size="14" /> 只更新选中摆件</button>
    </div>

    <p v-if="message" class="profile-message" :class="{ warn: message.includes('失败') || message.includes('失效') }">
      <AlertTriangle v-if="message.includes('失败') || message.includes('失效')" :size="13" />{{ message }}
    </p>

    <details class="version-history">
      <summary>版本历史（{{ savedVersions.length }}）· 旧场次按当时 checksum 解释</summary>
      <ul>
        <li v-for="v in savedVersions" :key="v.checksum">
          <code>{{ v.checksum }}</code>
          <span>R{{ v.revision }} · {{ v.edges.filter(e => e.role === 'contact').length }} 接触边 /
            {{ v.edges.filter(e => e.role === 'support').length }} 支架边</span>
        </li>
      </ul>
    </details>
  </section>
</template>
