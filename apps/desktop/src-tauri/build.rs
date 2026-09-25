fn main() {
    let core = std::path::Path::new("../../../core");
    println!("cargo:rerun-if-changed={}", core.display());
    let target_features = std::env::var("CARGO_CFG_TARGET_FEATURE").unwrap_or_default();
    let runtime = if target_features
        .split(',')
        .any(|feature| feature == "crt-static")
    {
        "MultiThreaded"
    } else {
        "MultiThreadedDLL"
    };
    let native = cmake::Config::new(core)
        .define("UOS_BUILD_TESTS", "OFF")
        .define("CMAKE_MSVC_RUNTIME_LIBRARY", runtime)
        .build();
    println!("cargo:rustc-link-search=native={}/lib", native.display());
    println!("cargo:rustc-link-lib=static=universe_core");
    println!("cargo:rustc-link-lib=iphlpapi");
    println!("cargo:rustc-link-lib=ws2_32");
    tauri_build::build();
}
