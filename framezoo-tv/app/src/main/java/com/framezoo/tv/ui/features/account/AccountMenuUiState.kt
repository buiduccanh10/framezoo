package com.framezoo.tv.ui.features.account

import com.framezoo.tv.model.AccountProfile

/**
 * UI State for the Header Account Button and Dropdown Menu.
 * Pure immutable state holder conforming to MVI/MVVM design system.
 */
data class AccountMenuUiState(
    val isLoggedIn: Boolean = false,
    val profile: AccountProfile = AccountProfile(),
    val isExpanded: Boolean = false,
    val isOffline: Boolean = false
) {
    /**
     * Resolves display name: truncated nickname/device name if logged in, empty otherwise.
     */
    val displayName: String
        get() = if (isLoggedIn) profile.displayName() else ""
}
