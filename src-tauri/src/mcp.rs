//! MCP 入口：外部 AI 客户端通过 stdio 读取 Workbench 上下文与知识库。
//! 白名单写工具默认关闭，开启后由 `services::ai` 统一审计、可撤销。
//!
//! 不内置模型、不做聊天页；协议交给官方 `rmcp`，这里只定义白名单工具。
//! 写工具默认拒绝，必须在设置页显式开启；所有写入由 `services::ai` 统一审计。

use crate::paths::DataRoot;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerCapabilities, ServerConfig};
use rmcp::schemars::JsonSchema;
use rmcp::transport::stdio;
use rmcp::{tool, tool_handler, tool_router, ErrorData, ServerHandler, ServiceExt};
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct WorkbenchMcp {
    root: DataRoot,
    // 由 #[tool_router] 生成的 handler 读取；直接调用点不在字段上。
    #[allow(dead_code)]
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ContextParams {
    /// Include listening ports (may take a few hundred milliseconds).
    #[serde(default)]
    pub ports: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SearchParams {
    /// Free-text query. Empty returns the most recently modified notes.
    pub query: String,
    /// Maximum results, 1-50. Defaults to 10.
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ReadParams {
    /// Absolute path returned by knowledge_search.
    pub path: String,
}

#[tool_router]
impl WorkbenchMcp {
    pub fn new(root: DataRoot) -> Self {
        Self {
            root,
            tool_router: Self::tool_router(),
        }
    }

    fn ensure_write_enabled(&self) -> Result<(), ErrorData> {
        match crate::services::ai::allow_writes(&self.root) {
            Ok(true) => Ok(()),
            Ok(false) => Err(ErrorData::invalid_request(
                "AI writes are disabled. Enable them in Workbench Settings first.",
                None,
            )),
            Err(e) => Err(ErrorData::internal_error(e, None)),
        }
    }

    fn json<T: serde::Serialize>(value: &T) -> Result<String, ErrorData> {
        serde_json::to_string_pretty(value)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    #[tool(
        description = "Read the local Workbench context: projects, open tasks, optional ports, and AI cost summary. Read-only."
    )]
    fn workbench_context(
        &self,
        Parameters(p): Parameters<ContextParams>,
    ) -> Result<String, ErrorData> {
        let context = crate::services::context::snapshot(&self.root, p.ports)
            .map_err(|e| ErrorData::internal_error(e, None))?;
        serde_json::to_string_pretty(&context)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    #[tool(
        description = "Search the local Markdown knowledge base. Returns path, title, project, tags and snippet."
    )]
    fn knowledge_search(
        &self,
        Parameters(p): Parameters<SearchParams>,
    ) -> Result<String, ErrorData> {
        let hits = crate::knowledge::search(&self.root, &p.query, p.limit)
            .map_err(|e| ErrorData::internal_error(e, None))?;
        serde_json::to_string_pretty(&hits)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    #[tool(
        description = "Read one Markdown note by its absolute path. The path must be inside a configured knowledge source."
    )]
    fn knowledge_read(&self, Parameters(p): Parameters<ReadParams>) -> Result<String, ErrorData> {
        let doc = crate::knowledge::read_doc(&self.root, &p.path)
            .map_err(|e| ErrorData::internal_error(e, None))?;
        serde_json::to_string_pretty(&doc)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    #[tool(
        description = "Show knowledge base status: configured sources, indexed document count, and last index time."
    )]
    fn knowledge_status(&self) -> Result<String, ErrorData> {
        let status =
            crate::knowledge::status(&self.root).map_err(|e| ErrorData::internal_error(e, None))?;
        serde_json::to_string_pretty(&status)
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    #[tool(
        description = "Create a local Workbench task. Disabled unless AI writes are enabled in Settings; every write is audited and undoable."
    )]
    fn task_create(
        &self,
        Parameters(p): Parameters<crate::services::ai::TaskCreateArgs>,
    ) -> Result<String, ErrorData> {
        self.ensure_write_enabled()?;
        let action = crate::services::ai::task_create(&self.root, p)
            .map_err(|e| ErrorData::invalid_request(e, None))?;
        Self::json(&action)
    }

    #[tool(
        description = "Update an existing Workbench task by id. Disabled unless AI writes are enabled in Settings; every write is audited and undoable."
    )]
    fn task_update(
        &self,
        Parameters(p): Parameters<crate::services::ai::TaskUpdateArgs>,
    ) -> Result<String, ErrorData> {
        self.ensure_write_enabled()?;
        let action = crate::services::ai::task_update(&self.root, p)
            .map_err(|e| ErrorData::invalid_request(e, None))?;
        Self::json(&action)
    }

    #[tool(
        description = "Append a Markdown block to an existing note inside a configured knowledge source. Disabled unless AI writes are enabled in Settings; every write is audited and undoable."
    )]
    fn knowledge_append(
        &self,
        Parameters(p): Parameters<crate::services::ai::KnowledgeAppendArgs>,
    ) -> Result<String, ErrorData> {
        self.ensure_write_enabled()?;
        let action = crate::services::ai::knowledge_append(&self.root, p)
            .map_err(|e| ErrorData::invalid_request(e, None))?;
        Self::json(&action)
    }

    #[tool(description = "List recent audited AI write actions, newest first. Read-only.")]
    fn ai_actions_list(
        &self,
        Parameters(p): Parameters<crate::services::ai::ActionListArgs>,
    ) -> Result<String, ErrorData> {
        let actions = crate::services::ai::actions(&self.root, p.limit)
            .map_err(|e| ErrorData::internal_error(e, None))?;
        Self::json(&actions)
    }

    #[tool(
        description = "Undo one audited AI write by action id. Disabled unless AI writes are enabled in Settings; refuses if the target was changed externally."
    )]
    fn ai_action_undo(
        &self,
        Parameters(p): Parameters<crate::services::ai::ActionUndoArgs>,
    ) -> Result<String, ErrorData> {
        self.ensure_write_enabled()?;
        let action = crate::services::ai::undo(&self.root, &p.id)
            .map_err(|e| ErrorData::invalid_request(e, None))?;
        Self::json(&action)
    }
}

#[tool_handler]
impl ServerHandler for WorkbenchMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("workbench", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "Local-first Workbench. Read projects, tasks, ports, AI cost, and Markdown knowledge. Controlled writes are off by default and must be enabled in Settings; every write is audited and undoable.",
            )
    }
}

pub fn run_stdio(root: DataRoot) -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("创建 MCP 运行时失败: {e}"))?;
    runtime.block_on(async move {
        let service = WorkbenchMcp::new(root)
            .serve(stdio())
            .await
            .map_err(|e| format!("MCP 启动失败: {e}"))?;
        service
            .waiting()
            .await
            .map_err(|e| format!("MCP 运行失败: {e}"))?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_tools_reject_when_disabled() {
        let server = WorkbenchMcp::new(DataRoot::new(std::env::temp_dir()));
        let args = crate::services::ai::TaskCreateArgs {
            title: "should not write".to_string(),
            status: None,
            priority: None,
            due: None,
            project_id: None,
            tags: Vec::new(),
            next_step: None,
            blocked_reason: None,
        };
        let err = server
            .task_create(Parameters(args))
            .expect_err("写入默认关闭时必须拒绝");
        assert!(err.message.contains("disabled"), "{}", err.message);
    }

    #[test]
    fn server_handler_exposes_all_tools() {
        let server = WorkbenchMcp::new(DataRoot::new(std::env::temp_dir()));
        for name in [
            "workbench_context",
            "knowledge_search",
            "knowledge_read",
            "knowledge_status",
            "task_create",
            "task_update",
            "knowledge_append",
            "ai_actions_list",
            "ai_action_undo",
        ] {
            assert!(
                server.get_tool(name).is_some(),
                "MCP tool router 没有挂到 ServerHandler：{name}"
            );
        }
    }
}
