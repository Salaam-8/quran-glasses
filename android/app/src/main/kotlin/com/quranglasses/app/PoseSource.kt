package com.quranglasses.app

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock

/**
 * The device's own orientation as a quaternion [w, x, y, z], about 20 times a second.
 * GAME_ROTATION_VECTOR (gyro + accelerometer, no magnetometer) is preferred: it does not drift
 * near metal or speakers, and the posture logic only needs the head tilt, not the compass heading.
 */
class PoseSource(context: Context, private val onPose: (Float, Float, Float, Float) -> Unit) : SensorEventListener {
    private val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val sensor: Sensor? = sm.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
        ?: sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private val q = FloatArray(4)
    private var last = 0L

    val present: Boolean get() = sensor != null

    fun start() { sensor?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) } }
    fun stop() { sm.unregisterListener(this) }

    override fun onSensorChanged(e: SensorEvent) {
        val now = SystemClock.uptimeMillis()
        if (now - last < 50) return
        last = now
        SensorManager.getQuaternionFromVector(q, e.values)   // q = [w, x, y, z]
        onPose(q[0], q[1], q[2], q[3])
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
