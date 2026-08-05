import { parse as flatParse, stringify as flatStringify } from 'flatted';
import {
  DEFAULT_NATIVE_SCRIPT_VITEST_PORT,
  NATIVE_SCRIPT_VITEST_PROTOCOL_VERSION,
  isNativeScriptVitestWireMessage,
  type NativeScriptTestEvent,
  type NativeScriptTestEventListener,
  type NativeScriptTestEventSource,
  type NativeScriptVitestWireMessage,
} from '../protocol.js';

interface MessageEventLike {
  data: unknown;
}

interface ErrorEventLike {
  message?: string;
}

export interface NativeScriptWorkerHandle {
  onmessage: ((event: MessageEventLike) => void) | null;
  onerror: ((event: ErrorEventLike) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface NativeScriptWebSocketHandle {
  onopen: (() => void) | null;
  onmessage: ((event: MessageEventLike) => void) | null;
  onerror: ((event: ErrorEventLike) => void) | null;
  onclose: (() => void) | null;
  send(message: string): void;
  close(): void;
}

export interface NativeScriptVitestCoordinatorOptions {
  createWorker(slot: number): NativeScriptWorkerHandle;
  url?: string;
  port?: number;
  createSocket?: (url: string) => NativeScriptWebSocketHandle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function defaultNativeScriptVitestUrl(
  port = DEFAULT_NATIVE_SCRIPT_VITEST_PORT,
): string {
  const isAndroidRuntime = 'android' in globalThis;
  return `ws://${isAndroidRuntime ? '10.0.2.2' : '127.0.0.1'}:${port}`;
}

function defaultSocketFactory(url: string): NativeScriptWebSocketHandle {
  const WebSocketConstructor = (
    globalThis as unknown as {
      WebSocket?: new (address: string) => NativeScriptWebSocketHandle;
    }
  ).WebSocket;
  if (!WebSocketConstructor) {
    throw new Error('NativeScript WebSocket global is unavailable');
  }
  return new WebSocketConstructor(url);
}

export class NativeScriptVitestCoordinator implements NativeScriptTestEventSource {
  private readonly listeners = new Set<NativeScriptTestEventListener>();
  private readonly workers = new Map<number, NativeScriptWorkerHandle>();
  private socket: NativeScriptWebSocketHandle | undefined;
  private startPromise: Promise<void> | undefined;

  constructor(private readonly options: NativeScriptVitestCoordinatorOptions) {}

  subscribe(listener: NativeScriptTestEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    this.startPromise ??= this.connect();
    return this.startPromise;
  }

  stop(): void {
    this.workers.forEach((worker) => {
      worker.postMessage({ kind: 'stop' });
      worker.terminate();
    });
    this.workers.clear();
    this.socket?.close();
    this.socket = undefined;
    this.startPromise = undefined;
  }

  private connect(): Promise<void> {
    const url =
      this.options.url ?? defaultNativeScriptVitestUrl(this.options.port);
    const socket = (this.options.createSocket ?? defaultSocketFactory)(url);
    this.socket = socket;

    return new Promise<void>((resolve, reject) => {
      socket.onopen = () => {
        this.sendWire({
          kind: 'hello',
          protocol: NATIVE_SCRIPT_VITEST_PROTOCOL_VERSION,
        });
        resolve();
      };
      socket.onmessage = (event) => this.onSocketMessage(event.data);
      socket.onerror = (event) => {
        const message = event.message ?? 'NativeScript Vitest socket failed';
        this.emit({ type: 'worker-error', worker: 0, message });
        reject(new Error(message));
      };
      socket.onclose = () => {
        this.socket = undefined;
      };
    });
  }

  private onSocketMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    const message = flatParse(raw);
    if (!isNativeScriptVitestWireMessage(message)) return;

    if (message.kind === 'configure') {
      this.configureWorkers(message.workers);
      return;
    }
    if (message.kind === 'worker-message') {
      this.workers.get(message.slot)?.postMessage({
        kind: 'pool-message',
        frame: message.frame,
      });
      return;
    }
    if (message.kind === 'error') {
      this.emit({ type: 'worker-error', worker: 0, message: message.message });
    }
  }

  private configureWorkers(count: number): void {
    for (let slot = 0; slot < count; slot += 1) {
      if (this.workers.has(slot)) continue;
      const worker = this.options.createWorker(slot);
      worker.onmessage = (event) => this.onWorkerMessage(slot, event.data);
      worker.onerror = (event) => {
        this.emit({
          type: 'worker-error',
          worker: slot,
          message: event.message ?? `NativeScript worker ${slot} failed`,
        });
      };
      this.workers.set(slot, worker);
      worker.postMessage({ kind: 'start', slot });
    }
  }

  private onWorkerMessage(slot: number, message: unknown): void {
    if (!isRecord(message) || typeof message.kind !== 'string') return;

    if (message.kind === 'worker-ready') {
      this.sendWire({ kind: 'worker-ready', slot });
      return;
    }
    if (message.kind === 'pool-message' && typeof message.frame === 'string') {
      this.sendWire({ kind: 'worker-message', slot, frame: message.frame });
      return;
    }
    if (message.kind === 'test-event' && isRecord(message.event)) {
      this.emit(message.event as unknown as NativeScriptTestEvent);
    }
  }

  private sendWire(message: NativeScriptVitestWireMessage): void {
    this.socket?.send(flatStringify(message));
  }

  private emit(event: NativeScriptTestEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
