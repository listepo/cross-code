import type { EventData, Page } from '@nativescript/core';
import type { LynxErrorEventData, LynxView } from '@cross-code/ns-lynx';
import { HelloWorldModel } from './main-view-model';

let model: HelloWorldModel | undefined;

export function navigatingTo(args: EventData): void {
  const page = args.object as Page;
  model ??= new HelloWorldModel();
  page.bindingContext = model;
  model.attach(page.getViewById<LynxView>('lynx'));
}

export function onLynxLoaded(): void {
  model?.onLynxLoaded();
}

export function onLynxError(args: LynxErrorEventData): void {
  model?.onLynxError(args.message);
}

export function onPing(): void {
  model?.onPing();
}
