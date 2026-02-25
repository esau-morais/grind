const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";

const unicode = process.platform !== "win32" && process.env.TERM !== "linux";

// Match clack's exact frames and timing
const FRAMES = unicode ? ["◒", "◐", "◓", "◑"] : ["-", "\\", "|", "/"];
const DELAY = unicode ? 80 : 120;

// Match clack's stop symbols (green ◇, red ■, red ▲)
const S_SUBMIT = unicode ? "◇" : "√";
const S_CANCEL = unicode ? "■" : "×";
const S_ERROR = unicode ? "▲" : "×";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

export interface Spinner {
  start(msg?: string): void;
  stop(msg?: string): void;
  cancel(msg?: string): void;
  error(msg?: string): void;
  message(msg?: string): void;
}

function truncate(text: string, columns: number | undefined): string {
  if (!columns || columns < 8) return text;
  const max = columns - 1;
  if (text.length <= max) return text;
  return max <= 3 ? text.slice(0, max) : `${text.slice(0, max - 3)}...`;
}

export function spinner(output: NodeJS.WriteStream = process.stdout): Spinner {
  if (!output.isTTY) {
    return {
      start(msg = "") {
        if (msg) output.write(`${msg}\n`);
      },
      stop(msg = "") {
        if (msg) output.write(`${msg}\n`);
      },
      cancel(msg = "") {
        if (msg) output.write(`${msg}\n`);
      },
      error(msg = "") {
        if (msg) output.write(`${msg}\n`);
      },
      message(msg = "") {
        if (msg) output.write(`${msg}\n`);
      },
    };
  }

  let frameIndex = 0;
  let indicatorTimer = 0;
  let _message = "";
  let _prevLen = 0;
  let interval: NodeJS.Timeout | undefined;

  const render = () => {
    const frame = FRAMES[frameIndex] ?? FRAMES[0]!;
    frameIndex = (frameIndex + 1) % FRAMES.length;
    const dots = ".".repeat(Math.floor(indicatorTimer)).slice(0, 3);
    indicatorTimer = indicatorTimer < 4 ? indicatorTimer + 0.125 : 0;

    const line = truncate(`${frame}  ${_message}${dots}`, output.columns);
    // Overwrite in place — \r returns to col 0, trailing spaces erase leftover chars.
    // No clearLine() so there is never a blank frame.
    const pad = _prevLen > line.length ? " ".repeat(_prevLen - line.length) : "";
    output.write(`\r${line}${pad}`);
    _prevLen = line.length;
  };

  const finish = (symbol: string, color: string, msg: string | undefined) => {
    if (!interval) return;
    clearInterval(interval);
    interval = undefined;
    removeHooks();
    output.write(`\r${" ".repeat(_prevLen)}\r`);
    output.write(SHOW_CURSOR);
    if (msg) output.write(`${color}${symbol}${RESET}  ${msg}\n`);
  };

  // Restore cursor on exit even if finish() was never called (e.g. uncaught throw)
  const exitHandler = () => {
    output.write(SHOW_CURSOR);
  };

  // On SIGINT: cancel the spinner then re-raise so the process exits with the
  // correct signal code (shell sees it as interrupted, not a normal exit).
  const sigintHandler = () => {
    finish(S_CANCEL, RED, undefined);
    process.kill(process.pid, "SIGINT");
  };

  const registerHooks = () => {
    process.once("exit", exitHandler);
    process.once("SIGINT", sigintHandler);
  };

  const removeHooks = () => {
    process.off("exit", exitHandler);
    process.off("SIGINT", sigintHandler);
  };

  const impl: Spinner = {
    start(msg = "") {
      _message = msg;
      _prevLen = 0;
      frameIndex = 0;
      indicatorTimer = 0;
      registerHooks();
      output.write(HIDE_CURSOR);
      render();
      interval = setInterval(render, DELAY);
    },
    stop(msg = "") {
      finish(S_SUBMIT, GREEN, msg);
    },
    cancel(msg = "") {
      finish(S_CANCEL, RED, msg);
    },
    error(msg = "") {
      finish(S_ERROR, RED, msg);
    },
    message(msg = "") {
      _message = msg;
    },
  };

  return impl;
}
