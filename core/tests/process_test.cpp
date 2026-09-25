#include "universe/process.hpp"
#include "universe/model.hpp"
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

void check(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}

universe::ProcessCollection sample(uint64_t created, uint64_t ticks, uint64_t time) {
    universe::ProcessCollection result;
    result.logical_cpus = 4;
    universe::ProcessObservation observation;
    observation.pid = 42;
    observation.name = "fixture.exe";
    observation.creation_filetime = created;
    observation.cpu_ticks = ticks;
    observation.measured_at_ns = time;
    result.processes.push_back(observation);
    return result;
}

class TestChild {
public:
    TestChild() {
        const std::wstring name = L"Local\\UniverseOS-test-" + std::to_wstring(GetCurrentProcessId());
        event_ = CreateEventW(nullptr, TRUE, FALSE, name.c_str());
        check(event_ != nullptr, "create child test event");
        wchar_t executable[32768]{};
        GetModuleFileNameW(nullptr, executable, 32768);
        std::wstring command = L"\"" + std::wstring(executable) + L"\" --child " + name;
        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        if (!CreateProcessW(nullptr, command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
            nullptr, nullptr, &startup, &process_)) {
            CloseHandle(event_);
            throw std::runtime_error("spawn controlled child");
        }
    }
    ~TestChild() {
        SetEvent(event_);
        WaitForSingleObject(process_.hProcess, 5000);
        CloseHandle(process_.hThread);
        CloseHandle(process_.hProcess);
        CloseHandle(event_);
    }
    DWORD pid() const { return process_.dwProcessId; }
    void finish() {
        SetEvent(event_);
        check(WaitForSingleObject(process_.hProcess, 5000) == WAIT_OBJECT_0, "controlled child exits");
    }
private:
    HANDLE event_ = nullptr;
    PROCESS_INFORMATION process_{};
};

int main(int argc, char* argv[]) {
    if (argc == 3 && std::string(argv[1]) == "--child") {
        const auto event = OpenEventA(SYNCHRONIZE, FALSE, argv[2]);
        if (!event) return 1;
        const auto result = WaitForSingleObject(event, 10000);
        CloseHandle(event);
        return result == WAIT_OBJECT_0 ? 0 : 1;
    }
    try {
        universe::ProcessTracker tracker;
        const auto first = tracker.normalize(sample(100, 0, 1000000000));
        check(!first.processes[0].cpu_percent, "first CPU sample must be unavailable");
        const auto next = tracker.normalize(sample(100, 10000000, 2000000000));
        check(std::abs(*next.processes[0].cpu_percent - 25.0) < 0.001, "one busy core out of four = 25 percent");
        check(first.processes[0].generation == next.processes[0].generation, "identity stable across updates");
        auto renamed = sample(100, 10000000, 2500000000);
        renamed.processes[0].name = "renamed.exe";
        check(tracker.normalize(std::move(renamed)).processes[0].generation == next.processes[0].generation, "creation identity survives name changes");
        const auto reused = tracker.normalize(sample(200, 20000000, 3000000000));
        check(!reused.processes[0].cpu_percent, "PID reuse invalidates CPU baseline");
        check(reused.processes[0].generation != next.processes[0].generation, "PID reuse gets new identity");
        const auto reversed = tracker.normalize(sample(200, 0, 4000000000));
        check(!reversed.processes[0].cpu_percent, "counter rollback unavailable");
        auto denied = sample(200, 0, 5000000000);
        denied.processes[0].creation_filetime.reset();
        denied.processes[0].cpu_ticks.reset();
        denied.processes[0].timing_error = ERROR_ACCESS_DENIED;
        const auto inaccessible = tracker.normalize(std::move(denied));
        check(!inaccessible.processes[0].cpu_percent && !inaccessible.processes[0].observation.working_set_bytes, "missing is not zero");
        tracker.normalize({});
        check(tracker.normalize(sample(200, 0, 6000000000)).processes[0].generation != reversed.processes[0].generation, "observed disappearance resets identity");
        auto failed = sample(200, 0, 7000000000);
        failed.error = 5;
        check(tracker.normalize(std::move(failed)).processes.empty(), "failed collection cannot masquerade as complete");
        const auto before_reset = tracker.normalize(sample(300, 0, 8000000000)).processes[0].generation;
        tracker.reset();
        check(tracker.normalize(sample(400, 0, 9000000000)).processes[0].generation > before_reset, "collection reset never reuses a generation");

        auto collector = universe::make_process_collector();
        auto collection = collector->collect();
        check(collection.error == 0 && !collection.processes.empty(), "real Windows enumeration");
        const auto current = std::find_if(collection.processes.begin(), collection.processes.end(), [](const auto& process) {
            return process.pid == GetCurrentProcessId();
        });
        check(current != collection.processes.end(), "test process must be observed");
        check(current->name == "universe_process_tests.exe", "real executable name");
        check(current->creation_filetime.has_value() && current->cpu_ticks.has_value(), "own process timing available");
        check(current->working_set_bytes.value_or(0) > 0, "own process memory available");
        check(current->executable_path.has_value() && current->image_error == 0, "own executable identity available");
        FILETIME creation{}, exit{}, kernel{}, user{};
        check(GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user) != 0, "OS timing reference");
        const uint64_t expected = (static_cast<uint64_t>(creation.dwHighDateTime) << 32) | creation.dwLowDateTime;
        check(*current->creation_filetime == expected, "creation identity matches independent OS query");
        {
            TestChild child;
            const auto with_child = collector->collect();
            const auto found = std::find_if(with_child.processes.begin(), with_child.processes.end(), [&child](const auto& process) {
                return process.pid == child.pid();
            });
            check(found != with_child.processes.end(), "new child is observed");
            check(found->parent_pid == GetCurrentProcessId(), "real child parent PID");
            check(found->executable_path == current->executable_path, "child shares actual executable path");
            universe::ProcessTracker live_tracker;
            const auto live_snapshot = live_tracker.normalize(with_child);
            const auto live_model = universe::build_universe(live_snapshot);
            const auto child_row = std::find_if(live_snapshot.processes.begin(), live_snapshot.processes.end(), [&child](const auto& row) {
                return row.observation.pid == child.pid();
            });
            const auto child_index = static_cast<size_t>(child_row - live_snapshot.processes.begin());
            const auto& relation = live_model.relationships[child_index];
            check(relation.status == universe::ParentStatus::verified, "real parent relationship validated");
            check(live_snapshot.processes[static_cast<size_t>(relation.parent_index)].observation.pid == GetCurrentProcessId(), "resolved parent is actual test process");
            check(live_model.galaxies[relation.galaxy_index].process_count >= 2, "real same-image child belongs to parent galaxy");
            child.finish();
            const auto after_exit = collector->collect();
            check(std::none_of(after_exit.processes.begin(), after_exit.processes.end(), [&child](const auto& process) {
                return process.pid == child.pid();
            }), "exited child is no longer observed");
        }
        std::stop_source cancelled;
        cancelled.request_stop();
        check(collector->collect(cancelled.get_token()).error == ERROR_OPERATION_ABORTED, "collector cancellation");
        DWORD handles_before = 0, handles_after = 0;
        GetProcessHandleCount(GetCurrentProcess(), &handles_before);
        double total_ms = 0;
        for (uint32_t iteration = 0; iteration < 20; ++iteration) total_ms += collector->collect().duration_ms;
        GetProcessHandleCount(GetCurrentProcess(), &handles_after);
        check(handles_after <= handles_before + 2, "no retained process/snapshot handles");
        std::cout << "PASS: real Windows processes=" << collection.processes.size()
                  << ", mean collector ms=" << total_ms / 20.0 << ", CPU normalization, reuse, missing fields, cancellation, handles\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}