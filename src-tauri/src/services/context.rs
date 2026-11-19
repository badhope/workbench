//! AI 可读的工作台上下文：项目、任务、端口与成本摘要。
//!
//! 只读、可重建、不引入新的数据副本。MCP 的 `workbench_context` 与
//! HTTP `/api/context` 共用这一份实现。

use crate::cost_store::{self, CostOverview};
use crate::data::{self, Project, Task};
use crate::paths::DataRoot;
use crate::ports::{self, PortEntry};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct WorkbenchContext {
    pub projects: Vec<Project>,
    pub tasks: Vec<Task>,
    pub ports: Vec<PortEntry>,
    pub cost: Option<CostOverview>,
}

pub fn snapshot(root: &DataRoot, include_ports: bool) -> Result<WorkbenchContext, String> {
    let data = data::load_from_disk(root)?;
    let ports = if include_ports {
        ports::collect().unwrap_or_default()
    } else {
        Vec::new()
    };
    let cost = cost_store::build_overview(root).ok();
    Ok(WorkbenchContext {
        projects: data.projects,
        tasks: data.tasks.into_iter().take(500).collect(),
        ports,
        cost,
    })
}
