#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>
#include "universe/network.hpp"
#include <chrono>
#include <cstddef>

namespace universe {
namespace {
uint64_t ticks(FILETIME time) { return (static_cast<uint64_t>(time.dwHighDateTime) << 32) | time.dwLowDateTime; }

std::string address(int family, const void* data, uint32_t scope = 0) {
    char text[INET6_ADDRSTRLEN]{};
    if (!InetNtopA(family, data, text, sizeof(text))) return {};
    return std::string(text) + (scope ? "%" + std::to_string(scope) : "");
}

std::string utf8(const wchar_t* value) {
    const auto size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string output(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, output.data(), size, nullptr, nullptr);
    output.pop_back();
    return output;
}

template<class Table, class Row, class Query, class Visit>
uint32_t read_table(Query query, Visit visit, std::stop_token stop) {
    DWORD bytes = 0;
    auto result = query(nullptr, &bytes);
    for (uint32_t attempt = 0; attempt < 3; ++attempt) {
        if (stop.stop_requested()) return ERROR_OPERATION_ABORTED;
        if (result != ERROR_INSUFFICIENT_BUFFER) return result;
        if (bytes > 4 * 1024 * 1024 || bytes < sizeof(DWORD)) return ERROR_BUFFER_OVERFLOW;
        std::vector<unsigned char> buffer(bytes);
        result = query(buffer.data(), &bytes);
        if (result == NO_ERROR) {
            const auto* table = reinterpret_cast<const Table*>(buffer.data());
            const auto offset = offsetof(Table, table);
            if (buffer.size() < offset || table->dwNumEntries > (buffer.size() - offset) / sizeof(Row)) return ERROR_INVALID_DATA;
            for (DWORD index = 0; index < table->dwNumEntries; ++index) {
                if (stop.stop_requested()) return ERROR_OPERATION_ABORTED;
                if (!visit(table->table[index])) break;
            }
            return NO_ERROR;
        }
    }
    return result;
}

class WindowsNetworkCollector final : public INetworkCollector {
public:
    NetworkSnapshot collect(std::stop_token stop) override {
        const auto started = std::chrono::steady_clock::now();
        FILETIME system_time{};
        GetSystemTimeAsFileTime(&system_time);
        const auto started_ticks = ticks(system_time);
        NetworkSnapshot output;
        output.observed_at_unix_ms = (started_ticks - 116444736000000000ULL) / 10000;
        output.monotonic_ns = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(started.time_since_epoch()).count());
        struct Owner { std::optional<uint64_t> created; uint32_t error; };
        std::unordered_map<uint32_t, Owner> owners;
        auto append = [&](Connection row) {
            if (output.connections.size() == connection_limit) { output.truncated = true; return false; }
            auto found = owners.find(row.pid);
            if (found == owners.end()) {
                Owner owner{{}, 0};
                HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, row.pid);
                if (!process) owner.error = GetLastError();
                else {
                    FILETIME creation{}, exit{}, kernel{}, user{};
                    if (!GetProcessTimes(process, &creation, &exit, &kernel, &user)) owner.error = GetLastError();
                    else if (ticks(creation) > started_ticks) owner.error = ERROR_RETRY;
                    else owner.created = ticks(creation);
                    CloseHandle(process);
                }
                found = owners.emplace(row.pid, owner).first;
            }
            row.owner_creation = found->second.created;
            row.owner_error = found->second.error;
            output.connections.push_back(std::move(row));
            return true;
        };
        output.table_errors[0] = read_table<MIB_TCPTABLE_OWNER_PID, MIB_TCPROW_OWNER_PID>(
            [](void* data, DWORD* bytes) { return GetExtendedTcpTable(data, bytes, FALSE, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0); },
            [&](const MIB_TCPROW_OWNER_PID& value) {
                Connection row;
                row.pid = value.dwOwningPid; row.state = value.dwState;
                row.local_address = address(AF_INET, &value.dwLocalAddr); row.local_port = ntohs(static_cast<u_short>(value.dwLocalPort));
                if (value.dwState != MIB_TCP_STATE_LISTEN && value.dwRemotePort != 0) {
                    row.remote_address = address(AF_INET, &value.dwRemoteAddr); row.remote_port = ntohs(static_cast<u_short>(value.dwRemotePort));
                }
                return append(std::move(row));
            }, stop);
        output.table_errors[1] = read_table<MIB_TCP6TABLE_OWNER_PID, MIB_TCP6ROW_OWNER_PID>(
            [](void* data, DWORD* bytes) { return GetExtendedTcpTable(data, bytes, FALSE, AF_INET6, TCP_TABLE_OWNER_PID_ALL, 0); },
            [&](const MIB_TCP6ROW_OWNER_PID& value) {
                Connection row;
                row.family = 6; row.pid = value.dwOwningPid; row.state = value.dwState;
                row.local_address = address(AF_INET6, value.ucLocalAddr, value.dwLocalScopeId); row.local_port = ntohs(static_cast<u_short>(value.dwLocalPort));
                if (value.dwState != MIB_TCP_STATE_LISTEN && value.dwRemotePort != 0) {
                    row.remote_address = address(AF_INET6, value.ucRemoteAddr, value.dwRemoteScopeId); row.remote_port = ntohs(static_cast<u_short>(value.dwRemotePort));
                }
                return append(std::move(row));
            }, stop);
        output.table_errors[2] = read_table<MIB_UDPTABLE_OWNER_PID, MIB_UDPROW_OWNER_PID>(
            [](void* data, DWORD* bytes) { return GetExtendedUdpTable(data, bytes, FALSE, AF_INET, UDP_TABLE_OWNER_PID, 0); },
            [&](const MIB_UDPROW_OWNER_PID& value) {
                Connection row;
                row.protocol = 17; row.pid = value.dwOwningPid;
                row.local_address = address(AF_INET, &value.dwLocalAddr); row.local_port = ntohs(static_cast<u_short>(value.dwLocalPort));
                return append(std::move(row));
            }, stop);
        output.table_errors[3] = read_table<MIB_UDP6TABLE_OWNER_PID, MIB_UDP6ROW_OWNER_PID>(
            [](void* data, DWORD* bytes) { return GetExtendedUdpTable(data, bytes, FALSE, AF_INET6, UDP_TABLE_OWNER_PID, 0); },
            [&](const MIB_UDP6ROW_OWNER_PID& value) {
                Connection row;
                row.family = 6; row.protocol = 17; row.pid = value.dwOwningPid;
                row.local_address = address(AF_INET6, value.ucLocalAddr, value.dwLocalScopeId); row.local_port = ntohs(static_cast<u_short>(value.dwLocalPort));
                return append(std::move(row));
            }, stop);
        MIB_IF_TABLE2* table = nullptr;
        output.interface_error = stop.stop_requested() ? ERROR_OPERATION_ABORTED : GetIfTable2(&table);
        if (table) {
            const std::unique_ptr<MIB_IF_TABLE2, decltype(&FreeMibTable)> owner(table, FreeMibTable);
            for (ULONG index = 0; index < table->NumEntries; ++index) {
                if (stop.stop_requested()) { output.interface_error = ERROR_OPERATION_ABORTED; break; }
                if (output.interfaces.size() == interface_limit) { output.truncated = true; break; }
                const auto& value = table->Table[index];
                output.interfaces.push_back({value.InterfaceLuid.Value, value.InterfaceIndex, value.Type, value.OperStatus == IfOperStatusUp,
                    utf8(value.Alias), value.InOctets, value.OutOctets, {}, {}});
            }
        }
        output.collection_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
        return output;
    }
};
}

std::unique_ptr<INetworkCollector> make_network_collector() { return std::make_unique<WindowsNetworkCollector>(); }
}