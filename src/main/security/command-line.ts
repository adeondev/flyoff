import type { CommandLine } from 'electron';

export const REMOTE_DEBUGGING_SWITCHES = [
  'remote-debugging-address',
  'remote-debugging-pipe',
  'remote-debugging-port',
  'remote-allow-origins',
] as const;

type CommandLineController = Pick<CommandLine, 'hasSwitch' | 'removeSwitch'>;

export function hardenCommandLine(
  commandLine: CommandLineController,
  isPackaged: boolean,
): void {
  if (!isPackaged) {
    return;
  }

  for (const commandLineSwitch of REMOTE_DEBUGGING_SWITCHES) {
    commandLine.removeSwitch(commandLineSwitch);
  }
}

export function hasRemoteDebuggingSwitch(
  commandLine: CommandLineController,
): boolean {
  return REMOTE_DEBUGGING_SWITCHES.some((commandLineSwitch) =>
    commandLine.hasSwitch(commandLineSwitch),
  );
}
