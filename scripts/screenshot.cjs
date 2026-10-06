'use strict';
// Скриншоты интерфейса для README: npm run screenshot
//
// Окно грузится БЕЗ preload, поэтому window.api не объявлен и подхватывается
// dev-mock.js с демо-данными. Снимок получается воспроизводимым и не содержит
// ни реального ключа, ни чужих ников из живой ленты.

const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'docs');
const WIDTH = 1180;

// tab — раздел бокового меню, pane — подраздел настроек.
const SHOTS = [
  { name: 'alerts', tab: 'alerts', height: 800 },
  { name: 'journal', tab: 'journal', height: 720 },
  { name: 'filters', tab: 'settings', pane: 'filters', height: 820 },
  { name: 'dry-run', tab: 'settings', pane: 'dry', height: 820, before: "document.getElementById('dryRunBtn').click()", scrollTo: '#dryResult' },
  { name: 'autobuy', tab: 'settings', pane: 'autobuy', height: 820 }
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(win, shot) {
  await win.webContents.executeJavaScript(`
    document.querySelector('.nav-item[data-tab="${shot.tab}"]').click();
    ${shot.pane ? `document.querySelector('.subnav-item[data-pane="${shot.pane}"]').click();` : ''}
    ${shot.before ? shot.before + ';' : ''}
    true;
  `);
  // Даём отработать обработчику и анимациям (карточки — 0.5с).
  await wait(900);

  await win.webContents.executeJavaScript(`
    (() => {
      const scroll = document.getElementById('scroll');
      ${shot.scrollTo
        ? `document.querySelector('${shot.scrollTo}').scrollIntoView({ block: 'start' }); scroll.scrollTop -= 90;`
        : 'scroll.scrollTop = 0;'}
      return true;
    })();
  `);
  await wait(400);

  const image = await win.webContents.capturePage();
  writeFileSync(join(OUT, `${shot.name}.png`), image.toPNG());
  console.log(`written: docs/${shot.name}.png`);
}

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true });

  const win = new BrowserWindow({
    width: WIDTH,
    height: 800,
    show: false,
    backgroundColor: '#0a0712',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  await win.loadFile(join(ROOT, 'app', 'renderer', 'index.html'));
  await wait(800);

  for (const shot of SHOTS) {
    win.setContentSize(WIDTH, shot.height);
    await wait(300);
    await shoot(win, shot);
  }

  app.quit();
});
