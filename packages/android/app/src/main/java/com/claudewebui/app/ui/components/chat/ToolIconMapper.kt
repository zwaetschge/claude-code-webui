package com.claudewebui.app.ui.components.chat

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector

// ── Tool Icon & Color Mapping ─────────────────────────────────────────────────

data class ToolDisplayInfo(
    val label: String,
    val icon: ImageVector,
    val color: Color,
)

data class AgentDisplayInfo(
    val label: String,
    val icon: ImageVector,
    val color: Color,
    val description: String,
)

object ToolIconMapper {

    fun forTool(toolName: String): ToolDisplayInfo {
        val name = toolName.lowercase().trim()
        return when {
            name == "read" -> ToolDisplayInfo(
                label = "Read File",
                icon = Icons.Outlined.Description,
                color = Color(0xFF3B82F6),
            )
            name == "write" -> ToolDisplayInfo(
                label = "Write File",
                icon = Icons.Outlined.Edit,
                color = Color(0xFF22C55E),
            )
            name == "edit" -> ToolDisplayInfo(
                label = "Edit File",
                icon = Icons.Outlined.DriveFileRenameOutline,
                color = Color(0xFFF59E0B),
            )
            name == "multiedit" -> ToolDisplayInfo(
                label = "Multi-Edit",
                icon = Icons.Outlined.EditNote,
                color = Color(0xFFF59E0B),
            )
            name == "bash" -> ToolDisplayInfo(
                label = "Bash",
                icon = Icons.Outlined.Terminal,
                color = Color(0xFF8B5CF6),
            )
            name == "glob" -> ToolDisplayInfo(
                label = "Find Files",
                icon = Icons.Outlined.FolderOpen,
                color = Color(0xFF06B6D4),
            )
            name == "grep" -> ToolDisplayInfo(
                label = "Search",
                icon = Icons.Outlined.Search,
                color = Color(0xFFEC4899),
            )
            name == "todowrite" -> ToolDisplayInfo(
                label = "Update Todos",
                icon = Icons.Outlined.Checklist,
                color = Color(0xFF10B981),
            )
            name == "websearch" -> ToolDisplayInfo(
                label = "Web Search",
                icon = Icons.Outlined.TravelExplore,
                color = Color(0xFF3B82F6),
            )
            name == "webfetch" -> ToolDisplayInfo(
                label = "Fetch URL",
                icon = Icons.Outlined.Download,
                color = Color(0xFF3B82F6),
            )
            name == "notebookedit" || name == "notebookread" -> ToolDisplayInfo(
                label = if (name == "notebookread") "Read Notebook" else "Edit Notebook",
                icon = Icons.Outlined.Book,
                color = Color(0xFFF59E0B),
            )
            name == "agent" || name.contains("agent") -> ToolDisplayInfo(
                label = "Agent",
                icon = Icons.Outlined.Psychology,
                color = Color(0xFFCC785C),
            )
            else -> ToolDisplayInfo(
                label = toolName,
                icon = Icons.Outlined.Build,
                color = Color(0xFF6B7280),
            )
        }
    }

    fun forAgent(agentType: String): AgentDisplayInfo {
        val type = agentType.lowercase().replace("-", " ").replace("_", " ").trim()
        return when {
            type.contains("explore") || type.contains("explorer") -> AgentDisplayInfo(
                label = "Explorer",
                icon = Icons.Outlined.ManageSearch,
                color = Color(0xFF06B6D4),
                description = "Explores codebase and maps structure",
            )
            type.contains("backend") -> AgentDisplayInfo(
                label = "Backend Dev",
                icon = Icons.Outlined.Storage,
                color = Color(0xFF3B82F6),
                description = "Implements server-side logic",
            )
            type.contains("frontend") -> AgentDisplayInfo(
                label = "Frontend Dev",
                icon = Icons.Outlined.Palette,
                color = Color(0xFFEC4899),
                description = "Implements UI and components",
            )
            type.contains("fullstack") || type.contains("full stack") -> AgentDisplayInfo(
                label = "Fullstack Dev",
                icon = Icons.Outlined.Layers,
                color = Color(0xFF8B5CF6),
                description = "Delivers end-to-end features",
            )
            type.contains("test") -> AgentDisplayInfo(
                label = "Test Engineer",
                icon = Icons.Outlined.BugReport,
                color = Color(0xFF22C55E),
                description = "Writes and runs tests",
            )
            type.contains("debug") -> AgentDisplayInfo(
                label = "Debugger",
                icon = Icons.Outlined.PestControl,
                color = Color(0xFFEF4444),
                description = "Diagnoses and fixes issues",
            )
            type.contains("security") || type.contains("audit") -> AgentDisplayInfo(
                label = "Security Auditor",
                icon = Icons.Outlined.Security,
                color = Color(0xFFF59E0B),
                description = "Reviews code for security risks",
            )
            type.contains("architect") -> AgentDisplayInfo(
                label = "Architect",
                icon = Icons.Outlined.AccountTree,
                color = Color(0xFF10B981),
                description = "Designs system architecture",
            )
            type.contains("devops") || type.contains("deploy") -> AgentDisplayInfo(
                label = "DevOps",
                icon = Icons.Outlined.CloudUpload,
                color = Color(0xFF6366F1),
                description = "Handles infrastructure and deployment",
            )
            type.contains("database") || type.contains("db") -> AgentDisplayInfo(
                label = "Database",
                icon = Icons.Outlined.TableChart,
                color = Color(0xFF14B8A6),
                description = "Designs schemas and queries",
            )
            type.contains("doc") || type.contains("writer") -> AgentDisplayInfo(
                label = "Docs Writer",
                icon = Icons.Outlined.Article,
                color = Color(0xFF64748B),
                description = "Creates documentation",
            )
            type.contains("research") -> AgentDisplayInfo(
                label = "Researcher",
                icon = Icons.Outlined.Biotech,
                color = Color(0xFF8B5CF6),
                description = "Gathers and synthesizes information",
            )
            type.contains("plan") -> AgentDisplayInfo(
                label = "Planner",
                icon = Icons.Outlined.Assignment,
                color = Color(0xFF0EA5E9),
                description = "Creates implementation plans",
            )
            else -> AgentDisplayInfo(
                label = agentType.replaceFirstChar { it.uppercase() },
                icon = Icons.Outlined.SmartToy,
                color = Color(0xFFCC785C),
                description = "Specialized agent",
            )
        }
    }
}
