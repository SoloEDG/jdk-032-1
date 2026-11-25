import { computed, ref, shallowRef, type Ref } from 'vue'
import type { DominoDocument, ProfileVersion, SimulationRun } from '@/shared/document'
import { propagateWithProfiles } from '@/features/profiles/lib/propagate'
import { ensureProfiles, resolveVersion } from '@/features/profiles/lib/catalog'

export function useSimulation(document: Ref<DominoDocument>) {
  const run = shallowRef<SimulationRun | null>(null)
  const busy = ref(false)
  const issue = ref('')
  const current = computed(() => run.value)
  const stale = computed(() => Boolean(run.value && run.value.revision !== document.value.revision))

  async function simulate() {
    busy.value = true
    issue.value = ''
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    try {
      // 迁移旧档；ensureProfiles 返回新对象，再序列化深拷贝以冻结运行时刻数据
      const migrated = ensureProfiles(document.value)
      const snapshot: DominoDocument = JSON.parse(JSON.stringify(migrated))
      const result = propagateWithProfiles(snapshot)

      // 只把被摆件实际引用的剖面版本存入快照：旧场次据此按当时形状解释
      const referenced = new Set(snapshot.pieces.map(p => p.profileVersion).filter(Boolean) as string[])
      const profileSnapshot: ProfileVersion[] = snapshot.profileVersions.filter(v => referenced.has(v.checksum))

      run.value = {
        id: crypto.randomUUID(),
        documentId: snapshot.id,
        revision: snapshot.revision,
        startedAt: Date.now(),
        startPieceId: snapshot.startPieceId,
        status: result.status,
        events: result.events,
        interruptedPieceId: result.interruptedPieceId,
        interruptionReason: result.interruptionReason,
        duration: result.duration,
        profileSnapshot,
        piecesSnapshot: JSON.parse(JSON.stringify(snapshot.pieces)),
        contacts: result.contacts,
      }
      if (result.status === 'empty') issue.value = '场景里没有可运行的触发点。'
      // 预热解析，确保每个引用都能在快照中找到
      for (const piece of snapshot.pieces) {
        if (!resolveVersion(snapshot, piece) && piece.kind !== 'ramp') {
          issue.value = '部分摆件缺少剖面版本，已按可解析部分运行。'
        }
      }
    } catch (error) {
      issue.value = '场景计算未能完成，请检查剖面与元件连接。'
      console.error(error)
    } finally {
      busy.value = false
    }
  }

  function clear() { run.value = null; issue.value = '' }
  return { run, current, stale, busy, issue, simulate, clear }
}
