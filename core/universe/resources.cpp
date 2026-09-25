#include "universe/resources.hpp"
#include <algorithm>
#include <cmath>

namespace universe {
namespace {
int32_t quantize(double normalized, int32_t previous) {
    const auto scaled = std::clamp(normalized, 0.0, 1.0) * resource_level_max;
    if (previous >= 0 && previous <= resource_level_max && std::abs(scaled - previous) < 0.75) return previous;
    return static_cast<int32_t>(std::round(scaled));
}
}

ResourceVisual map_resources(std::optional<double> cpu_percent, std::optional<uint64_t> working_set_bytes,
    const ResourceVisual* previous) {
    ResourceVisual result;
    if (cpu_percent && std::isfinite(*cpu_percent) && *cpu_percent >= 0 && *cpu_percent <= 100) {
        result.cpu_level = quantize(std::sqrt(*cpu_percent / 100.0), previous ? previous->cpu_level : -1);
    }
    if (working_set_bytes) {
        const double normalized = std::log1p(static_cast<double>(*working_set_bytes) / (16.0 * 1024 * 1024)) / std::log(257.0);
        result.memory_level = quantize(normalized, previous ? previous->memory_level : -1);
    }
    return result;
}

bool CpuSpikeDetector::observe(std::optional<double> cpu_percent, uint64_t monotonic_ns) {
    if (last_observation_ && monotonic_ns <= *last_observation_) return false;
    last_observation_ = monotonic_ns;
    if (!cpu_percent || !std::isfinite(*cpu_percent) || *cpu_percent < 0 || *cpu_percent > 100) {
        consecutive_high_ = 0;
        active_ = false;
        return false;
    }
    if (*cpu_percent <= spike_exit_cpu) active_ = false;
    if (*cpu_percent < spike_enter_cpu) { consecutive_high_ = 0; return false; }
    consecutive_high_ = std::min(consecutive_high_ + 1, 2u);
    if (active_ || consecutive_high_ < 2 || (last_signal_ && monotonic_ns - *last_signal_ < spike_cooldown_ns)) return false;
    active_ = true;
    last_signal_ = monotonic_ns;
    return true;
}
}