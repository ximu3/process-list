//! Platform-specific process enumeration

#[cfg(target_os = "windows")]
mod windows;

// Placeholder module: macOS support is not officially available yet.
#[cfg(target_os = "macos")]
mod macos;

// Placeholder module: Linux support is not officially available yet.
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
pub use windows::{get_process, get_processes};

// Placeholder export kept for API compatibility.
#[cfg(target_os = "macos")]
pub use macos::{get_process, get_processes};

// Placeholder export kept for API compatibility.
#[cfg(target_os = "linux")]
pub use linux::{get_process, get_processes};

// Fallback for unsupported platforms
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn get_processes(
  _include_ppid: bool,
  _include_memory: bool,
  _include_start_time: bool,
) -> Vec<ProcessInfo> {
  Vec::new()
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn get_process(
  _pid: u32,
  _include_ppid: bool,
  _include_memory: bool,
  _include_start_time: bool,
) -> Option<ProcessInfo> {
  None
}
