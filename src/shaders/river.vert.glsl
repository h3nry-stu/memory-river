// ════════════════════════════════════════════════════════════════════
//  光之长河 · 3D 中空螺旋星管
//  ────────────────────────────────────────────────────────────────────
//  轴线仍是一条横向蜿蜒的 S 形曲线（X = 时间主轴，Y = 主起伏 + 二次谐波，
//  Z = 纵深蜿蜒），但粒子不再贴在 XY 平面上，而是用 **Frenet 框架**
//  沿曲线的法线 N / 副法线 B 分布成一个**中空的螺旋圆柱面**：
//
//  ① 沿 X 流动（slot + time，fract 环绕）      ② 轴线位置 + 解析切线
//  ③ Frenet 框架（N ≈ 深度方向，B ≈ 画面上下）  ④ 螺旋相位 → 圆柱面上的点
//  ⑤ 涟漪波前（XY 投影，与正面光环一致）        ⑥ 尺寸（含近大远小）
//  ⑦ 前后明暗 / 背面偏冷 / 内壁发光 / 外缘淡出   ⑧ 情绪光色 + 亮度分级
//  ⑨ 闪烁 = 个体抖动 + 沿管传播的亮度波
// ════════════════════════════════════════════════════════════════════

uniform float uTime;
uniform float uTimeOffset; // 拖尾：同一批粒子在「稍早时刻」的位置
uniform float uDpr;
uniform float uSizeScale;
uniform float uOpacity;

// 轴线形态（config.RIVER）
uniform float uPoolWidth;   // 粒子池宽度（相机附近的可视范围）
uniform float uScroll;      // 无限滚动偏移（世界单位）—— 相机在长河上的位置
uniform float uEdgeFadeS;   // 池子两端的水平淡出比例（隐藏环绕跳变）
uniform float uWaveAmp;
uniform float uWaveFreq;
uniform float uWaveAmp2;
uniform float uWaveFreq2;
uniform float uWavePhase2;
uniform float uBreatheAmp;
uniform float uBreatheSpeed;
uniform float uDepthAmp;
uniform float uDepthFreq;
uniform float uDepthPhase;
uniform float uDriftSway;
uniform float uFlowSpeed;
uniform float uFlowSpeedVariance;

// 3D 管（config.RIVER.tube）
uniform float uTubeRadius;
uniform float uHollowRatio;
uniform float uTwistTurns;
uniform float uDustSpread;
uniform float uDustDim;

// 纵深表现（config.RIVER.depthCue）
uniform float uFrontBoost;
uniform float uBackDim;
uniform float uBackCoolShift;
uniform float uDepthSizeBoost;

// 内部光芯与端点/外缘淡出
uniform float uInnerGlow;
// 清场区：L2 聚焦时把照片附近 x 区间的粒子淡出，露出照片
uniform vec3 uClearZone;   // x = 中心世界 x，y = 半径，z = 强度 0..1
uniform float uEdgeFadeStart;
uniform float uEdgeFadeEnd;
uniform float uEdgeFadeMin;

// 尺寸（config.PARTICLE.size）
uniform float uSizeMin;
uniform float uSizeMax;
uniform float uRefDistance;
uniform float uAttenuation;
uniform float uMaxPointPx;

// 情绪光色（config.PALETTE.emotion / PARTICLE.color）
uniform vec3 uCold;
uniform vec3 uCyan;
uniform vec3 uWarm;
uniform float uBlendWarmCyan;
uniform float uColorJitter;
uniform float uHdrBoost;
uniform float uEnergyLow;
uniform float uEnergyHigh;
uniform float uEnergyCurve;
uniform float uCoreWeight;
uniform float uHaloWeight;
uniform float uMusicHigh;   // 音乐高频 → 闪烁幅度（0..1）

// 涟漪（数组长度必须等于 config.RIPPLE.shaderSlots）
uniform vec3 uRippleCenter[4];  // xy = 丝带平面上的位置
uniform float uRippleRadius[4];
uniform float uRippleStrength[4];
uniform float uRippleFalloff;
uniform float uRippleLift;
uniform float uRipplePush;

attribute float aSlot;     // 0..1 沿时间主轴
attribute float aPhase;    // 0..1 绕管一圈的初始相位（含螺旋股结构）
attribute float aRadius;   // 归一化半径：hollowRatio..1 = 管壁，>1 = 飘散尘埃
attribute float aSeed;     // 0..1 随机种子
attribute float aEmotion;  // 0..1 情绪温度
attribute float aSize;     // 0..1 尺寸档位

varying vec3 vColor;
varying float vTwinkle;
varying float vAlpha;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

const float TAU = 6.28318530718;

void main() {
  float t = uTime + uTimeOffset;

  // ── ① 沿时间主轴流动：s = 0 左端（起点）→ 1 右端（终点） ──
  float speed = uFlowSpeed * (1.0 - 0.5 * uFlowSpeedVariance + uFlowSpeedVariance * hash11(aSeed * 91.7));

  // ★ 无限滚动：每颗粒子的"沿河位置"是固定的，相对相机取模后环绕。
  //   相机（uScroll）前进时，粒子从一侧流走、另一侧补进来 —— 因为波形是 x 的函数，
  //   接缝处没有任何断裂，看起来就是一条无限长的河。
  float flow = (aSlot + t * speed) * uPoolWidth;
  float rel = mod(flow - uScroll, uPoolWidth) - uPoolWidth * 0.5;
  float x = uScroll + rel;                 // 世界坐标（可以是任意大的数）
  float s = rel / uPoolWidth + 0.5;        // 0..1：在池子里的相对位置（做边缘淡出）

  // ── ② 轴线：主起伏 + 二次谐波 + 呼吸；Z 方向缓慢蜿蜒 ──
  float axisY = sin(x * uWaveFreq) * uWaveAmp
              + sin(x * uWaveFreq2 + uWavePhase2) * uWaveAmp2
              + sin(t * uBreatheSpeed) * uBreatheAmp;
  float axisZ = sin(x * uDepthFreq + uDepthPhase) * uDepthAmp;

  // ── ③ Frenet 框架（解析切线，不做数值差分） ──
  float dy = cos(x * uWaveFreq) * uWaveAmp * uWaveFreq
           + cos(x * uWaveFreq2 + uWavePhase2) * uWaveAmp2 * uWaveFreq2;
  float dz = cos(x * uDepthFreq + uDepthPhase) * uDepthAmp * uDepthFreq;
  vec3 T = normalize(vec3(1.0, dy, dz));
  vec3 N = normalize(cross(vec3(0.0, 1.0, 0.0), T));  // ≈ 深度方向
  vec3 B = normalize(cross(T, N));                    // ≈ 画面上下方向

  // ── ④ 螺旋相位 → 圆柱面上的偏移（中空：半径下限 = hollowRatio） ──
  float theta = aPhase * TAU + x * uTwistTurns * TAU;
  float radius = aRadius * uTubeRadius;
  vec3 offset = (cos(theta) * N + sin(theta) * B) * radius;
  vec3 pos = vec3(x, axisY, axisZ) + offset;

  // 尘埃的微小游走
  pos.y += sin(t * 0.5 + aSeed * TAU) * uDriftSway;
  pos.z += cos(t * 0.37 + aSeed * 4.1) * uDriftSway;

  // ── ⑤ 涟漪：在 XY 投影平面扩散（与正面的光环一致），把粒子顶起来并推开 ──
  for (int i = 0; i < 4; i++) {
    float strength = uRippleStrength[i];
    if (strength <= 0.0001) continue;
    vec2 center = uRippleCenter[i].xy;
    vec2 here = pos.xy;
    float waveDist = distance(here, center) - uRippleRadius[i];
    float influence = exp(-waveDist * waveDist * uRippleFalloff) * strength;
    vec2 dir = here - center;
    float len = max(length(dir), 0.0001);
    pos.xy += (dir / len) * influence * uRipplePush;
    pos.y += influence * uRippleLift;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // ── ⑥ 前后深度：offset 在相机方向（+Z 朝向镜头）上的分量 ──
  float front = clamp(offset.z / max(uTubeRadius, 0.001), -1.0, 1.0);
  float frontK = smoothstep(-1.0, 1.0, front);   // 0 = 背面，1 = 正面

  float sizePx = mix(uSizeMin, uSizeMax, aSize);
  float atten = pow(uRefDistance / max(-mv.z, 0.6), uAttenuation);
  // 近大远小：人为放大，弥补 30 单位焦距下真实透视只有 ~7% 的差距
  gl_PointSize = clamp(
    sizePx * uSizeScale * uDpr * atten * (1.0 + uDepthSizeBoost * front),
    1.0,
    uMaxPointPx * uDpr
  );

  // ── ⑦ 透明度：端点淡出 × 外缘淡出 × 尘埃压暗 × 内壁发光 × 前后明暗 ──
  float endFade = smoothstep(0.0, uEdgeFadeS, s) * smoothstep(1.0, 1.0 - uEdgeFadeS, s);
  float rimFade = mix(uEdgeFadeMin, 1.0, 1.0 - smoothstep(uEdgeFadeStart, uEdgeFadeEnd, aRadius));
  float dustDim = mix(1.0, uDustDim, smoothstep(1.0, uDustSpread, aRadius));
  float innerGlow = 1.0 + uInnerGlow * (1.0 - smoothstep(uHollowRatio, uHollowRatio + 0.3, aRadius));
  float depthDim = mix(1.0 - uBackDim, 1.0 + uFrontBoost, frontK);
  // 清场区：聚焦的照片周围留出干净的背景
  float clearMask = 1.0 - smoothstep(uClearZone.y * 0.35, uClearZone.y, abs(x - uClearZone.x)) * uClearZone.z;
  vAlpha = uOpacity * endFade * rimFade * dustDim * innerGlow * depthDim * clearMask;

  // ── ⑧ 情绪光色：冷蓝 → 青白 → 暖金（背面往冷蓝偏，做空气透视） ──
  float e = clamp(aEmotion, 0.0, 1.0);
  vec3 col = e < uBlendWarmCyan
    ? mix(uCold, uCyan, smoothstep(0.0, uBlendWarmCyan, e))
    : mix(uCyan, uWarm, smoothstep(uBlendWarmCyan, 1.0, e));
  col = mix(col, col * vec3(1.08, 0.97, 0.9), hash11(aSeed * 3.7) * uColorJitter * 3.0);
  col = mix(col, uCold, uBackCoolShift * (1.0 - frontK) * 0.5);

  float energy = mix(uEnergyLow, uEnergyHigh, pow(hash11(aSeed * 23.17), uEnergyCurve));
  vColor = col * uHdrBoost * energy;

  // ── ⑨ 闪烁 = 个体抖动 + 沿管传播的亮度波 ──
  float sparkle = sin(t * (0.7 + hash11(aSeed * 17.1) * 1.7) + aSeed * 43.0);
  float travelling = sin(s * 56.0 - t * 2.2 + aSeed * 2.2);
  vTwinkle = 0.58
    + (0.18 + 0.12 * uMusicHigh) * sparkle
    + (0.24 + 0.18 * uMusicHigh) * travelling;
}
