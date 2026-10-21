/** 状态层：唯一的可写运行时状态（zustand）。scene / gesture / ui 都从这里读。 */
export { useRiverStore, readRiverState, markDerivedLayerWrite, isDerivedLayerWrite } from './store';
export type {
  RiverState,
  RiverActions,
  InputMode,
  GestureStatus,
  Telemetry,
  ChatTurn,
  ChatCitation,
  ChatArchive,
  MemoryDigest,
} from './store';
