const TOTAL_TIME = 2343.1836734693875;
const MIN_TIME = 0.5;
const MAX_TIME = 2343.5;
const REEL_TIME_DIV = 5.8675;
const SPINNER_COUNT = 6;
const REEL_COUNT = 400;
const SPINNER_MS = 28;
const SCRUB_RATE = 30;

const TRACKS = [
  { file: '01-cobwebs.mp3', duration: 258.8473469387755 },
  { file: '02-by-the-wayside.mp3', duration: 173.4269387755102 },
  { file: '03-farm-song.mp3', duration: 243.25224489795917 },
  { file: '04-meanada.mp3', duration: 338.2857142857143 },
  { file: '05-she-ll-be-right.mp3', duration: 178.72979591836736 },
  { file: '06-big-wide-world.mp3', duration: 240.9795918367347 },
  { file: '07-today-is-the-day.mp3', duration: 213.15918367346939 },
  { file: '08-pay-to-play.mp3', duration: 167.49714285714285 },
  { file: '09-next-time.mp3', duration: 239.22938775510204 },
  { file: '10-thank-you.mp3', duration: 289.77632653061227 },
];

const SFX = {
  play: 'sfx-play.mp3',
  stop: 'sfx-stop.mp3',
  rewindPress: 'sfx-rewind-press.mp3',
  rewindLoop: 'sfx-rewind-loop.mp3',
  ffPress: 'sfx-fast-forward-press.mp3',
  ffLoop: 'sfx-fast-forward-loop.mp3',
};

const music = document.getElementById('music');
const sfxUi = document.getElementById('sfxUi');
const sfxLoop = document.getElementById('sfxLoop');
const reelA = document.getElementById('reelA');
const spinnerA = document.getElementById('spinnerA');
const pressMap = {
  rewind: document.getElementById('pressRewind'),
  play: document.getElementById('pressPlay'),
  ff: document.getElementById('pressFF'),
  stop: document.getElementById('pressStop'),
};

let globalTime = MIN_TIME;
let state = 'stop';
let trackIndex = 0;
let animTimer = null;
let loadedTrack = -1;
let animating = false;
let spinnerFrame = 1;
let reelFrame = 0;
let spinnerDir = 1;
let lastSpinnerTick = 0;
let lastAnimTime = 0;
const reelPreload = new Set();

function asset(path) {
  return `assets/audio/${path}`;
}

function spinnerUrl(frame) {
  const n = ((frame - 1 + SPINNER_COUNT * 50) % SPINNER_COUNT) + 1;
  return `assets/spinners-full/spinner-${n}.webp`;
}

function reelUrl(frame) {
  const n = Math.min(REEL_COUNT, Math.max(1, frame));
  return `assets/reels-full/reel-${String(n).padStart(3, '0')}.webp`;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Matches Scratch: switch costume to (time / 5.8675)
function timeToReelFrame(time) {
  const t = clamp(time, MIN_TIME, MAX_TIME);
  const frame = Math.round(t / REEL_TIME_DIV);
  return clamp(frame < 1 ? 1 : frame, 1, REEL_COUNT);
}

function locateTime(time) {
  let remaining = clamp(time - MIN_TIME, 0, TOTAL_TIME);
  for (let i = 0; i < TRACKS.length; i++) {
    if (remaining < TRACKS[i].duration) return { index: i, offset: remaining };
    remaining -= TRACKS[i].duration;
  }
  const last = TRACKS.length - 1;
  return { index: last, offset: TRACKS[last].duration };
}

function setPressed(action, on) {
  const img = pressMap[action];
  if (img) img.hidden = !on;
}

function clearPressed() {
  Object.keys(pressMap).forEach((k) => setPressed(k, false));
}

function setAnimLayersVisible(on) {
  reelA.hidden = !on;
  spinnerA.hidden = !on;
}

function playUiSfx(name) {
  sfxUi.src = asset(SFX[name]);
  sfxUi.currentTime = 0;
  sfxUi.play().catch(() => {});
}

function playLoopSfx(name) {
  sfxLoop.src = asset(SFX[name]);
  sfxLoop.currentTime = 0;
  sfxLoop.play().catch(() => {});
}

function stopSfx() {
  sfxLoop.pause();
  sfxLoop.currentTime = 0;
}

function preloadSpinners() {
  for (let i = 1; i <= SPINNER_COUNT; i++) {
    const img = new Image();
    img.src = spinnerUrl(i);
  }
}

function warmReelFrames(center) {
  for (let offset = -6; offset <= 10; offset++) {
    const frame = center + offset;
    if (frame < 1 || frame > REEL_COUNT || reelPreload.has(frame)) continue;
    reelPreload.add(frame);
    const img = new Image();
    img.decoding = 'async';
    img.src = reelUrl(frame);
  }
}

function setSpinnerFrame(frame) {
  spinnerFrame = ((frame - 1 + SPINNER_COUNT * 50) % SPINNER_COUNT) + 1;
  spinnerA.src = spinnerUrl(spinnerFrame);
}

function setReelFrame(frame) {
  if (reelFrame === frame) return;
  reelFrame = frame;
  warmReelFrames(frame);
  reelA.src = reelUrl(frame);
}

function advanceSpinner(step) {
  let next = spinnerFrame + spinnerDir * step;
  while (next < 1) next += SPINNER_COUNT;
  while (next > SPINNER_COUNT) next -= SPINNER_COUNT;
  setSpinnerFrame(next);
}

function isScrubbing() {
  return state === 'rewind' || state === 'ff';
}

function syncGlobalTime() {
  if (state === 'play') {
    let elapsed = MIN_TIME;
    for (let i = 0; i < trackIndex; i++) elapsed += TRACKS[i].duration;
    globalTime = clamp(elapsed + music.currentTime, MIN_TIME, MAX_TIME);
  }
}

function tickAnimation(now) {
  if (!animating) return;

  if (!lastAnimTime) lastAnimTime = now;
  const dt = Math.min((now - lastAnimTime) / 1000, 0.05);
  lastAnimTime = now;

  const fast = isScrubbing();
  const spinnerStep = fast ? 2 : 1;

  if (now - lastSpinnerTick >= SPINNER_MS) {
    advanceSpinner(spinnerStep);
    lastSpinnerTick = now;
  }

  if (state === 'rewind') {
    globalTime = clamp(globalTime - SCRUB_RATE * dt, MIN_TIME, MAX_TIME);
    if (globalTime <= MIN_TIME) stopScrub();
  } else if (state === 'ff') {
    globalTime = clamp(globalTime + SCRUB_RATE * dt, MIN_TIME, MAX_TIME);
    if (globalTime >= MAX_TIME) stopScrub();
  } else if (state === 'play') {
    syncGlobalTime();
  }

  // Scratch only updates reel costume during play when time > 5.8675
  if (state !== 'play' || globalTime > REEL_TIME_DIV) {
    setReelFrame(timeToReelFrame(globalTime));
  } else {
    setReelFrame(1);
  }

  animTimer = requestAnimationFrame(tickAnimation);
}

function startAnimation(direction = 1) {
  animating = true;
  spinnerDir = direction;
  lastSpinnerTick = performance.now();
  lastAnimTime = performance.now();
  setAnimLayersVisible(true);
  setSpinnerFrame(spinnerFrame);
  warmReelFrames(timeToReelFrame(globalTime));
  setReelFrame(timeToReelFrame(globalTime));
  if (animTimer) cancelAnimationFrame(animTimer);
  animTimer = requestAnimationFrame(tickAnimation);
}

function stopAnimation() {
  animating = false;
  if (animTimer) cancelAnimationFrame(animTimer);
  animTimer = null;
  lastAnimTime = 0;
  setAnimLayersVisible(false);
}

async function loadTrack(index) {
  if (loadedTrack === index && music.src) return;
  music.src = asset(TRACKS[index].file);
  loadedTrack = index;
  music.load();
}

async function startMusicAt(time) {
  const pos = locateTime(time);
  trackIndex = pos.index;
  await loadTrack(trackIndex);
  music.currentTime = pos.offset;
  try {
    await music.play();
  } catch {
    /* gesture */
  }
}

function pauseMusic() {
  music.pause();
}

function stopScrub() {
  if (!isScrubbing()) return;
  stopSfx();
  state = 'stop';
  clearPressed();
  stopAnimation();
}

function startScrub(action) {
  if (action === 'rewind' && globalTime <= MIN_TIME) return;
  if (action === 'ff' && globalTime >= MAX_TIME) return;
  if (state === action) return;

  pauseMusic();
  stopSfx();
  state = action;
  clearPressed();
  setPressed(action, true);
  playUiSfx(action === 'rewind' ? 'rewindPress' : 'ffPress');
  playLoopSfx(action === 'rewind' ? 'rewindLoop' : 'ffLoop');
  startAnimation(action === 'rewind' ? -1 : 1);
}

async function onPlay() {
  if (globalTime >= MAX_TIME) return;
  stopSfx();
  clearPressed();
  setPressed('play', true);
  playUiSfx('play');
  state = 'play';
  await startMusicAt(globalTime);
  startAnimation(1);
}

async function onStop() {
  stopSfx();
  pauseMusic();
  state = 'stop';
  clearPressed();
  setPressed('stop', true);
  playUiSfx('stop');
  stopAnimation();
  setTimeout(() => setPressed('stop', false), 250);
}

function bindButton(action, handler) {
  const btn = document.querySelector(`[data-action="${action}"]`);
  if (!btn) return;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handler();
  });
}

bindButton('play', onPlay);
bindButton('stop', onStop);
bindButton('rewind', () => startScrub('rewind'));
bindButton('ff', () => startScrub('ff'));

music.addEventListener('timeupdate', () => {
  if (state === 'play' && animating) {
    syncGlobalTime();
    if (globalTime > REEL_TIME_DIV) {
      setReelFrame(timeToReelFrame(globalTime));
    }
  }
});

music.addEventListener('ended', async () => {
  if (trackIndex < TRACKS.length - 1) {
    trackIndex += 1;
    await loadTrack(trackIndex);
    music.currentTime = 0;
    music.play().catch(() => {});
    return;
  }
  state = 'stop';
  stopAnimation();
  clearPressed();
});

preloadSpinners();
warmReelFrames(1);
setAnimLayersVisible(false);
