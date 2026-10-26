# RisuTanium Hono Server

> Note: This server is currently under development and may not be fully functional. **use node version instead if you do not know what you are doing.**

This directory contains the implementation of the RisuTanium server using the Hono framework, which is made for replacement of the Node.js server in `server/node`.

## Node version

The Node entry (`src/node.ts`) needs a Node.js version that has the fix for CVE-2026-111497, a High-severity out-of-bounds write in the Brotli decoder behind `node:zlib`. The minimum fixed versions are 22.23.4, 24.22.1 and 26.12.1; any newer release of those lines, or a later major, is also fixed. Other lines (20, 23, 25 and older) have no fix. The entry prints a warning at startup on an affected version and still starts.