// 深空背景片元：纵向渐变 #05060f → #0a0f1f + 地平线柔光 + 极淡星云 + 暗角
// 所有颜色由 config.PALETTE 以 uniform 传入（three 会把 sRGB hex 转成线性值）。

uniform vec3 uNear;   // 底部更深（#05060f）
uniform vec3 uFar;    // 顶部稍亮（#0a0f1f）
uniform vec3 uGlow;   // 地平线光色（青白）
uniform float uGlowStrength;
uniform float uNebulaAlpha;
uniform float uVignetteStrength;
uniform float uVignetteStart;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDim;   // 0 = 正常深空，1 = 纯黑（L2 聚焦时让照片独占画面）

varying vec3 vDir;

// ── 廉价 value noise（背景只占屏，不必太精致） ──
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += noise2(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

void main() {
  // ① 纵向渐变：靠近地平线偏亮（#0a0f1f），越低越深（#05060f）
  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uNear, uFar, smoothstep(0.0, 1.0, h));

  // ② 地平线柔光：光河消失点的方向，撑起纵深
  float horizon = exp(-pow(abs(vDir.y) * 3.1, 2.0));
  col += uGlow * horizon * uGlowStrength;

  // ③ 星云：极低频 fbm，只加一点点色差，不能抢粒子
  vec2 np = vDir.xz / max(abs(vDir.y) + 0.35, 0.35);
  float n = fbm(np * 1.7 + vec2(uTime * 0.004, uTime * 0.0025));
  col += (uGlow * 0.55 + uFar) * (n - 0.5) * uNebulaAlpha;

  // ④ 暗角：把注意力压回画面中心
  vec2 sc = gl_FragCoord.xy / max(uResolution, vec2(1.0)) - 0.5;
  float vig = smoothstep(uVignetteStart, 1.15, length(sc) * 1.42);
  col *= 1.0 - vig * uVignetteStrength;

  // ⑤ L2：一切压到黑（照片自己的辉光会把它重新点亮，背景必须是纯黑才够沉浸）
  col *= 1.0 - uDim;

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
