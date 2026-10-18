package com.hermespos.pos.printer

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Bluetooth Classic (RFCOMM / SPP) bridge for ESC/POS thermal printers.
 *
 * All socket work runs on ONE background thread so that concurrent JS calls
 * never interleave bytes on the same printer.
 */
class HermesPosBluetoothPrinterModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val sockets = ConcurrentHashMap<String, BluetoothSocket>()
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName() = "HermesPosBluetoothPrinter"

  override fun invalidate() {
    super.invalidate()
    executor.execute { sockets.keys.toList().forEach { closeQuietly(it) } }
    executor.shutdown()
  }

  // ---------------------------------------------------------------- helpers

  private fun bluetoothAdapter(): BluetoothAdapter? {
    val manager = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  private fun hasConnectPermission(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      ContextCompat.checkSelfPermission(reactContext, Manifest.permission.BLUETOOTH_CONNECT) ==
      PackageManager.PERMISSION_GRANTED

  /** Returns an error message (Indonesian, shown to the cashier) or null when OK. */
  private fun precondition(): String? {
    val adapter = bluetoothAdapter() ?: return "Perangkat ini tidak mendukung Bluetooth."
    if (!hasConnectPermission()) return "Izin Bluetooth (Nearby devices) belum diberikan untuk HERMES POS."
    if (!adapter.isEnabled) return "Bluetooth sedang mati. Aktifkan Bluetooth lalu coba lagi."
    return null
  }

  private fun closeQuietly(address: String) {
    val socket = sockets.remove(address) ?: return
    try { socket.close() } catch (_: Exception) { }
  }

  private fun openSocket(device: BluetoothDevice): BluetoothSocket {
    // 1) Standard SPP socket.
    try {
      val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
      socket.connect()
      return socket
    } catch (first: Exception) {
      // 2) Many cheap thermal printers only accept the insecure/fallback channel 1.
      try {
        val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
        val socket = method.invoke(device, 1) as BluetoothSocket
        socket.connect()
        return socket
      } catch (_: Exception) {
        throw first
      }
    }
  }

  private fun ensureConnected(address: String): BluetoothSocket {
    sockets[address]?.let { if (it.isConnected) return it else closeQuietly(address) }

    val adapter = bluetoothAdapter() ?: throw IOException("Bluetooth tidak tersedia.")
    if (!BluetoothAdapter.checkBluetoothAddress(address)) {
      throw IOException("Alamat printer tidak valid: $address")
    }
    val device = adapter.getRemoteDevice(address)
    try {
      @Suppress("MissingPermission")
      adapter.cancelDiscovery()
    } catch (_: SecurityException) { }

    val socket = try {
      openSocket(device)
    } catch (e: Exception) {
      throw IOException("Tidak dapat terhubung ke printer. Pastikan printer menyala, berada dekat, dan tidak sedang dipakai perangkat lain.", e)
    }
    sockets[address] = socket
    return socket
  }

  private fun writeAll(address: String, data: ByteArray) {
    val progress = IntArray(1) // bytes already sent, survives a mid-write exception
    try {
      writeChunks(ensureConnected(address), data, progress)
    } catch (e: IOException) {
      closeQuietly(address)
      // A stale cached socket fails on the very first write: reconnect and retry once.
      // Never retry after bytes were already sent, otherwise the receipt would print twice.
      if (progress[0] > 0) throw IOException("Koneksi printer terputus saat mencetak.", e)
      try {
        writeChunks(ensureConnected(address), data, progress)
      } catch (e2: IOException) {
        closeQuietly(address)
        throw IOException(e2.message ?: "Printer tidak menerima data. Periksa kertas dan koneksi printer.", e2)
      }
    }
  }

  private fun writeChunks(socket: BluetoothSocket, data: ByteArray, progress: IntArray) {
    val out = socket.outputStream
    var offset = 0
    while (offset < data.size) {
      val len = minOf(CHUNK_SIZE, data.size - offset)
      out.write(data, offset, len)
      out.flush()
      offset += len
      progress[0] = offset
      // Small printers have tiny buffers; pacing prevents garbled / dropped output.
      if (offset < data.size) Thread.sleep(CHUNK_DELAY_MS)
    }
  }

  private fun runAsync(promise: Promise, block: () -> Unit) {
    executor.execute {
      try {
        block()
      } catch (e: Exception) {
        promise.reject("E_PRINTER", e.message ?: "Printer gagal menerima perintah.", e)
      }
    }
  }

  // ------------------------------------------------------------ JS-exposed

  @ReactMethod
  fun getBluetoothState(promise: Promise) {
    val adapter = bluetoothAdapter()
    val map = Arguments.createMap()
    map.putBoolean("available", adapter != null)
    map.putBoolean("enabled", adapter?.isEnabled == true)
    map.putBoolean("canReadPaired", hasConnectPermission())
    promise.resolve(map)
  }

  @ReactMethod
  fun getPairedDevices(promise: Promise) {
    precondition()?.let { promise.reject("E_BLUETOOTH", it); return }
    try {
      @Suppress("MissingPermission")
      val bonded = bluetoothAdapter()!!.bondedDevices ?: emptySet()
      val array = Arguments.createArray()
      bonded.sortedBy { (it.name ?: "").lowercase() }.forEach { device ->
        val map = Arguments.createMap()
        map.putString("name", device.name ?: "Bluetooth Printer")
        map.putString("address", device.address)
        array.pushMap(map)
      }
      promise.resolve(array)
    } catch (e: SecurityException) {
      promise.reject("E_BLUETOOTH", "Izin Bluetooth (Nearby devices) belum diberikan untuk HERMES POS.", e)
    }
  }

  @ReactMethod
  fun connect(address: String, promise: Promise) {
    precondition()?.let { promise.reject("E_BLUETOOTH", it); return }
    runAsync(promise) {
      ensureConnected(address)
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun disconnect(address: String, promise: Promise) {
    executor.execute {
      closeQuietly(address)
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun writeBase64(address: String, data: String, promise: Promise) {
    precondition()?.let { promise.reject("E_BLUETOOTH", it); return }
    runAsync(promise) {
      val bytes = Base64.decode(data, Base64.DEFAULT)
      writeAll(address, bytes)
      promise.resolve(null)
    }
  }

  companion object {
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private const val CHUNK_SIZE = 512
    private const val CHUNK_DELAY_MS = 30L
  }
}
