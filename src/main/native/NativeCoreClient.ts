import { utilityProcess, type UtilityProcess } from 'electron';

import {
  isNativeCoreMessage,
  NATIVE_CORE_PROTOCOL_VERSION,
  type NativeCoreHealth,
} from '../../shared/contracts';

const STARTUP_TIMEOUT_MS = 5_000;

export interface NativeCoreClientOptions {
  entryPath: string;
  onUnexpectedExit(code: number): void;
}

export class NativeCoreClient {
  private child: UtilityProcess | undefined;
  private healthState: NativeCoreHealth | undefined;
  private stopping = false;

  constructor(private readonly options: NativeCoreClientOptions) {}

  get health(): NativeCoreHealth | undefined {
    return this.healthState;
  }

  start(): Promise<NativeCoreHealth> {
    if (this.child) {
      throw new Error('The native core has already been started.');
    }

    this.stopping = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      let expectedExit = false;
      let child: UtilityProcess | undefined;

      const rejectStartup = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        expectedExit = true;
        clearTimeout(timeout);
        child?.kill();
        reject(error);
      };

      const timeout = setTimeout(() => {
        rejectStartup(
          new Error(
            `The native core did not start within ${STARTUP_TIMEOUT_MS} ms.`,
          ),
        );
      }, STARTUP_TIMEOUT_MS);

      try {
        child = utilityProcess.fork(this.options.entryPath, [], {
          serviceName: 'Flyoff Native Core',
          stdio: 'ignore',
        });
        this.child = child;
      } catch (error) {
        clearTimeout(timeout);
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      child.on('message', (message: unknown) => {
        if (!isNativeCoreMessage(message)) {
          rejectStartup(new Error('The native core sent an invalid message.'));
          return;
        }

        if (message.type === 'native-core:error') {
          rejectStartup(
            new Error(`${message.payload.code}: ${message.payload.message}`),
          );
          return;
        }

        if (
          message.payload.protocolVersion !== NATIVE_CORE_PROTOCOL_VERSION
        ) {
          rejectStartup(
            new Error(
              `Native core protocol ${message.payload.protocolVersion} is not supported.`,
            ),
          );
          return;
        }

        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        this.healthState = message.payload;
        resolve(message.payload);
      });

      child.on('error', (type, location) => {
        rejectStartup(
          new Error(`Native utility process ${type} at ${location}.`),
        );
      });

      child.on('exit', (code) => {
        this.child = undefined;
        this.healthState = undefined;

        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          reject(new Error(`The native core exited with code ${code}.`));
          return;
        }

        if (!this.stopping && !expectedExit) {
          this.options.onUnexpectedExit(code);
        }
      });
    });
  }

  stop(): void {
    this.stopping = true;
    this.healthState = undefined;
    this.child?.kill();
    this.child = undefined;
  }
}
