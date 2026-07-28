use napi_derive::napi;

#[napi(object)]
pub struct CoreHealth {
    #[napi(js_name = "coreVersion")]
    pub core_version: String,
    #[napi(js_name = "protocolVersion")]
    pub protocol_version: u32,
}

#[napi]
pub fn health() -> CoreHealth {
    CoreHealth {
        core_version: "0.1.0".to_owned(),
        protocol_version: 1,
    }
}
