package com.framezoo.tv.ui.features.account

/**
 * User actions emitted by the Header Account Button and Dropdown Menu.
 * Conforms to MVI/MVVM design pattern.
 */
sealed interface AccountMenuAction {
    data object ToggleMenu : AccountMenuAction
    data object OpenMenu : AccountMenuAction
    data object CloseMenu : AccountMenuAction

    // Navigation and Intent actions
    data object SelectProfile : AccountMenuAction
    data object SelectLogin : AccountMenuAction
    data object SelectHistory : AccountMenuAction
    data object SelectBookmarks : AccountMenuAction
    data object SelectAddons : AccountMenuAction
    data object SelectWatchParty : AccountMenuAction
    data object SelectFeedback : AccountMenuAction
    data object SelectSettings : AccountMenuAction
    data object SelectLogout : AccountMenuAction
}
