import './styles.css';
import './page.css';
import './revision.css';
import './refinement.css';
import './viewer-refinement.css';
import { initializeNavigation } from './navigation';
import { initializeResults } from './results';
import { ProjectSceneView as SceneView } from './ProjectSceneView';
import { DataClient } from './dataClient';
import { TimelinePlot } from './TimelinePlot';
import { defaultLayers } from './layers';
import type { HistorySettings, LayerSettings, RootManifest, SequenceManifest, SequenceOverview, RangeEvent } from './types';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const data = new DataClient();
const layers = structuredClone(defaultLayers);
Object.assign(layers.optimized, { color: '#68d3ed', width: 3 });
Object.assign(layers.vio, { color: '#edb45f', width: 2 });
Object.assign(layers.causal, { color: '#b29deb', width: 2.3 });
Object.assign(layers.groundTruth, { color: '#ec858a', width: 1.7, visible: false });
Object.assign(layers.anchors, { color: '#ffd24a', width: 13 });
Object.assign(layers.selected, { color: '#6edf9e', width: 1.2, opacity: 0.55 });
Object.assign(layers.candidates, { color: '#d97982', width: 1.2, opacity: 0.55, visible: true });
Object.assign(layers.features, { color: '#83cfea', width: 2, opacity: 0.7, visible: true });
Object.assign(layers.grid, { color: '#888888', opacity: 0.5, visible: true });

const history: HistorySettings = {
  trajectory: 'cumulative', ranges: 'trail-5', rangeOrigin: 'camera', rangeAnchor: 'playhead',
  rangeInitialization: 'post-init', landmarkTrajectory: 'optimized_uwb', features: 'cumulative',
  featureColorMode: 'axis-z', featureReprojectionThresholdPx: 1.5, featureObservationThreshold: 20,
};
const layerLabels: Array<[keyof LayerSettings, string]> = [
  ['vio', 'VIO only'], ['causal', 'Causal UWB'], ['optimized', 'Optimized UWB'], ['selected', 'Accepted ranges'],
  ['candidates', 'Rejected candidates'], ['anchors', 'Anchors'], ['groundTruth', 'Aligned GT'], ['features', 'Landmarks'],
];
const exampleLayers = [
  ['vio'], ['vio', 'anchors', 'selected'],
  ['vio', 'anchors', 'selected', 'candidates'],
  ['vio', 'causal', 'optimized', 'anchors', 'selected', 'features'],
];

let root: RootManifest;
let manifest: SequenceManifest | null = null;
let overview: SequenceOverview | null = null;
let scene: SceneView | null = null;
let plot: TimelinePlot | null = null;
let playhead = 0;
let playing = false;
let ready = false;
let sequenceRequest = 0;
let cameraView: 'iso' | 'xy' | 'xz' = 'iso';
let lastUpdate = 0;
let fullscreenErrorTimer: ReturnType<typeof setTimeout> | undefined;
let alive = true;
let nearViewport = true;

const sequence = el('sequence');
const scrubber = el<HTMLInputElement>('scrubber');
const play = el<HTMLButtonElement>('play');
const status = el('scene-status');
const disposeNavigation = initializeNavigation();

document.querySelector('.layer-controls')!.innerHTML = layerLabels.map(([key, label]) =>
  `<label style="--color:${layers[key].color}"><input type="checkbox" data-layer="${key}" ${layers[key].visible ? 'checked' : ''}>${label}</label>`,
).join('');

function updateLegend() {
  const heights = scene?.getLandmarkHeightBounds();
  const markup = layerLabels.filter(([key]) => layers[key].visible).map(([key, label]) =>
    key === 'features'
      ? `<span class="height-legend"><i aria-hidden="true"></i>Landmarks · z ${heights ? `≤ ${heights[0].toFixed(1)} → ≥ ${heights[1].toFixed(1)} m` : ''}</span>`
      : `<span style="--color:${layers[key].color}"><i aria-hidden="true"></i>${label}</span>`,
  );
  if (history.rangeOrigin === 'antenna') markup.push('<span style="--color:#75bced"><i class="sensor-node" aria-hidden="true"></i>Body</span><span style="--color:#f4e3c2"><i class="sensor-node" aria-hidden="true"></i>Antenna</span>');
  markup.push('<span style="--color:#888888"><i aria-hidden="true"></i>Grid · z = 0</span>');
  el('scene-legend').innerHTML = markup.join('');
  document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach(input => {
    input.checked = layers[input.dataset.layer as keyof LayerSettings].visible;
  });
}

function pause() {
  playing = false;
  play.textContent = '▶';
  play.setAttribute('aria-label', 'Play experiment');
  play.setAttribute('aria-pressed', 'false');
}

function seek(time: number) {
  if (!manifest || !ready) return;
  playhead = Math.max(0, Math.min(manifest.duration, time));
  draw();
}

function nearestEvent(time: number): RangeEvent | null {
  const events = overview?.rangeMetrics;
  if (!events?.length) return null;
  let left = 0, right = events.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (events[middle].t < time) left = middle + 1;
    else right = middle;
  }
  const before = events[Math.max(0, left - 1)], after = events[Math.min(events.length - 1, left)];
  return Math.abs(before.t - time) <= Math.abs(after.t - time) ? before : after;
}

function format(value: number | null | undefined, suffix = '', digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(digits)}${suffix}`;
}

function draw() {
  if (!scene || !overview || !manifest) return;
  const stats = scene.update(playhead, [], history);
  el('scene').dataset.rangeLinks = String(stats.selectedSegments + stats.candidateSegments);
  el('scene').dataset.selectedLinks = String(stats.selectedSegments);
  el('scene').dataset.candidateLinks = String(stats.candidateSegments);
  el('scene').dataset.trajectoryPoints = String(stats.trajectoryPoints);
  el('scene').dataset.featurePoints = String(stats.featurePoints);
  el('scene').dataset.sequence = manifest.sequence;
  el('scene').dataset.playhead = String(playhead);
  plot?.setTime(playhead);
  scrubber.value = String(playhead);
  el('time').textContent = `${playhead.toFixed(1)} s`;
  const anchorIds = new Set(overview.anchorHistory.filter(anchor => anchor.t <= playhead).map(anchor => anchor.id));
  el('anchor-count').textContent = `${anchorIds.size} / ${overview.finalAnchors.length}`;
  el('range-count').textContent = String((layers.selected.visible ? stats.selectedSegments : 0) + (layers.candidates.visible ? stats.candidateSegments : 0));
  const event = nearestEvent(playhead);
  if (!event) {
    el('event-state').textContent = 'No recorded event';
    el('event-detail').textContent = 'No range decisions are available for this sequence.';
    el('event-offset').textContent = '';
    return;
  }
  el('event-offset').textContent = `(Δt ${Math.abs(event.t - playhead).toFixed(3)} s)`;
  el('event-state').textContent = `${event.selected ? 'Accepted' : 'Not selected'} · anchor ${event.anchorId} / tag ${event.tagId}`;
  el('event-state').style.color = event.selected ? '#6edf9e' : '#dca2aa';
  el('event-detail').textContent = `${event.reason.replaceAll('_', ' ')} · range ${format(event.distance, ' m', 2)} · log-det ${format(event.logdet)} · weight ${format(event.informationScale, '', 2)}`;
}

function focusExample(index: number) {
  pause();
  history.trajectory = 'cumulative';
  for (const [key] of layerLabels) layers[key].visible = exampleLayers[index].includes(key);
  scene?.applySettings(layers);
  updateLegend();
  if (!ready || !manifest || !overview) return;
  const initialization = overview.initialization.find(event => event.registered > 0);
  const rejection = overview.rangeMetrics.find(event => !event.selected && event.tag && event.anchor && event.logdet !== null && event.t > (initialization?.t ?? 0) + 5);
  seek(index === 1 && initialization ? initialization.t + 1 : index === 2 && rejection ? rejection.t : manifest.duration * [0.55, 0.35, 0.65, 0.75][index]);
}

async function loadSequence(name: string) {
  const request = ++sequenceRequest;
  pause();
  ready = false;
  el('current-sequence').textContent = displayName(name);
  sequence.querySelectorAll<HTMLButtonElement>('[data-viewer-sequence]').forEach(button => {
    const active = button.dataset.viewerSequence === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  scrubber.disabled = play.disabled = true;
  el<HTMLButtonElement>('next-event').disabled = true;
  status.hidden = false;
  status.textContent = `Loading ${displayName(name)}…`;
  el('scene').dataset.ready = 'false';
  el('feature-inspector').hidden = true;
  try {
    const entry = root.sequences.find(item => item.name === name);
    if (!entry) throw new Error('The selected sequence is unavailable.');
    const nextManifest = await data.sequenceManifest(entry.manifestPath);
    const [nextOverview, features] = await Promise.all([data.overview(nextManifest), data.features(nextManifest, 'optimized_uwb')]);
    if (request !== sequenceRequest || !alive) return;
    if (!scene) {
      scene = new SceneView(el('scene'), layers, message => {
        pause(); ready = false; status.hidden = false; status.textContent = message;
      }, feature => {
        const inspector = el('feature-inspector');
        inspector.hidden = !feature;
        if (feature) inspector.textContent = `Landmark ${feature.id} · z ${feature.p[2].toFixed(2)} m · ${feature.observations} observations · reprojection RMSE ${feature.reprojectionRmsePx.toFixed(2)} px · track ${feature.firstT.toFixed(1)}–${feature.lastT.toFixed(1)} s.`;
      });
      scene.setBackgroundColor('#0b101a');
      scene.setDepthContrast(0.25);
      plot = new TimelinePlot(el<HTMLCanvasElement>('timeline'), time => { pause(); seek(time); });
    }
    manifest = nextManifest;
    overview = nextOverview;
    scene.setOverview(overview, features);
    scene.applySettings(layers);
    scene.setCameraFollow('manual', 0);
    scene.fit(cameraView);
    plot?.setData(overview, manifest.duration);
    scrubber.max = String(manifest.duration);
    el('duration').textContent = `${manifest.duration.toFixed(1)} s`;
    ready = true;
    status.hidden = true;
    scrubber.disabled = play.disabled = false;
    el<HTMLButtonElement>('next-event').disabled = false;
    el('scene').dataset.ready = 'true';
    updateLegend();
    seek(manifest.duration * 0.75);
  } catch (error) {
    if (request !== sequenceRequest) return;
    status.hidden = false;
    status.textContent = `Unable to load the 3D experiment.\n${error instanceof Error ? error.message : String(error)}\nChoose another sequence or reload the page. A browser with WebGL2 is required.`;
  }
}

function displayName(name: string) {
  return name.startsWith('inhouse_') ? `In-house · ${name.replace('inhouse_', '')}` : `NTU VIRAL · ${name}`;
}

function nextEvent(selected: boolean) {
  if (!overview || !manifest) return;
  const currentOverview = overview;
  const events = currentOverview.rangeMetrics.filter(event => event.selected === selected && event.tag && event.anchor && event.t >= (currentOverview.anchorHistory.find(anchor => anchor.id === event.anchorId)?.t ?? Infinity));
  const next = events.find(event => event.t > playhead + 0.03) ?? events[0];
  if (next) { pause(); seek(next.t); }
  else {
    el('event-state').textContent = `No ${selected ? 'accepted' : 'rejected'} range with initialized geometry`;
    el('event-detail').textContent = 'Try another sequence or move the playhead.';
  }
}

document.querySelectorAll<HTMLAnchorElement>('[data-jump-step]').forEach(link => link.addEventListener('click', () => focusExample(Number(link.dataset.jumpStep))));
document.querySelectorAll<HTMLButtonElement>('[data-pipeline-step]').forEach(button => button.addEventListener('click', () => {
  focusExample(Number(button.dataset.pipelineStep));
  el('explore').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}));
document.querySelectorAll<HTMLInputElement>('[data-layer]').forEach(input => input.addEventListener('change', () => {
  layers[input.dataset.layer as keyof LayerSettings].visible = input.checked;
  scene?.applySettings(layers); updateLegend(); draw();
}));
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  cameraView = button.dataset.view as typeof cameraView;
  scene?.fit(cameraView);
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(other => {
    other.classList.toggle('active', other === button);
    other.setAttribute('aria-pressed', String(other === button));
  });
}));
el('fit').addEventListener('click', () => scene?.fit(cameraView));
el('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (el('scene').requestFullscreen) await el('scene').requestFullscreen();
    else throw new Error('Fullscreen is unavailable in this browser.');
  } catch {
    status.textContent = 'Fullscreen is unavailable in this browser. The 3D viewer remains usable here.';
    status.hidden = false;
    clearTimeout(fullscreenErrorTimer);
    fullscreenErrorTimer = setTimeout(() => { if (ready) status.hidden = true; }, 3500);
  }
});
sequence.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-viewer-sequence]');
  if (button?.dataset.viewerSequence) void loadSequence(button.dataset.viewerSequence);
});
scrubber.addEventListener('input', () => { pause(); seek(Number(scrubber.value)); });
play.addEventListener('click', () => {
  if (!ready || !manifest) return;
  if (playing) { pause(); return; }
  if (playhead >= manifest.duration - 0.05) seek(0);
  playing = true;
  play.textContent = 'Ⅱ';
  play.setAttribute('aria-label', 'Pause experiment');
  play.setAttribute('aria-pressed', 'true');
});
el<HTMLSelectElement>('range-history').addEventListener('change', event => {
  history.ranges = (event.target as HTMLSelectElement).value as HistorySettings['ranges']; draw();
});
el<HTMLSelectElement>('range-origin').addEventListener('change', event => {
  history.rangeOrigin = (event.target as HTMLSelectElement).value as HistorySettings['rangeOrigin']; updateLegend(); draw();
});
el('next-event').addEventListener('click', () => nextEvent(true));

document.addEventListener('keydown', event => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes((event.target as HTMLElement).tagName) || (event.target as HTMLElement).isContentEditable) return;
  if (!nearViewport || !ready) return;
  if (event.code === 'Space') { event.preventDefault(); play.click(); }
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); pause(); seek(playhead + (event.code === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5 : 0.1)); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
const visibilityObserver = new IntersectionObserver(entries => {
  nearViewport = entries[0].isIntersecting;
  if (!nearViewport) pause();
}, { threshold: 0.05 });
visibilityObserver.observe(el('scene'));

function animate(now: number) {
  if (!alive) return;
  const elapsed = Math.min((now - lastUpdate) / 1000, 0.1);
  lastUpdate = now;
  if (playing && ready && manifest && nearViewport) {
    seek(playhead + elapsed * Number(el<HTMLSelectElement>('speed').value));
    if (playhead >= manifest.duration) pause();
  }
  requestAnimationFrame(animate);
}

async function initialize() {
  updateLegend();
  try {
    root = await data.rootManifest();
    sequence.innerHTML = ['ntu', 'inhouse'].map(dataset => `<div class="sequence-group"><span>${dataset === 'ntu' ? 'NTU VIRAL' : 'In-house'}</span><div>${root.sequences.filter(entry => entry.name.startsWith('inhouse_') === (dataset === 'inhouse')).map(entry => `<button data-viewer-sequence="${entry.name}" aria-pressed="false">${entry.name.replace('inhouse_', '')}</button>`).join('')}</div></div>`).join('');
    void initializeResults(name => {
      el('explore').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      void loadSequence(name);
    }).catch(error => {
      el('results-scale').textContent = error instanceof Error ? error.message : 'Results are unavailable. Reload to retry.';
      el('all-sequence-results').textContent = 'Results could not be loaded. Reload to retry.';
    });
    await loadSequence('eee_03');
  } catch (error) {
    status.textContent = `Experiment data is unavailable. ${error instanceof Error ? error.message : String(error)} Reload to retry.`;
    status.hidden = false;
  }
}

window.addEventListener('pagehide', () => {
  alive = false; pause(); clearTimeout(fullscreenErrorTimer);
  visibilityObserver.disconnect(); disposeNavigation(); scene?.dispose(); plot?.dispose(); data.dispose();
});
// A restored back/forward-cache page has disposed its renderer.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
void initialize();
requestAnimationFrame(animate);
