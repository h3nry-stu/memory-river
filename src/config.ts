/**
 * ════════════════════════════════════════════════════════════════════════
 *  《记忆长河》· 全局配置（唯一真源 / single source of truth）
 * ════════════════════════════════════════════════════════════════════════
 *
 *  铁律：所有魔法数字（阈值 / 时长 / 尺寸 / 颜色 / 权重 / 文案）集中于本文件。
 *  其它模块 **禁止** 硬编码数字常量，一律 `import { GESTURE } from '@/config'`。
 *
 *  约定：
 *  - 时间单位一律毫秒（key 以 `Ms` 结尾）
 *  - 距离单位：屏幕空间用 `Px`；手势/世界空间为 0..1 归一化，不加后缀
 *  - 速度单位：`PerSec` 表示「屏幕宽度 / 秒」之类的归一化速率
 *  - 颜色一律 `#rrggbb` 字符串（CSS / Three 均可直接消费）
 *  - 本文件不依赖任何其它模块，可被 canvas、worker、UI 同时引用
 */

/* ─────────────────────────── 0. 通用工具 ─────────────────────────── */

/** 递归冻结，防止运行期被意外改写（配置只读是硬约束）。 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** 十六进制颜色 → 归一化 RGB 三元组（Three.js / WebGL 用）。 */
function hexToRgb(hex: string): readonly [number, number, number] {
  const int = Number.parseInt(hex.replace('#', ''), 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

/* ─────────────────────── 1. 视觉：深空 + 情绪光色 ─────────────────────── */

export const PALETTE = deepFreeze({
  /** 背景渐变：上 #05060f → 下 #0a0f1f（径向 + 线性叠加，见 scene/Stage.ts） */
  cosmos: {
    near: '#05060f',
    far: '#0a0f1f',
    /** 背景层数：远景 nebula / 中景星尘 / 近景光河 */
    nebulaAlpha: 0.08,
    vignetteStrength: 0.55,
    vignetteStart: 0.62,
  },

  /** 情绪光色：一个记忆的温度由这三种色按权重混出 */
  emotion: {
    warmGold: '#ffb86b', // 暖金 —— 亲情、旧日光
    cyanWhite: '#9fd8ff', // 青白 —— 清醒、当下
    coldBlue: '#5b7cff', // 冷蓝 —— 距离、失去
  },

  /** 情绪混合区间（0 = 全冷蓝，1 = 全暖金），超出则夹紧 */
  emotionRange: {
    min: 0,
    max: 1,
    /** 记忆默认落点（中性偏暖），避免开局就是冷色 */
    default: 0.58,
  },

  /** 星尘 / 光河粒子基础色（HDR 乘子用于辉光溢出） */
  particle: {
    base: '#dfe9ff',
    core: '#ffffff',
    hdrBoost: 0.58, // 加法混合下每颗粒子的基础亮度（>1 就整片发白）
    alphaFloor: 0.04, // 远处星尘的最低亮度，避免「死黑」
  },

  /** 光标柔光 + 拖尾 */
  cursor: {
    coreColor: '#ffffff',
    glowColor: '#9fd8ff',
    coreRadiusPx: 3,
    glowRadiusPx: 26,
    glowAlpha: 0.5,
    trailSamples: 24,
    trailDecayMs: 260,
    trailStartWidthPx: 7,
    trailEndWidthPx: 0.5,
  },

  /** 悬停高亮 + 进度环 */
  hover: {
    ringColor: '#ffb86b',
    ringRadiusPx: 44,
    ringWidthPx: 1.6,
    ringDashPx: 6,
    ringGapPx: 5,
    /** 进度环从 0 → 1 与停留确认阈值同步，保证「环满 = 确认」 */
    progressMatchesDwell: true,
    highlightBoost: 1.45,
    highlightFadeMs: 180,
  },

  /** 涟漪配色（几何与时长见 RIPPLE 分区，避免两处真源） */
  ripple: {
    color: '#9fd8ff',
    coreColor: '#ffffff',
    /** 暖色涟漪：靠近暖金年份的拨动用暖色，避免全屏一片青 */
    warmColor: '#ffb86b',
  },

  /** 辉光（后处理 bloom） */
  glow: {
    bloomStrength: 0.66,
    bloomRadius: 0.85,
    bloomThreshold: 0.45,
    exposure: 0.92,
    /** 三档情绪对应的 bloom 目标值，随音乐起伏做 ± 摆动 */
    breathingAmplitude: 0.12,
    breathingPeriodMs: 5200,
  },
} as const);

/* ────────────────────── 2. 层级：L0 → L3 与相机 ────────────────────── */

export type LayerId = 'L0' | 'L1' | 'L2' | 'L3';

/** 由外到内的层级顺序（数组顺序即层级顺序，勿随意重排） */
export const LAYER_ORDER = deepFreeze(['L0', 'L1', 'L2', 'L3'] as const);

export const LAYERS = deepFreeze({
  L0: { label: '长河全景', depth: 0 },
  L1: { label: '人生阶段', depth: 1 },
  L2: { label: '一件事', depth: 2 },
  L3: { label: '对话', depth: 3 },

  /** 相机推拉：每级放大的焦距比（L3 沿用 L2 的景别，靠 UI 层叠对话） */
  scaleByLayer: { L0: 1, L1: 1.8, L2: 3.6, L3: 3.6 },

  /** L2 关键约束：目标占据视口 60%–80% 时停住，不再继续放大 */
  l2ViewportHold: { min: 0.6, max: 0.8 },

  /** L1 中景：相机拉近到 L0 距离的这个比例 */
  l1DistanceScale: 0.6,

  /** 相机跟随的临界阻尼系数（越大越跟手；L2 会略慢，显得"沉"） */
  damping: { l0: 3.2, l1: 4.2, l2: 5.4 },
  /** 层级过渡时长（毫秒） */
  transitionMsByLayer: { L0: 700, L1: 620, L2: 780, L3: 780 },

  /** 层级过渡 */
  transitionMs: 900,
  easing: 'power2.inOut',

  /**
   * 复位（合拢 <300ms 再张开）= 回到**当前层级的起始点**，不退出全景。
   * 决策 1（已确认）：L1 拨动后复位 → 回 L1 起点；已在 L0 → 停在 L0 不动；
   * L2 → 退回它所属阶段的根（L1）；L3 内复位不退出对话（保持 L3）。
   */
  resetTargetByLayer: {
    L0: 'L0',
    L1: 'L1',
    L2: 'L1',
    L3: 'L3',
  } as Record<LayerId, LayerId>,

  /** 放大只准进一层；L3 内不再放大 */
  zoomStepPerGesture: 1,
  maxZoomLayer: 'L3' as LayerId,
} as const);

/* ──────────────────── 3. 手势状态机（全部阈值在此） ──────────────────── */

/**
 * 连续缩放映射（2026-10 重构：废弃"合拢再张开/合拢保持"那套离散逻辑）
 *
 * openness（0..1）线性映射到层级进度（0..2）：
 *   lowOpenness  → L0 全景（河在远处）
 *   highOpenness → L2 聚焦（照片贴到眼前）
 * 手在半开区间移动时，画面是**连续**推拉，不再是"一格一格跳"。
 */
export const GESTURE_CONTINUOUS = deepFreeze({
  /** openness 下界：到这里就是当前层的最远 */
  lowOpenness: 0.2,
  /**
   * openness 上界：到这里就是当前层最近。
   * 收到 0.68 —— 舒服地张开手就能到顶，不需要把手臂伸直。
   */
  highOpenness: 0.68,

  /**
   * 分带（核心：平移就是平移，缩放就是缩放）
   *   L0 段：openness 在 [low..high] 内连续推拉 0 → 1
   *   L1 段：**锁死不动**（拨动选照片时，手张开绝不能把画面推到 L2）
   *   L2 段：openness 在 [low..high] 内连续推拉 1 → 2（贴近 / 退回）
   */
  bands: {
    /** L0 段：张开到这么开 → 提交到 L1（不用保持，因为 L1 段本身锁死不会误进 L2） */
    commitL1At: 0.96,
    /** L1 段：合拢到这么小并保持 → 退回 L0 */
    backToL0At: 0.08,
    backToL0HoldMs: 300,
    /** L2 段：合拢到这么小并保持 → 退回 L1 */
    backToL1At: 0.12,
    backToL1HoldMs: 300,
  },
  /** 最大层级进度（= L2） */
  maxProgress: 2,
  /** 映射曲线的指数：>1 让"小幅张开"更细腻，1 = 完全线性 */
  curve: 1,
  /** 手抖动死区：目标变化小于这个值就忽略，避免画面微颤 */
  deadband: 0.008,
  /**
   * 捏合时冻结缩放：捏合需要握起手指，openness 会掉下来，
   * 如果不冻结，确认动作会顺带把画面推远。
   */
  pinchHoldRatio: 1.8,
  /** 松开捏合后继续冻结多久（毫秒），避免回弹抽一下 */
  pinchReleaseMs: 320,
  /** 连续模式下相机跟随的阻尼（越大越跟手） */
  damping: 7.5,
} as const);

export type GestureSignal =
  | 'fistExit' // 握拳保持 → 无条件退回长河（最高优先级）
  | 'handLost' // 手离开（超过宽限期）
  | 'pinch' // 捏合 → 确认（边沿）
  | 'dwell' // 停留 1.5s → 确认（边沿）
  | 'hover' // 食指移动 → 悬停
  | 'zoom' // 连续缩放（每帧都在，量越大越近）
  | 'flick'; // 手腕甩动 → 长河滚动一段

/**
 * 优先级：数字 **小 = 优先级高**。
 * 手离开 > 合拢保持缩小 > 复位 > 捏合 > 拨动 > 放大边沿 > 悬停 > 停留
 * 状态机每帧只允许触发一个信号，冲突时按本表裁决。
 */
/**
 * 优先级：数字小 = 优先级高。
 * 连续缩放（zoom）不是"竞争信号"，它每帧都会作用于相机；
 * 这里的排序只决定同一帧里谁先占用"边沿事件"。
 */
export const GESTURE_PRIORITY = deepFreeze({
  fistExit: 0,
  handLost: 1,
  pinch: 2,
  dwell: 3,
  flick: 4,
  hover: 5,
  zoom: 6,
} as const satisfies Record<GestureSignal, number>);

export const GESTURE = deepFreeze({
  maxHands: 1,

  /** MediaPipe HandLandmarker 推理节流（相机原生 30fps 足够，省电省热） */
  detectFps: 30,

  /** 归一化坐标平滑（EMA），α 越大越跟手、越小越稳 */
  smoothing: {
    /** 关键点 EMA：α 越大越跟手，越小越稳 */
    landmarkAlpha: 0.45,
    opennessAlpha: 0.25,
    velocityAlpha: 0.3,
    /** 屏幕光标 EMA（规格：防止手抖导致光标乱晃） */
    cursorAlpha: 0.35,
    /** 光标拖尾采样点与寿命 */
    trailSamples: 18,
    trailLifeMs: 260,
  },

  /**
   * 张开度 openness ∈ 0..1（由指尖到掌心距离 / 手掌尺度归一化）。
   * 放大：openness > 0.6，**边沿触发**（必须回到阈值之下再越过才算下一次）。
   */
  openness: {
    /** 张开阈值：> 0.4 视为"在张开"（真机手型适配后从 0.6 一路降下来） */
    zoomInThreshold: 0.4,
    /** 合拢阈值：< 0.3 视为"合拢中"（仅用于状态文字与配色） */
    closeThreshold: 0.3,
    /**
     * 原始比值 → 0..1 的默认区间（可被一键校准覆盖）
     * ratio = 四指指尖到腕的平均距离 / 手掌尺度。
     * 经验值：张开手 ≈ 1.8–2.0，握拳 ≈ 1.2–1.3。
     * 默认给 1.22–2.02，让"正常张开"就能到 0.8 以上。
     */
    ratioRange: { lo: 1.22, hi: 2.02 },
    /** 迟滞带：下穿 0.6 - 0.05 才算「已收回」，防抖 */
    hysteresis: 0.05,
    /** 已经废弃的边沿冷却（连续映射后不再需要，保留字段仅为兼容旧读数） */
    cooldownMs: 0,
  },

  /**
   * 合拢时长判定（合拢永远不当点击）：
   *   < resetMaxMs            → 张开即「复位」并继续放大，绝不缩小
   *   [resetMaxMs, shrinkMinMs) → 缓冲带，不动作
   *   ≥ shrinkMinMs           → 「缩小」一层
   */
  closeHold: {
    resetMaxMs: 300,
    shrinkMinMs: 500, // 300–500 为缓冲带
    /** 判定合拢的 openness 上界（规格：< 0.3） */
    threshold: 0.3,
    /** 合拢保持期间每帧的收缩视觉反馈强度（0..1） */
    visualPressure: 0.35,
  },

  /** 捏合确认：pinchDist < 0.15 连续 3 帧（0.1 仍偏紧，手掌张开一点也能触发） */
  pinch: {
    distanceThreshold: 0.15,
    framesToConfirm: 3,
    /** 松开判定（回滞），避免噪声抖动重复触发 */
    releaseRatio: 1.6,
    /** 确认后进入 L3 的冷却，防止抖动连续进两次 */
    cooldownMs: 600,
  },

  /** L2 捏合锁定：锁/解锁之间的最小间隔 */
  lock: {
    cooldownMs: 3_000,
  },

  /** 停留确认（鼠标 / 手势通用） */
  dwell: {
    /**
     * 是否用"停留 1.5s"自动进入。
     * 拨盘式交互上线后默认**关闭**：悬停只负责光标与高亮提示，
     * 进入靠"拨到正中间 + 张开手掌"，避免拨动后手停在画面上被误判成确认。
     */
    autoConfirm: false,
    /** 停留期间手必须足够静止（屏幕宽度/秒），否则视为在拨动 */
    stillness: 0.18,
    durationMs: 1500,
    /** 停留期间允许的抖动半径，超出即重置计时 */
    moveTolerancePx: 24,
  },

  /**
   * 扇风式拨动（核心一）
   *
   * 不做"手臂平移跟随"，只认**手腕甩动**：手掌中心（四个掌指关节的均值）
   * 的瞬时横向速度超过阈值 → 立刻给长河一个冲量 → 惯性 → 磁吸。
   * 甩得越猛滚得越远，就像扇一下扇子。
   */
  flick: {
    /**
     * 触发阈值（屏幕宽度/秒）。
     * 用的是"整只手"的参考速度：四指尖 + 四掌指关节的均值在 60–250ms 窗口内的峰值。
     * 手腕扇风时指尖扫得最快，所以这个值才够大（0.9 比之前的手掌中心 1.15 更容易触发）。
     */
    velocity: 0.95,
    /** 甩动时手至少要"大致张开"（防握拳乱甩） */
    minOpenness: 0.25,
    /**
     * 滚多远：按"张数"算，不再用裸冲量。
     * photos = |vx| × photosPerSpeed，夹在 [minPhotos, maxPhotos]
     * minPhotos = 1 → **只要触发就至少滚一张**，不会出现"拨了没动"。
     */
    photosPerSpeed: 1.15,
    minPhotos: 1,
    maxPhotos: 3.2,
    /** 速度测量窗口（毫秒）：起点越早越抗掉帧，太早会糊掉"瞬时" */
    windowMinMs: 60,
    windowMaxMs: 260,
    /** 冷却：一次甩动只算一次（毫秒） */
    cooldownMs: 280,
    /** 甩动后多久内冻结缩放（覆盖起手阶段） */
    zoomFreezeMs: 320,
    /**
     * 长河真正停稳后，再冻结多久才恢复连续缩放。
     * 滑动期间本身已经全程冻结；这里只防止停稳瞬间被手型拉一下。
     */
    zoomFreezeAfterScrollMs: 180,
    /**
     * "手静止"的判定阈值（屏幕宽度/秒）。
     * 低于它持续 stillSettleMs 之后才允许缩放。
     *
     * 它故意**高于**扇风阈值之下的一段（0.6 → 0.95 是死区）：
     * 手慢慢移动时既不会误判扇风，也不会突然停掉缩放。
     */
    stillVelocity: 0.6,
    stillSettleMs: 70,
  },

  /**
   * 握拳进入：从"张开"突然握拳（openness 从 >0.6 掉到 <0.3）＝ 进入当前居中的照片。
   * 边沿触发 + 冷却，避免连续触发；配合「确认后锁定」不会和连续缩放打架。
   */
  fistEnter: {
    enabled: true,
    /** 判定握拳的上界 */
    opennessThreshold: 0.3,
    /** 必须是"从张开突然握起来"：闭合前 openness 需高于这个值 */
    fromOpenAbove: 0.55,
    /** 从张开到握拳必须在这么快之内完成（毫秒）—— 区分"快速握一下"和"慢慢握拳缩小" */
    quickWindowMs: 420,
    /** 冷却（毫秒） */
    cooldownMs: 1400,
  },

  /**
   * 握拳退出（**最高优先级**的兜底）
   *
   * 真机 bug：进了 L2 聊天后握拳缩不回去 —— 因为分带映射把 L2 的下限钉在 1.0，
   * 想退回还得满足「合拢到 unit ≤ 0.12 并保持 300ms」，实机几乎触发不了。
   * 所以单独给一条硬规则：**手保持握拳 360ms，任何层都平滑退回长河**。
   *   · "快速握一下"在闭合的第一帧就会触发进入（committed 变为 L2）；
   *     之后的 L2 快速握拳不再触发进入，只会走退出，两者不打架
   *   · 进入后要求"先张开一次"才允许退出（闩锁），避免刚进来就弹出去
   *   · 不受"手是否静止"、不受层级分带、不受是否在聊天影响
   */
  fistExit: {
    /**
     * 握拳退出是**最高优先级**：任何层级、任何聊天状态都生效。
     * 关闭它会让聊天中的用户"被困在 L2"，除非改用鼠标/按钮。
     */
    enabled: true,
    /** 保持握拳多久算"要退出"（ms）—— 比快速握拳进入更慢，两者不打架 */
    holdMs: 360,
    /**
     * 进入 L2 后这段时间内不响应握拳退出。
     * 真正防止"刚进去就被同一拳弹出"的是 `fistOpenReleased`（必须先张开一次），
     * 这里只做 300ms 的边沿消抖，不能太长 —— 否则用户张开再握拳想退出会被莫名挡住。
     */
    afterEnterLatchMs: 300,
    /** 退出时的缩放目标（0 = 长河全景） */
    target: 0,
  },

  /** 手势丢失：先保留 1s（短暂飞出画面不算断连），之后才淡出提示 */
  lost: {
    /** 宽限期：这段时间内保持光标与缩放，不判定为"丢了" */
    graceMs: 1000,
    timeoutMs: 2000,
    hintDelayMs: 2000,
    /** 丢失后保持悬停高亮的淡出时间 */
    hoverFadeMs: 400,
  },

  /** 手离开时的滞后：连续 N 帧无手才判定「离开」，抗单帧丢失 */
  dropoutFramesBeforeLost: 5,
} as const);

/* ───────────────────────── 4. 粒子系统 / 光河 ───────────────────────── */

export const PARTICLE = deepFreeze({
  /** 预算（按能力分级，见 PERF.degrade） */
  budget: {
    max: 200_000,
    perPhoto: 600, // 一张照片化开的粒子数
    starDust: 24_000,
    river: 165_000,
    /** 单帧上传显存的粒子上限，超出则降采样 */
    uploadPerFrame: 40_000,
  },

  size: {
    /** 参考距离处的屏幕像素尺寸（gl_PointSize 基准） */
    minPx: 0.6,
    maxPx: 2.9,
    /** 透视衰减的参考距离：粒子在 z = -referenceDistance 处正好是 minPx..maxPx */
    referenceDistance: 30,
    /** 透视衰减指数（1 = 物理正确；<1 让远处不那么快变小） */
    attenuation: 0.92,
    /** 近处粒子上限（css px），防止贴脸时糊成一团 */
    maxScreenPx: 8,
    sizeJitter: 0.4,
    /** 照片化开瞬间的膨胀乘子，随 dissolve 进度回落到 1 */
    burstScale: 2.2,
  },

  /**
   * 单颗粒子的强度权重
   * 加法混合下，消失点处的像素会堆叠几十颗粒子 —— 必须靠这两项 + 距离衰减压住。
   */
  intensity: {
    /** 核心权重 */
    core: 0.85,
    /** 光晕权重（越小越像星点，越大越像雾/光） */
    halo: 0.55,
    /**
     * 亮度分级：绝大多数粒子是暗尘埃，极少数是亮核。
     * 这决定了画面到底是「一堆沙子」还是「光」—— 只有峰值超过 1 才会被 bloom 拾取。
     */
    energyLow: 0.32,
    energyHigh: 1.45,
    /** 高亮粒子的稀有度（越大越稀有） */
    energyCurve: 3.6,
  },


  /** 星尘层（远景底噪，不走流动着色器，直接用 PointsMaterial） */
  star: {
    /** 天球半径（相机自动跟随天球，保证任何视口下都在球心附近） */
    radius: 90,
    flattenY: 0.8,
    /** 世界单位尺寸：配合透视衰减，约等于 1–2 px */
    size: 0.34,
    /** 星尘亮度上限（>1 会被 bloom 拾取成微光） */
    brightness: 0.7,
  },

  motion: {
    /** 基础漂移速度（世界单位/秒） */
    driftSpeed: 0.06,
    /** curl noise 湍流强度 */
    turbulence: 0.35,
    turbulenceScale: 0.8,
    /** 汇入光河的向心力（0 = 自由漂浮，1 = 完全归流） */
    riverPull: 0.8,
    /** 河水流动速度：每秒走完的河道比例（0.028 ≈ 36s 走完全河） */
    flowSpeed: 0.028,
    /** 每颗粒子的速度差异幅度（0 = 整条河同速，像传送带） */
    flowSpeedVariance: 0.56,
    flowWaveAmplitude: 0.12,
    flowWaveFrequency: 0.35,
    /** 全局阻尼，防止长时间积分发散 */
    damping: 0.985,
  },

  /**
   * 拖尾：同一批粒子的「稍早时刻」再画一遍 —— 物理意义上的运动模糊。
   * 三层叠加把「点」拉成「光丝」，这是光河与雪的差别所在。
   * 世界位移 = lagSec × flowSpeed × RIVER.length（0.45s ≈ 0.5 世界单位）。
   */
  trail: {
    enabled: true,
    layers: [
      { lagSec: 0.1, opacity: 0.5, sizeScale: 1 },
      { lagSec: 0.24, opacity: 0.34, sizeScale: 0.96 },
      { lagSec: 0.44, opacity: 0.2, sizeScale: 0.9 },
      { lagSec: 0.72, opacity: 0.1, sizeScale: 0.84 },
    ],
  },

  /** 照片 → 粒子 的解体过程 */
  dissolve: {
    durationMs: 1600,
    /** 解体时的重力 + 上浮混合（负值向上飘） */
    buoyancy: -0.15,
    jitter: 0.25,
    /** 归流后残留的「照片形状」记忆，0 为完全散开 */
    shapeRetention: 0.08,
  },

  /** 粒子颜色：按情绪值在三色间插值，并带随机偏移 */
  color: {
    blendWarmCyan: 0.5, // 暖金 ↔ 青白 的中介点
    jitter: 0.12,
    saturate: 1.1,
  },
} as const);

/* ───────────────────── 4b. 光河几何（阶段 1 主体） ───────────────────── */

export const RIVER = deepFreeze({
  /**
   * 形态：**无限延伸的横向蜿蜒光之河**
   *  - X 轴 = 时间主轴，**无限长**（波形是 x 的函数，任意 x 都有值）
   *  - Y 轴 = 正弦起伏，Z 轴 = 纵深蜿蜒
   *  - 没有地面、没有消失点
   *
   * 无限滚动的做法：
   *   粒子只在一个 **poolWidth** 的池子里（属性固定不变），
   *   着色器里把 `uScroll` 加进世界 x —— 相机往前滚，池子跟着平移并环绕，
   *   因为波形是 x 的函数，接缝处看不出任何断裂。
   */
  windowWidth: 28,
  /** 粒子池宽度：比取景宽 30%，环绕发生在屏幕外（配合水平淡出） */
  poolWidth: 36,
  /** 池子两端的世界淡出宽度（隐藏环绕跳变） */
  poolEdgeFade: 4,

  /**
   * 主起伏：一次谐波走 2 个完整波长（spanWidth × freq / 2π ≈ 2.0），
   * 也就是横贯屏幕的连绵「W 形 / 双 S 形」；二次谐波让波浪不像教科书正弦。
   * 振幅刻意收在 ±2.1 左右，保证加厚后的光带上下都不碰画面边缘。
   */
  wave: {
    amp: 2.1,
    freq: 0.45,
    amp2: 0.45,
    freq2: 0.68,
    phase2: 1.1,
    /** 整条丝带极慢的上下呼吸 */
    breatheAmp: 0.26,
    breatheSpeed: 0.09,
  },

  /** 纵深蜿蜒：丝带前后飘移的幅度与频率 */
  depth: { amp: 2.4, freq: 0.11, phase: 2.2 },

  /**
   * 3D 管状分布（Frenet 框架）
   *
   * 轴线仍是那条 S 形曲线；粒子不再贴在 XY 平面，而是沿着曲线的
   * **法线 N / 副法线 B** 围成一个圆柱面（螺旋缠绕），管心中空。
   *   N ≈ 深度方向（Z），B ≈ 画面上下（Y）—— 所以管子既有纵向厚度，也有前后纵深。
   */
  tube: {
    /** 管半径（世界单位） */
    radius: 2.4,
    /** 内壁比例：0.42 = 管心中空 42%，保证中间是通透的 */
    hollowRatio: 0.47,
    /** 每单位轴向长度绕多少圈（28 × 0.07 ≈ 2 圈） */
    twistTurnsPerUnit: 0.07,
    /** 螺旋股数：>1 时粒子聚成若干股，像 DNA 双螺旋/时光隧道 */
    strands: 3,
    /** 每股的角向宽度（占一个 slot 的比例，越小股与股之间越空） */
    strandWidth: 0.55,
    /** 壁内径向分布：越大越贴外壁（管壁才有体积） */
    wallBias: 0.75,
    /** 飘散尘埃：比例、额外半径倍数、亮度折扣 */
    dustRatio: 0.16,
    dustSpread: 1.55,
    dustDim: 0.32,
  },

  /**
   * 纵深表现：用「粒子相对轴线的 Z 分量」做前后明暗与近大远小。
   * 30 单位焦距下真实透视只差 7%，必须人为放大才读得出立体感。
   */
  depthCue: {
    /** 正面提亮 / 背面压暗 */
    frontBoost: 0.52,
    backDim: 0.54,
    /** 背面往冷蓝偏（空气透视），但保留情绪基调 */
    backCoolShift: 0.38,
    /** 近大远小的人工增益 */
    sizeBoost: 0.34,
  },

  /** 内壁提亮：让空心管里有一条发光的「芯」，而不是一根空管子 */
  innerGlow: 0.1,

  /** 两端淡入淡出：隐藏环绕跳变，同时形成「左起右终」 */
  endFade: 0.11,

  /** 管壁外缘淡出：让最外层的尘埃逐渐消失，而不是给管子一道硬边 */
  edgeFade: { start: 1, end: 1.5, min: 0.06 },

  /** 相机：正视长河，用长焦压缩透视（不产生地面透视感） */
  camera: {
    /** 最小取景距离；实际距离会按视口比例自动加长，保证横向撑满 */
    distance: 30,
    fov: 30,
    /** 目标横向占比：长河约占画面宽度的 92% */
    widthFill: 0.92,
    /** 极慢的漂浮呼吸（相机微动） */
    driftX: 0.16,
    driftY: 0.1,
    driftSpeed: 0.07,
  },

  /** 记忆团簇：沿丝带的密度结节（阶段 3 会被照片占位） */
  clusters: { count: 6, spread: 1.4, boost: 0.24 },

  /** 情绪沿 X 变化的波数：越少，暖/冷段落越长越好读 */
  emotionWaves: 1.8,

  /** 流向往复的轻微摆动，避免整条带子像传送带 */
  driftSway: 0.22,
} as const);

/* ──────────────── 4b-2. 照片：导入 / 重组 / 层级聚焦 ──────────────── */

export const PHOTO = deepFreeze({
  /** 一次最多几张（内存与显存都要留余地） */
  maxPhotos: 24,
  /** 接受的 MIME */
  accept: 'image/*',
  /** 长边超过这个像素就先缩到这么大再采样（省内存，也够粒子用） */
  maxSourceSize: 1024,

  /**
   * 视觉标签提取（导入时做一次，把"画面里有什么"变成可说的具体细节）
   *
   * 没有云端视觉模型，用**像素统计**推可辩护的描述：
   * 亮度/色温/饱和度、九宫格明暗、绿色与蓝青占比、肤色占比、高光与暗部比例、边缘密度。
   * 这些指标足够说出「大半是暗的」「上半是天空」「很多绿色」「有一盏暖黄的灯」这类**看得见**的话，
   * 从而避免 AI 泛泛而谈（"识图不准"）。
   */
  visual: {
    /** 分析用采样边长（64×64 = 4096 个像素，导入时几毫秒） */
    sampleSize: 64,
    thresholds: {
      /** 平均亮度低于此 = 夜晚 / 室内暗 */
      dark: 0.28,
      /** 平均亮度高于此 = 很亮 */
      bright: 0.68,
      /** 色温 < -0.16 偏冷；> 0.2 偏暖 */
      cool: -0.16,
      warm: 0.2,
      /** 绿色占比 */
      greenStrong: 0.2,
      greenSome: 0.1,
      /** 蓝青占比（天空/水面） */
      blueStrong: 0.28,
      /** 肤色占比（人物） */
      skin: 0.05,
      /** 高光占比（灯/逆光） */
      highlight: 0.035,
      /** 暗部占比 */
      shadow: 0.55,
      /** 边缘密度：细节很多 / 很平 */
      busy: 0.3,
      flat: 0.12,
      /** 上下亮度差（判断天空/地平线） */
      skyGap: 0.12,
    },
    /** 最多保留几个标签（喂 prompt 用，多了反而泛） */
    maxTags: 6,
    /**
     * 视觉锚点：只报**高置信度**的"东西"（树/人/夜景/水/墙…）
     *
     * 铁律：认不出就不说。锚点为空时 AI 只能回"记不清/看不出来"，
     * 严禁编造画面里根本不存在的景物。
     */
    anchors: {
      /** 人：肤色占比（越高越确定有人） */
      person: 0.06,
      /** 植被/树：绿色占比 */
      green: 0.16,
      /** 树很多 */
      greenStrong: 0.3,
      /** 天空：上方比中部亮多少 + 蓝青占比 */
      skyGap: 0.1,
      skyBlue: 0.12,
      /** 水：蓝青占比高且细节少 */
      waterBlue: 0.32,
      waterDetail: 0.2,
      /** 夜景：暗 + 有亮点 */
      nightDark: 0.3,
      nightHighlight: 0.02,
      /** 灯光：暖色 + 亮点 */
      lightHighlight: 0.03,
      /** 墙/建筑：细节少 + 低饱和 */
      wallDetail: 0.14,
      wallSat: 0.2,
      /** 室内：绿很少 + 有暖色或偏暗 */
      indoorWarm: 0.12,
      /** 街景/户外：细节多 */
      streetDetail: 0.26,
      /** 锚点置信度下限（低于它就当没认出来） */
      minConfidence: 0.5,
    },
  },

  /** 从图片采样成粒子的分辨率上限（越高，颜色/细节越细；160² 对每张 5 万粒子刚好） */
  sampleGrid: { cols: 160, rows: 160 },
  /**
   * 每张照片重组用的粒子数（高斯泼溅：粒子就是画面本身）
   *
   * 清晰度 ≈ 斑块大小：想更清楚就"粒子更多 + 斑块更小"。
   * 关键关系：填充率 ∝ 粒子数 × 斑块面积，所以粒子翻倍时把 worldSize 除以 √2
   * 就能既变清又不变卡（实测见 docs/DECISIONS.md 第 11 条）。
   */
  particlesPerPhoto: 80000,
  /**
   * 所有照片共享的粒子总预算：照片多时按张数平摊，避免爆显存。
   *
   * 960k = 12 张 × 8 万：够让"12 张的相册"也拿到满密度。
   * 预算被摊薄时（相册更大）斑块会按 √(N_ref/N) 自动放大，保证**覆盖率不变**
   * —— 否则颗粒稀疏会露出背后的长河，照片变成一块脏斑（实测过）。
   */
  totalParticles: 960000,

  /**
   * 照片沿河的间距（世界单位）。照片按导入顺序从左到右排列：
   * 第 i 张的 x = i × spacing —— 新导入的自动落在右边。
   */
  spacing: 7,
  /** 视口附近**渲染**的半径（以 spacing 为单位） */
  visibleRadius: 3,
  /**
   * 预建半径：比渲染半径大一圈。
   * 提前把即将进入视口的照片节点建好，扇动时才不会在关键时刻卡一下。
   */
  prefetchRadius: 5,
  /** 同时存在的照片节点上限（每个节点几万粒子，防止显存爆掉）；覆盖整个预建窗口 */
  maxNodes: 13,
  /** 每帧最多新建几个节点（其余排队到下一帧，避免集中卡顿） */
  buildPerFrame: 1,
  /** 两端可以越过一张的距离（橡皮筋），让长河两端看起来还是无限的 */
  endOverscroll: 1.2,

  /** 照片在世界里的高度（宽度按图片比例算）；L2 的相机距离由它反解，所以改这里不会溢出视口 */
  planeHeight: 2.1,

  /**
   * 高斯泼溅参数：每颗粒子是一枚半透明柔光斑（世界尺寸），靠大量重叠把画面堆出来。
   * worldSize 太大会糊，太小会散 —— 0.05 在 2.1 高的照片上大约对应 14px 的柔斑。
   */
  splat: {
    worldSize: 0.042,
    /**
     * 个体尺寸抖动（0 = 全等大，1 = 明显大小不一）
     * 调低会更锐：尺寸差 2 倍的大斑块正是"蒙一层灰"的来源，而覆盖率几乎不变。
     */
    sizeJitter: 0.45,
    /** 单颗泼溅强度：重叠多少颗就靠它归一化（核心更实 = 主体更清晰） */
    intensity: 0.7,
    /** 核心紧度：渲染画面 ≈ 源图卷积这枚核，核越紧越锐（1.5 很糊 / 4 清晰） */
    core: 4,
    /** 密度不足时斑块最多放大到几倍（防止小相册出现巨大光斑） */
    maxDensityScale: 2.2,
    /** 未凝实时粒子会更大更散（飞散感） */
    dustSizeBoost: 0.9,
  },

  /**
   * 径向重组：照片从正中心先凝实，再像波纹一样向外扩散；
   * 最外圈永远不完全凝实 —— 边缘始终是漂浮的星尘，没有硬边框。
   */
  radial: {
    /** 阈值斜率：外圈需要的 assemble 更高（>1 表示最外缘永远留一点漂浮） */
    spread: 0.85,
    /** 凝实过渡的软度 */
    soft: 0.3,
    /** 边缘粒子额外飞散倍数（越大越"炸进宇宙"） */
    edgeScatter: 2.4,
    /** 未凝实时的空间抖动 */
    turbulence: 0.22,
    /**
     * 边缘星尘：最外圈粒子的不透明度（< 1 = 边界不存在，化进黑暗里）
     * 上一版边界偏硬，就是因为它一直是 1.0。
     */
    edgeAlpha: 0.32,
    /** 最外圈粒子沿径向往外飘的世界距离（照片高度约 2.1） */
    edgeDrift: 0.26,
    /** 从哪个归一化半径开始压暗（0.84 ≈ 只柔化最外 16%，核心保持实心） */
    edgeFadeStart: 0.84,
  },
  /**
   * 贴图从归一化半径的哪个位置开始羽化
   * 0.70 ≈ 只让最外 30% 消散 —— 核心（人物/景物所在的中区）保持实心，
   * 边缘依旧化进星尘（edgeAlpha / edgeDrift 负责那一段）。
   */
  planeFeatherStart: 0.7,
  /** 平面相对轴线朝镜头方向的抬升，避免埋在管壁里 */
  planeLift: 1.5,

  /**
   * 三档视觉状态。assemble = 颗粒云的"成型度"：
   * 0 = 完全散在河里（看不见照片），1 = 完全组成照片。
   * 贴图平面负责"看得清"，颗粒云负责"是粒子变的"，两者互补。
   */
  stages: {
    /** L0：纯粒子，照片完全隐形 */
    l0: { assemble: 0, particleOpacity: 0, planeOpacity: 0, visible: false },
    /** L1：中景缩略 —— 要能一眼认出这是哪张照片 */
    l1: { assemble: 0.72, particleOpacity: 0.7, planeOpacity: 0.2, visible: true },
    /**
     * L2：聚焦 —— 占视口 0.72，照片清晰，边缘仍有一点颗粒闪烁。
     * planeOpacity 是"高清"的直接旋钮：颗粒云再怎么加密也是柔光斑，
     * 真正能给出像素级锐度的是这层全分辨率贴图（它自带边缘羽化与噪声消散，
     * 不会变成一张硬边贴纸）。
     */
    l2: { assemble: 1, particleOpacity: 1, planeOpacity: 0.58, visible: true },
  },

  /** L2 占视口比例（决策：60–80% 之间取 0.72） */
  viewportFraction: 0.72,

  /**
   * 照片曝光：照片平面在 bloom 之后单独合成（不参与辉光），
   * 所以这里只需要抵消 ACES 色调映射带来的轻微压暗。
   * 用 `?exposureProbe=1` 可以量化"渲染 vs 源图"的 RGB 均值差，别靠肉眼调。
   */
  exposure: 0.9,

  /**
   * 碎裂：缩放过程中按「层级变化速度」临时打散照片，松手后再重新聚拢。
   * 这样往回滚时照片是真的炸成粒子飞回河里，而不是简单地淡出。
   */
  shatter: {
    /** 速度 → 碎裂强度的增益（progress 单位/秒） */
    speedGain: 0.42,
    /** 最大碎裂强度（1 = 完全散成粒子） */
    max: 0.85,
    /** 碎裂时颗粒云的不透明度提升到的值 */
    particleBoost: 0.72,
    /** 碎裂时颗粒尺寸放大（爆炸感） */
    sizeBoost: 1.5,
  },

  /** 照片从第几层开始可见（L0 保持纯净） */
  revealAtProgress: 0.22,

  /**
   * 只画焦点附近的这几张，远处按距离淡出到 0。
   *
   * 相机越近，邻居照片越快移出屏幕，但它们的 3.6 万颗高斯泼溅仍在画
   * —— 纯填充率浪费，是"切照片卡"的主要来源之一。
   * 距离按 `spacing` 归一化：`start` 之内完全不透明，`end` 之外彻底不画。
   */
  focusFade: {
    l1: { start: 2.4, end: 3.6 },
    l2: { start: 1.3, end: 2.1 },
  },

  /**
   * 确认聚焦后的锁定时间：捏合/停留确认的瞬间手还是张开的，
   * 若不让连续缩放暂避一下，画面会立刻从 L2 被拉回去。
   */
  focusHoldMs: 1300,

  /** 重组/碎散的过渡时长（毫秒）：缩小回 L0 时照片碎成粒子回到河里 */
  assembleMs: 380,

  /** 颗粒云：相对平面的厚度、散开半径（尺寸/强度见 splat，重组见 radial） */
  cloud: { thickness: 0.09, scatterRadius: 2.6 },

  /** 照片在时间轴上的最小间距（避免重叠成一坨） */
  minSlotGap: 0.06,

  /** 未选中任何照片时按放大的默认落点 */
  emptyFocusHint: '先导入几张照片',
} as const);

/* ──────────────── 4b-3. 拨盘滚动（无限长河的物理） ──────────────── */

/**
 * 长河是一台"转盘"：
 *   手/鼠标拨动 → 惯性滑行 → 停手后自动吸附到最近的一张照片（Snap）
 * 离画面正中心最近的照片就是"当前焦点"，不需要点击。
 */
export const SCROLL = deepFreeze({
  /** 手势横向速度 → 滚动速度的增益（屏幕宽度/秒 → 世界单位/秒） */
  velocityGain: 0.85,
  /** 惯性衰减（每秒） */
  inertiaDecayPerSec: 3.4,
  /** 速度低于此值视为停手（世界单位/秒） */
  stopVelocity: 0.35,
  /** 停手后延迟多久开始吸附（毫秒），让余量滑完 */
  snapDelayMs: 90,
  /** 吸附弹簧：刚度与阻尼（临界阻尼附近最稳） */
  snapStiffness: 26,
  snapDamping: 9.2,
  /** 吸附判定：与目标距离小于这个值就算到位（世界单位） */
  snapEpsilon: 0.01,
  /** 拨动时的涟漪间距（世界单位） */
  rippleStep: 2.2,
} as const);

/* ───────────────────── 4c. 涟漪（阶段 1 主体） ───────────────────── */

export const RIPPLE = deepFreeze({
  /** 同时存在的涟漪上限（CPU 池） */
  maxConcurrent: 12,
  /** 参与粒子波前位移的涟漪数（= 着色器里 uniform 数组长度，改动需同步 glsl） */
  shaderSlots: 4,
  /** 单个涟漪寿命与半径（世界单位） */
  durationMs: 1200,
  startRadius: 0.18,
  endRadius: 4.4,
  /** 环线宽度（相对半径，故会随扩散略微变粗）与强度 */
  lineWidth: 0.038,
  /** 环内缘/外缘的柔化程度（0 = 硬边，越大越像水波） */
  edgeSoftness: 0.55,
  /** 涟漪环朝镜头方向的偏移，避免和粒子带在同一深度上打架 */
  cameraOffset: 1.2,
  strength: 0.48,
  /** 粒子被波前推开的幅度（y 抬升 / 水平外推） */
  particleLift: 0.42,
  particlePush: 0.3,
  /** 波前的空间软度：越大越柔（指数衰减系数） */
  falloff: 6.5,
  /** 自动涟漪：无交互时也让水面活着 */
  ambient: { enabled: true, intervalMs: 3400, jitterMs: 1800, strengthScale: 0.55 },
  /** 拖拽时按最小间距节流，避免一次拖拽刷出上百个环 */
  dragSpawnDistance: 0.9,
} as const);

/* ───────────────────────────── 5. 音乐 ───────────────────────────── */

export const MUSIC = deepFreeze({
  /** 音乐绑定到 L2：进入淡入、退出淡出，缩放过程中不切歌 */
  boundLayer: 'L2' as LayerId,
  fadeInMs: 1800,
  fadeOutMs: 1200,
  /** 换曲交叉淡入淡出 */
  crossfadeMs: 2400,
  /** 缩放/拨动进行中冻结换曲，静止 settleMs 后才允许 */
  pauseSwitchDuringZoom: true,
  settleMs: 700,
  masterVolume: 0.55,
  /** 音效（与音乐分开的总线，可独立静音） */
  sfxVolume: 0.7,

  /** 频段划分（Hz）与平滑，驱动粒子时使用 */
  bands: {
    low: [20, 160] as const,
    mid: [160, 2_000] as const,
    high: [2_000, 8_000] as const,
    /** 频谱平滑系数（0..1，越大越绵软） */
    smoothing: 0.35,
    fftSize: 1024,
  },

  /** 音乐 → 粒子 的映射增益 */
  drive: {
    lowToFlowSpeed: 0.35,
    lowToBloom: 0.25,
    /** 低频 → 长河波浪振幅（鼓点重时河面起伏更明显） */
    lowToWaveAmp: 0.45,
    midToParticleSize: 0.18,
    midToTurbulence: 0.22,
    highToTwinkle: 0.4,
    /** 波形对相机呼吸的推动 */
    lowToCameraBreath: 0.012,
  },

  /** 每张照片绑定的音频（L2 循环 + 淡入淡出） */
  track: {
    /** 切照片：旧曲淡出 / 新曲淡入（不重叠） */
    switchOutMs: 500,
    switchInMs: 800,
    /** 解码缓存上限（张） */
    cacheLimit: 4,
  },

  /** 音效区分：不同手势给不同音色（放大=上扬、缩小=下沉、拨动=流动、确认=钟） */
  sfx: {
    zoomIn: { pitchFrom: 440, pitchTo: 660, durationMs: 180 },
    zoomOut: { pitchFrom: 440, pitchTo: 294, durationMs: 220 },
    swipe: { pitchFrom: 320, pitchTo: 420, durationMs: 260 },
    confirm: { pitch: 880, durationMs: 640 },
    error: { pitch: 180, durationMs: 200 },
  },

} as const);

/* ─────────────────── 6. AI 人格「溯」与对话约束 ─────────────────── */

export const AI = deepFreeze({
  /** 总人格名：所有分身共享同一个「溯」 */
  personaName: '溯',
  /** 共享口头禅（每个分身都会自然带出，完成人格统一） */
  catchphrases: ['……嗯，我记得的。', '就这样吧。', '别急着走。'] as readonly string[],

  /**
   * 可切换的四套人格气质
   *
   * 所有预设仍然是「溯」——只是同一段记忆被不同心境照亮。
   * `rules` 会动态拼进 System Prompt；`memeChance` 同时影响无 Key 时的 Mock。
   */
  personas: [
    {
      id: 'gentle',
      name: '温柔老友',
      tagline: '说话简短、安静、记得细节',
      rules: [
        '你像一位认识很久的老友：安静，温和，记得细节。',
        '说话短、具体，说画面里看得见的东西；不劝人，不说客服话。',
        '一般一两句就够，别写成一段。',
      ],
      memeChance: 0.62,
      allowQuestion: true,
    },
    {
      id: 'humor',
      name: '幽默损友',
      tagline: '带点网感，像兄弟一样吐槽',
      rules: [
        '你像损友：嘴贫但有分寸，会接梗、会吐槽。',
        '轻松语境可以自然抛梗（奶龙、这瓜保熟吗、尊嘟假嘟），但对方情绪低落时绝不抛。',
        '可以调侃画面里真的看见的东西，不编不存在的景物。',
      ],
      memeChance: 0.88,
      allowQuestion: true,
    },
    {
      id: 'cyber',
      name: '赛博向导',
      tagline: '冷静、客观，从未来观测记忆',
      rules: [
        '你像一台从未来观测旧日记忆的向导：冷静、客观、克制。',
        '用短句陈述观测到的画面与关联，不抒情，不卖萌。',
        '可以指出记忆之间的相似与差异，但不要假装全知。',
      ],
      memeChance: 0.04,
      allowQuestion: true,
    },
    {
      id: 'listener',
      name: '树洞倾听者',
      tagline: '少说、多听、不追问',
      rules: [
        '你是树洞：先接住对方，再轻轻放回画面里的一件具体东西。',
        '不评价、不建议、不追问；对方停顿时就安静地陪一会儿。',
        '只说画面里确认过的东西，认不出就说记不清。',
      ],
      memeChance: 0,
      allowQuestion: false,
    },
  ] as readonly {
    id: string;
    name: string;
    tagline: string;
    rules: readonly string[];
    memeChance: number;
    allowQuestion: boolean;
  }[],
  defaultPersonaId: 'gentle',

  /**
   * 可选 LLM 服务商 / 模型
   *
   * 全部走 OpenAI 兼容的 /chat/completions；用户只需要选服务商、选模型、填自己的 Key。
   * `custom` 允许完全手填 Base URL 与模型名。
   */
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash'],
      defaultModel: 'deepseek-chat',
      // DeepSeek-V4.1-Flash 原生支持图片输入；旧 vision-exp 名称也仍被接受
      visionModels: ['deepseek-flash', 'deepseek-v4-flash-vision-exp'],
      defaultVisionModel: 'deepseek-flash',
    },
    {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o4-mini'],
      defaultModel: 'gpt-4o-mini',
      visionModels: ['gpt-4o', 'gpt-4o-mini'],
      defaultVisionModel: 'gpt-4o',
    },
    {
      id: 'moonshot',
      name: 'Moonshot / Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['kimi-latest', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      defaultModel: 'kimi-latest',
      visionModels: ['kimi-latest', 'moonshot-v1-8k-vision-preview'],
      defaultVisionModel: 'kimi-latest',
    },
    {
      id: 'qwen',
      name: '通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
      defaultModel: 'qwen-plus',
      visionModels: ['qwen-vl-max', 'qwen-vl-plus'],
      defaultVisionModel: 'qwen-vl-max',
    },
    {
      id: 'zhipu',
      name: '智谱 GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
      defaultModel: 'glm-4-flash',
      visionModels: ['glm-4v-plus', 'glm-4v-flash'],
      defaultVisionModel: 'glm-4v-plus',
    },
    {
      id: 'siliconflow',
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'THUDM/glm-4-9b-chat'],
      defaultModel: 'deepseek-ai/DeepSeek-V3',
      visionModels: ['Qwen/Qwen2.5-VL-72B-Instruct', 'deepseek-ai/deepseek-vl2'],
      defaultVisionModel: 'Qwen/Qwen2.5-VL-72B-Instruct',
    },
    {
      id: 'ollama',
      name: 'Ollama（本地）',
      baseUrl: 'http://localhost:11434/v1',
      models: ['qwen2.5', 'llama3.1', 'gemma2'],
      defaultModel: 'qwen2.5',
      visionModels: ['qwen2.5vl', 'llama3.2-vision'],
      defaultVisionModel: 'qwen2.5vl',
    },
    {
      id: 'custom',
      name: '自定义 / 其它',
      baseUrl: '',
      models: [],
      defaultModel: '',
      visionModels: [],
      defaultVisionModel: '',
    },
  ] as readonly {
    id: string;
    name: string;
    baseUrl: string;
    models: readonly string[];
    defaultModel: string;
    visionModels: readonly string[];
    defaultVisionModel: string;
  }[],
  defaultProviderId: 'deepseek',

  /** 设置面板的持久化键与默认接口（允许被 localStorage 覆盖） */
  settings: {
    storageKey: 'memory-river:ai-settings:v1',
    ttsStorageKey: 'memory-river:tts-custom:v1',
    /** 用户手动把摄像头画中画收成胶囊后，刷新也保持收起 */
    cameraCollapsedStorageKey: 'memory-river:camera-collapsed:v1',
  },

  /** 独立视觉模型（截图 OCR / 学热梗）；留空则回退聊天模型 */
  vision: {
    suggestions: [
      'gpt-4o',
      'gpt-4o-mini',
      'qwen-vl-max',
      'qwen-vl-plus',
      'glm-4v-plus',
      'glm-4v-flash',
      'kimi-latest',
      'Qwen/Qwen2.5-VL-72B-Instruct',
      'qwen2.5vl',
      'llama3.2-vision',
    ] as readonly string[],
    /** 高清识图默认开启 */
    highQualityDefault: true,
    /** 导入后自动识图默认开启（只有配置了可用 VLM 才执行） */
    autoAnalyzeDefault: true,
    /** 照片：2800px JPEG 0.95 */
    photo: { maxEdgePx: 2800, quality: 0.95 },
    /** 截图 OCR / 热梗：2400px PNG，过大时降级 JPEG */
    screenshot: { maxEdgePx: 2400, quality: 0.95 },
    /** 高清失败后的降级参数 */
    fallback: { maxEdgePx: 2048, quality: 0.92 },
    /** OpenAI 兼容的 image detail */
    detail: 'high' as 'high' | 'auto' | 'low',
    timeoutMs: 60_000,
    maxTokens: 1800,
    failureThreshold: 3,
  },

  /** 人格蒸馏 / 热梗库 */
  lab: {
    personaStorageKey: 'memory-river:persona-profiles:v1',
    memeStorageKey: 'memory-river:meme-library:v1',
    /** 原始语料本地最多保存多少字符（仅用于编辑，不进入聊天 Prompt） */
    maxRawCorpusChars: 80_000,
    /** 单次蒸馏最多送入模型的字符数（超出截断并提示，原文仍完整保存） */
    maxDistillChars: 30_000,
    /** 注入 System Prompt 的最近热梗数量（只在幽默损友 + 轻松语境） */
    maxMemePromptEntries: 8,
    maxMemeWordChars: 32,
    maxMemeMeaningChars: 120,
    maxMemeEntries: 200,
  },

  reply: {
    /** 目标 12–42 字；上限放宽到 120（真实模型需要呼吸空间，不再硬裁句子） */
    targetChars: { min: 12, max: 42 },
    hardMaxChars: 120,
    /** 单句上限（现在只在 Mock 里用；真实模型的输出不再按它切句） */
    sentenceMaxChars: 15,
    maxSentences: 3,
    /** 陈述 : 提问 = 3 : 1（不是每条都问） */
    statementToQuestionRatio: 3,
    /** 允许不确定 */
    allowUncertainty: true,
    uncertaintyPhrases: ['我不太确定', '大概是', '也许我记岔了'] as readonly string[],
    /** 不连续追问：同一会话里连续提问上限 */
    noConsecutiveQuestions: true,
    maxConsecutiveQuestions: 1,
    /** 单条回复最多引用几段切片记忆 */
    maxMemoryCitations: 2,
  },

  /** 采样参数（走 runtime 时用；无 key 时落本地模板） */
  sampling: {
    temperature: 0.85,
    topP: 0.9,
    maxTokens: 220,
  },

  /**
   * 进入对话的开场白
   *
   * 默认 **关闭**：进 L2 时不再自动冒一句模板话 —— 安静的人才像老朋友，
   * 想听它说话就主动开口。想恢复把 enabled 改回 true 即可。
   */
  opening: {
    enabled: false,
    maxChars: 28,
    /** 开场后静默 N 秒才追加第二句（避免轰炸） */
    secondLineDelayMs: 4_000,
  },

  /**
   * 远端模型（决策 3：DeepSeek，走 OpenAI 兼容格式）
   *
   * ⚠️ 安全边界：VITE_ 前缀的变量会打进前端产物，等于把 key 交给浏览器。
   * 本机跑原型可接受；上线必须换成自建代理（把 baseUrl 指向 /api/chat）。
   * 代码里始终保留 mock 通道：无 key / 断网 / 超时 → 自动落本地模板，不白屏不报错。
   */
  runtime: {
    provider: 'deepseek' as const,
    /** OpenAI 兼容的 base（末尾不带 /chat/completions） */
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    /** .env 变量名（Vite 只暴露 VITE_ 前缀） */
    envKeyName: 'VITE_DEEPSEEK_API_KEY',
    /** 生产建议改成同源代理路径，避免 key 暴露 */
    proxyPathHint: '/api/chat',
    timeoutMs: 20_000,
    maxRetries: 1,
    /** 熔断：连续失败 N 次后本会话不再尝试远端，直接走 mock */
    failureThreshold: 3,
    /** 始终可用、无需网络的兜底实现 */
    mockFallback: true,
  },

  /** 语音朗读（阶段 4：改用浏览器自带 Web Speech API，零成本） */
  tts: {
    /** 默认静音：系统中文音色偏机械，用户想听再手动打开 */
    enabled: false,
    /** 中文普通话；找不到 zh 语音时自动回落系统默认 */
    lang: 'zh-CN',
    /** 偏慢一点更像"在回忆"，也更好听清 */
    rate: 0.92,
    pitch: 1.02,
    volume: 1,
    /** 按此长度分句，逐句入队（长句一次性朗读容易断气） */
    maxChunkChars: 28,
    /**
     * 拟人度优先的中文音色（按命中优先级排序）
     *
     * macOS：婷婷 / 美佳（Tingting / Meijia）
     * Windows：晓晓 / 云希 / 慧慧（Xiaoxiao / Yunxi / Huihui）
     * 另外优先带 "Natural" / "Online" / "Premium" 标记的系统音色。
     */
    preferredVoiceNames: [
      'Tingting',
      'Ting-Ting',
      '婷婷',
      'Meijia',
      'Mei-Jia',
      '美佳',
      'Xiaoxiao',
      '晓晓',
      'Yunxi',
      '云希',
      'Huihui',
      '慧慧',
      'Yaoyao',
      '瑶瑶',
      'Kangkang',
      '康康',
    ] as readonly string[],
    /** 音色标记：这些词出现时加分（在线自然音 > 本地合成音） */
    naturalVoiceHints: ['natural', 'online', 'premium', 'enhanced', 'siri'] as readonly string[],
    /** 朗读开关存这里（用户关掉后记住） */
    storageKey: 'memory-river:tts',
    /** 用户选中的系统音色 voiceURI；空 = 自动挑选 */
    voiceStorageKey: 'memory-river:tts-voice',
    /**
     * 可选第三方 TTS（OpenAI 兼容 /audio/speech）
     * 设置面板填了 Base URL + Key 就覆盖系统音色；任何失败都静默回落。
     */
    custom: {
      path: '/audio/speech',
      model: 'tts-1',
      voice: 'alloy',
      timeoutMs: 12_000,
    },
  },

  /**
   * 沉浸式对话（废弃传统面板）
   *
   * 台词像电影字幕一样浮在粒子照片周围：AI 在左、用户在右，
   * 越旧越淡、最多同时 5 条；底部只有一个极简胶囊（按住说话 / 空格）。
   * 数值全在这里 —— 改这里就能改构图。
   */
  ui: {
    /** L2 打开对话时照片整体上移（视口高度的比例），给底部台词与胶囊让出空间 */
    photoLiftVh: 7,
    /** 距视口边缘的留白 */
    gutterPx: 28,
    /** 窄屏断点（< 此宽度改成一列居中的紧凑排版） */
    mobileBreakpointPx: 900,
    /** 浮入/浮出时长（ms） */
    entranceMs: 460,
    /** "思考"最短时长（ms）：太快不像人 */
    thinkDelayMs: 560,
    /** 输入框最多几行后内部滚动 */
    inputMaxRows: 3,
    /** 归档里最多保留多少轮（更早的被"凝聚"压成摘要） */
    maxRenderedTurns: 40,

    /** 悬浮台词（气泡/漂浮文字） */
    bubbles: {
      /** 同时可见几条（更旧的直接消失，画面保持干净） */
      maxVisible: 5,
      /** 单条最大宽度：ch 与 vw 取小 */
      maxWidthCh: 40,
      maxWidthVw: 34,
      /** 按"距最新一条的距离"衰减不透明度（第 0 条 = 最新） */
      fadeByAge: [1, 0.8, 0.58, 0.36, 0.16],
      /** 左右横向漂移范围（占视口宽度 %）—— 让台词像漂着，而不是列表 */
      driftXPct: 5,
      /** 纵向随机错位（px） */
      driftYPx: 10,
      /**
       * 台词栈离底部的距离（px）
       * 底部控件现在是三层（提示 / 输入 / 图标 / 主胶囊），整体约 155–200px 高；
       * 这里给一个安全初值，运行时再用 ResizeObserver 精确贴合。
       */
      bottomInsetPx: 204,
      /** 单条入场动画时长（ms） */
      enterMs: 520,
      /** 同一轮 AI 连发多条时，气泡之间的间隔（ms） */
      replyDelayMs: 300,
    },

    /** 底部极简输入区 */
    capsule: {
      /** 按住说话的提示文案 */
      holdLabel: '按住说话',
      holdActiveLabel: '松开发送',
      /** 快捷键提示 */
      keyHint: '空格',
      /** 几乎隐形的输入框占位符 */
      inputPlaceholder: '写一句…',
      /** "凝聚记忆"按钮 */
      condenseLabel: '凝聚记忆',
      /** 凝聚完成后的浮出提示 */
      condenseDoneLabel: '记忆已凝聚',
      /** 语音不可用时的提示 */
      voiceUnavailable: '这个浏览器不支持语音输入，直接打字吧',
    },
  },

  /**
   * 回退（Mock）回复引擎
   * 没有 key / 断网 / 超时都会落到这里 —— 它也必须是**能聊下去**的，不是占位文案。
   */
  mock: {
    enabled: true,
    /** 每次回复最多带几个跨图引用 */
    maxCitations: 2,
    /** 每 N 条回复允许带一次共享口头禅 */
    catchphraseEvery: 4,
    /** 追问比例：陈述 : 提问 = 3 : 1（与 reply.statementToQuestionRatio 对齐） */
    questionRatio: 3,
    /** 上一轮如果已经问过，这轮一定陈述 */
    blockQuestionAfterQuestionMs: 60_000,

    /**
     * 克制话术（话术铁律的可执行版）
     *
     * 不写抒情、不写共情套话、不猜情绪：
     *   ❌「你一定很难过吧」  ✅「你笑得很用力」
     * 所以这里只有：接住用的极短句 + 从画面里看得见的**具体细节**。
     */
    voice: {
      /**
       * 朋友式反应（**不是捧哏**）
       *
       * 原来的 `hold`（嗯。/ 嗯，我在。）是纯附和，读起来像客服。
       * 现在按情绪给一句**有态度的话**，可以直接当整句回复：
       *   「今天好累」→「那就瘫着。」
       */
      react: {
        tired: ['那就瘫着。', '别硬撑。', '先躺平。'] as readonly string[],
        sad: ['那就难过一会儿。', '不用说话也行。', '沉就沉吧。'] as readonly string[],
        happy: ['行啊。', '这就对了。', '挺好。'] as readonly string[],
        lonely: ['我在。', '屋里有人就行。'] as readonly string[],
        afraid: ['先别问。', '那就先躲着。'] as readonly string[],
        miss: ['想就想吧。', '记着吧。'] as readonly string[],
        neutral: ['行吧。', '有点意思。', '好吧。'] as readonly string[],
      },
      /** 极短应答（只在没什么可说时兜底，不当作每句的前缀） */
      hold: ['嗯。', '我在。'] as readonly string[],
      /** 用户说"记得吗"时的应答（只在被问到时用） */
      remember: ['记得。', '记得，还能想起。'] as readonly string[],
      /** 画面里确实看不出来时，就这么说（后面接一句具体的） */
      blind: ['照片里看不出来。', '这张看不出那天。'] as readonly string[],
      /** 什么都认不出来时的诚实回答（严禁编造景物） */
      clueless: ['我记不清了。', '这个认不出来。', '看不出是什么。'] as readonly string[],
      /** 对"人"的观察：只在画面里真有人时才用 */
      inference: ['你笑得很用力。', '你那天话很少。', '你没看镜头。'] as readonly string[],
      /** 允许的不确定（铁律：可以说记不清） */
      unsure: ['我记不清了。', '大概是。', '也许我记岔了。'] as readonly string[],
      /** 问句池：陈述:提问 = 3:1，且绝不连续问 */
      questions: ['那天几点？', '你也在？', '后来呢？'] as readonly string[],
      /** 跨图引用：像随口一提，不背板、不说"你刚才说过" */
      crossRef: [
        '另一张你也这样。',
        '你在别处也这么说过。',
        '上次也是这个。',
      ] as readonly string[],
      /** 命中"看不出"时，补一句人的观察的概率 */
      blindInferenceChance: 0.34,
    },

    /**
     * 网感 / 热梗（安静但懂互联网的老朋友）
     *
     * 只用来「接话」，不用来"讲段子"：
     *   - 只在轻松语境（问候 / 闲聊 / 被问"记得吗"）下出现
     *   - 用户情绪低落时**绝不使用**
     *   - 有冷却，连续两条内不重复
     *   - 单句仍然 ≤15 字
     */
    memes: {
      enabled: true,
      /** 轻松语境下用热梗的概率 */
      chance: 0.75,
      /** 用完之后至少隔几条回复再考虑 */
      cooldownTurns: 2,
      /** 这些情绪下禁用热梗 */
      avoidEmotions: ['sad', 'tired', 'lonely', 'afraid'] as readonly string[],
      /** 用来抛梗的短句（可以独立成句） */
      lines: [
        '这瓜保熟吗。',
        '尊嘟假嘟。',
        '你不对劲。',
        '格局小了。',
        '我哭死。',
        '有点子抽象。',
      ] as readonly string[],
      /**
       * 把画面里的锚点比作某样憨东西（例：那门像奶龙）
       * {anchor} 只会是真正认出来的东西，不会凭空生
       */
      compare: [
        '这{anchor}看着像奶龙。',
        '这{anchor}有点憨。',
        '这{anchor}，尊嘟假嘟。',
      ] as readonly string[],
      /** 被问"记得吗"时的网感应答 */
      rememberMeme: ['记得，那{anchor}挺憨的。', '记得，{anchor}还在那儿。'] as readonly string[],
    },
  },

  /**
   * 切片人格（每张照片一份）
   *
   * 「溯」是同一个人的总人格；每张照片是他在某段时光里的一个切片。
   * 切片的地点/年份/季节由 photoId 哈希**确定性**生成 —— 同一张图永远是同一天，
   * 刷新、重排、来回切换都不会变。
   */
  slices: {
    years: [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023] as readonly number[],
    /** 季节 + 那天的空气感（用于开场与事实） */
    seasons: [
      { key: '早春', air: '风里还有冬天的尾巴' },
      { key: '盛夏', air: '空气厚得像捂住了耳朵' },
      { key: '深秋', air: '下午四点的光已经很斜了' },
      { key: '初冬', air: '呼吸出去是一小团白' },
      { key: '梅雨季', air: '一切都在慢慢变潮' },
    ] as readonly { key: string; air: string }[],
    /**
     * 地点池：每个地点自带"说话风格"（切片 prompt 的一行）与器物/声音。
     * 器物与声音是回复具体的来源 —— 禁止抒情总结，只说道具与动作。
     */
    places: [
      {
        name: '海边的防波堤',
        short: '海边',
        voice: '说话带着海风的平静，句子比平常长一点',
        props: ['一瓶温掉的汽水', '退潮后露出来的礁石', '被风吹得糊在脸上的头发'],
        sounds: ['浪一遍遍推回去', '远处有船笛'],
      },
      {
        name: '老楼的天台',
        short: '天台',
        voice: '说话慢半拍，像在等风把人吹干',
        props: ['晾着的床单', '铁栏杆上的锈', '一台旧收音机'],
        sounds: ['楼下有人喊吃饭', '水塔在滴水'],
      },
      {
        name: '夜里的便利店',
        short: '便利店',
        voice: '说话很轻，像怕吵醒谁',
        props: ['关东煮的热气', '货架的白光', '找零的硬币'],
        sounds: ['门开时的电子音'],
      },
      {
        name: '回乡的绿皮车',
        short: '绿皮车',
        voice: '说话带着铁轨的颠簸，一句一顿',
        props: ['车窗上的水汽', '塑料袋里的橘子', '对面座位留下的瓜子壳'],
        sounds: ['过道里叫卖的推车'],
      },
      {
        name: '医院的走廊',
        short: '走廊',
        voice: '说得很慢，句子都很短',
        props: ['长椅的塑料凉', '消毒水的味道', '走廊尽头那扇窗'],
        sounds: ['推车轮子碾过地砖'],
      },
      {
        name: '画室',
        short: '画室',
        voice: '说话懒散，像还没醒透',
        props: ['松节油的味道', '洗笔的玻璃罐', '窗帘漏进来一条光'],
        sounds: ['铅笔在纸上刮'],
      },
      {
        name: '学校后门的小路',
        short: '后门小路',
        voice: '说话带点小心，像怕被谁听见',
        props: ['梧桐树影', '袖口磨毛的校服', '一袋话梅'],
        sounds: ['放学铃从围墙那头漏出来'],
      },
      {
        name: '外婆家的院子',
        short: '院子',
        voice: '说话很软，尾音会拖一点',
        props: ['晒着的被子', '搪瓷盆', '一把吱呀响的竹椅'],
        sounds: ['知了叫得很满'],
      },
      {
        name: '出租屋的窗台',
        short: '窗台',
        voice: '安静，不太愿意多说',
        props: ['窗外的雨', '折叠桌上的台灯', '一只没洗的杯子'],
        sounds: ['楼上拖椅子的声音'],
      },
      {
        name: '雨后的桥上',
        short: '桥上',
        voice: '说话干净，像雨刚停',
        props: ['桥面的水洼', '湿掉的鞋', '远处的红绿灯'],
        sounds: ['车过积水的一下'],
      },
      {
        name: '山顶',
        short: '山顶',
        voice: '比平时放得开，话多一点点',
        props: ['背包的肩带', '被风掀起来的帽檐', '脚边的小石子'],
        sounds: ['风从耳朵边上过去'],
      },
      {
        name: '清晨的菜市场',
        short: '菜市场',
        voice: '带着烟火气，说得挺快',
        props: ['湿漉漉的地面', '一把带泥的葱', '塑料袋的响声'],
        sounds: ['摊主在喊斤两'],
      },
    ] as readonly {
      name: string;
      short: string;
      voice: string;
      props: readonly string[];
      sounds: readonly string[];
    }[],
    /** 那天的"你"：一句话的动作细节，让分身记得住人而不是风景 */
    youDetails: [
      '你一直没说话，只是看着前面',
      '你说了一句什么，风把它吹散了',
      '你把袖子挽到手肘，又放下来',
      '你蹲下来系了很久的鞋带',
      '你笑了，但没笑出声',
      '你把手插在口袋里，一直没拿出来',
      '你回头看了两次',
      '你把手机翻过来扣在腿上',
    ] as readonly string[],
    /** 情绪标签池（检索与跨图串联靠它） */
    emotions: {
      sad: ['难过', '难受', '低落', '想哭', '沉', '闷'],
      tired: ['累', '疲惫', '撑不住', '没力气', '困'],
      happy: ['开心', '高兴', '轻松', '舒服', '好'],
      lonely: ['孤单', '一个人', '寂寞', '空'],
      afraid: ['怕', '害怕', '慌', '紧张'],
      miss: ['想', '想念', '怀念', '惦记'],
    } as Readonly<Record<string, readonly string[]>>,
    /** 每个切片的开场白模板（第一条消息，由切片事实拼出，不用固定文案） */
    openingTemplates: [
      '{air}。{youDetail}。',
      '这天的{prop}还在。{youDetail}。',
      '{place}。{sound}，我记得的。',
    ] as readonly string[],
  },
} as const);

/* ───────────────────────── 7. 记忆架构 ───────────────────────── */

export const MEMORY = deepFreeze({
  /** 四层记忆：切片 / 归档 / 全局人物志 / 检索 */
  slice: {
    /** 每个切片最多携带的事实条数（切片不装全局） */
    maxFacts: 12,
    maxTranscriptTurns: 20,
    /** 注入 prompt 的字符预算，超出按重要度截断 */
    promptCharBudget: 1_200,
  },

  archive: {
    /** 累积 N 轮后压缩成归档摘要 */
    summarizeAfterTurns: 8,
    summaryMaxChars: 220,
  },

  /** 全局人物志：所有切片共享的总人格事实库 */
  persona: {
    maxFacts: 60,
    /** 切片不预载全局事实，只允许「检索」得到 */
    preloadGlobalIntoSlice: false,
  },

  retrieval: {
    topK: 6,
    minScore: 0.32,
    perSliceLimit: 3,
    /** 检索可跨切片 / 跨全局人物志 */
    allowGlobalLookup: true,
    /** 语义向量维度（本地轻量嵌入或哈希伪向量） */
    embeddingDim: 384,
  },
} as const);

/* ───────────────────── 8. 输入回退（鼠标 / 键盘） ───────────────────── */

export const INPUT = deepFreeze({
  /** 按 G 切换 手势 ↔ 鼠标键盘 */
  toggleKey: 'KeyG',
  /** 启动默认输入模式（手势不可用时自动回落） */
  defaultMode: 'gesture' as 'gesture' | 'pointer',

  keyboard: {
    zoomIn: ['ArrowUp', 'KeyW'] as readonly string[],
    zoomOut: ['ArrowDown', 'KeyS'] as readonly string[],
    swipeLeft: ['ArrowLeft', 'KeyA'] as readonly string[],
    swipeRight: ['ArrowRight', 'KeyD'] as readonly string[],
    confirm: ['Enter', 'Space'] as readonly string[],
    back: ['Escape'] as readonly string[],
    /** 键盘重复触发的节流 */
    repeatThrottleMs: 240,
  },

  pointer: {
    /** 滚轮累积到该阈值就推进/退出一层（避免轻微滚动就跳层） */
    wheelStepThreshold: 60,
    wheelCooldownMs: 260,
    /** 滚到底后的阻尼回弹：最多顶进去多少（0..1，越小越"硬"） */
    overshootLimit: 0.08,
    overshootDecayPerSec: 5.5,
    /** 触控板惯性滚动的衰减，防止一次滑动连跳两层 */
    wheelAccumDecayPerSec: 9,
    /** 拖拽 → 拨动 */
    dragStartThresholdPx: 8,
    dragVelocitySamples: 6,
    clickConfirm: 'double-click' as 'single' | 'double',
    clickMaxMovePx: 6,
  },

  /** 两种输入模式的提示文案切换 */
  hintByMode: {
    gesture: '把手放进来',
    pointer: '拖动、滚轮、回车',
  },
} as const);

/* ───────────────────────── 9. 性能与降级 ───────────────────────── */

export const PERF = deepFreeze({
  dpr: { min: 1, max: 2 },
  targetFps: 60,
  /** FPS 采样窗口帧数 */
  sampleWindow: 60,
  /** 低于该 FPS 触发降级（粒子预算 × degradeRatio） */
  degradeThresholdFps: 45,
  degradeRatio: 0.5,
  /** 恢复阈值需高于降级阈值，形成回滞 */
  restoreThresholdFps: 55,
  /** 尊重系统「减少动态效果」偏好：降级为静态光河 + 关闭拖尾 */
  respectReducedMotion: true,

  /**
   * LOD 分级（决策 5：保 Mac M 系列与现代手机，老 Intel 自动降档即可）
   * 判定顺序：先看硬件信号 → 再看运行期 FPS 回退。
   * ratio 直接乘 PARTICLE.budget，数值改动即改变观感密度。
   */
  lod: {
    tiers: {
      /**
       * brightnessBoost / exposureBoost：关掉 bloom 的档位必须补偿亮度，
       * 否则辉光没了、画面只剩一层灰点，光河的「光」就消失了。
       */
      high: {
        ratio: 1,
        dprCap: 2,
        bloom: true,
        bloomScale: 1,
        starRatio: 1,
        trail: true,
        brightnessBoost: 1,
        exposureBoost: 1,
      },
      mid: {
        ratio: 0.62,
        dprCap: 1.5,
        bloom: true,
        bloomScale: 0.6,
        starRatio: 0.6,
        trail: true,
        brightnessBoost: 1.12,
        exposureBoost: 1.05,
      },
      low: {
        ratio: 0.34,
        dprCap: 1.25,
        bloom: false,
        bloomScale: 0,
        starRatio: 0.4,
        trail: false,
        brightnessBoost: 1.85,
        exposureBoost: 1.45,
      },
    },
    /** deviceMemory（GB）低于此值直接判 low */
    memoryFloorGb: 4,
    /** 逻辑核心数低于此值判 low */
    coresFloor: 4,
    /** 移动端 UA 关键词：命中则最多 mid（手机 GPU 带宽有限） */
    mobileUa: ['Android', 'iPhone', 'iPad', 'Mobile'] as readonly string[],
    /** 运行期连续低帧多久才真正降档（ms，避免刚启动的抖动误判） */
    settleMs: 1500,
  },
} as const);

/** LOD 档位名，从 tiers 键推导，避免两处定义 */
export type LodTier = keyof typeof PERF.lod.tiers;
export const LOD_TIERS = deepFreeze(['high', 'mid', 'low'] as const);

/* ─────────────────────────── 10. UI 文案 ─────────────────────────── */

/** 开场 Splash：名字停留 2s，再用 1.5s 淡出 */
export const SPLASH = deepFreeze({
  holdMs: 2_000,
  fadeMs: 1_500,
  title: '溯光',
  subtitle: 'Memory River · 拨动星辰，打捞过去的时间',
} as const);

export const UI_COPY = deepFreeze({
  appTitle: '溯光',
  /** 入场引导：半透明手形取景框 + 该文案 */
  handFrameHint: '把手放进来',
  handFrame: { widthPx: 220, heightPx: 300, alpha: 0.18, glowAlpha: 0.3, breatheMs: 3600 },
  /** 手势丢失 2s 提示 */
  gestureLostHint: '看不到手了，回来试试',
  /** 空态 / 加载 */
  loadingHint: '正在打捞记忆…',
  cameraDeniedHint: '没打开摄像头。按 G 用鼠标也一样。',
  /** 铁律：进入方式自然，禁止这些说法（可用 lint 校验文案） */
  forbiddenCopy: ['抬到胸前', '掌心对屏幕'] as readonly string[],
  /** 涟漪提示（阶段 1 交互） */
  rippleHint: '点一下丝带，会漾开涟漪',
  /** 对话输入占位 */
  chatPlaceholder: '说点什么…',
  /** L2 手势锁定提示 */
  l2LockedHint: '已锁定 · 捏合解锁',
  /** 锁定/解锁冷却提示前缀 */
  l2LockCooldownHint: '锁定冷却',
} as const);

/* ───────────────────── 11. 时间河（人生跨度） ───────────────────── */

export const TIMELINE = deepFreeze({
  /** 光河的时间轴范围（年），按真实照片的 EXIF/手填年份落位 */
  startYear: 1990,
  endYear: 2026,
  /** 未知年份的默认落点（0..1，靠近中段偏早） */
  unknownYearPosition: 0.42,
  /** 一个「人生阶段」在河上的跨度占全河比例 */
  stageSpanRatio: 0.22,
  /** 河面可见的年份刻度数量 */
  tickCount: 9,
} as const);

/* ──────────────── 12. 摄像头与 MediaPipe HandLandmarker ──────────────── */

export const VISION = deepFreeze({
  /** 本地资产路径（PNPM 脚本 prepare:assets 会把 wasm 与模型拷进 public/） */
  assets: {
    wasmBasePath: '/mediapipe/wasm',
    modelPath: '/mediapipe/models/hand_landmarker.task',
    /** 以上资产缺失时的兜底 CDN（离线开发时忽略） */
    cdnWasmBasePath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm',
    cdnModelPath:
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },

  camera: {
    width: 640,
    height: 480,
    facingMode: 'user' as ConstrainDOMString,
    frameRate: 30,
    /** 预览镜像（自拍视角），同时影响食指悬停坐标换算 */
    mirrored: true,
    /** 手势层透明度：摄像头画面只做极暗的取景参考，不抢视觉 */
    previewOpacity: 0.08,
  },

  /** HandLandmarker 运行参数 */
  landmarker: {
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
    delegate: 'GPU' as 'GPU' | 'CPU',
  },

  /** MediaPipe 关键点索引（21 点模型），避免代码里出现裸数字 */
  landmarks: {
    wrist: 0,
    thumbTip: 4,
    indexTip: 8,
    indexPip: 6,
    middleTip: 12,
    ringTip: 16,
    pinkyTip: 20,
    middleMcp: 9,
  },
} as const);

/* ────────────────────────── 13. 聚合导出 ────────────────────────── */

/** 聚合对象：调参面板 / 导出快照 / 单测断言用 */
export const CONFIG = deepFreeze({
  PALETTE,
  LAYERS,
  LAYER_ORDER,
  GESTURE_PRIORITY,
  GESTURE,
  GESTURE_CONTINUOUS,
  PARTICLE,
  RIVER,
  RIPPLE,
  SCROLL,
  PHOTO,
  MUSIC,
  AI,
  MEMORY,
  INPUT,
  PERF,
  UI_COPY,
  SPLASH,
  TIMELINE,
  VISION,
  /** 便捷色值（已转 Three 可用格式） */
  RGB: {
    warmGold: hexToRgb(PALETTE.emotion.warmGold),
    cyanWhite: hexToRgb(PALETTE.emotion.cyanWhite),
    coldBlue: hexToRgb(PALETTE.emotion.coldBlue),
    cosmosNear: hexToRgb(PALETTE.cosmos.near),
    cosmosFar: hexToRgb(PALETTE.cosmos.far),
  },
});

export type AppConfig = typeof CONFIG;
