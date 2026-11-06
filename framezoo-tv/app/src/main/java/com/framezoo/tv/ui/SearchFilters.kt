package com.framezoo.tv.ui

import com.framezoo.tv.model.Media

internal fun filterSearchResults(items: List<Media>, country: String, year: String, genre: String): List<Media> =
    items.filter { (country.isBlank() || country in it.originCountries) &&
        (year.isBlank() || year == it.year) && (genre.isBlank() || genre in it.genreIds) }
