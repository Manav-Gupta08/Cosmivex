#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include "filesystem_notifications.hpp"
#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>
#include <unordered_map>
#include <unordered_set>

namespace universe {
namespace {
std::string utf8(const wchar_t* data, int length) {
    const auto count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, data, length, nullptr, 0, nullptr, nullptr);
    if (count <= 0) return {};
    std::string result(static_cast<size_t>(count), '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, data, length, result.data(), count, nullptr, nullptr);
    return result;
}
std::wstring wide(const std::string& data) {
    if (data.empty() || data.size() > 16384 || data.find('\0') != std::string::npos) return {};
    const auto count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, data.data(), static_cast<int>(data.size()), nullptr, 0);
    if (count <= 0 || count > 4096) return {};
    std::wstring result(static_cast<size_t>(count), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, data.data(), static_cast<int>(data.size()), result.data(), count);
    return result;
}
uint64_t now_ms() { return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count()); }
uint64_t unix_ms(uint64_t ticks) { return ticks >= 116444736000000000ULL ? (ticks - 116444736000000000ULL) / 10000 : 0; }
bool same_path(const std::wstring& left, const std::wstring& right) {
    return CompareStringOrdinal(left.c_str(), static_cast<int>(left.size()), right.c_str(), static_cast<int>(right.size()), TRUE) == CSTR_EQUAL;
}
bool child_name(const std::string& name) {
    return !name.empty() && name != "." && name != ".." && name.find_first_of("\\/:\0", 0, 4) == std::string::npos;
}
}

DecodedFileChanges decode_directory_changes(std::span<const std::byte> bytes) {
    DecodedFileChanges result;
    if (bytes.empty()) { result.gap = true; return result; }
    size_t offset = 0;
    std::unordered_set<std::string> modifications;
    while (offset < bytes.size()) {
        if (bytes.size() - offset < 12) { result.gap = true; break; }
        uint32_t next = 0, action = 0, length = 0;
        std::memcpy(&next, bytes.data() + offset, 4);
        std::memcpy(&action, bytes.data() + offset + 4, 4);
        std::memcpy(&length, bytes.data() + offset + 8, 4);
        if (length == 0 || length % 2 || length > 2048 || length > bytes.size() - offset - 12
            || (next && (next % 4 || next < 12 + length || next >= bytes.size() - offset))) { result.gap = true; break; }
        std::wstring filename(length / 2, L'\0');
        std::memcpy(filename.data(), bytes.data() + offset + 12, length);
        auto name = utf8(filename.data(), static_cast<int>(filename.size()));
        if (!child_name(name)) { result.gap = true; break; }
        FileEventKind kind;
        switch (action) {
            case FILE_ACTION_ADDED: kind = FileEventKind::created; break;
            case FILE_ACTION_REMOVED: kind = FileEventKind::deleted; break;
            case FILE_ACTION_MODIFIED: kind = FileEventKind::modified; break;
            case FILE_ACTION_RENAMED_OLD_NAME: kind = FileEventKind::rename_from; break;
            case FILE_ACTION_RENAMED_NEW_NAME: kind = FileEventKind::rename_to; break;
            default: result.gap = true; kind = FileEventKind::gap;
        }
        if (result.gap) break;
        if (kind == FileEventKind::rename_to && !result.events.empty() && result.events.back().kind == FileEventKind::rename_from) {
            auto& previous = result.events.back();
            previous.kind = FileEventKind::moved;
            previous.previous_name = std::move(previous.name);
            previous.name = std::move(name);
        } else if (kind != FileEventKind::modified || modifications.insert(name).second) {
            result.events.push_back({0, 0, kind, std::move(name), {}});
        }
        if (!next) return result;
        offset += next;
    }
    if (result.gap) result.events.clear();
    return result;
}

namespace {
class WindowsFileSystemMonitor final : public IFileSystemMonitor {
    HANDLE directory_ = INVALID_HANDLE_VALUE;
    HANDLE event_ = nullptr;
    OVERLAPPED overlapped_{};
    bool pending_ = false;
    std::array<DWORD, 16384> changes_{};
    std::wstring root_;
    std::wstring relative_;
    uint64_t revision_ = 0, scope_ = 0, entry_sequence_ = 0, event_sequence_ = 0;
    std::shared_ptr<FileSystemSnapshot> current_ = std::make_shared<FileSystemSnapshot>();

    void close_watch() {
        if (directory_ != INVALID_HANDLE_VALUE) {
            if (pending_) { CancelIoEx(directory_, &overlapped_); DWORD transferred = 0; GetOverlappedResult(directory_, &overlapped_, &transferred, TRUE); }
            CloseHandle(directory_);
        }
        if (event_) CloseHandle(event_);
        directory_ = INVALID_HANDLE_VALUE; event_ = nullptr; pending_ = false; overlapped_ = {};
    }

    uint32_t arm() {
        ResetEvent(event_);
        overlapped_ = {}; overlapped_.hEvent = event_;
        pending_ = ReadDirectoryChangesW(directory_, changes_.data(), static_cast<DWORD>(sizeof(changes_)), FALSE,
            FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_DIR_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_ATTRIBUTES,
            nullptr, &overlapped_, nullptr) != 0;
        return pending_ ? 0 : GetLastError();
    }

    uint32_t open_directory(const std::wstring& path) {
        for (size_t end = 3; end <= path.size();) {
            const auto component = path.substr(0, end);
            const auto attributes = GetFileAttributesW(component.c_str());
            if (attributes == INVALID_FILE_ATTRIBUTES) return GetLastError();
            if (attributes & FILE_ATTRIBUTE_REPARSE_POINT) return ERROR_ACCESS_DENIED;
            if (end == path.size()) break;
            const auto next = path.find(L'\\', end + 1);
            end = next == std::wstring::npos ? path.size() : next;
        }
        directory_ = CreateFileW(path.c_str(), FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OVERLAPPED | FILE_FLAG_OPEN_NO_RECALL, nullptr);
        if (directory_ == INVALID_HANDLE_VALUE) return GetLastError();
        FILE_ATTRIBUTE_TAG_INFO attributes{};
        if (!GetFileInformationByHandleEx(directory_, FileAttributeTagInfo, &attributes, sizeof(attributes))) return GetLastError();
        if (!(attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) || (attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) return ERROR_ACCESS_DENIED;
        std::array<wchar_t, 8192> resolved{};
        const auto length = GetFinalPathNameByHandleW(directory_, resolved.data(), static_cast<DWORD>(resolved.size()), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
        if (length == 0 || length >= resolved.size()) return ERROR_INVALID_NAME;
        std::wstring actual(resolved.data(), length);
        if (actual.starts_with(L"\\\\?\\")) actual.erase(0, 4);
        while (actual.size() > 3 && actual.back() == L'\\') actual.pop_back();
        if (!same_path(actual, path)) return ERROR_ACCESS_DENIED;
        event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        return event_ ? 0 : GetLastError();
    }

    void record(FileSystemSnapshot& snapshot, FileEvent event) {
        if (snapshot.events.size() == filesystem_event_limit) { snapshot.events.erase(snapshot.events.begin()); ++snapshot.evicted_events; }
        event.sequence = ++event_sequence_;
        event.observed_at_unix_ms = now_ms();
        snapshot.events.push_back(std::move(event));
    }

    void scan(FileSystemSnapshot& snapshot) {
        const auto started = std::chrono::steady_clock::now();
        std::unordered_map<std::string, const FileEntry*> old;
        for (const auto& entry : current_->entries) old.emplace(entry.name, &entry);
        snapshot.entries.clear(); snapshot.error = 0; snapshot.truncated = false;
        alignas(FILE_ID_BOTH_DIR_INFO) std::array<std::byte, 65536> buffer{};
        bool first = true, finished = false;
        while (!finished) {
            const bool valid = GetFileInformationByHandleEx(directory_, first ? FileIdBothDirectoryRestartInfo : FileIdBothDirectoryInfo, buffer.data(), static_cast<DWORD>(buffer.size())) != 0;
            first = false;
            if (!valid) { const auto error = GetLastError(); if (error != ERROR_NO_MORE_FILES) snapshot.error = error; break; }
            size_t offset = 0;
            while (true) {
                const auto header = offsetof(FILE_ID_BOTH_DIR_INFO, FileName);
                if (offset + header > buffer.size()) { snapshot.error = ERROR_INVALID_DATA; finished = true; break; }
                const auto* data = reinterpret_cast<const FILE_ID_BOTH_DIR_INFO*>(buffer.data() + offset);
                if (data->FileNameLength % 2 || data->FileNameLength > 2048 || data->FileNameLength > buffer.size() - offset - header) { snapshot.error = ERROR_INVALID_DATA; finished = true; break; }
                auto name = utf8(data->FileName, static_cast<int>(data->FileNameLength / 2));
                if (name != "." && name != "..") {
                    if (!child_name(name)) { snapshot.error = ERROR_INVALID_DATA; finished = true; break; }
                    if (snapshot.entries.size() == filesystem_entry_limit) { snapshot.truncated = true; finished = true; break; }
                    const auto file_id = static_cast<uint64_t>(data->FileId.QuadPart);
                    const auto created = static_cast<uint64_t>(data->CreationTime.QuadPart);
                    const auto previous = old.find(name);
                    const auto generation = previous != old.end() && previous->second->file_id == file_id && previous->second->created_ticks == created
                        ? previous->second->generation : ++entry_sequence_;
                    snapshot.entries.push_back({generation, file_id, created, unix_ms(static_cast<uint64_t>(data->LastWriteTime.QuadPart)),
                        static_cast<uint64_t>(data->EndOfFile.QuadPart), data->FileAttributes,
                        (data->FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0, (data->FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0, std::move(name)});
                }
                if (!data->NextEntryOffset) break;
                if (data->NextEntryOffset < header + data->FileNameLength || data->NextEntryOffset % 8 || data->NextEntryOffset >= buffer.size() - offset) { snapshot.error = ERROR_INVALID_DATA; finished = true; break; }
                offset += data->NextEntryOffset;
            }
        }
        std::sort(snapshot.entries.begin(), snapshot.entries.end(), [](const auto& left, const auto& right) {
            return left.directory != right.directory ? left.directory : left.name < right.name;
        });
        snapshot.observed_at_unix_ms = now_ms();
        snapshot.scan_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
    }

    std::shared_ptr<const FileSystemSnapshot> open_current() {
        close_watch();
        auto next = std::make_shared<FileSystemSnapshot>();
        next->scope = ++scope_; next->revision = ++revision_;
        next->root = utf8(root_.data(), static_cast<int>(root_.size()));
        next->relative = utf8(relative_.data(), static_cast<int>(relative_.size()));
        const auto path = root_ + (relative_.empty() ? L"" : (root_.back() == L'\\' ? L"" : L"\\") + relative_);
        next->error = open_directory(path);
        if (next->error) close_watch();
        else {
            next->watch_error = arm(); next->watching = pending_;
            scan(*next);
            record(*next, {0, 0, FileEventKind::baseline, {}, {}});
        }
        current_ = next;
        return current_;
    }
public:
    ~WindowsFileSystemMonitor() override { close_watch(); }

    std::shared_ptr<const FileSystemSnapshot> select_root(const std::string& input) override {
        close_watch(); root_.clear(); relative_.clear();
        auto invalid = std::make_shared<FileSystemSnapshot>(); invalid->revision = ++revision_; invalid->scope = ++scope_;
        invalid->error = ERROR_INVALID_NAME;
        current_ = invalid;
        auto path = wide(input);
        if (path.size() < 3 || path[1] != L':' || (path[2] != L'\\' && path[2] != L'/') || path.find_first_of(L"*?<>|\"") != std::wstring::npos || path.find(L':', 2) != std::wstring::npos) return current_;
        std::array<wchar_t, 8192> full{};
        const auto length = GetFullPathNameW(path.c_str(), static_cast<DWORD>(full.size()), full.data(), nullptr);
        if (length == 0 || length >= full.size()) return current_;
        path.assign(full.data(), length);
        const auto long_length = GetLongPathNameW(path.c_str(), full.data(), static_cast<DWORD>(full.size()));
        if (long_length == 0 || long_length >= full.size()) { invalid->error = GetLastError(); return current_; }
        path.assign(full.data(), long_length);
        while (path.size() > 3 && path.back() == L'\\') path.pop_back();
        const auto drive = GetDriveTypeW(path.substr(0, 3).c_str());
        if (drive != DRIVE_FIXED && drive != DRIVE_REMOVABLE && drive != DRIVE_RAMDISK) { invalid->error = ERROR_NOT_SUPPORTED; return current_; }
        root_ = std::move(path);
        return open_current();
    }

    std::shared_ptr<const FileSystemSnapshot> navigate(uint64_t scope, uint64_t entry) override {
        if (scope != current_->scope || root_.empty() || current_->error) return current_;
        if (entry == 0) {
            if (relative_.empty()) return current_;
            const auto slash = relative_.find_last_of(L'\\');
            relative_ = slash == std::wstring::npos ? L"" : relative_.substr(0, slash);
        } else {
            const auto found = std::find_if(current_->entries.begin(), current_->entries.end(), [entry](const auto& row) { return row.generation == entry; });
            if (found == current_->entries.end() || !found->directory || found->reparse || !child_name(found->name)) return current_;
            relative_ += (relative_.empty() ? L"" : L"\\") + wide(found->name);
        }
        return open_current();
    }

    std::shared_ptr<const FileSystemSnapshot> poll() override {
        if (!pending_) return current_;
        DWORD bytes = 0;
        const bool success = GetOverlappedResult(directory_, &overlapped_, &bytes, FALSE) != 0;
        const auto error = success ? 0 : GetLastError();
        if (error == ERROR_IO_INCOMPLETE) return current_;
        pending_ = false;
        auto next = std::make_shared<FileSystemSnapshot>(*current_);
        next->revision = ++revision_;
        auto decoded = success ? decode_directory_changes(std::span(reinterpret_cast<const std::byte*>(changes_.data()), bytes)) : DecodedFileChanges{true, {}};
        if (decoded.gap) record(*next, {0, 0, FileEventKind::gap, {}, {}});
        else for (auto& event : decoded.events) record(*next, std::move(event));
        next->watch_error = error && error != ERROR_NOTIFY_ENUM_DIR ? error : arm();
        next->watching = pending_;
        scan(*next);
        current_ = std::move(next);
        return current_;
    }

    std::shared_ptr<const FileSystemSnapshot> stop() override {
        close_watch(); root_.clear(); relative_.clear();
        current_ = std::make_shared<FileSystemSnapshot>();
        current_->revision = ++revision_; current_->scope = ++scope_;
        return current_;
    }
};
}

std::unique_ptr<IFileSystemMonitor> make_filesystem_monitor() { return std::make_unique<WindowsFileSystemMonitor>(); }
}