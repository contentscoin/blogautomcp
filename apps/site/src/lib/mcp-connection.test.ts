import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpUrl, splitMcpCredential } from "./mcp-connection";

process.env.SITE_URL = "https://mcp.example.test";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";

const endpointId = "A".repeat(20);
const secret = "b".repeat(43);

test("MCP URL parser accepts only the configured HTTPS origin and exact credential sizes", () => {
  const parsed = parseMcpUrl(`https://mcp.example.test/api/mcp/${endpointId}.${secret}?ignored=1#fragment`);
  assert.deepEqual(parsed, {
    endpointId,
    secret,
    resource: `https://mcp.example.test/api/mcp/${endpointId}.${secret}`,
  });
  assert.equal(parseMcpUrl(`https://evil.example/api/mcp/${endpointId}.${secret}`), null);
  assert.equal(parseMcpUrl(`https://mcp.example.test/api/mcp/short.${secret}`), null);
});

test("MCP credential splitter rejects malformed and oversized values", () => {
  assert.deepEqual(splitMcpCredential(`${endpointId}.${secret}`), { endpointId, secret });
  assert.equal(splitMcpCredential(`${endpointId}.${secret}extra`), null);
  assert.equal(splitMcpCredential(`${endpointId}.${"!".repeat(43)}`), null);
});
