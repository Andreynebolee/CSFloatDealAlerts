'use strict';

const { rmSync } = require('fs');

for (const p of ['dist', 'release']) {
  try {
    rmSync(p, { recursive: true, force: true });
    console.log('removed:', p);
  } catch (e) {
    console.warn('skip:', p, String(e && e.message ? e.message : e));
  }
}
