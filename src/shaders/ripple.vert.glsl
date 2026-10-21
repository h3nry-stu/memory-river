// 涟漪环（RingGeometry 的 uv.y 沿半径方向 0→1，正好用来做柔边）
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
