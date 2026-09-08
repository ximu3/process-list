//! Node-API is an adapter; platform code does not depend on the JavaScript runtime.

use crate::{Foreground, Process};
use napi::{Env, Error, Result, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;

#[napi(object)]
pub struct NativeProcess {
    pub pid: u32,
    pub name: Option<String>,
    pub parent_pid: Option<u32>,
    pub executable_path: Option<String>,
    pub memory_bytes: Option<f64>,
    pub started_at: Option<f64>,
}

impl From<Process> for NativeProcess {
    fn from(process: Process) -> Self {
        Self {
            pid: process.pid,
            name: process.name,
            parent_pid: process.parent_pid,
            executable_path: process.executable_path,
            memory_bytes: process.memory_bytes.map(|bytes| bytes as f64),
            started_at: process.started_at,
        }
    }
}

#[napi(object)]
pub struct NativeForeground {
    pub status: String,
    pub pid: Option<u32>,
    pub source: Option<String>,
    pub reason: Option<String>,
}

impl From<Foreground> for NativeForeground {
    fn from(foreground: Foreground) -> Self {
        let (status, pid, source, reason) = match foreground {
            Foreground::Active { pid, source } => ("active", Some(pid), Some(source), None),
            Foreground::None { source } => ("none", None, Some(source), None),
            Foreground::Unavailable { reason } => ("unavailable", None, None, Some(reason)),
        };
        Self {
            status: status.into(),
            pid,
            source: source.map(str::to_owned),
            reason: reason.map(str::to_owned),
        }
    }
}

fn query_error(error: std::io::Error) -> Error {
    Error::from_reason(error.to_string())
}

pub struct ListTask {
    pids: Option<Vec<u32>>,
}

#[napi]
impl Task for ListTask {
    type Output = Vec<Process>;
    type JsValue = Vec<NativeProcess>;

    fn compute(&mut self) -> Result<Self::Output> {
        crate::list_processes(self.pids.as_deref()).map_err(query_error)
    }

    fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into_iter().map(Into::into).collect())
    }
}

pub struct ProcessTask {
    pid: u32,
}

#[napi]
impl Task for ProcessTask {
    type Output = Option<Process>;
    type JsValue = Option<NativeProcess>;

    fn compute(&mut self) -> Result<Self::Output> {
        crate::get_process(self.pid).map_err(query_error)
    }

    fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(Into::into))
    }
}

pub struct ForegroundTask;

#[napi]
impl Task for ForegroundTask {
    type Output = Foreground;
    type JsValue = NativeForeground;

    fn compute(&mut self) -> Result<Self::Output> {
        crate::get_foreground().map_err(query_error)
    }

    fn resolve(&mut self, _: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

#[napi]
pub fn list_processes(pids: Option<Vec<u32>>) -> AsyncTask<ListTask> {
    AsyncTask::new(ListTask { pids })
}

#[napi]
pub fn list_processes_sync(pids: Option<Vec<u32>>) -> Result<Vec<NativeProcess>> {
    crate::list_processes(pids.as_deref())
        .map(|processes| processes.into_iter().map(Into::into).collect())
        .map_err(query_error)
}

#[napi]
pub fn get_process(pid: u32) -> AsyncTask<ProcessTask> {
    AsyncTask::new(ProcessTask { pid })
}

#[napi]
pub fn get_process_sync(pid: u32) -> Result<Option<NativeProcess>> {
    crate::get_process(pid)
        .map(|process| process.map(Into::into))
        .map_err(query_error)
}

#[napi]
pub fn get_foreground() -> AsyncTask<ForegroundTask> {
    AsyncTask::new(ForegroundTask)
}

#[napi]
pub fn get_foreground_sync() -> Result<NativeForeground> {
    crate::get_foreground().map(Into::into).map_err(query_error)
}
