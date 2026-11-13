package com.framezoo.tv.ui.features.feedback

import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.framezoo.tv.data.repository.FeedbackRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class FeedbackUiState(
    val title: String = "",
    val contact: String = "",
    val requireContact: Boolean = false,
    val description: String = "",
    val attachments: List<Uri> = emptyList(),
    val isSubmitting: Boolean = false,
    val isSuccess: Boolean = false,
    val errorMessage: String? = null
)

sealed interface FeedbackAction {
    data class TitleChanged(val value: String) : FeedbackAction
    data class ContactChanged(val value: String) : FeedbackAction
    data class DescriptionChanged(val value: String) : FeedbackAction
    data class AttachmentsChanged(val uris: List<Uri>) : FeedbackAction
    data class Submit(val resolver: ContentResolver) : FeedbackAction
    data object Reset : FeedbackAction
}

class FeedbackViewModel(
    private val repo: FeedbackRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(FeedbackUiState())
    val uiState: StateFlow<FeedbackUiState> = _uiState.asStateFlow()

    fun onAction(action: FeedbackAction) {
        when (action) {
            is FeedbackAction.TitleChanged -> _uiState.update { it.copy(title = action.value.take(255)) }
            is FeedbackAction.ContactChanged -> _uiState.update { it.copy(contact = action.value.take(255)) }
            is FeedbackAction.DescriptionChanged -> _uiState.update { it.copy(description = action.value) }
            is FeedbackAction.AttachmentsChanged -> _uiState.update { it.copy(attachments = action.uris) }
            is FeedbackAction.Reset -> _uiState.value = FeedbackUiState(requireContact = _uiState.value.requireContact)
            is FeedbackAction.Submit -> submit(action.resolver)
        }
    }

    private fun submit(resolver: ContentResolver) {
        val current = _uiState.value
        if (current.isSubmitting) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            try {
                repo.submitFeedback(
                    current.title,
                    current.description,
                    current.attachments,
                    resolver,
                    current.contact.takeIf { current.requireContact }
                )
                _uiState.update { it.copy(isSubmitting = false, isSuccess = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { it.copy(isSubmitting = false, errorMessage = e.message ?: "Failed to submit feedback") }
            }
        }
    }

    companion object {
        fun provideFactory(repo: FeedbackRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return FeedbackViewModel(repo) as T
                }
            }
    }
}
