#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include "universe/process.hpp"
#include <chrono>
#include <utility>

namespace universe {
namespace {
class Handle {
public:
    explicit Handle(HANDLE value) : value_(value) {}
    ~Handle() { if (valid()) CloseHandle(value_); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    bool valid() const { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
    HANDLE get() const { return value_; }
private:
    HANDLE value_;
};

uint64_t ticks(FILETIME time) {
    return (static_cast<uint64_t>(time.dwHighDateTime) << 32) | time.dwLowDateTime;
}

std::string utf8(const wchar_t* value) {
    const auto size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string output(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, output.data(), size, nullptr, nullptr);
    output.pop_back();
    return output;
}

class WindowsProcessCollector final : public IProcessCollector {
public:
    ProcessCollection collect(std::stop_token stop) override {
        using Clock = std::chrono::steady_clock;
        const auto started = Clock::now();
        ProcessCollection result;
        result.logical_cpus = GetActiveProcessorCount(ALL_PROCESSOR_GROUPS);
        result.observed_at_unix_ms = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count());
        const Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
        if (!snapshot.valid()) {
            result.error = GetLastError();
            return result;
        }
        PROCESSENTRY32W entry{};
        entry.dwSize = sizeof(entry);
        if (!Process32FirstW(snapshot.get(), &entry)) {
            result.error = GetLastError();
            return result;
        }
        result.processes.reserve(512);
        do {
            if (stop.stop_requested()) { result.error = ERROR_OPERATION_ABORTED; break; }
            if (result.processes.size() == process_limit) { result.truncated = true; break; }
            ProcessObservation process;
            process.pid = entry.th32ProcessID;
            process.parent_pid = entry.th32ParentProcessID;
            process.thread_count = entry.cntThreads;
            process.name = utf8(entry.szExeFile);
            const Handle handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process.pid));
            if (!handle.valid()) {
                process.timing_error = process.memory_error = GetLastError();
            } else {
                FILETIME creation{}, exit{}, kernel{}, user{};
                if (GetProcessTimes(handle.get(), &creation, &exit, &kernel, &user)) {
                    process.creation_filetime = ticks(creation);
                    process.cpu_ticks = ticks(kernel) + ticks(user);
                } else {
                    process.timing_error = GetLastError();
                }
                PROCESS_MEMORY_COUNTERS memory{};
                memory.cb = sizeof(memory);
                if (K32GetProcessMemoryInfo(handle.get(), &memory, sizeof(memory))) {
                    process.working_set_bytes = memory.WorkingSetSize;
                } else {
                    process.memory_error = GetLastError();
                    const Handle memory_handle(OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, process.pid));
                    if (memory_handle.valid()) {
                        if (K32GetProcessMemoryInfo(memory_handle.get(), &memory, sizeof(memory))) {
                            process.working_set_bytes = memory.WorkingSetSize;
                            process.memory_error = 0;
                        } else { process.memory_error = GetLastError(); }
                    }
                }
            }
            process.measured_at_ns = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(Clock::now().time_since_epoch()).count());
            result.processes.push_back(std::move(process));
        } while (Process32NextW(snapshot.get(), &entry));
        if (!result.truncated && result.error == 0) {
            const auto error = GetLastError();
            if (error != ERROR_NO_MORE_FILES) result.error = error;
        }
        result.duration_ms = std::chrono::duration<double, std::milli>(Clock::now() - started).count();
        return result;
    }
};
}

std::unique_ptr<IProcessCollector> make_process_collector() {
    return std::make_unique<WindowsProcessCollector>();
}
}