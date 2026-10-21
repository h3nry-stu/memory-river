import * as THREE from 'three';
import { PALETTE, PARTICLE } from '@/config';

/**
 * 星尘层：远景的底噪光点。
 *
 * 用最朴素的 PointsMaterial（世界单位尺寸 + 透视衰减），
 * 它不需要流动、不需要涟漪，只要安静地待在那儿。
 * 亮度会略高于 1，让 bloom 把最亮的几颗拾取成微光。
 */
export function createStarDust(count = PARTICLE.budget.starDust): THREE.Points {
  const capacity = Math.max(1, Math.floor(count));

  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);

  const base = new THREE.Color(PALETTE.particle.base);
  const warm = new THREE.Color(PALETTE.emotion.warmGold);
  const cold = new THREE.Color(PALETTE.emotion.coldBlue);
  const tint = new THREE.Color();

  const radius = PARTICLE.star.radius;
  const flatten = PARTICLE.star.flattenY;
  const brightness = PARTICLE.star.brightness;

  for (let i = 0; i < capacity; i += 1) {
    // 球壳分布：近处留白，避免正对镜头处糊成一坨
    const r = radius * (0.42 + 0.58 * Math.cbrt(Math.random()));
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const i3 = i * 3;
    positions[i3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i3 + 1] = r * Math.cos(phi) * flatten;
    positions[i3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    // 少量星点带情绪色，大多数是中性青白
    const pick = Math.random();
    if (pick > 0.955) tint.copy(warm);
    else if (pick > 0.885) tint.copy(cold);
    else tint.copy(base).lerp(warm, Math.random() * 0.16);

    // 每颗星亮度不同，才不会像均匀噪点
    const boost = (0.45 + Math.random() * 0.55) * brightness;
    colors[i3] = tint.r * boost;
    colors[i3 + 1] = tint.g * boost;
    colors[i3 + 2] = tint.b * boost;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, capacity);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.4);

  const material = new THREE.PointsMaterial({
    size: PARTICLE.star.size,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'starDust';
  points.frustumCulled = false;
  return points;
}
