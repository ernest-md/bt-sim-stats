(() => {
  const files = [
    'Cape.png',
    'Charko.png',
    'Cojinho.png',
    'Colecta.png',
    'Coquito.png',
    'DavidVaz.png',
    'Daword.png',
    'Dilix.png',
    'DrYemo.png',
    'Ernest.png',
    'Ezelpro.png',
    'Guitarzoom.png',
    'Humano.png',
    'Isaac.png',
    'Joselu.png',
    'Lenox.png',
    'Noke.png',
    'Renku.png',
    'Romo.png',
    'Semidimoni.png',
    'Sicari.png',
    'StTrainer.png',
    'VainaLoca.png',
    'Xavisu.png',
    'Yago.png',
    'Zhork.png'
  ];

  const normalizePortraitKey = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  const generated = {};
  files.forEach((file) => {
    const stem = file.replace(/\.[^.]+$/, '');
    const key = normalizePortraitKey(stem);
    if (key) generated[key] = `fantasy/${file}`;
  });

  generated.ezeelpro = 'fantasy/Ezelpro.png';
  generated.ezelpro = 'fantasy/Ezelpro.png';

  window.BarateamFantasyPortraitPlaceholder = 'fantasy_placeholder.jpeg';
  window.BarateamFantasyPortraits = Object.assign({}, generated, window.BarateamFantasyPortraits || {});
})();
