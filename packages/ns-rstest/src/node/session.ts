import { spawn, type ChildProcess } from 'node:child_process';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  NS_RSTEST_PROTOCOL_VERSION,
  isNativeScriptRstestWireMessage,
  type NativeScriptRstestWireMessage,
  type NativeScriptRuntimeOverrides,
  type NativeScriptTestEvent,
} from '../protocol.js';
import type { ResolvedNativeScriptRstestOptions } from './options.js';

export type NativeScriptEventListener = (
  slot: number,
  event: NativeScriptTestEvent,
) => void;

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // A session error rejects every pending waiter; without this the default
  // unhandled-rejection handler would tear the run down before it reports.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/**
 * Node side of the device connection: serves the coordinator socket, launches
 * the NativeScript CLI, and exposes the handshake as awaitable steps.
 */
export class NativeScriptRstestSession {
  private server: WebSocketServer | undefined;
  private socket: WebSocket | undefined;
  private child: ChildProcess | undefined;
  private closePromise: Promise<void> | undefined;
  private readonly connected = createDeferred<void>();
  private readonly failed = createDeferred<never>();
  private readonly ready = new Map<number, Deferred<void>>();
  private readonly listeners = new Set<NativeScriptEventListener>();
  private failure: Error | undefined;

  constructor(private readonly options: ResolvedNativeScriptRstestOptions) {}

  onEvent(listener: NativeScriptEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.options.host,
        port: this.options.port,
      });
      this.server = server;
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.once('listening', () => {
        server.off('error', onError);
        resolve();
      });
      server.on('connection', (socket) => this.acceptConnection(socket));
    });

    if (this.options.launch) this.launchApp();
  }

  /** Resolves once the device coordinator has completed its `hello`. */
  waitForDevice(): Promise<void> {
    return this.withTimeout(this.connected.promise, 'coordinator');
  }

  /**
   * Never resolves; rejects when the socket, the CLI, or the device reports a
   * failure. Race a run against it so a crashed app cannot hang the host.
   */
  whenFailed(): Promise<never> {
    return this.failed.promise;
  }

  waitForWorker(slot: number): Promise<void> {
    return this.withTimeout(this.getReady(slot).promise, `worker ${slot}`);
  }

  configure(rootPath: string, runtime: NativeScriptRuntimeOverrides): void {
    this.send({
      kind: 'configure',
      protocol: NS_RSTEST_PROTOCOL_VERSION,
      workers: this.options.workers,
      rootPath,
      runtime,
    });
  }

  run(slot: number, files: string[]): void {
    this.send({ kind: 'run', slot, files });
  }

  async close(): Promise<void> {
    this.closePromise ??= this.doClose();
    return this.closePromise;
  }

  private async withTimeout<Value>(
    promise: Promise<Value>,
    what: string,
  ): Promise<Value> {
    return new Promise<Value>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `NativeScript Rstest ${what} did not connect within ${this.options.connectTimeout}ms`,
          ),
        );
      }, this.options.connectTimeout);
      timer.unref?.();
      void promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error as Error);
        },
      );
    });
  }

  private getReady(slot: number): Deferred<void> {
    let deferred = this.ready.get(slot);
    if (!deferred) {
      deferred = createDeferred<void>();
      if (this.failure) deferred.reject(this.failure);
      this.ready.set(slot, deferred);
    }
    return deferred;
  }

  private launchApp(): void {
    const { command, args } = this.options.launchCommand;
    this.child = spawn(command, args, {
      cwd: this.options.appPath,
      env: process.env,
      stdio: 'inherit',
    });
    this.child.once('error', (error) => this.fail(error));
    this.child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM') return;
      this.fail(
        new Error(
          `NativeScript CLI exited before tests completed (${signal ?? code ?? 'unknown'})`,
        ),
      );
    });
  }

  private acceptConnection(socket: WebSocket): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close(1013, 'A NativeScript Rstest coordinator is active');
    }

    this.socket = socket;
    socket.on('message', (raw) => this.onMessage(raw));
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined;
    });
    socket.on('error', (error) => this.fail(error));
  }

  private onMessage(raw: RawData): void {
    let message: unknown;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      this.fail(new Error(`Invalid NativeScript Rstest frame: ${String(error)}`));
      return;
    }

    if (!isNativeScriptRstestWireMessage(message)) {
      this.fail(
        new Error('Received an invalid NativeScript Rstest protocol message'),
      );
      return;
    }

    switch (message.kind) {
      case 'hello':
        this.connected.resolve();
        return;
      case 'worker-ready':
        this.getReady(message.slot).resolve();
        return;
      case 'event':
        this.listeners.forEach((listener) =>
          listener(message.slot, message.event),
        );
        return;
      case 'error':
        this.fail(new Error(message.message));
        return;
      default:
        return;
    }
  }

  private send(message: NativeScriptRstestWireMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('NativeScript Rstest coordinator is not connected');
    }
    this.socket.send(JSON.stringify(message));
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.connected.reject(error);
    this.failed.reject(error);
    this.ready.forEach((deferred) => deferred.reject(error));
  }

  private async doClose(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ kind: 'stop' }));
    }
    if (this.child && !this.child.killed) this.child.kill('SIGTERM');
    this.child = undefined;

    this.socket?.terminate();
    this.socket = undefined;

    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}
