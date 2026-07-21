import type * as NativeCore from '@flyoff/native-core';

import {
  isNativeCoreHealth,
  NATIVE_CORE_PROTOCOL_VERSION,
  type NativeCoreErrorMessage,
  type NativeCoreReadyMessage,
} from '../shared/contracts';

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error('The native core must run inside an Electron utility process.');
}

function postError(
  code: NativeCoreErrorMessage['payload']['code'],
  error: unknown,
) {
  const message: NativeCoreErrorMessage = {
    type: 'native-core:error',
    payload: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };

  parentPort.postMessage(message);
}

try {
  // Load the native addon lazily, inside this try, so a failure to load the
  // compiled binary (wrong platform, ABI mismatch, missing file) surfaces as a
  // clean LOAD_FAILED message. A static `import` is hoisted above the guard, so
  // a load failure would instead crash the utility process with a raw stack.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { health } = require('@flyoff/native-core') as typeof NativeCore;

  const nativeHealth: unknown = health();

  if (!isNativeCoreHealth(nativeHealth)) {
    postError(
      'INVALID_HEALTH_RESPONSE',
      new Error('The native core returned an invalid health response.'),
    );
  } else if (
    nativeHealth.protocolVersion !== NATIVE_CORE_PROTOCOL_VERSION
  ) {
    postError(
      'PROTOCOL_MISMATCH',
      new Error(
        `Expected native protocol ${NATIVE_CORE_PROTOCOL_VERSION}, received ${nativeHealth.protocolVersion}.`,
      ),
    );
  } else {
    const message: NativeCoreReadyMessage = {
      type: 'native-core:ready',
      payload: nativeHealth,
    };

    parentPort.postMessage(message);
  }
} catch (error) {
  postError('LOAD_FAILED', error);
}
