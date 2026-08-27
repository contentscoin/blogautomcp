import fs from "node:fs";
import path from "node:path";
import { getEnvFilePath } from "./app-paths";

function parseEnv(content: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}

function serializeEnv(values: Record<string, string>): string {
  return `${Object.entries(values).map(([key, value]) => `${key}="${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join("\n")}\n`;
}

export function readLocalEnvFile(): Record<string, string> {
  const filePath = getEnvFilePath();
  if (!fs.existsSync(filePath)) return {};
  return parseEnv(fs.readFileSync(filePath, "utf8"));
}

export function updateLocalEnvFile(updates: Record<string, string | null>): string {
  const filePath = getEnvFilePath();
  const values = readLocalEnvFile();
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") {
      delete values[key];
      delete process.env[key];
    } else {
      values[key] = value;
      process.env[key] = value;
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeEnv(values), { encoding: "utf8", mode: 0o600 });
  return filePath;
}
