package com.guance.vehicledemo

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

class BrokerSettings(val endpoint: String, val username: String, val password: String) {
    val uri: URI get() = URI(endpoint)
    override fun toString() = "BrokerSettings(credentials=redacted)"
    companion object {
        const val DEFAULT_ENDPOINT = "wss://35.241.68.75.nip.io/vehicle-mqtt"
        fun resolve(endpoint: String, username: String, password: String, previous: BrokerSettings?): BrokerSettings {
            val address = endpoint.trim()
            val user = username.trim()
            val secret = if (password.isNotEmpty()) password else {
                require(previous != null && previous.endpoint == address && previous.username == user) {
                    "更改地址或用户名时需要重新输入密码"
                }
                previous.password
            }
            validate(address, user, secret)
            return BrokerSettings(address, user, secret)
        }
        fun validate(endpoint: String, username: String, password: String) {
            val uri = URI(endpoint)
            require(uri.scheme == "wss" && !uri.host.isNullOrBlank() && uri.userInfo == null &&
                uri.fragment == null && uri.query == null && uri.port in -1..65535 && uri.port != 0) {
                "请输入有效的 WSS 地址，不能包含用户名、查询参数或片段"
            }
            require(username.matches(Regex("[a-zA-Z0-9_.-]{1,80}"))) { "用户名格式不正确" }
            require(password.length in 12..256) { "密码长度需要在 12–256 个字符之间" }
        }
    }
}

class SettingsVault(context: Context) {
    private val prefs = context.getSharedPreferences("broker_vault", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("vehicle-mqtt", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("vehicle-mqtt", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }

    fun read(): BrokerSettings? {
        val encoded = prefs.getString("ciphertext", null) ?: return null
        val iv = requireNotNull(prefs.getString("iv", null))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        val json = JSONObject(String(cipher.doFinal(Base64.decode(encoded, Base64.NO_WRAP)), Charsets.UTF_8))
        return BrokerSettings(json.getString("endpoint"), json.getString("username"), json.getString("password"))
    }

    fun save(settings: BrokerSettings) {
        BrokerSettings.validate(settings.endpoint, settings.username, settings.password)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val json = JSONObject().put("endpoint", settings.endpoint).put("username", settings.username)
            .put("password", settings.password).toString().toByteArray(Charsets.UTF_8)
        val bytes = cipher.doFinal(json)
        check(prefs.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("ciphertext", Base64.encodeToString(bytes, Base64.NO_WRAP)).commit())
    }
}
