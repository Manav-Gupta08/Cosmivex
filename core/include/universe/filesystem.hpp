#pragma once
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace universe {
inline constexpr uint32_t filesystem_entry_limit = 4096;
inline constexpr uint32_t filesystem_event_limit = 256;
enum class FileEventKind : uint32_t { baseline = 0, created = 1, modified = 2, deleted = 3, moved = 4, gap = 5, rename_from = 6, rename_to = 7 };
struct FileEntry {
    uint64_t generation = 0;
    uint64_t file_id = 0;
    uint64_t created_ticks = 0;
    uint64_t modified_unix_ms = 0;
    uint64_t size = 0;
    uint32_t attributes = 0;
    bool directory = false;
    bool reparse = false;
    std::string name;
};
struct FileEvent {
    uint64_t sequence = 0;
    uint64_t observed_at_unix_ms = 0;
    FileEventKind kind = FileEventKind::baseline;
    std::string name;
    std::string previous_name;
};
struct FileSystemSnapshot {
    uint64_t revision = 0;
    uint64_t scope = 0;
    uint64_t observed_at_unix_ms = 0;
    uint64_t evicted_events = 0;
    uint32_t error = 0;
    uint32_t watch_error = 0;
    bool watching = false;
    bool truncated = false;
    double scan_ms = 0;
    std::string root;
    std::string relative;
    std::vector<FileEntry> entries;
    std::vector<FileEvent> events;
};
class IFileSystemMonitor {
public:
    virtual ~IFileSystemMonitor() = default;
    virtual std::shared_ptr<const FileSystemSnapshot> select_root(const std::string& path) = 0;
    virtual std::shared_ptr<const FileSystemSnapshot> navigate(uint64_t scope, uint64_t entry) = 0;
    virtual std::shared_ptr<const FileSystemSnapshot> poll() = 0;
    virtual std::shared_ptr<const FileSystemSnapshot> stop() = 0;
};
std::unique_ptr<IFileSystemMonitor> make_filesystem_monitor();
}