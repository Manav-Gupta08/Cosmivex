#include "universe/resources.hpp"
#include <chrono>
#include <iostream>
#include <limits>
#include <stdexcept>

void check(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}

int main() {
    try {
        const auto missing = universe::map_resources(std::nullopt, std::nullopt);
        check(missing.cpu_level == -1 && missing.memory_level == -1, "missing measurements remain distinct");
        const auto zero = universe::map_resources(0, 0);
        check(zero.cpu_level == 0 && zero.memory_level == 0, "measured zero is known");
        check(universe::map_resources(100, 4ULL * 1024 * 1024 * 1024).memory_level == 31, "4 GiB size cap");
        check(universe::map_resources(100, std::numeric_limits<uint64_t>::max()).cpu_level == 31, "CPU bound");
        check(universe::map_resources(100, std::numeric_limits<uint64_t>::max()).memory_level == 31, "large memory saturates safely");
        check(universe::map_resources(25, 16 * 1024 * 1024).cpu_level == 16, "square-root CPU mapping");
        check(universe::map_resources(25, 16 * 1024 * 1024).memory_level == 4, "logarithmic memory mapping");
        check(universe::map_resources(std::numeric_limits<double>::quiet_NaN(), 0).cpu_level == -1, "invalid CPU not visualized");
        check(universe::map_resources(-1, 0).cpu_level == -1 && universe::map_resources(101, 0).cpu_level == -1, "out-of-range CPU rejected");
        int32_t previous_cpu = 0, previous_memory = 0;
        for (uint32_t index = 0; index <= 1000; ++index) {
            const auto visual = universe::map_resources(index / 10.0, static_cast<uint64_t>(index) * 8 * 1024 * 1024);
            check(visual.cpu_level >= previous_cpu && visual.memory_level >= previous_memory, "mapping monotonic");
            previous_cpu = visual.cpu_level;
            previous_memory = visual.memory_level;
        }
        const universe::ResourceVisual previous{8, 8};
        check(universe::map_resources(100 * (8.6 / 31) * (8.6 / 31), std::nullopt, &previous).cpu_level == 8, "small jitter reuses visual level");
        check(universe::map_resources(100 * (8.8 / 31) * (8.8 / 31), std::nullopt, &previous).cpu_level == 9, "meaningful change crosses hysteresis");
        universe::CpuSpikeDetector spikes;
        check(!spikes.observe(20, 1000000000), "single high sample does not flare");
        check(!spikes.observe(20, 1000000000), "duplicate sample does not advance detector");
        check(spikes.observe(20, 2000000000), "sustained high CPU emits one spike");
        check(!spikes.observe(50, 3000000000), "sustained high does not repeat");
        check(!spikes.observe(8, 4000000000) && !spikes.observe(15, 5000000000), "hysteresis avoids rearming near threshold");
        spikes.observe(5, 6000000000);
        check(!spikes.observe(20, 7000000000) && !spikes.observe(20, 8000000000), "cooldown suppresses rapid repeat");
        check(spikes.observe(20, 33000000000), "rearmed sustained load after cooldown");
        spikes.observe(std::nullopt, 34000000000);
        check(!spikes.observe(20, 64000000000), "missing sample resets sustained requirement");
        check(spikes.observe(20, 65000000000), "fresh sustained evidence after unavailable interval");
        const auto started = std::chrono::steady_clock::now();
        uint64_t checksum = 0;
        for (uint32_t index = 0; index < 100000; ++index) checksum += universe::map_resources(index % 101, static_cast<uint64_t>(index) * 65536).memory_level;
        check(checksum > 0, "mapping benchmark consumed");
        std::cout << "PASS: bounded resource mapping, missing values, hysteresis, sustained spikes/cooldown; 100000 mappings ms="
                  << std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count() << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}