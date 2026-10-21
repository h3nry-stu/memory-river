// ════════════════════════════════════════════════════════════════════
//  照片 = 高斯泼溅点云（Gaussian Splatting 风格）
//  ────────────────────────────────────────────────────────────────────
//  每颗粒子是一枚柔光斑。画面不是"贴"出来的，而是靠大量半透明斑块重叠堆出来的。
//
//  ① 径向重组：中心先凝实，凝实阈值随半径递增 → 波纹由内向外扩散
//     （最外圈阈值 > 1，所以边缘永远不完全凝实，始终是漂浮的星尘）
//  ② 边缘飞散：未凝实的粒子沿"河里的散落方向"推开，边缘飞得最远
//  ③ 悬浮抖动：未凝实时三维缓慢游走，像被回忆搅动的尘埃
//  ④ 尺寸：世界尺寸泼溅（透视正确），未凝实时更大更散
//  ⑤ 碎裂：按 aSeed 逐颗剥落
// ════════════════════════════════════════════════════════════════════

uniform float uTime;
uniform float uAssemble;    // 0..1 整体凝实度
uniform float uShatter;     // 0..1 碎裂强度（逐颗剥落）
uniform float uOpacity;
uniform float uProjScale;   // 视口投影系数：世界尺寸 → 像素
uniform float uSplatSize;   // 泼溅斑块的世界尺寸
uniform float uSizeJitter;
uniform float uIntensity;   // 单颗强度（重叠归一化）
uniform float uDustSizeBoost;
uniform float uRadialSpread;
uniform float uRadialSoft;
uniform float uEdgeScatter;
uniform float uTurbulence;
uniform float uEdgeAlpha;   // 最外圈粒子的不透明度（< 1 = 边缘柔和消散）
uniform float uEdgeDrift;   // 最外圈粒子沿径向往外飘的世界距离（星尘感）
uniform float uEdgeFadeStart; // 从哪个归一化半径开始压暗（大 = 只柔化最外圈）

attribute vec3 aTarget;    // 照片平面上的目标位置（局部坐标）
attribute vec3 aScatter;   // 散落在河里时的位置（同一坐标系）
attribute vec3 aTint;      // 像素颜色（线性空间）
attribute float aRadial;   // 0 = 中心，1 = 边缘
attribute float aSeed;
attribute float aSizeJitter;

varying vec3 vColor;
varying float vSplat;

void main() {
  // ① 径向凝实：阈值 = 半径 × 斜率，所以中心先实、外圈后实
  float threshold = aRadial * uRadialSpread;
  float reveal = smoothstep(threshold, threshold + uRadialSoft, uAssemble);

  // ⑤ 碎裂：每颗粒子有自己的剥离阈值 → 从零散到整片地剥落
  float stays = smoothstep(uShatter - 0.09, uShatter + 0.09, aSeed);
  float local = reveal * stays;

  // ② 边缘飞散：边缘粒子散得更远（乘一个大于 1 的倍数）
  float edge = smoothstep(0.45, 1.0, aRadial);
  float scatterScale = mix(1.0, uEdgeScatter, edge);
  vec3 floating = aTarget + (aScatter - aTarget) * scatterScale;

  vec3 pos = mix(floating, aTarget, local);

  // ②b 边缘星尘：外圈粒子不完全归位，沿径向往外飘一点点
  //     （照片因此没有"边界"，而是化进四周的尘埃里）
  vec2 radialDir = length(aTarget.xy) > 1e-4 ? normalize(aTarget.xy) : vec2(1.0, 0.0);
  float edgePow = edge * edge;
  pos.xy += radialDir * uEdgeDrift * edgePow * (0.35 + 0.65 * aSeed);
  pos.z += (aSeed - 0.5) * uEdgeDrift * edgePow;

  // ③ 悬浮抖动（未凝实时最明显）
  float dust = 1.0 - local;
  pos += vec3(
    sin(uTime * 0.6 + aSeed * 31.0),
    cos(uTime * 0.47 + aSeed * 17.0),
    sin(uTime * 0.33 + aSeed * 11.0)
  ) * uTurbulence * dust;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // ④ 世界尺寸泼溅：离得近就大、离得远就小（真正的透视），未凝实时再放大一点
  float jitter = mix(1.0 - uSizeJitter * 0.5, 1.0 + uSizeJitter * 0.5, aSizeJitter);
  float worldSize = uSplatSize * jitter * (1.0 + uDustSizeBoost * dust);
  gl_PointSize = clamp(uProjScale * worldSize / max(-mv.z, 0.05), 1.0, 96.0);

  vColor = aTint;
  // 未凝实时更暗（融在河里），凝实后堆积出画面；
  // 外圈按径向再压一次不透明度 —— 这就是"边缘像星尘一样消散"的那一笔
  float edgeFade = mix(1.0, uEdgeAlpha, smoothstep(uEdgeFadeStart, 1.0, aRadial));
  vSplat = uIntensity * uOpacity * mix(0.35, 1.0, local) * edgeFade;
}
