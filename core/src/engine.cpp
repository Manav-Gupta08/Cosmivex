#include "universe/engine.h"
#include "universe/process.hpp"
#include "universe/model.hpp"
#include "universe/changes.hpp"
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <mutex>
#include <thread>
#include <type_traits>

using SteadyClock = std::chrono::steady_clock;
using Milliseconds = std::chrono::milliseconds;

static_assert(std::is_standard_layout_v<uos_health>);
static_assert(sizeof(uos_health) == 48);
static_assert(offsetof(uos_health, sequence) == 8);
static_assert(offsetof(uos_health, interval_ms) == 32);
static_assert(sizeof(uos_process_info) == 40);
static_assert(sizeof(uos_process_row) == 72);
static_assert(sizeof(uos_model_info) == 24);
static_assert(sizeof(uos_relationship) == 16);
static_assert(sizeof(uos_galaxy) == 48);
static_assert(sizeof(uos_event_info) == 32);
static_assert(sizeof(uos_event_row) == 64);
static_assert(sizeof(uos_delta_info) == 16);
static_assert(sizeof(uos_change_row) == 24);
static_assert(sizeof(uos_resource_visual) == 8);
static_assert(sizeof(uos_resource_event) == 16);

uint64_t unix_ms() {
    return static_cast<uint64_t>(std::chrono::duration_cast<Milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
}

uint64_t monotonic_ns() {
    return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(SteadyClock::now().time_since_epoch()).count());
}

struct uos_process_snapshot {
    std::shared_ptr<const universe::ProcessSnapshot> value;
};

struct uos_delta { std::vector<uos_change_row> rows; };

struct uos_engine {
    std::mutex mutex;
    std::condition_variable changed;
    bool stopped = false;
    bool collect_processes = false;
    uint64_t configuration_revision = 0;
    SteadyClock::time_point started = SteadyClock::now();
    uos_health latest{UOS_ABI_VERSION, sizeof(uos_health), 0, 0, 0, 2000, UOS_NORMAL, 0, 0};
    std::shared_ptr<const universe::ProcessSnapshot> processes = std::make_shared<universe::ProcessSnapshot>();
    universe::EventJournal journal;
    std::jthread worker;

    uos_engine() {
        publish();
        worker = std::jthread([this](std::stop_token stop) {
            auto collector = universe::make_process_collector();
            universe::ProcessTracker tracker;
            std::unique_lock lock(mutex);
            while (!stopped) {
                const auto revision = configuration_revision;
                if (collect_processes) {
                    lock.unlock();
                    std::shared_ptr<universe::ProcessSnapshot> sampled;
                    try {
                        sampled = std::make_shared<universe::ProcessSnapshot>(tracker.normalize(collector->collect(stop)));
                    } catch (...) {
                        auto failed = std::make_shared<universe::ProcessSnapshot>();
                        failed->error = 8;
                        failed->observed_at_unix_ms = unix_ms();
                        sampled = std::move(failed);
                    }
                    lock.lock();
                    if (stopped) break;
                    if (revision != configuration_revision) {
                        if (!collect_processes) tracker.reset();
                        continue;
                    }
                    sampled->events = journal.observe(*sampled, monotonic_ns());
                    processes = std::move(sampled);
                    publish();
                    changed.notify_all();
                } else { tracker.reset(); }
                const auto interrupted = changed.wait_for(lock, Milliseconds(latest.interval_ms),
                    [this, revision] { return stopped || configuration_revision != revision; });
                if (!interrupted && !collect_processes) {
                    publish();
                    changed.notify_all();
                }
            }
        });
    }

    void update_interval() {
        latest.interval_ms = collect_processes ? (latest.profile == UOS_ECO ? 2000 : 1000)
            : (latest.profile == UOS_ECO ? 5000 : 2000);
    }

    void publish() {
        ++latest.sequence;
        latest.uptime_ms = static_cast<uint64_t>(
            std::chrono::duration_cast<Milliseconds>(SteadyClock::now() - started).count());
        latest.observed_at_unix_ms = static_cast<uint64_t>(
            std::chrono::duration_cast<Milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count());
    }
};

uos_engine* uos_create(uint32_t abi_version, uint32_t health_size) noexcept {
    if (abi_version != UOS_ABI_VERSION || health_size != sizeof(uos_health)) return nullptr;
    try { return new uos_engine; } catch (...) { return nullptr; }
}

int32_t uos_wait(uos_engine* engine, uint64_t after_sequence, uint32_t timeout_ms,
                 uos_health* output, uint32_t output_size) noexcept {
    if (!engine || !output || output_size != sizeof(uos_health) || timeout_ms > 30000) return UOS_INVALID;
    try {
        std::unique_lock lock(engine->mutex);
        engine->changed.wait_for(lock, Milliseconds(timeout_ms), [engine, after_sequence] {
            return engine->stopped || engine->latest.sequence > after_sequence;
        });
        if (engine->stopped) return UOS_STOPPED;
        if (engine->latest.sequence <= after_sequence) return UOS_TIMEOUT;
        *output = engine->latest;
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_set_profile(uos_engine* engine, uint32_t profile) noexcept {
    if (!engine || profile > UOS_CINEMATIC) return UOS_INVALID;
    try {
        std::lock_guard lock(engine->mutex);
        if (engine->stopped) return UOS_STOPPED;
        if (engine->latest.profile == profile) return UOS_FRAME;
        engine->latest.profile = profile;
        engine->update_interval();
        ++engine->configuration_revision;
        engine->publish();
        engine->changed.notify_all();
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_set_process_collection(uos_engine* engine, uint32_t enabled) noexcept {
    if (!engine || enabled > 1) return UOS_INVALID;
    try {
        std::lock_guard lock(engine->mutex);
        if (engine->stopped) return UOS_STOPPED;
        if (engine->collect_processes == (enabled != 0)) return UOS_FRAME;
        engine->collect_processes = enabled != 0;
        engine->latest.enabled_collectors = enabled;
        auto cleared = std::make_shared<universe::ProcessSnapshot>();
        cleared->events = enabled ? engine->journal.current() : engine->journal.pause(unix_ms(), monotonic_ns());
        engine->processes = std::move(cleared);
        engine->update_interval();
        ++engine->configuration_revision;
        engine->publish();
        engine->changed.notify_all();
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_acquire_processes(uos_engine* engine, uint64_t sequence, uos_process_snapshot** output) noexcept {
    if (!engine || !output) return UOS_INVALID;
    *output = nullptr;
    try {
        std::lock_guard lock(engine->mutex);
        if (engine->stopped) return UOS_STOPPED;
        if (sequence != engine->latest.sequence) return UOS_TIMEOUT;
        *output = new uos_process_snapshot{engine->processes};
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_process_info_read(const uos_process_snapshot* snapshot, uos_process_info* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_process_info)) return UOS_INVALID;
    const auto& value = *snapshot->value;
    *output = {UOS_ABI_VERSION, sizeof(uos_process_info), static_cast<uint32_t>(value.processes.size()),
        value.logical_cpus, value.error, value.truncated ? 1u : 0u, value.observed_at_unix_ms, value.duration_ms};
    return UOS_FRAME;
}

int32_t uos_process_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_process_row* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_process_row) || index >= snapshot->value->processes.size()) return UOS_INVALID;
    const auto& row = snapshot->value->processes[index];
    const auto& observation = row.observation;
    const uint32_t available = (observation.creation_filetime ? 1u : 0u)
        | (row.cpu_percent ? 2u : 0u) | (observation.working_set_bytes ? 4u : 0u);
    *output = {observation.creation_filetime.value_or(0), row.generation, observation.working_set_bytes.value_or(0),
        row.cpu_percent.value_or(0), observation.pid, observation.parent_pid, observation.thread_count, available,
        observation.timing_error, observation.memory_error, observation.name.data(), static_cast<uint32_t>(observation.name.size()), 0};
    return UOS_FRAME;
}

void uos_release_processes(uos_process_snapshot* snapshot) noexcept { delete snapshot; }

int32_t uos_resource_visual_read(const uos_process_snapshot* snapshot, uint32_t index, uos_resource_visual* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_resource_visual) || index >= snapshot->value->processes.size()) return UOS_INVALID;
    const auto& visual = snapshot->value->processes[index].resources;
    *output = {visual.cpu_level, visual.memory_level};
    return UOS_FRAME;
}

int32_t uos_resource_event_read(const uos_process_snapshot* snapshot, uint32_t index, uos_resource_event* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_resource_event) || !snapshot->value->events
        || index >= snapshot->value->events->events.size()) return UOS_INVALID;
    const auto& event = snapshot->value->events->events[index];
    if (!event.resource_value || !event.resource_threshold) return UOS_INVALID;
    *output = {*event.resource_value, *event.resource_threshold};
    return UOS_FRAME;
}

int32_t uos_event_info_read(const uos_process_snapshot* snapshot, uos_event_info* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_event_info)) return UOS_INVALID;
    const auto& events = snapshot->value->events;
    *output = {UOS_ABI_VERSION, sizeof(uos_event_info), events ? static_cast<uint32_t>(events->events.size()) : 0u, 0,
        events ? events->last_sequence : 0, events ? events->evicted_count : 0};
    return UOS_FRAME;
}

int32_t uos_event_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_event_row* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_event_row) || !snapshot->value->events
        || index >= snapshot->value->events->events.size()) return UOS_INVALID;
    const auto& event = snapshot->value->events->events[index];
    *output = {event.sequence, event.observed_at_unix_ms, event.previous_observed_at_unix_ms, event.monotonic_ns, event.generation,
        event.pid, static_cast<uint32_t>(event.kind), static_cast<uint32_t>(event.reason), static_cast<uint32_t>(event.name.size()), event.name.data()};
    return UOS_FRAME;
}

int32_t uos_delta_create(const uos_process_snapshot* base, const uos_process_snapshot* current, uos_delta** output) noexcept {
    if (!current || !output) return UOS_INVALID;
    *output = nullptr;
    try {
        const auto changes = universe::diff_snapshots(base ? base->value.get() : nullptr, *current->value);
        auto result = std::make_unique<uos_delta>();
        result->rows.reserve(changes.process_upserts.size() + changes.process_removals.size() + changes.galaxy_upserts.size() + changes.galaxy_removals.size());
        for (const auto index : changes.process_upserts) result->rows.push_back({0, index, 0, 0, 0});
        for (const auto& identity : changes.process_removals) result->rows.push_back({1, 0, identity.pid, 0, identity.generation});
        for (const auto index : changes.galaxy_upserts) result->rows.push_back({2, index, 0, 0, 0});
        for (const auto& identity : changes.galaxy_removals) result->rows.push_back({3, 0, identity.pid, 0, identity.generation});
        *output = result.release();
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_delta_info_read(const uos_delta* delta, uos_delta_info* output, uint32_t size) noexcept {
    if (!delta || !output || size != sizeof(uos_delta_info)) return UOS_INVALID;
    *output = {UOS_ABI_VERSION, sizeof(uos_delta_info), static_cast<uint32_t>(delta->rows.size()), 0};
    return UOS_FRAME;
}

int32_t uos_delta_row_read(const uos_delta* delta, uint32_t index, uos_change_row* output, uint32_t size) noexcept {
    if (!delta || !output || size != sizeof(uos_change_row) || index >= delta->rows.size()) return UOS_INVALID;
    *output = delta->rows[index];
    return UOS_FRAME;
}

void uos_delta_release(uos_delta* delta) noexcept { delete delta; }

int32_t uos_model_info_read(const uos_process_snapshot* snapshot, uos_model_info* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_model_info)) return UOS_INVALID;
    const auto& model = snapshot->value->universe;
    *output = {UOS_ABI_VERSION, sizeof(uos_model_info), model ? static_cast<uint32_t>(model->galaxies.size()) : 0u, 0,
        model ? model->build_ms : 0};
    return UOS_FRAME;
}

int32_t uos_relationship_read(const uos_process_snapshot* snapshot, uint32_t index, uos_relationship* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_relationship) || !snapshot->value->universe
        || index >= snapshot->value->universe->relationships.size()) return UOS_INVALID;
    const auto& relation = snapshot->value->universe->relationships[index];
    *output = {relation.parent_index, static_cast<uint32_t>(relation.status), relation.galaxy_index, relation.depth};
    return UOS_FRAME;
}

int32_t uos_galaxy_read(const uos_process_snapshot* snapshot, uint32_t index, uos_galaxy* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_galaxy) || !snapshot->value->universe
        || index >= snapshot->value->universe->galaxies.size()) return UOS_INVALID;
    const auto& galaxy = snapshot->value->universe->galaxies[index];
    const auto& root = snapshot->value->processes[galaxy.root_index].observation;
    *output = {galaxy.root_index, galaxy.process_count, galaxy.cpu_sample_count, galaxy.memory_sample_count,
        galaxy.cpu_percent, galaxy.working_set_bytes, root.executable_path ? root.executable_path->data() : nullptr,
        root.executable_path ? static_cast<uint32_t>(root.executable_path->size()) : 0u, root.image_error};
    return UOS_FRAME;
}

void uos_stop(uos_engine* engine) noexcept {
    if (!engine) return;
    try {
        std::lock_guard lock(engine->mutex);
        engine->stopped = true;
        engine->worker.request_stop();
        engine->changed.notify_all();
    } catch (...) {}
}

void uos_destroy(uos_engine* engine) noexcept {
    if (!engine) return;
    uos_stop(engine);
    try { delete engine; } catch (...) {}
}