#include "flyoff/core.h"

namespace flyoff {

CoreHealth health() noexcept {
  return {
      .coreVersion = "0.1.0",
      .protocolVersion = 1,
  };
}

}
