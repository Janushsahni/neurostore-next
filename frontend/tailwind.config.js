/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: '#030712',
                card: '#0a101d',
                primary: '#00f0ff',
                secondary: '#0f1932',
                muted: '#9ca3af',
                border: 'rgba(100, 160, 255, 0.1)',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                display: ['Space Grotesk', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
