// 深空背景（一个从内侧观察的巨大球壳）
// 顶点只需把世界方向传给片元，真正的渐变/星云/暗角都在 frag 里算。
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
