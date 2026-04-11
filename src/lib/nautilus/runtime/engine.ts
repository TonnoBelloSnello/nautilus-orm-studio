import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const BINARY_NAME = process.platform === "win32" ? "nautilus.exe" : "nautilus";

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

    const resolved = this.enginePath ?? this.findEngine(schemaPath);
    const args = ["engine", "serve", "--schema", schemaPath, ...(this.migrate ? ["--migrate"] : [])];

    this.proc = cp.spawn(resolved, args, {
      stdio: ["pipe", "pipe", "pipe"],
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

    const found = this.which(BINARY_NAME);
    if (found) return found;

    throw new Error(
      "nautilus binary not found in PATH.\n"
      + "Install it with: cargo install nautilus-cli\n"
      + "Or add the compiled binary to your PATH before starting Nautilus Studio.",
    );
  }

  private findWorkspaceBinary(schemaPath: string) {
    for (const root of this.searchRoots(schemaPath)) {
      for (const buildDir of ["debug", "release"]) {
        const candidate = path.join(root, "target", buildDir, BINARY_NAME);
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch {}
      }
    }

    return null;
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
}
