/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "primary": "var(--brand-primary, #001e40)",
        "primary-container": "var(--brand-primary-container, #003366)",
        "highlight": "var(--brand-highlight, #001e40)",
        "highlight-container": "var(--brand-highlight-container, #003366)",
        "on-highlight": "var(--brand-on-highlight, #ffffff)",
        "secondary": "var(--brand-secondary, #0059bb)",
        "secondary-container": "var(--brand-secondary-container, #0070ea)",
        "background": "#f8f9ff",
        "surface": "#f8f9ff",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#eff4ff",
        "surface-container": "#e5eeff",
        "surface-container-high": "#dce9ff",
        "surface-container-highest": "#d3e4fe",
        "outline-variant": "#c3c6d1",
        "outline": "#737780",
        "on-surface": "#0b1c30",
        "on-surface-variant": "#43474f",
        "error": "#ba1a1a",
        "error-container": "#ffdad6",
        "on-error": "#ffffff",
        "on-primary": "#ffffff",
        "on-secondary": "#ffffff",
        "on-tertiary": "#ffffff",
        "tertiary": "#381300",
        "tertiary-container": "#592300",
        "on-tertiary-container": "#d8885c"
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "0.75rem"
      },
      fontFamily: {
        geist: ["Geist", "sans-serif"],
        inter: ["Inter", "sans-serif"]
      }
    },
  },
  plugins: [],
}
