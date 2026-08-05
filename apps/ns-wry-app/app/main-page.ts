import { Observable, NavigatedData, Page } from '@nativescript/core';
import { WryRuntime } from '@cross-code/ns-wry';

export class MainViewModel extends Observable {
  private _title: string;
  private _status: string;
  private _url: string;

  constructor() {
    super();

    this._url = 'https://google.com';
    this._title = 'ns-wry';
    this._status = 'Wry engine v' + WryRuntime.version();
  }

  get title(): string {
    return this._title;
  }

  get status(): string {
    return this._status;
  }

  get url(): string {
    return this._url;
  }
}

export function onNavigatingTo(args: NavigatedData): void {
  const page = args.object as Page;
  page.bindingContext = new MainViewModel();
}
