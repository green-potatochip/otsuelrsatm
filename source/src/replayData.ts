import { dataScripts } from './replayCatalog';

interface ReplayPayload { json?: unknown; gzip?: string }
declare global { var __OUR_SLAM_REPLAY__: Map<string, ReplayPayload> | undefined }

const files = globalThis.__OUR_SLAM_REPLAY__ ??= new Map<string, ReplayPayload>();
const scripts = new Map<string, Promise<void>>();

function loadScript(path: string): Promise<void> {
  const group = path.includes('/') ? path.split('/')[0] : '';
  const relative = dataScripts[group];
  if (!relative) return Promise.reject(new Error(`Unknown replay bundle: ${path}`));
  const url = new URL(relative, document.baseURI).href;
  const existing = scripts.get(url);
  if (existing) return existing;
  // Classic scripts are supported by the host's opaque-origin sandbox.
  // Each generated local bundle registers only this project's replay data.
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => { script.remove(); resolve(); };
    script.onerror = () => {
      script.remove();
      scripts.delete(url);
      reject(new Error(`Replay bundle could not be loaded: ${relative}`));
    };
    document.head.append(script);
  });
  scripts.set(url, promise);
  return promise;
}

export async function readReplayData<T>(path: string): Promise<T> {
  await loadScript(path);
  const payload = files.get(path);
  if (!payload) throw new Error(`Missing replay file: ${path}`);
  if ('json' in payload) return payload.json as T;
  if (!payload.gzip) throw new Error(`Empty replay file: ${path}`);
  // Hex preserves compressed bytes when short name filters process text.
  // DecompressionStream decodes locally and makes no network request.
  const bytes = new Uint8Array(payload.gzip.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(payload.gzip.slice(i * 2, i * 2 + 2), 16);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as T;
}
