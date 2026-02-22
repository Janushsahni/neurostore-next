import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function boolEnv(value, defaultValue = true) {
  if (value == null) {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function sanitizeTableName(name) {
  const fallback = "control_plane_state";
  if (typeof name !== "string" || name.trim().length === 0) {
    return fallback;
  }
  const trimmed = name.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class FileStateStore {
  constructor(stateFile) {
    this.stateFile = stateFile;
    this.backendName = "file";
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
  }

  load() {
    if (!fs.existsSync(this.stateFile)) {
      return null;
    }
    const raw = fs.readFileSync(this.stateFile, "utf8");
    return safeParseJson(raw);
  }

  save(state) {
    const tmp = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.stateFile);
  }
}

class PostgresRedisStateStore {
  constructor(options) {
    this.databaseUrl = options.databaseUrl;
    this.redisUrl = options.redisUrl;
    this.redisKey = options.redisKey;
    this.pgTable = sanitizeTableName(options.pgTable);
    this.fileStore = new FileStateStore(options.stateFile);
    this.mirrorFile = boolEnv(options.mirrorFile, true);
    this.backendName = this.redisUrl ? "postgres+redis" : "postgres";

    if (!this.databaseUrl) {
      throw new Error("DATABASE_URL is required for STATE_BACKEND=postgres");
    }

    this.ensureTable();
  }

  runPsql(sql) {
    return execFileSync(
      "psql",
      ["-X", "-A", "-t", "-q", this.databaseUrl, "-c", sql],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  }

  ensureTable() {
    const sql = `
CREATE TABLE IF NOT EXISTS ${this.pgTable} (
  id INTEGER PRIMARY KEY,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
    this.runPsql(sql);
  }

  readFromRedis() {
    if (!this.redisUrl) {
      return null;
    }
    try {
      const out = execFileSync(
        "redis-cli",
        ["-u", this.redisUrl, "GET", this.redisKey],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const raw = out.trim();
      return raw.length > 0 ? raw : null;
    } catch {
      return null;
    }
  }

  writeToRedis(serializedState) {
    if (!this.redisUrl) {
      return;
    }
    try {
      execFileSync(
        "redis-cli",
        ["-u", this.redisUrl, "SET", this.redisKey, serializedState],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      // best-effort cache write
    }
  }

  readFromPostgres() {
    const sql = `SELECT encode(convert_to(state_json::text, 'UTF8'), 'base64') FROM ${this.pgTable} WHERE id = 1;`;
    const out = this.runPsql(sql).trim();
    if (!out) {
      return null;
    }
    return Buffer.from(out, "base64").toString("utf8");
  }

  writeToPostgres(serializedState) {
    const payloadB64 = Buffer.from(serializedState, "utf8").toString("base64");
    const sql = `
INSERT INTO ${this.pgTable} (id, state_json, updated_at)
VALUES (
  1,
  convert_from(decode('${payloadB64}', 'base64'), 'UTF8')::jsonb,
  NOW()
)
ON CONFLICT (id)
DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at;
`;
    this.runPsql(sql);
  }

  load() {
    const fromRedis = this.readFromRedis();
    if (fromRedis) {
      const parsed = safeParseJson(fromRedis);
      if (parsed) {
        return parsed;
      }
    }

    try {
      const fromPg = this.readFromPostgres();
      if (fromPg) {
        this.writeToRedis(fromPg);
        const parsed = safeParseJson(fromPg);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // fall through to file fallback
    }

    return this.fileStore.load();
  }

  save(state) {
    const serialized = JSON.stringify(state);

    let pgSaved = false;
    try {
      this.writeToPostgres(serialized);
      pgSaved = true;
    } catch {
      pgSaved = false;
    }

    this.writeToRedis(serialized);

    if (this.mirrorFile || !pgSaved) {
      this.fileStore.save(state);
    }

    if (!pgSaved && !this.mirrorFile) {
      throw new Error("failed to persist state to PostgreSQL");
    }
  }
}

export function createStateStore(options) {
  const backend = (options.backend || "file").trim().toLowerCase();
  const fallbackToFile = boolEnv(options.fallbackToFile, true);

  if (backend === "postgres") {
    try {
      return new PostgresRedisStateStore(options);
    } catch (error) {
      if (!fallbackToFile) {
        throw error;
      }
      const store = new FileStateStore(options.stateFile);
      store.backendName = "file-fallback";
      return store;
    }
  }

  return new FileStateStore(options.stateFile);
}
