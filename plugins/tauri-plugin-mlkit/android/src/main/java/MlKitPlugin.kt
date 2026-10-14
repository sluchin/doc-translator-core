/*
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

package jp.sluchin.zephyrdoc.mlkit

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import java.util.concurrent.Executors

/** `translate` の引数. */
@InvokeArg
class TranslateArgs {
    /** 翻訳する文章 (英語のテキスト). */
    lateinit var texts: Array<String>
}

/**
 * ML Kit のオンデバイス翻訳 (英語から日本語).
 *
 * 初めて使うときに、翻訳のモデル (約 30 MB) をダウンロードする. 2 回目からは、通信しない.
 */
@TauriPlugin
class MlKitPlugin(
    activity: Activity,
) : Plugin(activity) {
    private val executor = Executors.newSingleThreadExecutor()

    private val translator: Translator by lazy {
        Translation.getClient(
            TranslatorOptions
                .Builder()
                .setSourceLanguage(TranslateLanguage.ENGLISH)
                .setTargetLanguage(TranslateLanguage.JAPANESE)
                .build(),
        )
    }

    /** 文章を翻訳する (モデルの取得と翻訳は、別のスレッドで待つ). */
    @Command
    fun translate(invoke: Invoke) {
        val args = invoke.parseArgs(TranslateArgs::class.java)
        executor.execute {
            try {
                Tasks.await(translator.downloadModelIfNeeded(DownloadConditions.Builder().build()))
                val texts = JSArray()
                args.texts.forEach { texts.put(Tasks.await(translator.translate(it))) }
                invoke.resolve(JSObject().apply { put("texts", texts) })
            } catch (e: Exception) {
                invoke.reject(e.message ?: e.javaClass.simpleName)
            }
        }
    }
}
