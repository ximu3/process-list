#[cfg(any(target_os = "linux", test))]
mod procfs;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::{foreground, get_process, list_processes};
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{foreground, get_process, list_processes};
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::{foreground, get_process, list_processes};

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
compile_error!("process-list supports Windows, macOS, and Linux");
#[cfg(any(target_os = "windows", target_os = "linux", test))]
mod foreground_query;
