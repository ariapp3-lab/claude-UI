/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#EBF3FF',
          100: '#C3DAFF',
          200: '#96BEFF',
          400: '#3B82F6',
          500: '#2563EB',
          600: '#1D4ED8',
          700: '#1E40AF',
          800: '#1E3A8A',
          900: '#172554',
        },
        gray: {
          50:  '#F8F9FA',
          100: '#F1F3F5',
          200: '#E9ECEF',
          300: '#DEE2E6',
          400: '#CED4DA',
          500: '#ADB5BD',
          600: '#6C757D',
          700: '#495057',
          800: '#343A40',
          900: '#212529',
        },
        success: { 50: '#ECFDF5', 500: '#10B981', 600: '#059669', 700: '#047857' },
        warning: { 50: '#FFFBEB', 500: '#F59E0B', 600: '#D97706' },
        danger:  { 50: '#FEF2F2', 500: '#EF4444', 600: '#DC2626' },
        purple:  { 50: '#F5F3FF', 500: '#8B5CF6', 600: '#7C3AED' },
        teal:    { 50: '#F0FDFA', 500: '#14B8A6', 600: '#0D9488' },
        surface: {
          DEFAULT: '#ffffff',
          subtle:  '#F8F9FA',
          muted:   '#F1F3F5',
          border:  '#E9ECEF',
        },
        sidebar: {
          bg:       '#ffffff',
          hover:    '#F8F9FA',
          active:   '#EBF3FF',
          text:     '#6C757D',
          textHigh: '#212529',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.05)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08)',
        panel: '0 8px 24px rgba(0,0,0,0.10)',
      },
    },
  },
  plugins: [],
};
