import { WindowedSourceView } from '../src/renderer/projects/source-engine/windowed-source-view';

declare global {
  interface Window {
    setUpSourceProfile(lineCount: number): Promise<void>;
    runSourceScrollPass(): Promise<void>;
    runSourceEditPass(): Promise<void>;
  }
}

function representativeSource(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 9 === 0) {
      lines.push(
        `${'#'.repeat((index % 5) + 1)} Seção ${index}: sociedade, religião e poder`,
      );
    } else if (index >= 220 && index < 280) {
      lines.push(`| Dinastia ${index - 219} | Período ${index} | Evidência |`);
    } else if (index % 4 === 0) {
      lines.push(
        `- Item ${index}: administração, comércio e **vida cotidiana**.`,
      );
    } else {
      lines.push(
        `Registro ${index}: política, religião e vida cotidiana no período.`,
      );
    }
  }
  return lines.join('\n');
}

function forceLayout(element: HTMLElement): void {
  void element.offsetHeight;
  void element.scrollHeight;
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

let view: WindowedSourceView;
let target: HTMLDivElement;
let documentSource = '';

window.setUpSourceProfile = async (lineCount) => {
  document.body.style.margin = '0';
  documentSource = representativeSource(lineCount);

  const host = document.createElement('main');
  const body = document.createElement('div');
  target = document.createElement('div');
  host.className = 'markdown-editor';
  host.style.width = '1000px';
  host.style.height = '650px';
  body.className = 'markdown-editor__body markdown-editor__body--edit';
  const wrapper = document.createElement('div');
  wrapper.className = 'markdown-source';
  target.className = 'markdown-source__editor';
  target.dataset.windowed = 'true';
  wrapper.appendChild(target);
  body.appendChild(wrapper);
  host.appendChild(body);
  document.body.appendChild(host);

  view = new WindowedSourceView(target, {
    ariaLabel: 'Profile',
    readOnly: false,
    selection: { direction: 'none', end: 0, start: 0 },
    source: documentSource,
  });
  forceLayout(target);
  await nextFrame();
  forceLayout(target);
};

window.runSourceScrollPass = async () => {
  target.scrollTop = 0;
  target.dispatchEvent(new Event('scroll'));
  await nextFrame();
  const distance = Math.max(0, target.scrollHeight - target.clientHeight);
  for (let index = 1; index <= 240; index += 1) {
    target.scrollTop = (distance * index) / 240;
    target.dispatchEvent(new Event('scroll'));
    await nextFrame();
  }
};

window.runSourceEditPass = async () => {
  const marker = 'vida cotidiana';
  const editOffset = Math.max(
    0,
    documentSource.indexOf(marker, Math.floor(documentSource.length / 3)),
  );
  const before = documentSource.slice(0, editOffset);
  const after = documentSource.slice(editOffset + marker.length);
  for (let index = 0; index < 60; index += 1) {
    const next = `${before}vida cotidiana ${index}${after}`;
    const caret = editOffset + `vida cotidiana ${index}`.length;
    view.setSource(
      next,
      { direction: 'none', end: caret, start: caret },
      {
        nextSelection: { end: caret, start: caret },
        previousSelection: { end: editOffset, start: editOffset },
      },
    );
    forceLayout(target);
    await nextFrame();
  }
};
