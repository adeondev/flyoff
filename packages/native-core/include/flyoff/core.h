#pragma once

#include <cstdint>
#include <string_view>

namespace flyoff {

struct CoreHealth {
  std::string_view coreVersion;
  std::uint32_t protocolVersion;
};

[[nodiscard]] CoreHealth health() noexcept;

}
