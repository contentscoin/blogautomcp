import { NextResponse } from 'next/server';

export function requireNoPendingDesktopUpdate(): NextResponse | null {
  if (process.env.DESKTOP_RESTART_PENDING === '1') {
    return NextResponse.json({
      success: false,
      code: 'DESKTOP_RESTART_PENDING',
      error: '프로그램 재시작 준비 중에는 새 자동화 작업을 시작할 수 없습니다. 잠시 후 다시 시도하세요.',
    }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  if (process.env.DESKTOP_UPDATE_INSTALL_PENDING !== '1') return null;
  return NextResponse.json({
    success: false,
    code: 'DESKTOP_UPDATE_PENDING',
    error: '새 버전 설치가 준비되어 새 포스팅 작업을 시작할 수 없습니다. 자동 재시작 후 다시 시도하세요.',
  }, { status: 503, headers: { 'cache-control': 'no-store' } });
}
