import type { APIRoute, GetStaticPaths } from "astro";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const TITLE_LINE_1 = "Your Life Is The Game.";
const TITLE_LINE_2 = "Level Up For Real.";
const WORDMARK = "G R I N D";
const MOTIFS = ["Quests", "XP", "Skills", "Streaks"];
const XP_PERCENT = 74;

const WIDTH = 1200;
const HEIGHT = 630;

const BG = "#0d0d12";
const BG_LIGHT = "#151520";
const ORANGE = "#FF6C02";
const WHITE = "#f0f0f0";
const MUTED = "#8585a0";
const BAR_TRACK = "#1c1c28";

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  return res.arrayBuffer();
}

let _fonts: Awaited<ReturnType<typeof initFonts>> | undefined;
async function initFonts() {
  // satori needs ttf/otf/woff — not woff2. Fontsource only ships woff2,
  // so fetch ttf from Google Fonts CDN at build time.
  const [geist, mono] = await Promise.all([
    fetchFont("https://cdn.jsdelivr.net/fontsource/fonts/geist-sans@latest/latin-500-normal.ttf"),
    fetchFont(
      "https://cdn.jsdelivr.net/fontsource/fonts/jetbrains-mono@latest/latin-400-normal.ttf",
    ),
  ]);
  return [
    { name: "Geist", data: geist, weight: 500 as const },
    { name: "JetBrains Mono", data: mono, weight: 400 as const },
  ];
}

// satori accepts plain vnode objects — cast to satisfy TS
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VNode = any;

function dotGrid(): VNode[] {
  const dots: VNode[] = [];
  const spacing = 24;
  const cols = Math.ceil(WIDTH / spacing);
  const rows = Math.ceil(HEIGHT / spacing);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dots.push({
        type: "div",
        props: {
          key: `${r}-${c}`,
          style: {
            position: "absolute" as const,
            left: c * spacing + 12,
            top: r * spacing + 12,
            width: 2,
            height: 2,
            borderRadius: 1,
            backgroundColor: "rgba(255,255,255,0.07)",
          },
        },
      });
    }
  }
  return dots;
}

function render() {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        width: WIDTH,
        height: HEIGHT,
        background: `linear-gradient(135deg, ${BG} 0%, ${BG_LIGHT} 100%)`,
        position: "relative" as const,
        overflow: "hidden",
      },
      children: [
        // Dot grid
        {
          type: "div",
          props: {
            style: {
              position: "absolute" as const,
              inset: 0,
              display: "flex",
            },
            children: dotGrid(),
          },
        },
        // Radial orange glow
        {
          type: "div",
          props: {
            style: {
              position: "absolute" as const,
              left: "30%",
              top: "20%",
              width: 600,
              height: 400,
              borderRadius: 300,
              background: `radial-gradient(ellipse, rgba(255,108,2,0.06) 0%, transparent 70%)`,
            },
          },
        },
        // Orange left border
        {
          type: "div",
          props: {
            style: {
              position: "absolute" as const,
              left: 0,
              top: 0,
              bottom: 0,
              width: 10,
              background: ORANGE,
            },
          },
        },
        // Content
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column" as const,
              justifyContent: "center",
              padding: "60px 80px 60px 60px",
              marginLeft: 10,
              position: "relative" as const,
              flex: 1,
              gap: 0,
            },
            children: [
              // Wordmark
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "JetBrains Mono",
                    fontSize: 18,
                    letterSpacing: "0.25em",
                    color: MUTED,
                    marginBottom: 14,
                  },
                  children: WORDMARK,
                },
              },
              // Orange rule
              {
                type: "div",
                props: {
                  style: {
                    width: 72,
                    height: 3,
                    backgroundColor: ORANGE,
                    borderRadius: 2,
                    marginBottom: 28,
                  },
                },
              },
              // Title line 1
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Geist",
                    fontSize: 64,
                    fontWeight: 500,
                    color: WHITE,
                    lineHeight: 1.12,
                    letterSpacing: "-0.02em",
                  },
                  children: TITLE_LINE_1,
                },
              },
              // Title line 2
              {
                type: "div",
                props: {
                  style: {
                    fontFamily: "Geist",
                    fontSize: 64,
                    fontWeight: 500,
                    color: ORANGE,
                    lineHeight: 1.12,
                    letterSpacing: "-0.02em",
                    marginBottom: 32,
                  },
                  children: TITLE_LINE_2,
                },
              },
              // Motif row
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    gap: 28,
                    marginBottom: 20,
                  },
                  children: MOTIFS.map((label) => ({
                    type: "div",
                    props: {
                      key: label,
                      style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontFamily: "JetBrains Mono",
                        fontSize: 16,
                        color: MUTED,
                      },
                      children: [
                        {
                          type: "svg",
                          props: {
                            width: 10,
                            height: 10,
                            viewBox: "0 0 10 10",
                            children: {
                              type: "polygon",
                              props: {
                                points: "5,0 10,5 5,10 0,5",
                                fill: ORANGE,
                              },
                            },
                          },
                        },
                        label,
                      ],
                    },
                  })),
                },
              },
              // XP bar
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          width: 320,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: BAR_TRACK,
                          display: "flex",
                          overflow: "hidden",
                        },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: {
                                width: `${XP_PERCENT}%`,
                                height: "100%",
                                borderRadius: 5,
                                background: `linear-gradient(90deg, ${ORANGE}, #ff8a33)`,
                              },
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          fontFamily: "JetBrains Mono",
                          fontSize: 15,
                          color: MUTED,
                        },
                        children: `${XP_PERCENT}%`,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

export const getStaticPaths = (() => {
  return [{ params: { route: "index.png" } }];
}) satisfies GetStaticPaths;

export const GET: APIRoute = async () => {
  const fonts = (_fonts ??= await initFonts());

  const svg = await satori(render() as VNode, {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
  });
  const png = new Uint8Array(resvg.render().asPng());

  return new Response(png, {
    headers: { "Content-Type": "image/png" },
  });
};
