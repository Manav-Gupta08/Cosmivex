#pragma once
#include "universe/resources.hpp"
#include <cstdint>
#include <memory>
#include <optional>
#include <stop_token>
#include <string>
#include <unordered_map>
#include <vector>

namespace universe {
inline constexpr uint32_t process_limit = 4096;

struct ProcessObservation {
    uint32_t pid = 0;
    uint32_t parent_pid = 0;
    uint32_t thread_count = 0;
    std::string name;
    std::optional<std::string> executable_path;
    std::optional<uint64_t> creation_filetime;
    std::optional<uint64_t> cpu_ticks;
    std::optional<uint64_t> working_set_bytes;
    uint64_t measured_at_ns = 0;
    uint32_t timing_error = 0;
    uint32_t memory_error = 0;
    uint32_t image_error = 0;
};

struct ProcessCollection {
    std::vector<ProcessObservation> processes;
    uint64_t observed_at_unix_ms = 0;
    uint32_t logical_cpus = 1;
    uint32_t error = 0;
    bool truncated = false;
    double duration_ms = 0;
};

class IProcessCollector {
public:
    virtual ~IProcessCollector() = default;
    virtual ProcessCollection collect(std::stop_token stop = {}) = 0;
};

std::unique_ptr<IProcessCollector> make_process_collector();

struct ProcessRow {
    ProcessObservation observation;
    uint64_t generation = 0;
    std::optional<double> cpu_percent;
    ResourceVisual resources;
};

struct UniverseModel;
struct EventWindow;
struct ProcessSnapshot {
    std::vector<ProcessRow> processes;
    uint64_t observed_at_unix_ms = 0;
    uint32_t logical_cpus = 1;
    uint32_t error = 0;
    bool truncated = false;
    double duration_ms = 0;
    std::shared_ptr<const UniverseModel> universe;
    std::shared_ptr<const EventWindow> events;
};

class ProcessTracker {
public:
    ProcessSnapshot normalize(ProcessCollection collection);
    void reset() noexcept { previous_.clear(); }
private:
    struct Previous {
        std::optional<uint64_t> creation;
        std::optional<uint64_t> ticks;
        uint64_t measured_at_ns;
        uint64_t generation;
        std::string name;
        ResourceVisual resources;
    };
    std::unordered_map<uint32_t, Previous> previous_;
    uint64_t next_generation_ = 0;
};
}