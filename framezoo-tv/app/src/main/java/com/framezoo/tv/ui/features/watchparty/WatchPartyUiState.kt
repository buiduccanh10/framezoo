package com.framezoo.tv.ui.features.watchparty

/**
 * UI State for Watch Party Join Dialog.
 * Pure immutable state holder conforming to MVI/MVVM design system.
 */
data class WatchPartyUiState(
    val isOpen: Boolean = false,
    val codeInput: String = "",
    val isLoading: Boolean = false,
    val errorMessage: String? = null
) {
    val canSubmit: Boolean
        get() = codeInput.isNotBlank() && !isLoading
}
