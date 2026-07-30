#!/usr/bin/env python3
"""Stop running Flyoff processes, clear build output and rebuild the app.

Every step is fault tolerant by default: recoverable failures fall back to an
alternative command and optional steps are skipped instead of aborting the run.
Use --strict to stop at the first failure.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

ROOT = Path(__file__).resolve().parent.parent
IS_WINDOWS = os.name == "nt"

NATIVE_WORKSPACE = "@flyoff/native-core"
NATIVE_DIR = ROOT / "packages" / "native-core"
NATIVE_ARTIFACT = NATIVE_DIR / "flyoff_native_core.node"
NATIVE_SOURCES = (
    NATIVE_DIR / "src",
    NATIVE_DIR / "Cargo.toml",
    NATIVE_DIR / "Cargo.lock",
    NATIVE_DIR / "build.rs",
    NATIVE_DIR / "package.json",
    ROOT / "rust-toolchain.toml",
)

WEBPACK_DIR = ROOT / ".webpack"
OUT_DIR = ROOT / "out"
# Only forge artifacts are cleared; unrelated files dropped in out/ are kept.
OUT_ARTIFACT_GLOBS = ("Flyoff-*", "make")
NODE_MODULES = ROOT / "node_modules"
INSTALL_MARKER = NODE_MODULES / ".package-lock.json"
TRASH_PREFIX = ".rebuild-trash-"

# Process names always terminated, plus anything running from inside the repo.
APP_PROCESS_NAMES = ("Flyoff.exe", "electron.exe", "Flyoff", "electron")
TOOL_PROCESS_NAMES = ("node.exe", "MSBuild.exe", "node", "esbuild")

RMTREE_ATTEMPTS = 6
RMTREE_DELAY = 0.5
KILL_SETTLE_DELAY = 0.8

COLORS = {
    "info": "\033[36m",
    "ok": "\033[32m",
    "warn": "\033[33m",
    "fail": "\033[31m",
    "step": "\033[35m",
}
RESET = "\033[0m"
USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def log(level: str, message: str) -> None:
    tags = {"info": "·", "ok": "✓", "warn": "!", "fail": "✗", "step": "▶"}
    fallback_tags = {"info": ".", "ok": "OK", "warn": "!", "fail": "X", "step": ">"}
    tag = tags[level]
    try:
        tag.encode(sys.stdout.encoding or "utf-8")
    except UnicodeEncodeError:
        tag = fallback_tags[level]
    if USE_COLOR:
        print(f"{COLORS[level]}{tag}{RESET} {message}", flush=True)
    else:
        print(f"{tag} {message}", flush=True)


# --------------------------------------------------------------------------- #
# Command execution
# --------------------------------------------------------------------------- #


def resolve_executable(name: str) -> str | None:
    return shutil.which(name)


def wrap_command(command: Sequence[str]) -> list[str]:
    """Windows cannot spawn .cmd/.bat shims directly; route them through cmd."""
    parts = list(command)
    head = resolve_executable(parts[0]) or parts[0]
    if IS_WINDOWS and head.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/d", "/c", head, *parts[1:]]
    return [head, *parts[1:]]


def run(command: Sequence[str], cwd: Path = ROOT, env: dict[str, str] | None = None) -> int:
    printable = " ".join(command)
    log("info", f"$ {printable}")
    try:
        completed = subprocess.run(wrap_command(command), cwd=str(cwd), env=env)
    except FileNotFoundError:
        log("fail", f"command not found: {command[0]}")
        return 127
    return completed.returncode


def run_first_success(candidates: Sequence[Sequence[str]], cwd: Path = ROOT) -> bool:
    """Try each command in order until one succeeds."""
    for index, command in enumerate(candidates):
        if index:
            log("warn", "previous command failed, trying fallback")
        if run(command, cwd=cwd) == 0:
            return True
    return False


def npm(*args: str) -> list[str]:
    return ["npm", *args]


def npx(*args: str) -> list[str]:
    return ["npx", "--yes", *args]


# --------------------------------------------------------------------------- #
# Process termination
# --------------------------------------------------------------------------- #

POWERSHELL_QUERY = r"""
$root = '{root}'
$appNames = @({app_names})
$toolNames = @({tool_names})
$self = @({protected})
Get-CimInstance Win32_Process | Where-Object {{
  $_.ProcessId -notin $self -and (
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or
    ($_.Name -in $appNames) -or
    ($_.Name -in $toolNames -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($root.ToLower()))
  )
}} | ForEach-Object {{ "$($_.ProcessId)`t$($_.Name)" }}
"""


def _ps_list(values: Sequence[str]) -> str:
    return ",".join("'" + value.replace("'", "''") + "'" for value in values)


def find_windows_targets() -> list[tuple[int, str]]:
    protected = {os.getpid(), os.getppid()}
    script = POWERSHELL_QUERY.format(
        root=str(ROOT).replace("'", "''"),
        app_names=_ps_list(APP_PROCESS_NAMES),
        tool_names=_ps_list(TOOL_PROCESS_NAMES),
        protected=",".join(str(pid) for pid in protected),
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return []

    targets: list[tuple[int, str]] = []
    for line in result.stdout.splitlines():
        raw_pid, _, name = line.strip().partition("\t")
        if raw_pid.isdigit() and int(raw_pid) not in protected:
            targets.append((int(raw_pid), name or "?"))
    return targets


def find_posix_targets() -> list[tuple[int, str]]:
    protected = {os.getpid(), os.getppid()}
    targets: list[tuple[int, str]] = []
    try:
        result = subprocess.run(["ps", "-eo", "pid=,comm=,args="], capture_output=True, text=True)
    except FileNotFoundError:
        return []

    root = str(ROOT)
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        pid, comm = int(parts[0]), parts[1]
        args = parts[2] if len(parts) > 2 else ""
        if pid in protected:
            continue
        basename = Path(comm).name
        if root in args and (basename in APP_PROCESS_NAMES or basename in TOOL_PROCESS_NAMES):
            targets.append((pid, basename))
        elif basename in APP_PROCESS_NAMES and "electron" not in basename:
            targets.append((pid, basename))
    return targets


def terminate_processes() -> bool:
    targets = find_windows_targets() if IS_WINDOWS else find_posix_targets()
    if not targets:
        log("ok", "no Flyoff process running")
        return True

    for pid, name in targets:
        log("info", f"terminating {name} (pid {pid})")
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                text=True,
            )
        else:
            try:
                os.kill(pid, 15)
            except (ProcessLookupError, PermissionError):
                continue

    time.sleep(KILL_SETTLE_DELAY)
    if not IS_WINDOWS:
        for pid, _ in targets:
            try:
                os.kill(pid, 9)
            except (ProcessLookupError, PermissionError):
                pass

    log("ok", f"{len(targets)} process(es) terminated")
    return True


# --------------------------------------------------------------------------- #
# Filesystem cleanup
# --------------------------------------------------------------------------- #


def _force_writable(func, path, _exc_info) -> None:
    try:
        os.chmod(path, 0o700)
        func(path)
    except OSError:
        pass


def purge_trash() -> None:
    for entry in ROOT.glob(f"{TRASH_PREFIX}*"):
        shutil.rmtree(entry, onexc=_force_writable, ignore_errors=True)


def remove_tree(path: Path) -> bool:
    """Delete a directory, retrying locked handles and quarantining as a last resort."""
    if not path.exists():
        return True

    for attempt in range(1, RMTREE_ATTEMPTS + 1):
        try:
            shutil.rmtree(path, onexc=_force_writable)
            return True
        except FileNotFoundError:
            return True
        except OSError as error:
            if attempt == RMTREE_ATTEMPTS:
                log("warn", f"{path.name}: locked ({error.strerror or error}), quarantining")
                break
            time.sleep(RMTREE_DELAY * attempt)

    quarantine = ROOT / f"{TRASH_PREFIX}{path.name}-{int(time.time())}"
    try:
        path.rename(quarantine)
    except OSError as error:
        log("fail", f"{path.name}: cannot remove or rename ({error.strerror or error})")
        return False

    shutil.rmtree(quarantine, onexc=_force_writable, ignore_errors=True)
    if quarantine.exists():
        log("warn", f"{path.name}: leftover in {quarantine.name}, delete it later")
    return True


def backup_native_artifact() -> Path | None:
    if not NATIVE_ARTIFACT.is_file():
        return None
    backup = NATIVE_DIR / f"{NATIVE_ARTIFACT.name}.backup"
    try:
        shutil.copy2(NATIVE_ARTIFACT, backup)
        return backup
    except OSError:
        return None


def restore_native_artifact(backup: Path | None) -> bool:
    if backup is None or not backup.is_file():
        return False
    try:
        NATIVE_ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup, NATIVE_ARTIFACT)
        return True
    except OSError:
        return False


# --------------------------------------------------------------------------- #
# Freshness checks
# --------------------------------------------------------------------------- #


def newest_mtime(paths: Sequence[Path]) -> float:
    newest = 0.0
    for path in paths:
        if path.is_file():
            newest = max(newest, path.stat().st_mtime)
        elif path.is_dir():
            for child in path.rglob("*"):
                if child.is_file():
                    newest = max(newest, child.stat().st_mtime)
    return newest


def needs_install() -> bool:
    if not NODE_MODULES.is_dir() or not INSTALL_MARKER.is_file():
        return True
    lockfile = ROOT / "package-lock.json"
    return lockfile.is_file() and lockfile.stat().st_mtime > INSTALL_MARKER.stat().st_mtime + 1


def node_query(expression: str) -> str | None:
    node = resolve_executable("node")
    if node is None:
        return None
    result = subprocess.run([node, "-p", expression], capture_output=True, text=True)
    return result.stdout.strip() or None


def needs_native_build(_for_node_abi: bool = False) -> bool:
    if not NATIVE_ARTIFACT.is_file():
        return True
    return newest_mtime(NATIVE_SOURCES) > NATIVE_ARTIFACT.stat().st_mtime


def check_node_version() -> None:
    version = node_query("process.versions.node")
    if version is None:
        log("warn", "node not found in PATH")
        return
    if version.split(".")[0] != "24":
        log("warn", f"node {version} detected; package.json requires >=24.18.0 <25")


# --------------------------------------------------------------------------- #
# Steps
# --------------------------------------------------------------------------- #


@dataclass
class Step:
    name: str
    action: Callable[[], bool]
    required: bool = True
    status: str = field(default="pending", init=False)


def step_kill() -> bool:
    return terminate_processes()


def step_clean(deep: bool) -> bool:
    purge_trash()
    targets = [WEBPACK_DIR]
    for pattern in OUT_ARTIFACT_GLOBS:
        targets += [entry for entry in OUT_DIR.glob(pattern) if entry.is_dir()]
    if deep:
        targets += [NATIVE_DIR / "target", NODE_MODULES]
        NATIVE_ARTIFACT.unlink(missing_ok=True)
    return all(remove_tree(target) for target in targets)


def step_install(deep: bool, force: bool) -> bool:
    if not (deep or force or needs_install()):
        log("ok", "dependencies up to date")
        return True
    candidates: list[Sequence[str]] = []
    if deep:
        candidates.append(npm("ci", "--no-audit", "--no-fund"))
    candidates.append(npm("install", "--no-audit", "--no-fund"))
    candidates.append(npm("install", "--no-audit", "--no-fund", "--legacy-peer-deps"))
    return run_first_success(candidates)


def step_native(force: bool, for_node_abi: bool) -> bool:
    if not (force or needs_native_build(for_node_abi)):
        log("ok", "native-core up to date")
        return True

    backup = backup_native_artifact()
    ok = run(npm("run", "build", f"--workspace={NATIVE_WORKSPACE}")) == 0

    if not ok and restore_native_artifact(backup):
        log("warn", "native-core build failed; restored the previous binary")
        ok = True

    if backup and backup.is_file():
        backup.unlink(missing_ok=True)
    return ok


def step_verify() -> bool:
    results = [
        run(npm("run", "typecheck")) == 0,
        run(npm("run", "lint")) == 0,
        run(npm("run", "test")) == 0,
        run(npm("run", "test:native")) == 0,
    ]
    return all(results)


def step_package() -> bool:
    return run_first_success([npm("run", "package"), npx("electron-forge", "package")])


def step_make() -> bool:
    return run_first_success(
        [
            npm("run", "make"),
            npx("electron-forge", "make", "--targets", "@electron-forge/maker-zip"),
            npm("run", "package"),
        ]
    )


def step_start() -> bool:
    return run(npm("start")) == 0


def build_steps(args: argparse.Namespace) -> list[Step]:
    steps: list[Step] = []
    if not args.keep_processes:
        steps.append(Step("kill", step_kill, required=False))
    if not args.skip_clean:
        steps.append(Step("clean", lambda: step_clean(args.deep)))
    if not args.skip_install:
        steps.append(Step("install", lambda: step_install(args.deep, args.force_install)))
    if not args.skip_native:
        steps.append(Step("native-core", lambda: step_native(args.deep, args.verify)))
    if args.verify:
        steps.append(Step("verify", step_verify, required=False))
    if args.make:
        steps.append(Step("make", step_make))
    elif not args.no_package:
        steps.append(Step("package", step_package))
    if args.start:
        steps.append(Step("start", step_start, required=False))
    return steps


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="rebuild.py",
        description="Kill Flyoff processes, clean build output and rebuild the app.",
    )
    parser.add_argument("--deep", action="store_true", help="wipe node_modules and native build, reinstall from the lockfile")
    parser.add_argument("--make", action="store_true", help="produce distributables instead of only packaging")
    parser.add_argument("--start", action="store_true", help="run npm start when the build finishes")
    parser.add_argument("--verify", action="store_true", help="run typecheck, lint and tests before packaging")
    parser.add_argument("--strict", action="store_true", help="abort at the first failing step")
    parser.add_argument("--keep-processes", action="store_true", help="do not terminate running processes")
    parser.add_argument("--skip-clean", action="store_true")
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--skip-native", action="store_true")
    parser.add_argument("--force-install", action="store_true", help="reinstall dependencies even when they look current")
    parser.add_argument("--no-package", action="store_true", help="stop after the native build")
    return parser.parse_args(argv)


def print_summary(steps: Sequence[Step], elapsed: float) -> None:
    print()
    log("step", f"summary ({elapsed:.1f}s)")
    width = max((len(step.name) for step in steps), default=0)
    for step in steps:
        level = {"ok": "ok", "failed": "fail", "skipped": "warn", "pending": "warn"}[step.status]
        log(level, f"{step.name.ljust(width)}  {step.status}")


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    check_node_version()

    steps = build_steps(args)
    started = time.monotonic()
    aborted = False

    for step in steps:
        print()
        log("step", step.name)
        try:
            succeeded = step.action()
        except KeyboardInterrupt:
            step.status = "failed"
            log("fail", "interrupted")
            aborted = True
            break
        except Exception as error:  # keep the run alive on unexpected tooling errors
            succeeded = False
            log("fail", f"{step.name}: {error}")

        if succeeded:
            step.status = "ok"
            continue

        step.status = "failed"
        if args.strict or step.required:
            log("fail", f"{step.name} failed")
            aborted = True
            break
        log("warn", f"{step.name} failed, continuing")

    for step in steps:
        if step.status == "pending":
            step.status = "skipped"

    print_summary(steps, time.monotonic() - started)

    if aborted:
        return 1
    if any(step.status == "failed" for step in steps):
        log("warn", "build finished with tolerated failures")
        return 0
    log("ok", "build finished")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
