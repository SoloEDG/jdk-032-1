import type { Vec2 } from '@/shared/document'

/** 接触判定已迁移到 profiles/lib 的真实多边形扫掠引擎，这里只保留布局编辑用的基础工具。 */

export function roundedPosition(point: Vec2) {
  return { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 }
}
