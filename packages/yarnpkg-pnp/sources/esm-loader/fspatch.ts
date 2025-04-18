import fs                            from 'fs';

import {HAS_LAZY_LOADED_TRANSLATORS} from './loaderFlags';

//#region ESM to CJS support
if (!HAS_LAZY_LOADED_TRANSLATORS) {
  const binding = (process as any).binding(`fs`) as {
    fstat: (fd: number, useBigint: false, req: any, ctx: object) => Float64Array;
    /**
     * Added in https://github.com/nodejs/node/pull/48658 / v20.5.0
     * Renamed in https://github.com/nodejs/node/pull/49593 / v20.8.0
     */
    readFileSync?: (path: string, flag: number) => string;
    /**
     * Added in https://github.com/nodejs/node/pull/49593
     */
    readFileUtf8?: (path: string, flag: number) => string;
  };

  const originalReadFile = binding.readFileUtf8 || binding.readFileSync;
  if (originalReadFile) {
    // @ts-expect-error - No index signature
    binding[originalReadFile.name] = function (...args: Parameters<typeof originalReadFile>) {
      try {
        return fs.readFileSync(args[0], {
          encoding: `utf8`,
          // @ts-expect-error - The docs says it needs to be a string but
          // links to https://nodejs.org/dist/latest-v20.x/docs/api/fs.html#file-system-flags
          // which says it can be a number which matches the implementation.
          flag: args[1],
        });
      } catch { }

      return originalReadFile.apply(this, args);
    };
  } else {
    /*
      In order to import CJS files from ESM Node does some translating
      internally[1]. This translator calls an unpatched `readFileSync`[2]
      which itself calls an internal `tryStatSync`[3] which calls
      `binding.fstat`[4]. A PR[5] has been made to use the monkey-patchable
      `fs.readFileSync` but assuming that wont be merged this region of code
      patches that final `binding.fstat` call.

      1: https://github.com/nodejs/node/blob/d872aaf1cf20d5b6f56a699e2e3a64300e034269/lib/internal/modules/esm/translators.js#L177-L277
      2: https://github.com/nodejs/node/blob/d872aaf1cf20d5b6f56a699e2e3a64300e034269/lib/internal/modules/esm/translators.js#L240
      3: https://github.com/nodejs/node/blob/1317252dfe8824fd9cfee125d2aaa94004db2f3b/lib/fs.js#L452
      4: https://github.com/nodejs/node/blob/1317252dfe8824fd9cfee125d2aaa94004db2f3b/lib/fs.js#L403
      5: https://github.com/nodejs/node/pull/39513
    */

    const binding = (process as any).binding(`fs`) as {
      fstat: (fd: number, useBigint: false, req: any, ctx: object) => Float64Array;
    };
    const originalfstat = binding.fstat;

    // Those values must be synced with packages/yarnpkg-fslib/sources/ZipOpenFS.ts TODO????????
    const ZIP_MASK = 0xff000000;
    const ZIP_MAGIC = 0x2a000000;

    binding.fstat = function (...args) {
      const [fd, useBigint, req] = args;
      if ((fd & ZIP_MASK) === ZIP_MAGIC && useBigint === false && req === undefined) {
        try {
          const stats = fs.fstatSync(fd);
          // The reverse of this internal util
          // https://github.com/nodejs/node/blob/8886b63cf66c29d453fdc1ece2e489dace97ae9d/lib/internal/fs/utils.js#L542-L551
          return new Float64Array([
            stats.dev,
            stats.mode,
            stats.nlink,
            stats.uid,
            stats.gid,
            stats.rdev,
            stats.blksize,
            stats.ino,
            stats.size,
            stats.blocks,
            // atime sec
            // atime ns
            // mtime sec
            // mtime ns
            // ctime sec
            // ctime ns
            // birthtime sec
            // birthtime ns
          ]);
        } catch { }
      }

      return originalfstat.apply(this, args);
    };
  }
}
//#endregion
