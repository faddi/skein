//! File paths in terminal output, Cmd/Ctrl-clicked open
//! (`app/src/terminalPathLinks.ts`). The frontend proposes every stretch
//! of a hovered line that might be a path; this side keeps the ones that
//! exist, so only real files are links, and opens one in the OS default
//! app on click.
//!
//! Neither command is scoped to the room: an agent's screenshots and
//! scratch files live outside the worktree, and those are the paths
//! worth clicking. Opening hands the path to the OS, the same trust the
//! terminal's URL clicks already have; nothing is read into Skein.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

/// The most the frontend sends (`MAX_PATHS`); a bound, not a contract.
const MAX_CANDIDATES: usize = 64;

/// For each candidate, the absolute path it names if that exists, else
/// `None`, in order. Relative candidates resolve against `cwd`, `~/…`
/// against the home directory.
///
/// Async + `spawn_blocking`: a stat on a slow or network mount must not
/// hold the main thread (#171).
#[tauri::command]
pub async fn resolve_terminal_paths(
    cwd: String,
    candidates: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = crate::home_dir();
        candidates
            .iter()
            .take(MAX_CANDIDATES)
            .map(|c| {
                resolve(Path::new(&cwd), home.as_deref(), c)
                    .and_then(|p| p.into_os_string().into_string().ok())
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// Opens `path` with whatever the OS registers for it, off the main
/// thread: the opener spawns a process (`open`, `xdg-open`) or calls
/// `ShellExecute`.
#[tauri::command]
pub async fn open_terminal_path<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    if !Path::new(&path).is_absolute() {
        return Err(format!("not an absolute path: {path}"));
    }
    tracing::info!(path = %path, "open terminal path");
    tauri::async_runtime::spawn_blocking(move || app.opener().open_path(path, None::<&str>))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn resolve(cwd: &Path, home: Option<&Path>, candidate: &str) -> Option<PathBuf> {
    let path = match candidate
        .strip_prefix("~/")
        .or_else(|| candidate.strip_prefix("~\\"))
    {
        Some(rest) => home?.join(rest),
        // `join` with an absolute candidate replaces `cwd` outright.
        None => cwd.join(candidate),
    };
    // Not canonicalized: on Windows that yields a `\\?\` path some
    // handlers refuse, and the OS resolves `..` itself.
    (path.is_absolute() && std::fs::metadata(&path).is_ok()).then_some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/shot.png"), b"png").unwrap();
        dir
    }

    #[test]
    fn absolute_path_that_exists_resolves_to_itself() {
        let dir = tree();
        let abs = dir.path().join("sub/shot.png");
        let got = resolve(Path::new("/nowhere"), None, abs.to_str().unwrap());
        assert_eq!(got, Some(abs));
    }

    #[test]
    fn relative_path_resolves_against_cwd() {
        let dir = tree();
        let got = resolve(dir.path(), None, "sub/shot.png");
        assert_eq!(got, Some(dir.path().join("sub/shot.png")));
        assert_eq!(
            resolve(dir.path(), None, "./sub/../sub/shot.png"),
            Some(dir.path().join("./sub/../sub/shot.png"))
        );
    }

    #[test]
    fn directories_resolve_too() {
        let dir = tree();
        assert_eq!(
            resolve(dir.path(), None, "sub"),
            Some(dir.path().join("sub"))
        );
    }

    #[test]
    fn missing_paths_do_not_resolve() {
        let dir = tree();
        assert_eq!(resolve(dir.path(), None, "and/or"), None);
        assert_eq!(resolve(dir.path(), None, "sub/missing.png"), None);
    }

    #[test]
    fn tilde_resolves_against_home_and_needs_one() {
        let dir = tree();
        assert_eq!(
            resolve(Path::new("/nowhere"), Some(dir.path()), "~/sub/shot.png"),
            Some(dir.path().join("sub/shot.png"))
        );
        assert_eq!(resolve(Path::new("/nowhere"), None, "~/sub/shot.png"), None);
    }

    #[test]
    fn relative_cwd_never_yields_a_relative_path() {
        // A relative result would open against Skein's own process cwd.
        assert_eq!(resolve(Path::new(""), None, "Cargo.toml"), None);
    }
}
