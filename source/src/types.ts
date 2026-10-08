export type TrajectoryName = 'optimized_uwb' | 'causal_uwb' | 'vio_only';

export interface PoseSample {
  t: number;
  p: [number, number, number];
  q: [number, number, number, number];
}

export interface PositionSample {
  t: number;
  p: [number, number, number];
}

export interface AlignedGroundTruth {
  trajectory: PositionSample[];
  frame: 'optimized_uwb_camera0';
  source: string;
  alignmentReference: 'optimized_uwb';
  association: string;
  dtmax: number;
  prismCompensation: true;
  cameraLeverArmTransfer: string;
  usedPairs: number;
  gtRows: number;
  ateRmseM: number;
  estimateToGtRotation: number[][];
  estimateToGtTranslation: [number, number, number];
}

export interface FrameSummary {
  id: number;
  t: number;
  observations: number;
  uniqueFeatures: number;
  processed: boolean;
}

export interface RawRange {
  id: number;
  t: number;
  anchorId: number;
  tagId: number | null;
  distance: number | null;
  forwarded: boolean;
  reason: string;
}

export interface RangeEvent {
  id: number;
  t: number;
  anchorId: number;
  tagId: number;
  selected: boolean;
  reason: string;
  distance: number | null;
  logdet: number | null;
  informationScale: number | null;
  effectiveSigma: number | null;
  residual: number | null;
  selectorRuntimeUs: number | null;
  discarded: number;
  tag: [number, number, number] | null;
  anchor: [number, number, number] | null;
}

export interface BackendFrame {
  t: number;
  index: number;
  runtimeMs: number | null;
  pendingFactors: number;
  pendingValues: number;
  pose: [number, number, number] | null;
  q: [number, number, number, number] | null;
}

export interface AnchorEstimate {
  t: number;
  updateIndex: number;
  id: number;
  p: [number, number, number];
  bias: number | null;
  optimized: boolean;
}

export interface RuntimeSample {
  t: number;
  runtimeMs: number | null;
  pendingFactors: number;
}

export interface InitializationEvent {
  t: number;
  registered: number;
  total: number;
  complete: boolean;
}

export interface SequenceOverview {
  version: number;
  sequence: string;
  trajectories: Record<TrajectoryName, PoseSample[]>;
  bodyTrajectories: Record<TrajectoryName, PoseSample[]>;
  trajectoryFrame: {
    name: 'camera0';
    cameraId: 0;
    cameraTopic: string;
    poseConvention: string;
    bodyTCamera: number[][];
  };
  alignedGroundTruth: AlignedGroundTruth;
  frames: FrameSummary[];
  rangeMetrics: RangeEvent[];
  backendRuntime: RuntimeSample[];
  anchorHistory: AnchorEstimate[];
  initialization: InitializationEvent[];
  finalAnchors: Array<{ id: number; p: [number, number, number]; bias: number | null }>;
  metrics: Record<string, unknown>;
}

export interface SequenceChunk {
  version: number;
  sequence: string;
  index: number;
  start: number;
  end: number;
  rawRanges: RawRange[];
  candidates: RangeEvent[];
  selected: RangeEvent[];
  backend: BackendFrame[];
}

export interface ChunkDescriptor {
  index: number;
  start: number;
  end: number;
  path: string;
  counts: Record<string, number>;
}

export interface SequenceManifest {
  version: number;
  sequence: string;
  generatedUtc: string;
  timeOrigin: number;
  duration: number;
  chunkDuration: number;
  overviewPath: string;
  featurePaths: Record<LandmarkTrajectoryName, string>;
  chunks: ChunkDescriptor[];
  counts: Record<string, number>;
}

export interface RootManifest {
  version: number;
  generatedUtc: string;
  source: string;
  sequences: Array<{
    name: string;
    manifestPath: string;
    duration: number;
    frames: number;
  }>;
}

export interface LayerStyle {
  visible: boolean;
  color: string;
  width: number;
  opacity: number;
}

export interface LayerSettings {
  optimized: LayerStyle;
  groundTruth: LayerStyle;
  causal: LayerStyle;
  vio: LayerStyle;
  candidates: LayerStyle;
  selected: LayerStyle;
  anchors: LayerStyle;
  grid: LayerStyle;
  features: LayerStyle;
}

export type TrajectoryHistoryMode = 'cumulative' | 'full' | 'trail-30';
export type RangeHistoryMode = 'frame' | 'trail-2' | 'trail-5' | 'trail-30' | 'cumulative';
export type RangeOriginMode = 'antenna' | 'body' | 'camera';
export type RangeAnchorMode = 'measurement' | 'playhead';
export type RangeInitializationMode = 'post-init' | 'all';
export type FeatureHistoryMode = 'current' | 'trail-5' | 'cumulative' | 'full';
export type FeatureColorMode = 'solid' | 'axis-x' | 'axis-y' | 'axis-z' | 'last-observation';
export type LandmarkTrajectoryName = 'optimized_uwb' | 'vio_only';

export interface HistorySettings {
  trajectory: TrajectoryHistoryMode;
  ranges: RangeHistoryMode;
  rangeOrigin: RangeOriginMode;
  rangeAnchor: RangeAnchorMode;
  rangeInitialization: RangeInitializationMode;
  landmarkTrajectory: LandmarkTrajectoryName;
  features: FeatureHistoryMode;
  featureColorMode: FeatureColorMode;
  featureReprojectionThresholdPx: number;
  featureObservationThreshold: number;
}

export interface RenderStats {
  trajectoryPoints: number;
  groundTruthPoints: number;
  candidateSegments: number;
  selectedSegments: number;
  featurePoints: number;
}

export interface TriangulatedFeature {
  id: number;
  p: [number, number, number];
  firstT: number;
  lastT: number;
  reprojectionRmsePx: number;
  maxReprojectionErrorPx: number;
  observations: number;
  cameraMask: number;
}

export interface TriangulatedFeatureBundle {
  version: number;
  sequence: string;
  coordinateFrame: 'world';
  sourceTrajectory: LandmarkTrajectoryName;
  cameraPoseConvention: string;
  points: TriangulatedFeature[];
  stats: {
    observedFeatureIds: number;
    triangulatedFeatureIds: number;
    observationsWithPose: number;
    reprojectionRmseMedianPx: number | null;
    reprojectionRmseP95Px: number | null;
  };
}
