/**
 * Tiny Mach-O parser for extracting the `LC_UUID` payload and the
 * architecture name. Just enough to support dSYM upload — we don't need
 * to walk symbol tables or anything fancy. Handles:
 *
 *   - Thin Mach-O (32 / 64-bit, either endianness)
 *   - Fat (universal) archives: returns the FIRST architecture's UUID
 *     (callers can re-call with a slice if they need to enumerate)
 *
 * Reference:
 *   https://developer.apple.com/documentation/kernel/mach-o_file_format
 *   /usr/include/mach-o/loader.h
 */

// Canonical Mach-O magic values (from <mach-o/loader.h>). The "CIGAM"
// variants are byte-swapped — they appear in the file when the file's
// native byte order is the opposite of how we read it.
const MH_MAGIC_32 = 0xfeedface;
const MH_CIGAM_32 = 0xcefaedfe;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;

const LC_UUID = 0x1b;

const CPU_NAMES: Record<number, string> = {
  // values from <mach/machine.h>; only the common dSYM-relevant ones
  0x100_0007: "x86_64",
  0x0100_000c: "arm64",
  0x0200_000c: "arm64_32",
  0x0000_0007: "i386",
  0x0000_000c: "arm",
};

function cpuName(cputype: number): string | null {
  // We were a little loose on the table above; cputype is signed 32-bit so
  // normalize to unsigned first.
  const u = cputype >>> 0;
  return CPU_NAMES[u] ?? null;
}

function hex(b: Uint8Array, start: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += b[start + i].toString(16).padStart(2, "0");
  }
  return out;
}

export interface MachOInfo {
  uuid: string; // canonical 32-hex lowercase (no dashes)
  arch: string | null;
}

/**
 * Parse `bytes` as a Mach-O (thin or fat). Returns `null` if it's not a
 * recognisable Mach-O — callers can use that signal to surface a "this
 * doesn't look like a dSYM DWARF binary" error to the user.
 */
export function extractMachOUuid(bytes: Uint8Array): MachOInfo | null {
  if (bytes.length < 32) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, false); // try BE first
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    // Fat header: nfat_arch follows, then fat_arch entries pointing at
    // contained Mach-O slices. We pick the first slice and recurse.
    const is64 = magic === FAT_MAGIC_64;
    const nfat = view.getUint32(4, false);
    if (nfat === 0) return null;
    // Slice 0 sits at offset 8 (after magic + nfat). fat_arch layout:
    //   uint32 cputype, uint32 cpusubtype, uint{32|64} offset, uint{32|64} size, ...
    const offsetField = 8 + 4 + 4; // skip cputype + cpusubtype
    const sliceOffset = is64
      ? Number(view.getBigUint64(offsetField, false))
      : view.getUint32(offsetField, false);
    const sliceSize = is64
      ? Number(view.getBigUint64(offsetField + 8, false))
      : view.getUint32(offsetField + 4, false);
    if (sliceOffset + sliceSize > bytes.length) return null;
    return extractMachOUuid(
      bytes.subarray(sliceOffset, sliceOffset + sliceSize)
    );
  }

  // Thin Mach-O. Read magic both ways and match against canonical /
  // swapped forms.
  // - magic field reads as CIGAM → file's byte order is opposite of our
  //   read → must re-read everything in the other endianness.
  // - magic field reads as MAGIC → file matches our read order.
  const magicLe = view.getUint32(0, true);
  let littleEndian = false;
  let is64 = false;
  if (magicLe === MH_MAGIC_64) {
    // LE-formatted 64-bit Mach-O (the modern arm64 / x86_64 case).
    littleEndian = true;
    is64 = true;
  } else if (magicLe === MH_MAGIC_32) {
    littleEndian = true;
    is64 = false;
  } else if (magicLe === MH_CIGAM_64) {
    // Bytes look swapped from LE — file is BE-formatted 64-bit.
    littleEndian = false;
    is64 = true;
  } else if (magicLe === MH_CIGAM_32) {
    littleEndian = false;
    is64 = false;
  } else {
    return null;
  }

  // Mach header layout (32-bit version, 28 bytes):
  //   magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags
  // 64-bit version is 32 bytes (extra reserved field at the end).
  const cputype = view.getUint32(4, littleEndian);
  const ncmds = view.getUint32(16, littleEndian);
  const headerSize = is64 ? 32 : 28;

  let offset = headerSize;
  for (let i = 0; i < ncmds && offset + 8 <= bytes.length; i++) {
    const cmd = view.getUint32(offset, littleEndian);
    const cmdsize = view.getUint32(offset + 4, littleEndian);
    if (cmdsize < 8 || offset + cmdsize > bytes.length) return null;
    if (cmd === LC_UUID && cmdsize >= 24) {
      // uuid_command: cmd, cmdsize, uint8[16] uuid
      const uuidStart = offset + 8;
      return {
        uuid: hex(bytes, uuidStart, 16).toLowerCase(),
        arch: cpuName(cputype),
      };
    }
    offset += cmdsize;
  }
  return null;
}
