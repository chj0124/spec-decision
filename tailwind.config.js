/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        // 清新薄荷绿风（参考 Laper）
        ink: '#0d1f14',          // 极深绿（暗色模式底）
        panel: '#ffffff',        // 面板白
        edge: '#d9efe2',         // 浅绿边框
        brand: {
          DEFAULT: '#16a34a',    // 主翠绿
          strong: '#15803d',     // 深翠绿（标题/强调）
          deep: '#14532d',       // 墨绿（标题文字）
          soft: '#dcfce7',       // 浅绿底
          mist: '#f0fdf4',       // 极浅绿（背景）
        },
        cyan: {
          glow: '#16a34a',       // 兼容旧类名 → 映射为翠绿
        },
      },
      boxShadow: {
        glow: '0 4px 24px rgba(22, 163, 74, 0.15)',
        card: '0 4px 24px rgba(20, 83, 45, 0.08)',
        soft: '0 1px 3px rgba(20, 83, 45, 0.06)',
      },
    },
  },
  plugins: [],
}
