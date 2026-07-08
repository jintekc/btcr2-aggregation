import { useState, type ReactNode } from 'react';

/** A panel with the standard surface, border, and radius. */
export function Card({
  children,
  className = '',
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-edge bg-surface ${glow ? 'shadow-[0_0_0_1px_var(--color-accent)]' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/** A small uppercase section heading. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-faint">{children}</h2>
  );
}

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-edge',
  accent: 'bg-accent/15 text-accent border-accent/40',
  good: 'bg-good/15 text-good border-good/40',
  warn: 'bg-warn/15 text-warn border-warn/40',
  bad: 'bg-bad/15 text-bad border-bad/40',
};

/** A pill label. */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** A filled or ghost button. */
export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
  type?: 'button' | 'submit';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40';
  const styles: Record<string, string> = {
    primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95',
    ghost: 'border border-edge-strong bg-surface-2 text-ink hover:bg-surface',
    danger: 'border border-bad/50 bg-bad/10 text-bad hover:bg-bad/20',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

/** A text/password/number input over the inset canvas surface (non-accent focus ring). */
export function Input({
  value,
  onChange,
  type = 'text',
  placeholder,
  id,
  name,
  autoComplete,
  disabled = false,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password' | 'number';
  placeholder?: string;
  id?: string;
  name?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      id={id}
      name={name}
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-faint transition focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-edge-strong disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    />
  );
}

/** A select control over the inset canvas surface (options are typed string values). */
export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  name,
  disabled = false,
  className = '',
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={`w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink transition focus:border-edge-strong focus:outline-none focus:ring-2 focus:ring-edge-strong disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A labeled form control (uppercase micro-label, like SectionTitle) with an optional error. */
export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-xs font-semibold uppercase tracking-[0.14em] text-faint"
      >
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}

const DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-faint',
  accent: 'bg-accent',
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-bad',
};

/** A status dot; `pulse` adds a live ring. `label` adds a screen-reader text alternative. */
export function StatusDot({
  tone = 'neutral',
  pulse = false,
  label,
}: {
  tone?: Tone;
  pulse?: boolean;
  label?: string;
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      title={label}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT_CLASS[tone]} ${pulse ? 'pulse' : ''}`}
    />
  );
}

/** Monospace inline code with truncation. */
export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.8rem] ${className}`}>{children}</span>;
}

/**
 * Copy text to the clipboard, falling back to a temporary-textarea + execCommand
 * for non-secure (plain http) origins where `navigator.clipboard` is undefined.
 * Returns whether the copy succeeded.
 */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** A click-to-copy chip for hex/DID values. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    const ok = await copyToClipboard(value);
    setState(ok ? 'copied' : 'failed');
    setTimeout(() => setState('idle'), 1400);
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-canvas px-3 py-2">
      <div className="min-w-0">
        <div className="text-[0.65rem] uppercase tracking-wider text-faint">{label}</div>
        <Mono className="block truncate text-muted">{value}</Mono>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`copy ${label}`}
        className="shrink-0 rounded-md border border-edge-strong px-2 py-1 text-xs text-muted hover:bg-surface-2"
      >
        {state === 'copied' ? 'copied' : state === 'failed' ? 'select + copy' : 'copy'}
      </button>
    </div>
  );
}
