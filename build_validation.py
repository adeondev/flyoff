#!/usr/bin/env python3
"""
build_validation.py — Flyoff: verify + package a fresh build for manual QA.

Just double-click this file (or run `python build_validation.py`). It will:
  1. Close any running Flyoff instance (dev or packaged) so its files aren't
     locked during the build. Only Flyoff's own processes are touched —
     matched by executable path, never by generic process name, so other
     Electron apps (Discord, VS Code, Obsidian, ...) are left alone.
  2. Run the full verification suite (`npm run verify`: lint, typecheck,
     unit tests, native-core tests). Stops here on any failure — no build
     is produced from code that doesn't pass.
  3. Package a fresh win32/x64 build (`electron-forge package`).
  4. Move it into out/validation/Flyoff-win32-x64/, replacing whatever was
     there before.

Windows-only process cleanup; the verify/build steps are cross-platform.
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_DEFAULT = ROOT / "out" / "Flyoff-win32-x64"
VALIDATION_DIR = ROOT / "out" / "validation"
VALIDATION_TARGET = VALIDATION_DIR / "Flyoff-win32-x64"
IS_WINDOWS = sys.platform == "win32"


def banner(title: str) -> None:
    print()
    print(f"===== {title} =====", flush=True)


def run(cmd: list[str]) -> None:
    """Run a command with output streamed live; exit the script on failure."""
    print(f"$ {' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=ROOT, shell=IS_WINDOWS)
    if result.returncode != 0:
        print(f"\nFAILED (exit {result.returncode}): {' '.join(cmd)}")
        sys.exit(result.returncode)


def close_running_instances() -> None:
    banner("Closing running Flyoff instances")
    if not IS_WINDOWS:
        print("Not on Windows — skipping process cleanup.")
        return

    # Only these exact executables count as "Flyoff". Matched by full path,
    # never by process name, so other Electron apps are never touched.
    targets = [
        ROOT / "node_modules" / "electron" / "dist" / "electron.exe",
        VALIDATION_TARGET / "Flyoff.exe",
        OUT_DEFAULT / "Flyoff.exe",
    ]
    targets_literal = ", ".join(f'"{t}"' for t in targets)
    ps_script = f"""
$targets = @({targets_literal})
$procs = Get-CimInstance Win32_Process | Where-Object {{
    $_.ExecutablePath -and ($targets -contains $_.ExecutablePath)
}}
if ($procs) {{
    foreach ($p in $procs) {{
        Write-Host "Stopping PID $($p.ProcessId): $($p.ExecutablePath)"
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }}
}} else {{
    Write-Host "No matching Flyoff processes running."
}}
"""
    subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], cwd=ROOT)


def run_verifications() -> None:
    banner("Verifications (lint, typecheck, unit tests, native tests)")
    run(["npm", "run", "verify"])


def build_package() -> None:
    banner("Packaging win32/x64 build")
    if OUT_DEFAULT.exists():
        shutil.rmtree(OUT_DEFAULT)
    run(["npx", "electron-forge", "package", "--platform=win32", "--arch=x64"])
    if not OUT_DEFAULT.exists():
        print(f"Expected build output not found at {OUT_DEFAULT}")
        sys.exit(1)


def publish_to_validation() -> None:
    banner("Publishing to out/validation")
    VALIDATION_DIR.mkdir(parents=True, exist_ok=True)
    if VALIDATION_TARGET.exists():
        shutil.rmtree(VALIDATION_TARGET)
    shutil.move(str(OUT_DEFAULT), str(VALIDATION_TARGET))
    print(f"Build ready at: {VALIDATION_TARGET / 'Flyoff.exe'}")


def main() -> None:
    close_running_instances()
    run_verifications()
    build_package()
    publish_to_validation()
    banner("Done")
    print("Run the app from:")
    print(f"  {VALIDATION_TARGET / 'Flyoff.exe'}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    finally:
        if IS_WINDOWS:
            input("\nPress Enter to close...")
