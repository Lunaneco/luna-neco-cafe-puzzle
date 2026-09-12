'use strict';

// Standalone port of the owner's published game. All runtime assets are local.
function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Play remains available. */ }
}

// --- i18n Setup ---
const uiPayload = JSON.parse(document.getElementById('ui-texts').textContent);
const sourceLang = uiPayload.sourceLang || 'en';
const uiTexts = uiPayload.texts || {};
const savedLang = (new URLSearchParams(location.search).get('lang') || readStorage('luna_neco_language') || '').slice(0, 2);
const browserLang = (navigator.language || '').slice(0, 2);
const currentLang = uiTexts[savedLang] ? savedLang : (uiTexts[browserLang] ? browserLang : sourceLang);
document.documentElement.lang = currentLang;
function t(key, vars) {
  let s = (uiTexts[currentLang] && uiTexts[currentLang][key]) || (uiTexts[sourceLang] && uiTexts[sourceLang][key]) || key;
  if (vars) Object.keys(vars).forEach(k => { s = s.replaceAll('{' + k + '}', String(vars[k])); });
  return s;
}

document.getElementById('start-btn-text').innerText = t('ui.start');
document.getElementById('start-btn-icon').src = './assets/images/paw.png';
document.getElementById('retry-btn').innerText = t('ui.retry');
document.getElementById('loading-text').innerText = t('ui.loading');
document.getElementById('submit-score-btn').innerText = t('ui.submit');
document.getElementById('player-name-input').placeholder = t('ui.enter_name');
document.getElementById('player-name-input').setAttribute('aria-label', t('ui.enter_name'));
document.getElementById('start-img').src = './assets/images/title.jpeg';

// --- Audio Setup ---
const bgmUrl = './assets/audio/cafe-bgm.mp3';
const bgm = new Audio(bgmUrl);
bgm.loop = true;
bgm.volume = 0.4;

const runa1Url = './assets/audio/luna.mp3';
const runa1Voice = new Audio(runa1Url);

const tsukinecoUrl = './assets/audio/tsukineco.mp3';
const tsukinecoVoice = new Audio(tsukinecoUrl);

const motiVoices = [
  new Audio('./assets/audio/mochi-2.mp3'),
  new Audio('./assets/audio/mochi-3.mp3'),
  new Audio('./assets/audio/mochi-1.mp3'),
  new Audio('./assets/audio/mochi-4.mp3')
];

let audioAway = document.hidden || !document.hasFocus();
let soundMuted = readStorage('luna_neco_muted') === 'true';
function canPlayAudio() {
  return !audioAway && !soundMuted && !document.hidden && document.hasFocus();
}
function playMedia(sound) {
  if (!canPlayAudio()) return;
  sound.play().then(() => {
    // A pending play request may finish after the user leaves the page.
    if (!canPlayAudio()) sound.pause();
  }).catch(() => {});
}

class SynthAudio {
  constructor() {
    this.ctx = null;
    this.voices = new Set();
    this.timers = new Set();
  }
  init() {
    if (!canPlayAudio()) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; }
  }
  play(freq, endFreq, duration, type = 'square', vol = 0.2) {
    if (!canPlayAudio()) return;
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + duration);
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    const voice = { osc, gain };
    this.voices.add(voice);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      this.voices.delete(voice);
    };
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
  playPop(count) {
    const baseFreq = 400 + Math.min(count, 10) * 50;
    this.play(baseFreq, baseFreq * 1.5, 0.1, 'sine', 0.2);
  }
  playClear() {
    if (!canPlayAudio()) return;
    [523, 659, 784, 1046].forEach((f, i) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.play(f, f, 0.2, 'square', 0.1);
      }, i * 100);
      this.timers.add(timer);
    });
  }
  playOver() {
    this.play(300, 150, 0.5, 'sawtooth', 0.2);
  }
  stop() {
    this.timers.forEach(timer => clearTimeout(timer));
    this.timers.clear();
    for (const { osc, gain } of this.voices) {
      // Disconnect immediately; suspension alone would replay the tail on return.
      gain.disconnect();
      try { osc.stop(); } catch { /* Already ended. */ }
    }
    this.voices.clear();
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.suspend().catch(() => {});
  }
}
const audio = new SynthAudio();
const media = [bgm, runa1Voice, tsukinecoVoice, ...motiVoices];
media.forEach(sound => document.getElementById('audio-assets').append(sound));
function updateSound() {
  media.forEach(sound => { sound.muted = !canPlayAudio(); });
  const button = document.getElementById('sound-btn');
  button.textContent = soundMuted ? '♪ OFF' : '♪ ON';
  button.setAttribute('aria-pressed', String(soundMuted));
  button.setAttribute('aria-label', currentLang === 'ja' ? '音をミュート' : 'Mute audio');
}
document.getElementById('sound-btn').addEventListener('click', () => {
  soundMuted = !soundMuted;
  writeStorage('luna_neco_muted', String(soundMuted));
  updateSound();
  if (soundMuted) silenceAudio();
  else restoreAudio();
});
updateSound();
function stopVoices() {
  media.slice(1).forEach(sound => { sound.pause(); sound.currentTime = 0; });
}
function silenceAudio() {
  media.forEach(sound => { sound.pause(); });
  stopVoices();
  audio.stop();
}
function leavePage() {
  audioAway = true;
  updateSound();
  silenceAudio();
}
function restoreAudio() {
  if (document.hidden || !document.hasFocus()) return;
  audioAway = false;
  updateSound();
  if (!canPlayAudio()) return;
  if (audio.ctx) audio.init();
  // Do not restart voices, effects, or a round that expired while away.
  if (gameState === 'PLAYING' && !pendingResult && Date.now() - startTime < 60000 && bgm.paused) {
    playMedia(bgm);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) leavePage();
  else restoreAudio();
});
window.addEventListener('blur', leavePage);
window.addEventListener('pagehide', leavePage);
window.addEventListener('focus', restoreAudio);
window.addEventListener('pageshow', restoreAudio);
document.addEventListener('pointerdown', () => {
  restoreAudio();
  audio.init();
});

// --- Game Constants & State ---
const VIRTUAL_WIDTH = 390;
const VIRTUAL_HEIGHT = 844;
const BLOCK_SIZE = 48;
const COLS = 8;
const ROWS = 13;
const START_X = (VIRTUAL_WIDTH - BLOCK_SIZE * COLS) / 2;
const START_Y = 180;

let gameState = 'READY';
let score = 0;
let timeLeft = 60;
let startTime = 0;
let scoreMultiplierEndTime = 0;
let timePlusEndTime = 0;
let grid = [];
let particles = [];
let pendingResult = null;

const assets = {};
const blockColors = ['#5c4033', '#ff99c2', '#a2d149', '#80b3ff', '#ffa500', '#ffff00', '#ff00ff'];
let blockImages = [];

function loadRanking() {
  try {
    const data = readStorage('luna_neco_ranking_v1') || readStorage('retro_cafe_ranking_v2') || readStorage('retro_cafe_ranking');
    const parsed = JSON.parse(data || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(entry => typeof entry === 'number' ? {name: t('ui.anonymous'), score: entry} : entry)
      .filter(entry => entry && Number.isSafeInteger(entry.score) && entry.score >= 0)
      .map(entry => ({name: String(entry.name || t('ui.anonymous')).slice(0, 10), score: entry.score}))
      .sort((a, b) => b.score - a.score).slice(0, 5);
  } catch(e) {
    return [];
  }
}

function saveScore(name, newScore) {
  let ranking = loadRanking();
  if (!Number.isSafeInteger(newScore) || newScore < 0) return ranking;
  ranking.push({name: String(name).trim().slice(0, 10) || t('ui.anonymous'), score: newScore});
  ranking.sort((a, b) => b.score - a.score);
  ranking = ranking.slice(0, 5);
  writeStorage('luna_neco_ranking_v1', JSON.stringify(ranking));
  return ranking;
}

function renderRanking(containerId, ranking) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.replaceChildren();
  const title = document.createElement('div');
  title.className = 'ranking-title';
  title.textContent = t('ui.ranking');
  container.append(title);
  if (ranking.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ranking-empty';
    empty.textContent = t('ui.nodata');
    container.append(empty);
  } else {
    ranking.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'ranking-item';
      [String(i + 1) + '.', entry.name, String(entry.score)].forEach(text => {
        const span = document.createElement('span');
        span.textContent = text;
        row.append(span);
      });
      container.append(row);
    });
  }
}

function updateScoreUI() {
  document.getElementById('score-text').innerText = t('hud.score', {score: score});
  document.getElementById('time-text').innerText = t('hud.time', {time: timeLeft});
}

function initGrid() {
  grid = [];
  for(let c=0; c<COLS; c++){
    grid[c] = [];
    for(let r=0; r<ROWS; r++){
      let type = Math.floor(Math.random() * 5);
      grid[c][r] = {
        type: type,
        col: c,
        row: r,
        pixelX: START_X + c * BLOCK_SIZE,
        pixelY: START_Y - (ROWS - r) * BLOCK_SIZE - 200,
        targetX: START_X + c * BLOCK_SIZE,
        targetY: START_Y + r * BLOCK_SIZE
      };
    }
  }
}

function startGame() {
  stopVoices();
  score = 0;
  timeLeft = 60;
  startTime = Date.now();
  scoreMultiplierEndTime = 0;
  timePlusEndTime = 0;
  updateScoreUI();
  initGrid();
  particles = [];
  pendingResult = null;
  gameState = 'PLAYING';
  document.getElementById('multiplier-text').style.display = 'none';
  document.getElementById('time-plus-text').style.display = 'none';
  document.getElementById('start-overlay').style.display = 'none';
  document.getElementById('result-overlay').style.display = 'none';
  bgm.currentTime = 0;
  playMedia(bgm);
}

function showResult(msgKey) {
  bgm.pause();
  stopVoices();
  document.getElementById('result-msg').innerText = t(msgKey);
  document.getElementById('result-score').innerText = t('ui.result_score', {score: score});

  const ranking = loadRanking();
  const isRankIn = ranking.length < 5 || score > (ranking[ranking.length - 1]?.score || 0);

  if (isRankIn && score > 0) {
    document.getElementById('name-entry-container').style.display = 'block';
    document.getElementById('result-ranking').style.display = 'none';
    document.getElementById('retry-btn').style.display = 'none';
    document.getElementById('name-entry-msg').innerText = t('ui.new_record');
    document.getElementById('player-name-input').value = '';
  } else {
    showRankingMode(ranking);
  }

  document.getElementById('result-overlay').style.display = 'flex';
}

function showRankingMode(ranking) {
  document.getElementById('name-entry-container').style.display = 'none';
  document.getElementById('result-ranking').style.display = 'block';
  document.getElementById('retry-btn').style.display = 'inline-block';
  renderRanking('result-ranking', ranking);
}

document.getElementById('submit-score-btn').addEventListener('click', () => {
  if (document.getElementById('name-entry-container').style.display === 'none') return;
  let name = document.getElementById('player-name-input').value.trim();
  if (!name) name = t('ui.anonymous');
  const newRanking = saveScore(name, score);
  showRankingMode(newRanking);
});

document.getElementById('player-name-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) document.getElementById('submit-score-btn').click();
});

document.getElementById('start-btn').addEventListener('click', () => {
  audio.init();
  startGame();
});

document.getElementById('retry-btn').addEventListener('click', () => {
  audio.init();
  startGame();
});

// --- P5.js Main ---
const game = (p) => {
  let scale = 1, offsetX = 0, offsetY = 0;

  p.preload = () => {
    let loadedCount = 0;
    const totalAssets = 9;
    const checkLoad = () => {
      loadedCount++;
      if(loadedCount === totalAssets) {
        document.getElementById('loading-overlay').style.display = 'none';
        document.getElementById('start-overlay').style.display = 'flex';
        blockImages = [assets.img1, assets.img2, assets.img3, assets.img4, assets.img5, assets.img6, assets.img7, assets.img9];
      }
    };
    const loadWithFallback = (path, key) => {
      assets[key] = p.loadImage(
        path,
        () => { checkLoad(); },
        () => { assets[key] = null; checkLoad(); }
      );
    };
    loadWithFallback('./assets/images/tile-0.png', 'img1');
    loadWithFallback('./assets/images/tile-1.png', 'img2');
    loadWithFallback('./assets/images/tile-2.png', 'img3');
    loadWithFallback('./assets/images/tile-3.png', 'img4');
    loadWithFallback('./assets/images/tile-4.png', 'img5');
    loadWithFallback('./assets/images/luna.png', 'img6');
    loadWithFallback('./assets/images/tsukineco.png', 'img7');
    loadWithFallback('./assets/images/mochi.png', 'img9');
    loadWithFallback('./assets/images/cafe-background.jpeg', 'bg');
  };

  p.setup = () => {
    const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.parent('game-container');
    p.imageMode(p.CENTER);
    updateScoreUI();
    calculateScale();

    // 確実なタッチ・クリックイベントの登録
    canvas.elt.addEventListener('pointerdown', (e) => {
      if (gameState !== 'PLAYING') return;
      const rect = canvas.elt.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const vx = toVirtualX(mx);
      const vy = toVirtualY(my);

      // Block input if animating
      for(let c=0; c<COLS; c++){
        for(let r=0; r<ROWS; r++){
          let b = grid[c][r];
          if(b && (Math.abs(b.pixelX - b.targetX) > 0.5 || Math.abs(b.pixelY - b.targetY) > 0.5)){
            return;
          }
        }
      }

      let c = Math.floor((vx - START_X) / BLOCK_SIZE);
      let r = Math.floor((vy - START_Y) / BLOCK_SIZE);

      if (c >= 0 && c < COLS && r >= 0 && r < ROWS) {
        handleTap(c, r);
      }
    });
  };

  function calculateScale() {
    const scaleX = p.windowWidth / VIRTUAL_WIDTH;
    const scaleY = p.windowHeight / VIRTUAL_HEIGHT;
    // 390 × 844 is 100%. Shrink uniformly when needed, never auto-enlarge.
    scale = Math.min(1, scaleX, scaleY);
    offsetX = (p.windowWidth - VIRTUAL_WIDTH * scale) / 2;
    offsetY = (p.windowHeight - VIRTUAL_HEIGHT * scale) / 2;

    const uiLayer = document.getElementById('ui-layer');
    if (uiLayer) {
      // パズル画面のすれすれ上（仮想座標Y=90）に配置し、画面サイズに合わせてスケールする
      uiLayer.style.top = (offsetY + 90 * scale) + 'px';
      uiLayer.style.left = (offsetX + VIRTUAL_WIDTH * scale / 2) + 'px';
      uiLayer.style.width = VIRTUAL_WIDTH + 'px';
      uiLayer.style.transform = `translateX(-50%) scale(${scale})`;
      uiLayer.style.transformOrigin = 'top center';
    }
  }

  function toVirtualX(x) { return (x - offsetX) / scale; }
  function toVirtualY(y) { return (y - offsetY) / scale; }

  p.draw = () => {
    p.background('#000');
    p.push();
    p.translate(offsetX, offsetY);
    p.scale(scale);

    drawBackground(p);

    if (gameState === 'PLAYING' || gameState === 'GAMEOVER' || gameState === 'CLEAR') {
      drawGame(p);
    }

    p.pop();
  };

  function drawBackground(p) {
    if (assets.bg) {
      const imgRatio = assets.bg.width / assets.bg.height;
      const screenRatio = VIRTUAL_WIDTH / VIRTUAL_HEIGHT;
      let dw, dh;
      if (imgRatio > screenRatio) {
        dh = VIRTUAL_HEIGHT;
        dw = dh * imgRatio;
      } else {
        dw = VIRTUAL_WIDTH;
        dh = dw / imgRatio;
      }
      p.image(assets.bg, VIRTUAL_WIDTH / 2, VIRTUAL_HEIGHT / 2, dw, dh);
    } else {
      p.noStroke();
      for(let i=0; i<VIRTUAL_WIDTH; i+=20) {
        p.fill(i%40===0 ? '#ffb3c6' : '#ffc2d1');
        p.rect(i, 0, 20, START_Y - 20);
      }
      for(let y=START_Y-20; y<VIRTUAL_HEIGHT; y+=30) {
        for(let x=0; x<VIRTUAL_WIDTH; x+=30) {
          p.fill((x+y)%60===0 ? '#f8edeb' : '#fcd5ce');
          p.rect(x, y, 30, 30);
        }
      }
      p.fill('#d8e2dc');
      p.rect(0, START_Y - 40, VIRTUAL_WIDTH, 20);
      p.fill('#9d8189');
      p.rect(0, START_Y - 20, VIRTUAL_WIDTH, 5);
    }
  }

  function drawGame(p) {
    let isAnimating = false;

    if (gameState === 'PLAYING') {
      let elapsed = Math.floor((Date.now() - startTime) / 1000);
      let newTimeLeft = Math.max(0, 60 - elapsed);
      if (newTimeLeft !== timeLeft) {
        timeLeft = newTimeLeft;
        updateScoreUI();
      }
      if (timeLeft === 0 && !pendingResult) {
        pendingResult = 'timeup';
      }
    }

    // Draw Grid Background
    if (Date.now() < scoreMultiplierEndTime) {
      let t = Math.floor(Date.now() / 100);
      let colors = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#4169e1', '#ff00ff'];
      p.push();
      p.strokeWeight(4);
      p.noFill();
      for(let i = 0; i < 3; i++) {
        p.stroke(colors[(t + i) % colors.length]);
        p.rect(START_X - 11 - i*6, START_Y - 11 - i*6, BLOCK_SIZE * COLS + 22 + i*12, BLOCK_SIZE * ROWS + 22 + i*12, 12);
      }
      p.pop();
    }

    p.noStroke();
    p.fill('rgba(45, 61, 119, 0.7)');
    p.rect(START_X - 5, START_Y - 5, BLOCK_SIZE * COLS + 10, BLOCK_SIZE * ROWS + 10, 10);

    for(let c=0; c<COLS; c++){
      for(let r=0; r<ROWS; r++){
        let b = grid[c][r];
        if(b){
          if(Math.abs(b.pixelX - b.targetX) < 0.5) b.pixelX = b.targetX;
          if(Math.abs(b.pixelY - b.targetY) < 0.5) b.pixelY = b.targetY;

          if(Math.abs(b.pixelX - b.targetX) > 0 || Math.abs(b.pixelY - b.targetY) > 0){
            isAnimating = true;
          }
          b.pixelX += (b.targetX - b.pixelX) * 0.2;
          b.pixelY += (b.targetY - b.pixelY) * 0.2;

          let img = blockImages[b.type];
          let cx = b.pixelX + BLOCK_SIZE/2;
          let cy = b.pixelY + BLOCK_SIZE/2;

          let currentScale = 1.0;
          if (b.popScale) {
            currentScale = b.popScale;
            b.popScale -= 0.05;
            if (b.popScale <= 1.0) b.popScale = null;
          }

          let flashAlpha = 0;
          if (b.whiteFlash !== undefined) {
            flashAlpha = b.whiteFlash;
            b.whiteFlash -= 8;
            if (b.whiteFlash <= 0) b.whiteFlash = undefined;
          } else if (b.popScale) {
            flashAlpha = Math.max(0, (b.popScale - 1.0) / 0.8 * 150);
          }

          p.push();
          p.translate(cx, cy);
          p.scale(currentScale);

          if(img) {
            const dw = BLOCK_SIZE - 4;
            const dh = img.height ? dw * (img.height / img.width) : dw;
            p.image(img, 0, 0, dw, dh);
          } else {
            p.fill(blockColors[b.type]);
            p.rect(-(BLOCK_SIZE - 4)/2, -(BLOCK_SIZE - 4)/2, BLOCK_SIZE - 4, BLOCK_SIZE - 4, 6);
          }

          if (flashAlpha > 0) {
            p.fill(255, 255, 255, flashAlpha);
            p.noStroke();
            let fw = BLOCK_SIZE;
            p.rect(-fw/2, -fw/2, fw, fw, 8);
          }

          if (b.type >= 5 && b.type <= 7) {
            p.push();
            p.blendMode(p.ADD);
            p.noFill();
            let t = Date.now() / 800 + b.col * 0.2 + b.row * 0.2;
            let glow = (Math.sin(t) + 1) / 2;
            let r = 220 + 35 * glow;
            let g = 230 + 25 * glow;
            let bColor = 255;
            for (let i = 0; i < 3; i++) {
              let alpha = 50 - i * 15 + glow * 30;
              p.strokeWeight(2 + i * 3);
              p.stroke(r, g, bColor, alpha);
              p.rect(-(BLOCK_SIZE - 2 + i*2)/2, -(BLOCK_SIZE - 2 + i*2)/2, BLOCK_SIZE - 2 + i*2, BLOCK_SIZE - 2 + i*2, 8 + i);
            }
            p.strokeWeight(1.5);
            p.stroke(255, 255, 255, 150 + glow * 100);
            p.rect(-(BLOCK_SIZE - 2)/2, -(BLOCK_SIZE - 2)/2, BLOCK_SIZE - 2, BLOCK_SIZE - 2, 8);
            p.pop();
          }

          if (b.highlightEndTime && Date.now() < b.highlightEndTime) {
            p.noFill();
            p.strokeWeight(4);
            let alpha = Math.floor(Math.sin((Date.now() % 300) / 300 * Math.PI) * 255);
            p.stroke(255, 255, 0, alpha);
            p.rect(-(BLOCK_SIZE - 4)/2, -(BLOCK_SIZE - 4)/2, BLOCK_SIZE - 4, BLOCK_SIZE - 4, 8);
          }
          p.pop();
        }
      }
    }

    // Particles
    for(let i = particles.length - 1; i >= 0; i--){
      let pt = particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += 0.2;
      pt.life -= 0.03;

      if(pt.life <= 0){
        particles.splice(i, 1);
      } else {
        p.noStroke();
        let c = p.color(pt.color);
        c.setAlpha(pt.life * 255);
        p.fill(c);
        p.rect(pt.x, pt.y, 8, 8, 2);
      }
    }

    const multText = document.getElementById('multiplier-text');
    if (multText) {
      multText.style.display = (Date.now() < scoreMultiplierEndTime) ? 'block' : 'none';
    }

    const timePlusText = document.getElementById('time-plus-text');
    if (timePlusText) {
      timePlusText.style.display = (Date.now() < timePlusEndTime) ? 'inline-block' : 'none';
    }

    // Handle pending result after animation finishes
    if(!isAnimating && pendingResult && gameState === 'PLAYING') {
      if(pendingResult === 'perfect') {
        gameState = 'CLEAR';
        showResult('msg.perfect');
      } else if(pendingResult === 'gameover') {
        gameState = 'GAMEOVER';
        showResult('msg.gameover');
      } else if(pendingResult === 'timeup') {
        gameState = 'GAMEOVER';
        showResult('msg.timeup');
        audio.playOver();
      }
      pendingResult = null;
    }
  }

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    calculateScale();
  };
};

function handleTap(c, r) {
  if (gameState !== 'PLAYING' || pendingResult || c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
  // A delayed frame must not allow extra points or a time bonus after the deadline.
  if (Date.now() - startTime >= 60000) {
    pendingResult = 'timeup';
    return;
  }
  let targetBlock = grid[c][r];
  if (!targetBlock) return;

  if (targetBlock.type === 5) {
    timeLeft += 10;
    startTime += 10000;
    timePlusEndTime = Date.now() + 2000;
    updateScoreUI();
    runa1Voice.currentTime = 0;
    playMedia(runa1Voice);
    spawnParticles(targetBlock.pixelX + BLOCK_SIZE/2, targetBlock.pixelY + BLOCK_SIZE/2, '#ffff00');
    grid[c][r] = null;
    applyGravityAndPack();
    checkEndCondition();
    return;
  }

  if (targetBlock.type === 6) {
    scoreMultiplierEndTime = Date.now() + 20000;
    tsukinecoVoice.currentTime = 0;
    playMedia(tsukinecoVoice);
    spawnParticles(targetBlock.pixelX + BLOCK_SIZE/2, targetBlock.pixelY + BLOCK_SIZE/2, '#ff00ff');
    grid[c][r] = null;
    applyGravityAndPack();
    checkEndCondition();
    return;
  }

  if (targetBlock.type === 7) {
    const v = motiVoices[Math.floor(Math.random() * motiVoices.length)];
    v.currentTime = 0;
    playMedia(v);
    spawnParticles(targetBlock.pixelX + BLOCK_SIZE/2, targetBlock.pixelY + BLOCK_SIZE/2, '#00ffff');
    grid[c][r] = null;

    let availableTypes = new Set();
    for(let x=0; x<COLS; x++){
      for(let y=0; y<ROWS; y++){
        let b = grid[x][y];
        if(b && b.type < 5 && b.type !== 1) {
          availableTypes.add(b.type);
        }
      }
    }

    let typesArray = Array.from(availableTypes);
    if (typesArray.length > 0) {
      let targetTypeToChange = typesArray[Math.floor(Math.random() * typesArray.length)];
      for(let x=0; x<COLS; x++){
        for(let y=0; y<ROWS; y++){
          let b = grid[x][y];
          if(b && b.type === targetTypeToChange) {
            b.type = 1;
            b.popScale = 1.3;
            b.whiteFlash = 255;
            spawnParticles(b.pixelX + BLOCK_SIZE/2, b.pixelY + BLOCK_SIZE/2, '#ffff00');
            spawnParticles(b.pixelX + BLOCK_SIZE/2, b.pixelY + BLOCK_SIZE/2, '#ff99c2');
            spawnParticles(b.pixelX + BLOCK_SIZE/2, b.pixelY + BLOCK_SIZE/2, '#ffffff');
            spawnParticles(b.pixelX + BLOCK_SIZE/2, b.pixelY + BLOCK_SIZE/2, '#00ffff');
            b.highlightEndTime = Date.now() + 2000;
          }
        }
      }
    }

    applyGravityAndPack();
    checkEndCondition();
    return;
  }

  let connected = [];
  let visited = Array(COLS).fill().map(() => Array(ROWS).fill(false));

  function dfs(x, y, type) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    if (visited[x][y]) return;
    if (!grid[x][y] || grid[x][y].type !== type) return;

    visited[x][y] = true;
    connected.push({c: x, r: y});

    dfs(x+1, y, type);
    dfs(x-1, y, type);
    dfs(x, y+1, type);
    dfs(x, y-1, type);
  }

  dfs(c, r, targetBlock.type);

  if (connected.length >= 2) {
    let pts = connected.length * connected.length * 10;
    let multiplier = (Date.now() < scoreMultiplierEndTime) ? 2 : 1;
    score += pts * multiplier;
    updateScoreUI();

    audio.playPop(connected.length);

    let spawnSpecialType = -1;
    if (connected.length >= 10) {
      if (targetBlock.type === 4) spawnSpecialType = 5;
      if (targetBlock.type === 3) spawnSpecialType = 6;
      if (targetBlock.type === 0 || targetBlock.type === 1 || targetBlock.type === 2) spawnSpecialType = 7;
    }

    let specialSpawned = false;

    connected.forEach(pos => {
      let b = grid[pos.c][pos.r];
      spawnParticles(b.pixelX + BLOCK_SIZE/2, b.pixelY + BLOCK_SIZE/2, blockColors[b.type]);

      if (spawnSpecialType !== -1 && !specialSpawned) {
        b.type = spawnSpecialType;
        specialSpawned = true;
      } else {
        grid[pos.c][pos.r] = null;
      }
    });

    applyGravityAndPack();
    checkEndCondition();
  }
}

function spawnParticles(x, y, color) {
  for(let i=0; i<10; i++){
    let angle = Math.random() * Math.PI * 2;
    let speed = Math.random() * 4 + 2;
    particles.push({
      x: x, y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      color: color
    });
  }
}

function applyGravityAndPack() {
  // Drop down & Refill
  for (let c = 0; c < COLS; c++) {
    let newCol = [];
    let missingCount = 0;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[c][r] !== null) {
        newCol.unshift(grid[c][r]);
      } else {
        missingCount++;
      }
    }

    // 上部に新しいブロックを追加
    for (let i = 0; i < missingCount; i++) {
      let type = Math.floor(Math.random() * 5);
      let newBlock = {
        type: type,
        col: c,
        row: i,
        pixelX: START_X + c * BLOCK_SIZE,
        pixelY: START_Y - (missingCount - i) * BLOCK_SIZE - 100,
        targetX: START_X + c * BLOCK_SIZE,
        targetY: START_Y + i * BLOCK_SIZE
      };
      newCol.unshift(newBlock);
    }

    grid[c] = newCol;

    for (let r = 0; r < ROWS; r++) {
      let b = grid[c][r];
      if (b) {
        b.row = r;
        b.col = c;
        b.targetX = START_X + c * BLOCK_SIZE;
        b.targetY = START_Y + r * BLOCK_SIZE;
      }
    }
  }
}

function checkEndCondition() {
  let hasMove = false;
  for(let c=0; c<COLS; c++){
    for(let r=0; r<ROWS; r++){
      let b = grid[c][r];
      if(b){
        if(b.type === 5 || b.type === 6 || b.type === 7) hasMove = true;
        if(c < COLS-1 && grid[c+1][r] && grid[c+1][r].type === b.type && b.type < 5) hasMove = true;
        if(r < ROWS-1 && grid[c][r+1] && grid[c][r+1].type === b.type && b.type < 5) hasMove = true;
      }
    }
  }

  if(!hasMove){
    pendingResult = 'gameover';
    audio.playOver();
  }
}

new p5(game);
