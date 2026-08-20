import { Observable } from '@nativescript/core';
import type { LynxView } from '@cross-code/ns-lynx';

/**
 * The host side of the demo. It owns the data handed to Lynx on first render
 * and pushes global events into the running page — the two directions the
 * NativeScript↔Lynx boundary supports without any native glue.
 */
export class HelloWorldModel extends Observable {
  private pings = 0;
  private lynxView: LynxView | undefined;

  constructor() {
    super();
    this.set('status', 'loading the Lynx bundle…');
    this.set('initData', {
      greeting: 'Hello from the NativeScript host',
      renderedAt: new Date().toLocaleTimeString(),
    });
  }

  attach(view: LynxView): void {
    this.lynxView = view;
  }

  onLynxLoaded(): void {
    this.set('status', 'Lynx bundle rendered');
  }

  onLynxError(message: string): void {
    this.set('status', `Lynx error: ${message}`);
  }

  onPing(): void {
    this.pings += 1;
    this.lynxView?.sendGlobalEvent('hostPing', [
      `ping #${this.pings} at ${new Date().toLocaleTimeString()}`,
    ]);
  }
}
