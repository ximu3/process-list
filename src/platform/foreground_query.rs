use crate::Foreground;
use std::io;

pub enum Observation {
    Stable(Foreground),
    Changed,
}

/// Only changes in focus/ownership are retried. System failures retain their error channel.
pub fn retry(mut observe: impl FnMut() -> io::Result<Observation>) -> io::Result<Foreground> {
    for _ in 0..3 {
        if let Observation::Stable(value) = observe()? {
            return Ok(value);
        }
    }
    Ok(Foreground::Unavailable {
        reason: "changed-during-query",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focus_changes_are_retried_until_a_stable_observation() {
        let mut attempts = 0;
        let value = retry(|| {
            attempts += 1;
            Ok(if attempts == 1 {
                Observation::Changed
            } else {
                Observation::Stable(Foreground::Active {
                    pid: 42,
                    source: "win32",
                })
            })
        })
        .unwrap();
        assert_eq!(attempts, 2);
        assert_eq!(
            value,
            Foreground::Active {
                pid: 42,
                source: "win32"
            }
        );
    }

    #[test]
    fn continuous_focus_changes_are_bounded_and_explicit() {
        let mut attempts = 0;
        let value = retry(|| {
            attempts += 1;
            Ok(Observation::Changed)
        })
        .unwrap();
        assert_eq!(attempts, 3);
        assert_eq!(
            value,
            Foreground::Unavailable {
                reason: "changed-during-query"
            }
        );
    }

    #[test]
    fn system_failures_are_not_retried_or_replaced_with_a_status() {
        let mut attempts = 0;
        let error = retry(|| {
            attempts += 1;
            Err(io::Error::new(io::ErrorKind::TimedOut, "display timed out"))
        })
        .unwrap_err();
        assert_eq!(attempts, 1);
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert_eq!(error.to_string(), "display timed out");
    }
}
