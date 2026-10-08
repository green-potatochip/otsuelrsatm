import type { LayerSettings } from './types';

export const defaultLayers: LayerSettings = {
  optimized: { visible: true, color: '#52d7ff', width: 3.8, opacity: 1 },
  groundTruth: { visible: true, color: '#ff3b30', width: 3.6, opacity: 1 },
  causal: { visible: true, color: '#a991ff', width: 3, opacity: 1 },
  vio: { visible: true, color: '#ffbd59', width: 1.7, opacity: 1 },
  candidates: { visible: true, color: '#ff0026', width: 1.2, opacity: 0.55 },
  selected: { visible: true, color: '#00ff84', width: 1.2, opacity: 0.55 },
  anchors: { visible: true, color: '#ffdd00', width: 18, opacity: 1 },
  grid: { visible: true, color: '#888888', width: 1, opacity: 0.42 },
  features: { visible: true, color: '#d8ff68', width: 2.2, opacity: 0.8 },
};
