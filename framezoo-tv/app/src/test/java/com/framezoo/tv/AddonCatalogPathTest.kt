package com.framezoo.tv

import com.framezoo.tv.api.addonCatalogPath
import org.junit.Assert.assertEquals
import org.junit.Test

class AddonCatalogPathTest {
    @Test fun preservesCatalogAndSkipInProtocolPath() {
        assertEquals("catalog/series/top%20rated.json", addonCatalogPath("series", "top rated", 0))
        assertEquals("catalog/series/top%20rated/skip=50.json", addonCatalogPath("series", "top rated", 50))
    }
}
