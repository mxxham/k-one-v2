/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#e6f7f7',
          100: '#b2e5e5',
          200: '#80d2d1',
          300: '#4dbfbe',
          400: '#26b1af',
          500: '#026766',
          600: '#025958',
          700: '#014f4e',
          800: '#013d3c',
          900: '#012d2c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
