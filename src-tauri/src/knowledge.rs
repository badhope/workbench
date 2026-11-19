//! 本地知识库：Markdown 目录 → FTS5 索引 → 搜索/读取。
//!
//! 设计边界：
//! - 正文永远留在 Markdown 文件里，SQLite 只存可重建的索引；
//! - 不内置编辑器、不内置模型，外部 AI 通过 MCP 读，必要时再走受控写入；
//! - 中文用 FTS5 trigram，1–2 字查询回退 LIKE，不引入分词服务。

use crate::json_store;
use crate::paths::DataRoot;
use gray_matter::{engine::YAML, Matter};
use ignore::WalkBuilder;
use rusqlite::{params, Connection};
use serde::de::{Deserializer, SeqAccess, Visitor};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_INDEX_CHARS: usize = 200_000;
const DEFAULT_LIMIT: usize = 20;
static INDEX_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct KnowledgeSource {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct KnowledgeConfig {
    #[serde(default)]
    sources: Vec<KnowledgeSource>,
    #[serde(default)]
    last_indexed_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct KnowledgeStatus {
    pub sources: Vec<KnowledgeSource>,
    pub doc_count: usize,
    #[ts(type = "number")]
    pub last_indexed_at: u64,
    pub db_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct KnowledgeHit {
    pub path: String,
    pub title: String,
    #[ts(optional)]
    pub project_id: Option<String>,
    pub tags: Vec<String>,
    pub snippet: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, ts_rs::TS)]
pub struct KnowledgeDoc {
    pub path: String,
    pub title: String,
    pub body: String,
    #[ts(optional)]
    pub project_id: Option<String>,
    pub tags: Vec<String>,
    #[ts(type = "number")]
    pub mtime: u64,
}

#[derive(Deserialize, Default)]
struct FrontMatter {
    title: Option<String>,
    project: Option<String>,
    project_id: Option<String>,
    // 兼容 Obsidian 常见的两种写法：`tags: [a, b]` 与 `tags: a`。
    // 直接写 Option<Vec<String>> 会让字符串写法整段 frontmatter 反序列化失败，
    // 标题和项目关联一起丢失。
    #[serde(default, deserialize_with = "string_or_vec")]
    tags: Vec<String>,
}

fn string_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    struct TagsVisitor;
    impl<'de> Visitor<'de> for TagsVisitor {
        type Value = Vec<String>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("a string or a list of strings")
        }
        fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
            Ok(if v.trim().is_empty() {
                Vec::new()
            } else {
                vec![v.to_string()]
            })
        }
        fn visit_string<E: serde::de::Error>(self, v: String) -> Result<Self::Value, E> {
            self.visit_str(&v)
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut out = Vec::new();
            while let Some(tag) = seq.next_element::<String>()? {
                if !tag.trim().is_empty() {
                    out.push(tag);
                }
            }
            Ok(out)
        }
        fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }
        fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
            Ok(Vec::new())
        }
    }
    deserializer.deserialize_any(TagsVisitor)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn config_path(root: &DataRoot) -> PathBuf {
    root.knowledge_config()
}

fn db_path(root: &DataRoot) -> PathBuf {
    root.knowledge_db()
}

fn load_config(root: &DataRoot) -> Result<KnowledgeConfig, String> {
    Ok(json_store::read_json(&config_path(root))?.unwrap_or_default())
}

fn save_config(root: &DataRoot, config: &KnowledgeConfig) -> Result<(), String> {
    json_store::write_json_atomic(&config_path(root), config)
}

fn open_db(root: &DataRoot) -> Result<Connection, String> {
    if let Some(dir) = db_path(root).parent() {
        fs::create_dir_all(dir).map_err(|e| format!("无法创建知识库目录: {e}"))?;
    }
    let conn = Connection::open(db_path(root)).map_err(|e| format!("打开知识库失败: {e}"))?;
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(
            path UNINDEXED,
            title,
            body,
            tags,
            project_id UNINDEXED,
            mtime UNINDEXED,
            tokenize='trigram'
        );",
    )
    .map_err(|e| format!("初始化知识库索引失败: {e}"))?;
    Ok(conn)
}

fn parse_markdown(raw: &str) -> (String, FrontMatter) {
    let matter = Matter::<YAML>::new();
    match matter.parse::<FrontMatter>(raw) {
        Ok(parsed) => (parsed.content, parsed.data.unwrap_or_default()),
        Err(_) => (raw.to_string(), FrontMatter::default()),
    }
}

fn title_of(content: &str, front: &FrontMatter, path: &Path) -> String {
    if let Some(title) = front
        .title
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        return title.to_string();
    }
    if let Some(line) = content.lines().find_map(|line| {
        line.trim()
            .strip_prefix("# ")
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }) {
        return line.to_string();
    }
    path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string())
}

fn tags_of(front: &FrontMatter) -> String {
    front.tags.join(",")
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdx" | "txt"
            )
        })
        .unwrap_or(false)
}

fn canonical_dir(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() {
        return Err("目录不能为空".to_string());
    }
    let canonical = fs::canonicalize(&path).map_err(|e| format!("目录不可访问: {e}"))?;
    if !canonical.is_dir() {
        return Err("请选择一个目录".to_string());
    }
    Ok(canonical)
}

fn source_name(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.display().to_string())
}

/// 把用户输入路径解析到已配置的知识目录之内。
/// 这是所有读取/打开操作的唯一入口，避免 `..`、符号链接或任意路径逃逸。
pub fn resolve_doc(root: &DataRoot, raw: &str) -> Result<PathBuf, String> {
    let config = load_config(root)?;
    if config.sources.is_empty() {
        return Err("尚未配置知识目录".to_string());
    }
    let canonical =
        fs::canonicalize(PathBuf::from(raw)).map_err(|e| format!("文件不可访问: {e}"))?;
    if !canonical.is_file() {
        return Err("目标不是文件".to_string());
    }
    let inside = config.sources.iter().any(|source| {
        fs::canonicalize(&source.path)
            .map(|dir| canonical.starts_with(&dir))
            .unwrap_or(false)
    });
    if !inside {
        return Err("文件不在已配置的知识目录内".to_string());
    }
    Ok(canonical)
}

pub fn status(root: &DataRoot) -> Result<KnowledgeStatus, String> {
    let config = load_config(root)?;
    let conn = open_db(root)?;
    let doc_count: usize = conn
        .query_row("SELECT count(*) FROM docs", [], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("读取知识库统计失败: {e}"))? as usize;
    Ok(KnowledgeStatus {
        sources: config.sources,
        doc_count,
        last_indexed_at: config.last_indexed_at.unwrap_or(0),
        db_path: db_path(root).display().to_string(),
    })
}

pub fn add_source(root: &DataRoot, raw: &str) -> Result<KnowledgeStatus, String> {
    let _guard = INDEX_LOCK.lock().map_err(|_| "知识库忙碌".to_string())?;
    let canonical = canonical_dir(raw)?;
    let mut config = load_config(root)?;
    let path = canonical.display().to_string();
    if !config.sources.iter().any(|s| s.path == path) {
        config.sources.push(KnowledgeSource {
            name: source_name(&canonical),
            path,
        });
        save_config(root, &config)?;
    }
    drop(_guard);
    // 添加目录即建索引：IPC、HTTP、CLI 都只调这一个服务入口，
    // 避免每个适配层各自复制「add 后必须 reindex」的编排。
    reindex(root)
}

pub fn remove_source(root: &DataRoot, raw: &str) -> Result<KnowledgeStatus, String> {
    let _guard = INDEX_LOCK.lock().map_err(|_| "知识库忙碌".to_string())?;
    let canonical = fs::canonicalize(raw).unwrap_or_else(|_| PathBuf::from(raw));
    let path = canonical.display().to_string();
    let mut config = load_config(root)?;
    config.sources.retain(|s| s.path != path && s.path != raw);
    save_config(root, &config)?;
    drop(_guard);
    // 移除目录后同样重建索引，旧文档不会残留。
    reindex(root)
}

pub fn reindex(root: &DataRoot) -> Result<KnowledgeStatus, String> {
    let _guard = INDEX_LOCK.lock().map_err(|_| "知识库忙碌".to_string())?;
    let mut config = load_config(root)?;
    let mut conn = open_db(root)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("开始索引事务失败: {e}"))?;
    tx.execute("DELETE FROM docs", [])
        .map_err(|e| format!("清理旧索引失败: {e}"))?;

    let mut indexed = 0usize;
    for source in &config.sources {
        let source_path = PathBuf::from(&source.path);
        if !source_path.is_dir() {
            continue;
        }
        let walker = WalkBuilder::new(&source_path)
            .hidden(true)
            .standard_filters(true)
            .build();
        for entry in walker.flatten() {
            let path = entry.path();
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) || !is_markdown(path) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if meta.len() > MAX_FILE_BYTES {
                continue;
            }
            let Ok(raw) = fs::read_to_string(path) else {
                continue;
            };
            let (content, front) = parse_markdown(&raw);
            let title = title_of(&content, &front, path);
            let project_id = front.project_id.clone().or(front.project.clone());
            let tags = tags_of(&front);
            let body: String = content.chars().take(MAX_INDEX_CHARS).collect();
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            tx.execute(
                "INSERT INTO docs(path,title,body,tags,project_id,mtime) VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    path.display().to_string(),
                    title,
                    body,
                    tags,
                    project_id.unwrap_or_default(),
                    mtime.to_string()
                ],
            )
            .map_err(|e| format!("写入索引失败 {}: {e}", path.display()))?;
            indexed += 1;
        }
    }
    tx.commit().map_err(|e| format!("提交索引失败: {e}"))?;
    config.last_indexed_at = Some(now_secs());
    save_config(root, &config)?;
    drop(_guard);
    log::info!("知识库索引完成：{indexed} 篇");
    status(root)
}

pub fn search(
    root: &DataRoot,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<KnowledgeHit>, String> {
    let conn = open_db(root)?;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, 50) as i64;
    let q = query.trim();
    if q.is_empty() {
        let mut stmt = conn
            .prepare("SELECT path,title,COALESCE(project_id,''),COALESCE(tags,'') FROM docs ORDER BY CAST(mtime AS INTEGER) DESC LIMIT ?1")
            .map_err(|e| format!("读取知识库失败: {e}"))?;
        let rows = stmt
            .query_map([limit], |row| {
                Ok(KnowledgeHit {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    project_id: Some(row.get::<_, String>(2)?).filter(|s| !s.is_empty()),
                    tags: split_tags(row.get::<_, String>(3)?),
                    snippet: String::new(),
                })
            })
            .map_err(|e| format!("读取知识库失败: {e}"))?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取知识库失败: {e}"));
    }

    if q.chars().count() < 3 {
        let mut stmt = conn
            .prepare("SELECT path,title,COALESCE(project_id,''),COALESCE(tags,''),substr(body,1,240) FROM docs WHERE title LIKE ?1 OR body LIKE ?1 ORDER BY CAST(mtime AS INTEGER) DESC LIMIT ?2")
            .map_err(|e| format!("读取知识库失败: {e}"))?;
        let pattern = format!("%{q}%");
        let rows = stmt
            .query_map(params![pattern, limit], |row| {
                Ok(KnowledgeHit {
                    path: row.get(0)?,
                    title: row.get(1)?,
                    project_id: Some(row.get::<_, String>(2)?).filter(|s| !s.is_empty()),
                    tags: split_tags(row.get::<_, String>(3)?),
                    snippet: row.get(4)?,
                })
            })
            .map_err(|e| format!("读取知识库失败: {e}"))?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取知识库失败: {e}"));
    }

    let matcher = q
        .split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut stmt = conn
        .prepare("SELECT path,title,COALESCE(project_id,''),COALESCE(tags,''),snippet(docs,2,'','','…',24) FROM docs WHERE docs MATCH ?1 ORDER BY rank LIMIT ?2")
        .map_err(|e| format!("读取知识库失败: {e}"))?;
    let rows = stmt
        .query_map(params![matcher, limit], |row| {
            Ok(KnowledgeHit {
                path: row.get(0)?,
                title: row.get(1)?,
                project_id: Some(row.get::<_, String>(2)?).filter(|s| !s.is_empty()),
                tags: split_tags(row.get::<_, String>(3)?),
                snippet: row.get(4)?,
            })
        })
        .map_err(|e| format!("读取知识库失败: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("读取知识库失败: {e}"))
}

pub fn read_doc(root: &DataRoot, raw: &str) -> Result<KnowledgeDoc, String> {
    let path = resolve_doc(root, raw)?;
    let raw_text = fs::read_to_string(&path).map_err(|e| format!("读取知识文件失败: {e}"))?;
    let (body, front) = parse_markdown(&raw_text);
    let title = title_of(&body, &front, &path);
    let project_id = front.project_id.clone().or(front.project.clone());
    let mtime = fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    Ok(KnowledgeDoc {
        path: path.display().to_string(),
        title,
        body,
        project_id,
        tags: front.tags,
        mtime,
    })
}

fn split_tags(raw: String) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> DataRoot {
        let dir = std::env::temp_dir().join(format!("wb-knowledge-{name}-{}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(&dir).unwrap();
        DataRoot::new(dir)
    }

    fn write_note(root: &DataRoot, name: &str, text: &str) -> String {
        let path = root.as_path().join(name);
        fs::write(&path, text).unwrap();
        path.display().to_string()
    }

    #[test]
    fn indexes_frontmatter_and_searches_chinese() {
        let root = temp_root("search");
        let vault = root.as_path().join("vault");
        fs::create_dir_all(&vault).unwrap();
        let note = vault.join("note.md");
        fs::write(&note, "---\ntitle: 端口排障\nproject: workbench\ntags: [ops, net]\n---\n\n# 端口排障\n\n检查 7788 端口被谁占用。").unwrap();
        add_source(&root, &vault.display().to_string()).unwrap();
        let state = reindex(&root).unwrap();
        assert_eq!(state.doc_count, 1);
        let hits = search(&root, "端口", Some(10)).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "端口排障");
        assert_eq!(hits[0].project_id.as_deref(), Some("workbench"));
        let doc = read_doc(&root, &note.display().to_string()).unwrap();
        assert!(doc.body.contains("7788"));
    }

    #[test]
    fn accepts_string_and_list_tags() {
        let root = temp_root("tags");
        let vault = root.as_path().join("vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(
            vault.join("one.md"),
            "---\ntitle: One\ntags: single\n---\n\nbody",
        )
        .unwrap();
        fs::write(
            vault.join("two.md"),
            "---\ntitle: Two\ntags: [a, b]\n---\n\nbody",
        )
        .unwrap();
        add_source(&root, &vault.display().to_string()).unwrap();
        let one = read_doc(&root, &vault.join("one.md").display().to_string()).unwrap();
        let two = read_doc(&root, &vault.join("two.md").display().to_string()).unwrap();
        assert_eq!(one.tags, vec!["single"]);
        assert_eq!(two.tags, vec!["a", "b"]);
    }

    #[test]
    fn rejects_paths_outside_sources() {
        let root = temp_root("outside");
        let vault = root.as_path().join("vault");
        fs::create_dir_all(&vault).unwrap();
        let outside = root.as_path().join("outside.md");
        fs::write(&outside, "secret").unwrap();
        add_source(&root, &vault.display().to_string()).unwrap();
        assert!(read_doc(&root, &outside.display().to_string()).is_err());
    }

    #[test]
    fn reindex_is_idempotent() {
        let root = temp_root("idempotent");
        let vault = root.as_path().join("vault");
        fs::create_dir_all(&vault).unwrap();
        write_note(&root, "vault/a.md", "# A\n\nalpha");
        add_source(&root, &vault.display().to_string()).unwrap();
        assert_eq!(reindex(&root).unwrap().doc_count, 1);
        assert_eq!(reindex(&root).unwrap().doc_count, 1);
    }
}
