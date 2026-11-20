# `.rtb` golden fixtures

Frozen files written by the v1 `.rtb` writer, so a later build can show that it still reads what an earlier build wrote. A golden is never regenerated and never overwritten: a later writer change retires or replaces the determinism guard (T1d) at its own gate and never replaces a golden.

## Files

| File | Covers |
|---|---|
| `v1-golden-boundary.rtbseg` | golden 4: a `.rtb`-container file over 4 GiB, kept as a deflated sparse segment list. One stored descriptor entry `a/big` of 4 GiB + 1 bytes (every byte `0x55`), then 65,536 stored entries `x/000000` to `x/065535` with 1-byte bodies, all of whose offsets lie past 4 GiB. Every entry is stored (method 0), so the decoded runs hold no deflate output. It has no manifest: it exercises the ZIP64 counts, offsets and sizes only |
| `v1-sealed-small.rtb` | golden 5: a password-encrypted `.rtb` (sealed envelope version 1) written by the real export with a password. Password `rtb-golden-pw`, Argon2id m = 256 KiB, t = 2, p = 1, chunk size 4096. Its plaintext is a small whole backup: two assets, one inlay and one iris record, each of at least three chunks of incompressible bytes |
| `v1-sealed-small.plain.rtb` | golden 5's unencrypted twin: the same export without the password, from the same clock and key environment, so the sealed file's plaintext equals it byte for byte |

## SHA-256 and size

Written by hand from the generator's output; `rtbGoldens.test.ts` holds the same values as constants and fails when a golden, a constant or these lines differ.

SHA-256 v1-golden-boundary.rtbseg: d2c728784948118e04efd2e527631200729da35e0316336444a4ba79e8199f34
Size v1-golden-boundary.rtbseg: 810221 bytes
SHA-256 v1-sealed-small.rtb: 4688160dda0d6a7a36409ee200a6a177620b7d37a5f773f74a6d0c055a24d336
Size v1-sealed-small.rtb: 96661 bytes
SHA-256 v1-sealed-small.plain.rtb: 03335d97f8a37952ea6fa590c47ffbf53b6001287f971005e99de2b6752c9003
Size v1-sealed-small.plain.rtb: 96109 bytes

The size is under 1 MiB (1,048,576 bytes). The file is 4,301,848,833 bytes once decoded; the CRC-32 of `a/big` is `0x9d141e95`, checked byte by byte over the whole 4 GiB + 1 run when the file was made.

## How golden 4 was made

Run from the repository root. The generator writes only outside the repository, through exclusive create, and only when `RTB_GENERATE=1`; it prints the output path, the size and the SHA-256.

```
$env:RTB_GENERATE = '1'
node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/rtbBoundaryGolden.harness.ts
```

Name the harness file; never run the whole `save-gen` folder. The output directory is `RTB_GOLDENS_OUT` when set, otherwise a fresh directory under the OS temp folder. A directory under any `.git` marker, or inside the checkout the generator belongs to, is refused. The file was then copied here by hand (an ordinary file copy), and the SHA-256 and size above were written by hand.

## How golden 5 was made

The pair comes from the real producer, `runRtbExportGuarded`, over a small synthetic profile with the restore fixture builders and a fake file writer: a fixed clock, a fixed injected key environment, fixed injected randomness for the sealed file (master key, salt, wrap nonce and file id), explicit small Argon2id parameters and 4096-byte chunks. The generator checks, before it writes anything, that the independent test-only reference opens the sealed file with the password to exactly the twin's bytes and that the twin classifies `ok`. Run from the repository root:

```
$env:RTB_GENERATE = '1'
node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/rtbSealedGolden.harness.ts
```

It writes only outside the repository, through exclusive create, and prints each path, size and SHA-256. Both files were copied here by hand and the lines above were written by hand. The Argon2id values are deliberately small test values and are not the writer's defaults, so a golden never pins a product cost.

## Segment list layout (`.rtbseg`)

- Bytes 0-7: `52 54 42 53 45 47 00 01` (`RTBSEG\0\x01`).
- Bytes 8 to the end: one raw DEFLATE stream (RFC 1951, no zlib or gzip wrapper). Its inflated content is a sequence of records that cover the file contiguously from offset 0:
  - `0x01` data run: u32 little-endian length L (at least 1), then L bytes;
  - `0x02` fill run: u64 little-endian length L (at least 1), then one byte, the fill value;
  - `0x00` end: u64 little-endian total file length, equal to the sum of the run lengths; nothing follows.
- Adjacent data runs are allowed. The generator's sink emits a data run per `write` and a fill run per `writeFill`.

### Canonical run list

Runs are compared in canonical form: adjacent data runs merged into one byte run, fill runs kept and compared by length and fill value. How the writer chunks its `write` calls is therefore not part of a comparison, and neither is the DEFLATE output of the wrapper.

## Never regenerated

These bytes are frozen. The guard `rtbGoldens.test.ts` pins the SHA-256 and size as constants and compares the README lines with them. To change a golden is to add a new file by a deliberate hand copy plus two hand edits (the test constant and the README line), each visible in review. `.gitattributes` marks the files binary so a checkout never changes a byte.
