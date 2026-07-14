export interface CoreHealth {
  readonly coreVersion: '0.1.0';
  readonly protocolVersion: 1;
}

export function health(): CoreHealth;
