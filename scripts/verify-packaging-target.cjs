const assert = require('node:assert/strict');
const { assertTargetIdle } = require('./check-packaging-target.cjs');
const target = 'C:\\work\\out\\win-unpacked';
assert.throws(() => assertTargetIdle(target, [{ExecutablePath: target + '\\app.exe'}]), /PACKAGING_TARGET_IN_USE/);
assert.throws(() => assertTargetIdle(target, [{ExecutablePath: 'c:\\WORK\\out\\WIN-UNPACKED\\resources\\worker.exe'}]), /PACKAGING_TARGET_IN_USE/);
assert.doesNotThrow(() => assertTargetIdle(target, [{ExecutablePath: target + '-other\\app.exe'}, {ExecutablePath: null}]));
assert.doesNotThrow(() => assertTargetIdle(target, []));
console.log('Packaging target safety: 4 tests passed');
