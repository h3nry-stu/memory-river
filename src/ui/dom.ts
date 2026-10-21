/**
 * 判断事件目标是不是"正在输入文字"的控件
 *
 * 对话面板一出现就有了 textarea：如果快捷键不避让，
 * 空格会拨动长河、回车会跳层、G 会切输入模式 —— 输入框直接没法用。
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}
