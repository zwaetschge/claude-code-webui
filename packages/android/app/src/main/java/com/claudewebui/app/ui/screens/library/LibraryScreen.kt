package com.claudewebui.app.ui.screens.library

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.FilterAlt
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SettingsEthernet
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Icon
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudewebui.app.data.model.CustomAgent
import com.claudewebui.app.ui.components.common.GlassPanel
import com.claudewebui.app.ui.components.common.MainDestination
import com.claudewebui.app.ui.components.common.PlumAccent
import com.claudewebui.app.ui.components.common.PlumBackdrop
import com.claudewebui.app.ui.components.common.PlumBlue
import com.claudewebui.app.ui.components.common.PlumBorder
import com.claudewebui.app.ui.components.common.PlumBottomBar
import com.claudewebui.app.ui.components.common.PlumGreen
import com.claudewebui.app.ui.components.common.PlumIconButton
import com.claudewebui.app.ui.components.common.PlumMuted
import com.claudewebui.app.ui.components.common.PlumScreenHeader
import com.claudewebui.app.ui.components.common.PlumSurfaceStrong
import com.claudewebui.app.ui.components.common.PlumText
import com.claudewebui.app.ui.components.common.SectionHeading
import com.claudewebui.app.ui.screens.settings.SettingsViewModel
import org.koin.compose.viewmodel.koinViewModel

private enum class LibraryTab(val label: String, val icon: ImageVector) {
    AGENTS("Agents", Icons.Outlined.SmartToy),
    SKILLS("Skills", Icons.Outlined.Bolt),
    PLUGINS("Plugins", Icons.Outlined.Extension),
    MCP("MCP Servers", Icons.Outlined.SettingsEthernet),
    COMMANDS("Commands", Icons.Outlined.Terminal),
    STYLES("Styles", Icons.Outlined.Palette),
}

@Composable
fun LibraryScreen(
    onNavigateMain: (MainDestination) -> Unit,
    viewModel: SettingsViewModel = koinViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var tab by remember { mutableStateOf(LibraryTab.AGENTS) }
    var query by remember { mutableStateOf("") }
    val filteredAgents = state.agents.filter {
        query.isBlank() || it.name.contains(query, true) || it.description?.contains(query, true) == true
    }

    PlumBackdrop {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = { PlumBottomBar(MainDestination.LIBRARY, onNavigateMain) },
        ) { padding ->
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(bottom = 18.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                item {
                    PlumScreenHeader(
                        title = "Library",
                        subtitle = "Manage your agents, skills, plugins and more",
                        actions = {
                            PlumIconButton(Icons.Outlined.Search, "Search", {})
                            PlumIconButton(Icons.Outlined.FilterAlt, "Filter", {})
                        },
                    )
                }
                item {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(LibraryTab.entries) { item ->
                            val count = when (item) {
                                LibraryTab.AGENTS -> state.agents.size
                                LibraryTab.MCP -> state.mcpServers.size
                                LibraryTab.COMMANDS -> state.cliTools.size
                                else -> 0
                            }
                            LibraryTabCard(item, count, item == tab) { tab = item }
                        }
                    }
                }
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 14.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        TextField(
                            value = query,
                            onValueChange = { query = it },
                            leadingIcon = { Icon(Icons.Outlined.Search, null, tint = PlumMuted) },
                            placeholder = { Text("Search ${tab.label.lowercase()}…", color = PlumMuted) },
                            singleLine = true,
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = PlumSurfaceStrong,
                                unfocusedContainerColor = PlumSurfaceStrong,
                                focusedIndicatorColor = Color.Transparent,
                                unfocusedIndicatorColor = Color.Transparent,
                                focusedTextColor = PlumText,
                                unfocusedTextColor = PlumText,
                            ),
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier.weight(1f).border(1.dp, PlumBorder, RoundedCornerShape(16.dp)),
                        )
                        GlassPanel(Modifier.width(82.dp).height(56.dp), radius = 16.dp) {
                            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                                Text("Recently ▾", color = PlumMuted, fontSize = 9.sp, maxLines = 1)
                            }
                        }
                        PlumIconButton(Icons.Outlined.GridView, "View mode", {})
                    }
                }
                if (tab == LibraryTab.AGENTS && filteredAgents.isNotEmpty()) {
                    item {
                        SectionHeading(
                            title = "Featured",
                            caption = "Your favorite and most used agents",
                            modifier = Modifier.padding(horizontal = 14.dp),
                        )
                    }
                    item {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            items(filteredAgents.take(4), key = { it.id }) { agent ->
                                FeaturedAgent(agent)
                            }
                        }
                    }
                }
                item {
                    val title = when (tab) {
                        LibraryTab.AGENTS -> "All Agents"
                        else -> tab.label
                    }
                    val count = when (tab) {
                        LibraryTab.AGENTS -> filteredAgents.size
                        LibraryTab.MCP -> state.mcpServers.size
                        LibraryTab.COMMANDS -> state.cliTools.size
                        else -> 0
                    }
                    SectionHeading(title, Modifier.padding(horizontal = 14.dp), "$count items")
                }
                when (tab) {
                    LibraryTab.AGENTS -> {
                        if (filteredAgents.isEmpty()) {
                            item { LibraryEmpty("No agents available", "Agents configured in Plum will appear here.") }
                        } else {
                            items(filteredAgents, key = { it.id }) { agent ->
                                AgentRow(agent, onToggle = { viewModel.toggleAgent(agent.id, it) })
                            }
                        }
                    }
                    LibraryTab.MCP -> {
                        items(state.mcpServers, key = { it.id }) { server ->
                            GenericLibraryRow(
                                title = server.name,
                                subtitle = if (server.enabled) "Connected MCP server" else "Disabled MCP server",
                                icon = Icons.Outlined.SettingsEthernet,
                                enabled = server.enabled,
                            )
                        }
                        if (state.mcpServers.isEmpty()) item { LibraryEmpty("No MCP servers", "Add servers in Settings → MCP Servers.") }
                    }
                    LibraryTab.COMMANDS -> {
                        items(state.cliTools, key = { it.id }) { tool ->
                            GenericLibraryRow(tool.name, tool.description, Icons.Outlined.Terminal, tool.enabled)
                        }
                    }
                    else -> item {
                        LibraryEmpty("No ${tab.label.lowercase()} yet", "This category is ready for items synced by Plum.")
                    }
                }
                if (tab == LibraryTab.AGENTS) {
                    item {
                        SectionHeading(
                            title = "Collections",
                            caption = "Organize your library",
                            modifier = Modifier.padding(horizontal = 14.dp),
                        )
                    }
                    item {
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 14.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            items(
                                listOf(
                                    Triple("Development", "12 items", PlumBlue),
                                    Triple("Research", "8 items", Color(0xFFFF59B4)),
                                    Triple("Operations", "6 items", Color(0xFFFF9E2B)),
                                    Triple("Personal", "5 items", PlumGreen),
                                )
                            ) { (title, count, color) ->
                                CollectionCard(title, count, color)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LibraryTabCard(tab: LibraryTab, count: Int, selected: Boolean, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .width(56.dp)
            .height(78.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) Color(0x351A3DA1) else PlumSurfaceStrong)
            .border(1.dp, if (selected) PlumAccent else PlumBorder, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(7.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(tab.icon, null, tint = if (selected) PlumAccent else PlumMuted, modifier = Modifier.size(18.dp))
            Spacer(Modifier.weight(1f))
            Text(count.toString(), color = if (selected) PlumAccent else PlumMuted, fontSize = 9.sp)
        }
        Text(tab.label, color = PlumText, fontSize = 9.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, lineHeight = 10.sp)
    }
}

@Composable
private fun CollectionCard(title: String, count: String, color: Color) {
    GlassPanel(Modifier.width(136.dp).height(66.dp), radius = 14.dp) {
        Column(Modifier.fillMaxSize().padding(10.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Folder, null, tint = color, modifier = Modifier.size(18.dp))
                Text("  $title", color = PlumText, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
            Text(count, color = PlumMuted, fontSize = 9.sp)
        }
    }
}

@Composable
private fun FeaturedAgent(agent: CustomAgent) {
    val color = agentColor(agent)
    GlassPanel(Modifier.width(182.dp).height(178.dp), radius = 17.dp) {
        Column(Modifier.fillMaxSize().padding(14.dp)) {
            Row {
                Box(Modifier.size(44.dp).background(color.copy(alpha = .18f), RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.SmartToy, null, tint = color)
                }
                Spacer(Modifier.weight(1f))
                Icon(Icons.Outlined.Star, "Favorite", tint = Color(0xFFFFC12B), modifier = Modifier.size(19.dp))
            }
            Text(agent.name, color = PlumText, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp), maxLines = 1)
            Text(agent.description ?: "Custom Plum agent", color = PlumMuted, fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 5.dp).weight(1f))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(agent.model, color = PlumMuted, fontSize = 10.sp, modifier = Modifier.weight(1f), maxLines = 1)
                Text(if (agent.enabled) "Active" else "Off", color = if (agent.enabled) PlumAccent else PlumMuted, fontSize = 10.sp)
            }
        }
    }
}

@Composable
private fun AgentRow(agent: CustomAgent, onToggle: (Boolean) -> Unit) {
    val color = agentColor(agent)
    GlassPanel(Modifier.fillMaxWidth().padding(horizontal = 14.dp), radius = 16.dp) {
        Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(48.dp).background(color.copy(alpha = .15f), RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.SmartToy, null, tint = color)
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(agent.name, color = PlumText, fontWeight = FontWeight.Bold, maxLines = 1)
                    Box(Modifier.padding(start = 6.dp).size(6.dp).background(if (agent.enabled) PlumGreen else PlumMuted, CircleShape))
                }
                Text(agent.description ?: "Custom agent", color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(agent.model, color = PlumMuted, fontSize = 10.sp, maxLines = 1)
            }
            Icon(Icons.Outlined.MoreVert, "More", tint = PlumMuted, modifier = Modifier.size(20.dp))
            Switch(
                checked = agent.enabled,
                onCheckedChange = onToggle,
                colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = PlumAccent),
                modifier = Modifier.padding(start = 4.dp),
            )
        }
    }
}

@Composable
private fun GenericLibraryRow(title: String, subtitle: String, icon: ImageVector, enabled: Boolean) {
    GlassPanel(Modifier.fillMaxWidth().padding(horizontal = 14.dp), radius = 16.dp) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(43.dp).background(PlumBlue.copy(alpha = .15f), RoundedCornerShape(13.dp)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = PlumBlue)
            }
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(title, color = PlumText, fontWeight = FontWeight.SemiBold)
                Text(subtitle, color = PlumMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.size(8.dp).background(if (enabled) PlumGreen else PlumMuted, CircleShape))
        }
    }
}

@Composable
private fun LibraryEmpty(title: String, subtitle: String) {
    GlassPanel(Modifier.fillMaxWidth().padding(horizontal = 14.dp), radius = 17.dp) {
        Column(Modifier.fillMaxWidth().padding(30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Extension, null, tint = PlumMuted, modifier = Modifier.size(31.dp))
            Text(title, color = PlumText, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
            Text(subtitle, color = PlumMuted, fontSize = 12.sp)
        }
    }
}

private fun agentColor(agent: CustomAgent): Color = runCatching {
    Color(android.graphics.Color.parseColor(agent.color))
}.getOrDefault(PlumAccent)
