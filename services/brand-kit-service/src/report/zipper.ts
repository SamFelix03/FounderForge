// Delivery — bundles every generated file into one in-memory zip buffer.

import archiver from "archiver";

export type ZipEntry = { zipPath: string; buffer: Buffer };

/**
 * @param entries files to include in the zip
 */
export function createZipBuffer(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    for (const { zipPath, buffer } of entries) {
      archive.append(buffer, { name: zipPath });
    }
    archive.finalize();
  });
}
