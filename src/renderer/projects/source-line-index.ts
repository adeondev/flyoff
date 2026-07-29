interface LineStartBlock {
  shift: number;
  values: readonly number[];
}

interface LineStartIndex {
  blocks: readonly LineStartBlock[];
  blockStarts: readonly number[];
  length: number;
}

interface BlockPosition {
  block: number;
  offset: number;
}

const BLOCK_TARGET = 256;
const BLOCK_MIN = 128;
const BLOCK_MAX = 384;
const indexes = new WeakMap<readonly number[], LineStartIndex>();

function arrayIndex(property: PropertyKey): number | undefined {
  if (
    typeof property !== 'string' ||
    !/^(?:0|[1-9]\d*)$/.test(property)
  ) {
    return undefined;
  }
  const index = Number(property);
  return Number.isSafeInteger(index) ? index : undefined;
}

function createIndex(
  blocks: readonly LineStartBlock[],
): LineStartIndex {
  const blockStarts = new Array<number>(blocks.length);
  let length = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    blockStarts[index] = length;
    length += blocks[index]!.values.length;
  }
  return { blocks, blockStarts, length };
}

function initialBlocks(values: readonly number[]): LineStartBlock[] {
  const blocks: LineStartBlock[] = [];
  for (let start = 0; start < values.length; start += BLOCK_TARGET) {
    blocks.push({
      shift: 0,
      values: values.slice(start, start + BLOCK_TARGET),
    });
  }
  return blocks;
}

function packedBlocks(values: readonly number[]): LineStartBlock[] {
  if (values.length === 0) {
    return [];
  }
  const count = Math.ceil(values.length / BLOCK_MAX);
  const size = Math.ceil(values.length / count);
  const blocks = new Array<LineStartBlock>(count);
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const end = Math.min(values.length, start + size);
    blocks[index] = { shift: 0, values: values.slice(start, end) };
    start = end;
  }
  return blocks;
}

function shiftedBlock(
  block: LineStartBlock,
  delta: number,
): LineStartBlock {
  return delta === 0
    ? block
    : { shift: block.shift + delta, values: block.values };
}

function appendBlockValues(
  target: number[],
  block: LineStartBlock,
  start = 0,
  end = block.values.length,
  delta = 0,
): void {
  const shift = block.shift + delta;
  for (let index = start; index < end; index += 1) {
    target.push(block.values[index]! + shift);
  }
}

function blockPosition(
  index: LineStartIndex,
  position: number,
): BlockPosition {
  if (index.blocks.length === 0) {
    return { block: 0, offset: 0 };
  }
  if (position >= index.length) {
    const block = index.blocks.length - 1;
    return { block, offset: index.blocks[block]!.values.length };
  }

  let low = 0;
  let high = index.blockStarts.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (index.blockStarts[middle]! <= position) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const block = Math.max(0, high);
  return {
    block,
    offset: position - index.blockStarts[block]!,
  };
}

function valueAt(index: LineStartIndex, position: number): number {
  const located = blockPosition(index, position);
  const block = index.blocks[located.block]!;
  return block.values[located.offset]! + block.shift;
}

function indexAtOffset(index: LineStartIndex, offset: number): number {
  if (index.blocks.length === 0) {
    return 0;
  }

  let low = 0;
  let high = index.blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const block = index.blocks[middle]!;
    if (block.values[0]! + block.shift <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const blockIndex = Math.max(0, high);
  const block = index.blocks[blockIndex]!;
  low = 0;
  high = block.values.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (block.values[middle]! + block.shift <= offset) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return index.blockStarts[blockIndex]! + Math.max(0, high);
}

function arrayView(index: LineStartIndex): readonly number[] {
  const target = new Array<number>(index.length);
  const proxy = new Proxy(target, {
    deleteProperty(array, property) {
      return arrayIndex(property) === undefined
        ? Reflect.deleteProperty(array, property)
        : false;
    },
    get(array, property, receiver) {
      const position = arrayIndex(property);
      return position === undefined || position >= array.length
        ? Reflect.get(array, property, receiver)
        : valueAt(index, position);
    },
    getOwnPropertyDescriptor(array, property) {
      const position = arrayIndex(property);
      if (position !== undefined && position < array.length) {
        return {
          configurable: true,
          enumerable: true,
          value: valueAt(index, position),
          writable: false,
        };
      }
      return Reflect.getOwnPropertyDescriptor(array, property);
    },
    has(array, property) {
      const position = arrayIndex(property);
      return position === undefined
        ? Reflect.has(array, property)
        : position < array.length;
    },
    ownKeys(array) {
      return [
        ...Array.from({ length: array.length }, (_, position) =>
          String(position),
        ),
        'length',
      ];
    },
    set(array, property, value, receiver) {
      return arrayIndex(property) === undefined && property !== 'length'
        ? Reflect.set(array, property, value, receiver)
        : false;
    },
  });
  indexes.set(proxy, index);
  return proxy;
}

export function createSourceLineIndex(
  starts: readonly number[],
): readonly number[] {
  return arrayView(createIndex(initialBlocks(starts)));
}

export function replaceSourceLineIndex(
  current: readonly number[],
  start: number,
  removed: number,
  inserted: readonly number[],
  suffixDelta: number,
): readonly number[] | undefined {
  const index = indexes.get(current);
  if (
    !index ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(removed) ||
    start < 0 ||
    removed < 0 ||
    start + removed > index.length
  ) {
    return undefined;
  }

  if (index.blocks.length === 0) {
    return arrayView(createIndex(packedBlocks(inserted)));
  }

  const end = start + removed;
  const from = blockPosition(index, start);
  const to = blockPosition(index, end);
  const prefix = index.blocks.slice(0, from.block);
  const suffix = index.blocks
    .slice(to.block + 1)
    .map((block) => shiftedBlock(block, suffixDelta));
  const region: number[] = [];
  appendBlockValues(region, index.blocks[from.block]!, 0, from.offset);
  region.push(...inserted);
  appendBlockValues(
    region,
    index.blocks[to.block]!,
    to.offset,
    undefined,
    suffixDelta,
  );

  const suffixNeighbor = suffix[0];
  const prefixNeighbor = prefix.at(-1);
  if (
    suffixNeighbor &&
    region.length + suffixNeighbor.values.length <= BLOCK_MAX
  ) {
    appendBlockValues(region, suffixNeighbor);
    suffix.shift();
  } else if (
    prefixNeighbor &&
    prefixNeighbor.values.length + region.length <= BLOCK_MAX
  ) {
    const leading: number[] = [];
    appendBlockValues(leading, prefixNeighbor);
    region.unshift(...leading);
    prefix.pop();
  } else if (region.length < BLOCK_MIN) {
    if (suffixNeighbor) {
      appendBlockValues(region, suffixNeighbor);
      suffix.shift();
    } else if (prefixNeighbor) {
      const leading: number[] = [];
      appendBlockValues(leading, prefixNeighbor);
      region.unshift(...leading);
      prefix.pop();
    }
  }

  return arrayView(
    createIndex([...prefix, ...packedBlocks(region), ...suffix]),
  );
}

export function sourceLineIndexAtIndexedOffset(
  starts: readonly number[],
  offset: number,
): number | undefined {
  const index = indexes.get(starts);
  return index ? indexAtOffset(index, offset) : undefined;
}
