#include "universe/engine.h"
#include <chrono>
#include <future>
#include <iostream>
#include <memory>
#include <stdexcept>

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    try {
        require(uos_create(99, sizeof(uos_health)) == nullptr, "reject ABI mismatch");
        require(uos_create(1, 0) == nullptr, "reject struct mismatch");
        std::unique_ptr<uos_engine, decltype(&uos_destroy)> engine(
            uos_create(UOS_ABI_VERSION, sizeof(uos_health)), uos_destroy);
        require(engine != nullptr, "create engine");
        require(uos_filesystem_command(engine.get(), 0, nullptr, 0, 0, 0) == UOS_INVALID, "reject empty filesystem root");
        require(uos_filesystem_command(engine.get(), 9, nullptr, 0, 0, 0) == UOS_INVALID, "reject unknown filesystem action");
        uos_health frame{};
        require(uos_wait(nullptr, 0, 0, &frame, sizeof(frame)) == UOS_INVALID, "reject null handle");
        require(uos_wait(engine.get(), 0, 0, nullptr, sizeof(frame)) == UOS_INVALID, "reject null output");
        require(uos_wait(engine.get(), 0, 0, &frame, 0) == UOS_INVALID, "reject output size");
        require(uos_wait(engine.get(), 0, 30001, &frame, sizeof(frame)) == UOS_INVALID, "bound wait time");
        require(uos_wait(engine.get(), 0, 0, &frame, sizeof(frame)) == UOS_FRAME, "initial frame");
        require(frame.sequence == 1 && frame.abi_version == 1 && frame.struct_size == 48, "ABI layout");
        require(frame.enabled_collectors == 0, "no fictional collectors");
        require(frame.observed_at_unix_ms > 1700000000000ULL, "real clock timestamp");
        require(uos_wait(engine.get(), frame.sequence, 0, &frame, sizeof(frame)) == UOS_TIMEOUT, "no duplicate frame");
        require(uos_set_profile(engine.get(), 3) == UOS_INVALID, "reject invalid profile");
        require(uos_wait(engine.get(), frame.sequence, 3000, &frame, sizeof(frame)) == UOS_FRAME, "worker publishes");
        require(frame.uptime_ms >= 1900, "real monotonic uptime");
        const auto before = frame.sequence;
        for (uint32_t index = 0; index < 10000; ++index) {
            require(uos_set_profile(engine.get(), index % 2) == UOS_FRAME, "profile update");
        }
        require(uos_wait(engine.get(), before, 0, &frame, sizeof(frame)) == UOS_FRAME, "coalesced snapshot");
        require(frame.sequence >= before + 10000, "latest state replaces backlog");
        require(uos_set_profile(engine.get(), UOS_ECO) == UOS_FRAME, "eco selected");
        require(uos_wait(engine.get(), frame.sequence, 0, &frame, sizeof(frame)) == UOS_FRAME, "eco confirmed");
        require(frame.interval_ms == 5000 && frame.profile == UOS_ECO, "native eco interval");
        require(uos_set_process_collection(engine.get(), 2) == UOS_INVALID, "reject invalid collector toggle");
        require(uos_set_process_collection(engine.get(), 1) == UOS_FRAME, "enable processes");
        uos_process_snapshot* held = nullptr;
        uos_process_info info{};
        for (int attempt = 0; attempt < 10 && !held; ++attempt) {
            require(uos_wait(engine.get(), frame.sequence, 3000, &frame, sizeof(frame)) == UOS_FRAME, "process health update");
            uos_process_snapshot* candidate = nullptr;
            if (uos_acquire_processes(engine.get(), frame.sequence, &candidate) != UOS_FRAME) continue;
            require(uos_process_info_read(candidate, &info, sizeof(info)) == UOS_FRAME, "snapshot info");
            if (info.count > 0) held = candidate;
            else uos_release_processes(candidate);
        }
        require(held != nullptr && info.error == 0, "real process snapshot through C ABI");
        require(frame.interval_ms == 2000 && frame.enabled_collectors == 1, "eco process interval");
        uos_process_row row{};
        require(uos_process_row_read(held, info.count, &row, sizeof(row)) == UOS_INVALID, "bounds check process rows");
        require(uos_process_row_read(held, 0, &row, sizeof(row)) == UOS_FRAME, "read native process row");
        require(row.name && row.name_length > 0, "borrowed name lifetime");
        uos_resource_visual visual{};
        require(uos_resource_visual_read(held, info.count, &visual, sizeof(visual)) == UOS_INVALID, "resource row bounds");
        require(uos_resource_visual_read(held, 0, &visual, 0) == UOS_INVALID, "resource ABI size check");
        require(uos_resource_visual_read(held, 0, &visual, sizeof(visual)) == UOS_FRAME, "resource visual through ABI");
        require((visual.cpu_level >= 0) == ((row.available & 2u) != 0), "CPU visual availability matches observation");
        require((visual.memory_level >= 0) == ((row.available & 4u) != 0), "memory visual availability matches observation");
        uos_model_info model{};
        require(uos_model_info_read(held, &model, 0) == UOS_INVALID, "model ABI size check");
        require(uos_model_info_read(held, &model, sizeof(model)) == UOS_FRAME && model.galaxy_count > 0, "real model through ABI");
        uos_relationship relationship{};
        require(uos_relationship_read(held, info.count, &relationship, sizeof(relationship)) == UOS_INVALID, "relationship bounds");
        require(uos_relationship_read(held, 0, &relationship, sizeof(relationship)) == UOS_FRAME, "row relationship");
        uos_galaxy galaxy{};
        require(uos_galaxy_read(held, model.galaxy_count, &galaxy, sizeof(galaxy)) == UOS_INVALID, "galaxy bounds");
        require(uos_galaxy_read(held, relationship.galaxy_index, &galaxy, sizeof(galaxy)) == UOS_FRAME, "row resolves to native galaxy");
        require(galaxy.root_index < info.count && galaxy.process_count > 0, "galaxy root and membership valid");
        uos_event_info event_info{};
        require(uos_event_info_read(held, &event_info, sizeof(event_info)) == UOS_FRAME && event_info.count > 0, "native event window");
        uos_event_row event{};
        require(uos_event_row_read(held, event_info.count, &event, sizeof(event)) == UOS_INVALID, "event bounds");
        require(uos_event_row_read(held, 0, &event, sizeof(event)) == UOS_FRAME && event.kind == 0, "initial observation baseline");
        uos_resource_event resource_event{};
        require(uos_resource_event_read(held, 0, &resource_event, sizeof(resource_event)) == UOS_INVALID, "baseline cannot pretend to be a resource spike");
        uos_delta* delta = nullptr;
        uos_delta_info delta_info{};
        require(uos_delta_create(held, held, &delta) == UOS_FRAME, "diff retained immutable snapshots");
        require(uos_delta_info_read(delta, &delta_info, sizeof(delta_info)) == UOS_FRAME && delta_info.count == 0, "unchanged native delta empty");
        uos_delta_release(delta);
        require(uos_delta_create(nullptr, held, &delta) == UOS_FRAME, "initial native snapshot changes");
        require(uos_delta_info_read(delta, &delta_info, sizeof(delta_info)) == UOS_FRAME && delta_info.count == info.count + model.galaxy_count, "all initial rows and groups");
        uos_change_row change{};
        require(uos_delta_row_read(delta, delta_info.count, &change, sizeof(change)) == UOS_INVALID, "delta bounds");
        uos_delta_release(delta);
        require(uos_set_process_collection(engine.get(), 0) == UOS_FRAME, "disable processes");
        require(uos_process_row_read(held, 0, &row, sizeof(row)) == UOS_FRAME, "retained snapshot survives replacement");
        require(uos_galaxy_read(held, relationship.galaxy_index, &galaxy, sizeof(galaxy)) == UOS_FRAME, "model survives snapshot replacement");
        uos_release_processes(held);
        require(uos_wait(engine.get(), frame.sequence, 100, &frame, sizeof(frame)) == UOS_FRAME, "disabled health state");
        require(frame.enabled_collectors == 0, "disabled collector confirmed");
        require(uos_set_network_collection(engine.get(), 2) == UOS_INVALID, "invalid network toggle");
        require(uos_set_network_collection(engine.get(), 1) == UOS_FRAME, "independent network enable");
        bool network_seen = false;
        for (int attempt = 0; attempt < 10 && !network_seen; ++attempt) {
            require(uos_wait(engine.get(), frame.sequence, 3000, &frame, sizeof(frame)) == UOS_FRAME, "network health update");
            uos_process_snapshot* current = nullptr;
            if (uos_acquire_processes(engine.get(), frame.sequence, &current) != UOS_FRAME) continue;
            uos_network_info network_info{};
            require(uos_network_info_read(current, &network_info, sizeof(network_info)) == UOS_FRAME, "network header ABI");
            network_seen = network_info.enabled == 1 && network_info.observed_at_unix_ms > 0;
            uos_connection_row connection{};
            require(uos_connection_row_read(current, network_info.connection_count, &connection, sizeof(connection)) == UOS_INVALID, "network row bounds");
            uos_release_processes(current);
        }
        require(network_seen && frame.enabled_collectors == 0, "network works while process collection is off");
        require(uos_set_network_collection(engine.get(), 0) == UOS_FRAME, "network disable");
        require(uos_wait(engine.get(), frame.sequence, 100, &frame, sizeof(frame)) == UOS_FRAME, "network disabled acknowledgement");
        auto waiter = std::async(std::launch::async, [&] {
            uos_health next{};
            return uos_wait(engine.get(), frame.sequence, 30000, &next, sizeof(next));
        });
        uos_stop(engine.get());
        require(waiter.wait_for(std::chrono::milliseconds(500)) == std::future_status::ready, "prompt shutdown");
        require(waiter.get() == UOS_STOPPED, "waiter sees stop");
        require(uos_set_profile(engine.get(), UOS_NORMAL) == UOS_STOPPED, "no updates after stop");
        uos_stop(engine.get());
        uos_destroy(nullptr);
        std::cout << "PASS: ABI, real heartbeat, 10000 coalesced updates, profiles, shutdown\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}