import { isExcludedDir, isIncludedFile, applyCapAndSort } from "./repo-filter";
import type { FilteredFile, FilterResult } from "./repo-filter";

export interface ReadProgress {
  scanned: number;
  found: number;
}

export async function readRepository(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (p: ReadProgress) => void
): Promise<FilterResult> {
  const raw: FilteredFile[] = [];
  let scanned = 0;

  await walkDir(dirHandle, "", raw, () => {
    scanned++;
    onProgress?.({ scanned, found: raw.length });
  });

  return applyCapAndSort(raw);
}

async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: FilteredFile[],
  onFile: () => void
): Promise<void> {
  for await (const [name, handle] of dir) {
    if (handle.kind === "directory") {
      if (isExcludedDir(name)) continue;
      await walkDir(handle as FileSystemDirectoryHandle, `${prefix}${name}/`, out, onFile);
    } else {
      if (!isIncludedFile(name)) continue;
      onFile();
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const content = await file.text();
        out.push({ path: `${prefix}${name}`, content });
      } catch {
        // skip unreadable files silently
      }
    }
  }
}
