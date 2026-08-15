#if defined(_WIN32)
#include <windows.h>
#include <delayimp.h>

static FARPROC WINAPI delayHook(unsigned dliNotify, PDelayLoadInfo pdli) {
  if (dliNotify == dliNotePreLoadLibrary) {
    if (pdli && pdli->szDll && _stricmp(pdli->szDll, "node.exe") == 0) {
      HMODULE h = GetModuleHandleA(NULL);
      if (h) return reinterpret_cast<FARPROC>(h);
    }
  }
  return NULL;
}

#if defined(_MSC_VER)
extern "C" const PfnDliHook __pfnDliNotifyHook2 = delayHook;
#endif

#endif
