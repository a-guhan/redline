use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path};
use std::process::Command;
use std::thread;

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn serve(mut stream: TcpStream, root: &Path) {
    let mut request = [0_u8; 8192];
    let Ok(length) = stream.read(&mut request) else { return };
    let request_line = String::from_utf8_lossy(&request[..length]);
    let Some(line) = request_line.lines().next() else { return };
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/").split('?').next().unwrap_or("/");
    if method != "GET" && method != "HEAD" {
        respond(&mut stream, "405 Method Not Allowed", "text/plain; charset=utf-8", b"Method not allowed");
        return;
    }

    let relative = path.trim_start_matches('/');
    let relative = if relative.is_empty() { "index.html" } else { relative };
    let relative_path = Path::new(relative);
    if relative_path.components().any(|part| !matches!(part, Component::Normal(_))) {
        respond(&mut stream, "400 Bad Request", "text/plain; charset=utf-8", b"Invalid path");
        return;
    }
    let full_path = root.join(relative_path);
    let Ok(canonical) = full_path.canonicalize() else {
        respond(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found");
        return;
    };
    if !canonical.starts_with(root) {
        respond(&mut stream, "403 Forbidden", "text/plain; charset=utf-8", b"Forbidden");
        return;
    }
    let Ok(body) = fs::read(&canonical) else {
        respond(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found");
        return;
    };
    let header = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\n\r\n",
        content_type(&canonical), body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    if method != "HEAD" { let _ = stream.write_all(&body); }
}

fn open_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let commands = ["open", "xdg-open"];
    #[cfg(target_os = "linux")]
    let commands = ["xdg-open", "open"];
    #[cfg(target_os = "windows")]
    let commands = ["cmd"];
    for command in commands {
        let mut process = Command::new(command);
        if command == "cmd" {
            process.args(["/C", "start", "", url]);
        } else {
            process.arg(url);
        }
        if process.spawn().is_ok() { break; }
    }
}

fn main() -> std::io::Result<()> {
    let root = env::current_dir()?.canonicalize()?;
    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let first_port = env::var("PORT").ok().and_then(|value| value.parse::<u16>().ok()).unwrap_or(8000);
    let mut bound = None;
    for port in first_port..=first_port.saturating_add(20) {
        if let Ok(listener) = TcpListener::bind((host.as_str(), port)) {
            bound = Some((listener, port));
            break;
        }
    }
    let Some((listener, port)) = bound else {
        return Err(std::io::Error::new(std::io::ErrorKind::AddrInUse, "No free port in the configured range"));
    };
    let url = format!("http://{host}:{port}");
    println!("REDLINE is running at {url} (Ctrl+C to stop)");
    let browser_url = url.clone();
    thread::spawn(move || {
        thread::sleep(std::time::Duration::from_millis(400));
        open_browser(&browser_url);
    });

    for connection in listener.incoming() {
        match connection {
            Ok(stream) => {
                let document_root = root.clone();
                thread::spawn(move || serve(stream, &document_root));
            }
            Err(error) => eprintln!("Request failed: {error}"),
        }
    }
    Ok(())
}
