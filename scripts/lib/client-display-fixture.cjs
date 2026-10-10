/* eslint-disable @typescript-eslint/no-require-imports -- Load real client display dependencies in offline VM fixtures. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

exports.loadClientDisplay = function loadClientDisplay(relative, runtimeRequire) {
  const filename = path.resolve(relative);
  const fixtureModule = { exports: {} };
  const context = vm.createContext({ module: fixtureModule, exports: fixtureModule.exports,
    require(name) {
      if (name.startsWith('.')) return loadClientDisplay(path.resolve(path.dirname(filename), `${name}.ts`), runtimeRequire);
      return runtimeRequire(name);
    },
  });
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new vm.Script(source, { filename }).runInContext(context);
  return fixtureModule.exports;
};
