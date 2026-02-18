//! Process information structure

use napi_derive::napi;

/// Information about a running process
#[napi(object)]
#[derive(Clone)]
pub struct ProcessInfo {
  /// Process ID
  pub pid: u32,
  /// Process name
  pub name: String,
  /// Full path to the executable (may be null if not accessible)
  pub path: Option<String>,
  /// Whether this process owns the foreground window
  pub is_foreground: bool,
  /// Parent process ID (optional, requires include: ["ppid"])
  pub ppid: Option<u32>,
  /// Memory usage in bytes (optional, requires include: ["memory"])
  pub memory: Option<f64>,
  /// Process start time as Unix timestamp in milliseconds (optional, requires include: ["startTime"])
  pub start_time: Option<f64>,
}

impl ProcessInfo {
  pub fn new(pid: u32, name: String) -> Self {
    Self {
      pid,
      name,
      path: None,
      is_foreground: false,
      ppid: None,
      memory: None,
      start_time: None,
    }
  }
}
