import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export function terminateProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      execFileSync(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
      return;
    } catch {
      child.kill();
      return;
    }
  }

  child.kill('SIGKILL');
}
