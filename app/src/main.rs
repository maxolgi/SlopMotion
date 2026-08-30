#![cfg_attr(
    all(feature = "gui", target_os = "windows"),
    windows_subsystem = "windows"
)]

mod osc_out;
mod server;
mod ws;

#[cfg(feature = "gui")]
mod gui;

use clap::Parser;

#[derive(Parser, Clone)]
#[command(
    name = "slopmotion",
    about = "slopmotion — OSC modulator streaming to a shader app over UDP"
)]
pub struct Cli {
    #[arg(short, long, default_value = "3000")]
    pub port: u16,

    #[arg(short, long, default_value = "127.0.0.1")]
    pub bind: String,

    #[arg(
        long,
        help = "Open the web UI in the default browser after the server starts"
    )]
    pub open: bool,

    #[arg(
        long,
        help = "Run without the GUI (server-only; suitable for process supervisors)"
    )]
    pub no_gui: bool,
}

fn main() {
    let cli = Cli::parse();
    #[cfg(feature = "gui")]
    {
        if !cli.no_gui {
            gui::run(cli);
            return;
        }
    }
    run_headless(cli);
}

#[tokio::main]
async fn run_headless(cli: Cli) {
    let state = std::sync::Arc::new(server::AppState);
    println!("Starting HTTP server on http://localhost:{}", cli.port);

    let server_task = tokio::spawn(server::run_server(
        state,
        cli.bind.clone(),
        cli.port,
    ));

    // Print readiness once the server is accepting connections; the polling
    // runs on a plain thread so the tokio runtime stays minimal (no "time"
    // feature needed). The browser is only opened when --open is passed.
    let port = cli.port;
    let bind = cli.bind.clone();
    let open_browser = cli.open;
    std::thread::spawn(move || {
        for _ in 0..50 {
            if std::net::TcpStream::connect((bind.as_str(), port)).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        println!("Ready: http://localhost:{port}");
        if let Ok(ip) = local_ip_address::local_ip() {
            println!("LAN:   http://{}:{port}", ip);
        }
        if open_browser {
            let url = format!("http://localhost:{port}");
            if let Err(e) = open::that(&url) {
                eprintln!("Could not open browser: {e}");
            }
        }
    });

    match server_task.await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("server task failed: {e}");
            std::process::exit(1);
        }
    }
}
