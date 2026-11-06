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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun FeedbackScreen(state: FrameZooState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = LocalFrameZooColors.current
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var attachments by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var pending by remember { mutableStateOf(false) }
    var submitted by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { attachments = it }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(bottom = 32.dp)) {
        item { Text("Gửi phản hồi", color = colors["type.emphasis"], fontSize = 30.sp) }
        if (submitted) item { Text("Đã gửi phản hồi thành công", color = colors["type.emphasis"]) }
        else {
            item { OutlinedTextField(title, { title = it.take(255) }, label = { Text("Tiêu đề vấn đề") }, singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), colors = tvFieldColors(), modifier = Modifier.fillMaxWidth(.7f)) }
            item { OutlinedTextField(description, { description = it }, label = { Text("Mô tả vấn đề") }, minLines = 3,
                colors = tvFieldColors(), modifier = Modifier.fillMaxWidth(.7f)) }
            item { Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TvButton("Chọn ảnh hoặc video") { picker.launch(arrayOf("image/*", "video/*")) }
                if (attachments.isNotEmpty()) TvButton("Xóa ${attachments.size} file") { attachments = emptyList() }
            } }
            item { Text("Ảnh/video · tổng tối đa 55 MB", color = colors["type.secondary"]) }
            if (error.isNotBlank()) item { Text(error, color = colors["type.danger"]) }
            item { TvButton(if (pending) "Đang gửi..." else "Gửi phản hồi", primary = true) {
                if (!pending) scope.launch {
                    pending = true; error = ""
                    try { state.backend.feedback(title, description, attachments, context.contentResolver); submitted = true }
                    catch (e: CancellationException) { throw e } catch (e: Exception) { error = e.message ?: "Gửi phản hồi thất bại" }
                    finally { pending = false }
                }
            } }
        }
        item { TvButton("Quay lại") { state.back() } }
    }
}
