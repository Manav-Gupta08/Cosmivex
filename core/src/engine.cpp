#include "universe/engine.h"
#include "universe/process.hpp"
#include "universe/model.hpp"
#include "universe/changes.hpp"
#include "universe/network.hpp"
#include "universe/filesystem.hpp"
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
static_assert(sizeof(uos_network_info) == 64);
static_assert(sizeof(uos_connection_row) == 72);
static_assert(sizeof(uos_interface_row) == 72);
static_assert(sizeof(uos_filesystem_info) == 96);
static_assert(sizeof(uos_file_entry) == 64);
static_assert(sizeof(uos_file_event) == 48);

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
    struct FileRequest { uint32_t action; std::string root; uint64_t scope; uint64_t entry; };
    std::optional<FileRequest> file_request;
    std::shared_ptr<const universe::FileSystemSnapshot> filesystem = std::make_shared<universe::FileSystemSnapshot>();
    std::mutex mutex;
    std::condition_variable changed;
    bool stopped = false;
    bool collect_processes = false;
    bool collect_network = false;
    SteadyClock::time_point next_network_sample{};
    std::shared_ptr<const universe::NetworkSnapshot> network = std::make_shared<universe::NetworkSnapshot>();
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
            auto network_collector = universe::make_network_collector();
            universe::NetworkTracker network_tracker;
            auto file_monitor = universe::make_filesystem_monitor();
            std::unique_lock lock(mutex);
            while (!stopped) {
                const auto revision = configuration_revision;
                const bool sample_processes = collect_processes;
                const bool sample_network = collect_network && SteadyClock::now() >= next_network_sample;
                const auto previous = processes;
                const auto request = std::move(file_request);
                file_request.reset();
                const bool sample_filesystem = request.has_value() || filesystem->watching
                    || (previous->filesystem ? previous->filesystem->revision : 0) != filesystem->revision;
                if (sample_processes || sample_network || sample_filesystem) {
                    lock.unlock();
                    std::shared_ptr<universe::ProcessSnapshot> sampled;
                    std::shared_ptr<universe::NetworkSnapshot> sampled_network;
                    std::shared_ptr<const universe::FileSystemSnapshot> sampled_filesystem;
                    try {
                        sampled = sample_processes ? std::make_shared<universe::ProcessSnapshot>(tracker.normalize(collector->collect(stop)))
                            : std::make_shared<universe::ProcessSnapshot>(*previous);
                    } catch (...) {
                        auto failed = std::make_shared<universe::ProcessSnapshot>();
                        failed->error = 8;
                        failed->observed_at_unix_ms = unix_ms();
                        sampled = std::move(failed);
                    }
                    if (sample_network) {
                        try { sampled_network = std::make_shared<universe::NetworkSnapshot>(network_tracker.normalize(network_collector->collect(stop))); }
                        catch (...) {
                            sampled_network = std::make_shared<universe::NetworkSnapshot>();
                            sampled_network->table_errors.fill(8);
                            sampled_network->interface_error = 8;
                            sampled_network->observed_at_unix_ms = unix_ms();
                            network_tracker.reset();
                        }
                        sampled_network->enabled = true;
                    }
                    if (sample_filesystem) {
                        try {
                            if (!request) sampled_filesystem = file_monitor->poll();
                            else if (request->action == 0) sampled_filesystem = file_monitor->select_root(request->root);
                            else if (request->action == 1) sampled_filesystem = file_monitor->navigate(request->scope, request->entry);
                            else sampled_filesystem = file_monitor->stop();
                        } catch (...) {
                            auto failed = std::make_shared<universe::FileSystemSnapshot>();
                            failed->revision = filesystem->revision + 1; failed->error = 8;
                            file_monitor->stop(); sampled_filesystem = failed;
                        }
                    }
                    lock.lock();
                    if (stopped) break;
                    if (revision != configuration_revision) {
                        if (sampled_filesystem) filesystem = std::move(sampled_filesystem);
                        if (!collect_processes) tracker.reset();
                        if (!collect_network) network_tracker.reset();
                        continue;
                    }
                    if (sample_processes) sampled->events = journal.observe(*sampled, monotonic_ns());
                    if (sampled_network) {
                        network = std::move(sampled_network);
                        next_network_sample = SteadyClock::now() + Milliseconds(latest.profile == UOS_ECO ? 5000 : 2000);
                    }
                    sampled->network = network;
                    if (sampled_filesystem) filesystem = std::move(sampled_filesystem);
                    sampled->filesystem = filesystem;
                    processes = std::move(sampled);
                    publish();
                    changed.notify_all();
                } else { if (!collect_processes) tracker.reset(); }
                if (!collect_network) network_tracker.reset();
                const auto interrupted = changed.wait_for(lock, Milliseconds(latest.interval_ms),
                    [this, revision] { return stopped || configuration_revision != revision; });
                if (!interrupted && !collect_processes && !collect_network) {
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
        engine->next_network_sample = {};
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
        cleared->network = engine->network;
        cleared->filesystem = engine->filesystem;
        engine->processes = std::move(cleared);
        engine->update_interval();
        ++engine->configuration_revision;
        engine->publish();
        engine->changed.notify_all();
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_set_network_collection(uos_engine* engine, uint32_t enabled) noexcept {
    if (!engine || enabled > 1) return UOS_INVALID;
    try {
        std::lock_guard lock(engine->mutex);
        if (engine->stopped) return UOS_STOPPED;
        if (engine->collect_network == (enabled != 0)) return UOS_FRAME;
        auto network = std::make_shared<universe::NetworkSnapshot>();
        network->enabled = enabled != 0;
        auto current = std::make_shared<universe::ProcessSnapshot>(*engine->processes);
        current->network = network;
        engine->network = std::move(network);
        engine->processes = std::move(current);
        engine->collect_network = enabled != 0;
        engine->next_network_sample = {};
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

int32_t uos_network_info_read(const uos_process_snapshot* snapshot, uos_network_info* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_network_info)) return UOS_INVALID;
    *output = {};
    output->abi_version = UOS_ABI_VERSION;
    output->struct_size = sizeof(uos_network_info);
    if (const auto& network = snapshot->value->network) {
        output->enabled = network->enabled ? 1u : 0u;
        output->connection_count = static_cast<uint32_t>(network->connections.size());
        output->interface_count = static_cast<uint32_t>(network->interfaces.size());
        output->truncated = network->truncated ? 1u : 0u;
        for (size_t index = 0; index < 4; ++index) output->table_errors[index] = network->table_errors[index];
        output->interface_error = network->interface_error;
        output->observed_at_unix_ms = network->observed_at_unix_ms;
        output->collection_ms = network->collection_ms;
    }
    return UOS_FRAME;
}

int32_t uos_connection_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_connection_row* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_connection_row) || !snapshot->value->network || index >= snapshot->value->network->connections.size()) return UOS_INVALID;
    const auto& row = snapshot->value->network->connections[index];
    *output = {row.generation, row.owner_creation.value_or(0), row.pid, row.family, row.protocol, row.state, row.local_port, row.remote_port,
        row.owner_error, row.observations, row.local_address.data(), row.remote_address ? row.remote_address->data() : nullptr,
        static_cast<uint32_t>(row.local_address.size()), row.remote_address ? static_cast<uint32_t>(row.remote_address->size()) : 0u};
    return UOS_FRAME;
}

int32_t uos_interface_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_interface_row* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_interface_row) || !snapshot->value->network || index >= snapshot->value->network->interfaces.size()) return UOS_INVALID;
    const auto& row = snapshot->value->network->interfaces[index];
    *output = {row.luid, row.received_bytes, row.sent_bytes, row.receive_bytes_per_second.value_or(0), row.send_bytes_per_second.value_or(0),
        row.index, row.type, row.up ? 1u : 0u, row.receive_bytes_per_second && row.send_bytes_per_second ? 1u : 0u,
        row.name.data(), static_cast<uint32_t>(row.name.size()), 0};
    return UOS_FRAME;
}

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

int32_t uos_filesystem_command(uos_engine* engine, uint32_t action, const char* root, uint32_t length, uint64_t scope, uint64_t entry) noexcept {
    if (!engine || action > 2 || length > 16384 || (action == 0 && (!root || length == 0))) return UOS_INVALID;
    try {
        std::lock_guard lock(engine->mutex);
        if (engine->stopped) return UOS_STOPPED;
        engine->file_request = uos_engine::FileRequest{action, action == 0 ? std::string(root, length) : std::string{}, scope, entry};
        ++engine->configuration_revision;
        engine->changed.notify_all();
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_filesystem_info_read(const uos_process_snapshot* snapshot, uos_filesystem_info* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_filesystem_info)) return UOS_INVALID;
    *output = {}; output->abi_version = UOS_ABI_VERSION; output->struct_size = sizeof(uos_filesystem_info);
    if (const auto& value = snapshot->value->filesystem) {
        output->revision = value->revision; output->scope = value->scope; output->observed_at_unix_ms = value->observed_at_unix_ms;
        output->evicted_events = value->evicted_events; output->error = value->error; output->watch_error = value->watch_error;
        output->watching = value->watching ? 1u : 0u; output->truncated = value->truncated ? 1u : 0u;
        output->entry_count = static_cast<uint32_t>(value->entries.size()); output->event_count = static_cast<uint32_t>(value->events.size());
        output->scan_ms = value->scan_ms; output->root = value->root.data(); output->root_length = static_cast<uint32_t>(value->root.size());
        output->relative = value->relative.data(); output->relative_length = static_cast<uint32_t>(value->relative.size());
    }
    return UOS_FRAME;
}

int32_t uos_file_entry_read(const uos_process_snapshot* snapshot, uint32_t index, uos_file_entry* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_file_entry) || !snapshot->value->filesystem || index >= snapshot->value->filesystem->entries.size()) return UOS_INVALID;
    const auto& entry = snapshot->value->filesystem->entries[index];
    *output = {entry.generation, entry.file_id, entry.created_ticks, entry.modified_unix_ms, entry.size, entry.attributes,
        entry.directory ? 1u : 0u, entry.reparse ? 1u : 0u, static_cast<uint32_t>(entry.name.size()), entry.name.data()};
    return UOS_FRAME;
}

int32_t uos_file_event_read(const uos_process_snapshot* snapshot, uint32_t index, uos_file_event* output, uint32_t size) noexcept {
    if (!snapshot || !output || size != sizeof(uos_file_event) || !snapshot->value->filesystem || index >= snapshot->value->filesystem->events.size()) return UOS_INVALID;
    const auto& event = snapshot->value->filesystem->events[index];
    *output = {event.sequence, event.observed_at_unix_ms, static_cast<uint32_t>(event.kind), static_cast<uint32_t>(event.name.size()),
        static_cast<uint32_t>(event.previous_name.size()), 0, event.name.data(), event.previous_name.data()};
    return UOS_FRAME;
}