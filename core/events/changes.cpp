#include "universe/changes.hpp"
#include "universe/model.hpp"

namespace universe {
void EventJournal::append(EventKind kind, EventReason reason, uint64_t time, uint64_t monotonic, uint32_t pid, uint64_t generation, const std::string& name, std::optional<double> value, std::optional<double> threshold) {
    if (events_.size() == recent_event_limit) { events_.pop_front(); ++evicted_; }
    events_.push_back({++sequence_, time, previous_time_, monotonic, generation, pid, kind, reason, name, value, threshold});
}

std::shared_ptr<const EventWindow> EventJournal::window() const {
    auto result = std::make_shared<EventWindow>();
    result->events.assign(events_.begin(), events_.end());
    result->last_sequence = sequence_;
    result->evicted_count = evicted_;
    return result;
}

std::shared_ptr<const EventWindow> EventJournal::pause(uint64_t time, uint64_t monotonic) {
    append(EventKind::paused, EventReason::configuration, time, monotonic);
    previous_.clear();
    baseline_ = false;
    interrupted_ = false;
    previous_time_ = 0;
    return window();
}

std::shared_ptr<const EventWindow> EventJournal::observe(const ProcessSnapshot& snapshot, uint64_t monotonic) {
    const auto time = snapshot.observed_at_unix_ms;
    if (snapshot.error != 0 || snapshot.truncated) {
        if (!interrupted_) append(EventKind::gap, EventReason::incomplete, time, monotonic);
        interrupted_ = true;
        baseline_ = false;
        previous_.clear();
        previous_time_ = 0;
        return window();
    }
    std::unordered_map<uint32_t, Previous> next;
    next.reserve(snapshot.processes.size());
    if (!baseline_) append(EventKind::baseline, EventReason::observation, time, monotonic);
    for (const auto& row : snapshot.processes) {
        const auto& process = row.observation;
        const auto found = previous_.find(process.pid);
        if (baseline_) {
            if (found == previous_.end()) {
                append(EventKind::created, EventReason::observation, time, monotonic, process.pid, row.generation, process.name);
            } else if (found->second.generation != row.generation) {
                if (found->second.creation && process.creation_filetime && found->second.creation != process.creation_filetime) {
                    append(EventKind::terminated, EventReason::observation, time, monotonic, found->second.pid, found->second.generation, found->second.name);
                    append(EventKind::created, EventReason::observation, time, monotonic, process.pid, row.generation, process.name);
                } else {
                    append(EventKind::updated, EventReason::identity, time, monotonic, process.pid, row.generation, process.name);
                }
            } else if (found->second.name != process.name || found->second.parent_pid != process.parent_pid || found->second.threads != process.thread_count) {
                append(EventKind::updated, EventReason::metadata, time, monotonic, process.pid, row.generation, process.name);
            }
        }
        auto spikes = found != previous_.end() && found->second.generation == row.generation ? found->second.spikes : CpuSpikeDetector{};
        if (spikes.observe(row.cpu_percent, monotonic) && baseline_) {
            append(EventKind::resource_spike, EventReason::cpu_sustained, time, monotonic, process.pid, row.generation, process.name, row.cpu_percent, spike_enter_cpu);
        }
        next.emplace(process.pid, Previous{row.generation, process.creation_filetime, process.pid, process.parent_pid, process.thread_count, process.name, spikes});
    }
    if (baseline_) {
        for (const auto& [pid, process] : previous_) {
            if (!next.contains(pid)) append(EventKind::terminated, EventReason::observation, time, monotonic, pid, process.generation, process.name);
        }
    }
    previous_ = std::move(next);
    previous_time_ = time;
    baseline_ = true;
    interrupted_ = false;
    return window();
}

namespace {
uint64_t parent_generation(const ProcessSnapshot& snapshot, size_t index) {
    if (!snapshot.universe) return 0;
    const auto parent = snapshot.universe->relationships[index].parent_index;
    return parent < 0 ? 0 : snapshot.processes[static_cast<size_t>(parent)].generation;
}

uint64_t group_generation(const ProcessSnapshot& snapshot, size_t index) {
    if (!snapshot.universe) return 0;
    const auto group = snapshot.universe->relationships[index].galaxy_index;
    return snapshot.processes[snapshot.universe->galaxies[group].root_index].generation;
}

bool same_process(const ProcessSnapshot& base, size_t before_index, const ProcessSnapshot& current, size_t index) {
    const auto& before = base.processes[before_index];
    const auto& after = current.processes[index];
    const auto& left = before.observation;
    const auto& right = after.observation;
    if (left.pid != right.pid || left.parent_pid != right.parent_pid || left.thread_count != right.thread_count
        || left.name != right.name || left.creation_filetime != right.creation_filetime
        || left.working_set_bytes != right.working_set_bytes || before.cpu_percent != after.cpu_percent
        || before.resources != after.resources
        || left.timing_error != right.timing_error || left.memory_error != right.memory_error
        || parent_generation(base, before_index) != parent_generation(current, index)
        || group_generation(base, before_index) != group_generation(current, index)) return false;
    if (static_cast<bool>(base.universe) != static_cast<bool>(current.universe)) return false;
    if (base.universe) {
        const auto& old_relation = base.universe->relationships[before_index];
        const auto& new_relation = current.universe->relationships[index];
        if (old_relation.status != new_relation.status || old_relation.depth != new_relation.depth) return false;
    }
    return true;
}

bool same_galaxy(const ProcessSnapshot& base, size_t before_index, const ProcessSnapshot& current, size_t index) {
    const auto& before = base.universe->galaxies[before_index];
    const auto& after = current.universe->galaxies[index];
    const auto& left = base.processes[before.root_index].observation;
    const auto& right = current.processes[after.root_index].observation;
    return before.process_count == after.process_count && before.cpu_sample_count == after.cpu_sample_count
        && before.memory_sample_count == after.memory_sample_count && before.cpu_percent == after.cpu_percent
        && before.working_set_bytes == after.working_set_bytes && left.name == right.name
        && left.executable_path == right.executable_path && left.image_error == right.image_error;
}
}

ChangeSet diff_snapshots(const ProcessSnapshot* base, const ProcessSnapshot& current) {
    ChangeSet changes;
    std::unordered_map<uint64_t, size_t> previous;
    if (base) for (size_t index = 0; index < base->processes.size(); ++index) previous.emplace(base->processes[index].generation, index);
    for (uint32_t index = 0; index < current.processes.size(); ++index) {
        const auto found = previous.find(current.processes[index].generation);
        if (found == previous.end()) changes.process_upserts.push_back(index);
        else {
            if (!same_process(*base, found->second, current, index)) changes.process_upserts.push_back(index);
            previous.erase(found);
        }
    }
    for (const auto& [generation, index] : previous) changes.process_removals.push_back({base->processes[index].observation.pid, generation});
    previous.clear();
    if (base && base->universe) for (size_t index = 0; index < base->universe->galaxies.size(); ++index) {
        previous.emplace(base->processes[base->universe->galaxies[index].root_index].generation, index);
    }
    if (current.universe) for (uint32_t index = 0; index < current.universe->galaxies.size(); ++index) {
        const auto generation = current.processes[current.universe->galaxies[index].root_index].generation;
        const auto found = previous.find(generation);
        if (found == previous.end()) changes.galaxy_upserts.push_back(index);
        else {
            if (!same_galaxy(*base, found->second, current, index)) changes.galaxy_upserts.push_back(index);
            previous.erase(found);
        }
    }
    for (const auto& [generation, index] : previous) {
        const auto& root = base->processes[base->universe->galaxies[index].root_index];
        changes.galaxy_removals.push_back({root.observation.pid, generation});
    }
    return changes;
}
}