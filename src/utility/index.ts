import { health } from '@flyoff/native-core';

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
