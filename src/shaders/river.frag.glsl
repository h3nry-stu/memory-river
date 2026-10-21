// 光河粒子 · 片元着色器
// 一个柔边圆点：核心高亮 + 外圈光晕。颜色 > 1 的部分会被 bloom 拾取成辉光，
// 所以这里不写死高光颜色，交给流水线去发光。

uniform float uCoreWeight;
uniform float uHaloWeight;

varying vec3 vColor;
varying float vTwinkle;
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  if (d > 0.5) discard;

  // 核心：小半径内快速衰减，形成「星点」
  float core = exp(-d * d * 16.0);
  // 光晕：整个圆内平缓衰减，形成「光丝」
  float halo = smoothstep(0.5, 0.0, d);

  float a = (core * uCoreWeight + halo * uHaloWeight) * vAlpha * vTwinkle;
  if (a < 0.004) discard;

  // 加法混合下 alpha 基本不参与，颜色本身承载强度
  gl_FragColor = vec4(vColor * a, 1.0);
}
