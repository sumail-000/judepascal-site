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

const SFX_EARLY = {
  play: 'sfxPlay',
  stop: 'sfxStop',
  rewindPress: 'sfxRewindPress',
  ffPress: 'sfxFfPress',
};

const reelA = document.getElementById('reelA');
const spinnerFrames = Array.from(document.querySelectorAll('.player__spinner-frame'));
const playerEl = document.getElementById('player');
const pressMap = {
  rewind: document.getElementById('pressRewind'),
  play: document.getElementById('pressPlay'),
  ff: document.getElementById('pressFF'),
  stop: document.getElementById('pressStop'),
};

const AudioCtx = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioCtx();
const musicGain = audioCtx.createGain();
const sfxGain = audioCtx.createGain();
musicGain.connect(audioCtx.destination);
sfxGain.connect(audioCtx.destination);

const trackBuffers = new Array(TRACKS.length);
const sfxBuffers = {};
let musicSource = null;
let loopSource = null;
let musicStartCtxTime = 0;
let musicStartOffset = 0;
let pendingMusicStart = false;

let globalTime = MIN_TIME;
let state = 'stop';
let trackIndex = 0;
let animTimer = null;
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

function resumeAudioContext() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function fetchArrayBuffer(url, earlyKey) {
  const early = window.__audioEarly;
  if (earlyKey && early && early[earlyKey]) {
    const p = early[earlyKey];
    early[earlyKey] = null;
    return p;
  }
  return fetch(url).then((res) => res.arrayBuffer());
}

function decodeBuffer(arrayBuffer) {
  return audioCtx.decodeAudioData(arrayBuffer);
}

async function decodeTrack(index) {
  if (trackBuffers[index]) return trackBuffers[index];
  const earlyKey = index === 0 ? 'track0' : null;
  const data = await fetchArrayBuffer(asset(TRACKS[index].file), earlyKey);
  const buffer = await decodeBuffer(data);
  trackBuffers[index] = buffer;
  return buffer;
}

async function decodeSfx(name) {
  if (sfxBuffers[name]) return sfxBuffers[name];
  const earlyKey = SFX_EARLY[name] || null;
  const data = await fetchArrayBuffer(asset(SFX[name]), earlyKey);
  const buffer = await decodeBuffer(data);
  sfxBuffers[name] = buffer;
  return buffer;
}

function playUiSfx(name) {
  const buffer = sfxBuffers[name];
  if (!buffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(sfxGain);
  src.start(0);
}

function playLoopSfx(name) {
  stopSfx();
  const buffer = sfxBuffers[name];
  if (!buffer) return;
  loopSource = audioCtx.createBufferSource();
  loopSource.buffer = buffer;
  loopSource.loop = true;
  loopSource.connect(sfxGain);
  loopSource.start(0);
}

function stopSfx() {
  if (!loopSource) return;
  try {
    loopSource.stop();
  } catch (e) {}
  loopSource.disconnect();
  loopSource = null;
}

function getMusicTrackTime() {
  return musicStartOffset + (audioCtx.currentTime - musicStartCtxTime);
}

function syncGlobalTime() {
  if (state === 'play' && musicSource) {
    let elapsed = MIN_TIME;
    for (let i = 0; i < trackIndex; i++) elapsed += TRACKS[i].duration;
    globalTime = clamp(elapsed + getMusicTrackTime(), MIN_TIME, MAX_TIME);
  }
}

function stopMusicSource() {
  if (!musicSource) return;
  try {
    musicSource.stop();
  } catch (e) {}
  musicSource.onended = null;
  musicSource.disconnect();
  musicSource = null;
}

function beginMusicSource(buffer, offset) {
  stopMusicSource();
  musicSource = audioCtx.createBufferSource();
  musicSource.buffer = buffer;
  musicSource.connect(musicGain);
  musicStartOffset = offset;
  musicStartCtxTime = audioCtx.currentTime;
  musicSource.onended = onMusicTrackEnded;
  musicSource.start(0, offset);
}

function startMusicAt(time) {
  const pos = locateTime(time);
  trackIndex = pos.index;
  const buffer = trackBuffers[pos.index];
  if (!buffer) {
    pendingMusicStart = true;
    decodeTrack(pos.index).then(() => {
      if (!pendingMusicStart || state !== 'play') return;
      pendingMusicStart = false;
      const latest = locateTime(globalTime);
      if (latest.index !== pos.index) return;
      beginMusicSource(trackBuffers[latest.index], latest.offset);
    });
    return;
  }
  pendingMusicStart = false;
  beginMusicSource(buffer, pos.offset);
}

function pauseMusic() {
  syncGlobalTime();
  stopMusicSource();
}

function onMusicTrackEnded() {
  musicSource = null;
  if (state !== 'play') return;
  if (trackIndex < TRACKS.length - 1) {
    trackIndex += 1;
    let elapsed = MIN_TIME;
    for (let i = 0; i < trackIndex; i++) elapsed += TRACKS[i].duration;
    globalTime = elapsed;
    startMusicAt(globalTime);
    return;
  }
  state = 'stop';
  stopAnimation();
  setSpinnerFrame(1);
  clearPressed();
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
  const next = ((frame - 1 + SPINNER_COUNT * 50) % SPINNER_COUNT) + 1;
  if (next === spinnerFrame && spinnerFrames[next - 1] && spinnerFrames[next - 1].classList.contains('is-active')) return;
  spinnerFrame = next;
  for (let i = 0; i < spinnerFrames.length; i++) {
    spinnerFrames[i].classList.toggle('is-active', i === spinnerFrame - 1);
  }
}

function setReelFrame(frame) {
  if (reelFrame === frame) return;
  reelFrame = frame;
  warmReelFrames(frame);
  reelA.src = reelUrl(frame);
}

function updateReelForTime() {
  if (state === 'play' && globalTime <= REEL_TIME_DIV) {
    setReelFrame(1);
  } else {
    setReelFrame(timeToReelFrame(globalTime));
  }
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

  updateReelForTime();
  animTimer = requestAnimationFrame(tickAnimation);
}

function startAnimation(direction) {
  animating = true;
  spinnerDir = direction;
  lastSpinnerTick = performance.now();
  lastAnimTime = performance.now();
  setSpinnerFrame(spinnerFrame);
  updateReelForTime();
  if (animTimer) cancelAnimationFrame(animTimer);
  animTimer = requestAnimationFrame(tickAnimation);
}

function stopAnimation() {
  animating = false;
  if (animTimer) cancelAnimationFrame(animTimer);
  animTimer = null;
  lastAnimTime = 0;
  updateReelForTime();
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

function onPlay() {
  if (globalTime >= MAX_TIME) return;
  resumeAudioContext();
  stopSfx();
  clearPressed();
  setPressed('play', true);
  state = 'play';
  startMusicAt(globalTime);
  playUiSfx('play');
  startAnimation(1);
}

function onStop() {
  resumeAudioContext();
  stopSfx();
  pauseMusic();
  pendingMusicStart = false;
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
    resumeAudioContext();
    handler();
  });
}

bindButton('play', onPlay);
bindButton('stop', onStop);
bindButton('rewind', () => startScrub('rewind'));
bindButton('ff', () => startScrub('ff'));

playerEl.addEventListener('pointerdown', resumeAudioContext, { passive: true });

function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => {
      if (img.decode) img.decode().then(resolve, resolve);
      else resolve();
    };
    img.src = url;
  });
}

const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loaderFill');
const loaderText = document.getElementById('loaderText');
let loadDone = 0;
let loadTotal = 0;

function bumpLoad() {
  loadDone += 1;
  if (!loaderFill) return;
  const pct = loadTotal ? Math.min(100, Math.round((loadDone / loadTotal) * 100)) : 0;
  loaderFill.style.width = pct + '%';
  if (loaderText) loaderText.textContent = 'Loading… ' + pct + '%';
}

function hideLoader() {
  if (loaderFill) loaderFill.style.width = '100%';
  if (loaderText) loaderText.textContent = 'Ready';
  if (!loaderEl) return;
  setTimeout(() => {
    loaderEl.classList.add('is-hidden');
    setTimeout(() => loaderEl.remove(), 500);
  }, 180);
}

async function preloadEverything() {
  // Set initial frames immediately so they're rendered from the start
  setReelFrame(1);
  setSpinnerFrame(1);

  // Phase 1 — block until everything needed for smooth first play is ready
  const audioTasks = [
    decodeTrack(0),
    decodeSfx('play'),
    decodeSfx('stop'),
    decodeSfx('rewindPress'),
    decodeSfx('ffPress'),
  ];

  // All 6 spinner frames — must be decoded so the swap on play has no glitch
  const spinnerTasks = [];
  for (let i = 1; i <= SPINNER_COUNT; i++) spinnerTasks.push(preloadImage(spinnerUrl(i)));

  // First batch of reel frames — covers the first ~60s of playback
  const reelTasks = [];
  for (let i = 1; i <= 12; i++) reelTasks.push(preloadImage(reelUrl(i)));

  const allTasks = [...audioTasks, ...spinnerTasks, ...reelTasks];
  loadTotal = allTasks.length;

  await Promise.all(allTasks.map((p) => p.then(bumpLoad, bumpLoad)));

  hideLoader();

  // Phase 2 — background, no rush. Loop SFX needed only when scrubbing.
  decodeSfx('rewindLoop');
  decodeSfx('ffLoop');

  // Phase 3 — remaining album tracks
  for (let i = 1; i < TRACKS.length; i++) decodeTrack(i);

  // Phase 4 — remaining reel frames, when the browser is idle
  const warmRest = () => {
    for (let i = 13; i <= REEL_COUNT; i++) {
      if (reelPreload.has(i)) continue;
      reelPreload.add(i);
      const img = new Image();
      img.decoding = 'async';
      img.src = reelUrl(i);
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(warmRest, { timeout: 5000 });
  else setTimeout(warmRest, 2000);
}

preloadEverything();
