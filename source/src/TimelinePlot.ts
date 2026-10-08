import type { SequenceOverview } from './types';

interface PlotTrack {
  label: string;
  unit: string;
  color: string;
  values: Array<{ t: number; value: number; selected?: boolean }>;
}

const LABEL_WIDTH = 74;
const RIGHT_PAD = 14;

export class TimelinePlot {
  private readonly context: CanvasRenderingContext2D;
  private readonly staticCanvas = document.createElement('canvas');
  private readonly staticContext: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private overview: SequenceOverview | null = null;
  private duration = 1;
  private time = 0;
  private tracks: PlotTrack[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onSeek: (time: number) => void) {
    const context = canvas.getContext('2d');
    const staticContext = this.staticCanvas.getContext('2d');
    if (!context || !staticContext) throw new Error('Canvas 2D is unavailable.');
    this.context = context;
    this.staticContext = staticContext;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointerdown', this.seek);
    canvas.addEventListener('pointermove', (event) => {
      if (event.buttons === 1) this.seek(event);
    });
    this.resize();
  }

  setData(overview: SequenceOverview, duration: number): void {
    this.overview = overview;
    this.duration = Math.max(duration, 0.001);
    this.tracks = [
      {
        label: 'LOG-DET',
        unit: 'gain',
        color: '#a991ff',
        values: overview.rangeMetrics
          .filter((event) => event.logdet !== null)
          .map((event) => ({ t: event.t, value: event.logdet!, selected: event.selected })),
      },
      {
        label: 'WEIGHT',
        unit: 'scale',
        color: '#58f0a7',
        values: overview.rangeMetrics
          .filter((event) => event.informationScale !== null)
          .map((event) => ({ t: event.t, value: event.informationScale!, selected: event.selected })),
      },
      {
        label: 'BACKEND',
        unit: 'ms',
        color: '#52d7ff',
        values: overview.backendRuntime
          .filter((event) => event.runtimeMs !== null)
          .map((event) => ({ t: event.t, value: event.runtimeMs! })),
      },
    ];
    this.renderStatic();
    this.draw();
  }

  setTime(time: number): void {
    this.time = time;
    this.draw();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.seek);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio, 2);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    this.canvas.width = width;
    this.canvas.height = height;
    this.staticCanvas.width = width;
    this.staticCanvas.height = height;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.staticContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.renderStatic();
    this.draw();
  }

  private renderStatic(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const context = this.staticContext;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0b0f15';
    context.fillRect(0, 0, width, height);
    if (!this.overview || !this.tracks.length) return;

    const topPad = 8;
    const bottomPad = 16;
    const trackHeight = (height - topPad - bottomPad) / this.tracks.length;
    const plotWidth = width - LABEL_WIDTH - RIGHT_PAD;
    const x = (time: number) => LABEL_WIDTH + (time / this.duration) * plotWidth;

    context.font = '10px Aptos, "Segoe UI Variable", ui-sans-serif, system-ui';
    context.textBaseline = 'top';
    this.tracks.forEach((track, index) => {
      const y0 = topPad + index * trackHeight;
      const y1 = y0 + trackHeight;
      context.strokeStyle = '#202833';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(LABEL_WIDTH, y1);
      context.lineTo(width - RIGHT_PAD, y1);
      context.stroke();

      context.fillStyle = '#dce3ec';
      context.fillText(track.label, 12, y0 + 5);
      context.fillStyle = '#748293';
      context.fillText(track.unit, 12, y0 + 19);

      if (!track.values.length) {
        context.fillStyle = '#596675';
        context.fillText('n/a', LABEL_WIDTH + 8, y0 + 10);
        return;
      }
      const finite = track.values.map((entry) => entry.value).filter(Number.isFinite).sort((a, b) => a - b);
      const low = Math.min(0, finite[0] ?? 0);
      const highIndex = Math.min(finite.length - 1, Math.floor(finite.length * 0.99));
      const high = Math.max(finite[highIndex] ?? 1, low + 1e-6);
      const py = (value: number) => y1 - 5 - ((Math.min(value, high) - low) / (high - low)) * (trackHeight - 13);

      context.strokeStyle = track.color;
      context.lineWidth = index === 0 ? 1 : 1.25;
      context.globalAlpha = 0.78;
      context.beginPath();
      let started = false;
      for (const entry of track.values) {
        const px = x(entry.t);
        const valueY = py(entry.value);
        if (index === 0) {
          context.moveTo(px, y1 - 5);
          context.lineTo(px, valueY);
        } else if (!started) {
          context.moveTo(px, valueY);
          started = true;
        } else {
          context.lineTo(px, valueY);
        }
      }
      context.stroke();
      if (index === 0) {
        context.globalAlpha = 0.9;
        for (const entry of track.values) {
          context.fillStyle = entry.selected ? '#58f0a7' : '#ee7183';
          context.fillRect(x(entry.t) - 0.75, py(entry.value) - 1.5, 1.5, 3);
        }
      }
      context.globalAlpha = 1;
      context.fillStyle = '#748293';
      context.textAlign = 'right';
      context.fillText(high.toPrecision(3), width - RIGHT_PAD, y0 + 4);
      context.textAlign = 'left';
    });

    context.fillStyle = '#748293';
    context.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textBaseline = 'bottom';
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = (this.duration * tick) / 4;
      const tickX = x(value);
      context.fillText(`${value.toFixed(1)}s`, tickX - (tick === 4 ? 28 : 0), height - 2);
    }
  }

  private draw(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const context = this.context;
    context.clearRect(0, 0, width, height);
    context.drawImage(this.staticCanvas, 0, 0, width, height);
    if (!this.overview) return;
    const plotWidth = width - LABEL_WIDTH - RIGHT_PAD;
    const playheadX = LABEL_WIDTH + (this.time / this.duration) * plotWidth;
    context.strokeStyle = '#f6f2e9';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(playheadX + 0.5, 0);
    context.lineTo(playheadX + 0.5, height - 16);
    context.stroke();
    context.fillStyle = '#f6f2e9';
    context.beginPath();
    context.moveTo(playheadX - 4, 0);
    context.lineTo(playheadX + 4, 0);
    context.lineTo(playheadX, 6);
    context.closePath();
    context.fill();
  }

  private seek = (event: PointerEvent): void => {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left - LABEL_WIDTH) / (bounds.width - LABEL_WIDTH - RIGHT_PAD)));
    this.onSeek(ratio * this.duration);
  };
}
