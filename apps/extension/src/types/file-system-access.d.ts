// Augments the standard DOM types with File System Access API features
// not yet included in TypeScript's built-in lib.

interface FileSystemDirectoryHandle extends FileSystemHandle {
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

interface Window {
  showDirectoryPicker(options?: { mode?: "read" | "readwrite"; startIn?: string }): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker(options?: Record<string, unknown>): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: Record<string, unknown>): Promise<FileSystemFileHandle>;
}
