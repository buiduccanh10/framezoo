package com.framezoo.tv

import com.framezoo.tv.model.UserIcon
import com.framezoo.tv.ui.features.account.AccountMenuAction
import com.framezoo.tv.ui.features.account.AccountMenuViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountMenuViewModelTest {

    @Test
    fun testInitialState() {
        val vm = AccountMenuViewModel()
        val state = vm.uiState.value
        assertFalse(state.isLoggedIn)
        assertFalse(state.isExpanded)
        assertEquals("", state.displayName)
    }

    @Test
    fun testUpdateAccount() {
        val vm = AccountMenuViewModel()
        vm.updateAccount(
            isLoggedIn = true,
            nickname = "SuperUser",
            colorA = "#123456",
            colorB = "#654321",
            icon = "pleading_face",
            userId = "user_123"
        )

        val state = vm.uiState.value
        assertTrue(state.isLoggedIn)
        assertEquals("SuperUser", state.displayName)
        assertEquals(UserIcon.PLEADING_FACE, state.profile.icon)
        assertEquals("#123456", state.profile.colorA)
        assertEquals("#654321", state.profile.colorB)
    }

    @Test
    fun testMenuToggleAndActions() {
        val vm = AccountMenuViewModel()
        assertFalse(vm.uiState.value.isExpanded)

        vm.handleAction(
            action = AccountMenuAction.ToggleMenu,
            onNavigate = {},
            onOpenLogin = {},
            onOpenProtected = {},
            onOpenWatchParty = {},
            onOpenFeedback = {},
            onLogout = {}
        )
        assertTrue(vm.uiState.value.isExpanded)

        var navigatedTo = ""
        vm.handleAction(
            action = AccountMenuAction.SelectSettings,
            onNavigate = { navigatedTo = it },
            onOpenLogin = {},
            onOpenProtected = {},
            onOpenWatchParty = {},
            onOpenFeedback = {},
            onLogout = {}
        )
        assertFalse(vm.uiState.value.isExpanded)
        assertEquals("settings", navigatedTo)
    }

    @Test
    fun testProtectedRoutesHandling() {
        val vm = AccountMenuViewModel()
        var protectedExecuted = false

        vm.handleAction(
            action = AccountMenuAction.SelectHistory,
            onNavigate = {},
            onOpenLogin = {},
            onOpenProtected = { action ->
                protectedExecuted = true
                action()
            },
            onOpenWatchParty = {},
            onOpenFeedback = {},
            onLogout = {}
        )
        assertTrue(protectedExecuted)
    }
}
