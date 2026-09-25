#include "universe/process.hpp"
#include "universe/model.hpp"
#include <algorithm>
#include <utility>

namespace universe {
ProcessSnapshot ProcessTracker::normalize(ProcessCollection collection) {
    ProcessSnapshot snapshot;
    snapshot.observed_at_unix_ms = collection.observed_at_unix_ms;
    snapshot.logical_cpus = collection.logical_cpus;
    snapshot.error = collection.error;
    snapshot.truncated = collection.truncated;
    snapshot.duration_ms = collection.duration_ms;
    std::unordered_map<uint32_t, Previous> next;
    if (collection.error != 0) {
        previous_.clear();
        return snapshot;
    }
    if (collection.processes.size() > process_limit) {
        collection.processes.resize(process_limit);
        snapshot.truncated = true;
    }
    snapshot.processes.reserve(collection.processes.size());
    next.reserve(collection.processes.size());
    for (auto& observation : collection.processes) {
        if (next.contains(observation.pid)) continue;
        const auto found = previous_.find(observation.pid);
        const bool same = found != previous_.end()
            && found->second.creation == observation.creation_filetime
            && (observation.creation_filetime || found->second.name == observation.name);
        const auto generation = same ? found->second.generation : ++next_generation_;
        std::optional<double> cpu;
        if (same && observation.creation_filetime && observation.cpu_ticks && found->second.ticks
            && observation.measured_at_ns > found->second.measured_at_ns
            && *observation.cpu_ticks >= *found->second.ticks && collection.logical_cpus > 0) {
            const double elapsed = static_cast<double>(observation.measured_at_ns - found->second.measured_at_ns);
            const double ticks = static_cast<double>(*observation.cpu_ticks - *found->second.ticks);
            cpu = std::clamp(ticks * 10000.0 / elapsed / collection.logical_cpus, 0.0, 100.0);
        }
        const auto resources = map_resources(cpu, observation.working_set_bytes, same ? &found->second.resources : nullptr);
        next.emplace(observation.pid, Previous{observation.creation_filetime, observation.cpu_ticks,
            observation.measured_at_ns, generation, observation.name, resources});
        snapshot.processes.push_back(ProcessRow{std::move(observation), generation, cpu, resources});
    }
    previous_ = std::move(next);
    std::sort(snapshot.processes.begin(), snapshot.processes.end(), [](const auto& left, const auto& right) {
        return left.observation.pid < right.observation.pid;
    });
    snapshot.universe = std::make_shared<UniverseModel>(build_universe(snapshot));
    return snapshot;
}
}