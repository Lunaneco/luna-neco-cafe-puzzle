import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import '../src/round.js';
const source = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const translations = html.match(/<script id="ui-texts" type="application\/json">([\s\S]*?)<\/script>/)[1];
function boot({ storageBlocked = false, saved = {}, language = 'ja', search = '', webAudio = false, deferredMedia = false, api = {} } = {}) {
  const nodes = new Map();
  const stored = new Map(Object.entries(saved));
  const listeners = { document: new Map(), window: new Map() };
  const addListener = target => (event, callback) => {
    if (!listeners[target].has(event)) listeners[target].set(event, []);
    listeners[target].get(event).push(callback);
  };
  let focused = true;
  const timers = new Map();
  let timerId = 0;
  const playingRequests = [];
  const makeNode = () => ({
    style: {}, value: '', textContent: '', innerText: '', children: [], attrs: {}, handlers: {},
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(event, callback) { this.handlers[event] = callback; },
    click() { return this.handlers.click?.({}); },
    focus() {},
  });
  const document = {
    hidden: false,
    hasFocus: () => focused,
    documentElement: {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    createElement: makeNode,
    addEventListener: addListener('document'),
  };
  document.getElementById('ui-texts').textContent = translations;
  let now = 1_000_000;
  const drawScales = [];
  const p = new Proxy({
    windowWidth: 390, windowHeight: 844,
    color: () => ({ setAlpha() {} }),
    scale: value => drawScales.push(value),
    createCanvas: () => ({ parent() {}, elt: { addEventListener() {} } }),
  }, {
    get(target, key) { return target[key] ?? (() => {}); },
  });
  const context = vm.createContext({
    LunaRound: globalThis.LunaRound,
    LunaLeaderboard: class {
      list() { return api.list ? api.list() : Promise.resolve({ entries: [] }); }
      begin() { return api.begin ? api.begin() : Promise.resolve({ seed: 123, token: 'test' }); }
      submit(body) { return api.submit ? api.submit(body) : Promise.resolve({ entries: [{ id: 'r1', rank: 1, name: body.name, score: body.score }], entry: { id: 'r1', rank: 1, name: body.name, score: body.score } }); }
    },
    document, URLSearchParams, location: { search }, navigator: { language },
    window: {
      addEventListener: addListener('window'),
      AudioContext: webAudio ? class {
        state = 'running'; currentTime = 0; destination = {};
        suspend() { this.state = 'suspended'; return Promise.resolve(); }
        resume() { this.state = 'running'; return Promise.resolve(); }
        createOscillator() {
          return {
            frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect() {}, disconnect() {}, start() {}, stop() {},
          };
        }
        createGain() {
          return { connect() {}, disconnect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
        }
      } : undefined,
    }, console,
    Date: class extends Date { static now() { return now; } },
    localStorage: {
      getItem(key) { if (storageBlocked) throw Error('Storage unavailable'); return stored.get(key) ?? null; },
      setItem(key, value) { if (storageBlocked) throw Error('Storage unavailable'); stored.set(key, value); },
    },
    Audio: class {
      currentTime = 0; paused = true;
      play() {
        if (deferredMedia) return new Promise(resolve => playingRequests.push(() => { this.paused = false; resolve(); }));
        this.paused = false;
        return Promise.resolve();
      }
      pause() { this.paused = true; }
    },
    p5: function (sketch) { sketch(p); },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  const run = script => vm.runInContext(script, context);
  run(source);
  return {
    run, nodes, stored, p, document, timers, playingRequests, drawScales,
    focus: value => { focused = value; },
    emit: (target, event) => listeners[target].get(event)?.forEach(callback => callback()),
    advance: milliseconds => { now += milliseconds; },
  };
}
function board(game, type = 0) {
  game.run(`startGame(); grid.flat().forEach(b => { b.type = ${type}; b.pixelX = b.targetX; b.pixelY = b.targetY; });`);
}

test('starts the original 8 × 13 board and 60-second round', () => {
  const g = boot(); g.run('startGame()');
  assert.equal(g.run('grid.length'), 8);
  assert.equal(g.run('grid.flat().length'), 104);
  assert.ok(g.run('grid.flat().every(b => b.type >= 0 && b.type < 5)'));
  assert.equal(g.run('timeLeft'), 60);
  assert.equal(g.run('score'), 0);
});

test('two orthogonally connected tiles score 40 and the board refills', () => {
  const g = boot(); board(g, 2);
  g.run('grid[0][0].type = grid[0][1].type = 0; handleTap(0, 0)');
  assert.equal(g.run('score'), 40);
  assert.equal(g.run('grid.flat().filter(Boolean).length'), 104);
  assert.ok(g.run('grid.every((column, c) => column.every((b, r) => b.col === c && b.row === r && b.targetY === START_Y + r * BLOCK_SIZE))'));
});

test('diagonal matches and single tiles do not clear', () => {
  const g = boot(); board(g, 2);
  g.run('grid[0][0].type = grid[1][1].type = 0; handleTap(0, 0)');
  assert.equal(g.run('score'), 0);
  assert.equal(g.run('grid[0][0].type'), 0);
});

for (const [type, special] of [[0,7], [1,7], [2,7], [3,6], [4,5]]) {
  test(`10 tiles of type ${type} award 1000 and spawn special ${special}`, () => {
    const g = boot(); board(g, (type + 1) % 5);
    g.run(`for (let c=0;c<8;c++) grid[c][0].type=${type}; grid[0][1].type=grid[1][1].type=${type}; handleTap(0,0);`);
    assert.equal(g.run('score'), 1000);
    assert.equal(g.run(`grid.flat().filter(b => b.type === ${special}).length`), 1);
    assert.equal(g.run('grid.flat().filter(Boolean).length'), 104);
  });
}

test('Luna adds exactly 10 seconds to the round', () => {
  const g = boot(); board(g);
  g.run('grid[0][0].type=5; handleTap(0,0)');
  assert.equal(g.run('timeLeft'), 70);
  g.advance(65000); g.p.draw();
  assert.equal(g.run('timeLeft'), 5);
  assert.equal(g.run('gameState'), 'PLAYING');
});

test('Tsukineco doubles scores for 20 seconds, then expires', () => {
  const g = boot(); board(g, 2);
  g.run('grid[0][0].type=6; handleTap(0,0); grid[0][11].type=grid[0][12].type=0; handleTap(0,12)');
  assert.equal(g.run('score'), 80);
  g.advance(20001);
  g.run('grid.flat().forEach(b => b.type=2); grid[0][11].type=grid[0][12].type=0; handleTap(0,12)');
  assert.equal(g.run('score'), 120);
});

test('Mochi converts the chosen normal type to type 1', () => {
  const g = boot(); board(g, 0);
  g.run('grid[0][0].type=7; const originals=grid.flat().filter(b=>b.type===0); handleTap(0,0)');
  assert.ok(g.run('originals.every(b => b.type===1 && b.whiteFlash===255)'));
  assert.equal(g.run('score'), 0);
});

test('no-move board ends the round and special tiles keep it playable', () => {
  const g = boot(); board(g);
  g.run('grid.flat().forEach(b => b.type=(b.col+b.row)%5); checkEndCondition()');
  assert.equal(g.run('pendingResult'), 'gameover');
  g.run('pendingResult=null; grid[0][0].type=5; checkEndCondition()');
  assert.equal(g.run('pendingResult'), null);
});

test('the deadline rejects scores and time bonuses before the next frame', () => {
  const g = boot(); board(g);
  g.advance(60000);
  g.run('grid[0][0].type=5; handleTap(0,0)');
  assert.equal(g.run('pendingResult'), 'timeup');
  assert.equal(g.run('startTime'), 1_000_000);
  assert.equal(g.run('score'), 0);
  g.p.draw();
  assert.equal(g.run('gameState'), 'GAMEOVER');
  assert.equal(g.nodes.get('result-overlay').style.display, 'flex');
});

test('retry resets time, points, effects, particles, and result state', () => {
  const g = boot(); board(g);
  g.run("score=1234; timeLeft=0; scoreMultiplierEndTime=9999999; pendingResult='timeup'; particles.push({}); startGame()");
  assert.equal(g.run('score'), 0);
  assert.equal(g.run('timeLeft'), 60);
  assert.equal(g.run('scoreMultiplierEndTime'), 0);
  assert.equal(g.run('particles.length'), 0);
  assert.equal(g.run('pendingResult'), null);
  assert.equal(g.nodes.get('result-overlay').style.display, 'none');
});

test('out-of-bounds, ready-state, and finished-state taps are ignored', () => {
  const g = boot();
  assert.doesNotThrow(() => g.run('handleTap(0,0)'));
  board(g);
  assert.doesNotThrow(() => g.run('handleTap(-1,0); handleTap(8,13)'));
  g.run("gameState='GAMEOVER'; handleTap(0,0)");
  assert.equal(g.run('score'), 0);
});

test('rankings come from the shared service and ignore old device rankings', async () => {
  const g = boot({ saved: { luna_neco_ranking_v1: '[{"name":"old","score":9999}]' },
    api: { list: async () => ({ entries: [{ id: 'a', name: '全国の猫', score: 500, rank: 1 }] }) } });
  await g.run("refreshRanking('result-ranking')");
  const rows = g.nodes.get('result-ranking').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[1].children[1].textContent, '全国の猫');
});

test('names render as literal text and concurrent duplicate submission is ignored', async () => {
  let sends = 0;
  const g = boot({ api: { submit: async body => {
    sends++;
    return { entries: [{ id: 'a', rank: 1, name: body.name, score: body.score }], entry: { rank: 1, name: body.name } };
  } } });
  g.run("startGame({seed:1,token:'test'}); score=100; showResult('msg.timeup')");
  g.nodes.get('player-name-input').value = '<b>猫</b>';
  await Promise.all([g.nodes.get('submit-score-btn').click(), g.nodes.get('submit-score-btn').click()]);
  await g.nodes.get('submit-score-btn').click();
  assert.equal(sends, 1);
  assert.equal(g.nodes.get('result-ranking').children[1].children[1].textContent, '<b>猫</b>');
  assert.match(g.nodes.get('submission-status').textContent, /1/);
});

test('a failed score submission can be retried with the same round token', async () => {
  const bodies = [];
  const g = boot({ api: { submit: async body => {
    bodies.push(body);
    if (bodies.length === 1) throw Error('unavailable');
    return { entries: [], entry: { rank: 101, name: body.name } };
  } } });
  g.run("startGame({seed:1,token:'same-round'}); score=100; showResult('msg.timeup')");
  await g.nodes.get('submit-score-btn').click();
  assert.equal(g.nodes.get('submit-score-btn').disabled, false);
  assert.equal(g.nodes.get('name-entry-container').style.display, 'block');
  await g.nodes.get('submit-score-btn').click();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].token, bodies[1].token);
  assert.match(g.nodes.get('submission-status').textContent, /101/);
});

test('a stale leaderboard response cannot replace the submitted rank', async () => {
  let complete;
  const g = boot({ api: { list: () => new Promise(resolve => { complete = resolve; }) } });
  g.run("startGame({seed:1,token:'test'}); score=100; showResult('msg.timeup')");
  await g.nodes.get('submit-score-btn').click();
  complete({ entries: [{ rank: 1, name: 'stale', score: 10 }] });
  await new Promise(setImmediate);
  assert.equal(g.nodes.get('result-ranking').children[1].children[1].textContent, '名無し');
});

test('offline rounds remain playable and are explicitly excluded from national scores', async () => {
  const g = boot({ storageBlocked: true, api: { begin: async () => { throw Error('offline'); }, list: async () => { throw Error('offline'); } } });
  await g.run('prepareGame()');
  assert.equal(g.run('gameState'), 'PLAYING');
  assert.equal(g.run('roundSession'), null);
  g.run("score=100; showResult('msg.timeup')");
  assert.equal(g.nodes.get('name-entry-container').style.display, 'none');
  assert.match(g.nodes.get('submission-status').textContent, /練習/);
  await new Promise(setImmediate);
  assert.match(g.nodes.get('result-ranking').children[1].textContent, /通信/);
});

test('browser moves match server replay including refills and all special effects', () => {
  const specialTypes = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const g = boot(); g.run(`startGame({seed:${seed},token:'test'})`);
    for (let turn = 0; turn < 150; turn++) {
      g.advance(250);
      if (g.run('Date.now() - startTime >= 60000 || !!pendingResult')) break;
      // Prefer special tiles, otherwise the largest connected group.
      const coords = g.run(`(() => {
        let best=[0,0], size=0;
        for (let c=0;c<8;c++) for (let r=0;r<13;r++) {
          if (grid[c][r].type>=5) return [c,r];
          const seen=new Set(), stack=[[c,r]], type=grid[c][r].type;
          while(stack.length) { const [x,y]=stack.pop(), k=x*13+y;
            if(x<0||x>7||y<0||y>12||seen.has(k)||grid[x][y].type!==type) continue;
            seen.add(k); stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]); }
          if(seen.size>size) { best=[c,r]; size=seen.size; }
        }
        return best;
      })()`);
      const type = g.run(`grid[${coords[0]}][${coords[1]}].type`);
      if (type >= 5) specialTypes.add(type);
      g.run(`handleTap(${coords[0]},${coords[1]})`);
      const replay = g.run('LunaRound.replay(roundSession.seed,roundActions,Date.now()-roundStarted)');
      assert.equal(replay.score, g.run('score'));
      assert.equal(JSON.stringify(replay.grid), g.run('JSON.stringify(grid.map(col=>col.map(b=>b.type)))'));
      assert.equal(replay.deadline, g.run('startTime-roundStarted+60000'));
    }
  }
  assert.deepEqual([...specialTypes].sort(), [5,6,7]);
});

test('language URL overrides browser language and unsupported languages fall back', () => {
  assert.equal(boot({ language: 'en', search: '?lang=ja' }).run("t('ui.start')"), 'スタート');
  assert.equal(boot({ language: 'fr' }).run("t('ui.start')"), 'スタート');
  for (const lang of ['ja','en','zh','ko','es','pt']) {
    assert.notEqual(boot({ search: `?lang=${lang}` }).run("t('msg.timeup')"), 'msg.timeup');
  }
});

test('tab hiding stops all media, active synth effects, and scheduled sounds', () => {
  const g = boot({ webAudio: true }); board(g);
  g.run('playMedia(runa1Voice); audio.playPop(3); audio.playClear()');
  assert.equal(g.run('bgm.paused'), false);
  assert.equal(g.run('audio.voices.size'), 1);
  assert.equal(g.timers.size, 4);
  g.document.hidden = true;
  g.emit('document', 'visibilitychange');
  assert.ok(g.run('media.every(sound => sound.paused && sound.muted)'));
  assert.equal(g.run('audio.ctx.state'), 'suspended');
  assert.equal(g.run('audio.voices.size'), 0);
  assert.equal(g.timers.size, 0);
  g.run('audio.playOver(); playMedia(tsukinecoVoice)');
  assert.equal(g.run('audio.voices.size'), 0);
  assert.ok(g.run('media.every(sound => sound.paused)'));
});

test('leaving the browser window silences audio even while the page is visible', () => {
  const g = boot(); board(g);
  g.focus(false);
  g.emit('window', 'blur');
  assert.equal(g.document.hidden, false);
  assert.equal(g.run('bgm.paused'), true);
  g.focus(true);
  g.emit('window', 'focus');
  assert.equal(g.run('bgm.paused'), false);
  assert.ok(g.run('media.slice(1).every(sound => sound.paused)'));
});

test('visibility and focus events resume BGM only when both are active', () => {
  const g = boot(); board(g);
  g.run('bgm.currentTime=12; playMedia(runa1Voice)');
  g.focus(false);
  g.document.hidden = true;
  g.emit('window', 'blur');
  g.emit('document', 'visibilitychange');
  g.document.hidden = false;
  g.emit('document', 'visibilitychange');
  assert.equal(g.run('bgm.paused'), true);
  g.focus(true);
  g.emit('window', 'focus');
  assert.equal(g.run('bgm.paused'), false);
  assert.equal(g.run('bgm.currentTime'), 12);
  assert.equal(g.run('runa1Voice.paused'), true);
});

test('pagehide stops audio and pageshow preserves a saved mute setting', () => {
  const g = boot(); board(g);
  g.emit('window', 'pagehide');
  assert.ok(g.run('media.every(sound => sound.paused)'));
  g.nodes.get('sound-btn').click();
  g.emit('window', 'pageshow');
  assert.ok(g.run('media.every(sound => sound.paused && sound.muted)'));
  assert.equal(g.stored.get('luna_neco_muted'), 'true');
});

test('returning after the round expired cannot restart BGM', () => {
  const g = boot(); board(g);
  g.emit('window', 'pagehide');
  g.advance(61000);
  g.emit('window', 'pageshow');
  assert.equal(g.run('bgm.paused'), true);
});

test('a delayed media play completion cannot leak sound after leaving', async () => {
  const g = boot({ deferredMedia: true }); board(g);
  assert.equal(g.playingRequests.length, 1);
  g.emit('window', 'blur');
  g.playingRequests[0]();
  await Promise.resolve();
  assert.equal(g.run('bgm.paused'), true);
});

test('the full board fits each screen using one uniform scale, including larger phones', () => {
  const g = boot();
  for (const [width, height, scale] of [[1440,1100,1100/844], [430,932,430/390], [390,844,1], [320,568,568/844], [844,390,390/844]]) {
    g.p.windowWidth = width;
    g.p.windowHeight = height;
    g.p.setup();
    g.drawScales.length = 0;
    g.p.draw();
    assert.equal(g.drawScales[0], scale);
    assert.match(g.nodes.get('ui-layer').style.transform, new RegExp(`scale\\(${String(scale).replace('.', '\\.')}\\)`));
  }
});

test('canvas and HUD use the safe content area and follow browser-bar resizing', () => {
  const g = boot();
  g.p.windowWidth = 430;
  g.p.windowHeight = 932;
  const container = g.nodes.get('game-container');
  const canvasSizes = [];
  g.p.resizeCanvas = (width, height) => canvasSizes.push([width, height]);
  for (const [width, height] of [[430,851], [430,751], [760,369]]) {
    container.clientWidth = width;
    container.clientHeight = height;
    g.p.windowResized();
    g.drawScales.length = 0;
    g.p.draw();
    const scale = g.drawScales[0];
    assert.ok(390 * scale <= width + 0.001);
    assert.ok(844 * scale <= height + 0.001);
    assert.ok(Math.abs(390 * scale - width) < 0.001 || Math.abs(844 * scale - height) < 0.001);
    assert.deepEqual(canvasSizes.at(-1), [width, height]);
    assert.equal(g.nodes.get('ui-layer').style.left, width / 2 + 'px');
  }
});
