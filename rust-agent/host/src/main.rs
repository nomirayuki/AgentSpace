use anyhow::Result;
use wasmtime::{Engine, Module, Store, Linker, TypedFunc};

fn main() -> Result<()> {
    let wasm_path = "../plugin/target/wasm32-unknown-unknown/release/agent_plugin.wasm";
    let engine = Engine::default();
    let module = Module::from_file(&engine, wasm_path)?;
    let mut store = Store::new(&engine, ());
    let linker = Linker::new(&engine);
    let instance = linker.instantiate(&mut store, &module)?;
    let f: TypedFunc<i32, i32> = instance.get_typed_func(&mut store, "score_tag")?;
    println!("score(tag=1)={}, tag=2={}", f.call(&mut store, 1)?, f.call(&mut store, 2)?);
    Ok(())
}
