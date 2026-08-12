import {
  DEFAULT_NS_RSTEST_PORT,
  NS_RSTEST_PROTOCOL_VERSION,
  isNativeScriptRstestWireMessage,
  type NativeScriptTestEvent,
  type NativeScriptTestEventListener,
  type NativeScriptTestEventSource,
  type NativeScriptRstestWireMessage,
} from '../protocol.js';

interface MessageEventLike {
  data: unknown;
}

interface ErrorEventLike {
  message?: string;
}

type EventHandler<Event> = {
  bivarianceHack(event: Event): void;
}['bivarianceHack'];

export interface NativeScriptWorkerHandle {
  onmessage: EventHandler<MessageEventLike> | null;
  onerror: EventHandler<ErrorEventLike> | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export interface NativeScriptWebSocketHandle {
  readonly readyState?: number;
  onopen: (() => void) | null;
  onmessage: ((event: MessageEventLike) => void) | null;
  onerror: ((event: ErrorEventLike) => void) | null;
  onclose: (() => void) | null;
  send(message: string): void;
  close(): void;
}

export interface NativeScriptRstestCoordinatorOptions {
  createWorker(slot: number): NativeScriptWorkerHandle;
  url?: string;
  port?: number;
  createSocket?: (url: string) => NativeScriptWebSocketHandle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function defaultNativeScriptRstestUrl(
  port = DEFAULT_NS_RSTEST_PORT,
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

/**
 * Runs on the NativeScript main thread: owns the socket to the Node host and
 * one long-lived `Worker` per slot, and relays run commands down and test
 * events up. Also an event source the on-device results view can subscribe to.
 */
export class NativeScriptRstestCoordinator
  implements NativeScriptTestEventSource
{
  private readonly listeners = new Set<NativeScriptTestEventListener>();
  private readonly workers = new Map<number, NativeScriptWorkerHandle>();
  private socket: NativeScriptWebSocketHandle | undefined;
  private startPromise: Promise<void> | undefined;

  constructor(private readonly options: NativeScriptRstestCoordinatorOptions) {}

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
      this.options.url ?? defaultNativeScriptRstestUrl(this.options.port);
    const socket = (this.options.createSocket ?? defaultSocketFactory)(url);
    this.socket = socket;

    return new Promise<void>((resolve, reject) => {
      let opened = false;
      let openPoll: ReturnType<typeof setInterval> | undefined;
      const clearOpenPoll = (): void => {
        if (openPoll !== undefined) clearInterval(openPoll);
        openPoll = undefined;
      };
      const handleOpen = (): void => {
        if (opened) return;
        opened = true;
        clearOpenPoll();
        this.sendWire({
          kind: 'hello',
          protocol: NS_RSTEST_PROTOCOL_VERSION,
        });
        resolve();
      };
      socket.onopen = handleOpen;
      socket.onmessage = (event) => this.onSocketMessage(event.data);
      socket.onerror = (event) => {
        clearOpenPoll();
        const message = event.message ?? 'NativeScript Rstest socket failed';
        this.emit({ type: 'worker-error', worker: 0, message });
        reject(new Error(message));
      };
      socket.onclose = () => {
        clearOpenPoll();
        this.socket = undefined;
        if (!opened) reject(new Error('NativeScript Rstest socket closed'));
      };
      // Browser WebSockets always dispatch `open` asynchronously, but some
      // NativeScript polyfills can finish a loopback connection in their
      // constructor before the coordinator assigns `onopen`.
      if (socket.readyState === 1) handleOpen();
      else if (socket.readyState !== undefined) {
        openPoll = setInterval(() => {
          if (socket.readyState === 1) handleOpen();
        }, 25);
      }
    });
  }

  private onSocketMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    const message: unknown = JSON.parse(raw);
    if (!isNativeScriptRstestWireMessage(message)) return;

    switch (message.kind) {
      case 'configure':
        this.configureWorkers(message);
        return;
      case 'run':
        this.workers.get(message.slot)?.postMessage({
          kind: 'run',
          files: message.files,
        });
        return;
      case 'stop':
        this.stop();
        return;
      case 'error':
        this.emit({ type: 'worker-error', worker: 0, message: message.message });
    }
  }

  private configureWorkers(
    message: Extract<NativeScriptRstestWireMessage, { kind: 'configure' }>,
  ): void {
    for (let slot = 0; slot < message.workers; slot += 1) {
      const existing = this.workers.get(slot);
      if (existing) {
        existing.postMessage({
          kind: 'configure',
          rootPath: message.rootPath,
          runtime: message.runtime,
        });
        continue;
      }
      const worker = this.options.createWorker(slot);
      worker.onmessage = (event) =>
        this.onWorkerMessage(slot, event.data, message);
      worker.onerror = (event) => {
        this.emit({
          type: 'worker-error',
          worker: slot,
          message: event.message ?? `NativeScript worker ${slot} failed`,
        });
      };
      this.workers.set(slot, worker);
    }
  }

  private onWorkerMessage(
    slot: number,
    message: unknown,
    configure: Extract<NativeScriptRstestWireMessage, { kind: 'configure' }>,
  ): void {
    if (!isRecord(message) || typeof message.kind !== 'string') return;

    if (message.kind === 'runtime-ready') {
      const worker = this.workers.get(slot);
      worker?.postMessage({
        kind: 'configure',
        rootPath: configure.rootPath,
        runtime: configure.runtime,
      });
      worker?.postMessage({ kind: 'start', slot });
      return;
    }
    if (message.kind === 'worker-ready') {
      this.sendWire({ kind: 'worker-ready', slot });
      return;
    }
    if (message.kind === 'test-event' && isRecord(message.event)) {
      const event = message.event as unknown as NativeScriptTestEvent;
      this.sendWire({ kind: 'event', slot, event });
      this.emit(event);
    }
  }

  private sendWire(message: NativeScriptRstestWireMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private emit(event: NativeScriptTestEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
