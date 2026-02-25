import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App";
import { loadTuiContext } from "./lib/context";
import { StoreProvider } from "./lib/store";
import { ThemeProvider } from "./theme/context";

const ctx = await loadTuiContext();

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
  useMouse: true,
});

const root = createRoot(renderer);

const refreshFn: (() => Promise<void>) | null = null;

function render() {
  root.render(
    <ThemeProvider {...(ctx.config.theme ? { initialTheme: ctx.config.theme } : {})}>
      <StoreProvider ctx={ctx}>
        <App onRefresh={async () => refreshFn?.()} />
      </StoreProvider>
    </ThemeProvider>,
  );
}

render();

renderer.on("destroy", () => {
  ctx.close();
});
