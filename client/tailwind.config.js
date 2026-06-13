/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0e0c09',
        surface: '#17140f',
        border: 'rgba(255,255,255,0.08)',
        accent: '#fbbf24',
        'accent-dim': '#f59e0b',
        muted: '#8b95a8',
        positive: '#4ade80',
        warning: '#fbbf24',
        danger: '#f87171',
        teal: '#fb923c',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
