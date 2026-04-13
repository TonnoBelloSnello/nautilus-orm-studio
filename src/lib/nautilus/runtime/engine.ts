import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const BINARY_NAME = process.platform === "win32" ? "nautilus.exe" : "nautilus";
const NODE_BINARY_NAME = process.platform === "win32" ? "npx.cmd" : "npx";
const PYTHON_BINARY_NAME = process.platform === "win32" ? "python.exe" : "python";

interface EngineCommand {
  executable: string;
  prefixArgs: string[];
  legacyBinary?: boolean;
  viaCmdShell?: boolean;
}

export class EngineProcess {
  private proc: cp.ChildProcessWithoutNullStreams | null = null;
  private readonly stderrChunks: Buffer[] = [];

  constructor(
    private readonly enginePath?: string,
    private readonly migrate = false,
  ) {}

  spawn(schemaPath: string) {
    if (this.proc) {
      throw new Error("Engine process is already running");
    }

    this.stderrChunks.length = 0;
    this.loadDotenv(schemaPath);

    const command = this.enginePath
      ? this.commandFromExecutable(this.enginePath)
      : this.findEngine(schemaPath);
        
    const args = [
      ...command.prefixArgs,
      ...(command.legacyBinary ? [] : ["engine", "serve"]),
      "--schema",
      schemaPath,
      ...(this.migrate ? ["--migrate"] : []),
    ];

    const invocation = this.resolveInvocation(command, args);    
    this.proc = cp.spawn(invocation.executable, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });

    this.proc.stderr.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk);
    });
  }

  get stdin() {
    return this.proc?.stdin ?? null;
  }

  get stdout() {
    return this.proc?.stdout ?? null;
  }

  isRunning() {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  getStderrOutput() {
    return Buffer.concat(this.stderrChunks).toString("utf8");
  }

  async terminate() {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;

    await new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.killed) {
        resolve();
        return;
      }

      const cleanup = () => {
        clearTimeout(timer);
        resolve();
      };

      proc.once("exit", cleanup);
      proc.once("error", cleanup);

      try {
        proc.stdin.end();
      } catch {}

      const timer = setTimeout(() => {
        try {
          proc.kill("SIGTERM");
        } catch {}

        const forceTimer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, 5000);

        proc.once("exit", () => clearTimeout(forceTimer));
      }, 100);
    });
  }

  private loadDotenv(schemaPath: string) {
    const dirs: string[] = [];
    const seen = new Set<string>();

    let dir = path.resolve(path.dirname(schemaPath));
    while (true) {
      if (!seen.has(dir)) {
        dirs.push(dir);
        seen.add(dir);
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    const cwd = process.cwd();
    if (!seen.has(cwd)) {
      dirs.push(cwd);
    }

    for (const candidateDir of dirs) {
      const envPath = path.join(candidateDir, ".env");
      if (!fs.existsSync(envPath)) continue;

      let content: string;
      try {
        content = fs.readFileSync(envPath, "utf8");
      } catch {
        continue;
      }

      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 1) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();

        if (
          value.length >= 2
          && ((value[0] === '"' && value[value.length - 1] === '"')
            || (value[0] === "'" && value[value.length - 1] === "'"))
        ) {
          value = value.slice(1, -1);
        }

        if (key && !(key in process.env)) {
          process.env[key] = value;
        }
      }

      break;
    }
  }

  private findEngine(schemaPath: string) {
    const local = this.findWorkspaceBinary(schemaPath);
    if (local) return local;

    const javascript = this.findJavascriptEngine();
    if (javascript) return javascript;

    const python = this.findPythonEngine();
    if (python) return python;

    const found = this.which(BINARY_NAME);
    if (found) return this.commandFromExecutable(found);

    throw new Error(
      "nautilus engine not found.\n"
      + "Checked for a native binary, nautilus, npx --no-install nautilus, or python -m nautilus\n"
      + "Install one of them or add the compiled binary to your PATH before starting Nautilus Studio.",
    );
  }

  private findWorkspaceBinary(schemaPath: string) {
    for (const root of this.searchRoots(schemaPath)) {
      for (const buildDir of ["debug", "release"]) {
        const candidate = path.join(root, "target", buildDir, BINARY_NAME);
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return this.commandFromExecutable(candidate);
        } catch {}
      }
    }

    return null;
  }

  private findJavascriptEngine(): EngineCommand | null {
    const npx = this.which(NODE_BINARY_NAME) ?? NODE_BINARY_NAME;
    const command = this.commandFromExecutable(npx);
    return this.canRun(command, ["--no-install", "nautilus", "engine", "serve", "--help"])
      ? { ...command, prefixArgs: ["--no-install", "nautilus"] }
      : null;
  }

  private findPythonEngine(): EngineCommand | null {
    const python = this.which(PYTHON_BINARY_NAME) ?? PYTHON_BINARY_NAME;
    
    try {
      const script = "import importlib.resources, sys; print(str(importlib.resources.files('nautilus') / ('nautilus.exe' if sys.platform == 'win32' else 'nautilus')))";
      const result = cp.spawnSync(python, ["-c", script], { encoding: "utf8", timeout: 2000, windowsHide: true });
      if (result.status === 0 && result.stdout) {
        const binPath = result.stdout.trim().split(/\r?\n/)[0];
        if (binPath && fs.existsSync(binPath!)) {
          return this.commandFromExecutable(binPath!);
        }
      }
    } catch {}

    const command = this.commandFromExecutable(python);
    return this.canRun(command, ["-m", "nautilus", "engine", "serve", "--help"])
      ? { ...command, prefixArgs: ["-m", "nautilus"] }
      : null;
  }

  private commandFromExecutable(executable: string): EngineCommand {
    const basename = path.basename(executable).toLowerCase();
    return {
      executable,
      prefixArgs: [],
      legacyBinary: basename.startsWith("nautilus-engine"),
      viaCmdShell: process.platform === "win32" && (basename.endsWith(".cmd") || basename.endsWith(".bat")),
    };
  }

  private searchRoots(schemaPath: string) {
    const roots: string[] = [];
    const seen = new Set<string>();

    let dir = path.resolve(path.dirname(schemaPath));
    while (true) {
      if (!seen.has(dir)) {
        roots.push(dir);
        seen.add(dir);
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    const cwd = process.cwd();
    if (!seen.has(cwd)) {
      roots.push(cwd);
    }

    return roots;
  }

  private which(name: string) {
    if (process.platform === "win32") {
      try {
        const result = cp.spawnSync("where.exe", [name], { encoding: "utf8" });
        if (result.status === 0 && result.stdout) {
          const first = result.stdout.trim().split(/\r?\n/)[0];
          if (first) return first;
        }
      } catch {}
    }

    const envPath = process.env.PATH ?? "";
    const sep = process.platform === "win32" ? ";" : ":";

    for (const dir of envPath.split(sep)) {
      if (!dir) continue;
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }

    return null;
  }

  private canRun(command: EngineCommand, args: string[]) {
    try {
      const invocation = this.resolveInvocation(command, args);
      const result = cp.spawnSync(invocation.executable, invocation.args, {
        stdio: "ignore",
        timeout: 5000,
        windowsHide: true,
        env: process.env,
      });
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  }

  private resolveInvocation(command: EngineCommand, args: string[]) {
    if (process.platform === "win32" && command.viaCmdShell) {
      return {
        executable: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/c", command.executable, ...args],
      };
    }

    return {
      executable: command.executable,
      args,
    };
  }
}
