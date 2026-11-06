package com.framezoo.tv.ui.navigation

import com.framezoo.tv.model.Episode
import com.framezoo.tv.model.Media
import com.framezoo.tv.model.Stream
import com.framezoo.tv.model.Subtitle
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface NavRoute {
    data object Discover : NavRoute
    data class Details(val media: Media) : NavRoute
    data object Search : NavRoute
    data object Bookmarks : NavRoute
    data object History : NavRoute
    data object Settings : NavRoute
    data object Addons : NavRoute
    data object Feedback : NavRoute
    data object Login : NavRoute
    data class Sources(val media: Media, val episode: Episode?) : NavRoute
    data class Player(
        val media: Media,
        val episode: Episode?,
        val stream: Stream,
        val subtitles: List<Subtitle>
    ) : NavRoute
    data class Trailer(val key: String, val title: String) : NavRoute
    data class DiscoverMore(val title: String, val section: String) : NavRoute
    data object DiscoverLists : NavRoute
}

class TvNavigator {
    private val backStack = mutableListOf<NavRoute>(NavRoute.Discover)

    private val _currentRoute = MutableStateFlow<NavRoute>(NavRoute.Discover)
    val currentRoute: StateFlow<NavRoute> = _currentRoute.asStateFlow()

    fun navigateTo(route: NavRoute) {
        if (_currentRoute.value == route) return
        backStack.add(route)
        _currentRoute.value = route
    }

    fun popBack(): Boolean {
        if (backStack.size > 1) {
            backStack.removeAt(backStack.lastIndex)
            _currentRoute.value = backStack.last()
            return true
        }
        return false
    }

    fun navigateAndClear(route: NavRoute) {
        backStack.clear()
        backStack.add(route)
        _currentRoute.value = route
    }
}
