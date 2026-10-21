import { create } from 'zustand';
import { readApiSettings, resolvedApiKey } from './settings';

/**
 * 共享 API 可用性（不持久化）
 * ────────────────────────────────────────────────────────────────
 * Product chat 不再静默回落 Mock：
 *   no-key / invalid / offline 时，对话输入直接禁用。
 *
 * 状态只来自真实请求与浏览器网络事件，不伪造“在线”。
 */

export type ApiStatus = 'unknown' | 'online' | 'offline' | 'invalid' | 'no-key';

export interface ApiStatusStore {
  status: ApiStatus;
  reason: string | null;
  checkedAt: number;
  setStatus(status: ApiStatus, reason?: string | null): void;
  syncFromSettings(): void;
}

function hasKey(): boolean {
  return resolvedApiKey(readApiSettings()).length > 0;
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function initialStatus(): Pick<ApiStatusStore, 'status' | 'reason'> {
  if (!hasKey()) return { status: 'no-key', reason: '未配置 API Key' };
  if (!browserOnline()) return { status: 'offline', reason: '浏览器当前处于离线状态' };
  return { status: 'unknown', reason: null };
}

const initial = initialStatus();

export const useApiStatusStore = create<ApiStatusStore>()((set) => ({
  ...initial,
  checkedAt: 0,

  setStatus(status, reason = null) {
    set({ status, reason, checkedAt: Date.now() });
  },

  syncFromSettings() {
    if (!hasKey()) {
      set({ status: 'no-key', reason: '未配置 API Key', checkedAt: Date.now() });
      return;
    }
    if (!browserOnline()) {
      set({ status: 'offline', reason: '浏览器当前处于离线状态', checkedAt: Date.now() });
      return;
    }
    // 有 Key 但还没验证：允许发送，由真实请求决定 online / invalid / offline
    set({ status: 'unknown', reason: null, checkedAt: Date.now() });
  },
}));

/** 非 React 消费者读快照 */
export function readApiStatus(): ApiStatusStore {
  return useApiStatusStore.getState();
}

/** 根据失败原因归类 */
export function statusForFailure(reason: string | undefined | null): ApiStatus {
  if (!reason) return 'offline';
  if (/no-api-key|no-vision-api-key/i.test(reason)) return 'no-key';
  if (/401|403|unauthorized|forbidden|invalid.?key/i.test(reason)) return 'invalid';
  return 'offline';
}

export function markApiFailure(reason: string | undefined | null): ApiStatus {
  const status = statusForFailure(reason);
  useApiStatusStore.getState().setStatus(status, reason ?? null);
  return status;
}

export function markApiOnline(): void {
  useApiStatusStore.getState().setStatus('online', null);
}

/** 浏览器恢复在线：有 Key 时回到 unknown，等待真实请求验证 */
export function syncApiStatusFromEnvironment(): void {
  useApiStatusStore.getState().syncFromSettings();
}
