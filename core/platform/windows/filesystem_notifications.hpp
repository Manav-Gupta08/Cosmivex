#pragma once
#include "universe/filesystem.hpp"
#include <cstddef>
#include <span>

namespace universe {
struct DecodedFileChanges { bool gap = false; std::vector<FileEvent> events; };
DecodedFileChanges decode_directory_changes(std::span<const std::byte> bytes);
}