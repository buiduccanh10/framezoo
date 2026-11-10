package com.framezoo.tv.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R
import com.framezoo.tv.ui.features.feedback.FeedbackAction
import com.framezoo.tv.ui.features.feedback.FeedbackUiState
import kotlinx.coroutines.launch

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

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black.copy(alpha = 0.88f)),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .widthIn(min = 480.dp, max = 650.dp)
                .clip(RoundedCornerShape(22.dp))
                .background(colors["background.main"])
                .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(22.dp))
                .padding(horizontal = 32.dp, vertical = 26.dp)
        ) {
            if (uiState.isSuccess) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(68.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF10B981).copy(alpha = 0.2f))
                            .border(BorderStroke(1.5.dp, Color(0xFF10B981).copy(alpha = 0.4f)), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_checkmark),
                            contentDescription = null,
                            tint = Color(0xFF34D399),
                            modifier = Modifier.size(32.dp)
                        )
                    }

                    Text(
                        text = t("feedback.successTitle"),
                        color = Color.White,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center
                    )

                    Text(
                        text = t("feedback.successDesc"),
                        color = colors["type.secondary"],
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 16.dp)
                    )

                    Spacer(Modifier.height(8.dp))

                    TvButton(
                        label = t("feedback.close"),
                        accent = true
                    ) {
                        onAction(FeedbackAction.Reset)
                        onBack()
                    }
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    contentPadding = PaddingValues(vertical = 4.dp)
                ) {
                    // Header row: Title + Close Button
                    item {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = t("feedback.modalTitle"),
                                color = colors["type.emphasis"],
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold
                            )
                            HeaderButton(
                                icon = R.drawable.desktop_close,
                                label = t("feedback.close"),
                                selected = false
                            ) {
                                onBack()
                            }
                        }
                    }

                    // Subtitle description
                    item {
                        Text(
                            text = t("feedback.subtitle"),
                            color = colors["type.secondary"],
                            fontSize = 13.sp,
                            lineHeight = 18.sp
                        )
                    }

                    // Error Alert Banner
                    if (!uiState.errorMessage.isNullOrBlank()) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(colors["type.danger"].copy(alpha = 0.15f))
                                    .border(BorderStroke(1.dp, colors["type.danger"].copy(alpha = 0.35f)), RoundedCornerShape(10.dp))
                                    .padding(horizontal = 14.dp, vertical = 10.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Icon(
                                        painter = painterResource(R.drawable.desktop_warning),
                                        contentDescription = null,
                                        tint = colors["type.danger"],
                                        modifier = Modifier.size(18.dp)
                                    )
                                    Text(
                                        text = uiState.errorMessage,
                                        color = colors["type.danger"],
                                        fontSize = 13.sp
                                    )
                                }
                            }
                        }
                    }

                    // 1. Title Input
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    text = t("feedback.titleLabel"),
                                    color = colors["type.emphasis"],
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text("*", color = colors["type.danger"], fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                            OutlinedTextField(
                                value = uiState.title,
                                onValueChange = { onAction(FeedbackAction.TitleChanged(it)) },
                                placeholder = { Text(t("feedback.titlePlaceholder")) },
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                colors = tvFieldColors(),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }

                    // 2. Description Input
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(
                                    text = t("feedback.descriptionLabel"),
                                    color = colors["type.emphasis"],
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text("*", color = colors["type.danger"], fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                            OutlinedTextField(
                                value = uiState.description,
                                onValueChange = { onAction(FeedbackAction.DescriptionChanged(it)) },
                                placeholder = { Text(t("feedback.descriptionPlaceholder")) },
                                minLines = 3,
                                maxLines = 5,
                                colors = tvFieldColors(),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                    }

                    // 3. Attachments
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = t("feedback.attachmentsLabel"),
                                color = colors["type.emphasis"],
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                TvButton(
                                    label = if (uiState.attachments.isEmpty()) t("feedback.attachmentsLabel") else "${t("feedback.attachmentsLabel")} (${uiState.attachments.size})",
                                    icon = R.drawable.desktop_share
                                ) {
                                    picker.launch(arrayOf("image/*", "video/*"))
                                }
                                if (uiState.attachments.isNotEmpty()) {
                                    TvButton(t("actions.cancel")) {
                                        onAction(FeedbackAction.AttachmentsChanged(emptyList()))
                                    }
                                }
                            }
                            Text(
                                text = t("feedback.attachmentsHint"),
                                color = colors["type.secondary"],
                                fontSize = 12.sp
                            )
                        }
                    }

                    // 4. Action Buttons (Cancel & Submit)
                    item {
                        Spacer(Modifier.height(6.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.End
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                TvButton(
                                    label = t("feedback.cancel")
                                ) {
                                    onBack()
                                }
                                TvButton(
                                    label = t("feedback.submit"),
                                    accent = true,
                                    loading = uiState.isSubmitting
                                ) {
                                    onAction(FeedbackAction.Submit(context.contentResolver))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun FeedbackScreen(state: FrameZooState) {
    val scope = rememberCoroutineScope()
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var attachments by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var isSubmitting by remember { mutableStateOf(false) }
    var isSuccess by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

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
