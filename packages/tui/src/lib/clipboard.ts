import { $ } from "bun";
import { platform, release } from "os";
import { tmpdir } from "os";
import path from "path";

export interface ClipboardContent {
  data: string;
  mime: string;
}

const IMAGE_EXTS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export async function readClipboard(): Promise<ClipboardContent | undefined> {
  const os = platform();

  if (os === "darwin") {
    const tmpfile = path.join(tmpdir(), "grind-clipboard.png");
    try {
      await $`osascript -e 'set imageData to the clipboard as "PNGf"' -e 'set fileRef to open for access POSIX file "${tmpfile}" with write permission' -e 'set eof fileRef to 0' -e 'write imageData to fileRef' -e 'close access fileRef'`
        .nothrow()
        .quiet();
      const buf = await Bun.file(tmpfile).arrayBuffer();
      if (buf.byteLength > 0) {
        return { data: Buffer.from(buf).toString("base64"), mime: "image/png" };
      }
    } catch {
      // no image in clipboard
    } finally {
      await $`rm -f "${tmpfile}"`.nothrow().quiet();
    }
  }

  if (os === "win32" || release().includes("WSL")) {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }";
    const base64 = await $`powershell.exe -NonInteractive -NoProfile -command "${script}"`
      .nothrow()
      .text();
    if (base64) {
      const imageBuffer = Buffer.from(base64.trim(), "base64");
      if (imageBuffer.length > 0) {
        return { data: imageBuffer.toString("base64"), mime: "image/png" };
      }
    }
  }

  if (os === "linux") {
    const wayland = await $`wl-paste -t image/png`.nothrow().arrayBuffer();
    if (wayland && wayland.byteLength > 0) {
      return { data: Buffer.from(wayland).toString("base64"), mime: "image/png" };
    }
    const x11 = await $`xclip -selection clipboard -t image/png -o`.nothrow().arrayBuffer();
    if (x11 && x11.byteLength > 0) {
      return { data: Buffer.from(x11).toString("base64"), mime: "image/png" };
    }
  }

  return undefined;
}

export async function readImageFile(filepath: string): Promise<ClipboardContent | undefined> {
  const ext = path.extname(filepath).toLowerCase();
  const mime = IMAGE_EXTS[ext];
  if (!mime) return undefined;
  try {
    const buf = await Bun.file(filepath).arrayBuffer();
    if (buf.byteLength === 0) return undefined;
    return { data: Buffer.from(buf).toString("base64"), mime };
  } catch {
    return undefined;
  }
}
