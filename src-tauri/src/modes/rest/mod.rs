// REST mode — owns collection / request / environment CRUD against app
// SQLite, the HTTP executor that runs saved or ad-hoc requests, the
// request-history aggregate, and the Postman / cURL / Clauge-format
// importers and exporters.
//
// `collections`, `requests`, `environments`, `history`, `http_executor`,
// and `import_export` host `#[tauri::command]` handlers; lib.rs
// references them as `crate::modes::rest::<file>::*`.

pub mod collections;
pub mod environments;
pub mod history;
pub mod http_executor;
pub mod import_export;
pub mod requests;
