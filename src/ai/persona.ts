import { AI } from '@/config';
import { personaInstruction } from './personaProfiles';

/**
 * 总人格「溯」+ 可切换气质（2026-10 交接重构）
 * ────────────────────────────────────────────────────────────────
 * 只给模型一个身份和一种气质，不再塞入句式、字数、提问比例、
 * 口头禅、禁说清单之类的硬限制。怎么说话由模型自己决定。
 */

export interface PersonaVoice {
  name: string;
  catchphrases: readonly string[];
  rules: readonly string[];
}

export type PersonaPreset = (typeof AI.personas)[number];

export const SHARED_PERSONA: PersonaVoice = {
  name: AI.personaName,
  catchphrases: AI.catchphrases,
  rules: [],
};

export function personaById(personaId: string): PersonaPreset {
  return (
    AI.personas.find((persona) => persona.id === personaId) ??
    AI.personas.find((persona) => persona.id === AI.defaultPersonaId) ??
    AI.personas[0]!
  );
}

/**
 * 身份 + 说话气质。
 *
 * 如果用户蒸馏过该人格，**只注入 instruction**；
 * rawCorpus 永远不进入这里（隐私 / 性能铁律）。
 */
export function composePersonaHeader(personaId: string = AI.defaultPersonaId): string {
  const preset = personaById(personaId);
  const custom = personaInstruction(personaId);
  if (custom) {
    return [
      `# 人格`,
      `你是「${AI.personaName}」。`,
      '',
      custom,
    ].join('\n');
  }
  return [
    `# 人格`,
    `你是「${AI.personaName}」。`,
    `当前气质：${preset.name}。`,
  ].join('\n');
}

export const PERSONA_SAMPLING = AI.sampling;
