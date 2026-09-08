#[derive(Debug, Clone)]
pub struct Process {
    pub pid: u32,
    pub name: Option<String>,
    pub parent_pid: Option<u32>,
    pub executable_path: Option<String>,
    pub memory_bytes: Option<u64>,
    pub started_at: Option<f64>,
}

impl Process {
    pub fn new(pid: u32) -> Self {
        Self {
            pid,
            name: None,
            parent_pid: None,
            executable_path: None,
            memory_bytes: None,
            started_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Foreground {
    Active { pid: u32, source: &'static str },
    None { source: &'static str },
    Unavailable { reason: &'static str },
}
