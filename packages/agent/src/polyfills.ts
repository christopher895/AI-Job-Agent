import { File as BufferFile } from "node:buffer";

if (typeof (globalThis as any).File === "undefined") {
  // Node 18 does not expose File globally, but several SDKs now expect it.
  // This keeps the runtime compatible without requiring a Node 20-only deploy.
  (globalThis as any).File = BufferFile;
}
