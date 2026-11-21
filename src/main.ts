import './style.css';
import { FILTERS } from './filters';
import { Renderer } from './renderer';
import { canShare, isNative, saveCapture, saveLabel, shareCapture, type Capture } from './save';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- elements ----------
const gate = $('gate');
const gateBtn = $<HTMLButtonElement>('gate-btn');
const gateMsg = $('gate-msg');
const gateHelp = $('gate-help');
const cameraScreen = $('camera');
const reviewScreen = $('review');
const galleryScreen = $('gallery');
const view = $<HTMLCanvasElement>('view');
const video = $<HTMLVideoElement>('src');
const thumbs = $<HTMLCanvasElement>('thumbs');
const track = $('carousel-track');
const carousel = $('carousel');
const filterName = $('filter-name');
const amountRow = $('amount-row');
const amount = $<HTMLInputElement>('amount');
const shutter = $<HTMLButtonElement>('shutter');
const flipBtn = $<HTMLButtonElement>('flip');
const lastBtn = $<HTMLButtonElement>('last');
const lastCount = $('last-count');
const timerBtn = $<HTMLButtonElement>('timer-btn');
const timerLabel = $('timer-label');
const recPill = $('rec-pill');
const recTime = $('rec-time');
const flash = $('flash');
const countdownEl = $('countdown');
const toastEl = $('toast');

// ---------- state ----------
type Mode = 'photo' | 'video';
const state = {
  stream: null as MediaStream | null,
  audio: null as MediaStream | null,
  audioDenied: false,
  facing: 'user' as 'user' | 'environment',
  mirror: true,
  filter: 0,
  amount: 1,
  mode: 'photo' as Mode,
  timer: 0,
  busy: false,
  recorder: null as MediaRecorder | null,
  recStart: 0,
  captures: [] as Capture[],
  reviewing: null as Capture | null,
  startTime: performance.now(),
  hasMultipleCameras: true,
};

const THUMB = 60; // css px
const GAP = 12;
const MAX_REC_SECONDS = 180;

let main: Renderer;
let strip: Renderer | null = null;

// ---------- utilities ----------
let toastTimer = 0;
function toast(msg: string, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

function show(screen: HTMLElement) {
  for (const s of [gate, cameraScreen, reviewScreen, galleryScreen]) s.hidden = s !== screen;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- camera ----------
function stopStream() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

async function openCamera(facing = state.facing) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Camera API unavailable'), { name: 'NotSupportedError' });
  }
  stopStream();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  });
  state.stream = stream;
  const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
  // Laptops/webcams don't report a facing mode; treat them like a selfie camera.
  const actual = (settings.facingMode as string | undefined) ?? (facing === 'environment' ? 'environment' : 'user');
  state.facing = actual === 'environment' ? 'environment' : 'user';
  state.mirror = state.facing === 'user';
  video.srcObject = stream;
  await video.play().catch(() => {});

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  state.hasMultipleCameras = devices.filter((d) => d.kind === 'videoinput').length > 1;
  flipBtn.disabled = !state.hasMultipleCameras;
}

function explainError(err: unknown) {
  const name = (err as { name?: string })?.name ?? '';
  gateBtn.textContent = 'Try again';
  gateHelp.hidden = false;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    gateMsg.textContent = 'Camera access was blocked.';
    gateHelp.innerHTML = /iPhone|iPad/.test(navigator.userAgent)
      ? 'Open <b>Settings → VinCam</b> (or Safari → Camera) and allow the camera, then tap <b>Try again</b>.'
      : 'Tap the camera / lock icon next to the address bar (or open your phone’s <b>Settings → Apps → VinCam → Permissions</b>) and allow the camera, then tap <b>Try again</b>.';
  } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    gateMsg.textContent = 'No camera was found on this device.';
    gateHelp.textContent = 'Connect a camera and try again.';
  } else if (name === 'NotReadableError') {
    gateMsg.textContent = 'Your camera is being used by another app.';
    gateHelp.textContent = 'Close the other app and try again.';
  } else if (name === 'NotSupportedError' || !window.isSecureContext) {
    gateMsg.textContent = 'This browser can’t open the camera here.';
    gateHelp.textContent = 'Open VinCam over HTTPS (or install the app) in a modern browser.';
  } else {
    gateMsg.textContent = 'Something went wrong starting the camera.';
    gateHelp.textContent = String((err as Error)?.message ?? err);
  }
}

async function enterCamera() {
  gateBtn.disabled = true;
  gateBtn.textContent = 'Waiting for permission…';
  try {
    await openCamera();
    try {
      localStorage.setItem('vincam.granted', '1');
    } catch {}
    show(cameraScreen);
    resize();
    startLoop();
  } catch (err) {
    explainError(err);
    show(gate);
  } finally {
    gateBtn.disabled = false;
    if (!gate.hidden && gateBtn.textContent === 'Waiting for permission…') gateBtn.textContent = 'Allow camera access';
  }
}

async function flipCamera() {
  if (state.recorder || state.busy) return;
  state.busy = true;
  cameraScreen.classList.add('switching');
  try {
    await openCamera(state.facing === 'user' ? 'environment' : 'user');
  } catch {
    toast('Could not switch camera');
    await openCamera().catch(() => {});
  } finally {
    state.busy = false;
    setTimeout(() => cameraScreen.classList.remove('switching'), 150);
  }
}

// ---------- rendering ----------
function resize() {
  if (state.recorder) return; // keep a fixed frame size while recording
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let w = view.clientWidth * dpr;
  let h = view.clientHeight * dpr;
  const scale = Math.min(1, 1920 / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  if (view.width !== w || view.height !== h) {
    view.width = w;
    view.height = h;
  }
  if (strip) {
    const tdpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = FILTERS.length * (THUMB + GAP) - GAP;
    thumbs.style.width = `${cssW}px`;
    thumbs.style.height = `${THUMB}px`;
    thumbs.width = Math.round(cssW * tdpr);
    thumbs.height = Math.round(THUMB * tdpr);
  }
}

function drawMain() {
  const t = (performance.now() - state.startTime) / 1000;
  main.draw({
    filter: state.filter,
    x: 0,
    y: 0,
    w: view.width,
    h: view.height,
    mirror: state.mirror,
    amount: state.amount,
    time: t,
  });
}

let lastThumb = 0;
function drawThumbs(now: number) {
  if (!strip || now - lastThumb < 100 || carousel.offsetParent === null) return;
  lastThumb = now;
  if (!strip.upload(video)) return;
  const scale = thumbs.width / (FILTERS.length * (THUMB + GAP) - GAP);
  const size = Math.round(THUMB * scale);
  const t = (now - state.startTime) / 1000;
  strip.clear();
  FILTERS.forEach((_, i) => {
    strip!.draw({
      filter: i,
      x: Math.round(i * (THUMB + GAP) * scale),
      y: 0,
      w: size,
      h: size,
      mirror: state.mirror,
      amount: 1,
      time: t,
      round: 14 * scale,
    });
  });
}

let raf = 0;
function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (cameraScreen.hidden && !state.recorder) return;
  if (main.upload(video)) drawMain();
  drawThumbs(now);
  if (state.recorder) {
    const secs = Math.floor((Date.now() - state.recStart) / 1000);
    recTime.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    if (secs >= MAX_REC_SECONDS) stopRecording();
  }
}
function startLoop() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

// ---------- filters UI ----------
function buildCarousel() {
  FILTERS.forEach((f, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.style.left = `${i * (THUMB + GAP)}px`;
    b.style.width = `${THUMB}px`;
    b.dataset.index = String(i);
    b.setAttribute('aria-label', `${f.name} filter`);
    b.innerHTML = `<span>${f.name}</span>`;
    b.addEventListener('click', () => selectFilter(i));
    track.appendChild(b);
  });
  track.style.width = `${FILTERS.length * (THUMB + GAP) - GAP}px`;
}

let nameTimer = 0;
function selectFilter(i: number, scroll = true) {
  state.filter = (i + FILTERS.length) % FILTERS.length;
  track.querySelectorAll<HTMLElement>('.chip').forEach((c, j) => c.classList.toggle('active', j === state.filter));
  amountRow.classList.toggle('hidden', state.filter === 0);
  filterName.textContent = FILTERS[state.filter].name;
  filterName.classList.add('show');
  clearTimeout(nameTimer);
  nameTimer = window.setTimeout(() => filterName.classList.remove('show'), 900);
  if (scroll) {
    // the carousel has half-width spacers on both sides, so chip i is centred at scrollLeft = its offset
    const x = state.filter * (THUMB + GAP);
    carousel.scrollTo({ left: x, behavior: 'smooth' });
  }
  try {
    localStorage.setItem('vincam.filter', FILTERS[state.filter].id);
  } catch {}
}

// Swipe left/right on the viewfinder to change filter, double-tap to flip.
function bindGestures() {
  let sx = 0, sy = 0, st = 0, lastTap = 0;
  view.addEventListener('pointerdown', (e) => {
    sx = e.clientX;
    sy = e.clientY;
    st = performance.now();
  });
  view.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - st < 600) {
      selectFilter(state.filter + (dx < 0 ? 1 : -1));
      return;
    }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const now = performance.now();
      if (now - lastTap < 300) {
        if (state.hasMultipleCameras) flipCamera();
        lastTap = 0;
      } else lastTap = now;
    }
  });
}

// ---------- capture ----------
function addCapture(c: Omit<Capture, 'id' | 'url' | 'createdAt' | 'saved'>) {
  const cap: Capture = {
    ...c,
    id: Math.random().toString(36).slice(2),
    url: URL.createObjectURL(c.blob),
    createdAt: new Date(),
    saved: false,
  };
  state.captures.unshift(cap);
  updateLastThumb();
  return cap;
}

function updateLastThumb() {
  const c = state.captures[0];
  lastBtn.style.backgroundImage = '';
  lastBtn.querySelector('video')?.remove();
  if (!c) {
    lastBtn.classList.remove('has');
    lastCount.hidden = true;
    return;
  }
  lastBtn.classList.add('has');
  if (c.kind === 'photo') lastBtn.style.backgroundImage = `url(${c.url})`;
  else {
    const v = document.createElement('video');
    v.src = c.url;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    lastBtn.prepend(v);
  }
  lastCount.hidden = state.captures.length < 2;
  lastCount.textContent = String(state.captures.length);
}

async function runCountdown() {
  if (!state.timer) return;
  countdownEl.hidden = false;
  for (let s = state.timer; s > 0; s--) {
    countdownEl.textContent = String(s);
    countdownEl.classList.remove('tick');
    void countdownEl.offsetWidth;
    countdownEl.classList.add('tick');
    await sleep(1000);
  }
  countdownEl.hidden = true;
}

async function takePhoto() {
  if (state.busy) return;
  state.busy = true;
  shutter.disabled = true;
  try {
    await runCountdown();
    if (!main.upload(video)) throw new Error('Camera not ready');
    drawMain(); // draw and read back in the same task so the buffer is intact
    const blob = await new Promise<Blob | null>((r) => view.toBlob(r, 'image/jpeg', 0.93));
    if (!blob) throw new Error('Could not encode photo');
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    navigator.vibrate?.(15);
    const cap = addCapture({ kind: 'photo', blob, ext: 'jpg', filter: FILTERS[state.filter].id });
    openReview(cap);
  } catch (e) {
    toast(`Photo failed: ${(e as Error).message}`);
  } finally {
    state.busy = false;
    shutter.disabled = false;
  }
}

function pickMime() {
  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';
}

async function ensureMic() {
  if (state.audio || state.audioDenied) return state.audio;
  try {
    state.audio = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch {
    state.audioDenied = true;
    toast('Microphone blocked — recording without sound');
  }
  return state.audio;
}

async function startRecording() {
  if (state.busy || state.recorder) return;
  if (!window.MediaRecorder || !view.captureStream) {
    toast('Video recording is not supported in this browser');
    return;
  }
  state.busy = true;
  try {
    const mic = await ensureMic();
    await runCountdown();
    const out = view.captureStream(30);
    mic?.getAudioTracks().forEach((t) => out.addTrack(t));
    const mimeType = pickMime();
    const rec = new MediaRecorder(out, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      out.getVideoTracks().forEach((t) => t.stop());
      const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
      const blob = new Blob(chunks, { type });
      setRecordingUI(false);
      state.recorder = null;
      resize();
      if (!blob.size) return toast('Recording was empty');
      const cap = addCapture({
        kind: 'video',
        blob,
        ext: type.includes('mp4') ? 'mp4' : 'webm',
        filter: FILTERS[state.filter].id,
      });
      openReview(cap);
    };
    rec.start(500);
    state.recorder = rec;
    state.recStart = Date.now();
    recTime.textContent = '00:00';
    setRecordingUI(true);
    navigator.vibrate?.(20);
  } catch (e) {
    toast(`Recording failed: ${(e as Error).message}`);
    state.recorder = null;
    setRecordingUI(false);
  } finally {
    state.busy = false;
  }
}

function stopRecording() {
  const rec = state.recorder;
  if (rec && rec.state !== 'inactive') {
    rec.requestData?.();
    rec.stop();
  }
}

function setRecordingUI(on: boolean) {
  cameraScreen.classList.toggle('recording', on);
  recPill.hidden = !on;
  shutter.setAttribute('aria-label', on ? 'Stop recording' : state.mode === 'photo' ? 'Take photo' : 'Start recording');
}

function setMode(mode: Mode) {
  if (state.recorder) return;
  state.mode = mode;
  cameraScreen.dataset.mode = mode;
  document.querySelectorAll<HTMLElement>('.mode').forEach((m) => m.classList.toggle('active', m.dataset.mode === mode));
  shutter.setAttribute('aria-label', mode === 'photo' ? 'Take photo' : 'Start recording');
}

// ---------- review & gallery ----------
let reviewFromGallery = false;
function openReview(c: Capture, fromGallery = false) {
  reviewFromGallery = fromGallery;
  state.reviewing = c;
  const media = $('review-media');
  media.innerHTML = '';
  if (c.kind === 'photo') {
    const img = new Image();
    img.src = c.url;
    img.alt = 'Captured photo';
    media.appendChild(img);
  } else {
    const v = document.createElement('video');
    v.src = c.url;
    v.controls = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    media.appendChild(v);
  }
  const f = FILTERS.find((x) => x.id === c.filter)?.name ?? '';
  $('review-meta').textContent = `${c.kind === 'photo' ? 'Photo' : 'Video'} · ${f}`;
  $('review-share').hidden = !canShare(c);
  renderSaveState(c);
  show(reviewScreen);
}

function renderSaveState(c: Capture) {
  const btn = $<HTMLButtonElement>('review-save');
  btn.classList.toggle('done', c.saved);
  $('save-label').textContent = c.saved ? '✓ Saved' : saveLabel();
}

function closeReview() {
  $('review-media')
    .querySelectorAll('video')
    .forEach((v) => v.pause());
  state.reviewing = null;
  if (reviewFromGallery && state.captures.length) openGallery();
  else {
    show(cameraScreen);
    resize();
  }
}

async function doSave(c: Capture, quiet = false) {
  try {
    const r = await saveCapture(c);
    c.saved = true;
    if (!quiet) {
      toast(
        r === 'gallery'
          ? `Saved to your gallery (VinCam album)`
          : r === 'shared'
            ? 'Choose “Save Image/Video” to add it to Photos'
            : 'Saved to your Downloads',
      );
    }
    return true;
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.name === 'AbortError') return false; // user dismissed the share sheet
    toast(
      err.code === 'accessDenied'
        ? 'Allow photo access in Settings to save to your gallery'
        : `Could not save: ${err.message}`,
      3500,
    );
    return false;
  }
}

function deleteCapture(c: Capture) {
  state.captures = state.captures.filter((x) => x !== c);
  URL.revokeObjectURL(c.url);
  updateLastThumb();
}

function openGallery() {
  if (!state.captures.length) {
    toast('Your captures will appear here');
    return;
  }
  const grid = $('grid');
  grid.innerHTML = '';
  for (const c of state.captures) {
    const b = document.createElement('button');
    b.className = 'cell' + (c.saved ? ' saved' : '');
    if (c.kind === 'photo') b.style.backgroundImage = `url(${c.url})`;
    else {
      const v = document.createElement('video');
      v.src = c.url;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      b.appendChild(v);
      b.insertAdjacentHTML('beforeend', '<span class="vid">▶</span>');
    }
    b.insertAdjacentHTML('beforeend', '<span class="tick">✓</span>');
    b.addEventListener('click', () => openReview(c, true));
    grid.appendChild(b);
  }
  show(galleryScreen);
}

// ---------- wiring ----------
function bindUI() {
  gateBtn.addEventListener('click', enterCamera);

  shutter.addEventListener('click', () => {
    if (state.mode === 'photo') takePhoto();
    else if (state.recorder) stopRecording();
    else startRecording();
  });
  flipBtn.addEventListener('click', flipCamera);
  lastBtn.addEventListener('click', openGallery);
  document.querySelectorAll<HTMLElement>('.mode').forEach((m) =>
    m.addEventListener('click', () => setMode(m.dataset.mode as Mode)),
  );

  const timers = [0, 3, 10];
  timerBtn.addEventListener('click', () => {
    state.timer = timers[(timers.indexOf(state.timer) + 1) % timers.length];
    timerLabel.hidden = !state.timer;
    timerLabel.textContent = `${state.timer}s`;
    timerBtn.classList.toggle('on', !!state.timer);
    toast(state.timer ? `Self-timer: ${state.timer} seconds` : 'Self-timer off', 1200);
  });

  amount.addEventListener('input', () => (state.amount = Number(amount.value) / 100));

  $('review-close').addEventListener('click', closeReview);
  $('review-delete').addEventListener('click', () => {
    if (!state.reviewing) return;
    deleteCapture(state.reviewing);
    toast('Deleted');
    closeReview();
  });
  $('review-save').addEventListener('click', async (e) => {
    const c = state.reviewing;
    const btn = e.currentTarget as HTMLButtonElement;
    if (!c || btn.disabled) return;
    btn.disabled = true;
    $('save-label').textContent = 'Saving…';
    await doSave(c);
    btn.disabled = false;
    if (state.reviewing === c) renderSaveState(c);
  });
  $('review-share').addEventListener('click', async () => {
    if (!state.reviewing) return;
    try {
      await shareCapture(state.reviewing);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Sharing failed');
    }
  });

  $('gallery-close').addEventListener('click', () => {
    show(cameraScreen);
    resize();
  });
  $('save-all').addEventListener('click', async () => {
    const pending = state.captures.filter((c) => !c.saved);
    if (!pending.length) return toast('Everything is already saved');
    let ok = 0;
    for (const c of pending) if (await doSave(c, true)) ok++;
    toast(`Saved ${ok} of ${pending.length}`);
    openGallery();
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  // Release the camera when the app goes to the background; reopen when it returns.
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      if (state.recorder) stopRecording();
      stopStream();
    } else if (!cameraScreen.hidden || !reviewScreen.hidden || !galleryScreen.hidden) {
      await openCamera().catch(() => toast('Camera unavailable — tap to retry'));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (cameraScreen.hidden) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      shutter.click();
    } else if (e.key === 'ArrowRight') selectFilter(state.filter + 1);
    else if (e.key === 'ArrowLeft') selectFilter(state.filter - 1);
  });
}

async function init() {
  try {
    main = new Renderer(view, FILTERS);
    main.warmUp();
  } catch (e) {
    gateMsg.textContent = 'Your device doesn’t support the graphics features VinCam needs (WebGL).';
    gateBtn.hidden = true;
    console.error(e);
    return;
  }
  try {
    strip = new Renderer(thumbs, FILTERS, true);
  } catch {
    strip = null; // thumbnails are optional; chips still show names
  }

  buildCarousel();
  bindUI();
  bindGestures();
  setMode('photo');
  updateLastThumb();

  let saved = 0;
  try {
    const id = localStorage.getItem('vincam.filter');
    saved = Math.max(0, FILTERS.findIndex((f) => f.id === id));
  } catch {}
  selectFilter(saved, false);
  filterName.classList.remove('show');

  // If permission was already granted, skip the intro and go straight to the camera.
  let granted = false;
  try {
    const p = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    granted = p?.state === 'granted';
  } catch {}
  if (!granted && isNative()) {
    try {
      granted = localStorage.getItem('vincam.granted') === '1';
    } catch {}
  }
  if (granted) {
    gate.classList.add('auto');
    await enterCamera();
    gate.classList.remove('auto');
  } else show(gate);
}

init();
