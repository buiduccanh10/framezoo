package com.framezoo.tv.data.repository

import android.content.ContentResolver
import android.net.Uri
import com.framezoo.tv.api.Backend

class FeedbackRepository(
    private val backend: Backend
) {
    suspend fun submitFeedback(title: String, description: String, attachments: List<Uri>, resolver: ContentResolver) {
        backend.feedback(title, description, attachments, resolver)
    }
}
