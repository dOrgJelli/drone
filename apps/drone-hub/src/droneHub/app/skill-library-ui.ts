export function inputClassName() {
  return 'h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors';
}

export function textareaClassName() {
  return 'w-full rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono';
}

export function buttonClassName(kind: 'primary' | 'secondary' | 'danger' = 'secondary', disabled = false): string {
  if (disabled) {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]';
  }
  if (kind === 'primary') {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110';
  }
  if (kind === 'danger') {
    return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]';
  }
  return 'h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]';
}

export function importStatusClassName(status: 'importable' | 'importable_with_loss' | 'not_importable'): string {
  if (status === 'importable') {
    return 'border-[rgba(52,211,153,.25)] bg-[rgba(16,185,129,.10)] text-[#34d399]';
  }
  if (status === 'importable_with_loss') {
    return 'border-[rgba(251,191,36,.22)] bg-[rgba(245,158,11,.10)] text-[#fbbf24]';
  }
  return 'border-[rgba(255,90,90,.22)] bg-[rgba(255,90,90,.08)] text-[var(--red)]';
}
