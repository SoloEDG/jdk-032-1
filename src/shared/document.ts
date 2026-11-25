export type PieceKind = 'domino' | 'ramp' | 'splitter' | 'trigger'
export type Axis = 'north' | 'east' | 'south' | 'west'

export interface Vec2 { x: number; y: number }

/**
 * 剖面上的一条边。
 * role='contact' 表示这条边可以把倒下的力传给相邻牌；
 * role='support' 表示它只是支架（落地或搭在坡面上），不能碰倒邻牌。
 */
export type EdgeRole = 'contact' | 'support'

export interface ProfileEdge {
  /** 起点（局部坐标，y 轴朝上，原点在剖面基线中心） */
  a: Vec2
  /** 终点 */
  b: Vec2
  role: EdgeRole
  /** 外法线（单位向量，y 朝上坐标系） */
  normal: Vec2
}

export interface SegmentSpec {
  /** 段名称，便于在编辑器里辨认 */
  label: string
  /** 木片宽度（x 方向厚度） */
  width: number
  /** 木片高度（y 方向） */
  height: number
  /** 段中心的 x 偏移 */
  offsetX: number
  /** 段底边的 y 偏移（默认 0 即落在基线） */
  offsetY: number
  /** 木片密度（面积权重，参与重心计算） */
  density: number
}

/** 剖面的可编辑定义：几段矩形木片 + 边角色覆盖项。内容寻址，改任何字段都会产生新版本。 */
export interface ProfileDef {
  id: string
  name: string
  createdAt: number
  segments: SegmentSpec[]
  /**
   * 边角色覆盖，键为稳定几何键（见 edgeKey）。
   * 未列出的边按默认规则：朝下的水平边为 support，其余为 contact。
   */
  edgeOverrides: Record<string, EdgeRole>
}

/** 由 ProfileDef 烘焙出的不可变版本：真实外轮廓、边、重心、惯性都已算好。 */
export interface ProfileVersion {
  /** 内容寻址哈希，同定义必然同版本 */
  checksum: string
  profileId: string
  name: string
  revision: number
  bakedAt: number
  segments: SegmentSpec[]
  /** 外轮廓多边形（逆时针、y 朝上、原点在基线中心） */
  polygon: Vec2[]
  edges: ProfileEdge[]
  /** 面积加权重心（局部坐标） */
  centerOfMass: Vec2
  /** 单位质量、绕重心的极转动惯量 */
  inertia: number
  area: number
  /** 包围盒（仅用于粗筛/对比，绝不能用于判定第一接触点） */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface Piece {
  id: string
  kind: PieceKind
  x: number
  y: number
  angle: number
  facing: Axis
  label: string
  height: number
  width: number
  fallThreshold: number
  friction: number
  /** 引用的剖面 id；旧存档没有时由迁移逻辑补默认剖面 */
  profileId?: string
  /** 引用的剖面版本 checksum；保证旧场次按当时形状解释 */
  profileVersion?: string
}

export interface MechanismConnection {
  id: string
  from: string
  to: string
  delay: number
  enabled: boolean
}

export interface SceneSettings {
  gravity: number
  friction: number
  width: number
  height: number
  showGrid: boolean
}

export interface DominoDocument {
  id: string
  title: string
  revision: number
  updatedAt: number
  pieces: Piece[]
  connections: MechanismConnection[]
  scene: SceneSettings
  startPieceId: string
  /** 剖面库：ProfileDef 是当前定义，versions 保存所有烘焙过的不可变版本 */
  profiles: ProfileDef[]
  profileVersions: ProfileVersion[]
}

/** 一次真实接触的完整记录：是哪条边先碰到下一枚。 */
export interface ContactRecord {
  sourcePieceId: string
  targetPieceId: string
  /** 源牌发生接触时的倾倒角（度，相对初始姿态） */
  sourceAngleDeg: number
  /** 接触点（世界坐标，y 朝上） */
  point: Vec2
  /** 接触法线（世界坐标） */
  normal: Vec2
  /** 源牌上首先接触的那条边（含角色） */
  sourceEdge: ProfileEdge
  /** 目标牌上首先接触的那条边（含角色） */
  targetEdge: ProfileEdge
  /** 同时发生的接触点数（内凹双触点时为 2） */
  contactPointCount: number
}

export interface SimulationEvent {
  id: string
  pieceId: string
  time: number
  causeId: string | null
  kind: 'trigger' | 'fall' | 'mechanism' | 'interrupted' | 'contact'
  detail: string
  /** 该事件若由边接触引发，记录是哪条边先撞上的 */
  contact?: ContactRecord
}

export interface SimulationRun {
  id: string
  documentId: string
  revision: number
  startedAt: number
  startPieceId: string
  status: 'complete' | 'interrupted' | 'empty'
  events: SimulationEvent[]
  interruptedPieceId: string | null
  interruptionReason: string | null
  duration: number
  /** 运行时刻的剖面版本快照（只存被引用的版本）；旧场次据此按当时形状解释 */
  profileSnapshot: ProfileVersion[]
  /** 运行时刻的摆件姿态快照 */
  piecesSnapshot: Piece[]
  /** 每条接触传播的边级记录，供回放高亮“先撞的是哪一边” */
  contacts: ContactRecord[]
}
