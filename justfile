export PORT := env_var_or_default("PORT", "8000")
export HOST := env_var_or_default("HOST", "127.0.0.1")

default:
    @just --list

toolchain:
    rustup toolchain install 1.99.0 --profile minimal --component rustfmt --target wasm32-unknown-unknown

fmt: toolchain
    rustup run 1.99.0 cargo fmt --manifest-path rust/Cargo.toml

build: toolchain
    rustup run 1.99.0 cargo build --locked --manifest-path rust/Cargo.toml --release --target wasm32-unknown-unknown
    cp rust/target/wasm32-unknown-unknown/release/ride_engine.wasm assets/ride_engine.wasm

run: build
    rustup run 1.99.0 cargo run --locked --manifest-path rust/Cargo.toml --release --features server --bin redline-server

test: toolchain
    rustup run 1.99.0 cargo test --locked --manifest-path rust/Cargo.toml --features server
