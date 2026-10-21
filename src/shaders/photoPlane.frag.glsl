// 照片底片：只提供"这确实是那张照片"的一层薄底，
// 主体亮度交给外面的高斯泼溅粒子。同样走径向凝实 + 边缘消散。
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uDissolve;
uniform float uGrain;
uniform float uCorner;
uniform float uBorder;
uniform float uExposure;
uniform float uAssemble;      // 与粒子共用：中心先显影
uniform float uRadialSpread;
uniform float uRadialSoft;
uniform float uFeatherStart;   // 从这里开始向外羽化（越小越柔）

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.01) discard;

  // ① 径向显影：和粒子用同一条公式，中心先实、外圈后实
  float radial = length(vUv - 0.5) * 2.0;
  float reveal = smoothstep(radial * uRadialSpread, radial * uRadialSpread + uRadialSoft, uAssemble);
  if (reveal <= 0.002) discard;

  // ② 边缘消散：噪声打洞 + 外缘渐隐，绝不出现硬矩形
  float n = noise(vUv * 22.0) * 0.55 + noise(vUv * 8.0) * 0.45;
  vec2 centered = abs(vUv - 0.5) * 2.0;
  float border = smoothstep(1.0 - uCorner, 1.0, max(centered.x, centered.y));
  float cut = border * uBorder + uDissolve;
  if (n < cut - 0.16) discard;

  float edgeNoise = smoothstep(cut - 0.16, cut + 0.04, n);
  float feather = 1.0 - smoothstep(uFeatherStart, 1.0, max(centered.x, centered.y));
  float grain = (noise(vUv * uGrain * 40.0) - 0.5) * 0.03;

  vec3 col = (tex.rgb + grain) * uExposure;
  gl_FragColor = vec4(col, uOpacity * reveal * edgeNoise * feather * tex.a);
}
