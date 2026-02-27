export const Hero = () => (
  <>
    <style>{`
      .grind-hero {
        background: radial-gradient(ellipse 80% 55% at 50% -5%, rgba(224,123,53,0.15) 0%, transparent 70%), #f9f6f3;
      }
      .dark .grind-hero {
        background: radial-gradient(ellipse 80% 55% at 50% -5%, rgba(224,123,53,0.22) 0%, transparent 70%), #0a0a0a;
      }
      .grind-hero-grid {
        background-image: linear-gradient(rgba(224,123,53,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(224,123,53,0.1) 1px, transparent 1px);
      }
      .dark .grind-hero-grid {
        background-image: linear-gradient(rgba(224,123,53,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(224,123,53,0.07) 1px, transparent 1px);
      }
      .grind-hero-title {
        color: #0a0a0a;
      }
      .dark .grind-hero-title {
        color: #ffffff;
      }
      .grind-hero-subtitle {
        color: rgba(0,0,0,0.5);
      }
      .dark .grind-hero-subtitle {
        color: rgba(255,255,255,0.5);
      }
      .grind-hero-primary,
      .grind-hero-secondary {
        border-bottom-color: transparent !important;
      }
      .grind-hero-primary:focus-visible,
      .grind-hero-secondary:focus-visible {
        outline: 2px solid #ff6c05;
        outline-offset: 3px;
      }
      .dark .grind-hero-secondary:focus-visible {
        outline-color: #ff7a1f;
      }
      .grind-hero-primary {
        color: #fff;
        background: #ff6c05;
        box-shadow:
          inset 0 1px 0 0 rgba(255,255,255,0.26),
          inset 0 1px 20px rgba(255,255,255,0.16),
          0 0 0 1px #eb6100,
          0 1px 2px rgba(9,9,11,0.08),
          0 2px 4px rgba(9,9,11,0.16);
        border-radius: 10px;
        touch-action: manipulation;
      }
      .grind-hero-primary:hover {
        background: #ff7a1f;
        box-shadow:
          inset 0 1px 0 0 rgba(255,255,255,0.32),
          inset 0 1px 20px rgba(255,255,255,0.22),
          0 0 0 1px #eb6100,
          0 1px 2px rgba(9,9,11,0.08),
          0 2px 4px rgba(9,9,11,0.16);
      }
      .grind-hero-primary:active {
        background: #e06000;
        box-shadow:
          inset 0 2px 6px rgba(0,0,0,0.3),
          inset 0 -1px 0 0 rgba(255,255,255,0.1),
          0 0 0 1px #d45a00;
      }
      .grind-hero-secondary {
        color: white;
        border: 1px solid transparent;
        background:
          linear-gradient(to bottom, #201e25, #323137) border-box padding-box,
          linear-gradient(to bottom, #4b4951, #313036) border-box;
        box-shadow:
          0 0 0 1px #0d0d0d,
          0 2px 4px rgba(0,0,0,0.1);
        border-radius: 10px;
        touch-action: manipulation;
      }
      .grind-hero-secondary:hover {
        background:
          linear-gradient(to bottom, #2a2830, #3c3b42) border-box padding-box,
          linear-gradient(to bottom, #565460, #3b3a40) border-box;
      }
      .grind-hero-secondary:active {
        background:
          linear-gradient(to bottom, #17151b, #232228) border-box padding-box,
          linear-gradient(to bottom, #302e36, #252430) border-box;
        box-shadow:
          inset 0 2px 4px rgba(0,0,0,0.3),
          inset 0 -1px 0 0 rgba(255,255,255,0.04),
          0 0 0 1px #0d0d0d;
      }
    `}</style>
    <div
      className="grind-hero"
      style={{
        position: "relative",
        minHeight: "420px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "5rem 1.5rem 4rem",
        overflow: "hidden",
      }}
    >
      <div
        className="grind-hero-grid"
        style={{
          position: "absolute",
          inset: 0,
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 90% 100% at 50% 0%, black 30%, transparent 90%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 100% at 50% 0%, black 30%, transparent 90%)",
        }}
      />
      <div style={{ position: "relative", zIndex: 1, maxWidth: "680px" }}>
        <p
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: "#E07B35",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            margin: "0 0 1.125rem",
          }}
        >
          Local-first &nbsp;·&nbsp; Encrypted &nbsp;·&nbsp; Yours
        </p>
        <h1
          className="grind-hero-title"
          style={{
            fontSize: "clamp(2.25rem, 5.5vw, 3.75rem)",
            fontWeight: 800,
            lineHeight: 1.1,
            margin: "0 0 1.25rem",
            letterSpacing: "-0.02em",
          }}
        >
          Your Life Is The Game.
        </h1>
        <p
          className="grind-hero-subtitle"
          style={{
            fontSize: "1.1875rem",
            lineHeight: 1.65,
            margin: "0 auto 2.25rem",
            maxWidth: "500px",
          }}
        >
          Turn habits and goals into quests. Earn XP. Build skills. <br />
          Automate your routines with AI.
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: "3rem",
          }}
        >
          <a
            href="/install/index"
            className="grind-hero-primary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.6875rem 1.625rem",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
            }}
          >
            Get started <span style={{ fontSize: "1rem" }}>→</span>
          </a>
          <a
            href="/get-started/what-is-grind"
            className="grind-hero-secondary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.6875rem 1.625rem",
              fontWeight: 600,
              fontSize: "0.9375rem",
              textDecoration: "none",
            }}
          >
            How it works
          </a>
        </div>
      </div>
    </div>
  </>
);
