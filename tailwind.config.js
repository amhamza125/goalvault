/** @type {import('tailwindcss').Config} */
// GoalVault theme — "vault board": deep pine green + brushed gold, dark
// only. Display type is Fraunces (heavy serif, engraved-plate feel), body
// is Outfit, numbers are IBM Plex Mono with tabular figures.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        pine: {
          950: "#061a13", // page background
          900: "#0a2e22", // hero / raised vault surface
          850: "#0d3628",
          800: "#11402f", // card surface
          700: "#17573e",
          600: "#1f7050",
          500: "#2b8a64",
          300: "#7fc7a8",
          200: "#a9dcc4",
          100: "#d3efe0",
        },
        gold: {
          600: "#a5811d",
          500: "#c9a227", // primary accent
          400: "#e0bc45",
          300: "#e8c85a", // bright gold for numbers
          200: "#f3dd8f",
        },
        cream: "#f2ecd9", // primary text
        sage: "#9db8a9", // secondary text
        line: "rgba(201, 162, 39, 0.22)",
        lineSoft: "rgba(242, 236, 217, 0.09)",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        body: ["Outfit", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        vault: "0 1px 0 rgba(232,200,90,0.08) inset, 0 18px 40px rgba(0,0,0,0.45)",
        card: "0 10px 28px rgba(0,0,0,0.38)",
        goldline: "0 0 0 1px rgba(201,162,39,0.35)",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        tickPulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-up": "fadeUp 0.5s ease both",
        "tick-pulse": "tickPulse 1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
