/*
 * Liquid Glass launcher — lógica de navegación.
 *
 * Escrito en ES5 para funcionar en los Chromium antiguos de webOS 3.x/4.x.
 *
 * Claves de rendimiento:
 *  - El DOM se construye una vez (DocumentFragment) y solo se reconstruye al
 *    cambiar favoritas o la lista de apps.
 *  - Las posiciones de las tarjetas se calculan en JS (índice * paso): nunca
 *    se lee offsetLeft/getBoundingClientRect, así que no hay layout forzado.
 *  - Mover el foco solo cambia transforms + una clase en 2 tarjetas.
 *  - El texto del hero y el tinte de fondo se actualizan cuando la
 *    navegación se detiene (debounce), no en cada pulsación.
 *  - La repetición de teclas se limita a un movimiento por frame.
 */
(function () {
  'use strict';

  var SELF_ID = 'com.frxnnk.liquidglass.launcher';

  var TILE_W = 280;
  var TILE_GAP = 28;
  var STEP = TILE_W + TILE_GAP;
  var EDGE = 140;            // margen izquierdo de las filas
  var VISIBLE = 5;           // tarjetas completas visibles por fila
  var ROW_H = 280;
  var HERO_DELAY = 110;      // ms sin moverse antes de actualizar el hero
  var REPEAT_MIN = 85;       // ms mínimos entre movimientos con tecla mantenida

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 461, ESC: 27, BACKSPACE: 8,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406
  };

  // Lista de reserva (navegador de escritorio o sin permisos de Luna).
  var FALLBACK_APPS = [
    { id: 'netflix', title: 'Netflix', bgColor: '#e50914' },
    { id: 'youtube.leanback.v4', title: 'YouTube', bgColor: '#ff0033' },
    { id: 'amazon', title: 'Prime Video', bgColor: '#00a8e1' },
    { id: 'com.disney.disneyplus-prod', title: 'Disney+', bgColor: '#113ccf' },
    { id: 'spotify-beehive', title: 'Spotify', bgColor: '#1db954' },
    { id: 'com.apple.appletv', title: 'Apple TV', bgColor: '#1c1c1e' },
    { id: 'tv.twitch.tv.starshot.lg', title: 'Twitch', bgColor: '#9146ff' },
    { id: 'com.webos.app.discovery', title: 'LG Content Store', bgColor: '#a50034' },
    { id: 'com.webos.app.livetv', title: 'TV en directo', bgColor: '#3a3a5c', systemApp: true },
    { id: 'com.webos.app.inputcommon', title: 'Entradas', bgColor: '#2c4a6e', systemApp: true },
    { id: 'com.webos.app.browser', title: 'Navegador', bgColor: '#2a5d8f', systemApp: true },
    { id: 'com.webos.app.photovideo', title: 'Fotos y vídeos', bgColor: '#7a4fa0', systemApp: true },
    { id: 'com.webos.app.music', title: 'Música', bgColor: '#b0436e', systemApp: true },
    { id: 'com.palm.app.settings', title: 'Ajustes', bgColor: '#4b5563', systemApp: true }
  ];

  // ---------- Estado ----------

  var apps = [];             // [{id, title, icon, color, systemApp, params}]
  var rows = [];             // [{key, label, items, el, track, ring, tiles, index, first}]
  var activeRow = 0;
  var favorites = loadFavorites();
  var hq = loadBool('lg.fx.hq', false) && supportsBackdrop();

  var heroTimer = 0;
  var lastMove = 0;
  var pendingDir = null;

  var $ = function (id) { return document.getElementById(id); };
  var elRows = $('rows');
  var elHeroTitle = $('heroTitle');
  var elHeroSub = $('heroSub');
  var elHeroRow = $('heroRow');
  var elTint = $('bgTint');
  var elToast = $('toast');
  var elClock = $('clock');
  var elFxHint = $('fxHint');

  // ---------- Utilidades ----------

  function storageGet(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function storageSet(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ }
  }
  function loadBool(k, def) {
    var v = storageGet(k);
    return v === null ? def : v === '1';
  }
  function loadFavorites() {
    try { return JSON.parse(storageGet('lg.favorites') || '[]') || []; } catch (e) { return []; }
  }
  function saveFavorites() {
    storageSet('lg.favorites', JSON.stringify(favorites));
  }
  function supportsBackdrop() {
    var s = document.documentElement.style;
    return 'backdropFilter' in s || 'webkitBackdropFilter' in s;
  }
  function translateX(el, x) {
    var v = 'translate3d(' + x + 'px,0,0)';
    el.style.webkitTransform = v;
    el.style.transform = v;
  }
  function translateY(el, y) {
    var v = 'translate3d(0,' + y + 'px,0)';
    el.style.webkitTransform = v;
    el.style.transform = v;
  }

  // Color estable a partir del id para apps sin bgColor.
  function colorFromId(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ',55%,42%)';
  }

  function normalizeColor(c, id) {
    if (!c || typeof c !== 'string') return colorFromId(id);
    c = c.replace(/^\s+|\s+$/g, '');
    // Muchas apps declaran blanco/negro puro como bgColor: queda plano en
    // cristal, así que se sustituye por un color derivado del id.
    if (/^#?(fff|ffffff|000|000000)$/i.test(c)) return colorFromId(id);
    if (/^[0-9a-f]{6}$/i.test(c)) c = '#' + c;
    return c;
  }

  // ---------- Datos ----------

  function setApps(list) {
    var seen = {};
    apps = [];
    for (var i = 0; i < list.length; i++) {
      var lp = list[i];
      if (!lp || !lp.id || lp.id === SELF_ID || seen[lp.launchPointId || lp.id]) continue;
      seen[lp.launchPointId || lp.id] = true;
      apps.push({
        id: lp.id,
        key: lp.launchPointId || lp.id,
        title: lp.title || lp.id,
        icon: lp.largeIcon || lp.icon || '',
        color: normalizeColor(lp.bgColor, lp.id),
        systemApp: !!lp.systemApp,
        params: lp.params || null
      });
    }
  }

  function loadApps(done) {
    Luna.listLaunchPoints(function (lps) {
      setApps(lps.length ? lps : FALLBACK_APPS);
      done();
    }, function () {
      setApps(FALLBACK_APPS);
      done();
    });
  }

  function buildRowModels() {
    var favs = [], user = [], system = [];
    var byKey = {};
    for (var i = 0; i < apps.length; i++) {
      byKey[apps[i].key] = apps[i];
      (apps[i].systemApp ? system : user).push(apps[i]);
    }
    for (var f = 0; f < favorites.length; f++) {
      if (byKey[favorites[f]]) favs.push(byKey[favorites[f]]);
    }

    var models = [];
    if (favs.length) models.push({ key: 'fav', label: 'Favoritas', items: favs });
    if (user.length) models.push({ key: 'apps', label: 'Aplicaciones', items: user });
    if (system.length) models.push({ key: 'system', label: 'Sistema', items: system });
    return models;
  }

  // ---------- Render ----------

  function createTile(app, idx, rowIdx) {
    var tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.left = (EDGE + idx * STEP) + 'px';
    tile.setAttribute('data-row', rowIdx);
    tile.setAttribute('data-idx', idx);

    var bg = document.createElement('div');
    bg.className = 'tile__bg';
    bg.style.background = 'linear-gradient(145deg, ' + app.color + ' 0%, rgba(0,0,0,.35) 140%), ' + app.color;
    tile.appendChild(bg);

    if (app.icon) {
      var img = new Image();
      img.className = 'tile__icon';
      img.decoding = 'async';
      img.alt = '';
      img.onerror = function () {
        // Icono roto: se cambia por el monograma.
        if (img.parentNode) img.parentNode.replaceChild(createMono(app), img);
      };
      img.src = app.icon;
      tile.appendChild(img);
    } else {
      tile.appendChild(createMono(app));
    }

    var shine = document.createElement('div');
    shine.className = 'tile__shine';
    tile.appendChild(shine);

    var label = document.createElement('div');
    label.className = 'tile__label';
    label.textContent = app.title;
    tile.appendChild(label);

    if (favorites.indexOf(app.key) !== -1) {
      var pin = document.createElement('div');
      pin.className = 'tile__pin';
      tile.appendChild(pin);
    }
    return tile;
  }

  function createMono(app) {
    var m = document.createElement('div');
    m.className = 'tile__mono';
    m.textContent = app.title.replace(/[^0-9A-Za-zÀ-ÿ+]/g, '').slice(0, 2) || '•';
    return m;
  }

  function render(keepKey) {
    var models = buildRowModels();
    var frag = document.createDocumentFragment();
    var inner = document.createElement('div');
    inner.className = 'rows__inner';
    frag.appendChild(inner);

    rows = [];
    for (var r = 0; r < models.length; r++) {
      var m = models[r];
      var rowEl = document.createElement('section');
      rowEl.className = 'row';
      rowEl.style.top = (r * ROW_H) + 'px';

      var label = document.createElement('h2');
      label.className = 'row__label';
      label.textContent = m.label;
      rowEl.appendChild(label);

      var vp = document.createElement('div');
      vp.className = 'row__viewport';
      var track = document.createElement('div');
      track.className = 'row__track';
      track.style.width = (EDGE * 2 + m.items.length * STEP) + 'px';

      var tiles = [];
      for (var i = 0; i < m.items.length; i++) {
        var t = createTile(m.items[i], i, r);
        tiles.push(t);
        track.appendChild(t);
      }

      var ring = document.createElement('div');
      ring.className = 'focus-ring';
      track.appendChild(ring);

      vp.appendChild(track);
      rowEl.appendChild(vp);
      inner.appendChild(rowEl);

      rows.push({
        key: m.key, label: m.label, items: m.items,
        el: rowEl, track: track, ring: ring, tiles: tiles,
        index: 0, first: 0
      });
    }

    elRows.innerHTML = '';
    elRows.appendChild(frag);
    rows.inner = inner;

    // Restaurar el foco en la misma app si sigue existiendo.
    var target = findApp(keepKey);
    if (target) {
      activeRow = target.row;
      rows[target.row].index = target.idx;
    }
    if (activeRow >= rows.length) activeRow = Math.max(0, rows.length - 1);

    for (var k = 0; k < rows.length; k++) applyRow(rows[k], false);
    setActiveRow(activeRow);
  }

  function findApp(key) {
    if (!key) return null;
    // Se prefiere la fila no-favoritas para que al desfijar no salte el foco.
    var hit = null;
    for (var r = 0; r < rows.length; r++) {
      for (var i = 0; i < rows[r].items.length; i++) {
        if (rows[r].items[i].key === key) {
          if (rows[r].key !== 'fav') return { row: r, idx: i };
          if (!hit) hit = { row: r, idx: i };
        }
      }
    }
    return hit;
  }

  // ---------- Foco ----------

  // Coloca carril y anillo de una fila. Solo escribe transforms.
  function applyRow(row, animateTile) {
    var n = row.items.length;
    if (!n) return;
    if (row.index >= n) row.index = n - 1;

    if (row.index < row.first) row.first = row.index;
    else if (row.index > row.first + VISIBLE - 1) row.first = row.index - VISIBLE + 1;
    row.first = Math.max(0, Math.min(row.first, Math.max(0, n - VISIBLE)));

    translateX(row.track, -row.first * STEP);

    var ringT = 'translate3d(' + (EDGE + row.index * STEP) + 'px,0,0) scale(1.08)';
    row.ring.style.webkitTransform = ringT;
    row.ring.style.transform = ringT;

    if (animateTile !== false) {
      if (row.focused) row.focused.className = row.focused.className.replace(' is-focused', '');
      row.focused = row.tiles[row.index];
      row.focused.className += ' is-focused';
    } else {
      for (var i = 0; i < row.tiles.length; i++) row.tiles[i].className = 'tile';
      row.focused = row.tiles[row.index];
      row.focused.className = 'tile is-focused';
    }
  }

  function setActiveRow(r) {
    if (!rows.length) return;
    if (rows[activeRow]) rows[activeRow].el.className = 'row';
    activeRow = r;
    rows[r].el.className = 'row is-active';
    // Mantener la fila activa visible: el área muestra dos filas.
    translateY(rows.inner, -Math.max(0, r - 1) * ROW_H);
    scheduleHero();
  }

  function currentApp() {
    var row = rows[activeRow];
    return row ? row.items[row.index] : null;
  }

  function move(dir) {
    var row = rows[activeRow];
    if (!row) return;

    if (dir === 'left' || dir === 'right') {
      var next = row.index + (dir === 'right' ? 1 : -1);
      if (next < 0 || next >= row.items.length) return;
      row.index = next;
      applyRow(row);
      scheduleHero();
      return;
    }

    var target = activeRow + (dir === 'down' ? 1 : -1);
    if (target < 0 || target >= rows.length) return;

    // Al cambiar de fila se busca la tarjeta en la misma posición de pantalla.
    var col = row.index - row.first;
    var dest = rows[target];
    dest.index = Math.min(dest.items.length - 1, dest.first + col);
    applyRow(dest);
    setActiveRow(target);
  }

  // ---------- Hero y tinte ----------

  function scheduleHero() {
    if (heroTimer) clearTimeout(heroTimer);
    heroTimer = setTimeout(updateHero, HERO_DELAY);
  }

  function updateHero() {
    heroTimer = 0;
    var app = currentApp();
    var row = rows[activeRow];
    if (!app || !row) return;
    elHeroRow.textContent = row.label;
    elHeroTitle.textContent = app.title;
    elHeroSub.textContent = (row.index + 1) + ' de ' + row.items.length;
    elTint.style.background = 'radial-gradient(ellipse at 30% 40%, ' + app.color + ' 0%, rgba(0,0,0,0) 70%)';
    if (elTint.className.indexOf('is-on') === -1) elTint.className += ' is-on';
  }

  // ---------- Acciones ----------

  var toastTimer = 0;
  function toast(msg) {
    elToast.textContent = msg;
    elToast.className = 'toast glass is-on';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { elToast.className = 'toast glass'; }, 2200);
  }

  function launchCurrent() {
    var app = currentApp();
    if (!app) return;
    var payload = { id: app.id };
    if (app.params) payload.params = app.params;
    Luna.call('luna://com.webos.applicationManager/launch', payload, null, function (err) {
      toast('No se pudo abrir ' + app.title + (err && err.errorText ? ' — ' + err.errorText : ''));
    });
  }

  function toggleFavorite() {
    var app = currentApp();
    if (!app) return;
    var i = favorites.indexOf(app.key);
    if (i === -1) {
      favorites.push(app.key);
      toast(app.title + ' fijada en favoritas');
    } else {
      favorites.splice(i, 1);
      toast(app.title + ' quitada de favoritas');
    }
    saveFavorites();
    render(app.key);
  }

  function applyFx() {
    document.documentElement.className = hq ? 'fx-hq' : '';
    elFxHint.textContent = hq ? 'Cristal HQ' : '';
  }

  function toggleFx() {
    if (!supportsBackdrop()) {
      toast('Tu TV no soporta desenfoque real; se usa el modo optimizado');
      return;
    }
    hq = !hq;
    storageSet('lg.fx.hq', hq ? '1' : '0');
    applyFx();
    toast(hq ? 'Cristal HQ activado (más consumo de GPU)' : 'Modo optimizado activado');
  }

  // ---------- Entrada ----------

  var DIRS = {};
  DIRS[KEY.LEFT] = 'left';
  DIRS[KEY.RIGHT] = 'right';
  DIRS[KEY.UP] = 'up';
  DIRS[KEY.DOWN] = 'down';

  function flushMove() {
    var d = pendingDir;
    pendingDir = null;
    if (d) move(d);
  }

  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    var dir = DIRS[code];

    if (dir) {
      e.preventDefault();
      var now = Date.now();
      // Pulsaciones sueltas: respuesta inmediata. Tecla mantenida: cadencia
      // limitada y como mucho un movimiento por frame para no encolar trabajo.
      if (!e.repeat) {
        lastMove = now;
        move(dir);
        return;
      }
      if (now - lastMove < REPEAT_MIN) return;
      lastMove = now;
      if (!pendingDir) window.requestAnimationFrame(flushMove);
      pendingDir = dir;
      return;
    }

    switch (code) {
      case KEY.ENTER:
        e.preventDefault();
        if (!e.repeat) launchCurrent();
        break;
      case KEY.YELLOW:
        toggleFavorite();
        break;
      case KEY.BLUE:
        toggleFx();
        break;
      case KEY.BACK:
      case KEY.ESC:
      case KEY.BACKSPACE:
        e.preventDefault();
        Luna.platformBack();
        break;
    }
  }, false);

  // Magic Remote: el puntero enfoca y el clic abre. Delegación en un único
  // listener para no registrar uno por tarjeta.
  function tileFromEvent(e) {
    var n = e.target;
    while (n && n !== elRows) {
      if (n.getAttribute && n.getAttribute('data-idx') !== null) return n;
      n = n.parentNode;
    }
    return null;
  }

  elRows.addEventListener('mouseover', function (e) {
    var t = tileFromEvent(e);
    if (!t) return;
    var r = +t.getAttribute('data-row');
    var i = +t.getAttribute('data-idx');
    if (r === activeRow && rows[r].index === i) return;
    rows[r].index = i;
    // El puntero no debe hacer saltar el carril: solo se mueve si hace falta.
    applyRow(rows[r]);
    if (r !== activeRow) setActiveRow(r); else scheduleHero();
  }, false);

  elRows.addEventListener('click', function (e) {
    if (tileFromEvent(e)) launchCurrent();
  }, false);

  // ---------- Reloj ----------

  var clockTimer = 0;
  function tickClock() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    elClock.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    // Siguiente actualización justo al cambiar de minuto (no cada segundo).
    clockTimer = setTimeout(tickClock, 60000 - d.getSeconds() * 1000 - d.getMilliseconds() + 50);
  }

  function onVisibility() {
    if (document.hidden) {
      if (clockTimer) clearTimeout(clockTimer);
      clockTimer = 0;
    } else {
      tickClock();
      // Al volver puede haber apps nuevas o desinstaladas.
      var app = currentApp();
      loadApps(function () { render(app && app.key); });
    }
  }
  document.addEventListener('visibilitychange', onVisibility, false);
  document.addEventListener('webkitvisibilitychange', onVisibility, false);

  // ---------- Inicio ----------

  applyFx();
  tickClock();
  loadApps(function () { render(); });
})();
