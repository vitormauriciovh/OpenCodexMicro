import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const auth = mkdtempSync(join(tmpdir(), "ulanzi-test-auth-"));
process.env.ULANZI_AUTH_DIR = auth;
process.on("exit", () => rmSync(auth, { recursive: true, force: true }));
