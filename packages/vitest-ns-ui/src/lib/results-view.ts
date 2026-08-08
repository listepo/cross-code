import {
  Color,
  GridLayout,
  Label,
  Page,
  ScrollView,
  StackLayout,
} from '@nativescript/core';
import type {
  NativeScriptTestDescriptor,
  NativeScriptTestEventSource,
} from '@cross-code/vitest-ns/protocol';
import {
  NativeScriptTestResultModel,
  type NativeScriptResultSnapshot,
} from './result-model.js';

export interface VitestResultsViewOptions {
  model?: NativeScriptTestResultModel;
  source?: NativeScriptTestEventSource;
}

const MONO = 'SF Mono, Menlo, Consolas, monospace';

const C = {
  bg: new Color('#1a1b26'),
  surface: new Color('#24283b'),
  border: new Color('#414868'),
  text: new Color('#c0caf5'),
  dim: new Color('#565f89'),
  pass: new Color('#9ece6a'),
  fail: new Color('#f7768e'),
  run: new Color('#7aa2f7'),
  skipDim: new Color('#9d7cd8'),
};

function stColor(s: string): Color {
  switch (s) {
    case 'passed': return C.pass;
    case 'failed': return C.fail;
    case 'running': return C.run;
    case 'skipped':
    case 'todo': return C.skipDim;
    default: return C.dim;
  }
}

function stIcon(s: string): string {
  switch (s) {
    case 'passed': return '✓';
    case 'failed': return '✗';
    case 'running': return '↻';
    case 'skipped':
    case 'todo': return '○';
    default: return '·';
  }
}

interface TreeNode {
  name: string;
  fullName: string;
  tests: NativeScriptTestDescriptor[];
  children: Map<string, TreeNode>;
}

function buildTree(tests: readonly NativeScriptTestDescriptor[]): TreeNode {
  const root: TreeNode = { name: '', fullName: '', tests: [], children: new Map() };
  for (const test of tests) {
    const parts = test.fullName.split(' > ');
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur.children.has(p)) {
        cur.children.set(p, {
          name: p,
          fullName: parts.slice(0, i + 1).join(' > '),
          tests: [],
          children: new Map(),
        });
      }
      cur = cur.children.get(p)!;
    }
    cur.tests.push(test);
  }
  return root;
}

function hasFailed(n: TreeNode): boolean {
  for (const t of n.tests) if (t.state === 'failed') return true;
  for (const c of n.children.values()) if (hasFailed(c)) return true;
  return false;
}

function nodeSt(n: TreeNode): string {
  if (hasFailed(n)) return 'failed';
  for (const t of n.tests) if (t.state === 'running') return 'running';
  for (const c of n.children.values()) {
    const s = nodeSt(c);
    if (s === 'running' || s === 'failed') return s;
  }
  return 'passed';
}

function label(text: string, color: Color, size: number, mono = false): Label {
  const l = new Label();
  l.text = text;
  l.color = color;
  l.fontSize = size;
  if (mono) l.fontFamily = MONO;
  return l;
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
    this.backgroundColor = C.bg;
    this.padding = 12;

    const header = new StackLayout();
    header.padding = 14;
    header.backgroundColor = C.surface;
    header.borderRadius = 8;

    this.titleLabel.fontFamily = MONO;
    this.titleLabel.fontSize = 14;
    this.titleLabel.fontWeight = '700';
    this.titleLabel.color = C.text;
    this.summaryLabel.fontFamily = MONO;
    this.summaryLabel.fontSize = 12;
    this.summaryLabel.color = C.dim;
    this.summaryLabel.marginTop = 6;
    this.errorLabel.fontFamily = MONO;
    this.errorLabel.fontSize = 12;
    this.errorLabel.color = C.fail;
    this.errorLabel.textWrap = true;
    this.errorLabel.marginTop = 6;

    header.addChild(this.titleLabel);
    header.addChild(this.summaryLabel);
    header.addChild(this.errorLabel);
    GridLayout.setRow(header, 0);
    this.addChild(header);

    const scroll = new ScrollView();
    scroll.marginTop = 8;
    scroll.content = this.testList;
    GridLayout.setRow(scroll, 1);
    this.addChild(scroll);

    this.detachModel = this.model.subscribe((snap) => this.render(snap));
    if (options.source) this.connect(options.source);
  }

  connect(source: NativeScriptTestEventSource): void {
    this.detachSource?.();
    this.detachSource = source.subscribe((e) => this.model.apply(e));
  }

  disconnect(): void {
    this.detachSource?.();
    this.detachSource = undefined;
  }

  dispose(): void {
    this.disconnect();
    this.detachModel();
  }

  private render(snap: NativeScriptResultSnapshot): void {
    const { summary: s } = snap;
    this.titleLabel.text = ` vitest ${snap.status === 'running' ? '↻' : snap.status === 'passed' ? '✓' : '✗'} `;
    this.titleLabel.color = stColor(snap.status);
    this.summaryLabel.text =
      `${s.passed} passed  ${s.failed} failed  ${s.skipped} skipped  ${s.total} total`;
    this.errorLabel.text = snap.error ?? '';

    this.testList.removeChildren();
    const tree = buildTree(snap.tests);
    this.renderTree(tree, this.testList, 0, []);
  }

  private renderTree(node: TreeNode, parent: StackLayout, depth: number, prefix: string[]): void {
    const keys = [...node.children.keys()];
    const testCount = node.tests.length;

    keys.forEach((key, idx) => {
      const child = node.children.get(key)!;
      const isLast = idx === keys.length - 1 && testCount === 0;
      const branch = isLast ? '└─ ' : '├─ ';
      const status = nodeSt(child);

      const container = new StackLayout();
      container.marginBottom = 2;

      const row = new StackLayout();
      row.orientation = 'horizontal';
      row.paddingLeft = 12 + depth * 16;
      row.paddingTop = 4;
      row.paddingBottom = 4;

      const indent = label(prefix.join('') + branch, C.dim, 12, true);
      indent.verticalAlignment = 'middle';

      const chevron = label('▸ ', C.dim, 12, true);
      chevron.verticalAlignment = 'middle';

      const name = label(child.name, stColor(status), 12, true);
      name.fontWeight = '600';
      name.verticalAlignment = 'middle';

      row.addChild(indent);
      row.addChild(chevron);
      row.addChild(name);
      container.addChild(row);

      const childBox = new StackLayout();
      childBox.visibility = 'collapsed';
      container.addChild(childBox);

      let open = false;
      row.on('tap', () => {
        open = !open;
        chevron.text = open ? '▾ ' : '▸ ';
        childBox.visibility = open ? 'visible' : 'collapsed';
      });

      const nextPrefix = [...prefix, isLast ? '   ' : '│  '];
      this.renderTree(child, childBox, depth + 1, nextPrefix);
      this.renderLeaves(child, childBox, depth + 1, nextPrefix);
      parent.addChild(container);
    });

    this.renderLeaves(node, parent, depth, prefix);
  }

  private renderLeaves(node: TreeNode, parent: StackLayout, depth: number, prefix: string[]): void {
    node.tests.forEach((test, idx) => {
      const isLast = idx === node.tests.length - 1;
      const branch = isLast ? '└─ ' : '├─ ';

      const row = new StackLayout();
      row.orientation = 'horizontal';
      row.paddingLeft = 12 + depth * 16;
      row.paddingTop = 3;
      row.paddingBottom = 3;

      const indent = label(prefix.join('') + branch, C.dim, 12, true);
      indent.verticalAlignment = 'middle';

      const icon = label(stIcon(test.state) + ' ', stColor(test.state), 12, true);
      icon.verticalAlignment = 'middle';

      const name = label(test.name, stColor(test.state), 12, true);
      name.verticalAlignment = 'middle';

      row.addChild(indent);
      row.addChild(icon);
      row.addChild(name);
      parent.addChild(row);

      if (test.duration !== undefined || test.error) {
        const parts: string[] = [];
        if (test.duration !== undefined) parts.push(`${test.duration.toFixed(0)}ms`);
        if (test.error) parts.push(test.error);

        const detail = label(parts.join(' '), test.error ? C.fail : C.dim, 10, true);
        detail.marginLeft = 12 + depth * 16 + 36;
        detail.marginBottom = 2;
        parent.addChild(detail);
      }

      row.on('tap', () => {
        const expanded = name.textWrap;
        name.textWrap = !expanded;
        name.text = expanded ? test.name : test.fullName;
      });
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
