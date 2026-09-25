#pragma once
#include "universe/process.hpp"

namespace universe {
enum class ParentStatus : uint32_t {
    root = 0, verified = 1, missing = 2, unavailable = 3, newer_or_equal = 4, self = 5
};

struct Relationship {
    int32_t parent_index = -1;
    ParentStatus status = ParentStatus::root;
    uint32_t galaxy_index = 0;
    uint32_t depth = 0;
};

struct Galaxy {
    uint32_t root_index = 0;
    uint32_t process_count = 0;
    uint32_t cpu_sample_count = 0;
    uint32_t memory_sample_count = 0;
    double cpu_percent = 0;
    uint64_t working_set_bytes = 0;
};

struct UniverseModel {
    std::vector<Relationship> relationships;
    std::vector<Galaxy> galaxies;
    double build_ms = 0;
};

UniverseModel build_universe(const ProcessSnapshot& snapshot);
}