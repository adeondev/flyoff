#include <napi.h>

#include "flyoff/core.h"

namespace {

Napi::Value health(const Napi::CallbackInfo& info) {
  const Napi::Env env = info.Env();
  const flyoff::CoreHealth status = flyoff::health();
  Napi::Object result = Napi::Object::New(env);

  result.Set(
      "coreVersion",
      Napi::String::New(env, status.coreVersion.data(), status.coreVersion.size()));
  result.Set(
      "protocolVersion",
      Napi::Number::New(env, status.protocolVersion));

  return result;
}

Napi::Object initialize(Napi::Env env, Napi::Object exports) {
  exports.Set("health", Napi::Function::New(env, health, "health"));
  return exports;
}

}

NODE_API_MODULE(flyoff_native_core, initialize)
