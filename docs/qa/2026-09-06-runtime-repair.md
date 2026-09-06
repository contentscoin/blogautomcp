# Runtime repair: 2026-09-06

All ten reported PREPARE jobs failed on 2026-09-06 08:42-08:43 UTC with code 2147483651. The active executable was out/win-unpacked (v1.3.21), not the newly published installer. Its debug.log had ten matching ICU data errors. Packaging into that active output had removed runtime data before failing to unlink the locked executable. app-update.yml was also missing.

Restored only missing runtime files from the verified Electron 44.0.0 package; retained the active executable and user data. Restored the update configuration. Child-process probe subsequently returned 0 and Electron 44.0.0. No manuscripts were published.

Live MCP retry job_oy0tZ1U_pQs-DJg9 succeeded in about 19 seconds, writing a fresh mcp-draft-context.json at 17:59:43 KST. Original ten jobs remain failed historical records.

Prevention: check-packaging-target.cjs rejects active processes inside the output directory before the build command; beforePack also protects direct electron-builder invocations. Four path-boundary regression assertions and a live beforePack rejection test passed. Process inventory errors fail closed.
