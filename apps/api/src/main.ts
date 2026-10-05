import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./bootstrap.js";
import { loadEnv } from "./config/env.js";

// Dev: nạp .env ở gốc repo nếu có. Production nhận env từ docker compose, không đọc file.
const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (process.env.NODE_ENV !== "production" && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const env = loadEnv();
const app = await createApp(env);
await app.listen(env.PORT, "0.0.0.0");
