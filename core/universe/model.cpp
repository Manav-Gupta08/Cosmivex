#include "universe/model.hpp"
#include <algorithm>
#include <chrono>
#include <numeric>
#include <unordered_map>

namespace universe {
UniverseModel build_universe(const ProcessSnapshot& snapshot) {
    const auto started = std::chrono::steady_clock::now();
    UniverseModel model;
    const auto& processes = snapshot.processes;
    model.relationships.resize(processes.size());
    model.galaxies.reserve(processes.size());
    std::unordered_map<uint32_t, uint32_t> indices;
    indices.reserve(processes.size());
    for (uint32_t index = 0; index < processes.size(); ++index) indices.emplace(processes[index].observation.pid, index);
    std::vector<uint32_t> ordered(processes.size());
    std::iota(ordered.begin(), ordered.end(), 0u);
    std::sort(ordered.begin(), ordered.end(), [&](uint32_t left, uint32_t right) {
        const auto left_time = processes[left].observation.creation_filetime.value_or(0);
        const auto right_time = processes[right].observation.creation_filetime.value_or(0);
        return left_time == right_time ? processes[left].observation.pid < processes[right].observation.pid : left_time < right_time;
    });
    for (const auto index : ordered) {
        const auto& row = processes[index];
        const auto& process = row.observation;
        auto& relation = model.relationships[index];
        const auto parent = indices.find(process.parent_pid);
        if (process.parent_pid == 0) relation.status = ParentStatus::root;
        else if (process.parent_pid == process.pid) relation.status = ParentStatus::self;
        else if (parent == indices.end()) relation.status = ParentStatus::missing;
        else {
            const auto& candidate = processes[parent->second].observation;
            if (!process.creation_filetime || !candidate.creation_filetime) relation.status = ParentStatus::unavailable;
            else if (*candidate.creation_filetime >= *process.creation_filetime) relation.status = ParentStatus::newer_or_equal;
            else {
                relation.status = ParentStatus::verified;
                relation.parent_index = static_cast<int32_t>(parent->second);
                relation.depth = model.relationships[parent->second].depth + 1;
            }
        }
        bool inherit = false;
        if (relation.parent_index >= 0 && process.executable_path && !process.executable_path->empty()) {
            const auto parent_index = static_cast<uint32_t>(relation.parent_index);
            inherit = processes[parent_index].observation.executable_path == process.executable_path;
            if (inherit) relation.galaxy_index = model.relationships[parent_index].galaxy_index;
        }
        if (!inherit) {
            relation.galaxy_index = static_cast<uint32_t>(model.galaxies.size());
            model.galaxies.push_back(Galaxy{index});
        }
        auto& galaxy = model.galaxies[relation.galaxy_index];
        ++galaxy.process_count;
        if (row.cpu_percent) { ++galaxy.cpu_sample_count; galaxy.cpu_percent += *row.cpu_percent; }
        if (process.working_set_bytes) { ++galaxy.memory_sample_count; galaxy.working_set_bytes += *process.working_set_bytes; }
    }
    model.build_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    return model;
}
}