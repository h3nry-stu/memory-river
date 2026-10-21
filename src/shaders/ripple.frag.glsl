// 涟漪环片元：柔边的光环（比 MeshBasicMaterial 的硬边更像水波）
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSoftness;

varying vec2 vUv;

void main() {
  // uv.y：0 = 内缘，1 = 外缘
  float inner = smoothstep(0.0, uSoftness, vUv.y);
  float outer = smoothstep(1.0, 1.0 - uSoftness, vUv.y);
  float band = inner * outer;
  if (band <= 0.002) discard;

  gl_FragColor = vec4(uColor * band * uOpacity, 1.0);
}
