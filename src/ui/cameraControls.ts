import type { Camera, GameMap } from '../core/types';
import {
  EDGE_SCROLL_BAND,
  EDGE_SCROLL_DWELL_MS,
  RMB_PAN_DEADZONE,
  RMB_PAN_MULT,
  SCROLL_RATE_DEFAULT,
  SCROLL_RATE_MAX,
  SCROLL_RATE_MIN,
} from '../core/constants';
import { MAX_ZOOM, MIN_ZOOM, clampCamera } from '../render/camera';

const SCROLL_RATE_KEY = 'pa-scrollRate';
const SCROLL_RATE_REREAD_MS = 1000;
const RMB_PAN_FULL_SPEED_PX = 120;

export class CameraControls {
  private canvas: HTMLCanvasElement;
  private cam: Camera;
  private getMap: () => GameMap;
  private enabled = false;
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, inside: false };
  private rmb = { down: false, sx: 0, sy: 0, panning: false };
  private edgeDwellMs = 0;
  private scrollRate = SCROLL_RATE_DEFAULT;
  private scrollRateReadAt = -Infinity;

  private onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private onMouseDown = (e: MouseEvent) => this.handleMouseDown(e);
  private onMouseUp = (e: MouseEvent) => this.handleMouseUp(e);
  private onContextMenu = (e: MouseEvent) => e.preventDefault();
  private onWheel = (e: WheelEvent) => this.handleWheel(e);
  private onKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (this.isCameraKey(key)) e.preventDefault();
    this.keys.add(key);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => {
    this.keys.clear();
    this.rmb.down = false;
    this.rmb.panning = false;
    this.edgeDwellMs = 0;
  };
  private onDocLeave = () => {
    this.mouse.inside = false;
    this.edgeDwellMs = 0;
  };

  constructor(canvas: HTMLCanvasElement, cam: Camera, getMap: () => GameMap) {
    this.canvas = canvas;
    this.cam = cam;
    this.getMap = getMap;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.documentElement.addEventListener('mouseleave', this.onDocLeave);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.documentElement.removeEventListener('mouseleave', this.onDocLeave);
  }

  update(dtMs: number, viewW: number, viewH: number, paused: boolean): void {
    if (!this.enabled || paused) return;
    const now = performance.now();
    const dt = dtMs / 1000;
    const rate = this.readScrollRate(now);
    let dirX = 0;
    let dirY = 0;
    let speed = rate;

    if (this.keys.has('w') || this.keys.has('arrowup')) dirY -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dirY += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dirX -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dirX += 1;

    const edge = this.rmb.down ? null : this.edgeScrollDir(viewW, viewH);
    this.edgeDwellMs = edge !== null ? this.edgeDwellMs + dtMs : 0;
    if (edge !== null && this.edgeDwellMs >= EDGE_SCROLL_DWELL_MS) {
      dirX += edge.dx;
      dirY += edge.dy;
    }

    if (this.rmb.down && this.rmb.panning) {
      const vx = this.mouse.x - this.rmb.sx;
      const vy = this.mouse.y - this.rmb.sy;
      const len = Math.hypot(vx, vy);
      if (len > 0.5) {
        dirX = vx / len;
        dirY = vy / len;
        speed = rate * RMB_PAN_MULT * Math.min(1, len / RMB_PAN_FULL_SPEED_PX);
      }
    }

    const len = Math.hypot(dirX, dirY);
    if (len > 0 && dt > 0) {
      const step = (speed * dt) / this.cam.zoom;
      this.cam.x += (dirX / len) * step;
      this.cam.y += (dirY / len) * step;
      clampCamera(this.cam, this.getMap(), viewW, viewH);
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
    this.mouse.inside =
      e.clientX >= rect.left && e.clientX < rect.right && e.clientY >= rect.top && e.clientY < rect.bottom;
    if (this.rmb.down && (e.buttons & 2) === 0) {
      this.rmb.down = false;
      this.rmb.panning = false;
    } else if (this.rmb.down && !this.rmb.panning) {
      if (Math.hypot(this.mouse.x - this.rmb.sx, this.mouse.y - this.rmb.sy) > RMB_PAN_DEADZONE) {
        this.rmb.panning = true;
      }
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    if (e.button !== 2) return;
    this.rmb = { down: true, sx: this.mouse.x, sy: this.mouse.y, panning: false };
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button !== 2) return;
    this.rmb.down = false;
    this.rmb.panning = false;
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    const before = this.cam.zoom;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, before * factor));
    if (Math.abs(next - before) < 0.0001) return;
    const wx = e.offsetX / before + this.cam.x;
    const wy = e.offsetY / before + this.cam.y;
    this.cam.zoom = next;
    this.cam.x = wx - e.offsetX / next;
    this.cam.y = wy - e.offsetY / next;
    clampCamera(this.cam, this.getMap(), this.canvas.width, this.canvas.height);
  }

  private edgeScrollDir(viewW: number, viewH: number): { dx: number; dy: number } | null {
    if (!this.mouse.inside) return null;
    let dx = 0;
    let dy = 0;
    if (this.mouse.x <= EDGE_SCROLL_BAND) dx = -1;
    else if (this.mouse.x >= viewW - 1 - EDGE_SCROLL_BAND) dx = 1;
    if (this.mouse.y <= EDGE_SCROLL_BAND) dy = -1;
    else if (this.mouse.y >= viewH - 1 - EDGE_SCROLL_BAND) dy = 1;
    return dx === 0 && dy === 0 ? null : { dx, dy };
  }

  private readScrollRate(now: number): number {
    if (now - this.scrollRateReadAt < SCROLL_RATE_REREAD_MS) return this.scrollRate;
    this.scrollRateReadAt = now;
    let v = NaN;
    try {
      const raw = localStorage.getItem(SCROLL_RATE_KEY);
      if (raw !== null) v = Number(raw);
    } catch {
      /* keep default */
    }
    this.scrollRate =
      Number.isFinite(v) && v > 0 ? Math.max(SCROLL_RATE_MIN, Math.min(SCROLL_RATE_MAX, v)) : SCROLL_RATE_DEFAULT;
    return this.scrollRate;
  }

  private isCameraKey(key: string): boolean {
    return key === 'w' || key === 'a' || key === 's' || key === 'd' || key.startsWith('arrow');
  }
}
