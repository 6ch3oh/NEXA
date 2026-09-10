package com.xingshu.nexa.mobile.data.local

import android.content.Context
import androidx.room.Room

object NexaDatabaseFactory {
    private const val DATABASE_NAME = "nexa-mobile.db"

    @Volatile
    private var instance: NexaDatabase? = null

    fun create(context: Context): NexaDatabase = instance ?: synchronized(this) {
        instance ?: Room.databaseBuilder(
            context.applicationContext,
            NexaDatabase::class.java,
            DATABASE_NAME,
        )
            .addMigrations(
                NexaDatabaseMigrations.MIGRATION_1_2,
                NexaDatabaseMigrations.MIGRATION_2_3,
                NexaDatabaseMigrations.MIGRATION_3_4,
                NexaDatabaseMigrations.MIGRATION_4_5,
            )
            .build()
            .also { instance = it }
    }
}
