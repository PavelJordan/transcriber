use std::path::PathBuf;

use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

// Dev-only: the project root (where `.venv` and `transcribe.py` live) sits two
// levels above this crate. Shipping resolves the sidecar differently (Phase 5).
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[tauri::command]
async fn transcribe(
    app: AppHandle,
    input: String,
    model: String,
    device: String,
    language: Option<String>,
) -> Result<(), String> {
    let root = repo_root();
    let python = root.join(".venv/bin/python").to_string_lossy().into_owned();
    let script = root.join("transcribe.py").to_string_lossy().into_owned();

    let mut args = vec![
        script,
        input,
        "--json".into(),
        "--model".into(),
        model,
        "--device".into(),
        device,
    ];
    if let Some(language) = language {
        args.push("--language".into());
        args.push(language);
    }

    let (mut events, _child) = app
        .shell()
        .command(python)
        .args(args)
        .spawn()
        .map_err(|err| format!("Failed to start transcription: {err}"))?;

    let mut stderr = String::new();
    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let line = String::from_utf8_lossy(&line);
                let line = line.trim();
                if !line.is_empty() {
                    app.emit("transcribe://event", line).map_err(|err| err.to_string())?;
                }
            }
            CommandEvent::Stderr(line) => stderr.push_str(&String::from_utf8_lossy(&line)),
            CommandEvent::Error(err) => stderr.push_str(&err),
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let detail = stderr.trim();
                    return Err(if detail.is_empty() {
                        format!("Transcription exited with code {:?}", payload.code)
                    } else {
                        detail.to_string()
                    });
                }
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![transcribe])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
