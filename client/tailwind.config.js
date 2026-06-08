/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0f0f10',
        surface: '#16181d',
        border: 'rgba(255,255,255,0.08)',
        accent: '#a78bfa',
        'accent-dim': '#7c3aed',
        muted: '#8b95a8',
        positive: '#4ade80',
        warning: '#fbbf24',
        danger: '#f87171',
        teal: '#55e7fc',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
