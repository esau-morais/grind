"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import type { TooltipProps } from "recharts";

export interface DailyXpEntry {
  date: string;
  xp: number;
}

const BLOCK_SIZE = 8;
const BLOCK_GAP = 2;
const BLOCK_UNIT = BLOCK_SIZE + BLOCK_GAP;

interface PixelBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  containerHeight?: number;
}

function PixelBar({
  x = 0,
  y: _y = 0,
  width = 0,
  height = 0,
  containerHeight = 200,
}: PixelBarProps) {
  const totalBlocks = Math.floor(containerHeight / BLOCK_UNIT);
  const filledBlocks = Math.max(0, Math.floor(height / BLOCK_UNIT));
  const bx = x + (width - BLOCK_SIZE) / 2;
  const blocks: React.ReactNode[] = [];

  for (let i = 0; i < totalBlocks; i++) {
    const isFilled = i >= totalBlocks - filledBlocks;
    const by = containerHeight - (i + 1) * BLOCK_UNIT + BLOCK_GAP;
    blocks.push(
      <rect
        key={i}
        x={bx}
        y={by}
        width={BLOCK_SIZE}
        height={BLOCK_SIZE}
        rx={1.5}
        fill={isFilled ? "#ff6c05" : "oklch(0.24 0.006 286 / 0.4)"}
      />,
    );
  }

  return <g>{blocks}</g>;
}

interface ChartTooltipProps extends TooltipProps<number, string> {
  showForge?: boolean;
}

function ChartTooltip({ active, payload, label, showForge }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const xp = payload.find((p) => p.dataKey === "xp")?.value ?? 0;
  const runs = payload.find((p) => p.dataKey === "runs")?.value ?? 0;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold text-grind-orange">+{xp} XP</p>
      {showForge && Number(runs) > 0 && (
        <p className="font-mono text-xs text-[oklch(0.72_0.19_285)]">
          {runs} forge run{Number(runs) !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

interface ActivityChartData {
  date: string;
  xp: number;
  runs: number;
}

interface XpBarChartProps {
  data: DailyXpEntry[];
  forgeRuns?: DailyXpEntry[];
  height?: number;
}

export function XpBarChart({ data, forgeRuns, height = 200 }: XpBarChartProps) {
  const hasForge = forgeRuns !== undefined && forgeRuns.some((d) => d.xp > 0);

  const merged: ActivityChartData[] = data.map((d, i) => ({
    date: d.date,
    xp: d.xp,
    runs: forgeRuns?.[i]?.xp ?? 0,
  }));

  const maxRuns = hasForge ? Math.max(...merged.map((d) => d.runs), 1) : 1;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card">
      <div className="bg-grid absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="relative z-10 p-4">
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart
            data={merged}
            margin={{ top: 4, right: hasForge ? 28 : 4, left: 4, bottom: 16 }}
            barCategoryGap="30%"
          >
            <XAxis
              dataKey="date"
              tick={{
                fill: "oklch(0.65 0.015 286)",
                fontSize: 10,
                fontFamily: "JetBrains Mono Variable",
              }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis yAxisId="xp" hide />
            {hasForge && (
              <YAxis
                yAxisId="runs"
                orientation="right"
                domain={[0, maxRuns + 1]}
                tickCount={4}
                tick={{
                  fill: "oklch(0.65 0.015 286)",
                  fontSize: 9,
                  fontFamily: "JetBrains Mono Variable",
                }}
                axisLine={false}
                tickLine={false}
                width={22}
              />
            )}
            <Tooltip
              content={<ChartTooltip showForge={hasForge} />}
              cursor={{ fill: "oklch(0.24 0.006 286 / 0.3)" }}
            />
            <Bar
              yAxisId="xp"
              dataKey="xp"
              shape={(props: unknown) => (
                <PixelBar {...(props as PixelBarProps)} containerHeight={height} />
              )}
              isAnimationActive={false}
            >
              {merged.map((entry) => (
                <Cell key={entry.date} fill="#ff6c05" />
              ))}
            </Bar>
            {hasForge && (
              <Line
                yAxisId="runs"
                dataKey="runs"
                stroke="oklch(0.72 0.19 285)"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: "oklch(0.72 0.19 285)", strokeWidth: 0 }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {hasForge && (
        <div className="relative z-10 flex items-center gap-4 border-t border-border/50 px-4 pb-3 pt-2 font-mono text-[10px]">
          <span className="flex items-center gap-1.5 text-grind-orange">
            <span className="block h-2 w-2 rounded-sm bg-grind-orange" />
            XP earned
          </span>
          <span className="flex items-center gap-1.5 text-[oklch(0.72_0.19_285)]">
            <span className="block h-0.5 w-4" style={{ background: "oklch(0.72 0.19 285)" }} />
            Forge runs
          </span>
        </div>
      )}
    </div>
  );
}
