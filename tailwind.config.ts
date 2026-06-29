import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand accent — used sparingly for primary actions and active state.
        brand: {
          50: "#ecfeff",
          100: "#cffafe",
          200: "#a5f3fc",
          500: "#06b6d4",
          600: "#0891b2",
          700: "#0e7490",
        },
      },
      fontFamily: {
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        label: "0",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        raised: "0 4px 12px -2px rgba(16, 24, 40, 0.08), 0 2px 6px -3px rgba(16, 24, 40, 0.07)",
        pop: "0 12px 32px -8px rgba(16, 24, 40, 0.18), 0 4px 10px -4px rgba(16, 24, 40, 0.1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "bar-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out both",
        "pulse-soft": "pulse-soft 1.4s ease-in-out infinite",
        "bar-indeterminate": "bar-indeterminate 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
