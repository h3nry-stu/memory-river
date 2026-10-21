import * as THREE from 'three';
import { PHOTO, RIVER } from '@/config';
import { frameAtX, pointOnRiverX, waveYAtX, waveZAtX } from '@/particles';
import type { PhotoMemory } from '@/photo/types';
import { assertUniforms } from './shaderGuard';
import photoPointsVert from '@/shaders/photoPoints.vert.glsl?raw';
import photoPointsFrag from '@/shaders/photoPoints.frag.glsl?raw';
import photoPlaneVert from '@/shaders/photoPlane.vert.glsl?raw';
import photoPlaneFrag from '@/shaders/photoPlane.frag.glsl?raw';

/**
 * 一张照片的 3D 化身
 *
 * 两层叠加：
 *  1. **颗粒云**（Points）：从图片采样出来的像素粒子。`assemble` 从 0 → 1 时，
 *     粒子从河里的散落位置被"吸"到照片平面上，这就是「粒子重组出照片」。
 *  2. **贴图平面**（Mesh）：低不透明度兜底，保证 L2 时照片是真的能看清。
 *     它自己也有边缘溶解，所以在 L0/L1 不会露出一个硬边矩形。
 *
 * 组装度（assemble）由层级驱动：L0 = 0（完全散在河里）、L1 ≈ 0.22（只是个小结）、
 * L2 = 1（完整照片）。
 */
export interface PhotoNode {
  id: string;
  /** 创建时的世界 x；位置变了说明长河重排过，节点必须重建 */
  x: number;
  /** 世界坐标（照片中心） */
  position: THREE.Vector3;
  /** 平面世界高度 / 宽度 */
  height: number;
  width: number;
  group: THREE.Group;
  /** 贴图平面所在的组（在 overlay 场景里，位置/朝向由 group 镜像过来） */
  /** 0..1 组装度（由 LayerRig 每帧推进） */
  assemble: number;
  /** 诊断：读出实际生效的 uniform 值与粒子数 */
  debugState(): Record<string, unknown>;
  /** 一次性设定「成型度 + 颗粒不透明度 + 贴图不透明度 + 碎裂强度」 */
  setVisuals(
    assemble: number,
    particleOpacity: number,
    planeOpacity: number,
    shatter?: number,
    shatterScale?: number,
  ): void;
  /** 面向相机（billboard） */
  faceCamera(camera: THREE.Camera): void;
  dispose(): void;
}

function createTexture(photo: PhotoMemory): THREE.Texture {
  const texture = new THREE.Texture(photo.image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

interface CachedCloud {
  count: number;
  target: Float32Array;
  tint: Float32Array;
  scatter: Float32Array;
  radial: Float32Array;
  seed: Float32Array;
  sizeJitter: Float32Array;
}

/**
 * 采样缓存
 *
 * 建一个照片节点原本要做三件重活：① canvas.getImageData（GPU→CPU 回读，会 stall）
 * ② 3.6 万次随机采样 ③ 上传 GPU 缓冲。前两件的结果只跟图片有关，缓存起来；
 * 照片滚出再滚回时就不用重算了 —— 这是"扇动时卡一下"的主要来源。
 */
const cloudCache = new Map<string, CachedCloud>();
const textureCache = new Map<string, THREE.Texture>();
const imageBytesCache = new Map<string, Uint8ClampedArray>();
// 点云缓存要覆盖整本相册：一张 1.5 万粒子的点云约 0.7MB，24 张 ≈ 17MB，
// 换来的是「整趟来回扇动一次都不重新采样」。
const CLOUD_CACHE_MAX = Math.max(PHOTO.maxPhotos + 2, 12);

/**
 * 工作量计数器（诊断用）
 *
 * 无头环境的虚拟时间不会在同步 JS 里推进，`performance.now()` 测出来永远是 0，
 * 所以"卡不卡"必须用**干了多少活**来量化：建了几个节点、采样了多少粒子、命中几次缓存。
 * 每帧新建 0 个节点 = 这一帧不可能因为照片而卡。
 */
const work = { builds: 0, disposes: 0, sampled: 0, cacheHits: 0, cacheMisses: 0 };

function cacheSet<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  max: number,
  onEvict?: (evicted: T) => void,
): T {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    const evicted = map.get(oldest);
    map.delete(oldest);
    if (evicted !== undefined) onEvict?.(evicted);
  }
  return value;
}

/**
 * sRGB → 线性 的查找表
 *
 * 每张照片要采 8 万颗粒子，每颗 3 次 `Math.pow` 就是 24 万次 pow
 * —— 建节点那一下的卡顿有一半花在这上面。查表是常数时间而且不产生任何 GC。
 */
const SRGB_TO_LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) table[i] = Math.pow(i / 255, 2.2);
  return table;
})();

/**
 * 每张照片分到的粒子数（按总预算平摊，照片多时不爆显存）
 *
 * ⚠️ 结果会**量化到 1000 的整数倍**，而且必须只跟"相册总张数"有关，
 * 不能跟"当前视口里有几张"有关 —— 否则窗口一变 perPhoto 就变，
 * 缓存里的点云 count 不匹配，每滚一次都要重新采样 3.6 万次（这就是卡顿来源）。
 */
export function particleBudgetFor(photoCount: number, budgetScale = 1): number {
  const per = (PHOTO.totalParticles * budgetScale) / Math.max(photoCount, 1);
  const quantized = Math.round(per / 1000) * 1000;
  return Math.max(1200, Math.min(PHOTO.particlesPerPhoto, quantized));
}

/**
 * 把图片采样成粒子：位置（平面局部坐标）+ 颜色（线性空间）+ 径向归一化 + 散落点
 *
 * 缓存键里带上 `photo.x`：长河重排后散落坐标会变，旧缓存必须失效。
 * （真正昂贵的两件事——`getImageData` 回读与像素采样——另按 id 缓存，所以重排也便宜。）
 */
function sampleParticles(
  photo: PhotoMemory,
  width: number,
  height: number,
  count: number,
  position: THREE.Vector3,
) {
  const cacheKey = `${photo.id}@${photo.x.toFixed(3)}`;
  // 命中缓存：直接复用（数组只读，可以安全共享）
  const cached = cloudCache.get(cacheKey);
  if (cached && cached.count === count) {
    // 触摸一下 LRU
    cacheSet(cloudCache, cacheKey, cached, CLOUD_CACHE_MAX);
    work.cacheHits += 1;
    return cached;
  }
  work.cacheMisses += 1;
  work.sampled += count;

  const { cols, rows } = PHOTO.sampleGrid;

  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const radial = new Float32Array(count);
  const sizeJitter = new Float32Array(count);
  const seeds = new Float32Array(count);

  // 默认：灰白，万一取不到像素也不至于全黑
  let data: Uint8ClampedArray | null = imageBytesCache.get(photo.id) ?? null;
  if (!data && ctx) {
    ctx.drawImage(photo.image, 0, 0, cols, rows);
    data = ctx.getImageData(0, 0, cols, rows).data;
    // getImageData 是同步 GPU 回读（会 stall），只做一次
    cacheSet(imageBytesCache, photo.id, data, CLOUD_CACHE_MAX * 2);
  }

  for (let i = 0; i < count; i += 1) {
    // 随机采样一个像素格（比均匀遍历更像"散点"，也更省）
    const cx = Math.floor(Math.random() * cols);
    const cy = Math.floor(Math.random() * rows);
    const px = (cy * cols + cx) * 4;

    const a = data ? (data[px + 3] ?? 255) / 255 : 1;

    // sRGB → 线性（渲染在线性空间里做，最后由 OutputPass 转回 sRGB）
    const lr = SRGB_TO_LINEAR[data ? (data[px] ?? 200) : 204] ?? 0.5;
    const lg = SRGB_TO_LINEAR[data ? (data[px + 1] ?? 200) : 204] ?? 0.5;
    const lb = SRGB_TO_LINEAR[data ? (data[px + 2] ?? 200) : 204] ?? 0.5;

    const i3 = i * 3;
    // 平面局部坐标：中心为原点，y 向上
    const localX = (cx / (cols - 1) - 0.5) * width;
    const localY = (0.5 - cy / (rows - 1)) * height;
    positions[i3] = localX;
    positions[i3 + 1] = localY;
    positions[i3 + 2] = (Math.random() - 0.5) * PHOTO.cloud.thickness;

    // 径向归一化：0 = 正中心，1 = 最远角（用来做"从中心凝实"）
    const halfDiag = 0.5 * Math.hypot(width, height);
    radial[i] = Math.min(Math.hypot(localX, localY) / halfDiag, 1);
    sizeJitter[i] = Math.random();
    seeds[i] = Math.random();

    // 透明像素直接压暗，避免照片周围的空白变成灰块
    const shade = 0.35 + 0.65 * a;
    colors[i3] = lr * shade;
    colors[i3 + 1] = lg * shade;
    colors[i3 + 2] = lb * shade;
  }

  // 散开位置：沿着这张照片所在的河段铺开（世界坐标 = 落点 + 局部偏移）
  // 与采样一起缓存，避免重复进出视口时抖动不一样（看起来像"每张照片都在重排"）
  const scatter = new Float32Array(count * 3);
  // 散落位置只在 ±0.45×spacing 的范围里铺开，一条波长内框架几乎不变，
  // 所以框架按"这张照片的 x"算一次就够 —— 原来是每颗粒子都算一遍
  // （8 万次 Frenet 框架 + 24 万个临时对象，白烧十几毫秒）。
  const scatterFrame = frameAtX(photo.x);
  const { normal: sn, binormal: sb } = scatterFrame;
  const tubeRadius = RIVER.tube.radius;
  const twist = RIVER.tube.twistTurnsPerUnit * Math.PI * 2;
  for (let i = 0; i < count; i += 1) {
    const scatterX = photo.x + (Math.random() - 0.5) * PHOTO.spacing * 0.9;
    const theta = Math.random() * Math.PI * 2 + scatterX * twist;
    const radius = (0.5 + Math.random() * 0.9) * tubeRadius;
    const cosT = Math.cos(theta) * radius;
    const sinT = Math.sin(theta) * radius;
    const i3 = i * 3;
    scatter[i3] = scatterX + sn.x * cosT + sb.x * sinT - position.x;
    scatter[i3 + 1] = waveYAtX(scatterX) + sn.y * cosT + sb.y * sinT - position.y;
    scatter[i3 + 2] =
      waveZAtX(scatterX) +
      sn.z * cosT +
      sb.z * sinT -
      position.z -
      PHOTO.cloud.scatterRadius * 0.5 * Math.random();
  }

  const cloud: CachedCloud = {
    count,
    target: positions,
    tint: colors,
    scatter,
    radial,
    seed: seeds,
    sizeJitter,
  };
  return cacheSet(cloudCache, cacheKey, cloud, CLOUD_CACHE_MAX);
}

/**
 * 纹理缓存（避免重复上传整张照片）
 *
 * ⚠️ 缓存的纹理是**共享**的，节点 dispose 时不能 dispose 它：
 * 否则照片滚出视口再滚回来会重新上传一整张图（几十毫秒的卡顿）。
 * 淘汰只在 LRU 挤出时做。
 */
const TEXTURE_CACHE_MAX = 12;

function textureFor(photo: PhotoMemory): THREE.Texture {
  const cached = textureCache.get(photo.id);
  if (cached) {
    cacheSet(textureCache, photo.id, cached, TEXTURE_CACHE_MAX, disposeTexture);
    return cached;
  }
  return cacheSet(textureCache, photo.id, createTexture(photo), TEXTURE_CACHE_MAX, disposeTexture);
}

/** 只在 LRU 淘汰时释放显存 —— 节点自己不会 dispose 共享纹理 */
function disposeTexture(texture: THREE.Texture): void {
  texture.dispose();
}

/**
 * 照片被真正移除时释放它独占的缓存。
 *
 * 注意：不能按"滚出视口"释放 —— 那只是节点动态加载，滚回来还要用缓存。
 * 只有 store 里已经不存在这张照片（删除 / 清空）才调用这里。
 */
export function releasePhotoAssets(photoId: string): void {
  for (const key of [...cloudCache.keys()]) {
    if (key === photoId || key.startsWith(`${photoId}@`)) cloudCache.delete(key);
  }
  imageBytesCache.delete(photoId);
  const texture = textureCache.get(photoId);
  if (texture) {
    textureCache.delete(photoId);
    disposeTexture(texture);
  }
}

/** Stage 卸载时彻底释放模块级缓存（StrictMode 二次挂载会自然重建） */
export function disposePhotoAssets(): void {
  cloudCache.clear();
  imageBytesCache.clear();
  for (const texture of textureCache.values()) disposeTexture(texture);
  textureCache.clear();
  work.builds = 0;
  work.disposes = 0;
  work.sampled = 0;
  work.cacheHits = 0;
  work.cacheMisses = 0;
}

export function createPhotoNode(
  photo: PhotoMemory,
  index: number,
  particleCount: number = PHOTO.particlesPerPhoto,
): PhotoNode {
  work.builds += 1;
  const group = new THREE.Group();
  group.name = `photo:${photo.id}`;
  // 新建的节点先隐形：透明度和可见性由 applyFocusVisuals 统一决定，
  // 否则刚建好、还没跑过那一帧的节点会闪一下（尤其 L0 本该什么都没有）。
  group.visible = false;

  // ── 世界落点：由它在长河上的世界 x 决定 ──
  const position = photoWorldAtX(photo.x);

  const height = PHOTO.planeHeight;
  const width = height * Math.max(photo.aspect, 0.4);
  group.position.copy(position);

  // ── 颗粒云（采样 + 散落坐标一起走缓存） ──
  const { target, tint, radial, seed, scatter, sizeJitter, count } = sampleParticles(
    photo,
    width,
    height,
    particleCount,
    position,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aTarget', new THREE.BufferAttribute(target, 3));
  geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatter, 3));
  geometry.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute('aRadial', new THREE.BufferAttribute(radial, 1));
  geometry.setAttribute('aSizeJitter', new THREE.BufferAttribute(sizeJitter, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(target, 3));
  // 显式给包围球：粒子还会被 shatter 甩出去，否则会被误剔除
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    Math.hypot(width, height) * 0.5 + PHOTO.cloud.scatterRadius + 1.5,
  );

  /**
   * 斑块世界尺寸跟着"这张照片分到多少粒子"走：
   *   覆盖率 ∝ 粒子数 × 斑块面积，所以 N 掉一半就把直径放大 √2。
   * 这样无论相册 3 张还是 24 张，照片的明暗与实感都一致，只是清晰度有差别。
   */
  const densityScale = Math.sqrt(
    Math.min(PHOTO.particlesPerPhoto / Math.max(count, 1), PHOTO.splat.maxDensityScale),
  );
  const splatWorldSize = PHOTO.splat.worldSize * densityScale;

  const pointsUniforms = {
    uTime: { value: 0 },
    uAssemble: { value: 0 },
    uShatter: { value: 0 },
    uOpacity: { value: 0 },
    uProjScale: { value: 1000 },
    uSplatSize: { value: splatWorldSize },
    uCore: { value: PHOTO.splat.core as number },
    uSizeJitter: { value: PHOTO.splat.sizeJitter },
    uIntensity: { value: PHOTO.splat.intensity },
    uDustSizeBoost: { value: PHOTO.splat.dustSizeBoost as number },
    uRadialSpread: { value: PHOTO.radial.spread },
    uRadialSoft: { value: PHOTO.radial.soft },
    uEdgeScatter: { value: PHOTO.radial.edgeScatter },
    uTurbulence: { value: PHOTO.radial.turbulence },
    uEdgeAlpha: { value: PHOTO.radial.edgeAlpha as number },
    uEdgeDrift: { value: PHOTO.radial.edgeDrift as number },
    uEdgeFadeStart: { value: PHOTO.radial.edgeFadeStart as number },
  };
  assertUniforms('photoPoints', photoPointsVert, photoPointsFrag, pointsUniforms);

  const pointsMaterial = new THREE.ShaderMaterial({
    vertexShader: photoPointsVert,
    fragmentShader: photoPointsFrag,
    uniforms: pointsUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // 高斯泼溅用 alpha 合成：重叠收敛到照片颜色，并遮住背后的长河
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, pointsMaterial);
  points.name = `photoPoints:${photo.id}`;
  // 包围球是正确的话就让 three 做视锥剔除：屏幕外的照片节点直接不画
  points.frustumCulled = true;
  group.add(points);

  // ── 贴图平面（兜底可读性） ──
  const texture = textureFor(photo);
  const planeGeometry = new THREE.PlaneGeometry(width, height);
  const planeUniforms = {
    uMap: { value: texture },
    uOpacity: { value: 0 },
    uDissolve: { value: 1 },
    uGrain: { value: 0.6 + (index % 5) * 0.1 },
    uCorner: { value: 0.3 },
    uBorder: { value: 1.3 },
    uExposure: { value: PHOTO.exposure },
    uAssemble: { value: 0 },
    uRadialSpread: { value: PHOTO.radial.spread },
    uRadialSoft: { value: PHOTO.radial.soft },
    uFeatherStart: { value: PHOTO.planeFeatherStart as number },
  };
  assertUniforms('photoPlane', photoPlaneVert, photoPlaneFrag, planeUniforms);

  const planeMaterial = new THREE.ShaderMaterial({
    vertexShader: photoPlaneVert,
    fragmentShader: photoPlaneFrag,
    uniforms: planeUniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });

  const plane = new THREE.Mesh(planeGeometry, planeMaterial);
  plane.name = `photoPlane:${photo.id}`;
  plane.renderOrder = 1;
  // 平面放在独立的组里（挂在 overlay 场景，绕过 bloom）
  // 贴图与粒子放在同一个节点组里（整层都在 overlay 场景，不参与 bloom）
  group.add(plane);

  const node: PhotoNode = {
    id: photo.id,
    x: photo.x,
    debugState: () => ({
      particles: count,
      planeOpacity: Number((planeUniforms.uOpacity.value as number).toFixed(3)),
      particleOpacity: Number((pointsUniforms.uOpacity.value as number).toFixed(3)),
      assemble: Number((pointsUniforms.uAssemble.value as number).toFixed(3)),
      splatSize: pointsUniforms.uSplatSize.value,
      intensity: pointsUniforms.uIntensity.value,
      projScale: Number((pointsUniforms.uProjScale.value as number).toFixed(1)),
    }),
    position,
    height,
    width,
    group,
    assemble: 0,

    setVisuals(assemble, particleOpacity, planeOpacity, shatter = 0, shatterScale = 1) {
      this.assemble = Math.min(Math.max(assemble, 0), 1);
      pointsUniforms.uAssemble.value = this.assemble;
      planeUniforms.uAssemble.value = this.assemble;
      pointsUniforms.uOpacity.value = particleOpacity;
      pointsUniforms.uShatter.value = Math.min(Math.max(shatter, 0), 1);
      pointsUniforms.uDustSizeBoost.value = PHOTO.splat.dustSizeBoost * shatterScale;
      planeUniforms.uOpacity.value = planeOpacity;
      // 贴图溶解有两个来源：
      //  ① 成型度不够（L0/L1 时边缘不完整）
      //  ② 碎裂强度（shatter）—— 让照片像被打洞，而不是整块变淡
      const edgeDissolve = 1 - Math.max((this.assemble - 0.55) / 0.45, 0);
      planeUniforms.uDissolve.value = Math.max(edgeDissolve, Math.min(shatter, 1) * 0.82);
    },

    faceCamera(camera) {
      // 只绕 Y 轴朝向相机，保持"立在宇宙里"的姿态
      const dx = camera.position.x - group.position.x;
      const dz = camera.position.z - group.position.z;
      const yaw = Math.atan2(dx, dz);
      // L2 时略微抬头对准镜头，L1 保持站立
      group.rotation.set(0, yaw, 0);
    },

    dispose() {
      work.disposes += 1;
      geometry.dispose();
      pointsMaterial.dispose();
      planeGeometry.dispose();
      planeMaterial.dispose();
      // 纹理来自 LRU 缓存，共享使用：这里**不能** dispose，否则滚回来要重新上传整张图
      group.clear();
    },
  };

  // 时间 uniform 由外部每帧推进（避免每个节点自己起循环）
  (node as PhotoNode & { tick?: (t: number, projScale: number) => void }).tick = (t, projScale) => {
    pointsUniforms.uTime.value = t;
    pointsUniforms.uProjScale.value = projScale;
  };

  return node;
}

export interface PhotoVisuals {
  assemble: number;
  particleOpacity: number;
  planeOpacity: number;
}

export interface PhotoField {
  /**
   * 照片层：高斯泼溅粒子 + 薄底贴图。
   * 整层都放在 overlay 场景里（bloom 之后叠加）—— 照片必须忠实，
   * 不能被辉光糊成一片白。
   */
  group: THREE.Group;
  nodes: Map<string, PhotoNode>;
  /**
   * 重建节点（照片增删 / 滚动后调用）
   *
   * **动态加载**：只保留视口附近 ±`visibleRadius` 张照片的节点，最多 `maxNodes` 个。
   * 每个节点带 3.6 万粒子，几十张照片全建出来会直接爆显存。
   *
   * @param visuals 当前装配度快照 —— 新建节点直接继承，避免"重新组装"闪一下
   * @param scrollX 相机在长河上的世界坐标（决定哪些照片在视口内）
   */
  sync(photos: PhotoMemory[], visuals?: PhotoVisuals, budgetScale?: number, scrollX?: number): void;
  /**
   * 预热：把还没缓存点云的照片采一张（**每次调用只做一张**，方便在空闲帧里分批做）。
   *
   * 一张 8 万粒子的点云约 6ms，如果等到扇动时才建就会变成掉帧。
   * 导入完成后在空闲时间把它们都采好，之后就永远是缓存命中。
   *
   * @returns 还剩几张没预热（0 = 全部就绪）
   */
  prewarm(photos: PhotoMemory[], budgetScale?: number): number;
  /** @param projScale 世界尺寸 → 像素的投影系数（视口或 fov 变化时更新） */
  tick(time: number, projScale: number, camera: THREE.Camera): void;
  /** 诊断：节点数 / 排队待建数 / 缓存命中规模 */
  stats(): {
    nodes: number;
    pending: number;
    clouds: number;
    textures: number;
    bytes: number;
    builds: number;
    disposes: number;
    sampled: number;
    cacheHits: number;
    cacheMisses: number;
  };
  dispose(): void;
}

/** 所有照片节点的容器 */
export function createPhotoField(): PhotoField {
  const group = new THREE.Group();
  group.name = 'photos';
  const nodes = new Map<string, PhotoNode>();

  /** 上次做窗口计算的滚动位置 / 照片数 / 预算（用来跳过无意义的重算） */
  let lastScroll = Number.NaN;
  let lastBudget = Number.NaN;
  /** 相册 id + 世界坐标的指纹：删除后补一张同样数量时，只比较 count 会漏更新 */
  let lastSignature = '';
  /** 还有多少张排队没建完（有积压就必须继续调 sync） */
  let pending = 0;
  /** 上一次 sync 时相册里的 id：用来识别"真正被删除"并释放独占缓存 */
  const knownIds = new Set<string>();

  return {
    group,
    nodes,

    sync(photos, visuals, budgetScale = 1, scrollX = 0) {
      // ① 节流：滚动几乎没动、照片没变、也没有积压时，逐帧重算窗口纯属浪费
      const moved = !(Math.abs(scrollX - lastScroll) < PHOTO.spacing * 0.12);
      const signature = photos.map((photo) => `${photo.id}:${photo.x.toFixed(2)}`).join('|');
      if (
        !moved &&
        signature === lastSignature &&
        budgetScale === lastBudget &&
        pending === 0
      ) {
        return;
      }

      // ①a 相册里已经不存在的照片：释放纹理/像素/点云缓存。
      //     这与"滚出视口"不同 —— 后者只是动态卸载节点，缓存必须留着。
      const liveIds = new Set(photos.map((photo) => photo.id));
      for (const id of knownIds) {
        if (!liveIds.has(id)) releasePhotoAssets(id);
      }
      knownIds.clear();
      for (const id of liveIds) knownIds.add(id);

      // ① 两圈半径 + 迟滞
      //    建节点用 prefetchRadius（提前备好，扇动时才不会在关键时刻卡一下）；
      //    删节点用更宽一圈的半径 —— 边界上来回抖时不会反复建/删（这就是"卡"的来源）。
      const buildRadius = PHOTO.prefetchRadius * PHOTO.spacing;
      const keepRadius = (PHOTO.prefetchRadius + 1) * PHOTO.spacing;

      const keepSet = new Set<string>();
      const wanted: { photo: PhotoMemory; index: number; dist: number }[] = [];
      photos.forEach((photo, index) => {
        const dist = Math.abs(photo.x - scrollX);
        if (dist <= keepRadius) keepSet.add(photo.id);
        if (dist <= buildRadius) wanted.push({ photo, index, dist });
      });
      // 离画面中心最近的先建：这样"看得见的那张"永远第一时间就位
      wanted.sort((a, b) => a.dist - b.dist);
      wanted.length = Math.min(wanted.length, PHOTO.maxNodes);

      // 立刻记下本轮参数：后面即使提前返回也不会重复算
      lastScroll = scrollX;
      lastSignature = signature;
      lastBudget = budgetScale;

      // ② 清掉已经离开迟滞窗口的
      for (const [id, node] of nodes) {
        if (!keepSet.has(id)) {
          group.remove(node.group);
          node.dispose();
          nodes.delete(id);
        }
      }

      // ③ slot 变了 → 世界落点与散落坐标都失效，必须重建。
      //    这是"导入第 N 张后整条时间轴重排"的必然结果，不重建就会出现照片和焦点对不上。
      for (const photo of photos) {
        const node = nodes.get(photo.id);
        if (node && Math.abs(node.x - photo.x) > 1e-4) {
          group.remove(node.group);
          node.dispose();
          nodes.delete(photo.id);
        }
      }

      // ④ 补齐缺的：每帧最多建 `buildPerFrame` 个，剩下的排队等下一帧
      // 粒子预算按**相册总张数**摊（不是视口里的张数）：这样每张照片的粒子数只随
      // "导入了几张"变化，点云缓存才能真正复用，不会每滚一次就重新采样。
      const perPhoto = particleBudgetFor(photos.length, budgetScale);
      let built = 0;
      for (const { photo, index } of wanted) {
        if (built >= PHOTO.buildPerFrame) break;
        if (nodes.has(photo.id)) continue;
        const node = createPhotoNode(photo, index, perPhoto);
        if (visuals) {
          node.setVisuals(visuals.assemble, visuals.particleOpacity, visuals.planeOpacity);
        }
        nodes.set(photo.id, node);
        group.add(node.group);
        built += 1;
      }
      // 记下积压量：> 0 表示下一帧还要继续建（节流必须放行）
      pending = wanted.reduce((sum, entry) => (nodes.has(entry.photo.id) ? sum : sum + 1), 0);
    },

    prewarm(photos, budgetScale = 1) {
      const perPhoto = particleBudgetFor(photos.length, budgetScale);
      let remaining = 0;
      let didOne = false;
      for (const photo of photos) {
        const key = `${photo.id}@${photo.x.toFixed(3)}`;
        const cached = cloudCache.get(key);
        if (cached && cached.count === perPhoto) continue;
        if (didOne) {
          remaining += 1;
          continue;
        }
        sampleParticles(
          photo,
          PHOTO.planeHeight * Math.max(photo.aspect, 0.4),
          PHOTO.planeHeight,
          perPhoto,
          photoWorldAtX(photo.x),
        );
        didOne = true;
      }
      return remaining;
    },

    tick(time, projScale, camera) {
      for (const node of nodes.values()) {
        (node as PhotoNode & { tick?: (t: number, p: number) => void }).tick?.(time, projScale);
        node.faceCamera(camera);
      }
    },

    stats() {
      return {
        nodes: nodes.size,
        pending,
        clouds: cloudCache.size,
        textures: textureCache.size,
        bytes: imageBytesCache.size,
        builds: work.builds,
        disposes: work.disposes,
        sampled: work.sampled,
        cacheHits: work.cacheHits,
        cacheMisses: work.cacheMisses,
      };
    },

    dispose() {
      for (const node of nodes.values()) {
        group.remove(node.group);
        node.dispose();
      }
      nodes.clear();
    },
  };
}

/** 照片世界坐标：由它的世界 x 决定（长河是 x 的函数） */
export function photoWorldAtX(x: number): THREE.Vector3 {
  const axis = pointOnRiverX(x);
  return new THREE.Vector3(axis.x, axis.y, axis.z + PHOTO.planeLift);
}
/** 视口高度对应多少世界单位（长焦相机下近似） */
export function visibleHeightAt(distance: number, fovDeg: number): number {
  return 2 * distance * Math.tan((fovDeg * Math.PI) / 360);
}

/** 让某张照片占视口 fraction 所需的相机距离 */
export function distanceForFraction(worldHeight: number, fraction: number, fovDeg: number): number {
  return worldHeight / Math.max(fraction * 2 * Math.tan((fovDeg * Math.PI) / 360), 1e-4);
}

/** 取景宽度的参考（Stage 里给 L0 取景用） */
export const riverWindowWidth = RIVER.windowWidth;
