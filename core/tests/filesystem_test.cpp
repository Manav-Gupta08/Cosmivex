#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winioctl.h>
#include "universe/filesystem.hpp"
#include "../platform/windows/filesystem_notifications.hpp"
#include <algorithm>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>

void check(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
std::vector<std::byte> notification(uint32_t action, const std::wstring& name) {
    std::vector<std::byte> bytes(12 + name.size() * 2);
    const auto length = static_cast<uint32_t>(name.size() * 2);
    std::memcpy(bytes.data() + 4, &action, 4); std::memcpy(bytes.data() + 8, &length, 4);
    std::memcpy(bytes.data() + 12, name.data(), length);
    return bytes;
}
void junction(const std::filesystem::path& link, const std::filesystem::path& target) {
    std::filesystem::create_directory(link);
    const auto substitute = L"\\??\\" + target.wstring();
    const auto print = target.wstring();
    const auto substitute_bytes = static_cast<WORD>(substitute.size() * 2);
    const auto print_bytes = static_cast<WORD>(print.size() * 2);
    std::vector<std::byte> data(16 + substitute_bytes + 2 + print_bytes + 2);
    const DWORD tag = IO_REPARSE_TAG_MOUNT_POINT;
    const WORD data_length = static_cast<WORD>(data.size() - 8), print_offset = substitute_bytes + 2;
    std::memcpy(data.data(), &tag, 4); std::memcpy(data.data() + 4, &data_length, 2);
    std::memcpy(data.data() + 10, &substitute_bytes, 2); std::memcpy(data.data() + 12, &print_offset, 2); std::memcpy(data.data() + 14, &print_bytes, 2);
    std::memcpy(data.data() + 16, substitute.data(), substitute_bytes); std::memcpy(data.data() + 16 + print_offset, print.data(), print_bytes);
    const auto handle = CreateFileW(link.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    check(handle != INVALID_HANDLE_VALUE, "open test junction");
    DWORD returned = 0;
    const bool created = DeviceIoControl(handle, FSCTL_SET_REPARSE_POINT, data.data(), static_cast<DWORD>(data.size()), nullptr, 0, &returned, nullptr) != 0;
    CloseHandle(handle);
    check(created, "create standard-user test junction");
}
template<class Predicate>
std::shared_ptr<const universe::FileSystemSnapshot> observed(universe::IFileSystemMonitor& monitor, Predicate predicate) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    do {
        const auto snapshot = monitor.poll();
        if (predicate(*snapshot)) return snapshot;
        std::this_thread::yield();
    } while (std::chrono::steady_clock::now() < deadline);
    throw std::runtime_error("filesystem observation timed out");
}
int main() {
    const auto root = std::filesystem::temp_directory_path() / ("universe-fs-test-" + std::to_string(GetCurrentProcessId()));
    try {
        check(universe::decode_directory_changes({}).gap, "empty notification means gap");
        auto bytes = notification(FILE_ACTION_ADDED, L"file.txt");
        check(universe::decode_directory_changes(bytes).events[0].kind == universe::FileEventKind::created, "notification decoder");
        bytes[8] = std::byte{255};
        check(universe::decode_directory_changes(bytes).gap, "malformed notification rejected");
        check(universe::decode_directory_changes(notification(FILE_ACTION_ADDED, L"..\\outside")).gap, "notification cannot escape directory");
        check(universe::decode_directory_changes(notification(FILE_ACTION_RENAMED_OLD_NAME, L"unpaired")).events[0].kind == universe::FileEventKind::rename_from, "unpaired rename is not a fabricated delete");
        std::filesystem::create_directory(root);
        std::filesystem::create_directory(root / "child");
        { std::ofstream output(root / "existing.txt"); output << "metadata only"; }
        auto monitor = universe::make_filesystem_monitor();
        check(monitor->select_root("relative/path")->error != 0, "relative roots rejected");
        const auto initial = monitor->select_root(root.string());
        if (initial->error || !initial->watching || initial->entries.size() != 2) std::cerr << "filesystem error=" << initial->error << " watch=" << initial->watch_error << " entries=" << initial->entries.size() << " root=" << initial->root << '\n';
        check(initial->error == 0 && initial->watching && initial->entries.size() == 2, "real metadata listing and watch");
        check(monitor->poll() == initial, "idle polling reuses snapshot without scanning");
        { std::ofstream output(root / "new.txt"); output << "test"; }
        const auto created = observed(*monitor, [](const auto& snapshot) { return std::any_of(snapshot.entries.begin(), snapshot.entries.end(), [](const auto& entry) { return entry.name == "new.txt" && entry.size == 4; }); });
        check(std::any_of(created->events.begin(), created->events.end(), [](const auto& event) { return event.kind == universe::FileEventKind::created && event.name == "new.txt"; }), "real file creation event");
        { std::ofstream output(root / "new.txt", std::ios::app); output << " appended"; }
        observed(*monitor, [](const auto& snapshot) { return std::any_of(snapshot.entries.begin(), snapshot.entries.end(), [](const auto& entry) { return entry.name == "new.txt" && entry.size == 13; }); });
        std::filesystem::rename(root / "new.txt", root / "renamed.txt");
        const auto renamed = observed(*monitor, [](const auto& snapshot) { return std::any_of(snapshot.events.begin(), snapshot.events.end(), [](const auto& event) { return event.kind == universe::FileEventKind::moved && event.name == "renamed.txt" && event.previous_name == "new.txt"; }); });
        std::filesystem::remove(root / "renamed.txt");
        observed(*monitor, [](const auto& snapshot) { return std::any_of(snapshot.events.begin(), snapshot.events.end(), [](const auto& event) { return event.kind == universe::FileEventKind::deleted && event.name == "renamed.txt"; }); });
        const auto child = std::find_if(renamed->entries.begin(), renamed->entries.end(), [](const auto& entry) { return entry.name == "child"; });
        check(child != renamed->entries.end(), "child directory exists");
        const auto inside = monitor->navigate(renamed->scope, child->generation);
        check(inside->relative == "child" && inside->entries.empty(), "navigate within root by observed token");
        check(monitor->navigate(renamed->scope, child->generation) == inside, "stale navigation token ignored");
        const auto back = monitor->navigate(inside->scope, 0);
        check(back->relative.empty() && back->root == initial->root, "navigate to root");
        check(monitor->navigate(back->scope, 0) == back, "cannot navigate above selected root");
        junction(root / "alias", root / "child");
        const auto linked = observed(*monitor, [](const auto& snapshot) { return std::any_of(snapshot.entries.begin(), snapshot.entries.end(), [](const auto& entry) { return entry.name == "alias"; }); });
        const auto alias = std::find_if(linked->entries.begin(), linked->entries.end(), [](const auto& entry) { return entry.name == "alias"; });
        check(alias->reparse && monitor->navigate(linked->scope, alias->generation) == linked, "junction cannot be navigated");
        check(monitor->select_root((root / "alias").string())->error == ERROR_ACCESS_DENIED, "junction cannot be selected as root");
        std::filesystem::remove(root / "alias");
        monitor->select_root(root.string());
        for (uint32_t index = 0; index < 300; ++index) { std::ofstream output(root / ("burst-" + std::to_string(index))); output << "x"; }
        const auto burst = observed(*monitor, [](const auto& snapshot) { return snapshot.entries.size() == 302 && (snapshot.evicted_events > 0 || std::any_of(snapshot.events.begin(), snapshot.events.end(), [](const auto& event) { return event.kind == universe::FileEventKind::gap; })); });
        check(burst->events.size() <= universe::filesystem_event_limit, "event history stays bounded during real burst");
        check(burst->evicted_events > 0 || std::any_of(burst->events.begin(), burst->events.end(), [](const auto& event) { return event.kind == universe::FileEventKind::gap; }), "burst eviction or notification loss is explicit");
        monitor->stop();
        for (uint32_t index = 300; index < 4100; ++index) { std::ofstream output(root / ("burst-" + std::to_string(index))); }
        const auto limited = monitor->select_root(root.string());
        check(limited->truncated && limited->entries.size() == universe::filesystem_entry_limit, "large directories are explicitly bounded");
        monitor->stop();
        check(!monitor->poll()->watching && monitor->poll()->entries.empty(), "stop clears watch and metadata");
        std::filesystem::remove_all(root);
        std::cout << "PASS: read-only metadata, real create/modify/rename/delete, idle reuse, scoped navigation, malformed/overflow notifications, stop\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        std::error_code ignored; std::filesystem::remove_all(root, ignored);
        return 1;
    }
}