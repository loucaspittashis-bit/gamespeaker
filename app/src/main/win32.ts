import { basename } from 'node:path';
import { nodeRequire } from './native';

// Windows API calls (through koffi) for game detection and the Go Live list.
// Loaded once; null on other systems or if koffi isn't available.

export type TopWindow = {
  hwnd: number;
  title: string;
  className: string;
  pid: number;
  width: number;
  height: number;
  minimized: boolean;
  /** Hidden by Windows itself (other virtual desktops, suspended store apps). */
  cloaked: boolean;
  /** Click-through, tool or never-focusable: how overlays mark their windows. */
  overlay: boolean;
};

export type Win32 = {
  pidOf(hwnd: number): number;
  /** Full path of the program running as `pid`, or ''. */
  exePathOf(pid: number): string;
  /** Lowercase file name of the program running as `pid`, or ''. */
  exeOf(pid: number): string;
  isFullscreen(hwnd: number): boolean;
  isOverlay(hwnd: number): boolean;
  foreground(): number;
  /** Every visible top-level window with a title. */
  topWindows(): TopWindow[];
};

function load(): Win32 | null {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = nodeRequire('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    const RECT = koffi.struct('GS_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    const MONITORINFO = koffi.struct('GS_MONITORINFO', { cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t' });
    const EnumWindowsProc = koffi.proto('bool __stdcall GS_EnumWindowsProc(uintptr_t hwnd, intptr_t lParam)');

    const EnumWindows = user32.func('bool __stdcall EnumWindows(GS_EnumWindowsProc *lpEnumFunc, intptr_t lParam)');
    const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(uintptr_t hWnd)');
    const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(uintptr_t hWnd, _Out_ uint16_t *lpString, int nMaxCount)');
    const GetClassNameW = user32.func('int __stdcall GetClassNameW(uintptr_t hWnd, _Out_ uint16_t *lpClassName, int nMaxCount)');
    const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32_t *lpdwProcessId)');
    const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()');
    const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int nIndex)');
    const IsIconic = user32.func('bool __stdcall IsIconic(uintptr_t hWnd)');
    const GetWindowRect = user32.func('bool __stdcall GetWindowRect(uintptr_t hWnd, _Out_ GS_RECT *lpRect)');
    const MonitorFromWindow = user32.func('uintptr_t __stdcall MonitorFromWindow(uintptr_t hwnd, uint32_t dwFlags)');
    const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(uintptr_t hMonitor, _Inout_ GS_MONITORINFO *lpmi)');
    const DwmGetWindowAttribute = dwmapi.func(
      'int32_t __stdcall DwmGetWindowAttribute(uintptr_t hwnd, uint32_t dwAttribute, _Out_ uint32_t *pvAttribute, uint32_t cbAttribute)',
    );
    const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)');
    const QueryFullProcessImageNameW = kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, _Out_ uint16_t *lpExeName, _Inout_ uint32_t *lpdwSize)',
    );
    const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *hObject)');

    const GWL_EXSTYLE = -20;
    const WS_EX_TRANSPARENT = 0x20;
    const WS_EX_TOOLWINDOW = 0x80;
    const WS_EX_NOACTIVATE = 0x08000000;
    const DWMWA_CLOAKED = 14;
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const MONITOR_DEFAULTTONEAREST = 2;
    const monitorInfoSize = koffi.sizeof(MONITORINFO);
    const emptyRect = () => ({ left: 0, top: 0, right: 0, bottom: 0 });
    const text = (fn: (h: number, buf: Uint16Array, n: number) => number, hwnd: number) => {
      const buf = new Uint16Array(512);
      const n = fn(hwnd, buf, buf.length);
      return n > 0 ? String.fromCharCode(...buf.subarray(0, n)) : '';
    };

    const pidOf = (hwnd: number) => {
      const out = [0];
      GetWindowThreadProcessId(hwnd, out);
      return out[0] ?? 0;
    };
    const exePathOf = (pid: number) => {
      const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (!handle) return '';
      try {
        const buf = new Uint16Array(1024);
        const size = [buf.length];
        if (!QueryFullProcessImageNameW(handle, 0, buf, size)) return '';
        return String.fromCharCode(...buf.subarray(0, size[0]));
      } finally {
        CloseHandle(handle);
      }
    };
    const isOverlay = (hwnd: number) => {
      const ex = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      return (ex & (WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) !== 0;
    };

    return {
      pidOf,
      exePathOf,
      exeOf: (pid) => basename(exePathOf(pid)).toLowerCase(),
      isFullscreen: (hwnd) => {
        if (IsIconic(hwnd)) return false;
        const rect = emptyRect();
        if (!GetWindowRect(hwnd, rect)) return false;
        const info = { cbSize: monitorInfoSize, rcMonitor: emptyRect(), rcWork: emptyRect(), dwFlags: 0 };
        if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), info)) return false;
        const m = info.rcMonitor;
        return rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom;
      },
      isOverlay,
      foreground: () => Number(GetForegroundWindow()),
      topWindows: () => {
        const hwnds: number[] = [];
        EnumWindows((hwnd: number | bigint) => {
          hwnds.push(Number(hwnd));
          return true;
        }, 0);
        const out: TopWindow[] = [];
        for (const hwnd of hwnds) {
          if (!IsWindowVisible(hwnd)) continue;
          const title = text(GetWindowTextW, hwnd).trim();
          if (!title) continue;
          const rect = emptyRect();
          GetWindowRect(hwnd, rect);
          const cloaked = [0];
          DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4);
          out.push({
            hwnd,
            title,
            className: text(GetClassNameW, hwnd),
            pid: pidOf(hwnd),
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            minimized: Boolean(IsIconic(hwnd)),
            cloaked: (cloaked[0] ?? 0) !== 0,
            overlay: isOverlay(hwnd),
          });
        }
        return out;
      },
    };
  } catch (err) {
    console.warn('Windows window lookups unavailable:', err);
    return null;
  }
}

export const win32: Win32 | null = load();
