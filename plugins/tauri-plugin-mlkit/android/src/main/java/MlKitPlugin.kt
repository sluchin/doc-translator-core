/*
 * Copyright (c) 2026 Tetsuya Higashi
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

package jp.sluchin.zephyrdoc.mlkit

import android.app.Activity
import android.util.Log
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
import java.util.concurrent.TimeUnit

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

    private companion object {
        /** ログのタグ (`adb logcat -s MlKitPlugin`). */
        const val TAG = "MlKitPlugin"

        /** 1 つの文章の翻訳を待つ時間の上限 (秒). */
        const val TEXT_TIMEOUT_S = 60L
    }

    /** 翻訳のクライアント (止まったときは、作り直すので、`var`). */
    private var translator: Translator? = null

    /** 翻訳のクライアントを返す (なければ作る). */
    private fun client(): Translator =
        translator
            ?: Translation
                .getClient(
                    TranslatorOptions
                        .Builder()
                        .setSourceLanguage(TranslateLanguage.ENGLISH)
                        .setTargetLanguage(TranslateLanguage.JAPANESE)
                        .build(),
                ).also { translator = it }

    /**
     * 1 つの文章を翻訳する. 時間切れ (止まったとき) や失敗のときは、クライアントを作り直して、
     * 元の文章を返す (ほかの文章の翻訳を、止めない).
     */
    private fun translateOne(text: String): String =
        try {
            Tasks.await(client().translate(text), TEXT_TIMEOUT_S, TimeUnit.SECONDS)
        } catch (e: Exception) {
            Log.e(TAG, "Skip a text of ${text.length} characters", e)
            translator?.close()
            translator = null
            text
        }

    /** 文章を翻訳する (モデルの取得と翻訳は、別のスレッドで待つ). */
    @Command
    fun translate(invoke: Invoke) {
        val args = invoke.parseArgs(TranslateArgs::class.java)
        executor.execute {
            try {
                Log.d(TAG, "Download the model if needed, then translate ${args.texts.size} texts")
                Tasks.await(client().downloadModelIfNeeded(DownloadConditions.Builder().build()))
                val texts = JSArray()
                args.texts.forEach { texts.put(translateOne(it)) }
                invoke.resolve(JSObject().apply { put("texts", texts) })
            } catch (e: Exception) {
                // 原因が分かるよう、例外の種類 (ExecutionException の中の原因も) と、メッセージを返す
                val cause = e.cause ?: e
                Log.e(TAG, "Translation failed", e)
                invoke.reject("${cause.javaClass.simpleName}: ${cause.message ?: "no message"}")
            }
        }
    }
}
