import type { ReactNode } from "react";

type Accent = "default" | "brand" | "danger" | "warn" | "ok";

const iconTint: Record<Accent, string> = {
  default: "bg-slate-100 text-slate-500 ring-slate-200/70",
  brand: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  danger: "bg-red-50 text-red-600 ring-red-100",
  warn: "bg-amber-50 text-amber-600 ring-amber-100",
  ok: "bg-emerald-50 text-emerald-600 ring-emerald-100",
};

interface PanelProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  accent?: Accent;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({
  title,
  subtitle,
  icon,
  trailing,
  accent = "default",
  children,
  className = "",
  bodyClassName = "p-5",
}: PanelProps) {
  return (
    <section className={`overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${iconTint[accent]}`}>{icon}</span>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs leading-5 text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center">
      {icon ? <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-400">{icon}</span> : null}
      {title ? <p className="text-sm font-medium text-slate-600">{title}</p> : null}
      <p className="max-w-sm text-xs leading-5 text-slate-400">{children}</p>
    </div>
  );
}
