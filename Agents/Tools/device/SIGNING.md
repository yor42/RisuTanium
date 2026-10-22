# Release signing for RisuTanium (maintainer guide)

`sign-release.ps1` builds the release APK signed with your own key, checks the signature and prints the certificate
fingerprint. The key never enters the repository or a command line, and an agent has no supported way to reach it.

Limits, stated plainly:

- The refusal to run in an agent shell is a speed bump, not a security boundary. The real boundary is the SecretStore
  password (step 2, `-Interaction Prompt`): without it nothing can be read from the vault.
- The folder permissions in step 3 protect against other Windows users only, not against processes running as you.
- While a build runs, the four values sit in the environment of every process it starts: pnpm, node scripts, vite, cargo
  build scripts and Gradle. The build runs Gradle without a daemon and the script stops leftover Gradle daemons afterwards
  (`gradlew --stop`, which also stops daemons of the same Gradle version that you started yourself). The script sets Kotlin
  to compile in-process; if Gradle does not forward that setting, a Kotlin compile daemon could keep the values until its
  idle timeout, because `gradlew --stop` does not stop it. After the first real signed build, check `Get-Process java` and
  stop any leftover.
- Gradle error text can include the key alias and the keystore path in the build logs.

How it works: the keystore file lives outside the repository. Its path, its password, the key alias and the key password
are stored in an encrypted PowerShell vault. The script reads them after you type the vault password, hands them to the
build only as environment variables (`RISU_ANDROID_KEYSTORE`, `RISU_ANDROID_KEYSTORE_PASSWORD`, `RISU_ANDROID_KEY_ALIAS`,
`RISU_ANDROID_KEY_PASSWORD`, read by `src-tauri/gen/android/app/build.gradle.kts`) and removes them when the build ends.

All commands below are typed by you in a normal PowerShell 7 terminal.

## One-time setup

1. Install the two modules (SecretManagement is the interface, SecretStore is the encrypted storage):

   ```
   Install-Module Microsoft.PowerShell.SecretManagement, Microsoft.PowerShell.SecretStore -Scope CurrentUser
   ```

2. Create a dedicated, password-protected vault. `Set-SecretStoreConfiguration` asks you to choose the vault password.

   ```
   Register-SecretVault -Name RisuSigning -ModuleName Microsoft.PowerShell.SecretStore
   Set-SecretStoreConfiguration -Authentication Password -Interaction Prompt
   ```

   The SecretStore is one store per Windows user, shared by every vault that uses it, so this also password-protects any
   other SecretStore vault you have. The script refuses an unprotected store and refuses a vault that is not a SecretStore.

3. Put the keystore in `%USERPROFILE%\.risu-signing\`, outside the repository, and restrict the folder to your user only:

   ```
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.risu-signing"
   Move-Item C:\where\your\keystore.jks "$env:USERPROFILE\.risu-signing\risutanium.jks"
   icacls "$env:USERPROFILE\.risu-signing" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F"
   ```

   `icacls` removes inherited permissions and grants full control to your user only. Check with
   `icacls "$env:USERPROFILE\.risu-signing"`: one entry, yours.

4. Store the four values. Never put a password in a command line: it lands in shell history and the process list.
   `Read-Host -AsSecureString` shows no characters while you type and keeps nothing in history. Each command prompts you,
   so run them one by one and type the value when asked:

   ```
   Set-Secret -Vault RisuSigning -Name RisuKeystorePath -Secret "$env:USERPROFILE\.risu-signing\risutanium.jks"
   Set-Secret -Vault RisuSigning -Name RisuKeystorePassword -Secret (Read-Host 'Keystore password' -AsSecureString)
   Set-Secret -Vault RisuSigning -Name RisuKeyAlias -Secret (Read-Host 'Key alias' -AsSecureString)
   Set-Secret -Vault RisuSigning -Name RisuKeyPassword -Secret (Read-Host 'Key password' -AsSecureString)
   ```

   With a PKCS12 keystore (the default since JDK 9), the key password must be the same as the keystore password: type the
   same value for `RisuKeyPassword` as for `RisuKeystorePassword`. Otherwise the build fails at its very end with a
   "cannot recover key" error.

   The path is not a secret; the first line is safe to run as written. Use other names only if you also pass
   `-KeystorePathSecret`, `-KeystorePasswordSecret`, `-KeyAliasSecret`, `-KeyPasswordSecret` and `-Vault` to the script.

5. Record the expected certificate fingerprint. It is public, not a secret. It guards against signing with the wrong key,
   which would stop every installed copy from updating in place. Either read it from the keystore (`keytool` is in the JDK;
   it prompts for the keystore password):

   ```
   keytool -list -v -keystore "$env:USERPROFILE\.risu-signing\risutanium.jks"
   ```

   or from an APK you already shipped, with `apksigner verify --print-certs <apk>` from the Android SDK build-tools.
   Copy the `SHA-256` value (64 hex digits, colons allowed) into
   `%USERPROFILE%\.risu-signing\expected-cert-sha256.txt`. Without that file the script still signs and verifies but cannot
   catch a wrong key: it prints `fingerprintCheck=none` and a warning that the key was not compared. A run that matches the
   file prints `fingerprintCheck=match`. For the very first release there is nothing to compare with; after it, create the
   file from the `certSha256=` line the script printed (for example
   `Set-Content "$env:USERPROFILE\.risu-signing\expected-cert-sha256.txt" '<the 64 hex digits>'`), so every later run is
   checked.

6. If `src-tauri/gen/android/keystore.properties` exists from an earlier manual setup: it still works as the fallback (CI
   writes it), but the environment values take precedence over it. Once step 7 passes, delete the file so a plaintext copy
   of the passwords does not stay on disk.

## Each release

7. Run the script from a normal terminal in the repository root:

   ```
   pwsh -NoProfile -File Agents\Tools\device\sign-release.ps1
   ```

   It asks for the vault password, builds (this takes as long as `build-apk.ps1 -Kind release`), and prints the APK path,
   the APK SHA-256, the signer certificate SHA-256 and `verdict=PASS` or `verdict=FAIL` (exit code 1). The APK is
   `src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk`. Add `-Install -Serial <serial>`
   to install it with `adb -s`; a signature mismatch with the installed app is refused unless you add `-AllowClear`, which
   uninstalls the app and wipes its data.

   The script refuses to run from Claude Code, the `!` prompt prefix included (any shell where `CLAUDECODE` or
   `CLAUDE_CODE_ENTRYPOINT` is set, or without interactive input). Run it in an ordinary PowerShell window; there is no
   override.

## Keep the key safe

8. Back up the keystore file and all four values (path aside, the two passwords and the alias) offline, for example on an
   encrypted USB drive or in a password manager, in a place that is not this computer. Losing the key, or its password,
   means no APK can ever update an installed copy in place again: users would have to uninstall and lose their data
   (MC-345 constraint). Back up before the first release you hand to anyone. Then check the backup copy itself:
   `keytool -list -keystore <path to the backup copy>` must ask for the password and list your key alias.

## What agents may and may not do

9. Agents never read, list or quote the vault, the keystore, `keystore.properties` or `src-tauri/key.txt`, and never type the
   vault password. `sign-release.ps1` refuses to run in an agent shell and in a host without interactive input, and it has no
   switch to override either; as stated at the top, this is a speed bump and the SecretStore password is the real boundary.
   The script also refuses a vault that is not a password-protected SecretStore. Agents may run the test suite, which uses
   fake secrets and never opens a vault, and may read the printed certificate fingerprint you paste to them.
