package com.framezoo.tv.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.framezoo.tv.R

@Composable
internal fun AuthScreen(state: FrameZooState) {
    val colors = LocalFrameZooColors.current
    val passwordRequester = remember { FocusRequester() }
    val loginAction = remember { FocusRequester() }
    val backRequester = remember { FocusRequester() }

    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = if (state.store.userId == null) t("auth.login.submit") else t("settings.account.title"),
                style = MaterialTheme.typography.headlineLarge,
                color = colors["type.emphasis"]
            )
            TvButton(
                label = t("discover.page.back"),
                icon = R.drawable.desktop_chevron_left,
                navigation = true,
                modifier = Modifier.focusRequester(backRequester)
            ) {
                state.back()
            }
        }

        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .width(480.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(colors["background.secondary"].copy(alpha = 0.6f))
                    .border(BorderStroke(1.dp, colors["authentication.border"]), RoundedCornerShape(20.dp))
                    .padding(32.dp)
            ) {
                if (state.store.userId != null) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Image(
                            painter = painterResource(R.drawable.framezoo_brand),
                            contentDescription = "FrameZoo",
                            modifier = Modifier.width(160.dp).height(46.dp)
                        )
                        Text(
                            text = state.store.userId ?: "",
                            color = colors["type.emphasis"],
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold
                        )
                        TvButton(
                            label = t("navigation.menu.logout")
                        ) {
                            state.logout()
                        }
                    }
                } else {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Image(
                            painter = painterResource(R.drawable.framezoo_brand),
                            contentDescription = "FrameZoo",
                            modifier = Modifier.width(160.dp).height(46.dp).align(Alignment.CenterHorizontally)
                        )

                        OutlinedTextField(
                            value = state.loginName,
                            onValueChange = { state.loginName = it },
                            label = { Text(t("auth.login.identifierLabel")) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                            keyboardActions = KeyboardActions(onNext = { passwordRequester.requestFocus() }),
                            colors = tvFieldColors(),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        )

                        OutlinedTextField(
                            value = state.loginPassword,
                            onValueChange = { state.loginPassword = it },
                            label = { Text(t("auth.login.passwordLabel")) },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { loginAction.requestFocus() }),
                            colors = tvFieldColors(),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth().focusRequester(passwordRequester)
                        )

                        TvButton(
                            label = t("auth.login.submit"),
                            primary = true,
                            modifier = Modifier.fillMaxWidth().focusRequester(loginAction)
                        ) {
                            state.login()
                        }
                    }
                }
            }
        }
    }
}
