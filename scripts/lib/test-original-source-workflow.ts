/** Offline-only VM adapters. No provider/HMAC writer or real source admission.
 * Production always imports its native reader; only isolated tests substitute
 * a deny/admission result to exercise the persisted once-only state machine. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type * as Recovery from "./material-image-recovery";
import type * as Workflow from "./scheduled-draft-workflow";
import type { SellerOriginalRecoveryScope } from "./seller-original-recovery-scope";
import { sellerOriginalRecoveryBudgetBinding } from "./seller-original-recovery-scope";

function load<T>(file: string, override: (name: string) => unknown): T {
  const absolute = path.resolve(file), require = createRequire(absolute), loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(absolute, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, process, Buffer, console,
    setTimeout, clearTimeout, setInterval, clearInterval, URL,
    require: (name: string) => override(name) ?? require(name) }, { filename: absolute });
  return loaded.exports as T;
}

export function isolatedOriginalRecovery(scope: (id: string, sectionId: string) => SellerOriginalRecoveryScope | null): typeof Recovery {
  return load("scripts/lib/material-image-recovery.ts", name => name === "./seller-original-recovery-scope"
    ? { readSellerOriginalRecoveryScope: scope, sellerOriginalRecoveryBudgetBinding } : undefined);
}

export function isolatedOriginalWorkflow(scope: (id: string, sectionId: string) => SellerOriginalRecoveryScope | null): typeof Workflow {
  const recovery = isolatedOriginalRecovery(scope);
  return load("scripts/lib/scheduled-draft-workflow.ts", name => name === "./material-image-recovery" ? recovery : undefined);
}
