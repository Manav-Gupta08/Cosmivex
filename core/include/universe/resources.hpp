#pragma once
#include <cstdint>
#include <optional>

namespace universe {
inline constexpr int32_t resource_level_max = 31;
inline constexpr double spike_enter_cpu = 10.0;
inline constexpr double spike_exit_cpu = 6.0;
inline constexpr uint64_t spike_cooldown_ns = 30000000000ULL;

struct ResourceVisual {
    int32_t cpu_level = -1;
    int32_t memory_level = -1;
    bool operator==(const ResourceVisual&) const = default;
};

ResourceVisual map_resources(std::optional<double> cpu_percent, std::optional<uint64_t> working_set_bytes,
    const ResourceVisual* previous = nullptr);

class CpuSpikeDetector {
public:
    bool observe(std::optional<double> cpu_percent, uint64_t monotonic_ns);
private:
    uint32_t consecutive_high_ = 0;
    bool active_ = false;
    std::optional<uint64_t> last_observation_;
    std::optional<uint64_t> last_signal_;
};
}