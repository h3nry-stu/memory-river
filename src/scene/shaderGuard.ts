/**
 * 着色器 uniform 自检（仅 DEV 生效）
 *
 * 由来：曾经漏传 `uCoreWeight`/`uHaloWeight`，GLSL 里未绑定的 uniform 默认为 0，
 * 于是片元整片 discard —— 画面全黑却不报任何错误，极难排查。
 * 现在每次创建材质都对比「着色器声明的 uniform」与「实际提供的 uniform」，
 * 缺失就立刻抛错并指出名字。
 */

const UNIFORM_DECL = /uniform\s+(?:lowp\s+|mediump\s+|highp\s+)?\w+\s+(u[A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?\s*;/g;

/** 从 GLSL 源码里抽取声明的 uniform 名（数组去掉下标） */
export function declaredUniforms(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(UNIFORM_DECL)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

/** DEV 下断言材质提供了着色器需要的全部 uniform */
export function assertUniforms(
  label: string,
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;

  const missing = [...declaredUniforms(vertexShader), ...declaredUniforms(fragmentShader)].filter(
    (name) => !(name in uniforms),
  );

  if (missing.length > 0) {
    throw new Error(
      `[shader:${label}] 缺少 uniform：${[...new Set(missing)].join(', ')}` +
        `（GLSL 未绑定会默认为 0，画面会静默变黑）`,
    );
  }
}
