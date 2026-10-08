// Gera vendor/tailwind.css. Rodar na raiz do repositório:
//   npx tailwindcss@3 -c dev/tailwind.config.js -i dev/in.css -o vendor/tailwind.css --minify
const cor = (v) => `rgb(var(--c-${v}) / <alpha-value>)`;
module.exports = {
  content: ['./app.jsx', './index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: cor('bg'), surface: cor('surface'), surface2: cor('surface2'), line: cor('line'),
        ink: cor('ink'), muted: cor('muted'), brand: cor('brand'), brandink: cor('brandink'), onbrand: cor('onbrand'),
        hero: cor('hero'), gold: cor('gold'), ongold: cor('ongold'), danger: cor('danger'),
        'rota-bg': cor('rota-bg'), 'rota-fg': cor('rota-fg'),
        'pagar-bg': cor('pagar-bg'), 'pagar-fg': cor('pagar-fg'),
        'pago-bg': cor('pago-bg'), 'pago-fg': cor('pago-fg'),
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        entrar: { '0%': { opacity: '0', transform: 'translateY(-8px) scale(0.98)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: { entrar: 'entrar 180ms ease-out' },
    },
  },
};
