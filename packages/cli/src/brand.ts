const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;
const ITALIC = `${ESC}3m`;

const fg = (n: number) => `${ESC}38;5;${n}m`;

export const c = {
  reset: RESET,
  bold: BOLD,
  dim: DIM,
  italic: ITALIC,

  xp: fg(35),
  xpBright: fg(46),
  streak: fg(214),
  streakHot: fg(196),
  level: fg(141),
  danger: fg(196),
  warn: fg(214),
  success: fg(35),
  accent: fg(80),
  muted: fg(243),
  ghost: fg(238),
  white: fg(255),

  easy: fg(35),
  medium: fg(214),
  hard: fg(196),
  epic: fg(141),
} as const;

const LOGO = [
  `${c.xp}${BOLD} ██████╗ ██████╗ ██╗███╗   ██╗██████╗ ${RESET}`,
  `${c.xp}${BOLD}██╔════╝ ██╔══██╗██║████╗  ██║██╔══██╗${RESET}`,
  `${c.xp}${BOLD}██║  ███╗██████╔╝██║██╔██╗ ██║██║  ██║${RESET}`,
  `${c.xp}${BOLD}██║   ██║██╔══██╗██║██║╚██╗██║██║  ██║${RESET}`,
  `${c.xp}${BOLD}╚██████╔╝██║  ██║██║██║ ╚████║██████╔╝${RESET}`,
  `${c.xp}${BOLD} ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝ ${RESET}`,
].join("\n");

export function showBanner(): string {
  return LOGO;
}

export function showTitle(): string {
  return `${c.xp}${BOLD}GRIND${RESET}`;
}

export function tag(label: string, color: string): string {
  return `${color}${BOLD}${label}${RESET}`;
}
