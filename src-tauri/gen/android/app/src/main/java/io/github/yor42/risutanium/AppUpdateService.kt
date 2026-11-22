package io.github.yor42.risutanium

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// The Android edge of the in-app update: adapters under the pure controller (AppUpdateController),
// the intent hand-off and the install-permission round trip. Every decision lives in the pure
// files; nothing here may add a path that does not report a result.

private const val TAG = "AppUpdateService"

// The only directory the update writes to, and the only one the FileProvider exposes for it
// (res/xml/file_paths.xml, name app_update).
private const val UPDATE_DIR = "app-update"
private const val APK_MIME = "application/vnd.android.package-archive"
private const val USER_AGENT = "RisuTanium-Android-Updater"
private const val CONNECT_TIMEOUT_MS = 10_000
private const val READ_TIMEOUT_MS = 30_000

// Hex of the SHA-256 of each signing certificate. A missing list is the empty set, which verdict
// refuses on either side, so an unreadable signer never matches.
fun signerSet(certificates: List<ByteArray>?): Set<String> {
  if (certificates == null) return emptySet()
  val signers = HashSet<String>()
  for (certificate in certificates) {
    val digest = MessageDigest.getInstance("SHA-256").digest(certificate)
    val hex = StringBuilder(digest.size * 2)
    for (byte in digest) hex.append(String.format("%02x", byte.toInt() and 0xff))
    signers.add(hex.toString())
  }
  return signers
}

private fun isEvent(message: String): Boolean = message.startsWith("{\"event\"")

// Runs one page request. A throw before the request has had its terminal reply is answered with an
// `other` error, so the page never waits on a request the host dropped. A progress event is not a
// terminal reply.
fun guardedRequest(
  id: Int,
  method: String,
  deliver: (String) -> Unit,
  log: (String) -> Unit,
  call: ((String) -> Unit) -> Unit
) {
  var answered = false
  val tracked: (String) -> Unit = { message ->
    if (!isEvent(message)) answered = true
    deliver(message)
  }
  try {
    call(tracked)
  } catch (error: Exception) {
    log(droppedMessageLog(error))
    if (!answered) {
      answered = true
      deliver(encodeUpdateReply(id, method, UpdateReply.Failure(UpdateErrorCode.OTHER)))
    }
  }
}

// The "Install unknown apps" round trip. One request waits for the settings page at a time; every
// request is answered exactly once: when the page returns, at once when it cannot be opened, or at
// once with the current value when a newer request supersedes it (the newer request then waits for
// the launch that is already open).
class InstallSettingsRequests(
  private val allowed: () -> Boolean,
  private val launch: () -> Boolean,
  private val log: (String) -> Unit
) {
  private class Pending(val id: Int, val deliver: (String) -> Unit)

  private var pending: Pending? = null

  fun open(id: Int, deliver: (String) -> Unit) {
    val request = Pending(id, deliver)
    val previous = pending
    pending = request
    if (previous != null) {
      answer(previous)
      return
    }
    val launched = try {
      launch()
    } catch (error: Exception) {
      log(droppedMessageLog(error))
      false
    }
    if (!launched) {
      pending = null
      answer(request)
    }
  }

  fun returned() {
    val request = pending ?: return
    pending = null
    answer(request)
  }

  private fun answer(request: Pending) {
    val value = try {
      allowed()
    } catch (error: Exception) {
      log(droppedMessageLog(error))
      false
    }
    try {
      request.deliver(encodeUpdateReply(request.id, "openInstallSettings", UpdateReply.Allowed(value)))
    } catch (error: Exception) {
      log(droppedMessageLog(error))
    }
  }
}

// The activity's two result launchers, attached while it is alive; main thread only.
class UpdateLaunchers(
  val installer: ActivityResultLauncher<Intent>,
  val settings: ActivityResultLauncher<Intent>
)

// One per process (AppUpdateService.shared). Every method runs on the main thread, as the
// controller requires.
class AppUpdateService private constructor(context: Context) {
  private val appContext: Context = context.applicationContext
  private val dir = File(appContext.cacheDir, UPDATE_DIR)
  private val worker: ExecutorService = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  // Main thread only.
  private var launchers: UpdateLaunchers? = null

  private val settingsRequests = InstallSettingsRequests(::canRequestInstalls, ::launchSettings, ::log)

  private val effects = object : AppUpdateEffects {
    // A throw on the serial worker would end the process, so each task is contained.
    override fun onWorker(task: Runnable) {
      worker.execute {
        try {
          task.run()
        } catch (error: Exception) {
          log(droppedMessageLog(error))
        }
      }
    }

    override fun postMain(task: Runnable) {
      mainHandler.post(task)
    }

    // Reports on every path: no launcher is FAILED, a permission re-check that fails is
    // PERMISSION_OFF, any exception is FAILED.
    override fun launch(gen: Long, name: String): LaunchResult {
      val attached = launchers ?: return LaunchResult.FAILED
      return try {
        if (!canRequestInstalls()) return LaunchResult.PERMISSION_OFF
        attached.installer.launch(installIntent(uriFor(name)))
        LaunchResult.LAUNCHED
      } catch (error: Exception) {
        log(droppedMessageLog(error))
        LaunchResult.FAILED
      }
    }

    override fun revoke(name: String) {
      try {
        appContext.revokeUriPermission(uriFor(name), Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (error: Exception) {
        log(droppedMessageLog(error))
      }
    }

    override fun deleteAll() {
      dir.listFiles()?.forEach { it.delete() }
    }

    // The controller keeps the cancel mirror the worker reads; the edge has nothing to add.
    override fun markCancelled(gen: Long) = Unit
  }

  private val controller = AppUpdateController(effects, AndroidJobFactory(appContext, dir), log = ::log)

  fun processStart() = controller.processStart()

  fun newPage() = controller.newPage()

  fun resumed() = controller.resumed()

  fun paused() = controller.paused()

  fun cancel() = controller.cancel()

  fun installerReturned() = controller.installerReturned()

  fun check(id: Int, deliver: (String) -> Unit) = controller.check(id, deliver)

  fun install(id: Int, url: String, size: Long, versionCode: Long, deliver: (String) -> Unit) =
    controller.install(id, url, size, versionCode, deliver)

  fun installPermission(id: Int, deliver: (String) -> Unit) {
    val value = try {
      canRequestInstalls()
    } catch (error: Exception) {
      log(droppedMessageLog(error))
      false
    }
    deliver(encodeUpdateReply(id, "installPermission", UpdateReply.Allowed(value)))
  }

  fun openInstallSettings(id: Int, deliver: (String) -> Unit) = settingsRequests.open(id, deliver)

  fun settingsReturned() = settingsRequests.returned()

  fun attach(attached: UpdateLaunchers) {
    launchers = attached
  }

  // Only the launchers that are still attached are dropped, so a recreated activity's launchers survive
  // the old activity's destruction.
  fun detach(detached: UpdateLaunchers) {
    if (launchers === detached) launchers = null
  }

  // Below API 26 there is no per-app install permission, so installing is always allowed.
  private fun canRequestInstalls(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || appContext.packageManager.canRequestPackageInstalls()

  // The settings page of this app's "Install unknown apps" switch; reported false when it cannot open.
  private fun launchSettings(): Boolean {
    val attached = launchers ?: return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.fromParts("package", appContext.packageName, null))
    attached.settings.launch(intent)
    return true
  }

  private fun uriFor(name: String): Uri =
    FileProvider.getUriForFile(appContext, "${appContext.packageName}.fileprovider", File(dir, name))

  // One read-only grant on the one verified file, and nothing else: no prefix, write or persistable flag.
  @Suppress("DEPRECATION")
  private fun installIntent(uri: Uri): Intent =
    Intent(Intent.ACTION_INSTALL_PACKAGE)
      .setDataAndType(uri, APK_MIME)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

  private fun log(message: String) {
    Log.w(TAG, message)
  }

  companion object {
    @Volatile
    private var instance: AppUpdateService? = null

    // Called first in MainActivity.onCreate, ahead of the WebView and its message listener.
    @Synchronized
    fun init(context: Context) {
      if (instance == null) instance = AppUpdateService(context)
    }

    val shared: AppUpdateService
      get() = instance ?: throw IllegalStateException("update service not initialised")
  }
}

private class AndroidJobFactory(private val context: Context, private val dir: File) : AppUpdateJobFactory {
  override val debugBuild: Boolean = BuildConfig.DEBUG
  override val testOrigin: String? = effectiveTestOrigin(BuildConfig.DEBUG, AppUpdateEndpoints.configured())
  override val sdkInt: Int = Build.VERSION.SDK_INT

  override fun opener(): HttpOpener = HttpUrlConnectionOpener()

  override fun sink(name: String): FileSink = UpdateFileSink(dir, File(dir, name))

  override fun installedFacts(): InstalledFacts = InstalledFacts { source ->
    val info = installedInfo(source)
    PackageFacts(info.packageName, PackageInfoCompat.getLongVersionCode(info), signersOf(info, source))
  }

  override fun archiveFacts(): ArchiveFacts = ArchiveFacts { path, source ->
    val info = archiveInfo(path, source)
    if (info == null) null else PackageFacts(info.packageName, PackageInfoCompat.getLongVersionCode(info), signersOf(info, source))
  }

  override fun installedSummary(): InstalledSummary {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    return InstalledSummary(PackageInfoCompat.getLongVersionCode(info), info.versionName ?: "")
  }

  override fun metered(): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    return manager.isActiveNetworkMetered
  }

  override fun usableSpace(): Long {
    dir.mkdirs()
    return dir.usableSpace
  }

  // The archive and the installed app are read with the same flags: the signing-info path needs
  // GET_SIGNING_CERTIFICATES, and API 29 returns no signing info for an archive unless GET_SIGNATURES
  // is set with it.
  @Suppress("DEPRECATION")
  private fun flags(source: SignerSource): Int = when (source) {
    SignerSource.LEGACY -> PackageManager.GET_SIGNATURES
    SignerSource.SIGNING_INFO -> PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES
  }

  @Suppress("DEPRECATION")
  private fun installedInfo(source: SignerSource): PackageInfo =
    context.packageManager.getPackageInfo(context.packageName, flags(source))

  @Suppress("DEPRECATION")
  private fun archiveInfo(path: String, source: SignerSource): PackageInfo? =
    context.packageManager.getPackageArchiveInfo(path, flags(source))

  // The signing set is apkContentsSigners from API 28 and the legacy signatures below it. A null field
  // is the empty set, which fails closed.
  @SuppressLint("NewApi")
  @Suppress("DEPRECATION")
  private fun signersOf(info: PackageInfo, source: SignerSource): Set<String> {
    val certificates: Array<Signature>? = when (source) {
      SignerSource.LEGACY -> info.signatures
      SignerSource.SIGNING_INFO -> info.signingInfo?.apkContentsSigners
    }
    return signerSet(certificates?.map { it.toByteArray() })
  }
}

private class UpdateFileSink(private val dir: File, private val file: File) : FileSink {
  override val path: String = file.absolutePath

  override fun output(): OutputStream {
    dir.mkdirs()
    return FileOutputStream(file)
  }

  override fun delete() {
    file.delete()
  }
}

// Identity encoding and no redirect following, so the policy sees every hop; the platform's default
// TLS verification is the only one, with no custom socket factory, trust manager or hostname verifier.
private class HttpUrlConnectionOpener : HttpOpener {
  override fun open(uri: URI): HttpHop {
    val connection = uri.toURL().openConnection() as HttpURLConnection
    try {
      connection.instanceFollowRedirects = false
      connection.connectTimeout = CONNECT_TIMEOUT_MS
      connection.readTimeout = READ_TIMEOUT_MS
      connection.setRequestProperty("Accept-Encoding", "identity")
      connection.setRequestProperty("User-Agent", USER_AGENT)
      val status = connection.responseCode
      return ConnectionHop(connection, status)
    } catch (error: Exception) {
      connection.disconnect()
      throw error
    }
  }
}

private class ConnectionHop(private val connection: HttpURLConnection, override val status: Int) : HttpHop {
  override val location: String? = connection.getHeaderField("Location")
  override val contentLength: Long = connection.contentLengthLong

  override fun body(): InputStream = connection.inputStream

  override fun close() {
    connection.disconnect()
  }
}
