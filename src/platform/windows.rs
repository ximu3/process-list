use super::foreground_query::{Observation, retry};
use crate::{Foreground, Process};
use std::{io, mem::size_of};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_WINDOW_HANDLE, ERROR_NO_MORE_FILES,
    ERROR_SUCCESS, FILETIME, GetLastError, HANDLE, SetLastError,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
use windows::core::{HRESULT, PWSTR};

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: This wrapper owns a successful API result and closes it exactly once.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

fn io_error(error: windows::core::Error) -> io::Error {
    io::Error::from_raw_os_error(error.code().0 & 0xffff)
}

pub fn list_processes(pids: Option<&[u32]>) -> io::Result<Vec<Process>> {
    if pids.is_some_and(<[u32]>::is_empty) {
        return Ok(Vec::new());
    }
    // SAFETY: Flags request a process snapshot; the returned handle is owned below.
    let snapshot =
        OwnedHandle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.map_err(io_error)?);
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut result = Vec::new();
    // SAFETY: Snapshot is live and entry has the required size and valid writable storage.
    let mut next = unsafe { Process32FirstW(snapshot.0, &mut entry) };
    loop {
        match next {
            Ok(()) => {
                if pids.is_none_or(|pids| pids.contains(&entry.th32ProcessID)) {
                    result.push(read_entry(&entry));
                }
            }
            Err(error) if error.code() == HRESULT::from_win32(ERROR_NO_MORE_FILES.0) => break,
            Err(error) => return Err(io_error(error)),
        }
        // SAFETY: The snapshot and entry remain valid throughout iteration.
        next = unsafe { Process32NextW(snapshot.0, &mut entry) };
    }
    Ok(result)
}

pub fn get_process(pid: u32) -> io::Result<Option<Process>> {
    Ok(list_processes(Some(&[pid]))?.into_iter().next())
}

fn read_entry(entry: &PROCESSENTRY32W) -> Process {
    let mut process = Process::new(entry.th32ProcessID);
    let length = entry
        .szExeFile
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(entry.szExeFile.len());
    process.name = (length > 0).then(|| String::from_utf16_lossy(&entry.szExeFile[..length]));
    process.parent_pid = Some(entry.th32ParentProcessID);
    // SAFETY: The PID comes from the snapshot. No handle inheritance or write access is requested.
    let Ok(handle) =
        (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process.pid) })
    else {
        return process;
    };
    let handle = OwnedHandle(handle);
    process.executable_path = executable_path(&handle);
    let mut counters = PROCESS_MEMORY_COUNTERS {
        cb: size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ..Default::default()
    };
    // SAFETY: Counters has the size passed to the API and the process handle is live.
    if unsafe { K32GetProcessMemoryInfo(handle.0, &mut counters, counters.cb) }.as_bool() {
        process.memory_bytes = Some(counters.WorkingSetSize as u64);
    }
    let (mut creation, mut exit, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // SAFETY: All four FILETIME output pointers refer to initialized, writable values.
    if unsafe { GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user) }
        .is_ok()
    {
        process.started_at = filetime_ms(creation);
    }
    process
}

fn executable_path(handle: &OwnedHandle) -> Option<String> {
    let mut buffer = vec![0u16; 512];
    loop {
        let mut length = buffer.len() as u32;
        // SAFETY: The buffer contains length writable UTF-16 units; handle remains live.
        match unsafe {
            QueryFullProcessImageNameW(
                handle.0,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut length,
            )
        } {
            Ok(()) => return Some(String::from_utf16_lossy(&buffer[..length as usize])),
            Err(error)
                if error.code() == HRESULT::from_win32(ERROR_INSUFFICIENT_BUFFER.0)
                    && buffer.len() < 32768 =>
            {
                buffer.resize((buffer.len() * 2).min(32768), 0);
            }
            Err(_) => return None,
        }
    }
}

fn filetime_ms(time: FILETIME) -> Option<f64> {
    let ticks = (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime);
    ticks
        .checked_sub(116_444_736_000_000_000)
        .map(|ticks| ticks as f64 / 10_000.0)
}

pub fn foreground() -> io::Result<Foreground> {
    retry(observe_foreground)
}

fn observe_foreground() -> io::Result<Observation> {
    // SAFETY: This read-only API has no pointer arguments or ownership transfer.
    let window = unsafe { GetForegroundWindow() };
    if window.0.is_null() {
        return Ok(Observation::Stable(Foreground::None { source: "win32" }));
    }
    let mut pid = 0;
    // SAFETY: The API tolerates a window disappearing; pid is valid writable storage.
    let thread = unsafe {
        SetLastError(ERROR_SUCCESS);
        GetWindowThreadProcessId(window, Some(&mut pid))
    };
    if thread == 0 {
        // SAFETY: Read the calling thread's last error immediately after the failed query.
        let error = unsafe { GetLastError() };
        if error == ERROR_INVALID_WINDOW_HANDLE {
            return Ok(Observation::Changed);
        }
        return Err(if error == ERROR_SUCCESS {
            io::Error::other("GetWindowThreadProcessId failed without an error code")
        } else {
            io::Error::from_raw_os_error(error.0 as i32)
        });
    }
    // SAFETY: This read-only call has no arguments. Detect focus moving during ownership lookup.
    if unsafe { GetForegroundWindow() } != window {
        return Ok(Observation::Changed);
    }
    if pid == 0 {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "The foreground window returned PID zero",
        ))
    } else {
        Ok(Observation::Stable(Foreground::Active {
            pid,
            source: "win32",
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_epoch_conversion_is_checked() {
        assert_eq!(filetime_ms(FILETIME::default()), None);
        let epoch = 116_444_736_000_000_000u64;
        assert_eq!(
            filetime_ms(FILETIME {
                dwLowDateTime: epoch as u32,
                dwHighDateTime: (epoch >> 32) as u32
            }),
            Some(0.0)
        );
    }
}
