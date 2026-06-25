import type { Command } from '../core/types';

export interface OnlineCommandFrame {
  tick: number;
  commands: Command[];
}

export interface OnlineCommandQueueOptions {
  inputDelayTicks: number;
  sendFrame: (tick: number, commands: Command[]) => void;
}

export interface OnlineCommandQueue {
  dispatchLocal(currentTick: number, command: Command): Command[];
  receiveFrame(frame: OnlineCommandFrame): void;
  drain(currentTick: number): Command[];
}

export interface OnlineMatchConnection {
  sendCommandFrame(tick: number, commands: Command[]): void;
  onCommandFrame(handler: (frame: OnlineCommandFrame) => void): void;
}

export function createOnlineCommandQueue(options: OnlineCommandQueueOptions): OnlineCommandQueue {
  const frames = new Map<number, Command[]>();
  const inputDelayTicks = Math.max(0, Math.floor(options.inputDelayTicks));

  const enqueue = (tick: number, commands: Command[]) => {
    const existing = frames.get(tick);
    if (existing) existing.push(...commands);
    else frames.set(tick, [...commands]);
  };

  return {
    dispatchLocal(currentTick, command): Command[] {
      const tick = Math.max(0, Math.floor(currentTick) + inputDelayTicks);
      const commands = [command];
      enqueue(tick, commands);
      options.sendFrame(tick, commands);
      return [];
    },

    receiveFrame(frame): void {
      const tick = Math.max(0, Math.floor(frame.tick));
      if (frame.commands.length === 0) return;
      enqueue(tick, frame.commands);
    },

    drain(currentTick): Command[] {
      const dueTicks = [...frames.keys()].filter((tick) => tick <= currentTick).sort((a, b) => a - b);
      const commands: Command[] = [];
      for (const tick of dueTicks) {
        commands.push(...(frames.get(tick) ?? []));
        frames.delete(tick);
      }
      return commands;
    },
  };
}
