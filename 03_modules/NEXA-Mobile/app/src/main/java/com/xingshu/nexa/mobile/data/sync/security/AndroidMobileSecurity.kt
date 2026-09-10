package com.xingshu.nexa.mobile.data.sync.security

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredential
import com.xingshu.nexa.mobile.domain.sync.security.DeviceCredentialStore
import com.xingshu.nexa.mobile.domain.sync.security.DeviceId
import com.xingshu.nexa.mobile.domain.sync.security.DeviceIdentityPersistence
import com.xingshu.nexa.mobile.domain.sync.security.StableInstallationDeviceIdentityProvider
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Arrays
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class AndroidMobileSecurityComponents(
    val deviceIdentityProvider: StableInstallationDeviceIdentityProvider,
    val credentialStore: DeviceCredentialStore,
)

object AndroidMobileSecurityFactory {
    fun create(context: Context): AndroidMobileSecurityComponents {
        val applicationContext = context.applicationContext
        return AndroidMobileSecurityComponents(
            deviceIdentityProvider = StableInstallationDeviceIdentityProvider(
                SharedPreferencesDeviceIdentityPersistence(
                    applicationContext.getSharedPreferences(IDENTITY_PREFERENCES, Context.MODE_PRIVATE),
                ),
            ),
            credentialStore = AndroidKeystoreDeviceCredentialStore(
                applicationContext.getSharedPreferences(CREDENTIAL_PREFERENCES, Context.MODE_PRIVATE),
            ),
        )
    }

    private const val IDENTITY_PREFERENCES = "nexa.mobile.installation_identity.v1"
    private const val CREDENTIAL_PREFERENCES = "nexa.mobile.secure_device_credentials.v1"
}

internal class SharedPreferencesDeviceIdentityPersistence(
    private val preferences: SharedPreferences,
) : DeviceIdentityPersistence {
    override fun read(): String? = preferences.getString(DEVICE_ID_KEY, null)

    override fun write(deviceId: String) {
        check(preferences.edit().putString(DEVICE_ID_KEY, deviceId).commit()) {
            "Unable to persist installation device identity"
        }
    }

    private companion object {
        const val DEVICE_ID_KEY = "device_id"
    }
}

class AndroidKeystoreDeviceCredentialStore(
    private val preferences: SharedPreferences,
) : DeviceCredentialStore {
    override suspend fun credentialFor(deviceId: DeviceId): DeviceCredential? =
        withContext(Dispatchers.IO) {
            val encoded = preferences.getString(preferenceKey(deviceId), null) ?: return@withContext null
            val blob = Base64.getDecoder().decode(encoded)
            require(blob.size > HEADER_SIZE) { "Invalid encrypted credential blob" }
            val buffer = ByteBuffer.wrap(blob)
            require(buffer.get() == FORMAT_VERSION) { "Unsupported credential blob version" }
            val iv = ByteArray(IV_SIZE).also(buffer::get)
            val encrypted = ByteArray(buffer.remaining()).also(buffer::get)
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(TAG_BITS, iv))
            cipher.updateAAD(deviceId.value.toByteArray(StandardCharsets.UTF_8))
            val plaintext = cipher.doFinal(encrypted)
            try {
                DeviceCredential.fromBytes(plaintext)
            } finally {
                Arrays.fill(plaintext, 0)
            }
        }

    override suspend fun store(deviceId: DeviceId, credential: DeviceCredential) {
        withContext(Dispatchers.IO) {
            val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, masterKey())
            cipher.updateAAD(deviceId.value.toByteArray(StandardCharsets.UTF_8))
            val encrypted = credential.useBytes(cipher::doFinal)
            val blob = ByteBuffer.allocate(HEADER_SIZE + encrypted.size)
                .put(FORMAT_VERSION)
                .put(cipher.iv)
                .put(encrypted)
                .array()
            val encoded = Base64.getEncoder().encodeToString(blob)
            check(preferences.edit().putString(preferenceKey(deviceId), encoded).commit()) {
                "Unable to persist encrypted device credential"
            }
        }
    }

    override suspend fun remove(deviceId: DeviceId) {
        withContext(Dispatchers.IO) {
            check(preferences.edit().remove(preferenceKey(deviceId)).commit()) {
                "Unable to remove encrypted device credential"
            }
        }
    }

    private fun masterKey(): SecretKey = synchronized(keyLock) {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey) ?: KeyGenerator
            .getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build(),
                )
            }
            .generateKey()
    }

    private fun preferenceKey(deviceId: DeviceId): String = MessageDigest.getInstance("SHA-256")
        .digest(deviceId.value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "nexa.mobile.per_device_credential.v1"
        const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
        const val IV_SIZE = 12
        const val HEADER_SIZE = 1 + IV_SIZE
        const val FORMAT_VERSION: Byte = 1
        val keyLock = Any()
    }
}
