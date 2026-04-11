import * as readline from "node:readline";

import { EngineProcess } from "./engine";
import { errorFromCode, HandshakeError, ProtocolError } from "./errors";

type RpcResult = Record<string, unknown>;

interface PendingRequest {
  resolve: (value: RpcResult) => void;
  reject: (error: Error) => void;
}

export type IsolationLevel =
  | "readUncommitted"
  | "readCommitted"
  | "repeatableRead"
  | "serializable";

export interface TransactionOptions {
  timeout?: number;
  isolationLevel?: IsolationLevel;
}

export interface RawQueryRunner {
  rawQuery(sql: string): Promise<Record<string, unknown>[]>;
  rawStmtQuery(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

export class NautilusTransactionClient implements RawQueryRunner {
  constructor(
    private readonly parent: NautilusRuntimeClient,
    private readonly transactionId: string,
  ) {}

  async rawQuery(sql: string): Promise<Record<string, unknown>[]> {
    const result = await this.parent._rpc("query.rawQuery", {
      protocolVersion: 1,
      sql,
      transactionId: this.transactionId,
    });
    return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  }

  async rawStmtQuery(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    const result = await this.parent._rpc("query.rawStmtQuery", {
      protocolVersion: 1,
      sql,
      params: params ?? [],
      transactionId: this.transactionId,
    });
    return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  }
}

export class NautilusRuntimeClient implements RawQueryRunner {
  private readonly engine: EngineProcess;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly partialData = new Map<number, unknown[]>();
  private rl: readline.Interface | null = null;

  constructor(
    readonly schemaPath: string,
    options?: { migrate?: boolean },
  ) {
    this.engine = new EngineProcess(undefined, options?.migrate ?? false);
  }

  async connect(): Promise<void> {
    if (this.engine.isRunning()) return;

    this.engine.spawn(this.schemaPath);
    this.startReading();
    await this.handshake();

    process.once("exit", () => {
      this.engine.terminate().catch(() => {});
    });
  }

  async disconnect(): Promise<void> {
    this.rl?.close();
    this.rl = null;

    await this.engine.terminate();

    const error = new ProtocolError("Client disconnected");
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
    this.partialData.clear();
  }

  async rawQuery(sql: string): Promise<Record<string, unknown>[]> {
    const result = await this._rpc("query.rawQuery", {
      protocolVersion: 1,
      sql,
    });
    return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  }

  async rawStmtQuery(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    const result = await this._rpc("query.rawStmtQuery", {
      protocolVersion: 1,
      sql,
      params: params ?? [],
    });
    return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
  }

  async $transaction<T>(
    fn: (tx: NautilusTransactionClient) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    const transactionId = await this.startTransaction(
      options?.timeout ?? 5000,
      options?.isolationLevel,
    );

    const tx = new NautilusTransactionClient(this, transactionId);

    try {
      const result = await fn(tx);
      await this.commitTransaction(transactionId);
      return result;
    } catch (error) {
      await this.rollbackTransaction(transactionId);
      throw error;
    }
  }

  async _rpc(method: string, params: Record<string, unknown>): Promise<RpcResult> {
    if (!this.engine.isRunning()) {
      throw new ProtocolError("Engine is not running. Call connect() first.");
    }

    const id = ++this.nextId;
    const payload = JSON.stringify(
      { jsonrpc: "2.0", id, method, params },
      (_key, value) => {
        if (value instanceof Date) return value.toISOString();
        if (value instanceof Buffer) return value.toString("base64");
        return value;
      },
    ) + "\n";

    return await new Promise<RpcResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      this.engine.stdin?.write(payload, (error) => {
        if (!error) return;

        this.pending.delete(id);
        reject(new ProtocolError(`Write failed: ${error.message}`));
      });
    });
  }

  private startReading() {
    const stdout = this.engine.stdout;
    if (!stdout) {
      throw new ProtocolError("Engine stdout is not available.");
    }

    this.rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      let response: Record<string, unknown>;
      try {
        response = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        console.error("[nautilus-js] Failed to parse response:", trimmed);
        return;
      }

      const id = response.id;
      if (typeof id !== "number") return;

      const pending = this.pending.get(id);
      if (!pending) return;

      if (response.partial === true) {
        const result = response.result as Record<string, unknown> | undefined;
        const chunkData = Array.isArray(result?.data) ? result.data : [];
        if (!this.partialData.has(id)) {
          this.partialData.set(id, []);
        }
        this.partialData.get(id)?.push(...chunkData);
        return;
      }

      this.pending.delete(id);

      if (response.error && typeof response.error === "object") {
        this.partialData.delete(id);
        const error = response.error as Record<string, unknown>;
        pending.reject(
          errorFromCode(
            Number(error.code ?? 0),
            String(error.message ?? "Unknown Nautilus error"),
            error.data,
          ),
        );
        return;
      }

      let result = (response.result as RpcResult | undefined) ?? {};

      if (this.partialData.has(id)) {
        const accumulated = this.partialData.get(id) ?? [];
        this.partialData.delete(id);
        const data = Array.isArray(result.data) ? result.data : [];
        result = { ...result, data: [...accumulated, ...data] };
      }

      pending.resolve(result);
    });

    this.rl.on("close", () => {
      const stderr = this.engine.getStderrOutput().trim();
      const message = stderr
        ? `Engine process exited unexpectedly.\nDetails: ${stderr}`
        : "Engine process exited unexpectedly (no output on stderr).";
      const error = new ProtocolError(message);

      for (const { reject } of this.pending.values()) {
        reject(error);
      }

      this.pending.clear();
      this.partialData.clear();
    });
  }

  private async handshake() {
    let response: RpcResult;
    const clientVersion = "0.1.0";

    try {
      response = await this._rpc("engine.handshake", {
        protocolVersion: 1,
        clientName: "nautilus-studio",
        clientVersion,
      });
    } catch (error) {
      await this.disconnect();
      throw new HandshakeError(`Handshake failed: ${String(error)}`);
    }

    const protocolVersion = response.protocolVersion;
    if (protocolVersion !== 1) {
      await this.disconnect();
      throw new HandshakeError(
        `Protocol version mismatch: engine uses ${String(protocolVersion)}, client expects 1`,
      );
    }
  }

  private async startTransaction(timeoutMs: number, isolationLevel?: IsolationLevel) {
    const params: Record<string, unknown> = { protocolVersion: 1, timeoutMs };
    if (isolationLevel) {
      params.isolationLevel = isolationLevel;
    }

    const result = await this._rpc("transaction.start", params);
    return String(result.id);
  }

  private async commitTransaction(transactionId: string) {
    await this._rpc("transaction.commit", {
      protocolVersion: 1,
      id: transactionId,
    });
  }

  private async rollbackTransaction(transactionId: string) {
    try {
      await this._rpc("transaction.rollback", {
        protocolVersion: 1,
        id: transactionId,
      });
    } catch {}
  }
}
