import type { FlyoffApi } from './bootstrap';

declare global {
  interface Window {
    readonly flyoff: FlyoffApi;
  }
}

export {};
