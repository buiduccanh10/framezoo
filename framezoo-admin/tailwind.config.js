/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Avenir Next"', '"Helvetica Neue"', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        background: '#090b0d',
      }
    },
  },
  plugins: [],
}
