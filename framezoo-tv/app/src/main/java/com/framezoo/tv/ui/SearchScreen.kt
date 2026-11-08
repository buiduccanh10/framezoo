package com.framezoo.tv.ui

import android.graphics.BitmapFactory
import android.view.KeyEvent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items as rowItems
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border as TvBorder
import androidx.tv.material3.ClickableSurfaceDefaults as TvSurfaceDefaults
import androidx.tv.material3.IconButton as TvIconButton
import androidx.tv.material3.IconButtonDefaults as TvIconButtonDefaults
import androidx.tv.material3.Surface as TvSurface
import com.framezoo.tv.MainActivity
import com.framezoo.tv.R
import com.framezoo.tv.model.DiscoverOption
import com.framezoo.tv.model.Media
import com.framezoo.tv.ui.features.search.SearchAction
import com.framezoo.tv.ui.features.search.SearchUiState
import kotlinx.coroutines.launch
import java.time.Year
import java.util.Calendar

internal fun getTimeOfDayKey(): String {
    val cal = Calendar.getInstance()
    val hour = cal.get(Calendar.HOUR_OF_DAY)
    val month = cal.get(Calendar.MONTH) + 1
    val day = cal.get(Calendar.DAY_OF_MONTH)
    val time = when {
        month == 4 && day == 20 -> "420"
        month == 6 && day == 9 -> "69"
        month == 10 && day == 31 -> "halloween"
        hour < 5 -> "night"
        hour < 12 -> "morning"
        hour < 19 -> "day"
        else -> "night"
    }
    return "home.titles.$time"
}

internal data class DesktopParticleConfig(
    val drawableId: Int,
    val minSize: Float,
    val maxSize: Float
)

internal data class DesktopParticleTheme(
    val particles: List<DesktopParticleConfig>,
    val horizontalMotion: Boolean = false
)

/**
 * Resolves particle assets matching Desktop Lightbar.tsx switch-case dates and probabilities.
 */
internal fun resolveDesktopParticleTheme(cal: Calendar = Calendar.getInstance()): DesktopParticleTheme {
    val month = cal.get(Calendar.MONTH) // 0-based: 0=Jan, 9=Oct, 11=Dec
    val day = cal.get(Calendar.DAY_OF_MONTH)
    val rand = Math.random()

    return when {
        // Christmas (Dec 24-26) or 5.1% chance
        (month == 11 && day in 24..26) || rand < 0.051 -> {
            DesktopParticleTheme(
                particles = listOf(DesktopParticleConfig(R.drawable.lightbar_santa, 28f, 38f))
            )
        }
        // Halloween (Oct 31) - 95% chance
        month == 9 && day == 31 && Math.random() < 0.95 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_ghost, 22f, 34f),
                    DesktopParticleConfig(R.drawable.lightbar_pumpkin, 26f, 36f)
                )
            )
        }
        // October - 25% chance
        month == 9 && Math.random() < 0.25 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_ghost, 22f, 34f),
                    DesktopParticleConfig(R.drawable.lightbar_pumpkin, 26f, 36f)
                )
            )
        }
        // Sea (10% chance)
        rand < 0.10 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_fishie, 14f, 18f),
                    DesktopParticleConfig(R.drawable.lightbar_shark, 48f, 58f)
                ),
                horizontalMotion = true
            )
        }
        // 420 (Apr 20)
        month + 1 == 4 && day == 20 -> {
            DesktopParticleTheme(
                particles = listOf(DesktopParticleConfig(R.drawable.lightbar_weed, 32f, 40f))
            )
        }
        // 69 (Jun 9)
        month + 1 == 6 && day == 9 -> {
            DesktopParticleTheme(
                particles = listOf(DesktopParticleConfig(R.drawable.lightbar_wine, 16f, 36f))
            )
        }
        // Cat (20% chance)
        rand < 0.20 -> {
            DesktopParticleTheme(
                particles = listOf(DesktopParticleConfig(R.drawable.lightbar_cat, 30f, 38f))
            )
        }
        // Cinema (30% chance)
        rand < 0.30 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_camera, 24f, 32f),
                    DesktopParticleConfig(R.drawable.lightbar_popcorn, 20f, 28f)
                )
            )
        }
        // Farm (8% chance)
        rand < 0.08 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_cock, 25f, 32f),
                    DesktopParticleConfig(R.drawable.lightbar_egg, 18f, 24f),
                    DesktopParticleConfig(R.drawable.lightbar_barn, 32f, 38f)
                )
            )
        }
        // Money / Heist (6% chance)
        rand < 0.06 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_money_sack, 24f, 32f),
                    DesktopParticleConfig(R.drawable.lightbar_money, 16f, 24f),
                    DesktopParticleConfig(R.drawable.lightbar_coin, 10f, 20f)
                )
            )
        }
        // Pirate / Ship (7.5% chance)
        rand < 0.075 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_skull, 20f, 28f),
                    DesktopParticleConfig(R.drawable.lightbar_ship, 24f, 28f)
                )
            )
        }
        // Dev (3% chance)
        rand < 0.03 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_ts, 22f, 32f),
                    DesktopParticleConfig(R.drawable.lightbar_git, 22f, 28f)
                )
            )
        }
        // Chill / Drinks (70% chance) - beer, beer-bottle, wine
        rand < 0.70 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_beer, 20f, 36f),
                    DesktopParticleConfig(R.drawable.lightbar_beer_bottle, 16f, 38f),
                    DesktopParticleConfig(R.drawable.lightbar_wine, 18f, 36f)
                )
            )
        }
        // Action / Gun (5% chance)
        rand < 0.05 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_auto_gun, 28f, 36f),
                    DesktopParticleConfig(R.drawable.lightbar_gun, 24f, 30f)
                )
            )
        }
        // Star (15% chance)
        rand < 0.15 -> {
            DesktopParticleTheme(
                particles = listOf(
                    DesktopParticleConfig(R.drawable.lightbar_star, 20f, 30f)
                )
            )
        }
        else -> DesktopParticleTheme(particles = emptyList())
    }
}

/**
 * Desktop-matching LightbarBackground with top ambient glow and animated particles.
 * Faithfully reproduces Desktop Lightbar.tsx and Lightbar.css without artificial manual selectors.
 */
@Composable
internal fun LightbarBackground(
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val theme = remember { resolveDesktopParticleTheme() }

    // Decode bitmaps from drawables once for the automatically resolved theme
    val bitmaps = remember(theme) {
        theme.particles.mapNotNull { config ->
            try {
                val bmp = BitmapFactory.decodeResource(context.resources, config.drawableId)
                if (bmp != null) config to bmp.asImageBitmap() else null
            } catch (_: Exception) {
                null
            }
        }
    }

    val infiniteTransition = rememberInfiniteTransition(label = "lightbar_time")
    val animTime by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(14000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "animTime"
    )

    // Precomputed particle configs: image particles + ambient dot particles
    val particles = remember(theme, bitmaps) {
        val totalCount = 60
        val imageCount = if (bitmaps.isNotEmpty()) 24 else 0
        List(totalCount) { i ->
            val rand = java.util.Random(i.toLong() * 997L + 42L)
            val isImg = i < imageCount
            val configPair = if (isImg) bitmaps[rand.nextInt(bitmaps.size)] else null
            val (minS, maxS) = configPair?.first?.let { it.minSize to it.maxSize } ?: (2.5f to 5f)
            val size = minS + rand.nextFloat() * (maxS - minS)
            val direction = if (theme.horizontalMotion) {
                if (rand.nextBoolean()) 0f else Math.PI.toFloat()
            } else {
                (Math.PI.toFloat() / 4f) + rand.nextFloat() * (Math.PI.toFloat() / 2f)
            }
            val speed = 0.5f + rand.nextFloat() * 0.5f
            val phase = rand.nextFloat()
            val startXFraction = 0.22f + rand.nextFloat() * 0.56f
            val startYFraction = rand.nextFloat() * 0.18f
            val drift = (rand.nextFloat() - 0.5f) * 60f

            RuntimeParticle(
                startXFraction = startXFraction,
                startYFraction = startYFraction,
                speed = speed,
                phase = phase,
                size = size,
                direction = direction,
                drift = drift,
                isImage = isImg,
                bitmap = configPair?.second,
                horizontalMotion = theme.horizontalMotion
            )
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(500.dp)
    ) {
        // Desktop Lightbar visual glow & Canvas particles
        Canvas(modifier = Modifier.fillMaxSize()) {
            val w = size.width
            val h = size.height

            // 1. Broad ambient ember atmospheric glow
            drawRect(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Color(0x38350104),
                        Color(0x181F0002),
                        Color.Transparent
                    ),
                    center = androidx.compose.ui.geometry.Offset(w / 2f, 60.dp.toPx()),
                    radius = w * 0.55f
                )
            )

            // 2. Focused core crimson/ember arc
            drawRect(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Color(0xDD660006),
                        Color(0x99480004),
                        Color(0x55280002),
                        Color(0x15120001),
                        Color.Transparent
                    ),
                    center = androidx.compose.ui.geometry.Offset(w / 2f, -10.dp.toPx()),
                    radius = w * 0.38f
                )
            )

            // 3. Trapezoidal soft fan expanding downward
            val fanPath = androidx.compose.ui.graphics.Path().apply {
                moveTo(w * 0.32f, 0f)
                lineTo(w * 0.68f, 0f)
                lineTo(w * 0.88f, h * 0.85f)
                lineTo(w * 0.12f, h * 0.85f)
                close()
            }
            drawPath(
                path = fanPath,
                brush = Brush.verticalGradient(
                    colors = listOf(
                        Color(0x444A0005),
                        Color(0x22240003),
                        Color.Transparent
                    ),
                    startY = 0f,
                    endY = h * 0.85f
                )
            )

            // 4. Render particles drifting downward
            particles.forEach { p ->
                val progress = (animTime * p.speed + p.phase) % 1f
                val y = (p.startYFraction * h) + progress * (h * 0.85f)
                val x = (p.startXFraction * w) + kotlin.math.sin(progress * kotlin.math.PI * 2f).toFloat() * p.drift
                val bell = (progress * (1f - progress) * 4f).coerceIn(0f, 1f)
                val alpha = bell * 0.85f

                if (p.isImage && p.bitmap != null) {
                    val bmp = p.bitmap
                    val drawW = p.size
                    val drawH = (bmp.height.toFloat() / bmp.width.toFloat()) * drawW
                    val rotationDeg = Math.toDegrees((p.direction - Math.PI).toDouble()).toFloat()

                    withTransform({
                        translate(left = x, top = y)
                        if (p.horizontalMotion) {
                            scale(scaleX = if (p.direction == Math.PI.toFloat()) 1f else -1f, scaleY = 1f, pivot = androidx.compose.ui.geometry.Offset.Zero)
                        } else {
                            rotate(degrees = rotationDeg, pivot = androidx.compose.ui.geometry.Offset.Zero)
                        }
                    }) {
                        drawImage(
                            image = bmp,
                            dstOffset = IntOffset((-drawW / 2f).toInt(), (-drawH / 2f).toInt()),
                            dstSize = IntSize(drawW.toInt(), drawH.toInt()),
                            alpha = alpha
                        )
                    }
                } else {
                    drawCircle(
                        color = Color.White.copy(alpha = alpha * 0.65f),
                        radius = p.size,
                        center = androidx.compose.ui.geometry.Offset(x, y)
                    )
                }
            }
        }
    }
}

private data class RuntimeParticle(
    val startXFraction: Float,
    val startYFraction: Float,
    val speed: Float,
    val phase: Float,
    val size: Float,
    val direction: Float,
    val drift: Float,
    val isImage: Boolean,
    val bitmap: androidx.compose.ui.graphics.ImageBitmap?,
    val horizontalMotion: Boolean
)

/**
 * Desktop-matching IconPatch circular button badge.
 */
@Composable
internal fun IconPatch(
    icon: Int,
    contentColor: Color,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 48.dp,
    iconSize: androidx.compose.ui.unit.Dp = 22.dp,
    backgroundColor: Color = LocalFrameZooColors.current["pill.background"]
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(backgroundColor),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            painter = painterResource(icon),
            contentDescription = null,
            tint = contentColor,
            modifier = Modifier.size(iconSize)
        )
    }
}

/**
 * Desktop-matching Pill Search Bar (SearchBarInput.tsx).
 * Features animated blinking cursor, clear button, and reliable DPAD key handling.
 */
@Composable
internal fun TvSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onDown: (() -> Boolean)? = null,
    onUp: (() -> Boolean)? = null,
    onFocusChanged: ((Boolean) -> Unit)? = null,
    modifier: Modifier = Modifier,
    placeholder: String = t("home.search.placeholder.default"),
    textFieldFocusRequester: FocusRequester? = null
) {
    val colors = LocalFrameZooColors.current
    val focusManager = LocalFocusManager.current
    var isFocused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(28.dp)
    val background by animateColorAsState(
        if (isFocused) colors["search.focused"] else colors["search.background"],
        tween(250),
        label = "searchBarBg"
    )
    val borderColor by animateColorAsState(
        if (isFocused) colors["type.logo"] else Color.White.copy(alpha = 0.12f),
        tween(250),
        label = "searchBarBorder"
    )

    // Animated blinking cursor for the placeholder, matching Desktop
    val infiniteTransition = rememberInfiniteTransition(label = "search_cursor")
    val cursorAlpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = 1000
                1f at 0
                1f at 500
                0f at 501
                0f at 1000
            },
            repeatMode = RepeatMode.Restart
        ),
        label = "cursorAlpha"
    )

    val scale by animateFloatAsState(if (isFocused) 1.03f else 1f, tween(200), label = "searchScale")

    Surface(
        shape = shape,
        color = background,
        border = BorderStroke(if (isFocused) 2.5.dp else 1.dp, if (isFocused) Color.White else borderColor),
        modifier = modifier
            .fillMaxWidth()
            .height(52.dp)
            .scale(scale)
            .clip(shape)
            .onPreviewKeyEvent { event ->
                val nativeEvent = event.nativeKeyEvent
                if (nativeEvent.action == KeyEvent.ACTION_DOWN) {
                    when (nativeEvent.keyCode) {
                        KeyEvent.KEYCODE_DPAD_DOWN -> {
                            if (onDown != null && onDown()) true
                            else focusManager.moveFocus(FocusDirection.Down)
                        }
                        KeyEvent.KEYCODE_DPAD_UP -> {
                            if (onUp != null && onUp()) true
                            else focusManager.moveFocus(FocusDirection.Up)
                        }
                        else -> false
                    }
                } else false
            }
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                painter = painterResource(R.drawable.desktop_search),
                contentDescription = null,
                tint = if (isFocused) colors["type.logo"] else colors["search.icon"],
                modifier = Modifier.size(22.dp)
            )

            Spacer(Modifier.width(14.dp))

            Box(
                modifier = Modifier.weight(1f),
                contentAlignment = Alignment.CenterStart
            ) {
                if (query.isEmpty()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .width(2.dp)
                                .height(18.dp)
                                .background(Color.White.copy(alpha = cursorAlpha))
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = placeholder,
                            color = colors["search.placeholder"],
                            fontSize = 16.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                BasicTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    singleLine = true,
                    textStyle = TextStyle(
                        color = colors["search.text"],
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Normal
                    ),
                    cursorBrush = SolidColor(colors["type.logo"]),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(if (textFieldFocusRequester != null) Modifier.focusRequester(textFieldFocusRequester) else Modifier)
                        .onFocusChanged {
                            isFocused = it.isFocused
                            onFocusChanged?.invoke(it.isFocused)
                        }
                        .onPreviewKeyEvent { event ->
                            val nativeEvent = event.nativeKeyEvent
                            if (nativeEvent.action == KeyEvent.ACTION_DOWN) {
                                when (nativeEvent.keyCode) {
                                    KeyEvent.KEYCODE_DPAD_DOWN -> {
                                        if (onDown != null && onDown()) true
                                        else focusManager.moveFocus(FocusDirection.Down)
                                    }
                                    KeyEvent.KEYCODE_DPAD_UP -> {
                                        if (onUp != null && onUp()) true
                                            else focusManager.moveFocus(FocusDirection.Up)
                                    }
                                    else -> false
                                }
                            } else false
                        }
                )
            }

            if (query.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                TvIconButton(
                    onClick = { onQueryChange("") },
                    modifier = Modifier.size(34.dp),
                    colors = TvIconButtonDefaults.colors(
                        containerColor = colors["pill.background"].copy(alpha = 0.6f),
                        focusedContainerColor = colors["type.logo"]
                    ),
                    scale = TvIconButtonDefaults.scale(focusedScale = 1.08f),
                    border = TvIconButtonDefaults.border(focusedBorder = TvBorder(BorderStroke(2.dp, Color.White), shape = CircleShape)),
                    shape = TvIconButtonDefaults.shape(CircleShape)
                ) {
                    Icon(
                        painter = painterResource(R.drawable.desktop_close),
                        contentDescription = "Clear",
                        tint = Color.White,
                        modifier = Modifier.size(14.dp)
                    )
                }
            }
        }
    }
}

/**
 * Desktop-matching Genre Filter Chip (rounded-full pill button).
 */
@Composable
internal fun GenreFilterChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val colors = LocalFrameZooColors.current
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(50)
    val background by animateColorAsState(
        if (selected) colors["type.logo"]
        else if (focused) colors["pill.activeBackground"]
        else colors["pill.background"].copy(alpha = 0.65f),
        tween(200),
        label = "chipBg"
    )
    val textColor = if (selected || focused) Color.White else colors["type.secondary"]

    TvSurface(
        onClick = onClick,
        shape = TvSurfaceDefaults.shape(shape),
        colors = TvSurfaceDefaults.colors(
            containerColor = background,
            focusedContainerColor = if (selected) colors["type.logo"] else colors["pill.activeBackground"]
        ),
        scale = TvSurfaceDefaults.scale(focusedScale = 1.05f),
        border = TvSurfaceDefaults.border(
            focusedBorder = TvBorder(
                BorderStroke(2.dp, if (selected) Color.White else colors["type.logo"]),
                shape = shape
            )
        ),
        modifier = modifier.height(36.dp).onFocusChanged { focused = it.isFocused }
    ) {
        Box(
            modifier = Modifier.padding(horizontal = 16.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = label,
                color = textColor,
                fontSize = 13.sp,
                fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium
            )
        }
    }
}

/**
 * Desktop-matching Dropdown Filter Pill for Country / Year.
 */
@Composable
internal fun DropdownFilterPill(
    label: String,
    selectedId: String,
    options: List<DiscoverOption>,
    modifier: Modifier = Modifier,
    onSelect: (String) -> Unit
) {
    val colors = LocalFrameZooColors.current
    val allLabel = t("discover.tabs.all")
    var expanded by remember { mutableStateOf(false) }
    val selectedName = options.firstOrNull { it.id == selectedId }?.name
    val displayText = if (selectedId.isNotBlank() && selectedName != null) "$label: $selectedName" else label
    val isSelected = selectedId.isNotBlank()
    val focusBorderColor = if (isSelected) Color.White else colors["type.logo"]

    Box(modifier) {
        TvSurface(
            onClick = { expanded = true },
            shape = TvSurfaceDefaults.shape(RoundedCornerShape(50)),
            colors = TvSurfaceDefaults.colors(
                containerColor = colors["mediaCard.hoverBackground"],
                focusedContainerColor = colors["pill.activeBackground"]
            ),
            scale = TvSurfaceDefaults.scale(focusedScale = 1.05f),
            border = TvSurfaceDefaults.border(
                focusedBorder = TvBorder(BorderStroke(2.dp, focusBorderColor), shape = RoundedCornerShape(50))
            ),
            modifier = Modifier.height(36.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = displayText,
                    color = colors["type.secondary"],
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Icon(
                    painter = painterResource(R.drawable.desktop_up_down_arrow),
                    contentDescription = null,
                    tint = colors["dropdown.secondary"],
                    modifier = Modifier.size(11.dp)
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier
                .heightIn(max = 350.dp)
                .background(colors["pill.background"])
        ) {
            TvButton(
                label = "$allLabel $label",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
                navigation = true
            ) {
                onSelect("")
                expanded = false
            }
            options.forEach { option ->
                TvButton(
                    label = option.name,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
                    navigation = true,
                    selected = option.id == selectedId
                ) {
                    onSelect(option.id)
                    expanded = false
                }
            }
        }
    }
}

/**
 * ViewModel-based SearchScreen for backwards compatibility and tests.
 */
@Composable
internal fun SearchScreen(
    uiState: SearchUiState,
    onAction: (SearchAction) -> Unit,
    onOpenMedia: (Media) -> Unit,
    isBookmarked: (String) -> Boolean = { false },
    onToggleBookmark: (Media) -> Unit = {},
    qualityLoader: (suspend (Media) -> String?)? = null,
    onNavigateDiscover: () -> Unit = {},
    onBack: () -> Unit,
    gridState: LazyGridState,
    searchAction: FocusRequester,
    inputModifier: Modifier = Modifier
) {
    val colors = LocalFrameZooColors.current
    val genreIds = remember(uiState.results) { uiState.results.flatMap { it.genreIds }.toSet() }
    val genres = remember(uiState.genres, genreIds) { uiState.genres.filter { it.id in genreIds } }
    val filtered = uiState.filteredResults
    val timeGreetingKey = remember { getTimeOfDayKey() }
    val i18n = LocalI18n.current
    val heroTitle = remember(timeGreetingKey, i18n) { i18n.randomT(timeGreetingKey) }
    val heroPlaceholder = remember(i18n) { i18n.randomT("home.search.placeholder") }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(174.dp),
        state = gridState,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        contentPadding = PaddingValues(start = 4.dp, end = 4.dp, top = 6.dp, bottom = 48.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(if (uiState.query.isBlank()) 10.dp else 18.dp)
            ) {
                if (uiState.query.isBlank()) {
                    Text(
                        text = heroTitle,
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 28.sp
                        ),
                        color = Color.White,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp)
                    )
                }

                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    TvSearchBar(
                        query = uiState.query,
                        placeholder = heroPlaceholder,
                        onQueryChange = { onAction(SearchAction.QueryChanged(it)) },
                        onSearch = { onAction(SearchAction.ExecuteSearch) },
                        modifier = Modifier
                            .fillMaxWidth(if (uiState.query.isBlank()) 0.72f else 1f)
                            .then(inputModifier)
                    )
                }

                if (uiState.query.isNotBlank()) {
                    Spacer(Modifier.height(6.dp))

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(
                            painter = painterResource(R.drawable.desktop_search),
                            contentDescription = null,
                            tint = colors["type.logo"],
                            modifier = Modifier.size(20.dp)
                        )
                        Text(
                            text = t("home.search.sectionTitle").uppercase(),
                            color = colors["type.emphasis"],
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                            letterSpacing = 1.sp
                        )
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .focusRequester(searchAction),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        LazyRow(
                            modifier = Modifier.weight(1f),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            item {
                                GenreFilterChip(
                                    label = t("home.search.genreFilterAll"),
                                    selected = uiState.selectedGenre.isBlank(),
                                    onClick = { onAction(SearchAction.GenreChanged("")) }
                                )
                            }
                            rowItems(genres, key = { it.id }) { genre ->
                                GenreFilterChip(
                                    label = genre.name,
                                    selected = uiState.selectedGenre == genre.id,
                                    onClick = { onAction(SearchAction.GenreChanged(genre.id)) }
                                )
                            }
                        }

                        Box(
                            modifier = Modifier
                                .padding(horizontal = 12.dp)
                                .width(1.dp)
                                .height(22.dp)
                                .background(Color.White.copy(alpha = 0.15f))
                        )

                        if (uiState.countries.isNotEmpty()) {
                            DropdownFilterPill(
                                label = t("discover.filters.country"),
                                selectedId = uiState.selectedCountry,
                                options = uiState.countries
                            ) {
                                onAction(SearchAction.CountryChanged(it))
                            }
                            Spacer(Modifier.width(8.dp))
                        }

                        DropdownFilterPill(
                            label = t("home.bookmarks.edit.yearLabel"),
                            selectedId = uiState.selectedYear,
                            options = (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) }
                        ) {
                            onAction(SearchAction.YearChanged(it))
                        }
                    }
                }

                if (uiState.isLoading) {
                    Row(
                        modifier = Modifier.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(
                            color = colors["type.logo"],
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp
                        )
                        Text(
                            text = t("home.search.loading"),
                            color = colors["type.secondary"],
                            fontSize = 14.sp
                        )
                    }
                }

                if (!uiState.errorMessage.isNullOrBlank()) {
                    Row(
                        modifier = Modifier.padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(uiState.errorMessage, color = colors["type.danger"], fontSize = 14.sp)
                        TvButton(t("notFound.reloadButton")) { onAction(SearchAction.ExecuteSearch) }
                    }
                }
            }
        }

        if (uiState.isLoading && filtered.isEmpty() && uiState.query.isNotBlank()) {
            items(12) {
                TvMediaCardSkeleton()
            }
        } else if (uiState.query.isNotBlank()) {
            items(filtered, key = { "${it.type}:${it.id}:${it.addonManifest}" }) { item ->
                TvMediaCard(
                    item = item,
                    onOpen = { onOpenMedia(item) },
                    bookmarked = isBookmarked(item.id),
                    onBookmark = { onToggleBookmark(item) },
                    qualityLoader = qualityLoader
                )
            }
        }

        if (!uiState.isLoading && uiState.query.isNotBlank()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 36.dp, bottom = 20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    if (filtered.isNotEmpty()) {
                        Text(
                            text = t("home.search.allResults"),
                            color = colors["type.dimmed"],
                            fontSize = 16.sp
                        )
                        TvSurface(
                            onClick = onNavigateDiscover,
                            shape = TvSurfaceDefaults.shape(RoundedCornerShape(12.dp)),
                            colors = TvSurfaceDefaults.colors(
                                containerColor = colors["largeCard.background"],
                                focusedContainerColor = colors["pill.activeBackground"]
                            ),
                            scale = TvSurfaceDefaults.scale(focusedScale = 1.05f),
                            border = TvSurfaceDefaults.border(
                                focusedBorder = TvBorder(BorderStroke(2.dp, colors["type.logo"]), shape = RoundedCornerShape(12.dp))
                            ),
                            modifier = Modifier.height(42.dp)
                        ) {
                            Box(
                                modifier = Modifier.padding(horizontal = 24.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = t("home.search.discoverMore"),
                                    color = colors["type.dimmed"],
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    } else if (uiState.errorMessage.isNullOrBlank()) {
                        IconPatch(
                            icon = R.drawable.desktop_eye_slash,
                            contentColor = colors["type.logo"],
                            size = 54.dp,
                            iconSize = 26.dp
                        )
                        Text(
                            text = t("home.search.noResults"),
                            color = colors["type.secondary"],
                            fontSize = 16.sp
                        )
                    } else {
                        IconPatch(
                            icon = R.drawable.desktop_warning,
                            contentColor = colors["type.danger"],
                            size = 54.dp,
                            iconSize = 26.dp
                        )
                        Text(
                            text = t("home.search.failed"),
                            color = colors["type.danger"],
                            fontSize = 16.sp
                        )
                        Spacer(Modifier.height(4.dp))
                        TvButton(
                            label = t("notFound.reloadButton"),
                            primary = true
                        ) {
                            onAction(SearchAction.ExecuteSearch)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Full Desktop-matching SearchScreen on FrameZooState.
 * When query is empty: Renders Lightbar background, Hero Title, centered Search Bar,
 * Continue Watching carousel, complete Category Bar (DiscoverNavigation), and full Discover Content Rows.
 * When query is entered: Switches to Sticky Search Bar, Results Heading, Genre filters, and Search Result Grid.
 * Complete 2-way DPAD navigation between search bar, filter chips, and grid items.
 */
@Composable
internal fun SearchScreen(
    state: FrameZooState,
    searchListState: LazyListState,
    searchGridState: LazyGridState,
    searchAction: FocusRequester,
    inputModifier: Modifier = Modifier
) {
    val colors = LocalFrameZooColors.current
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var editingWatching by remember { mutableStateOf(false) }
    var watchingSortBy by remember { mutableStateOf("date") }

    val categoryFocus = remember { FocusRequester() }
    val continueWatchingFocus = remember { FocusRequester() }
    val filterAllFocus = remember { FocusRequester() }
    val searchInputFocus = searchAction

    val tabAll = t("discover.tabs.all")
    val tabSeries = t("discover.tabs.tvshows")
    val tabMovie = t("discover.tabs.movies")
    val filterCountryLabel = t("discover.filters.country")
    val filterYearLabel = t("home.bookmarks.edit.yearLabel")
    val retryLabel = t("notFound.reloadButton")
    val titleGenres = t("discover.carousel.title.genres")
    val titleTrending = t("discover.carousel.title.trending")
    val titlePopular = t("discover.carousel.title.popular")
    val titleProvider = t("discover.carousel.title.providers")
    val titleTopRated = t("discover.carousel.title.topRated")
    val titleEditorPicks = t("discover.carousel.title.editorPicks")
    val titleNewReleases = t("discover.carousel.title.latestReleases")
    val titleForYou = t("discover.carousel.title.forYou")
    val titleBasedOn = t("discover.carousel.title.recommendations")

    val genreIds = remember(state.results) { state.results.flatMap { it.genreIds }.toSet() }
    val genres = remember(state.genres, genreIds) { state.genres.filter { it.id in genreIds } }
    val filtered = filterSearchResults(state.results, state.searchCountry, state.searchYear, state.searchGenre)
    val timeGreetingKey = remember { getTimeOfDayKey() }
    val i18n = LocalI18n.current
    val heroTitle = remember(timeGreetingKey, i18n) { i18n.randomT(timeGreetingKey) }
    val heroPlaceholder = remember(i18n) { i18n.randomT("home.search.placeholder") }

    val continueWatching = remember(state.progress, watchingSortBy) {
        val filteredItems = state.progress.filter { it.duration > 0 && it.position > 0 && (it.position / it.duration) < 0.95 }
        when (watchingSortBy) {
            "titleAsc" -> filteredItems.sortedBy { it.media.title.lowercase() }
            "titleDesc" -> filteredItems.sortedByDescending { it.media.title.lowercase() }
            "yearAsc" -> filteredItems.sortedBy { it.media.year.toIntOrNull() ?: 0 }
            "yearDesc" -> filteredItems.sortedByDescending { it.media.year.toIntOrNull() ?: 0 }
            else -> filteredItems
        }
    }

    val isQueryActive = state.query.isNotBlank()
    var searchBarFocused by remember { mutableStateOf(false) }

    // Synchronize activity.moveDownFromText so hardware remote key events directly move focus downwards
    val context = LocalContext.current
    val activity = remember(context) {
        var ctx = context
        while (ctx is android.content.ContextWrapper) {
            if (ctx is MainActivity) return@remember ctx
            ctx = ctx.baseContext
        }
        ctx as? MainActivity
    }

    fun moveDownFromSearch(): Boolean {
        if (!searchBarFocused) return false
        val imm = context.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager
        val token = activity?.window?.decorView?.windowToken
        if (token != null && imm != null) {
            imm.hideSoftInputFromWindow(token, 0)
        }
        focusManager.clearFocus(force = true)
        val targetRequester = if (isQueryActive) {
            filterAllFocus
        } else if (continueWatching.isNotEmpty()) {
            continueWatchingFocus
        } else {
            categoryFocus
        }
        try {
            targetRequester.requestFocus()
            return true
        } catch (_: Exception) {}
        return focusManager.moveFocus(FocusDirection.Down)
    }

    DisposableEffect(activity, isQueryActive) {
        if (activity != null) {
            activity.moveDownFromText = {
                moveDownFromSearch()
            }
        }
        onDispose {
            if (activity != null) {
                activity.moveDownFromText = null
            }
        }
    }

    LaunchedEffect(isQueryActive) {
        kotlinx.coroutines.delay(100)
        try {
            searchInputFocus.requestFocus()
        } catch (_: Exception) {}
    }

    LaunchedEffect(state.query) {
        kotlinx.coroutines.delay(300)
        if (state.query.trim() != state.searchedQuery) state.search()
    }

    if (!isQueryActive) {
        Box(Modifier.fillMaxSize()) {
            LightbarBackground(
                modifier = Modifier.align(Alignment.TopCenter)
            )

            LazyColumn(
                state = searchListState,
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(26.dp),
                contentPadding = PaddingValues(top = 80.dp, bottom = 48.dp)
            ) {
                // Hero greeting and search input matching Desktop HomePage.tsx
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 16.dp, bottom = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(20.dp)
                    ) {
                        Text(
                            text = heroTitle,
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 32.sp
                            ),
                            color = Color.White,
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 24.dp)
                        )

                        TvSearchBar(
                            query = state.query,
                            placeholder = heroPlaceholder,
                            textFieldFocusRequester = searchInputFocus,
                            onQueryChange = { state.query = it },
                            onSearch = { state.search() },
                            onDown = {
                                moveDownFromSearch()
                            },
                            onFocusChanged = {
                                searchBarFocused = it
                            },
                            modifier = Modifier
                                .fillMaxWidth(0.68f)
                                .then(inputModifier)
                        )
                    }
                }

                // Continue Watching Carousel matching Desktop WatchingCarousel.tsx
                if (continueWatching.isNotEmpty()) {
                    item {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 38.dp),
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Icon(
                                        painter = painterResource(R.drawable.desktop_clock),
                                        contentDescription = null,
                                        tint = colors["type.emphasis"],
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Text(
                                        text = t("home.continueWatching.sectionTitle").uppercase(),
                                        color = colors["type.emphasis"],
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 17.sp,
                                        letterSpacing = 1.sp
                                    )
                                }
                                Spacer(Modifier.weight(1f))

                                val editShape = RoundedCornerShape(50)
                                var editFocused by remember { mutableStateOf(false) }
                                TvSurface(
                                    onClick = { editingWatching = !editingWatching },
                                    shape = TvSurfaceDefaults.shape(editShape),
                                    colors = TvSurfaceDefaults.colors(
                                        containerColor = if (editingWatching) colors["type.logo"] else colors["mediaCard.hoverBackground"],
                                        focusedContainerColor = colors["pill.activeBackground"]
                                    ),
                                    scale = TvSurfaceDefaults.scale(focusedScale = 1.08f),
                                    border = TvSurfaceDefaults.border(
                                        focusedBorder = TvBorder(BorderStroke(2.dp, if (editingWatching) Color.White else colors["type.logo"]), shape = editShape)
                                    ),
                                    modifier = Modifier
                                        .size(36.dp)
                                        .onFocusChanged { editFocused = it.isFocused }
                                ) {
                                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                        Icon(
                                            painter = painterResource(R.drawable.desktop_edit),
                                            contentDescription = "Edit",
                                            tint = if (editingWatching || editFocused) Color.White else colors["type.secondary"],
                                            modifier = Modifier.size(16.dp)
                                        )
                                    }
                                }
                            }

                            if (editingWatching) {
                                val sortOptions = listOf(
                                    DiscoverOption("date", t("home.continueWatching.sorting.options.date")),
                                    DiscoverOption("titleAsc", t("home.continueWatching.sorting.options.titleAsc")),
                                    DiscoverOption("titleDesc", t("home.continueWatching.sorting.options.titleDesc")),
                                    DiscoverOption("yearAsc", t("home.continueWatching.sorting.options.yearAsc")),
                                    DiscoverOption("yearDesc", t("home.continueWatching.sorting.options.yearDesc"))
                                )
                                FilterMenu(
                                    label = sortOptions.firstOrNull { it.id == watchingSortBy }?.name ?: t("home.continueWatching.sorting.options.date"),
                                    selected = watchingSortBy,
                                    options = sortOptions,
                                    allowAll = false
                                ) { newSort ->
                                    watchingSortBy = newSort
                                }
                            }

                            LazyRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(16.dp),
                                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 6.dp)
                            ) {
                                rowItems(continueWatching, key = { "watching:${it.media.id}:${it.season}:${it.episode}" }) { libItem ->
                                    val progressVal = if (libItem.duration > 0) (libItem.position / libItem.duration).toFloat().coerceIn(0f, 1f) else null
                                    val isFirst = continueWatching.firstOrNull() == libItem
                                    TvMediaCard(
                                        item = libItem.media,
                                        onOpen = {
                                            if (editingWatching) state.removeProgressItem(libItem)
                                            else state.openDetails(libItem.media)
                                        },
                                        progress = progressVal,
                                        season = libItem.season,
                                        episode = libItem.episode,
                                        closable = editingWatching,
                                        onClose = { state.removeProgressItem(libItem) },
                                        bookmarked = state.bookmarks.any { it.id == libItem.media.id },
                                        onBookmark = state::bookmark,
                                        qualityLoader = state.backend::releaseQuality,
                                        modifier = (if (isFirst) Modifier.focusRequester(continueWatchingFocus) else Modifier)
                                            .focusProperties {
                                                up = searchInputFocus
                                                down = categoryFocus
                                            }
                                    )
                                }
                            }
                        }
                    }
                }

                // Category Filter Navigation Bar matching Desktop DiscoverNavigation
                item {
                    Column(
                        Modifier.padding(start = 34.dp, end = 38.dp),
                        verticalArrangement = Arrangement.spacedBy(18.dp)
                    ) {
                        DiscoverNavigation(
                            state = state,
                            categoryFocus = categoryFocus,
                            upFocus = if (continueWatching.isNotEmpty()) continueWatchingFocus else searchInputFocus
                        )
                    }
                }

                // Full Content Rows matching Desktop discoverContent.tsx
                discoverContentRows(
                    state = state,
                    titleTrending = titleTrending,
                    titlePopular = titlePopular,
                    titleProvider = titleProvider,
                    titleTopRated = titleTopRated,
                    titleEditorPicks = titleEditorPicks,
                    titleNewReleases = titleNewReleases,
                    titleForYou = titleForYou,
                    titleBasedOn = titleBasedOn,
                    titleGenres = titleGenres,
                    retryLabel = retryLabel,
                    colors = colors
                )
            }

            AnimatedVisibility(
                visible = searchListState.firstVisibleItemIndex > 0,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 12.dp)
            ) {
                TvButton(
                    t("discover.scrollToTop"),
                    navigation = true,
                    icon = R.drawable.desktop_chevron_up
                ) {
                    scope.launch {
                        searchListState.animateScrollToItem(0)
                        searchInputFocus.requestFocus()
                    }
                }
            }
        }
    } else {
        // Query is non-blank: Desktop SearchListPart
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(start = 48.dp, top = 80.dp, end = 48.dp, bottom = 12.dp)
        ) {
            TvSearchBar(
                query = state.query,
                textFieldFocusRequester = searchInputFocus,
                onQueryChange = { state.query = it },
                onSearch = { state.search() },
                onDown = {
                    moveDownFromSearch()
                },
                onFocusChanged = {
                    searchBarFocused = it
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .then(inputModifier)
            )

            Spacer(Modifier.height(14.dp))

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(
                    painter = painterResource(R.drawable.desktop_search),
                    contentDescription = null,
                    tint = colors["type.logo"],
                    modifier = Modifier.size(20.dp)
                )
                Text(
                    text = t("home.search.sectionTitle").uppercase(),
                    color = colors["type.emphasis"],
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    letterSpacing = 1.sp
                )
            }

            Spacer(Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                LazyRow(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    item {
                        GenreFilterChip(
                            label = t("home.search.genreFilterAll"),
                            selected = state.searchGenre.isBlank(),
                            onClick = { state.searchGenre = "" },
                            modifier = Modifier
                                .focusRequester(filterAllFocus)
                                .focusProperties { up = searchInputFocus }
                        )
                    }
                    rowItems(genres, key = { it.id }) { genre ->
                        GenreFilterChip(
                            label = genre.name,
                            selected = state.searchGenre == genre.id,
                            onClick = { state.searchGenre = genre.id },
                            modifier = Modifier.focusProperties { up = searchInputFocus }
                        )
                    }
                }

                Box(
                    modifier = Modifier
                        .padding(horizontal = 12.dp)
                        .width(1.dp)
                        .height(22.dp)
                        .background(Color.White.copy(alpha = 0.15f))
                )

                if (state.countries.isNotEmpty()) {
                    FilterMenu(
                        label = filterCountryLabel,
                        selected = state.searchCountry,
                        options = state.countries,
                        modifier = Modifier.focusProperties { up = searchInputFocus }
                    ) {
                        state.searchCountry = it
                    }
                    Spacer(Modifier.width(8.dp))
                }

                FilterMenu(
                    label = filterYearLabel,
                    selected = state.searchYear,
                    options = (Year.now().value downTo 1900).map { DiscoverOption(it.toString(), it.toString()) },
                    modifier = Modifier.focusProperties { up = searchInputFocus }
                ) {
                    state.searchYear = it
                }
            }

            Spacer(Modifier.height(16.dp))

            LazyVerticalGrid(
                columns = GridCells.Adaptive(174.dp),
                state = searchGridState,
                horizontalArrangement = Arrangement.spacedBy(18.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                if (state.searchLoading && filtered.isEmpty()) {
                    items(12) {
                        TvMediaCardSkeleton()
                    }
                } else {
                    items(filtered, key = { "${it.type}:${it.id}:${it.addonManifest}" }) { item ->
                        TvMediaCard(
                            item = item,
                            onOpen = { state.openDetails(item) },
                            bookmarked = state.bookmarks.any { it.id == item.id },
                            onBookmark = state::bookmark,
                            qualityLoader = state.backend::releaseQuality
                        )
                    }
                }

                if (!state.searchLoading) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 36.dp, bottom = 20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            if (filtered.isNotEmpty()) {
                                Text(
                                    text = t("home.search.allResults"),
                                    color = colors["type.dimmed"],
                                    fontSize = 16.sp
                                )
                                TvButton(
                                    label = t("home.search.discoverMore"),
                                    navigation = true
                                ) {
                                    state.page = "discover"
                                }
                            } else if (state.searchError.isBlank()) {
                                IconPatch(
                                    icon = R.drawable.desktop_eye_slash,
                                    contentColor = colors["type.logo"],
                                    size = 54.dp,
                                    iconSize = 26.dp
                                )
                                Text(
                                    text = t("home.search.noResults"),
                                    color = colors["type.secondary"],
                                    fontSize = 16.sp
                                )
                            } else {
                                IconPatch(
                                    icon = R.drawable.desktop_warning,
                                    contentColor = colors["type.danger"],
                                    size = 54.dp,
                                    iconSize = 26.dp
                                )
                                Text(
                                    text = state.searchError,
                                    color = colors["type.danger"],
                                    fontSize = 16.sp
                                )
                                Spacer(Modifier.height(4.dp))
                                TvButton(
                                    label = retryLabel,
                                    primary = true
                                ) {
                                    state.search()
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
internal fun SearchScreen(
    state: FrameZooState,
    gridState: LazyGridState,
    searchAction: FocusRequester,
    inputModifier: Modifier
) {
    val searchListState = rememberLazyListState()
    SearchScreen(
        state = state,
        searchListState = searchListState,
        searchGridState = gridState,
        searchAction = searchAction,
        inputModifier = inputModifier
    )
}
