/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
        },
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#f8fafc',
          muted:  '#f1f5f9',
          border: '#e2e8f0',
        },
        sidebar: {
          bg:       '#0f172a',
          hover:    '#1e293b',
          active:   '#1e3a5f',
          text:     '#94a3b8',
          textHigh: '#e2e8f0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / .07), 0 1px 2px -1px rgb(0 0 0 / .07)',
        'card-hover': '0 4px 12px 0 rgb(0 0 0 / .10)',
        panel: '0 0 0 1px rgb(0 0 0 / .06), 0 2px 8px 0 rgb(0 0 0 / .06)',
      },
    },
  },
  plugins: [],
};
