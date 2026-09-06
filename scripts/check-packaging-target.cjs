const { execFileSync } = require('node:child_process');
const path = require('node:path');

function assertTargetIdle(target, processes) {
  const root = path.win32.resolve(target).toLowerCase() + '\\';
  if (processes.some(p => p.ExecutablePath && path.win32.resolve(p.ExecutablePath).toLowerCase().startsWith(root))) {
    throw new Error('PACKAGING_TARGET_IN_USE: 실행 중인 앱의 출력 폴더는 패키징할 수 없습니다. 앱을 정상 종료하거나 별도 출력 폴더를 사용하세요.');
  }
}
function checkTarget(target) {
  if (process.platform !== 'win32') return;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Select-Object ExecutablePath) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true });
  assertTargetIdle(target, JSON.parse(output));
  console.log('Packaging target is not in use.');
}
module.exports = { assertTargetIdle, checkTarget };
if (require.main === module) checkTarget(path.resolve(__dirname, '../out/win-unpacked'));
