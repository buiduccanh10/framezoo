package com.framezoo.tv.ui.features.watchparty

/**
 * User actions for Watch Party Join Dialog.
 * Conforms to MVI/MVVM design pattern.
 */
sealed interface WatchPartyAction {
    data object Open : WatchPartyAction
    data object Close : WatchPartyAction
    data class CodeChanged(val newCode: String) : WatchPartyAction
    data object Submit : WatchPartyAction
}
