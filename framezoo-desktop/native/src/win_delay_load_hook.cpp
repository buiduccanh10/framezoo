#if defined(_WIN32)
#include <windows.h>
#include <delayimp.h>
#include <string.h>

// Delay-load hook for the node core import.
//
// The addon links against an import library (node.lib) whose import
// descriptors reference `node.exe`. Inside Electron there is no node.exe:
// the Node core symbols are exported by the process image (electron.exe) or,
// on newer Electron builds, by a `node.dll` that is loaded into the process.
//
// This hook intercepts the delay-load at dliNotePreLoadLibrary and returns
// the already-loaded module that actually exports the symbols, in order:
//
//   1. the process image (electron.exe / node.exe / Framezoo.exe)
//   2. node.dll (Electron builds that split the Node runtime into node.dll)
//
// If neither resolves, the default behavior (NULL) lets delayimp fail the
// load with a normal error, which the controller surfaces to the renderer.
static FARPROC WINAPI delayHook(unsigned dliNotify, PDelayLoadInfo pdli) {
  if (dliNotify != dliNotePreLoadLibrary || !pdli || !pdli->szDll) {
    return NULL;
  }

  const bool isNodeCoreImport =
      _stricmp(pdli->szDll, "node.exe") == 0 ||
      _stricmp(pdli->szDll, "electron.exe") == 0 ||
      _stricmp(pdli->szDll, "node.dll") == 0;
  if (!isNodeCoreImport) return NULL;

  HMODULE module = GetModuleHandleA(NULL);
  if (!module) {
    module = GetModuleHandleA("electron.exe");
  }
  if (!module) {
    module = GetModuleHandleA("node.dll");
  }
  return reinterpret_cast<FARPROC>(module);
}

#if defined(_MSC_VER)
extern "C" const PfnDliHook __pfnDliNotifyHook2 = delayHook;
#endif

#endif
