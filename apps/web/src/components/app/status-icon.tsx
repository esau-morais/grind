import { cn } from "#/lib/utils";

interface StatusIconProps {
  status: string;
  size?: number;
  className?: string;
}

export function StatusIcon({ status, size = 16, className }: StatusIconProps) {
  const r = (size - 2) / 2;
  const cx = size / 2;
  const cy = size / 2;

  const base = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      {renderStatus(status, cx, cy, r, size)}
    </svg>
  );

  return base;
}

function renderStatus(
  status: string,
  cx: number,
  cy: number,
  r: number,
  size: number,
): React.ReactNode {
  const sw = Math.max(1, size / 10);

  switch (status) {
    case "available":
    case "pending":
      return (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="currentColor"
          strokeWidth={sw}
          strokeDasharray={`${r * 0.55} ${r * 0.3}`}
          strokeLinecap="round"
        />
      );

    case "active": {
      const a = r * 0.5;
      return (
        <>
          <circle cx={cx} cy={cy} r={r} stroke="currentColor" strokeWidth={sw} />
          <path
            d={`M ${cx - a * 0.6} ${cy - a * 0.7} L ${cx + a * 0.9} ${cy} L ${cx - a * 0.6} ${cy + a * 0.7}`}
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    }

    case "completed":
    case "success": {
      const c = r * 0.5;
      return (
        <>
          <circle cx={cx} cy={cy} r={r} stroke="currentColor" strokeWidth={sw} />
          <path
            d={`M ${cx - c * 0.8} ${cy} L ${cx - c * 0.1} ${cy + c * 0.8} L ${cx + c * 1} ${cy - c * 0.8}`}
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    }

    case "failed":
    case "error": {
      const x = r * 0.45;
      return (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            stroke="currentColor"
            strokeWidth={sw}
            strokeDasharray={`${r * 0.55} ${r * 0.3}`}
            strokeLinecap="round"
          />
          <path
            d={`M ${cx - x} ${cy - x} L ${cx + x} ${cy + x} M ${cx + x} ${cy - x} L ${cx - x} ${cy + x}`}
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </>
      );
    }

    case "abandoned":
    case "skipped":
    case "disabled":
    case "off":
      return (
        <>
          <circle cx={cx} cy={cy} r={r} stroke="currentColor" strokeWidth={sw} />
          <path
            d={`M ${cx - r * 0.55} ${cy + r * 0.55} L ${cx + r * 0.55} ${cy - r * 0.55}`}
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </>
      );

    default:
      return <circle cx={cx} cy={cy} r={r} stroke="currentColor" strokeWidth={sw} />;
  }
}
