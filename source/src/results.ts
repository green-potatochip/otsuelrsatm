import { readReplayData } from './replayData';

interface Values { vio: number; loop: number; causal: number; optimized: number }
interface Result {
  sequence: string;
  dataset: 'ntu' | 'inhouse';
  label: string;
  stereo: Values;
  monocular: Values;
}
const element = (id: string) => document.getElementById(id)!;
const methods: Array<[keyof Values, string, string]> = [
  ['vio', 'VIO', '#c28a2d'], ['loop', 'VIO (Loop)', '#479575'],
  ['causal', 'Ours (causal)', '#9380ba'], ['optimized', 'Ours (opt)', '#348ea8'],
];
export async function initializeResults(replay: (name: string) => void) {
  const results = await readReplayData<Result[]>('results.json');
  let camera: 'stereo' | 'monocular' = 'stereo';
  const cards = element('all-sequence-results');
  function render() {
    const maximum = Math.ceil(Math.max(...results.flatMap(row => Object.values(row[camera]))) * 10) / 10;
    element('results-scale').textContent = `ATE RMSE (m) · lower is better · all charts share a zero-based 0–${maximum.toFixed(1)} m scale.`;
    cards.innerHTML = ['ntu', 'inhouse'].map(dataset => {
      const rows = results.filter(row => row.dataset === dataset);
      return `<section class="result-group" aria-label="${dataset === 'ntu' ? 'NTU VIRAL' : 'In-house'} results"><div class="result-group-heading"><h3>${dataset === 'ntu' ? 'NTU VIRAL' : 'In-house'}</h3><span>${rows.length} sequences · ${camera}</span></div><div class="sequence-results-grid">${rows.map(row => {
        const values = row[camera], best = Math.min(...Object.values(values));
        return `<article class="sequence-result" data-result-sequence="${row.sequence}"><div class="sequence-result-heading"><h4>${row.label}</h4>${camera === 'stereo' ? `<button data-replay="${row.sequence}" aria-label="Replay ${row.label} stereo log in 3D">3D ↗</button>` : ''}</div><div class="sequence-bars" role="img" aria-label="${row.label}, ${camera} ATE RMSE: ${methods.map(([key, label]) => `${label} ${values[key].toFixed(3)} metres`).join('; ')}">${methods.map(([key, label, color]) => `<div class="paper-bar${values[key] === best ? ' best' : ''}" data-method="${key}" style="--bar-color:${color};--bar-target:${values[key] / maximum * 100}%"><span>${label}</span><i class="paper-track" aria-hidden="true"><i></i></i><b>${values[key].toFixed(3)}</b></div>`).join('')}</div></article>`;
      }).join('')}</div></section>`;
    }).join('');
    document.querySelectorAll<HTMLButtonElement>('[data-camera-results]').forEach(button => {
      const active = button.dataset.cameraResults === camera;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  document.querySelectorAll<HTMLButtonElement>('[data-camera-results]').forEach(button => button.addEventListener('click', () => {
    camera = button.dataset.cameraResults as typeof camera;
    render();
  }));
  cards.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-replay]');
    if (button?.dataset.replay) replay(button.dataset.replay);
  });
  render();
}

