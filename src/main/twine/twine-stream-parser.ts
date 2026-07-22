export interface TwineStreamDelta {
  text: string;
  type: 'text-delta' | 'thought-delta';
}

const THOUGHT_START = '<|channel>thought';
const THOUGHT_END = '<channel|>';

function trailingMarkerPrefixLength(value: string, marker: string): number {
  const maximum = Math.min(value.length, marker.length - 1);
  for (let length = maximum; length > 0; length -= 1) {
    if (marker.startsWith(value.slice(-length))) {
      return length;
    }
  }
  return 0;
}

export class TwineStreamParser {
  private buffer = '';
  private channel: 'text' | 'thought' = 'text';

  constructor(private readonly includeThoughts: boolean) {}

  push(value: string): TwineStreamDelta[] {
    this.buffer += value;
    return this.drain(false);
  }

  flush(): TwineStreamDelta[] {
    return this.drain(true);
  }

  private drain(flush: boolean): TwineStreamDelta[] {
    const deltas: TwineStreamDelta[] = [];

    while (this.buffer) {
      const marker = this.channel === 'text' ? THOUGHT_START : THOUGHT_END;
      const markerIndex = this.buffer.indexOf(marker);

      if (markerIndex >= 0) {
        this.emit(deltas, this.buffer.slice(0, markerIndex));
        this.buffer = this.buffer.slice(markerIndex + marker.length);
        if (this.channel === 'text') {
          this.buffer = this.buffer.replace(/^\s*\n?/, '');
          this.channel = 'thought';
        } else {
          this.channel = 'text';
        }
        continue;
      }

      if (flush) {
        this.emit(deltas, this.buffer);
        this.buffer = '';
        break;
      }

      const retained = trailingMarkerPrefixLength(this.buffer, marker);
      const readyLength = this.buffer.length - retained;
      if (readyLength === 0) {
        break;
      }
      this.emit(deltas, this.buffer.slice(0, readyLength));
      this.buffer = this.buffer.slice(readyLength);
    }

    return deltas;
  }

  private emit(deltas: TwineStreamDelta[], text: string): void {
    if (!text || (this.channel === 'thought' && !this.includeThoughts)) {
      return;
    }
    deltas.push({
      text,
      type: this.channel === 'thought' ? 'thought-delta' : 'text-delta',
    });
  }
}
