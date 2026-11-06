//! Builds the crate again where a migration changes, which `sqlx::migrate!` embeds.

fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
