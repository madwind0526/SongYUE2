declare module 'abcjs' {
  export function renderAbc(output: string | HTMLElement, abc: string, params?: Record<string, unknown>): TuneObject[];

  export interface TuneObject {
    millisecondsPerMeasure?: () => number;
    totalTime?: number;
  }

  export interface SynthEvent {
    milliseconds?: number;
    elements?: Element[][];
  }

  export interface CursorControl {
    onReady?: (controller: SynthController) => void;
    onStart?: () => void;
    onFinished?: () => void;
    onBeat?: (beatNumber: number, totalBeats: number, totalTime: number, position: unknown) => void;
    onEvent?: (event: SynthEvent) => void;
  }

  export class SynthController {
    percent: number;
    isStarted: boolean;
    isLoaded: boolean;
    visualObj: TuneObject | null;
    cursorControl: CursorControl | null;
    options: Record<string, unknown>;
    midiBuffer: { duration: number } | null;
    load(selector: string, cursorControl: CursorControl | null, visualOptions?: Record<string, unknown>): void;
    setTune(visualObj: TuneObject, userAction: boolean, audioParams?: Record<string, unknown>): Promise<unknown>;
    play(): Promise<unknown>;
    pause(): void;
    restart(): void;
    seek(percent: number, units?: string): void;
    setWarp(newWarp: number): Promise<unknown>;
    destroy(): void;
    go(): Promise<unknown>;
    setProgress(percent: number, totalTime: number): void;
  }

  export const synth: {
    SynthController: typeof SynthController;
    supportsAudio: () => boolean;
  };
}
