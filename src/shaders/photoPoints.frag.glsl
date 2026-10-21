// 高斯泼溅的片元：柔和的圆形衰减，没有硬边 —— 靠大量重叠形成画面
uniform float uCore;   // 核心紧度：越大越锐（同时整体越暗，用 uIntensity 补偿）

varying vec3 vColor;
varying float vSplat;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p) * 2.0;      // 0 = 中心，1 = 边缘
  if (d > 1.0) discard;

  // 高斯样衰减：中心实、外圈迅速透明，重叠后自然平滑。
  // uCore 是"清晰度"旋钮：渲染出的画面 ≈ 源图卷积这枚核，核越紧越锐。
  // 粒子间距远小于斑块半径，所以收紧核心不会出现空洞。
  float falloff = exp(-d * d * uCore);
  float alpha = falloff * vSplat;
  if (alpha < 0.003) discard;

  // alpha 合成（不是加法）：大量重叠后自然收敛到照片本身的颜色，
  // 同时遮住背后的长河 —— 加法混合会让蓝色星光永远透上来，画面就会发灰发蓝。
  gl_FragColor = vec4(vColor, alpha);
}
