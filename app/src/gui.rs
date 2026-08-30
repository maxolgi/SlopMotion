use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

use eframe::egui;

use crate::Cli;

fn lan_ip() -> Option<String> {
    local_ip_address::local_ip().ok().map(|ip| ip.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct GuiConfig {
    bind: String,
    port: String,
}

fn config_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::PathBuf::from(home).join(".config/slopmotion/gui-config.json"))
}

impl GuiConfig {
    fn load() -> Option<Self> {
        let path = config_path()?;
        let data = std::fs::read_to_string(&path).ok()?;
        serde_json::from_str(&data).ok()
    }

    fn save(&self) {
        let Some(path) = config_path() else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(&path, json);
        }
    }
}

pub fn run(cli: Cli) {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([440.0, 300.0])
            .with_min_inner_size([400.0, 280.0])
            .with_resizable(false)
            .with_title("SlopMotion"),
        ..Default::default()
    };

    let result = eframe::run_native(
        "SlopMotion",
        options,
        Box::new(move |cc| Ok(Box::new(ControlPanel::new(cli, cc)))),
    );

    if let Err(e) = result {
        eprintln!("GUI error: {e:?}");
    }
}

struct ControlPanel {
    rt: Option<tokio::runtime::Runtime>,
    bind: String,
    port: String,
    running: bool,
    open: bool,
    shutdown_tx: Option<futures::channel::oneshot::Sender<()>>,
    server_error_rx: Option<std::sync::mpsc::Receiver<String>>,
    url: String,
    error: Option<String>,
    stats: crate::osc_out::Stats,
    last_stats: Instant,
}

impl ControlPanel {
    fn new(cli: Cli, _cc: &eframe::CreationContext<'_>) -> Self {
        let cfg = GuiConfig::load();
        let mut panel = Self {
            rt: Some(tokio::runtime::Runtime::new().expect("Failed to create tokio runtime")),
            bind: cfg.as_ref().map(|c| c.bind.clone()).unwrap_or(cli.bind),
            port: cfg
                .as_ref()
                .map(|c| c.port.clone())
                .unwrap_or(cli.port.to_string()),
            running: false,
            open: cli.open,
            shutdown_tx: None,
            server_error_rx: None,
            url: String::new(),
            error: None,
            stats: crate::osc_out::stats(),
            last_stats: Instant::now(),
        };
        panel.start_server();
        panel
    }

    fn start_server(&mut self) {
        GuiConfig {
            bind: self.bind.clone(),
            port: self.port.clone(),
        }
        .save();

        let port: u16 = match self.port.parse() {
            Ok(p) => p,
            Err(_) => {
                self.error = Some(format!("Invalid port: {}", self.port));
                return;
            }
        };

        let bind_addr = if self.bind.is_empty() {
            "0.0.0.0".to_string()
        } else {
            self.bind.clone()
        };

        if let Err(e) = std::net::TcpListener::bind((bind_addr.as_str(), port)) {
            self.error = Some(format!(
                "Port {} is in use ({}). Is another SlopMotion running?",
                port, e
            ));
            return;
        }

        let app = crate::server::build_router(std::sync::Arc::new(crate::server::AppState));

        let (shutdown_tx, shutdown_rx) = futures::channel::oneshot::channel::<()>();
        let (err_tx, err_rx) = std::sync::mpsc::channel::<String>();
        let server_bind = bind_addr.clone();
        self.rt.as_ref().expect("runtime").spawn(async move {
            let addr = SocketAddr::new(
                server_bind
                    .parse()
                    .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED)),
                port,
            );
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    let _ = err_tx.send(format!("could not bind to {addr}: {e}"));
                    return;
                }
            };
            if let Err(e) = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await
            {
                let _ = err_tx.send(format!("server error: {e}"));
            }
        });
        self.shutdown_tx = Some(shutdown_tx);
        self.server_error_rx = Some(err_rx);

        let display_ip = if self.bind == "0.0.0.0" || self.bind.is_empty() {
            lan_ip().unwrap_or_else(|| "localhost".to_string())
        } else {
            self.bind.clone()
        };
        self.url = format!("http://{display_ip}:{port}");

        // Open the browser only when opted in via --open, and only once the
        // server is accepting connections; the polling and blocking `open`
        // call run on a plain thread so the GUI and the tokio runtime stay
        // unblocked.
        if self.open {
            let url = self.url.clone();
            let bind = bind_addr.clone();
            std::thread::spawn(move || {
                for _ in 0..50 {
                    if std::net::TcpStream::connect((bind.as_str(), port)).is_ok() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                if let Err(e) = open::that(&url) {
                    eprintln!("Could not open browser: {e}");
                }
            });
        }

        self.running = true;
        self.error = None;
        println!("SlopMotion server started on {}", self.url);
    }

    fn stop_server(&mut self) {
        let was_running = self.running;
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        self.server_error_rx = None;
        // Give the server up to 1s to drain (graceful shutdown stops accepting
        // and ends in-flight /ws connections as their sockets close), then
        // cancel whatever is left so the port frees immediately. The runtime
        // is recreated so Start can bind again on a clean slate.
        if let Some(rt) = self.rt.take() {
            rt.shutdown_timeout(Duration::from_secs(1));
        }
        self.rt = Some(tokio::runtime::Runtime::new().expect("Failed to create tokio runtime"));
        self.running = false;
        self.url.clear();
        if was_running {
            println!("SlopMotion server stopped");
        }
    }
}

impl Drop for ControlPanel {
    fn drop(&mut self) {
        GuiConfig {
            bind: self.bind.clone(),
            port: self.port.clone(),
        }
        .save();
        self.stop_server();
        if let Some(rt) = self.rt.take() {
            rt.shutdown_timeout(Duration::from_secs(1));
        }
    }
}

impl eframe::App for ControlPanel {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Poll for async server startup failures (bind race that slipped past
        // the pre-bind TcpListener probe).
        if let Some(rx) = &self.server_error_rx {
            if let Ok(msg) = rx.try_recv() {
                // stop_server flips running/url; set the error afterwards so
                // it isn't clobbered.
                self.stop_server();
                self.error = Some(msg);
            }
        }

        // Sample OSC stats about once a second.
        if self.last_stats.elapsed() >= Duration::from_secs(1) {
            self.stats = crate::osc_out::stats();
            self.last_stats = Instant::now();
        }
        ctx.request_repaint_after(Duration::from_secs(1));

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("SlopMotion");
            ui.separator();

            if self.running {
                ui.label(format!("Running at {}", self.url));
                ui.label(format!(
                    "OSC: {} msgs sent · {} err",
                    self.stats.messages_sent, self.stats.errors
                ));
                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    if ui.button("Open Browser").clicked() {
                        if let Err(e) = open::that(&self.url) {
                            self.error = Some(format!("Could not open browser: {e}"));
                        }
                    }
                    if ui.button("Stop").clicked() {
                        self.stop_server();
                    }
                });
            } else {
                egui::Grid::new("config_grid")
                    .num_columns(2)
                    .spacing([10.0, 8.0])
                    .show(ui, |ui| {
                        ui.label("Bind");
                        ui.text_edit_singleline(&mut self.bind);
                        ui.end_row();

                        ui.label("Port");
                        ui.text_edit_singleline(&mut self.port);
                        ui.end_row();
                    });

                ui.add_space(12.0);
                if ui.button("Start").clicked() {
                    self.start_server();
                }
            }

            if let Some(err) = &self.error {
                ui.add_space(8.0);
                ui.colored_label(egui::Color32::from_rgb(220, 80, 80), err);
            }
        });
    }
}
