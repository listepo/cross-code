import { Color } from '@nativescript/core/color/index.js';
import { GridLayout } from '@nativescript/core/ui/layouts/grid-layout/index.js';
import { StackLayout } from '@nativescript/core/ui/layouts/stack-layout/index.js';
import { Label } from '@nativescript/core/ui/label/index.js';
import { Page } from '@nativescript/core/ui/page/index.js';
import { ScrollView } from '@nativescript/core/ui/scroll-view/index.js';
import type { NativeScriptTestEventSource } from '@cross-code/vitest-nativescript/protocol';
import {
  NativeScriptTestResultModel,
  type NativeScriptResultSnapshot,
} from './result-model.js';

export interface VitestResultsViewOptions {
  model?: NativeScriptTestResultModel;
  source?: NativeScriptTestEventSource;
}

const COLORS = {
  background: new Color('#0b1020'),
  panel: new Color('#151c31'),
  text: new Color('#f4f7ff'),
  muted: new Color('#9ca9c9'),
  passed: new Color('#57d38c'),
  failed: new Color('#ff6b7a'),
  running: new Color('#72a7ff'),
  skipped: new Color('#c4a7e7'),
};

function statusColor(status: string): Color {
  if (status === 'passed') return COLORS.passed;
  if (status === 'failed') return COLORS.failed;
  if (status === 'running') return COLORS.running;
  if (status === 'skipped' || status === 'todo') return COLORS.skipped;
  return COLORS.muted;
}

export class VitestResultsView extends GridLayout {
  readonly model: NativeScriptTestResultModel;

  private readonly titleLabel = new Label();
  private readonly summaryLabel = new Label();
  private readonly errorLabel = new Label();
  private readonly testList = new StackLayout();
  private detachSource: (() => void) | undefined;
  private readonly detachModel: () => void;

  constructor(options: VitestResultsViewOptions = {}) {
    super();
    this.model = options.model ?? new NativeScriptTestResultModel();
    this.rows = 'auto, *';
    this.backgroundColor = COLORS.background;
    this.padding = 16;

    const header = new StackLayout();
    header.padding = 14;
    header.backgroundColor = COLORS.panel;
    header.borderRadius = 12;

    this.titleLabel.fontSize = 22;
    this.titleLabel.fontWeight = '700';
    this.titleLabel.color = COLORS.text;
    this.summaryLabel.fontSize = 14;
    this.summaryLabel.color = COLORS.muted;
    this.summaryLabel.marginTop = 6;
    this.errorLabel.fontSize = 13;
    this.errorLabel.color = COLORS.failed;
    this.errorLabel.textWrap = true;
    this.errorLabel.marginTop = 6;

    header.addChild(this.titleLabel);
    header.addChild(this.summaryLabel);
    header.addChild(this.errorLabel);
    GridLayout.setRow(header, 0);
    this.addChild(header);

    const scroll = new ScrollView();
    scroll.marginTop = 12;
    scroll.content = this.testList;
    GridLayout.setRow(scroll, 1);
    this.addChild(scroll);

    this.detachModel = this.model.subscribe((snapshot) =>
      this.render(snapshot),
    );
    if (options.source) this.connect(options.source);
  }

  connect(source: NativeScriptTestEventSource): void {
    this.detachSource?.();
    this.detachSource = source.subscribe((event) => this.model.apply(event));
  }

  disconnect(): void {
    this.detachSource?.();
    this.detachSource = undefined;
  }

  dispose(): void {
    this.disconnect();
    this.detachModel();
  }

  private render(snapshot: NativeScriptResultSnapshot): void {
    const { summary } = snapshot;
    this.titleLabel.text = `Vitest · ${snapshot.status}`;
    this.titleLabel.color = statusColor(snapshot.status);
    this.summaryLabel.text =
      `${summary.passed} passed · ${summary.failed} failed · ` +
      `${summary.skipped} skipped · ${summary.total} total · ` +
      `${snapshot.files} file(s)`;
    this.errorLabel.text = snapshot.error ?? '';

    this.testList.removeChildren();
    snapshot.tests.forEach((test) => {
      const row = new StackLayout();
      row.padding = 12;
      row.marginBottom = 8;
      row.backgroundColor = COLORS.panel;
      row.borderRadius = 10;

      const name = new Label();
      name.text = `${test.state === 'passed' ? '✓' : test.state === 'failed' ? '×' : '•'} ${test.fullName}`;
      name.textWrap = true;
      name.color = statusColor(test.state);
      name.fontSize = 15;
      row.addChild(name);

      if (test.duration !== undefined || test.error) {
        const detail = new Label();
        detail.text = [
          test.duration === undefined
            ? undefined
            : `${test.duration.toFixed(1)}ms`,
          test.error,
        ]
          .filter((value): value is string => Boolean(value))
          .join(' · ');
        detail.textWrap = true;
        detail.color = test.error ? COLORS.failed : COLORS.muted;
        detail.fontSize = 12;
        detail.marginTop = 4;
        row.addChild(detail);
      }

      this.testList.addChild(row);
    });
  }
}

export function createVitestResultsPage(
  source: NativeScriptTestEventSource,
): Page {
  const page = new Page();
  page.actionBarHidden = true;
  page.content = new VitestResultsView({ source });
  return page;
}
