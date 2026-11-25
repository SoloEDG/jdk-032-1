// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { DominoDocument } from '@/shared/document'
import { createDefaultDocument } from '@/shared/defaults'
import { useSimulation } from '@/features/simulation/model/useSimulation'
import { applyProfileToPieces, saveProfileDef } from './catalog'

describe('运行快照与历史形状', () => {
  it('运行结果冻结当时的剖面版本与摆件，之后改剖面不影响旧场次', async () => {
    const document = ref<DominoDocument>(createDefaultDocument())
    const sim = useSimulation(document)

    await sim.simulate()
    if (!sim.run.value) throw new Error(`simulate failed: ${sim.issue.value}`)
    const firstRun = sim.run.value!
    expect(firstRun.profileSnapshot.length).toBeGreaterThan(0)
    expect(firstRun.piecesSnapshot.length).toBe(document.value.pieces.length)
    const frozenChecksums = new Set(firstRun.profileSnapshot.map(v => v.checksum))

    // 改默认剖面，产生新版本
    const target = document.value.pieces.find(p => p.kind === 'domino')!
    const def = JSON.parse(JSON.stringify(document.value.profiles.find(p => p.id === target.profileId)!))
    def.segments[0].height = 2.4
    const saved = saveProfileDef(document.value, def)
    document.value = { ...saved.document, revision: saved.document.revision + 1, updatedAt: Date.now() }
    document.value = applyProfileToPieces(document.value, [target.id], saved.version)

    // 旧 run 引用的快照集合不包含新版本，仍是当时形状
    expect(frozenChecksums.has(saved.version.checksum)).toBe(false)
    expect(firstRun.profileSnapshot.every(v => frozenChecksums.has(v.checksum))).toBe(true)
    // 旧 run 标记为 stale（布局修订已变），但内容保持不变
    expect(sim.stale.value).toBe(true)
    expect(sim.run.value!.id).toBe(firstRun.id)

    // 重新模拟后，新 run 的快照包含新版本
    await sim.simulate()
    const secondRun = sim.run.value!
    expect(secondRun.id).not.toBe(firstRun.id)
    expect(secondRun.profileSnapshot.some(v => v.checksum === saved.version.checksum)).toBe(true)
  })
})
