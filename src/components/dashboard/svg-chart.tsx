import { cn } from "@/lib/utils";

/**
 * Lightweight server-rendered stacked area chart (no client JS). Used in the marketing hero
 * preview and small dashboard cards; the full dashboard uses interactive Recharts charts.
 */
export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export function StackedAreaSvg<T extends Record<string, number | string>>({
  data,
  series,
  height = 160,
  className,
  title,
}: {
  data: T[];
  series: SeriesDef[];
  height?: number;
  className?: string;
  title: string;
}) {
  const W = 600;
  const H = height;
  const pad = { top: 8, bottom: 20, left: 0, right: 0 };
  const totals = data.map((d) => series.reduce((s, se) => s + Number(d[se.key] ?? 0), 0));
  const max = Math.max(1, ...totals) * 1.1;
  const x = (i: number) => pad.left + (i * (W - pad.left - pad.right)) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / max);

  const cumulative: number[][] = [];
  series.forEach((se, si) => {
    cumulative[si] = data.map((d, i) => (si > 0 ? cumulative[si - 1][i] : 0) + Number(d[se.key] ?? 0));
  });

  const paths = series.map((se, si) => {
    const top = cumulative[si].map((v, i) => `${x(i)},${y(v)}`);
    const bottom = (si > 0 ? cumulative[si - 1] : data.map(() => 0)).map((v, i) => `${x(i)},${y(v)}`).reverse();
    return { se, area: `M${top.join(" L")} L${bottom.join(" L")} Z`, line: `M${top.join(" L")}` };
  });

  const summary = series.map((s) => `${s.label}: ${data.reduce((sum, d) => sum + Number(d[s.key] ?? 0), 0)}`).join(", ");

  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-auto w-full" style={{ height }} role="img" aria-label={`${title}. ${summary}`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={pad.top + (H - pad.top - pad.bottom) * f} y2={pad.top + (H - pad.top - pad.bottom) * f} stroke="var(--border)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ))}
        {paths
          .slice()
          .reverse()
          .map(({ se, area, line }) => (
            <g key={se.key}>
              <path d={area} fill={se.color} fillOpacity={0.14} />
              <path d={line} fill="none" stroke={se.color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
