use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// Holds the running step's child (ffmpeg, then whisper-cli) so `cancel_transcribe`
// can kill it; `cancelled` also stops an in-flight model download (which has no
// child to kill). Assumes one run at a time (the UI disables start while running).
#[derive(Default)]
struct TranscribeState {
    child: Mutex<Option<CommandChild>>,
    cancelled: AtomicBool,
}

// The Anthropic token lives in the OS keychain, keyed by the app id. It is read
// in Rust when generating a report and never crosses into the webview.
const KEYCHAIN_SERVICE: &str = "com.hissetta.transcriber";
const KEYCHAIN_ACCOUNT: &str = "anthropic-api-token";

// ggml Whisper weights, downloaded on first use into the app data dir.
const MODEL_REPO: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

#[tauri::command]
async fn transcribe(
    app: AppHandle,
    state: tauri::State<'_, TranscribeState>,
    input: String,
    model: String,
    language: Option<String>,
) -> Result<(), String> {
    state.cancelled.store(false, Ordering::Relaxed);

    let model_path = ensure_model(&app, &state, &model).await?;
    if state.cancelled.load(Ordering::Relaxed) {
        return Ok(());
    }

    let wav = std::env::temp_dir().join(format!("transcriber-{}.wav", std::process::id()));
    let outcome = async {
        convert_to_wav(&app, &state, &input, &wav).await?;
        if state.cancelled.load(Ordering::Relaxed) {
            return Ok(());
        }
        let duration = wav_duration_secs(&wav);
        run_whisper(&app, &state, &model, &model_path, &wav, duration, language).await
    }
    .await;
    let _ = std::fs::remove_file(&wav);
    outcome
}

#[tauri::command]
fn cancel_transcribe(state: tauri::State<'_, TranscribeState>) -> Result<(), String> {
    state.cancelled.store(true, Ordering::Relaxed);
    if let Some(child) = state.child.lock().unwrap().take() {
        child.kill().map_err(|err| err.to_string())?;
    }
    Ok(())
}

// Returns the local ggml model path, downloading it from Hugging Face on first
// use. Progress is forwarded to the UI as `transcribe://event`. On cancel it
// stops early; the caller checks `state.cancelled` and won't use the path.
async fn ensure_model(
    app: &AppHandle,
    state: &tauri::State<'_, TranscribeState>,
    model: &str,
) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?.join("models");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let path = dir.join(format!("ggml-{model}.bin"));
    if path.exists() {
        return Ok(path);
    }

    let mut response = reqwest::Client::new()
        .get(format!("{MODEL_REPO}/ggml-{model}.bin"))
        .send()
        .await
        .map_err(|err| format!("Failed to download model: {err}"))?;
    if !response.status().is_success() {
        return Err(format!("Model download failed ({}): {model}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);

    // Download to a temp name and rename on success, so a partial file is never
    // mistaken for a complete model on the next run.
    let part = path.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|err| err.to_string())?;
    let mut downloaded: u64 = 0;
    let mut last_percent: u64 = 0;
    while let Some(chunk) = response.chunk().await.map_err(|err| err.to_string())? {
        if state.cancelled.load(Ordering::Relaxed) {
            let _ = std::fs::remove_file(&part);
            return Ok(path);
        }
        file.write_all(&chunk).map_err(|err| err.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = (downloaded * 100).checked_div(total).unwrap_or(0);
        if percent != last_percent {
            last_percent = percent;
            emit_event(app, &serde_json::json!({ "type": "download", "percent": percent }))?;
        }
    }
    file.flush().map_err(|err| err.to_string())?;
    // A truncated stream can end as Ok(None); don't cache a short file as complete.
    if total > 0 && downloaded != total {
        let _ = std::fs::remove_file(&part);
        return Err(format!("Model download incomplete: {downloaded}/{total} bytes"));
    }
    std::fs::rename(&part, &path).map_err(|err| err.to_string())?;
    Ok(path)
}

// whisper.cpp's CLI reads 16 kHz mono PCM, so decode any input to that first.
// `-fflags +bitexact` drops ffmpeg's metadata chunk so the header stays 44 bytes
// (see `wav_duration_secs`).
async fn convert_to_wav(
    app: &AppHandle,
    state: &tauri::State<'_, TranscribeState>,
    input: &str,
    wav: &Path,
) -> Result<(), String> {
    let args = vec![
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-fflags".into(),
        "+bitexact".into(),
        "-i".into(),
        input.to_string(),
        "-ar".into(),
        "16000".into(),
        "-ac".into(),
        "1".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        wav.to_string_lossy().into_owned(),
    ];
    let (mut events, child) = app
        .shell()
        .command("ffmpeg")
        .args(args)
        .spawn()
        .map_err(|err| format!("Failed to start ffmpeg: {err}"))?;
    *state.child.lock().unwrap() = Some(child);

    let mut stderr = String::new();
    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stderr(line) => stderr.push_str(&String::from_utf8_lossy(&line)),
            CommandEvent::Error(err) => stderr.push_str(&err),
            CommandEvent::Terminated(payload) => {
                *state.child.lock().unwrap() = None;
                if state.cancelled.load(Ordering::Relaxed) {
                    return Ok(());
                }
                if payload.code != Some(0) {
                    let detail = stderr.trim();
                    return Err(if detail.is_empty() {
                        format!("ffmpeg exited with code {:?}", payload.code)
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

// 16 kHz mono 16-bit PCM is 32000 bytes/sec after the 44-byte WAV header.
fn wav_duration_secs(wav: &Path) -> f64 {
    let len = std::fs::metadata(wav).expect("ffmpeg just wrote this wav").len();
    len.saturating_sub(44) as f64 / 32000.0
}

// Spawn whisper-cli and translate its output into the `start` / `segment` / `done`
// events the UI already understands (one error channel: the returned Err).
async fn run_whisper(
    app: &AppHandle,
    state: &tauri::State<'_, TranscribeState>,
    model: &str,
    model_path: &Path,
    wav: &Path,
    duration: f64,
    language: Option<String>,
) -> Result<(), String> {
    // whisper.cpp is memory-bandwidth bound; more than ~8 threads rarely helps.
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let args = vec![
        "-m".into(),
        model_path.to_string_lossy().into_owned(),
        "-f".into(),
        wav.to_string_lossy().into_owned(),
        "-l".into(),
        language.clone().unwrap_or_else(|| "auto".into()),
        "-t".into(),
        threads.to_string(),
    ];
    let (mut events, child) = app
        .shell()
        .sidecar("whisper-cli")
        .map_err(|err| err.to_string())?
        .args(args)
        .spawn()
        .map_err(|err| format!("Failed to start transcription: {err}"))?;
    *state.child.lock().unwrap() = Some(child);

    // Emit `start` as soon as the language is known: up front when forced, or off
    // the stderr detection line when auto. Falls back to "auto" on the first
    // segment if the detection line was never seen.
    let mut started = false;
    if let Some(language) = &language {
        emit_start(app, model, language, duration)?;
        started = true;
    }
    let mut stderr = String::new();
    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let line = String::from_utf8_lossy(&line);
                if let Some(segment) = parse_segment(line.trim()) {
                    if !started {
                        emit_start(app, model, "auto", duration)?;
                        started = true;
                    }
                    emit_event(app, &segment)?;
                }
            }
            CommandEvent::Stderr(line) => {
                let line = String::from_utf8_lossy(&line);
                if !started {
                    if let Some(language) = parse_detected_language(&line) {
                        emit_start(app, model, &language, duration)?;
                        started = true;
                    }
                }
                stderr.push_str(&line);
            }
            CommandEvent::Error(err) => stderr.push_str(&err),
            CommandEvent::Terminated(payload) => {
                *state.child.lock().unwrap() = None;
                if state.cancelled.load(Ordering::Relaxed) {
                    return Ok(());
                }
                if payload.code != Some(0) {
                    let detail = stderr.trim();
                    return Err(if detail.is_empty() {
                        format!("Transcription exited with code {:?}", payload.code)
                    } else {
                        detail.to_string()
                    });
                }
                emit_event(app, &serde_json::json!({ "type": "done" }))?;
            }
            _ => {}
        }
    }
    Ok(())
}

fn emit_start(app: &AppHandle, model: &str, language: &str, duration: f64) -> Result<(), String> {
    emit_event(app, &serde_json::json!({
        "type": "start", "model": model, "language": language, "duration": duration,
    }))
}

fn emit_event(app: &AppHandle, event: &serde_json::Value) -> Result<(), String> {
    app.emit("transcribe://event", event.to_string()).map_err(|err| err.to_string())
}

// `[hh:mm:ss.mmm --> hh:mm:ss.mmm]   text` → a segment event.
fn parse_segment(line: &str) -> Option<serde_json::Value> {
    let (span, text) = line.strip_prefix('[')?.split_once(']')?;
    let (start, end) = span.split_once("-->")?;
    Some(serde_json::json!({
        "type": "segment",
        "start": parse_timestamp(start.trim())?,
        "end": parse_timestamp(end.trim())?,
        "text": text.trim(),
    }))
}

fn parse_timestamp(timestamp: &str) -> Option<f64> {
    let (hours, rest) = timestamp.split_once(':')?;
    let (minutes, seconds) = rest.split_once(':')?;
    Some(hours.parse::<f64>().ok()? * 3600.0 + minutes.parse::<f64>().ok()? * 60.0 + seconds.parse::<f64>().ok()?)
}

// `whisper_full_with_state: auto-detected language: cs (p = 0.76)` → "cs".
fn parse_detected_language(line: &str) -> Option<String> {
    let after = line.split("auto-detected language:").nth(1)?;
    Some(after.split_whitespace().next()?.to_string())
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
        .manage(TranscribeState::default())
        .invoke_handler(tauri::generate_handler![
            transcribe,
            cancel_transcribe,
            save_token,
            has_token,
            generate_report,
            export_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
