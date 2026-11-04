// 小型 HTML 工具：转义、按钮（禁用时显示原因）、进度条

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 按钮：disabledReason 非空时禁用并在旁边显示原因 */
export function btn(label: string, act: string, arg: string | number = '', disabledReason = '', cls = ''): string {
  const dis = disabledReason ? ' disabled' : '';
  const title = disabledReason ? ` title="${esc(disabledReason)}"` : '';
  return `<button class="${cls}" data-act="${esc(act)}" data-arg="${esc(arg)}"${dis}${title}>${esc(label)}</button>${disabledReason ? `<span class="why">${esc(disabledReason)}</span>` : ''}`;
}

/** 紧凑按钮：禁用原因只放在 title 中（用于成组小按钮，原因另行展示） */
export function sbtn(label: string, act: string, arg: string | number = '', disabledReason = '', cls = ''): string {
  const dis = disabledReason ? ' disabled' : '';
  const title = disabledReason ? ` title="${esc(disabledReason)}"` : '';
  return `<button class="${cls}" data-act="${esc(act)}" data-arg="${esc(arg)}"${dis}${title}>${esc(label)}</button>`;
}

export function bar(frac: number, cls = ''): string {
  const p = Math.max(0, Math.min(1, frac)) * 100;
  return `<div class="bar ${cls}"><i style="width:${p.toFixed(1)}%"></i></div>`;
}
