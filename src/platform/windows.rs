//! Windows-specific process enumeration

use crate::process::ProcessInfo;
use std::ffi::OsString;
use std::mem;
use std::os::windows::ffi::OsStringExt;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, MAX_PATH};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

/// Get the PID of the foreground window process
fn get_foreground_pid() -> Option<u32> {
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != 0 {
            Some(pid)
        } else {
            None
        }
    }
}

/// Get the full path of a process
fn get_path(pid: u32) -> Option<String> {
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; MAX_PATH as usize];
        let mut size = buffer.len() as u32;

        let result =
            QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size);
        let _ = CloseHandle(handle);

        if result.is_ok() {
            let path = OsString::from_wide(&buffer[..size as usize]);
            Some(path.to_string_lossy().into_owned())
        } else {
            None
        }
    }
}

/// Get memory usage of a process (Working Set Size in bytes)
fn get_memory(pid: u32) -> Option<u64> {
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut pmc: PROCESS_MEMORY_COUNTERS = mem::zeroed();
        pmc.cb = mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;

        let result = GetProcessMemoryInfo(
            handle,
            &mut pmc,
            mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        );
        let _ = CloseHandle(handle);

        if result.is_ok() {
            Some(pmc.WorkingSetSize as u64)
        } else {
            None
        }
    }
}

/// Get process start time as Unix timestamp in milliseconds
fn get_start_time(pid: u32) -> Option<f64> {
    use windows::Win32::Foundation::FILETIME;

    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut creation_time: FILETIME = mem::zeroed();
        let mut exit_time: FILETIME = mem::zeroed();
        let mut kernel_time: FILETIME = mem::zeroed();
        let mut user_time: FILETIME = mem::zeroed();

        let result = GetProcessTimes(
            handle,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        );
        let _ = CloseHandle(handle);

        if result.is_ok() {
            // Convert FILETIME to Unix timestamp
            // FILETIME is 100-nanosecond intervals since January 1, 1601
            // Unix epoch is January 1, 1970
            let filetime_value =
                ((creation_time.dwHighDateTime as u64) << 32) | (creation_time.dwLowDateTime as u64);
            // 116444736000000000 is the number of 100-nanosecond intervals between 1601 and 1970
            let unix_time_100ns = filetime_value.checked_sub(116444736000000000)?;
            // Convert to milliseconds
            Some((unix_time_100ns / 10000) as f64)
        } else {
            None
        }
    }
}

/// Get the parent process ID
fn get_ppid(entry: &PROCESSENTRY32W) -> u32 {
    entry.th32ParentProcessID
}

/// Convert process name from wide string
fn get_name(entry: &PROCESSENTRY32W) -> String {
    let name_slice: &[u16] = &entry.szExeFile;
    let len = name_slice.iter().position(|&c| c == 0).unwrap_or(name_slice.len());
    OsString::from_wide(&name_slice[..len])
        .to_string_lossy()
        .into_owned()
}

/// Get all running processes
pub fn get_processes(
    include_ppid: bool,
    include_memory: bool,
    include_start_time: bool,
) -> Vec<ProcessInfo> {
    let mut processes = Vec::new();
    let foreground_pid = get_foreground_pid();

    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return processes,
        };

        let mut entry: PROCESSENTRY32W = mem::zeroed();
        entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                let name = get_name(&entry);

                let mut info = ProcessInfo::new(pid, name);
                info.path = get_path(pid);
                info.is_foreground = foreground_pid == Some(pid);

                if include_ppid {
                    info.ppid = Some(get_ppid(&entry));
                }
                if include_memory {
                    info.memory = get_memory(pid).map(|m| m as f64);
                }
                if include_start_time {
                    info.start_time = get_start_time(pid);
                }

                processes.push(info);

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    processes
}

/// Get a single process by PID
pub fn get_process(
    pid: u32,
    include_ppid: bool,
    include_memory: bool,
    include_start_time: bool,
) -> Option<ProcessInfo> {
    let foreground_pid = get_foreground_pid();

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;

        let mut entry: PROCESSENTRY32W = mem::zeroed();
        entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                if entry.th32ProcessID == pid {
                    let name = get_name(&entry);
                    let mut info = ProcessInfo::new(pid, name);
                    info.path = get_path(pid);
                    info.is_foreground = foreground_pid == Some(pid);

                    if include_ppid {
                        info.ppid = Some(get_ppid(&entry));
                    }
                    if include_memory {
                        info.memory = get_memory(pid).map(|m| m as f64);
                    }
                    if include_start_time {
                        info.start_time = get_start_time(pid);
                    }

                    let _ = CloseHandle(snapshot);
                    return Some(info);
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    None
}
