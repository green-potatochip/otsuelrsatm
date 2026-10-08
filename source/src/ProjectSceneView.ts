import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type {
  AnchorEstimate,
  FeatureColorMode,
  HistorySettings,
  LayerSettings,
  PositionSample,
  PoseSample,
  RangeEvent,
  SequenceChunk,
  SequenceOverview,
  TrajectoryName,
  RenderStats,
  TriangulatedFeatureBundle,
  TriangulatedFeature,
} from './types';

const TRAJECTORY_LAYER: Record<TrajectoryName, keyof LayerSettings> = {
  optimized_uwb: 'optimized',
  causal_uwb: 'causal',
  vio_only: 'vio',
};

// Filter the measured pose, rather than damping the camera response. The
// centered window removes high-frequency jitter without making the camera lag.
const FOLLOW_FILTER_WINDOW_SECONDS = 0.35;
// Offset in camera0 coordinates: X right, Y down, Z optical forward (metres).
const FOLLOW_CAMERA_OFFSET = new THREE.Vector3(-25, -20, -25);

interface WideLine {
  line: LineSegments2;
  geometry: LineSegmentsGeometry;
  material: LineMaterial;
}

interface SegmentLayer {
  line: LineSegments2;
  geometry: LineSegmentsGeometry;
  material: LineMaterial;
}

interface DepthContrastUniforms {
  strength: { value: number };
  nearDepth: { value: number };
  farDepth: { value: number };
  lightBackground: { value: number };
}

export type CameraFollowMode = 'manual' | 'follow' | 'follow-rotation';

// Project-page rendering extension; the original viewer stays unchanged.
export class ProjectSceneView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly fog = new THREE.FogExp2(0x080b10, 0);
  private readonly depthContrast: DepthContrastUniforms = {
    strength: { value: 0.7 },
    nearDepth: { value: 1 },
    farDepth: { value: 50 },
    lightBackground: { value: 0 },
  };
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.01, 3000);
  private readonly controls: OrbitControls;
  private readonly grid: THREE.GridHelper;
  private readonly bodyAntenna: SegmentLayer;
  private readonly bodyNodes: THREE.Points;
  private readonly antennaNodes: THREE.Points;
  private bodyAntennaGeometryKey = '';
  private bodyPositionCache = new Map<number, [number, number, number] | null>();
  private readonly trajectories = new Map<TrajectoryName, WideLine>();
  private readonly poseMarkers = new Map<TrajectoryName, THREE.Mesh>();
  private readonly groundTruth: WideLine;
  private readonly groundTruthMarker: THREE.Mesh;
  private readonly rangeLayers: Record<'candidates' | 'selected', SegmentLayer>;
  private readonly anchors: THREE.Points;
  private readonly anchorGeometry = new THREE.BufferGeometry();
  private readonly anchorMaterial = new THREE.PointsMaterial({ size: 8, sizeAttenuation: false });
  private readonly cameraAxes = new THREE.AxesHelper(0.65);
  private readonly featureGeometry = new THREE.BufferGeometry();
  private readonly featureMaterial: THREE.PointsMaterial;
  private readonly featurePoints: THREE.Points;
  private readonly selectedFeatureMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, fog: false }),
  );
  private overview: SequenceOverview | null = null;
  private featureBundle: TriangulatedFeatureBundle | null = null;
  private anchorTracks = new Map<number, AnchorEstimate[]>();
  private rangeHistory: Record<'candidates' | 'selected', RangeEvent[]> = { candidates: [], selected: [] };
  private trajectoryGeometryKeys = new Map<TrajectoryName, string>();
  private groundTruthGeometryKey = '';
  private rangeGeometryKeys: Record<'candidates' | 'selected', string> = { candidates: '', selected: '' };
  private featureGeometryKey = '';
  private visibleFeatureCount = 0;
  private visibleFeatures: TriangulatedFeature[] = [];
  private featureColorMode: FeatureColorMode = 'solid';
  private featureAxisBounds: Array<[number, number]> = [[0, 1], [0, 1], [0, 1]];
  private featureTimeBounds: [number, number] = [0, 1];
  private settings: LayerSettings;
  private currentView: 'iso' | 'xy' | 'xz' | 'yz' = 'iso';
  private cameraFollowMode: CameraFollowMode = 'manual';
  private followLastPosition: THREE.Vector3 | null = null;
  private followLastYaw: number | null = null;
  private frameHandle = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    settings: LayerSettings,
    onError: (message: string) => void,
    onFeaturePick: (feature: TriangulatedFeature | null) => void,
  ) {
    this.settings = settings;
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-canvas';
    canvas.setAttribute('aria-label', 'Interactive 3D trajectory and UWB range view');
    const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!context) throw new Error('WebGL2 is unavailable in this browser or graphics session.');
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x080b10, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.prepend(canvas);

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      onError('The WebGL2 context was lost. Reload the viewer to restore the 3D scene.');
    });

    this.scene.fog = this.fog;
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(18, -22, 16);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;

    this.grid = new THREE.GridHelper(100, 50, 0xaaaaaa, 0x777777);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = 0;
    this.container.dataset.gridZ = String(this.grid.position.z);
    for (const material of materialList(this.grid.material)) this.installDepthContrast(material);
    this.scene.add(this.grid, new THREE.AxesHelper(2));

    const ambient = new THREE.HemisphereLight(0xdcecff, 0x10151d, 1.4);
    this.scene.add(ambient);

    for (const name of Object.keys(TRAJECTORY_LAYER) as TrajectoryName[]) {
      const style = settings[TRAJECTORY_LAYER[name]];
      const material = this.lineMaterial(style.color, style.width, style.opacity);
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions([0, 0, 0, 0, 0, 0]);
      const line = new LineSegments2(geometry, material);
      line.computeLineDistances();
      line.frustumCulled = false;
      this.trajectories.set(name, { line, geometry, material });
      this.scene.add(line);

      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(name === 'optimized_uwb' ? 0.18 : 0.13, 20, 14),
        new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.5, metalness: 0.15 }),
      );
      this.installDepthContrast(marker.material as THREE.Material);
      this.poseMarkers.set(name, marker);
      this.scene.add(marker);
    }
    const groundTruthStyle = settings.groundTruth;
    const groundTruthGeometry = new LineSegmentsGeometry();
    groundTruthGeometry.setPositions([0, 0, 0, 0, 0, 0]);
    const groundTruthMaterial = this.lineMaterial(
      groundTruthStyle.color, groundTruthStyle.width, groundTruthStyle.opacity,
    );
    this.groundTruth = {
      line: new LineSegments2(groundTruthGeometry, groundTruthMaterial),
      geometry: groundTruthGeometry,
      material: groundTruthMaterial,
    };
    this.groundTruth.line.frustumCulled = false;
    this.groundTruthMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 20, 14),
      new THREE.MeshStandardMaterial({ color: groundTruthStyle.color, roughness: 0.35, metalness: 0.05 }),
    );
    this.installDepthContrast(this.groundTruthMarker.material as THREE.Material);
    this.scene.add(this.groundTruth.line, this.groundTruthMarker);
    this.cameraAxes.visible = false;
    this.scene.add(this.cameraAxes);

    this.rangeLayers = {
      candidates: this.segmentLayer(settings.candidates),
      selected: this.segmentLayer(settings.selected),
    };
    this.scene.add(this.rangeLayers.candidates.line, this.rangeLayers.selected.line);
    this.bodyAntenna = this.segmentLayer({ visible: true, color: '#75bced', width: 1.6, opacity: 0.8 });
    this.bodyNodes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#75bced', size: 3.5, sizeAttenuation: false, depthWrite: false }));
    this.antennaNodes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#f4e3c2', size: 4.5, sizeAttenuation: false, depthWrite: false }));
    for (const points of [this.bodyNodes, this.antennaNodes]) {
      points.frustumCulled = false;
      points.visible = false;
      this.installDepthContrast(points.material as THREE.PointsMaterial);
    }
    this.bodyAntenna.line.visible = false;
    this.scene.add(this.bodyAntenna.line, this.bodyNodes, this.antennaNodes);

    const featureStyle = settings.features;
    this.featureGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    this.featureMaterial = new THREE.PointsMaterial({
      color: featureStyle.color,
      size: featureStyle.width,
      sizeAttenuation: false,
      opacity: featureStyle.opacity,
      transparent: featureStyle.opacity < 1,
      depthTest: true,
      depthWrite: false,
      fog: true,
    });
    this.installDepthContrast(this.featureMaterial);
    this.featurePoints = new THREE.Points(this.featureGeometry, this.featureMaterial);
    this.featurePoints.frustumCulled = false;
    this.featurePoints.visible = false;
    this.scene.add(this.featurePoints);
    this.selectedFeatureMarker.visible = false;
    this.scene.add(this.selectedFeatureMarker);
    canvas.addEventListener('click', (event) => this.pickFeature(event, canvas, onFeaturePick));

    this.anchors = new THREE.Points(this.anchorGeometry, this.anchorMaterial);
    this.installDepthContrast(this.anchorMaterial);
    this.anchors.frustumCulled = false;
    this.scene.add(this.anchors);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.render();
  }

  setOverview(overview: SequenceOverview, features: TriangulatedFeatureBundle): void {
    this.overview = overview;
    this.anchorTracks.clear();
    this.trajectoryGeometryKeys.clear();
    this.groundTruthGeometryKey = '';
    this.rangeGeometryKeys = { candidates: '', selected: '' };
    this.bodyAntennaGeometryKey = '';
    this.bodyPositionCache.clear();
    this.setFeatures(features);
    this.rangeHistory = {
      candidates: overview.rangeMetrics.filter((event) => !event.selected),
      selected: overview.rangeMetrics.filter((event) => event.selected),
    };
    for (const estimate of overview.anchorHistory) {
      const track = this.anchorTracks.get(estimate.id) ?? [];
      track.push(estimate);
      this.anchorTracks.set(estimate.id, track);
    }
    for (const track of this.anchorTracks.values()) track.sort((a, b) => a.t - b.t);

    for (const [name, samples] of Object.entries(overview.trajectories) as Array<[TrajectoryName, PoseSample[]]>) {
      const line = this.trajectories.get(name);
      if (!line) continue;
      line.line.visible = samples.length > 1;
    }
    this.groundTruth.line.visible = overview.alignedGroundTruth.trajectory.length > 1;
    this.applySettings(this.settings);
    this.fit(this.currentView);
  }

  setFeatures(features: TriangulatedFeatureBundle): void {
    this.featureBundle = features;
    this.featureAxisBounds = axisBounds(features.points);
    this.featureTimeBounds = timeBounds(features.points);
    this.featureGeometryKey = '';
    this.visibleFeatureCount = 0;
    this.visibleFeatures = [];
    this.selectedFeatureMarker.visible = false;
  }

  getLandmarkHeightBounds(): [number, number] {
    return [...this.featureAxisBounds[2]];
  }

  setCameraFollow(mode: CameraFollowMode, time: number): void {
    this.cameraFollowMode = mode;
    this.container.dataset.cameraMode = mode;
    this.followLastPosition = null;
    this.followLastYaw = null;
    if (mode === 'manual' || !this.overview) return;
    const reference = this.followReference(time);
    if (!reference) return;
    const { position, pose, yaw } = reference;
    const offset = FOLLOW_CAMERA_OFFSET.clone().applyQuaternion(new THREE.Quaternion().fromArray(pose.q));
    this.camera.position.copy(position).add(offset);
    this.controls.target.copy(position);
    this.controls.update();
    this.followLastPosition = position;
    this.followLastYaw = yaw;
  }

  applySettings(settings: LayerSettings): void {
    this.settings = settings;
    for (const [name, value] of this.trajectories) {
      const style = settings[TRAJECTORY_LAYER[name]];
      value.line.visible = style.visible;
      value.material.color.set(style.color);
      value.material.linewidth = style.width;
      this.applyOpacity(value.material, style.opacity, false);
      const marker = this.poseMarkers.get(name);
      if (marker) {
        marker.visible = style.visible;
        (marker.material as THREE.MeshStandardMaterial).color.set(style.color);
        this.applyOpacity(marker.material as THREE.MeshStandardMaterial, style.opacity, false);
      }
    }
    const groundTruthStyle = settings.groundTruth;
    this.groundTruth.line.visible = groundTruthStyle.visible;
    this.groundTruth.material.color.set(groundTruthStyle.color);
    this.groundTruth.material.linewidth = groundTruthStyle.width;
    this.applyOpacity(this.groundTruth.material, groundTruthStyle.opacity, false);
    this.groundTruthMarker.visible = groundTruthStyle.visible;
    (this.groundTruthMarker.material as THREE.MeshStandardMaterial).color.set(groundTruthStyle.color);
    this.applyOpacity(this.groundTruthMarker.material as THREE.MeshStandardMaterial, groundTruthStyle.opacity, false);
    for (const key of ['candidates', 'selected'] as const) {
      const style = settings[key];
      const layer = this.rangeLayers[key];
      layer.material.color.set(style.color);
      layer.material.linewidth = style.width;
      this.applyOpacity(layer.material, style.opacity, true);
      layer.line.visible = style.visible;
    }
    this.anchors.visible = settings.anchors.visible;
    this.anchorMaterial.color.set(settings.anchors.color);
    this.anchorMaterial.size = settings.anchors.width;
    this.applyOpacity(this.anchorMaterial, settings.anchors.opacity, false);
    this.featurePoints.visible = settings.features.visible;
    this.featureMaterial.color.set(this.featureColorMode === 'solid' ? settings.features.color : 0xffffff);
    this.featureMaterial.size = settings.features.width;
    this.applyOpacity(this.featureMaterial, settings.features.opacity, false);
    this.grid.visible = settings.grid.visible;
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const material of gridMaterials) {
      material.color.set(settings.grid.color);
      this.applyOpacity(material, settings.grid.opacity, false);
    }
  }

  update(time: number, chunks: SequenceChunk[], history: HistorySettings): RenderStats {
    if (!this.overview) return { trajectoryPoints: 0, groundTruthPoints: 0, candidateSegments: 0, selectedSegments: 0, featurePoints: 0 };
    let trajectoryPoints = 0;
    for (const [name, samples] of Object.entries(this.overview.trajectories) as Array<[TrajectoryName, PoseSample[]]>) {
      trajectoryPoints += this.updateTrajectory(name, samples, time, history);
      const marker = this.poseMarkers.get(name);
      const pose = interpolatePose(samples, time);
      if (!marker || !pose) {
        if (marker) marker.visible = false;
        continue;
      }
      marker.visible = this.settings[TRAJECTORY_LAYER[name]].visible;
      marker.position.fromArray(pose.p);
      marker.quaternion.fromArray(pose.q);
      if (name === 'optimized_uwb') {
        this.cameraAxes.visible = marker.visible;
        this.cameraAxes.position.copy(marker.position);
        this.cameraAxes.quaternion.copy(marker.quaternion);
      }
    }
    const groundTruthPoints = this.updateGroundTruth(this.overview.alignedGroundTruth.trajectory, time);
    this.updateFollowCamera(time);
    this.updateAnchors(time);
    const ranges = this.updateRanges(time, chunks, history);
    const featurePoints = this.updateFeatures(time, history);
    return { trajectoryPoints, groundTruthPoints, ...ranges, featurePoints };
  }

  fit(view: 'iso' | 'xy' | 'xz' | 'yz'): void {
    if (!this.overview) return;
    this.currentView = view;
    const points = this.overview.trajectories.optimized_uwb.map((sample) => new THREE.Vector3().fromArray(sample.p));
    if (!points.length) return;
    const box = new THREE.Box3().setFromPoints(points);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const distance = Math.max(size.length() * 0.8, 10);
    const directions: Record<typeof view, THREE.Vector3> = {
      iso: new THREE.Vector3(0.8, -1, 0.65),
      xy: new THREE.Vector3(0, 0, 1),
      xz: new THREE.Vector3(0, -1, 0),
      yz: new THREE.Vector3(1, 0, 0),
    };
    this.camera.position.copy(center).add(directions[view].normalize().multiplyScalar(distance));
    // OrbitControls captures the camera-up frame at construction time. Keep a
    // single world-Z up frame here instead of mutating camera.up after that;
    // otherwise subsequent follow rotations use an inconsistent orbit basis.
    this.controls.target.copy(center);
    this.controls.update();
  }

  setFogDensity(density: number): void {
    this.fog.density = THREE.MathUtils.clamp(density, 0, 0.05);
  }

  setDepthContrast(strength: number): void {
    this.depthContrast.strength.value = THREE.MathUtils.clamp(strength, 0, 0.7);
  }

  setBackgroundColor(color: string): void {
    this.renderer.setClearColor(color, 1);
    this.fog.color.set(color);
    const luminance = relativeLuminance(color);
    this.depthContrast.lightBackground.value = THREE.MathUtils.smoothstep(luminance, 0.45, 0.9);
    this.container.classList.toggle('light-viewport', luminance >= 0.6);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.bodyAntenna.geometry.dispose();
    this.bodyAntenna.material.dispose();
    for (const points of [this.bodyNodes, this.antennaNodes]) {
      points.geometry.dispose();
      (points.material as THREE.PointsMaterial).dispose();
    }
  }

  private lineMaterial(color: string, width: number, opacity: number, transparentDepthWrite = false): LineMaterial {
    const material = new LineMaterial({
      color,
      linewidth: width,
      opacity,
      transparent: opacity < 1,
      depthTest: true,
      depthWrite: opacity >= 1 || transparentDepthWrite,
      fog: true,
      worldUnits: false,
    });
    material.alphaToCoverage = true;
    this.installDepthContrast(material);
    return material;
  }

  private installDepthContrast(material: THREE.Material): void {
    const originalCompile = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      originalCompile(shader, renderer);
      shader.uniforms.depthContrastStrength = this.depthContrast.strength;
      shader.uniforms.depthContrastNear = this.depthContrast.nearDepth;
      shader.uniforms.depthContrastFar = this.depthContrast.farDepth;
      shader.uniforms.depthContrastLightBackground = this.depthContrast.lightBackground;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float depthContrastStrength;
uniform float depthContrastNear;
uniform float depthContrastFar;
uniform float depthContrastLightBackground;`,
        )
        .replace(
          '#include <fog_fragment>',
          `#include <fog_fragment>
#ifdef USE_FOG
  // Fog naturally fades into the viewport color. On a light viewport that
  // would erase pale trajectory colors, so restore a bounded dark contrast
  // after fog without mutating the user's layer palette.
  gl_FragColor.rgb *= mix(1.0, 0.72, depthContrastLightBackground);
  float depthContrastFactor = smoothstep(depthContrastNear, depthContrastFar, vFogDepth);
  gl_FragColor.rgb *= mix(1.0, 1.0 - depthContrastStrength, depthContrastFactor);
#endif`,
        );
    };
    material.customProgramCacheKey = () => 'viewer-depth-contrast-v1';
    material.needsUpdate = true;
  }

  private segmentLayer(style: LayerSettings['selected']): SegmentLayer {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions([0, 0, 0, 0, 0, 0]);
    const material = this.lineMaterial(style.color, style.width, style.opacity, true);
    const line = new LineSegments2(geometry, material);
    line.frustumCulled = false;
    return { line, geometry, material };
  }

  private updateTrajectory(name: TrajectoryName, samples: PoseSample[], time: number, history: HistorySettings): number {
    const end = history.trajectory === 'full' ? samples.length : upperBound(samples, time);
    const start = history.trajectory === 'trail-30' ? lowerBound(samples, time - 30) : 0;
    const count = Math.max(0, end - start);
    const key = `${history.trajectory}:${start}:${end}`;
    const line = this.trajectories.get(name);
    if (!line) return 0;
    if (this.trajectoryGeometryKeys.get(name) !== key) {
      const positions: number[] = [];
      for (let index = start; index + 1 < end; index += 1) {
        positions.push(...samples[index].p, ...samples[index + 1].p);
      }
      this.replaceLineGeometry(line, positions);
      line.line.computeLineDistances();
      this.trajectoryGeometryKeys.set(name, key);
    }
    line.line.visible = this.settings[TRAJECTORY_LAYER[name]].visible && count >= 2;
    return count;
  }

  private updateGroundTruth(samples: PositionSample[], time: number): number {
    const end = upperBound(samples, time);
    const key = `cumulative:${end}`;
    if (this.groundTruthGeometryKey !== key) {
      const positions: number[] = [];
      for (let index = 0; index + 1 < end; index += 1) {
        positions.push(...samples[index].p, ...samples[index + 1].p);
      }
      this.replaceLineGeometry(this.groundTruth, positions);
      this.groundTruth.line.computeLineDistances();
      this.groundTruthGeometryKey = key;
    }
    this.groundTruth.line.visible = this.settings.groundTruth.visible && end >= 2;
    const position = interpolatePositionSamples(samples, time);
    this.groundTruthMarker.visible = this.settings.groundTruth.visible && position !== null;
    if (position) this.groundTruthMarker.position.fromArray(position);
    return end;
  }

  private updateRanges(
    time: number,
    chunks: SequenceChunk[],
    history: HistorySettings,
  ): Pick<RenderStats, 'candidateSegments' | 'selectedSegments'> {
    const frameWindow = 0.065;
    const rangeWindow = history.ranges === 'trail-2' ? 2
      : history.ranges === 'trail-5' ? 5
        : history.ranges === 'trail-30' ? 30
          : history.ranges === 'frame' ? frameWindow : Number.POSITIVE_INFINITY;
    const result = { candidateSegments: 0, selectedSegments: 0 };
    const offsetEvents = new Map<string, RangeEvent>();
    const offsetKeys: string[] = [];
    const playheadAnchors = new Map<number, AnchorEstimate>();
    if (history.rangeAnchor === 'playhead') {
      for (const [id, track] of this.anchorTracks) {
        const estimate = latestAt(track, time);
        if (estimate) playheadAnchors.set(id, estimate);
      }
    }
    const anchorStateKey = history.rangeAnchor === 'playhead'
      ? [...playheadAnchors].map(([id, estimate]) => `${id}:${estimate.updateIndex}`).join(',')
      : 'measurement';
    const update = (key: 'candidates' | 'selected') => {
      const events = history.ranges === 'frame'
        ? chunks.flatMap((chunk) => chunk[key]).filter((event) => Math.abs(event.t - time) <= frameWindow)
        : this.rangeHistory[key];
      const startTime = history.ranges === 'frame' ? time - frameWindow : time - rangeWindow;
      const start = history.ranges === 'frame' ? 0 : lowerBound(events, startTime);
      const end = history.ranges === 'frame' ? events.length : upperBound(events, time);
      const visibleEvents = events.slice(start, end).flatMap((event) => {
        const anchorTrack = this.anchorTracks.get(event.anchorId);
        const beforeInitialization = !anchorTrack?.length || event.t < anchorTrack[0].t;
        if (history.rangeInitialization === 'post-init' && beforeInitialization) return [];
        const anchor = history.rangeAnchor === 'playhead'
          ? playheadAnchors.get(event.anchorId)?.p ?? null
          : event.anchor;
        if (!anchor) return [];
        const origin = history.rangeOrigin === 'antenna'
          ? event.tag
          : interpolatePosition(
            history.rangeOrigin === 'camera'
              ? this.overview!.trajectories.optimized_uwb
              : this.overview!.bodyTrajectories.optimized_uwb,
            event.t,
          );
        return origin ? [{ event, origin, anchor }] : [];
      });
      const geometryKey = `${history.ranges}:${history.rangeOrigin}:${history.rangeAnchor}:${history.rangeInitialization}:${anchorStateKey}:${start}:${end}:${visibleEvents.length}:${visibleEvents[0]?.event.id ?? -1}:${visibleEvents.at(-1)?.event.id ?? -1}`;
      if (history.rangeOrigin === 'antenna' && this.settings[key].visible) {
        offsetKeys.push(`${key}:${start}:${end}:${visibleEvents.length}`);
        for (const { event } of visibleEvents) if (event.tag) offsetEvents.set(`${event.t}:${event.tagId}`, event);
      }
      const positions = visibleEvents.flatMap(({ origin, anchor }) => [...origin, ...anchor]);
      const layer = this.rangeLayers[key];
      if (this.rangeGeometryKeys[key] !== geometryKey) {
        this.replaceLineGeometry(layer, positions);
        layer.line.computeLineDistances();
        this.rangeGeometryKeys[key] = geometryKey;
      }
      layer.line.visible = this.settings[key].visible && positions.length > 0;
      if (key === 'candidates') result.candidateSegments = visibleEvents.length;
      else result.selectedSegments = visibleEvents.length;
    };
    update('candidates');
    update('selected');
    const offsetKey = `${history.rangeOrigin}:${history.ranges}:${history.rangeInitialization}:${history.rangeAnchor}:${[...playheadAnchors.keys()].join(',')}:${offsetKeys.join(';')}`;
    this.updateBodyAntennaLinks([...offsetEvents.values()], offsetKey);
    return result;
  }

  private updateBodyAntennaLinks(events: RangeEvent[], key: string): void {
    if (this.bodyAntennaGeometryKey === key) return;
    const links: number[] = [], bodies: number[] = [], antennas: number[] = [];
    let first: RangeEvent | null = null;
    const samples = this.overview!.bodyTrajectories.causal_uwb.length
      ? this.overview!.bodyTrajectories.causal_uwb : this.overview!.bodyTrajectories.optimized_uwb;
    for (const event of events) {
      if (!event.tag) continue;
      if (!this.bodyPositionCache.has(event.t)) this.bodyPositionCache.set(event.t, interpolatePosition(samples, event.t));
      const body = this.bodyPositionCache.get(event.t);
      if (!body) continue;
      links.push(...body, ...event.tag);
      bodies.push(...body); antennas.push(...event.tag);
      first ??= event;
    }
    this.replaceLineGeometry(this.bodyAntenna, links);
    this.bodyAntenna.line.computeLineDistances();
    for (const [nodes, positions] of [[this.bodyNodes, bodies], [this.antennaNodes, antennas]] as const) {
      const previous = nodes.geometry;
      nodes.geometry = new THREE.BufferGeometry();
      nodes.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      previous.dispose();
      if (bodies.length) nodes.geometry.computeBoundingSphere();
      nodes.visible = bodies.length > 0;
    }
    this.bodyAntenna.line.visible = links.length > 0;
    this.bodyAntennaGeometryKey = key;
    this.container.dataset.bodyAntennaLinks = String(links.length / 6);
    this.container.dataset.bodyNodeCount = String(bodies.length / 3);
    this.container.dataset.antennaNodeCount = String(antennas.length / 3);
    if (first) {
      const from = this.bodyAntenna.geometry.getAttribute('instanceStart');
      const to = this.bodyAntenna.geometry.getAttribute('instanceEnd');
      this.container.dataset.bodyAntennaExample = JSON.stringify({ t: first.t, tagId: first.tagId, body: [from.getX(0), from.getY(0), from.getZ(0)], antenna: [to.getX(0), to.getY(0), to.getZ(0)] });
    } else delete this.container.dataset.bodyAntennaExample;
  }

  private updateFeatures(time: number, history: HistorySettings): number {
    this.applyFeatureColorMode(history.featureColorMode);
    this.container.dataset.featureColorMode = history.featureColorMode;
    this.container.dataset.featureVertexColors = String(this.featureMaterial.vertexColors);
    const bundle = this.featureBundle;
    if (!bundle || !this.settings.features.visible) {
      this.featurePoints.visible = false;
      return 0;
    }
    const timeKey = history.features === 'full' ? 'full' : Math.round(time * 10);
    const key = `${history.features}:${timeKey}:${history.featureReprojectionThresholdPx}:${history.featureObservationThreshold}:${history.featureColorMode}`;
    if (this.featureGeometryKey !== key) {
      const positions: number[] = [];
      const colors: number[] = [];
      const visibleFeatures: TriangulatedFeature[] = [];
      const axis: 0 | 1 | 2 | null = history.featureColorMode === 'axis-x' ? 0
        : history.featureColorMode === 'axis-y' ? 1
          : history.featureColorMode === 'axis-z' ? 2 : null;
      const timeColor = history.featureColorMode === 'last-observation';
      const color = new THREE.Color();
      for (const feature of bundle.points) {
        if (feature.reprojectionRmsePx > history.featureReprojectionThresholdPx) continue;
        if (feature.observations < history.featureObservationThreshold) continue;
        if (history.features !== 'full' && feature.firstT > time + 0.15) break;
        const visible = history.features === 'full'
          || history.features === 'cumulative'
          || (history.features === 'trail-5' && feature.lastT >= time - 5)
          || (history.features === 'current' && feature.lastT >= time - 0.15);
        if (visible) {
          positions.push(...feature.p);
          if (axis !== null) {
            const [minimum, maximum] = this.featureAxisBounds[axis];
            const normalized = THREE.MathUtils.clamp((feature.p[axis] - minimum) / (maximum - minimum), 0, 1);
            color.setHSL((1 - normalized) * 0.68, 0.92, 0.56);
            colors.push(color.r, color.g, color.b);
          } else if (timeColor) {
            const [minimum, maximum] = this.featureTimeBounds;
            const normalized = THREE.MathUtils.clamp((feature.lastT - minimum) / (maximum - minimum), 0, 1);
            color.setHSL((1 - normalized) * 0.68, 0.92, 0.56);
            colors.push(color.r, color.g, color.b);
          }
          visibleFeatures.push(feature);
        }
      }
      this.featureGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions.length ? positions : [0, 0, 0], 3),
      );
      if (axis !== null || timeColor) {
        this.featureGeometry.setAttribute(
          'color',
          new THREE.Float32BufferAttribute(colors.length ? colors : [1, 1, 1], 3),
        );
      } else {
        this.featureGeometry.deleteAttribute('color');
      }
      this.featureGeometry.computeBoundingSphere();
      this.container.dataset.featureColorCount = String(this.featureGeometry.getAttribute('color')?.count ?? 0);
      this.featureGeometryKey = key;
      this.visibleFeatureCount = positions.length / 3;
      this.visibleFeatures = visibleFeatures;
    }
    this.featurePoints.visible = this.settings.features.visible && this.visibleFeatureCount > 0;
    return this.visibleFeatureCount;
  }

  private applyFeatureColorMode(mode: FeatureColorMode): void {
    if (this.featureColorMode === mode) return;
    this.featureColorMode = mode;
    this.featureGeometryKey = '';
    this.featureMaterial.vertexColors = mode !== 'solid';
    this.featureMaterial.color.set(mode === 'solid' ? this.settings.features.color : 0xffffff);
    this.featureMaterial.needsUpdate = true;
  }

  private pickFeature(
    event: MouseEvent,
    canvas: HTMLCanvasElement,
    callback: (feature: TriangulatedFeature | null) => void,
  ): void {
    if (!this.featurePoints.visible || !this.visibleFeatures.length) {
      this.selectedFeatureMarker.visible = false;
      callback(null);
      return;
    }
    const bounds = canvas.getBoundingClientRect();
    const clickX = event.clientX - bounds.left;
    const clickY = event.clientY - bounds.top;
    const pickRadius = Math.max(7, this.featureMaterial.size * 1.5);
    const projected = new THREE.Vector3();
    let feature: TriangulatedFeature | null = null;
    let closestDistanceSquared = pickRadius * pickRadius;
    let closestDepth = Number.POSITIVE_INFINITY;

    // Screen-space selection stays consistent with PointsMaterial's pixel-sized
    // markers. A world-space ray threshold varies too much as the camera zooms.
    for (const candidate of this.visibleFeatures) {
      projected.fromArray(candidate.p).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const x = (projected.x * 0.5 + 0.5) * bounds.width;
      const y = (-projected.y * 0.5 + 0.5) * bounds.height;
      const distanceSquared = (x - clickX) ** 2 + (y - clickY) ** 2;
      if (distanceSquared < closestDistanceSquared
        || (distanceSquared === closestDistanceSquared && projected.z < closestDepth)) {
        closestDistanceSquared = distanceSquared;
        closestDepth = projected.z;
        feature = candidate;
      }
    }
    this.selectedFeatureMarker.visible = feature !== null;
    if (feature) this.selectedFeatureMarker.position.fromArray(feature.p);
    callback(feature);
  }

  private replaceLineGeometry(target: WideLine | SegmentLayer, positions: number[]): void {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions.length >= 6 ? positions : [0, 0, 0, 0, 0, 0]);
    const previous = target.geometry;
    target.geometry = geometry;
    target.line.geometry = geometry;
    previous.dispose();
  }

  private applyOpacity(
    material: THREE.Material & { opacity: number },
    opacity: number,
    transparentDepthWrite: boolean,
  ): void {
    const transparent = opacity < 1;
    if (material.transparent !== transparent) {
      material.transparent = transparent;
      material.needsUpdate = true;
    }
    material.opacity = opacity;
    material.depthWrite = !transparent || transparentDepthWrite;
  }

  private updateAnchors(time: number): void {
    const positions: number[] = [];
    for (const track of this.anchorTracks.values()) {
      const estimate = latestAt(track, time);
      if (estimate) positions.push(...estimate.p);
    }
    this.anchorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions.length ? positions : [0, 0, 0], 3));
    this.anchorGeometry.computeBoundingSphere();
    this.anchors.visible = this.settings.anchors.visible && positions.length > 0;
  }

  private updateFollowCamera(time: number): void {
    if (this.cameraFollowMode === 'manual' || !this.overview) return;
    const reference = this.followReference(time);
    if (!reference) return;
    const { position, yaw } = reference;
    if (!this.followLastPosition) {
      this.setCameraFollow(this.cameraFollowMode, time);
      return;
    }
    if (this.cameraFollowMode === 'follow-rotation' && yaw !== null && this.followLastYaw !== null) {
      // OPT poses contain full camera pitch/roll and occasionally change frame
      // convention by almost pi. Applying that quaternion to an orbit camera
      // produces the severe roll/flips seen in the viewer. Track only the
      // horizontal heading, while OrbitControls keeps the current elevation
      // and world-up orientation stable.
      const deltaYaw = wrapAngle(yaw - this.followLastYaw);
      const deltaRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        deltaYaw,
      );
      const desiredCamera = this.camera.position.clone().sub(this.followLastPosition).applyQuaternion(deltaRotation).add(position);
      const desiredTarget = this.controls.target.clone().sub(this.followLastPosition).applyQuaternion(deltaRotation).add(position);
      this.camera.position.copy(desiredCamera);
      this.controls.target.copy(desiredTarget);
    } else {
      const delta = position.clone().sub(this.followLastPosition);
      if (delta.lengthSq() > 0) {
        this.camera.position.add(delta);
        this.controls.target.add(delta);
      }
    }
    this.controls.update();
    this.followLastPosition.copy(position);
    this.followLastYaw = yaw;
  }

  private followReference(time: number): { position: THREE.Vector3; pose: PoseSample; yaw: number | null } | null {
    if (!this.overview) return null;
    const samples = this.overview.trajectories.optimized_uwb;
    // Frame the first known robot pose before the estimator initializes. This
    // only positions the view; trajectory/marker coverage remains unchanged.
    const pose = samples.length && time < samples[0].t
      ? samples[0]
      : interpolatePose(samples, time);
    if (!pose) return null;
    const gt = this.overview.alignedGroundTruth.trajectory;
    const gtPosition = smoothPositionSamples(
      gt,
      time,
      FOLLOW_FILTER_WINDOW_SECONDS,
    );
    // Before Leica coverage begins, follow OPT instead of waiting for GT.
    // Continue respecting the existing stop at the end of GT coverage.
    if (!gtPosition && gt.length && time >= gt[0].t) return null;
    const position = new THREE.Vector3().fromArray(gtPosition ?? pose.p);
    const yaw = this.cameraFollowMode === 'follow-rotation'
      ? smoothPoseYaw(samples, time, FOLLOW_FILTER_WINDOW_SECONDS) ?? poseYaw(pose.q)
      : null;
    return { position, pose, yaw };
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    for (const line of this.trajectories.values()) line.material.resolution.set(width, height);
    this.groundTruth.material.resolution.set(width, height);
    for (const layer of Object.values(this.rangeLayers)) layer.material.resolution.set(width, height);
    this.bodyAntenna.material.resolution.set(width, height);
  }

  private render = (): void => {
    this.controls.update();
    const focusDistance = Math.max(0.1, this.camera.position.distanceTo(this.controls.target));
    this.depthContrast.nearDepth.value = focusDistance * 0.45;
    this.depthContrast.farDepth.value = Math.max(
      this.depthContrast.nearDepth.value + 0.1,
      focusDistance * 1.55,
    );
    this.renderer.render(this.scene, this.camera);
    this.frameHandle = requestAnimationFrame(this.render);
  };
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function relativeLuminance(color: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return 0;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function interpolatePose(samples: PoseSample[], time: number): PoseSample | null {
  if (!samples.length || time < samples[0].t - 0.25 || time > samples[samples.length - 1].t + 0.25) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t < time) low = middle + 1;
    else high = middle;
  }
  const next = samples[low];
  const previous = samples[Math.max(0, low - 1)];
  if (next === previous || next.t === previous.t) return next;
  const alpha = THREE.MathUtils.clamp((time - previous.t) / (next.t - previous.t), 0, 1);
  const position = new THREE.Vector3().fromArray(previous.p).lerp(new THREE.Vector3().fromArray(next.p), alpha);
  const quaternion = new THREE.Quaternion().fromArray(previous.q).slerp(new THREE.Quaternion().fromArray(next.q), alpha);
  return { t: time, p: position.toArray(), q: quaternion.toArray() };
}

function interpolatePosition(samples: PoseSample[], time: number): [number, number, number] | null {
  if (!samples.length || time < samples[0].t - 0.25 || time > samples[samples.length - 1].t + 0.25) return null;
  const nextIndex = lowerBound(samples, time);
  const next = samples[Math.min(nextIndex, samples.length - 1)];
  const previous = samples[Math.max(0, nextIndex - 1)];
  if (next === previous || next.t === previous.t) return [...next.p];
  const alpha = THREE.MathUtils.clamp((time - previous.t) / (next.t - previous.t), 0, 1);
  return new THREE.Vector3().fromArray(previous.p).lerp(new THREE.Vector3().fromArray(next.p), alpha).toArray();
}

function interpolatePositionSamples(samples: PositionSample[], time: number): [number, number, number] | null {
  if (!samples.length || time < samples[0].t - 0.25 || time > samples[samples.length - 1].t + 0.25) return null;
  const nextIndex = lowerBound(samples, time);
  const next = samples[Math.min(nextIndex, samples.length - 1)];
  const previous = samples[Math.max(0, nextIndex - 1)];
  if (next === previous || next.t === previous.t) return [...next.p];
  const alpha = THREE.MathUtils.clamp((time - previous.t) / (next.t - previous.t), 0, 1);
  return new THREE.Vector3().fromArray(previous.p).lerp(new THREE.Vector3().fromArray(next.p), alpha).toArray();
}

function smoothPositionSamples(
  samples: PositionSample[],
  time: number,
  halfWindowSeconds: number,
): [number, number, number] | null {
  const center = interpolatePositionSamples(samples, time);
  if (!center || halfWindowSeconds <= 0) return center;
  const start = lowerBound(samples, time - halfWindowSeconds);
  const end = upperBound(samples, time + halfWindowSeconds);
  const sum = [center[0], center[1], center[2]];
  let totalWeight = 1;
  for (let index = start; index < end; index += 1) {
    const normalizedDistance = Math.abs(samples[index].t - time) / halfWindowSeconds;
    if (normalizedDistance >= 1) continue;
    const weight = 1 - normalizedDistance;
    sum[0] += samples[index].p[0] * weight;
    sum[1] += samples[index].p[1] * weight;
    sum[2] += samples[index].p[2] * weight;
    totalWeight += weight;
  }
  return [sum[0] / totalWeight, sum[1] / totalWeight, sum[2] / totalWeight];
}

function smoothPoseYaw(
  samples: PoseSample[],
  time: number,
  halfWindowSeconds: number,
): number | null {
  const centerPose = interpolatePose(samples, time);
  if (!centerPose) return null;
  const centerYaw = poseYaw(centerPose.q);
  if (centerYaw === null) return null;
  let sumSin = Math.sin(centerYaw);
  let sumCos = Math.cos(centerYaw);
  let totalWeight = 1;
  const start = lowerBound(samples, time - halfWindowSeconds);
  const end = upperBound(samples, time + halfWindowSeconds);
  for (let index = start; index < end; index += 1) {
    const normalizedDistance = Math.abs(samples[index].t - time) / halfWindowSeconds;
    if (normalizedDistance >= 1) continue;
    const weight = 1 - normalizedDistance;
    const yaw = poseYaw(samples[index].q);
    if (yaw === null) continue;
    sumSin += Math.sin(yaw) * weight;
    sumCos += Math.cos(yaw) * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0 || (Math.abs(sumSin) < 1e-12 && Math.abs(sumCos) < 1e-12)) return centerYaw;
  return Math.atan2(sumSin / totalWeight, sumCos / totalWeight);
}

function poseYaw(q: [number, number, number, number]): number | null {
  // The stored pose is a camera pose; its local +Z optical axis is the most
  // stable forward direction for a horizontal heading. Project out pitch and
  // reject near-vertical views where yaw is undefined.
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(q));
  forward.z = 0;
  if (forward.lengthSq() < 1e-10) return null;
  return Math.atan2(forward.y, forward.x);
}

function wrapAngle(angle: number): number {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI;
}

function latestAt(samples: AnchorEstimate[], time: number): AnchorEstimate | null {
  if (!samples.length || samples[0].t > time) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (samples[middle].t <= time) low = middle;
    else high = middle - 1;
  }
  return samples[low];
}

function lowerBound<T extends { t: number }>(samples: T[], time: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound<T extends { t: number }>(samples: T[], time: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function axisBounds(features: TriangulatedFeature[]): Array<[number, number]> {
  const visibleDomain = features.filter((feature) => feature.reprojectionRmsePx <= 20);
  return [0, 1, 2].map((axis) => {
    const values = visibleDomain.map((feature) => feature.p[axis]).sort((left, right) => left - right);
    if (!values.length) return [0, 1];
    const minimum = quantile(values, 0.02);
    const maximum = quantile(values, 0.98);
    return maximum > minimum ? [minimum, maximum] : [minimum, minimum + 1];
  });
}

function timeBounds(features: TriangulatedFeature[]): [number, number] {
  if (!features.length) return [0, 1];
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const feature of features) {
    minimum = Math.min(minimum, feature.lastT);
    maximum = Math.max(maximum, feature.lastT);
  }
  return maximum > minimum ? [minimum, maximum] : [minimum, minimum + 1];
}

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
