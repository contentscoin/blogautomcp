# 1.3.40 thumbnail/photo-review hotfix

- Photo-review Codex requests now default to the application's gpt-5.5 policy instead of inheriting the user's desktop model. Explicit caller model overrides remain supported.
- Shopping photo review includes detail-page segments; the existing semantic product-photo gate still rejects notices and non-product images.
- Compared scripts, src, and public against 1.3.39 unpacked release: exactly two existing packaged source files differ (codex-draft-provider.ts and simple-agent.ts).

Validation: production build, model-default regression, photo fallback regression, and auto-update-manager regression passed. Packaged runtime validation and publication are pending.

Network: initial Electron download failed TLS hostname validation (github.com received unpaid-block.uplus.co.kr certificate). Packaging uses the previously cached Electron 44.0.0 Windows x64 archive. Sites get_environment_variables failed transport twice; no upload key exists in project or installed-app environment files or process/user/machine environment. No production release has been published yet.

## Publication completed — 2026-09-08 09:52:34 KST

- Published Windows 1.3.40 through the existing site's authenticated administrator upload form. The first upload returned HTTP 500 without changing 1.3.39; the second upload succeeded. The administrator page displayed v1.3.40 and the completed-release message.
- Artifact: `out/release-1.3.40/BrandConnect-Automation-Setup-1.3.40.exe`, 326485874 bytes. The verify-only publisher confirmed manifest size and SHA-512, plus installer/blockmap SHA-256.
- Packaged auto-update fixture passed: authenticated metadata and installer download, isolated cache, packaged Prisma engine, HTTP 200 local UI, manual update check, and server relaunch. Fixture installation was disabled.
- Model-default and product-photo-fallback regressions passed. Both hotfix source files match the packaged source by SHA-256.
- This published the Windows release through the existing Sites update channel; no site-code redeployment was performed. Installation on all connected PCs has not been independently verified.
