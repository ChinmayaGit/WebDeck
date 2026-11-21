package com.webdeck.launcher.webdeck

import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterFragmentActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "webdeck/shortcuts").setMethodCallHandler { call, result ->
            when (call.method) {
                "supported" -> result.success(pinSupported())
                "pin" -> {
                    val id = call.argument<String>("id")
                    val label = call.argument<String>("label")
                    val icon = call.argument<ByteArray>("icon")
                    if (id == null || label == null) {
                        result.error("bad_request", "id and label are required", null)
                    } else {
                        result.success(pin(id, label, icon))
                    }
                }
                "moveToBack" -> result.success(moveTaskToBack(true))
                else -> result.notImplemented()
            }
        }
    }

    private fun pinSupported(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return getSystemService(ShortcutManager::class.java)?.isRequestPinShortcutSupported == true
    }

    private fun pin(id: String, label: String, iconBytes: ByteArray?): Boolean {
        if (!pinSupported()) return false
        val manager = getSystemService(ShortcutManager::class.java) ?: return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("webdeck://open/" + Uri.encode(id)), this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val builder = ShortcutInfo.Builder(this, "app-$id")
            .setShortLabel(label.take(24))
            .setLongLabel(label.take(60))
            .setIntent(intent)
        val bitmap = iconBytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
        if (bitmap != null) builder.setIcon(Icon.createWithBitmap(bitmap))
        else builder.setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
        return manager.requestPinShortcut(builder.build(), null)
    }
}
