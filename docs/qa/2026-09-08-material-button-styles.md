# Material button visibility fix (1.3.39)

Installed 1.3.38 CSS lacked `.bg-violet-700` and `.bg-emerald-700` although the material component rendered buttons with white text. The user screenshot showed the preparation button nearly invisible on a pale background. Earlier mocked interaction verification did not detect missing production CSS.

Added an explicit Tailwind source for components and an opt-in uncached webpack build (`BLOGAUTO_FRESH_BUILD=1`). The first cached build still lacked the selectors; the uncached production build passed. Added `scripts/verify-material-styles.cjs` to the build command so missing preparation/publication button styles fail the build.

Verification: production build passed; material control fixture passed; all 9 material API tests passed; packaged 1.3.39 CSS passed the same selector check. Installer manifest and hashes verified with the update publishing script. No real generation or blog publication was run. Installed-app visual rendering was not re-tested.
