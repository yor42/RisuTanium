# Stage handoff: #628 --apk flag

- Completed: PR https://github.com/yor42/RisuTanium/pull/632, commit 5985c95dd on claude/628-apk-flag (Closes #628 only).
- Decisions: MC-3718 (maintainer: small PR now, all places; also changes android-build debug mode). No new MC entries.
- Changed files: .github/workflows/android-build.yml (CRLF kept), Agents/Tools/device/build-apk.ps1, sign-release.ps1, README.md (LF kept). Each is a one-line removal of the 'true' after --apk.
- Tests: installed CLI 2.12.5 --help only: old list exit 2, new list exit 0. Device Test-Runner.ps1 ALL PASSED (510 PASS, 0 FAIL); it has no expectation on the argument list. Real debug build via build-apk.ps1: verdict pass, apk sha256 395BF3A24DC8339DC41777FEC6D25DA4C1338DE07AB17BB5DBD4193F3F02930D at src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk (in the worktree). sign-release.ps1 was not run. Gate 2: adversarial-reviewer [ACCEPT], no findings.
- Unresolved: none. The build needed gitignored generated Android files copied from the main checkout (generated only); build EOL churn in AndroidManifest.xml and gradlew was discarded.
- Next steps: none remain. #590 rebases on this PR.
