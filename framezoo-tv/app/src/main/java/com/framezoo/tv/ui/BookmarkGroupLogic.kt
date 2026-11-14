package com.framezoo.tv.ui

import com.framezoo.tv.model.BookmarkDetails
import com.framezoo.tv.model.UserIcon

private val GROUP_PREFIX_REGEX = Regex("^\\[([a-zA-Z0-9_]+)](.*)$")

internal val BOOKMARK_GROUP_ICONS: List<UserIcon> = UserIcon.CLASSIC_ICONS

internal data class ParsedBookmarkGroup(
    val iconKey: String,
    val icon: UserIcon,
    val name: String,
)

internal fun parseBookmarkGroup(group: String): ParsedBookmarkGroup {
    val match = GROUP_PREFIX_REGEX.matchEntire(group.trim())
    if (match != null) {
        val rawIconKey = match.groupValues[1]
        val icon = UserIcon.fromKey(rawIconKey).takeUnless { it == UserIcon.DEFAULT } ?: UserIcon.BOOKMARK
        val name = match.groupValues[2].trim()
        return ParsedBookmarkGroup(icon.key, icon, name.ifEmpty { group })
    }
    return ParsedBookmarkGroup(UserIcon.BOOKMARK.key, UserIcon.BOOKMARK, group.trim())
}

internal fun formatBookmarkGroup(icon: UserIcon, name: String): String {
    val clean = name.trim()
    if (clean.isEmpty()) return ""
    return "[${icon.key.uppercase()}]$clean"
}

internal fun mergeAndOrderBookmarkGroups(
    savedOrder: List<String>,
    details: List<BookmarkDetails>
): List<String> {
    val active = details.flatMap { it.groups }.filter { it.isNotBlank() }.distinct()
    if (savedOrder.isEmpty()) return active
    val orderIndex = savedOrder.withIndex().associate { (idx, value) -> value to idx }
    return active.sortedWith(compareBy<String> { orderIndex[it] ?: Int.MAX_VALUE })
}

internal fun computeBookmarkGroupRename(
    details: List<BookmarkDetails>,
    groupOrder: List<String>,
    oldGroup: String,
    newGroup: String
): Pair<List<BookmarkDetails>, List<String>> {
    val cleanNew = newGroup.trim()
    if (cleanNew.isBlank() || oldGroup == cleanNew) return emptyList<BookmarkDetails>() to groupOrder
    val changed = details.mapNotNull { entry ->
        if (oldGroup !in entry.groups) null
        else entry.copy(groups = entry.groups.map { if (it == oldGroup) cleanNew else it }.distinct())
    }
    val nextOrder = groupOrder.map { if (it == oldGroup) cleanNew else it }.distinct()
    return changed to nextOrder
}

internal fun computeBookmarkGroupDelete(
    details: List<BookmarkDetails>,
    groupOrder: List<String>,
    targetGroup: String
): Pair<List<BookmarkDetails>, List<String>> {
    val changed = details.mapNotNull { entry ->
        if (targetGroup !in entry.groups) null
        else entry.copy(groups = entry.groups.filterNot { it == targetGroup })
    }
    val nextOrder = groupOrder.filterNot { it == targetGroup }
    return changed to nextOrder
}

internal fun <T> moveListItem(items: List<T>, fromIndex: Int, toIndex: Int): List<T> {
    if (fromIndex !in items.indices || toIndex !in items.indices || fromIndex == toIndex) return items
    val mutable = items.toMutableList()
    val moved = mutable.removeAt(fromIndex)
    mutable.add(toIndex, moved)
    return mutable
}

internal val DEFAULT_HOME_SECTION_ORDER: List<String> = listOf(
    "trending",
    "popular",
    "provider",
    "top",
    "editor",
    "latest",
    "personal",
    "recommendations",
    "genre",
    "addons"
)

private val DESKTOP_SECTION_ALIASES = mapOf(
    "providers" to "provider",
    "top-rated" to "top",
    "editor-picks" to "editor",
    "for-you" to "personal",
    "genres" to "genre"
)

internal fun normalizeHomeSectionOrder(rawOrder: List<String>): List<String> {
    val mapped = rawOrder.mapNotNull { key ->
        val clean = key.trim()
        if (clean.isEmpty()) return@mapNotNull null
        DESKTOP_SECTION_ALIASES[clean] ?: clean
    }.distinct()
    val knownOrAddon = mapped.filter { it in DEFAULT_HOME_SECTION_ORDER || it.startsWith("addon:") }
    val missingDefaults = DEFAULT_HOME_SECTION_ORDER.filterNot { it in knownOrAddon }
    return knownOrAddon + missingDefaults
}
