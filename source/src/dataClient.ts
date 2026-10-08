import type {
  LandmarkTrajectoryName, RootManifest, SequenceChunk, SequenceManifest,
  SequenceOverview, TriangulatedFeatureBundle,
} from './types';
import { readReplayData } from './replayData';

export class DataClient {
  private readonly chunks = new Map<string, SequenceChunk>();
  private readonly inflight = new Map<string, Promise<SequenceChunk>>();
  private readonly cacheLimit = 6;

  rootManifest(): Promise<RootManifest> { return readReplayData('manifest.json'); }
  sequenceManifest(path: string): Promise<SequenceManifest> { return readReplayData(path); }
  overview(manifest: SequenceManifest): Promise<SequenceOverview> {
    return readReplayData(`${manifest.sequence}/${manifest.overviewPath}`);
  }
  features(manifest: SequenceManifest, source: LandmarkTrajectoryName): Promise<TriangulatedFeatureBundle> {
    const path = manifest.featurePaths[source];
    if (!path) return Promise.reject(new Error(`Missing ${source} landmark bundle in ${manifest.sequence}.`));
    return readReplayData(`${manifest.sequence}/${path}`);
  }
  async chunk(manifest: SequenceManifest, index: number): Promise<SequenceChunk | null> {
    const descriptor = manifest.chunks[index];
    if (!descriptor) return null;
    const key = `${manifest.sequence}:${index}`;
    const cached = this.chunks.get(key);
    if (cached) { this.chunks.delete(key); this.chunks.set(key, cached); return cached; }
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = readReplayData<SequenceChunk>(`${manifest.sequence}/${descriptor.path}`).then(chunk => {
      this.chunks.set(key, chunk);
      while (this.chunks.size > this.cacheLimit) this.chunks.delete(this.chunks.keys().next().value as string);
      return chunk;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
  prefetch(manifest: SequenceManifest, index: number): void {
    for (const neighbor of [index - 1, index + 1]) {
      if (neighbor >= 0 && neighbor < manifest.chunks.length) void this.chunk(manifest, neighbor).catch(() => undefined);
    }
  }
  cacheSize(): number { return this.chunks.size; }
  dispose(): void { this.chunks.clear(); this.inflight.clear(); }
}
