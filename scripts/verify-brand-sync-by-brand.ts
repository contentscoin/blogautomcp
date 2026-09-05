import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function source(...parts: string[]): string {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

const mcpRoute = source("apps", "sites", "app", "api", "mcp", "[credential]", "route.ts");
const legacyMcpRoute = source("apps", "site", "src", "app", "api", "mcp", "[credential]", "route.ts");
const pollRoute = source("src", "app", "api", "remote-agent", "poll", "route.ts");
const bulkRoute = source("src", "app", "api", "brandlinks", "bulk-seasonal", "route.ts");
const registerScript = source("scripts", "brandconnect-seasonal-register.ts");

assert.match(mcpRoute, /name:\s*'brandconnect_sync_products'[\s\S]*brandKeyword/);
assert.match(mcpRoute, /additionalProperties:\s*false/);
assert.match(legacyMcpRoute, /name:\s*"brandconnect_sync_products"[\s\S]*brandKeyword/);

assert.match(pollRoute, /const brandKeyword = readString\(input, "brandKeyword"\)\.slice\(0,\s*80\)/);
assert.match(pollRoute, /\.\.\.\(brandKeyword \? \{ brandKeyword \} : \{\}\)/);

assert.match(bulkRoute, /brandKeyword\?: string/);
assert.match(bulkRoute, /const brandKeyword = normalizeCsvFilter\(body\.brandKeyword\)/);
assert.match(bulkRoute, /`--brand-filter=\$\{brandKeyword\}`/);

assert.match(registerScript, /brandFilter: string\[\]/);
assert.match(registerScript, /BRANDCONNECT_BRAND_FILTER/);
assert.match(registerScript, /--brand-filter=/);
assert.match(registerScript, /function shouldIncludeProductByBrand/);
assert.match(registerScript, /shouldIncludeProductByBrand\(product, options\.brandFilter\)/);
assert.match(registerScript, /matchesAnyTerm\(`\$\{item\.name\} \$\{item\.storeName \|\| ""\}`, options\.brandFilter\)/);

console.log("✅ brandKeyword MCP sync contract is wired through site MCP, desktop agent, local API, and shopping/travel collectors.");
