import { EventEmitter } from 'node:events';

import type { UtilityProcess } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativeCoreClient } from '../../src/main/native/NativeCoreClient';

const electronMocks = vi.hoisted(() => ({
  fork: vi.fn(),
}));

vi.mock('electron', () => ({
  utilityProcess: {
    fork: electronMocks.fork,
  },
}));

class FakeUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true);
}

const readyMessage = {
  type: 'native-core:ready',
  payload: {
    coreVersion: '0.1.0',
    protocolVersion: 1,
  },
} as const;

function createClient(child: FakeUtilityProcess) {
  electronMocks.fork.mockReturnValue(child as unknown as UtilityProcess);
  const onUnexpectedExit = vi.fn();
  const client = new NativeCoreClient({
    entryPath: 'utility.js',
    onUnexpectedExit,
  });

  return { client, onUnexpectedExit };
}

beforeEach(() => {
  electronMocks.fork.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NativeCoreClient', () => {
  it('resolves only after a valid protocol handshake', async () => {
    const child = new FakeUtilityProcess();
    const { client } = createClient(child);
    const startup = client.start();

    child.emit('message', readyMessage);

    await expect(startup).resolves.toEqual(readyMessage.payload);
    expect(client.health).toEqual(readyMessage.payload);
    expect(electronMocks.fork).toHaveBeenCalledWith('utility.js', [], {
      serviceName: 'Flyoff Native Core',
      stdio: 'ignore',
    });
  });

  it('rejects invalid messages without reporting the intentional exit', async () => {
    const child = new FakeUtilityProcess();
    const { client, onUnexpectedExit } = createClient(child);
    const startup = client.start();
    const rejection = expect(startup).rejects.toThrow('invalid message');

    child.emit('message', { type: 'not-native-core' });

    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit('exit', 1);
    expect(onUnexpectedExit).not.toHaveBeenCalled();
  });

  it('rejects a core using an incompatible protocol', async () => {
    const child = new FakeUtilityProcess();
    const { client } = createClient(child);
    const startup = client.start();
    const rejection = expect(startup).rejects.toThrow(
      'protocol 2 is not supported',
    );

    child.emit('message', {
      ...readyMessage,
      payload: { ...readyMessage.payload, protocolVersion: 2 },
    });

    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('times out and terminates a core that never answers', async () => {
    vi.useFakeTimers();
    const child = new FakeUtilityProcess();
    const { client, onUnexpectedExit } = createClient(child);
    const startup = client.start();
    const rejection = expect(startup).rejects.toThrow('within 5000 ms');

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit('exit', 1);
    expect(onUnexpectedExit).not.toHaveBeenCalled();
  });

  it('reports an unexpected exit only after a successful startup', async () => {
    const child = new FakeUtilityProcess();
    const { client, onUnexpectedExit } = createClient(child);
    const startup = client.start();

    child.emit('message', readyMessage);
    await startup;
    child.emit('exit', 23);

    expect(onUnexpectedExit).toHaveBeenCalledWith(23);
    expect(client.health).toBeUndefined();
  });

  it('stops cleanly without treating shutdown as a crash', async () => {
    const child = new FakeUtilityProcess();
    const { client, onUnexpectedExit } = createClient(child);
    const startup = client.start();

    child.emit('message', readyMessage);
    await startup;
    client.stop();
    child.emit('exit', 0);

    expect(child.kill).toHaveBeenCalledOnce();
    expect(client.health).toBeUndefined();
    expect(onUnexpectedExit).not.toHaveBeenCalled();
  });
});
