module.exports = {
  content: ['./app.jsx', './index.html'],
  darkMode: 'class',
  theme: { extend: {
    colors: {
      cream: '#F7F3EA', 'cream-line': '#E7E0CE', ink: '#241F16', muted: '#8A8271',
      forest: '#1F3D2B', 'forest-light': '#2F5540', 'forest-soft': '#E4EEE3', 'forest-soft-text': '#1F3D2B',
      gold: '#C9973B', 'gold-light': '#E8C77E', terracotta: '#B3532B',
      'pending-bg': '#F3E4C4', 'pending-text': '#8A5A17',
      'transit-bg': '#EDE7D6', 'transit-text': '#5A5033',
    },
    fontFamily: { display: ['Fraunces', 'serif'], sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] },
    spacing: { '4.5': '1.125rem' },
  } },
};
