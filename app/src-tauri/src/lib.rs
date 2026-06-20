use std::path::PathBuf;

use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

// The Anthropic token lives in the OS keychain, keyed by the app id. It is read
// in Rust when generating a report and never crosses into the webview.
const KEYCHAIN_SERVICE: &str = "com.hissetta.transcriber";
const KEYCHAIN_ACCOUNT: &str = "anthropic-api-token";

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

fn token_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|err| err.to_string())
}

#[tauri::command]
fn save_token(token: String) -> Result<(), String> {
    token_entry()?.set_password(&token).map_err(|err| err.to_string())
}

#[tauri::command]
fn has_token() -> Result<bool, String> {
    match token_entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(err.to_string()),
    }
}

// Stream a report from the Anthropic Messages API. Only the prompt (system) and
// the transcript (user message) are sent. Text deltas are forwarded to the UI as
// `report://delta`; failures collapse into the returned Err (one error channel).
#[tauri::command]
async fn generate_report(
    app: AppHandle,
    transcript: String,
    prompt: String,
    model: String,
) -> Result<(), String> {
    let token = token_entry()?.get_password().map_err(|err| err.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 8192,
        "stream": true,
        "system": prompt,
        "messages": [{ "role": "user", "content": transcript }],
    });

    let mut response = reqwest::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", token)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("Request to Anthropic failed: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error ({status}): {detail}"));
    }

    // Buffer raw bytes and decode only whole SSE lines, so a multibyte UTF-8
    // character split across two network chunks is never corrupted.
    let mut buffer: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
        buffer.extend_from_slice(&chunk);
        while let Some(newline) = buffer.iter().position(|&byte| byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=newline).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim().strip_prefix("data:") else {
                continue;
            };
            if let Some(text) = parse_delta(data.trim())? {
                app.emit("report://delta", text).map_err(|err| err.to_string())?;
            }
        }
    }
    Ok(())
}

fn parse_delta(data: &str) -> Result<Option<String>, String> {
    let event: serde_json::Value = serde_json::from_str(data).map_err(|err| err.to_string())?;
    match event["type"].as_str() {
        Some("content_block_delta") => Ok(event["delta"]["text"].as_str().map(str::to_owned)),
        Some("error") => Err(event["error"]["message"]
            .as_str()
            .unwrap_or("Anthropic stream error")
            .to_owned()),
        _ => Ok(None),
    }
}

#[tauri::command]
fn export_report(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            transcribe,
            save_token,
            has_token,
            generate_report,
            export_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
