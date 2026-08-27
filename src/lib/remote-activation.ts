import { readLocalEnvFile, updateLocalEnvFile } from "../../scripts/lib/local-env-file";

export interface RemoteActivation {
  siteUrl: string;
  deviceId: string;
  deviceToken: string;
}

export function readRemoteActivation(): RemoteActivation {
  const file = readLocalEnvFile();
  return {
    siteUrl: process.env.REMOTE_SITE_URL || file.REMOTE_SITE_URL || "",
    deviceId: process.env.REMOTE_DEVICE_ID || file.REMOTE_DEVICE_ID || "",
    deviceToken: process.env.REMOTE_DEVICE_TOKEN || file.REMOTE_DEVICE_TOKEN || "",
  };
}

export function hasRemoteActivation(): boolean {
  const activation = readRemoteActivation();
  return Boolean(activation.siteUrl && activation.deviceId && activation.deviceToken);
}

export function saveRemoteActivation(activation: RemoteActivation): void {
  updateLocalEnvFile({
    REMOTE_SITE_URL: activation.siteUrl,
    REMOTE_MCP_URL: null,
    REMOTE_DEVICE_ID: activation.deviceId,
    REMOTE_DEVICE_TOKEN: activation.deviceToken,
  });
  process.env.REMOTE_SITE_URL = activation.siteUrl;
  process.env.REMOTE_DEVICE_ID = activation.deviceId;
  process.env.REMOTE_DEVICE_TOKEN = activation.deviceToken;
  delete process.env.REMOTE_MCP_URL;
}

export function clearRemoteActivation(): void {
  updateLocalEnvFile({
    REMOTE_SITE_URL: null,
    REMOTE_MCP_URL: null,
    REMOTE_DEVICE_ID: null,
    REMOTE_DEVICE_TOKEN: null,
  });
  delete process.env.REMOTE_SITE_URL;
  delete process.env.REMOTE_MCP_URL;
  delete process.env.REMOTE_DEVICE_ID;
  delete process.env.REMOTE_DEVICE_TOKEN;
}
