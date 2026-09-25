#pragma once
#include "universe/process.hpp"
#include <deque>

namespace universe {
inline constexpr uint32_t recent_event_limit = 256;
enum class EventKind : uint32_t { baseline = 0, created = 1, terminated = 2, updated = 3, gap = 4, paused = 5 };
enum class EventReason : uint32_t { observation = 0, identity = 1, metadata = 2, incomplete = 3, configuration = 4 };

struct ProcessEvent {
    uint64_t sequence = 0;
    uint64_t observed_at_unix_ms = 0;
    uint64_t previous_observed_at_unix_ms = 0;
    uint64_t monotonic_ns = 0;
    uint64_t generation = 0;
    uint32_t pid = 0;
    EventKind kind = EventKind::baseline;
    EventReason reason = EventReason::observation;
    std::string name;
};

struct EventWindow {
    std::vector<ProcessEvent> events;
    uint64_t last_sequence = 0;
    uint64_t evicted_count = 0;
};

class EventJournal {
public:
    std::shared_ptr<const EventWindow> observe(const ProcessSnapshot& snapshot, uint64_t monotonic_ns);
    std::shared_ptr<const EventWindow> pause(uint64_t observed_at_unix_ms, uint64_t monotonic_ns);
    std::shared_ptr<const EventWindow> current() const { return window(); }
private:
    struct Previous {
        uint64_t generation;
        std::optional<uint64_t> creation;
        uint32_t pid;
        uint32_t parent_pid;
        uint32_t threads;
        std::string name;
    };
    std::unordered_map<uint32_t, Previous> previous_;
    std::deque<ProcessEvent> events_;
    uint64_t sequence_ = 0;
    uint64_t previous_time_ = 0;
    uint64_t evicted_ = 0;
    bool baseline_ = false;
    bool interrupted_ = false;
    void append(EventKind kind, EventReason reason, uint64_t time, uint64_t monotonic, uint32_t pid = 0, uint64_t generation = 0, const std::string& name = {});
    std::shared_ptr<const EventWindow> window() const;
};

struct RemovedIdentity { uint32_t pid; uint64_t generation; };
struct ChangeSet {
    std::vector<uint32_t> process_upserts;
    std::vector<RemovedIdentity> process_removals;
    std::vector<uint32_t> galaxy_upserts;
    std::vector<RemovedIdentity> galaxy_removals;
};
ChangeSet diff_snapshots(const ProcessSnapshot* base, const ProcessSnapshot& current);
}