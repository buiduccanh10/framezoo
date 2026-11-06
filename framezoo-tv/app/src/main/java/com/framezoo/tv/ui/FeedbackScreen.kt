package com.framezoo.tv.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R
import com.framezoo.tv.ui.features.feedback.FeedbackAction
import com.framezoo.tv.ui.features.feedback.FeedbackUiState

@Composable
internal fun FeedbackScreen(
    uiState: FeedbackUiState,
    onAction: (FeedbackAction) -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    val colors = LocalFrameZooColors.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        onAction(FeedbackAction.AttachmentsChanged(uris))
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(bottom = 32.dp)) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(t("feedback.modalTitle"), color = colors["type.emphasis"], fontSize = 30.sp)
                TvButton(
                    label = t("discover.page.back"),
                    icon = R.drawable.desktop_chevron_left,
                    navigation = true
                ) {
                    onBack()
                }
            }
        }
        if (uiState.isSuccess) {
            item {
                Text("${t("feedback.successTitle")}\n${t("feedback.successDesc")}", color = colors["type.emphasis"])
            }
        } else {
            item {
                OutlinedTextField(
                    value = uiState.title,
                    onValueChange = { onAction(FeedbackAction.TitleChanged(it)) },
                    label = { Text(t("feedback.titleLabel")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    colors = tvFieldColors(),
                    modifier = Modifier.fillMaxWidth(.7f)
                )
            }
            item {
                OutlinedTextField(
                    value = uiState.description,
                    onValueChange = { onAction(FeedbackAction.DescriptionChanged(it)) },
                    label = { Text(t("feedback.descriptionLabel")) },
                    minLines = 3,
                    colors = tvFieldColors(),
                    modifier = Modifier.fillMaxWidth(.7f)
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TvButton(t("feedback.attachmentsLabel")) { picker.launch(arrayOf("image/*", "video/*")) }
                    if (uiState.attachments.isNotEmpty()) {
                        TvButton("${t("actions.cancel")} (${uiState.attachments.size})") {
                            onAction(FeedbackAction.AttachmentsChanged(emptyList()))
                        }
                    }
                }
            }
            item { Text(t("feedback.attachmentsHint"), color = colors["type.secondary"]) }
            if (!uiState.errorMessage.isNullOrBlank()) {
                item { Text(uiState.errorMessage, color = colors["type.danger"]) }
            }
            item {
                TvButton(t("feedback.submit"), primary = true, loading = uiState.isSubmitting) {
                    onAction(FeedbackAction.Submit(context.contentResolver))
                }
            }
        }
        item { TvButton(t("feedback.close")) { onBack() } }
    }
}

@Composable
internal fun FeedbackScreen(state: FrameZooState) {
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    var title by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }
    var description by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }
    var attachments by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<List<Uri>>(emptyList()) }
    var isSubmitting by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    var isSuccess by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    var errorMessage by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<String?>(null) }

    FeedbackScreen(
        uiState = FeedbackUiState(
            title = title,
            description = description,
            attachments = attachments,
            isSubmitting = isSubmitting,
            isSuccess = isSuccess,
            errorMessage = errorMessage
        ),
        onAction = { action ->
            when (action) {
                is FeedbackAction.TitleChanged -> title = action.value
                is FeedbackAction.DescriptionChanged -> description = action.value
                is FeedbackAction.AttachmentsChanged -> attachments = action.uris
                is FeedbackAction.Reset -> { title = ""; description = ""; attachments = emptyList(); isSuccess = false }
                is FeedbackAction.Submit -> {
                    scope.launch {
                        isSubmitting = true
                        errorMessage = null
                        try {
                            state.backend.feedback(title, description, attachments, action.resolver)
                            isSuccess = true
                        } catch (e: Exception) {
                            errorMessage = e.message ?: state.i18n.t("feedback.errorSubmit")
                        } finally {
                            isSubmitting = false
                        }
                    }
                }
            }
        },
        onBack = { state.back() }
    )
}
