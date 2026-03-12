import type { Config } from "tailwindcss";

export default {
  content: ["./panel/**/*.{html,tsx,ts}", "./src/**/*.{tsx,ts}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f4ff",
          100: "#dce6ff",
          500: "#4f6ef7",
          600: "#3d5ce8",
          700: "#2d4ad0",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
